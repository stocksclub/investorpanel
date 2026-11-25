// Downloads every S&P 500 company's SEC "companyfacts" file and keeps just the
// numbers the panel needs, using the same extract() the website uses.
// Runs weekly from GitHub Actions. Uses no AI.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const Core = require("../assets/core.js");

const OUT = new URL("../data/fundamentals.json", import.meta.url);
const UA = process.env.SEC_USER_AGENT || "";
const FORCE = process.env.FORCE_FUNDAMENTALS === "true";
const MAX_AGE_DAYS = 6;

if (!/\S+@\S+/.test(UA)) {
  console.error("Set the SEC_USER_AGENT repository variable to something like: Stock Club yourname@example.com (the SEC requires a contact email).");
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#160;|&nbsp;/g, " ").replace(/\[\d+\]/g, "").trim();

async function existing() {
  try { return JSON.parse(await readFile(OUT, "utf8")); } catch { return null; }
}

async function constituents() {
  const url = "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies&prop=text&format=json&formatversion=2";
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
  const html = (await res.json()).parse.text;
  const start = html.indexOf('id="constituents"');
  if (start < 0) throw new Error("Couldn't find the constituents table on Wikipedia.");
  const table = html.slice(start, html.indexOf("</table>", start));
  const rows = table.split(/<tr[\s>]/).slice(1);
  const header = (rows.shift().match(/<th[^>]*>([\s\S]*?)<\/th>/g) || []).map(strip);
  const col = name => header.findIndex(h => h.toLowerCase().startsWith(name));
  const iSym = col("symbol"), iName = col("security"), iSector = col("gics sector"), iCik = col("cik");
  if ([iSym, iName, iSector, iCik].some(i => i < 0)) throw new Error("Wikipedia's table layout changed: " + header.join(" | "));
  const list = [];
  for (const r of rows) {
    const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(strip);
    if (cells.length <= iCik) continue;
    const cik = parseInt(cells[iCik], 10);
    if (cells[iSym] && cik) list.push({ t: cells[iSym], n: cells[iName], s: cells[iSector], cik });
  }
  if (list.length < 450) throw new Error(`Only found ${list.length} companies on Wikipedia; stopping to be safe.`);
  return list;
}

// Trim each company's data: drop empty fields and round to keep the file small.
function compact(D) {
  const years = D.years.map(y => {
    const o = {};
    for (const [k, v] of Object.entries(y)) {
      if (v === null || v === undefined) continue;
      o[k] = typeof v === "number" ? (Math.abs(v) < 1000 ? Math.round(v * 1e4) / 1e4 : Math.round(v)) : v;
    }
    return o;
  });
  return { name: D.name, cik: D.cik, years, sharesOut: D.sharesOut };
}

async function companyfacts(cik) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await sleep(2000 * attempt); // back off on 429/5xx
  }
  throw new Error(`SEC kept refusing ${url}`);
}

const prev = await existing();
const ageDays = prev?.updated ? (Date.now() - Date.parse(prev.updated)) / 864e5 : Infinity;
if (!FORCE && prev?.companies?.length && ageDays < MAX_AGE_DAYS) {
  console.log(`Fundamentals are ${ageDays.toFixed(1)} days old; skipping (set FORCE_FUNDAMENTALS=true to refresh now).`);
  process.exit(0);
}

const list = await constituents();
console.log(`Found ${list.length} S&P 500 companies.`);
const oldByTicker = Object.fromEntries((prev?.companies || []).map(c => [c.t, c]));
const companies = [], skipped = [];
let i = 0;
async function worker() {
  while (i < list.length) {
    const co = list[i++];
    try {
      const json = await companyfacts(co.cik);
      if (!json) throw new Error("no SEC data");
      companies.push({ ...co, D: compact(Core.extract(json)) });
    } catch (err) {
      if (oldByTicker[co.t]) companies.push({ ...oldByTicker[co.t], s: co.s, n: co.n }); // keep last week's data
      skipped.push(`${co.t}: ${err.message}`);
    }
    await sleep(250); // 4 workers × 4 per second stays under the SEC's 10 requests/second limit
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
companies.sort((a, b) => a.t.localeCompare(b.t));
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), count: companies.length, companies }));
console.log(`Saved ${companies.length} companies.`);
if (skipped.length) console.log(`Problems with ${skipped.length}:\n  ` + skipped.join("\n  "));
