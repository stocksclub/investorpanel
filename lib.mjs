// Shared helpers for the data build: weighting, index aggregation, ranking.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const Core = require("../assets/core.js");

export const VKEYS = ["buy", "watch", "skeptical", "walk", "nd"];
export const SUM_FIELDS = ["revenue","costRev","grossProfit","opIncome","netIncome","pretax","interest","dilShares","cfo","capex","da","divPaid","rnd","assets","curAssets","curLiab","liabilities","equity","ltDebt","stDebt","cash","sti","ppe","inventory","goodwill","sbc"];
// Banks, insurers and real-estate trusts report balance sheets these tests can't read.
export const isExcludedSector = s => /^(financials|finance|real estate)$/i.test(String(s || "").trim());
export const normTicker = t => String(t || "").trim().toUpperCase().replace(/[./]/g, "-");

// Drop empty fields and round so the files stay small.
export function compact(D) {
  const years = D.years.map(y => {
    const o = {};
    for (const [k, v] of Object.entries(y)) {
      if (v === null || v === undefined) continue;
      o[k] = typeof v === "number" ? (Math.abs(v) < 1000 ? Math.round(v * 1e4) / 1e4 : Math.round(v)) : v;
    }
    return o;
  });
  const out = { name: D.name, cik: D.cik, years, sharesOut: D.sharesOut };
  if (D.est) out.est = D.est;
  if (D.aggregate) out.aggregate = true;
  return out;
}

/* Treat an index as one company that owns a slice of each holding.
   Cap-weighted (S&P 500, Nasdaq-100): the index owns the same percentage of every company,
   so its share of sales, profits, debt and value is a straight sum.
   Price-weighted (Dow): the index owns one share of every company,
   so each company counts in proportion to its share price. */
export function weightOf(c, method) { return method === "price" ? c.price : c.price * c.D.sharesOut; }
function ownership(c, method) { return method === "price" ? 1 / c.D.sharesOut : 1; }

export function aggregate(members, method, name) {
  const years = [];
  for (let i = 0; i < 11; i++) {
    const y = {}, yrCount = {};
    SUM_FIELDS.forEach(f => { y[f] = 0; });
    for (const c of members) {
      const cy = c.D.years[i], own = ownership(c, method);
      SUM_FIELDS.forEach(f => { if (Core.isNum(cy[f])) y[f] += cy[f] * own; });
      const yr = (cy.end || "").slice(0, 4); yrCount[yr] = (yrCount[yr] || 0) + 1;
    }
    const yr = Object.keys(yrCount).sort((a, b) => yrCount[b] - yrCount[a])[0];
    y.end = `${yr}-12-31`;
    y.eps = y.netIncome; y.dps = y.divPaid; // one "share" of the index
    SUM_FIELDS.forEach(f => { if (y[f] === 0 && f !== "dilShares") y[f] = null; });
    years.push(y);
  }
  const price = members.reduce((s, c) => s + weightOf(c, method), 0);
  return { D: { name, years, sharesOut: 1, aggregate: true }, price };
}

// list: [{t, n, s}] from the index's member list; byTicker: company data with prices.
export function buildIndex(meta, list, byTicker) {
  const all = list.map(x => ({ ...x, co: byTicker[x.t] })).filter(x => x.co && Core.isNum(x.co.price) && x.co.D.sharesOut);
  const total = all.reduce((s, x) => s + weightOf(x.co, meta.method), 0);
  const used = all.filter(x => !isExcludedSector(x.s || x.co.s) && x.co.D.years.length >= 11);
  const usedW = used.reduce((s, x) => s + weightOf(x.co, meta.method), 0);
  const holdings = all.map(x => ({ t: x.t, n: x.co.n || x.n, w: weightOf(x.co, meta.method) / total }))
    .sort((a, b) => b.w - a.w).map(h => ({ ...h, w: Math.round(h.w * 1e5) / 1e5 }));
  const agg = aggregate(used.map(x => x.co), meta.method, meta.name);
  return { ...meta, members: list.length, priced: all.length, used: used.length, coverage: total ? usedW / total : 0,
    holdings, D: compact(agg.D), price: agg.price };
}

export function rankRow(c, settings, flags) {
  const { m, P } = Core.analyze(c.D, { price: c.price, tsy: settings.tsy, cpi: settings.cpi });
  const v = Core.ORDER.map(k => { const r = Core.verdict(P[k].tests); return [r.p, r.n, VKEYS.indexOf(r.key)]; });
  return { t: c.t, n: c.n, s: c.s || "", mc: Math.round(m.mcap || 0), x: flags, v };
}

/* ---------- Sectors ---------- */
// Each sector is built from the S&P 500 companies in it, weighted by market value,
// which is how the Select Sector SPDR funds (XLK, XLV, ...) are built.
export const SECTOR_ETF = {
  "Information Technology": "XLK", "Health Care": "XLV", "Financials": "XLF", "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP", "Energy": "XLE", "Industrials": "XLI", "Materials": "XLB", "Utilities": "XLU",
  "Real Estate": "XLRE", "Communication Services": "XLC"
};
const NASDAQ_TO_GICS = {
  "Technology": "Information Technology", "Telecommunications": "Communication Services", "Finance": "Financials",
  "Basic Materials": "Materials", "Health Care": "Health Care", "Consumer Discretionary": "Consumer Discretionary",
  "Consumer Staples": "Consumer Staples", "Energy": "Energy", "Industrials": "Industrials", "Real Estate": "Real Estate", "Utilities": "Utilities"
};
export function gicsSector(spSector, nasdaqSector) {
  if (spSector && SECTOR_ETF[spSector]) return spSector;
  return NASDAQ_TO_GICS[nasdaqSector] || "";
}

// Monthly closing prices -> the price at the end of each fiscal year (null if unknown).
export function priceAtYearEnds(hist, years) {
  if (!hist || !hist.t) return null;
  return years.map(y => {
    const end = Date.parse(y.end) / 1000;
    let best = null, bestT = 0;
    for (let j = 0; j < hist.t.length; j++) {
      if (hist.t[j] > end) break;
      if (Core.isNum(hist.c[j])) { best = hist.c[j]; bestT = hist.t[j]; }
    }
    return best !== null && end - bestT <= 45 * 86400 ? Math.round(best * 100) / 100 : null;
  });
}

export function buildSector(name, members) {
  const used = members.filter(c => c.D.years.length >= 11 && c.D.sharesOut && Core.isNum(c.price)
    && Array.isArray(c.ph) && c.ph.slice(0, 11).every(Core.isNum));
  const agg = aggregate(used, "cap", name);
  // The sector's total market value at the end of each year, so its P/E can be charted over time.
  const ph = [];
  for (let i = 0; i < 11; i++) ph.push(used.length ? Math.round(used.reduce((s, c) => s + c.ph[i] * (c.D.years[i].dilShares || c.D.sharesOut), 0)) : null);
  return { id: name, name, etf: SECTOR_ETF[name] || "", members: members.length, used: used.length, D: compact(agg.D), price: agg.price, ph };
}
