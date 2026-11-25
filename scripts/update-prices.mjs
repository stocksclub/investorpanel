// Fetches the latest closing price for every company in data/fundamentals.json.
// Runs every weekday evening from GitHub Actions. Uses no AI.
import { readFile, writeFile } from "node:fs/promises";

const FUND = new URL("../data/fundamentals.json", import.meta.url);
const OUT = new URL("../data/prices.json", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0 (compatible; InvestorPanel/1.0)" };

const fund = JSON.parse(await readFile(FUND, "utf8"));
let old = {};
try { old = JSON.parse(await readFile(OUT, "utf8")).prices || {}; } catch {}

async function yahoo(t) {
  const sym = t.replace(/\./g, "-");
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`, { headers: UA });
  if (!res.ok) return null;
  const p = (await res.json())?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof p === "number" && p > 0 ? p : null;
}
async function stooq(t) {
  const sym = t.replace(/\./g, "-").toLowerCase() + ".us";
  const res = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`, { headers: UA });
  if (!res.ok) return null;
  const line = (await res.text()).trim().split("\n")[1] || "";
  const close = parseFloat(line.split(",")[6]);
  return close > 0 ? close : null;
}

const prices = {}, missed = [];
let i = 0;
async function worker() {
  while (i < fund.companies.length) {
    const t = fund.companies[i++].t;
    let p = null;
    try { p = await yahoo(t); } catch {}
    if (!p) { try { p = await stooq(t); } catch {} }
    if (p) prices[t] = Math.round(p * 100) / 100;
    else { missed.push(t); if (old[t]) prices[t] = old[t]; }
    await sleep(150);
  }
}
await Promise.all([worker(), worker(), worker()]);
const fresh = fund.companies.length - missed.length;
if (fresh < fund.companies.length * 0.5) {
  console.error(`Only got fresh prices for ${fresh} companies; keeping the old file.`);
  process.exit(1);
}
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), prices }));
console.log(`Saved prices for ${Object.keys(prices).length} companies (${missed.length} kept from last time: ${missed.join(", ") || "none"}).`);
