// Builds the website and its data into _site/ for GitHub Pages. Uses no AI.
//  - SEC filings: one bulk download of every company's data, refreshed weekly (kept in cache/).
//  - Prices and sectors: Nasdaq's stock screener (every U.S.-listed stock in one request), daily.
//  - Index member lists: Wikipedia.
import { readFile, writeFile, mkdir, cp, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import yauzl from "yauzl";
import { Core, compact, buildIndex, rankRow, normTicker, gicsSector, priceAtYearEnds, buildSector } from "./lib.mjs";
const FUND_VERSION = 2; // bump when the way filings are read changes, to force a fresh download

const ROOT = new URL("../", import.meta.url);
const P = p => new URL(p, ROOT);
const UA = process.env.SEC_USER_AGENT || "";
const FORCE = process.env.FORCE_FUNDAMENTALS === "true";
const BROWSER = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept": "application/json, text/plain, */*" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (!/\S+@\S+/.test(UA)) {
  console.error("Set the SEC_USER_AGENT repository variable to something like: Stock Club yourname@example.com (the SEC requires a contact email).");
  process.exit(1);
}
const settings = JSON.parse(await readFile(P("data/settings.json"), "utf8"));
await mkdir(P("cache/"), { recursive: true });

async function getJSON(url, headers) {
  for (let a = 1; a <= 3; a++) {
    const r = await fetch(url, { headers });
    if (r.ok) return r.json();
    if (r.status === 404) throw new Error(`${url} returned 404`);
    await sleep(2000 * a);
  }
  throw new Error(`${url} kept failing`);
}
async function readGz(name) { try { return JSON.parse(gunzipSync(await readFile(P("cache/" + name))).toString("utf8")); } catch { return null; } }
async function writeGz(name, obj) { await writeFile(P("cache/" + name), gzipSync(JSON.stringify(obj))); }

/* ---------- 1. SEC ticker list ---------- */
const secTickers = Object.values(await getJSON("https://www.sec.gov/files/company_tickers.json", { "User-Agent": UA }))
  .map(x => ({ t: normTicker(x.ticker), cik: x.cik_str, title: x.title }));
const cikByTicker = Object.fromEntries(secTickers.map(x => [x.t, x.cik]));
log(`SEC lists ${secTickers.length} tickers.`);

/* ---------- 2. Filings (weekly) ---------- */
let fund = await readGz("fundamentals.json.gz");
const ageDays = fund ? (Date.now() - Date.parse(fund.updated)) / 864e5 : Infinity;
if (FORCE || !fund || fund.version !== FUND_VERSION || ageDays > 6) {
  log("Downloading the SEC's bulk filings file (over a gigabyte; a few minutes)...");
  const zipPath = P("cache/companyfacts.zip");
  const res = await fetch("https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip", { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`SEC bulk download returned ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
  const wanted = new Set(secTickers.map(x => String(x.cik).padStart(10, "0")));
  const byCik = {};
  let tried = 0;
  await new Promise((resolve, reject) => {
    yauzl.open(zipPath.pathname, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("entry", e => {
        const m = /CIK(\d{10})\.json$/.exec(e.fileName);
        if (!m || !wanted.has(m[1])) { zip.readEntry(); return; }
        zip.openReadStream(e, (err2, st) => {
          if (err2) { zip.readEntry(); return; }
          const chunks = [];
          st.on("data", c => chunks.push(c));
          st.on("error", () => zip.readEntry());
          st.on("end", () => {
            tried++;
            try { byCik[+m[1]] = compact(Core.extract(JSON.parse(Buffer.concat(chunks).toString("utf8")))); } catch {}
            zip.readEntry();
          });
        });
      });
      zip.on("end", resolve);
      zip.on("error", reject);
      zip.readEntry();
    });
  });
  await rm(zipPath, { force: true });
  fund = { version: FUND_VERSION, updated: new Date().toISOString(), byCik };
  await writeGz("fundamentals.json.gz", fund);
  log(`Read ${tried} company files; ${Object.keys(byCik).length} have usable annual data.`);
} else log(`Filings are ${ageDays.toFixed(1)} days old; reusing them.`);

/* ---------- 3. Prices and sectors (daily) ---------- */
let quotes = null;
try {
  const j = await getJSON("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true",
    { ...BROWSER, Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" });
  const rows = j?.data?.rows || [];
  quotes = {};
  for (const r of rows) {
    const p = parseFloat(String(r.lastsale || "").replace(/[$,]/g, ""));
    if (p > 0) quotes[normTicker(r.symbol)] = { p, s: r.sector || "", n: r.name || "" };
  }
  if (Object.keys(quotes).length < 3000) throw new Error(`only ${Object.keys(quotes).length} quotes`);
  await writeGz("quotes.json.gz", { updated: new Date().toISOString(), quotes });
  log(`Got ${Object.keys(quotes).length} prices from Nasdaq.`);
} catch (err) {
  const old = await readGz("quotes.json.gz");
  log(`Nasdaq prices failed (${err.message}); ${old ? "using the last saved prices" : "no saved prices yet"}.`);
  quotes = old ? old.quotes : {};
}
const quotesFile = await readGz("quotes.json.gz");
const pricesUpdated = quotesFile ? quotesFile.updated : new Date().toISOString();

/* ---------- 4. Index member lists (Wikipedia) ---------- */
const strip = s => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#160;|&nbsp;/g, " ").replace(/\[\d+\]/g, "").trim();
async function wikiMembers(page, minRows) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=text&format=json&formatversion=2`;
  const html = (await getJSON(url, { "User-Agent": UA })).parse.text;
  for (const tbl of html.split(/<table/).slice(1).map(t => t.slice(0, t.indexOf("</table>")))) {
    const rows = tbl.split(/<tr[\s>]/).slice(1);
    if (rows.length < minRows) continue;
    const header = (rows[0].match(/<th[^>]*>([\s\S]*?)<\/th>/g) || []).map(h => strip(h).toLowerCase());
    const iSym = header.findIndex(h => /^(symbol|ticker)/.test(h));
    if (iSym < 0) continue;
    const iName = header.findIndex(h => /^(security|company)/.test(h));
    const iSector = header.findIndex(h => /sector|industry/.test(h));
    const list = [];
    for (const r of rows.slice(1)) {
      // A company name in a <th> shifts the columns; read th and td cells together in order.
      const cells = (r.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g) || []).map(strip);
      const sym = (cells[iSym] || "").match(/[A-Z][A-Z.\-]*/);
      if (sym) list.push({ t: normTicker(sym[0]), n: cells[iName] || "", s: iSector >= 0 ? cells[iSector] : "" });
    }
    if (list.length >= minRows) return list;
  }
  throw new Error(`Couldn't find the member table on Wikipedia's ${page} page.`);
}
const INDICES = [
  { id: "sp500", name: "S&P 500", method: "cap", page: "List_of_S%26P_500_companies", min: 450,
    about: "The 500 or so largest U.S. companies, weighted by market value: bigger companies count more." },
  { id: "ndx", name: "Nasdaq-100", method: "cap", page: "Nasdaq-100", min: 90,
    about: "The 100 largest non-financial companies on the Nasdaq exchange, weighted by market value (Nasdaq trims the very biggest a little; this view uses plain market value)." },
  { id: "dji", name: "Dow Jones Industrial Average", method: "price", page: "Dow_Jones_Industrial_Average", min: 28,
    about: "30 famous U.S. companies, weighted by share price: a $400 stock counts four times as much as a $100 stock, no matter how big the company is." }
];
const memberLists = {};
for (const ix of INDICES) {
  try { memberLists[ix.id] = await wikiMembers(ix.page, ix.min); log(`${ix.name}: ${memberLists[ix.id].length} members.`); }
  catch (err) { log(`${ix.name}: ${err.message}`); memberLists[ix.id] = []; }
}
const idxOf = {};
for (const ix of INDICES) for (const m of memberLists[ix.id]) (idxOf[m.t] ||= []).push(ix.id);

/* ---------- 5. The universe: one listed stock per company ---------- */
const JUNK = /warrant|\bright[s]?\b|\bunits?\b|preferred|depositary|notes due|debentures/i;
const byTicker = {}, seenCik = new Set();
for (const x of secTickers) {
  if (seenCik.has(x.cik)) continue;
  const q = quotes[x.t], D = fund.byCik[x.cik];
  if (!q || !D || !D.sharesOut || JUNK.test(q.n)) continue;
  seenCik.add(x.cik);
  byTicker[x.t] = { t: x.t, n: x.title, s: q.s, cik: x.cik, price: q.p, D };
}
// Index members whose ticker the SEC lists differently (e.g. share classes): match by CIK if possible.
for (const ix of INDICES) for (const m of memberLists[ix.id]) {
  if (byTicker[m.t]) continue;
  const cik = cikByTicker[m.t], D = cik && fund.byCik[cik], q = quotes[m.t];
  if (D && q && D.sharesOut) byTicker[m.t] = { t: m.t, n: m.n, s: q.s, cik, price: q.p, D };
}
const companies = Object.values(byTicker);
log(`${companies.length} companies have both filings and a price.`);

/* ---------- 5b. Sectors (GICS, the system the sector ETFs use) ---------- */
const spSector = Object.fromEntries(memberLists.sp500.map(m => [m.t, m.s]));
for (const c of companies) c.g = gicsSector(spSector[c.t], c.s);

/* ---------- 5c. Price history for index members (weekly), for the Trends charts ---------- */
let hist = await readGz("history.json.gz");
const histTickers = Object.keys(idxOf).filter(t => byTicker[t]);
const histAge = hist ? (Date.now() - Date.parse(hist.updated)) / 864e5 : Infinity;
if (!hist || histAge > 6 || FORCE) {
  log(`Downloading price history for ${histTickers.length} index companies...`);
  const byT = {};
  let k = 0;
  async function worker() {
    while (k < histTickers.length) {
      const t = histTickers[k++];
      try {
        const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=15y&interval=1mo`, BROWSER);
        const r = j?.chart?.result?.[0];
        if (r?.timestamp) byT[t] = { t: r.timestamp, c: (r.indicators?.quote?.[0]?.close || []).map(v => v == null ? null : Math.round(v * 100) / 100) };
      } catch {}
      await sleep(200);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  if (Object.keys(byT).length > histTickers.length * 0.5) { hist = { updated: new Date().toISOString(), byT }; await writeGz("history.json.gz", hist); }
  log(`Price history for ${Object.keys(byT).length} companies${hist && hist.byT === byT ? "" : " (too few; keeping the old history)"}.`);
}
for (const c of companies) c.ph = hist ? priceAtYearEnds(hist.byT[c.t], c.D.years) : null;
const sectorNames = [...new Set(memberLists.sp500.map(m => byTicker[m.t]?.g).filter(Boolean))].sort();
const sectors = sectorNames.map(g => buildSector(g, memberLists.sp500.map(m => byTicker[m.t]).filter(c => c && c.g === g)));
log(`Sectors: ${sectors.map(x => `${x.name} ${x.used}/${x.members}`).join(", ")}.`);
if (companies.length < 400) throw new Error("Too few companies; something went wrong upstream, so the old site stays up.");

/* ---------- 6. Write the site ---------- */
const OUT = P("_site/");
await rm(OUT, { recursive: true, force: true });
await mkdir(P("_site/data/co/"), { recursive: true });
for (const f of ["index.html", "score.html", "learn.html", "indices.html", "rank.html", "trends.html", "sp500.html"]) await cp(P(f), new URL(f, OUT)).catch(() => {});
await cp(P("assets/"), new URL("assets/", OUT), { recursive: true });

const indices = INDICES.map(ix => buildIndex({ id: ix.id, name: ix.name, method: ix.method, about: ix.about }, memberLists[ix.id], byTicker));
await writeFile(new URL("data/indices.json", OUT), JSON.stringify({ updated: fund.updated, pricesUpdated, indices }));

const flag = { sp500: "S", ndx: "N", dji: "D" };
const rows = companies.map(c => rankRow({ ...c, s: c.g }, settings, (idxOf[c.t] || []).map(i => flag[i]).join("")));
await writeFile(new URL("data/sectors.json", OUT), JSON.stringify({ updated: fund.updated, pricesUpdated, sectors }));
await writeFile(new URL("data/ranks.json", OUT), JSON.stringify({ updated: fund.updated, pricesUpdated, settings, rows }));

for (const c of companies) await writeFile(new URL(`data/co/${c.t}.json`, OUT), JSON.stringify({ t: c.t, n: c.n, s: c.g, cik: c.cik, price: c.price, ph: c.ph, D: c.D }));
await writeFile(new URL("data/meta.json", OUT), JSON.stringify({ updated: fund.updated, pricesUpdated, count: companies.length }));
log(`Site built: ${companies.length} companies, ${indices.map(i => `${i.name} ${i.used}/${i.members}`).join(", ")}.`);
