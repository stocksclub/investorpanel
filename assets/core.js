/* The Investor Panel: shared data extraction and scoring.
   Runs in the browser (window.PanelCore) and in Node (require) so the website
   and the nightly data job always score stocks the same way. */
(function (root) {
"use strict";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- XBRL concept map (first tag found wins for each year) ---------- */
const CONCEPTS = {
  revenue:{kind:"flow",tags:["Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","SalesRevenueGoodsNet","SalesRevenueServicesNet"]},
  costRev:{kind:"flow",tags:["CostOfRevenue","CostOfGoodsAndServicesSold","CostOfGoodsSold","CostOfServices"]},
  grossProfit:{kind:"flow",tags:["GrossProfit"]},
  opIncome:{kind:"flow",tags:["OperatingIncomeLoss"]},
  netIncome:{kind:"flow",tags:["NetIncomeLoss","ProfitLoss","NetIncomeLossAvailableToCommonStockholdersBasic"]},
  pretax:{kind:"flow",tags:["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest","IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"]},
  interest:{kind:"flow",tags:["InterestExpense","InterestExpenseNonoperating","InterestExpenseDebt"]},
  eps:{kind:"flow",unit:"USD/shares",tags:["EarningsPerShareDiluted","EarningsPerShareBasicAndDiluted","EarningsPerShareBasic"]},
  dilShares:{kind:"flow",unit:"shares",tags:["WeightedAverageNumberOfDilutedSharesOutstanding","WeightedAverageNumberOfShareOutstandingBasicAndDiluted","WeightedAverageNumberOfSharesOutstandingBasic"]},
  cfo:{kind:"flow",tags:["NetCashProvidedByUsedInOperatingActivities","NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]},
  capex:{kind:"flow",tags:["PaymentsToAcquirePropertyPlantAndEquipment","PaymentsToAcquireProductiveAssets"]},
  da:{kind:"flow",tags:["DepreciationDepletionAndAmortization","DepreciationAmortizationAndAccretionNet","DepreciationAndAmortization","Depreciation"]},
  divPaid:{kind:"flow",tags:["PaymentsOfDividends","PaymentsOfDividendsCommonStock"]},
  dps:{kind:"flow",unit:"USD/shares",tags:["CommonStockDividendsPerShareDeclared","CommonStockDividendsPerShareCashPaid"]},
  rnd:{kind:"flow",tags:["ResearchAndDevelopmentExpense","ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"]},
  assets:{kind:"inst",tags:["Assets"]},
  curAssets:{kind:"inst",tags:["AssetsCurrent"]},
  curLiab:{kind:"inst",tags:["LiabilitiesCurrent"]},
  liabilities:{kind:"inst",tags:["Liabilities"]},
  liabEq:{kind:"inst",tags:["LiabilitiesAndStockholdersEquity"]},
  equity:{kind:"inst",tags:["StockholdersEquity","StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]},
  equityTotal:{kind:"inst",tags:["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest","StockholdersEquity"]},
  ltDebtNC:{kind:"inst",tags:["LongTermDebtNoncurrent","LongTermDebtAndCapitalLeaseObligations","LongTermNotesPayable"]},
  ltDebtTotal:{kind:"inst",tags:["LongTermDebt","DebtLongtermAndShorttermCombinedAmount"]},
  ltDebtCur:{kind:"inst",tags:["LongTermDebtCurrent","LongTermDebtAndCapitalLeaseObligationsCurrent","DebtCurrent"]},
  stBorrow:{kind:"inst",tags:["ShortTermBorrowings","CommercialPaper"]},
  cash:{kind:"inst",tags:["CashAndCashEquivalentsAtCarryingValue","CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents","Cash"]},
  sti:{kind:"inst",tags:["ShortTermInvestments","MarketableSecuritiesCurrent","AvailableForSaleSecuritiesDebtSecuritiesCurrent"]},
  ppe:{kind:"inst",tags:["PropertyPlantAndEquipmentNet"]},
  inventory:{kind:"inst",tags:["InventoryNet"]},
  goodwill:{kind:"inst",tags:["Goodwill"]},
  sbc:{kind:"flow",tags:["ShareBasedCompensation","AllocatedShareBasedCompensationExpense"]}
};

function series(gaap, def){
  const unit = def.unit || "USD", out = {};
  for (const tag of def.tags){
    const arr = gaap[tag]?.units?.[unit];
    if (!arr) continue;
    const local = {};
    for (const f of arr){
      if (!/^10-K/.test(f.form || "")) continue;
      if (def.kind === "flow"){
        if (!f.start) continue;
        const days = (Date.parse(f.end) - Date.parse(f.start)) / 864e5;
        if (days < 340 || days > 390) continue;
      } else if (f.start) continue;
      const p = local[f.end];
      if (!p || f.filed > p.filed) local[f.end] = {val:f.val, filed:f.filed};
    }
    for (const e in local) if (!(e in out)) out[e] = local[e].val;
  }
  return out;
}
function near(map, end){
  if (end in map) return map[end];
  const t = Date.parse(end);
  for (const k in map) if (Math.abs(Date.parse(k) - t) <= 7*864e5) return map[k];
  return null;
}

function extract(json){
  const gaap = json?.facts?.["us-gaap"];
  if (!gaap) throw new Error("This file has no U.S. GAAP data. Companies that report under international rules (most 20-F filers) aren’t supported.");
  const S = {};
  for (const k in CONCEPTS) S[k] = series(gaap, CONCEPTS[k]);
  const ends = [...new Set([...Object.keys(S.netIncome), ...Object.keys(S.revenue)])].sort().reverse().slice(0, 11);
  if (!ends.length) throw new Error("No annual (10-K) results found in this file. Check that it’s the SEC “companyfacts” file for the right company.");
  const years = ends.map(end => {
    const y = {end};
    for (const k in CONCEPTS) y[k] = CONCEPTS[k].kind === "flow" ? (S[k][end] ?? null) : near(S[k], end);
    // Debt
    y.ltDebt = y.ltDebtNC ?? (y.ltDebtTotal != null ? y.ltDebtTotal - (y.ltDebtCur || 0) : null);
    y.stDebt = (y.ltDebtCur == null && y.stBorrow == null) ? null : (y.ltDebtCur || 0) + (y.stBorrow || 0);
    // Liabilities fallback
    if (y.liabilities == null){
      if (y.liabEq != null && y.equityTotal != null) y.liabilities = y.liabEq - y.equityTotal;
      else if (y.assets != null && y.equityTotal != null) y.liabilities = y.assets - y.equityTotal;
    }
    if (y.grossProfit == null && y.revenue != null && y.costRev != null) y.grossProfit = y.revenue - y.costRev;
    if (y.eps == null && y.netIncome != null && y.dilShares) y.eps = y.netIncome / y.dilShares;
    ["ltDebtNC","ltDebtTotal","ltDebtCur","stBorrow","liabEq","equityTotal"].forEach(k => delete y[k]);
    return y;
  });
  // Shares outstanding from the cover page (sum share classes on the latest date)
  let sharesOut = null;
  const so = json?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if (so && so.length){
    const maxEnd = so.reduce((m, f) => f.end > m ? f.end : m, "");
    const latest = so.filter(f => f.end === maxEnd);
    const lastFiled = latest.reduce((m, f) => f.filed > m ? f.filed : m, "");
    const accn = latest.find(f => f.filed === lastFiled)?.accn;
    sharesOut = latest.filter(f => f.accn === accn).reduce((s, f) => s + f.val, 0) || null;
  }
  if (!sharesOut) sharesOut = years[0].dilShares;
  return {name: json.entityName || "Unknown company", cik: json.cik, years, sharesOut};
}

/* ---------- Formatting ---------- */
const isNum = v => typeof v === "number" && isFinite(v);
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0) ? a / b : null;
const avg = a => { const v = a.filter(isNum); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const cagr = (nw, old, n) => (isNum(nw) && isNum(old) && nw > 0 && old > 0 && n > 0) ? Math.pow(nw / old, 1 / n) - 1 : null;
function money(v){
  if (!isNum(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−$" : "$";
  if (a >= 1e12) return s + (a/1e12).toFixed(2) + "T";
  if (a >= 1e9) return s + (a/1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + (a/1e6).toFixed(1) + "M";
  return s + a.toLocaleString(undefined, {maximumFractionDigits:2});
}
const pct = (v, d=1) => isNum(v) ? (v*100).toFixed(d).replace("-", "−") + "%" : "—";
const num = (v, d=1) => isNum(v) ? v.toFixed(d).replace("-", "−") : "—";
const usd = v => isNum(v) ? (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2) : "—";
const fyLabel = y => y ? "FY" + y.end.slice(0, 4) : "";

const CPI_1973 = 44.4;
const origOf = inv => verdict(inv.tests.map(t => t.orig ? Object.assign({}, t, {st:t.orig}) : t));

/* ---------- Scoring ---------- */
function T(label, rule, why, value, cond){ return {label, rule, why, value, st: cond === null || cond === undefined ? "na" : (cond ? "pass" : "fail")}; }

function analyze(D, o){
  o = o || {};
  const Y = D.years, y0 = Y[0] || {}, y1 = Y[1] || {}, y2 = Y[2] || {};
  const price = o.price, sh = D.sharesOut;
  const eps = y => y.eps ?? div(y.netIncome, y.dilShares);
  const debtOf = y => (y.ltDebt == null && y.stDebt == null) ? (y.assets != null ? 0 : null) : (y.ltDebt || 0) + (y.stDebt || 0);
  const gm = y => div(y.grossProfit, y.revenue);
  const om = y => div(y.opIncome, y.revenue);
  const roe = y => (isNum(y.equity) && y.equity > 0) ? div(y.netIncome, y.equity) : null;
  const n5 = Math.min(5, Y.length - 1);
  const m = {};
  m.mcap = (isNum(price) && price > 0 && sh) ? price * sh : null;
  m.eps0 = eps(y0);
  m.pe = (m.mcap && m.eps0 > 0) ? price / m.eps0 : null;
  m.bvps = div(y0.equity, sh);
  m.pb = (m.mcap && m.bvps > 0) ? price / m.bvps : null;
  m.debt = debtOf(y0);
  m.cashAll = (y0.cash || 0) + (y0.sti || 0);
  m.epsG = cagr(m.eps0, eps(Y[n5] || {}), n5) ?? cagr(y0.netIncome, (Y[n5]||{}).netIncome, n5);
  m.revG = cagr(y0.revenue, (Y[n5]||{}).revenue, n5);
  m.dps = y0.dps ?? div(y0.divPaid, sh);
  m.yld = (isNum(m.dps) && price > 0) ? m.dps / price : (m.mcap ? 0 : null);
  if (m.mcap && !isNum(y0.dps) && !isNum(y0.divPaid)) m.yld = 0;
  m.ebit = y0.opIncome ?? (isNum(y0.pretax) ? y0.pretax + (y0.interest || 0) : null);
  m.ev = m.mcap && isNum(m.debt) ? m.mcap + m.debt - m.cashAll : null;
  const nwc = (isNum(y0.curAssets) && isNum(y0.curLiab)) ? (y0.curAssets - m.cashAll) - (y0.curLiab - (y0.stDebt || 0)) : null;
  m.roc = (isNum(nwc) && isNum(y0.ppe)) ? div(m.ebit, Math.max(nwc, 0) + y0.ppe) : null;
  m.ey = (m.ev && m.ev > 0) ? div(m.ebit, m.ev) : null;

  const P = {};

  /* Graham */
  {
    const sizeBar = 100e6 * (o.cpi / CPI_1973);
    const ten = Y.slice(0, 10);
    const niYears = ten.filter(y => isNum(y.netIncome));
    const profitable = niYears.filter(y => y.netIncome > 0).length;
    const paid = ten.filter(y => (y.divPaid > 0) || (y.dps > 0)).length;
    const e = ten.map(eps);
    const recent = e.length >= 6 ? avg(e.slice(0, 3)) : null, old = e.length >= 6 ? avg(e.slice(-3)) : null;
    const growth = (isNum(recent) && isNum(old) && old > 0) ? recent / old - 1 : null;
    const avgE3 = avg(e.slice(0, 3));
    const pe3 = (m.mcap && avgE3 > 0) ? price / avgE3 : null;
    const cr = div(y0.curAssets, y0.curLiab);
    const nca = isNum(y0.curAssets) && isNum(y0.curLiab) ? y0.curAssets - y0.curLiab : null;
    const lt = y0.ltDebt ?? (y0.assets != null ? 0 : null);
    let peCond = null; if (m.mcap) peCond = avgE3 > 0 ? pe3 <= 15 : (isNum(avgE3) ? false : null);
    let pbCond = null; if (m.mcap && isNum(m.bvps)) pbCond = m.bvps <= 0 ? false : (m.pb <= 1.5 || (pe3 && pe3 * m.pb <= 22.5));
    const tests = [
      Object.assign(T("Big, established company", `Sales ≥ ${money(sizeBar)} today ($100M in 1973 dollars)`, "Graham wanted firms big enough to survive hard times. He set the bar at $100 million of sales in 1973. The inflation-adjusted bar raises that by how much prices have climbed since.", money(y0.revenue) + ((isNum(y0.revenue) && (y0.revenue >= 100e6) !== (y0.revenue >= sizeBar)) ? " (passes the original $100M bar)" : ""), isNum(y0.revenue) ? y0.revenue >= sizeBar : null), {orig: isNum(y0.revenue) ? (y0.revenue >= 100e6 ? "pass" : "fail") : "na"}),
      T("Strong short-term finances", "Current ratio ≥ 2", "Current assets should be at least double the bills due within a year.", num(cr, 2), isNum(cr) ? cr >= 2 : null),
      T("Debt covered by working capital", "Long-term debt ≤ net current assets", "The company could pay off its long-term debt from its working capital alone.", money(lt) + " vs " + money(nca), (isNum(lt) && isNum(nca)) ? lt <= nca : null),
      T("Earnings stability", "Profit every year (up to 10)", "Graham trusted companies that made money through good years and bad.", niYears.length ? `${profitable} of ${niYears.length} yrs` : "—", niYears.length >= 3 ? profitable === niYears.length : null),
      T("Dividend record", "Dividend every year on file", "Graham asked for 20 straight years; SEC data files usually go back about 15.", ten.length ? `${paid} of ${ten.length} yrs` : "—", ten.length >= 3 ? paid === ten.length : null),
      T("Earnings growth", "Up ≥ 33% over the decade", "Compares average EPS of the latest 3 years to the oldest 3 on file.", isNum(growth) ? (growth >= 0 ? "+" : "") + pct(growth, 0) : "—", isNum(growth) ? growth >= 0.33 : null),
      T("Moderate price vs. earnings", "P/E ≤ 15 (3-yr avg EPS)", "Averaging three years of earnings keeps one lucky year from making a stock look cheap.", isNum(pe3) ? num(pe3) : (isNum(avgE3) && avgE3 <= 0 ? "Losses" : "—"), peCond),
      T("Moderate price vs. assets", "P/B ≤ 1.5, or P/E × P/B ≤ 22.5", "Graham didn’t want to pay much more than the company’s net assets are worth.", isNum(m.pb) ? `P/B ${num(m.pb)}` + (pe3 ? `, product ${num(pe3 * m.pb)}` : "") : (isNum(m.bvps) && m.bvps <= 0 ? "Negative book value" : "—"), pbCond)
    ];
    const gNum = (m.eps0 > 0 && m.bvps > 0) ? Math.sqrt(22.5 * m.eps0 * m.bvps) : null;
    const ncavPS = div(isNum(y0.curAssets) && isNum(y0.liabilities) ? y0.curAssets - y0.liabilities : null, sh);
    P.graham = {name:"Benjamin Graham", style:"Deep value · 1930s–70s", tests,
      intro:"Graham’s checklist for the “defensive investor” from The Intelligent Investor: a big, stable, dividend-paying company bought at a modest price, so there’s a margin of safety if things go wrong.",
      extras:[["Graham Number (fair-value ceiling)", gNum ? usd(gNum) + (price ? ` vs price ${usd(price)}` : "") : "—"],
              ["Net current assets per share", isNum(ncavPS) ? usd(ncavPS) + (price && ncavPS > 0 && price < ncavPS * 2/3 ? " (a true “net-net” bargain)" : "") : "—"]]};
  }

  /* Buffett */
  {
    const five = Y.slice(0, Math.min(5, Y.length));
    const negEq = five.some(y => isNum(y.equity) && y.equity <= 0);
    const roes = five.map(roe);
    const roeAvg = negEq ? null : avg(roes);
    const ten = Y.slice(0, 10);
    const niYears = ten.filter(y => isNum(y.netIncome));
    const noLoss = niYears.length >= 3 ? niYears.every(y => y.netIncome > 0) : null;
    const eNew = eps(y0), eOld = eps(ten[ten.length - 1] || {});
    const consistent = noLoss === null ? null : noLoss && isNum(eNew) && isNum(eOld) && eNew > eOld;
    const debtYears = div(m.debt, y0.netIncome);
    const capexSum = five.reduce((s, y) => s + (y.capex || 0), 0), niSum = five.reduce((s, y) => s + (y.netIncome || 0), 0);
    const capexRatio = niSum > 0 ? capexSum / niSum : null;
    const oe = isNum(y0.netIncome) ? y0.netIncome + (y0.da || 0) - (y0.capex || 0) : null;
    const oeY = m.mcap ? div(oe, m.mcap) : null;
    const tests = [
      T("High return on equity", "5-yr avg ROE ≥ 15%", "Buffett’s favorite sign of a great business: it earns a lot on the money owners have invested.", negEq ? "Negative equity" : pct(roeAvg), negEq ? null : (isNum(roeAvg) ? roeAvg >= 0.15 : null)),
      T("ROE holds up every year", "ROE ≥ 10% each of last 5 yrs", "A durable advantage shows up as steady returns, not one great year.", negEq ? "Negative equity" : (roes.filter(isNum).length ? roes.filter(isNum).map(r => pct(r, 0)).join(", ") : "—"), negEq ? null : (roes.filter(isNum).length >= 3 ? roes.filter(isNum).every(r => r >= 0.10) : null)),
      T("Little debt", "Total debt ≤ 4 years of profit", "Buffett liked companies that could pay off all debt with a few years of earnings.", m.debt === 0 ? "No debt" : (isNum(debtYears) && y0.netIncome > 0 ? num(debtYears) + " yrs" : (isNum(y0.netIncome) && y0.netIncome <= 0 ? "Losing money" : "—")), m.debt === 0 ? true : (isNum(y0.netIncome) && isNum(m.debt) ? (y0.netIncome > 0 && debtYears <= 4) : null)),
      T("Consistent, rising earnings", "No losses, EPS higher than a decade ago", "Predictable earnings make it possible to value the business with confidence.", niYears.length ? `${niYears.filter(y => y.netIncome > 0).length}/${niYears.length} profitable, EPS ${usd(eOld)} → ${usd(eNew)}` : "—", consistent),
      T("Pricing power", "Gross margin ≥ 40%", "High gross margins often signal a moat: customers pay up for the brand or product.", pct(gm(y0)), isNum(gm(y0)) ? gm(y0) >= 0.40 : null),
      T("Strong profitability", "Net margin ≥ 10%", "How much of each sales dollar becomes profit for owners.", pct(div(y0.netIncome, y0.revenue)), isNum(div(y0.netIncome, y0.revenue)) ? div(y0.netIncome, y0.revenue) >= 0.10 : null),
      T("Doesn’t eat its own cash", "Capex ≤ 50% of profit (5 yrs)", "Businesses that need little reinvestment leave more cash for owners.", isNum(capexRatio) ? pct(capexRatio, 0) : (niSum <= 0 && five.length ? "Losses" : "—"), isNum(capexRatio) ? capexRatio <= 0.5 : (niSum <= 0 && five.length ? false : null)),
      T("Earns more than a Treasury bond", `Owner-earnings yield ≥ ${num(o.tsy)}%`, "Owner earnings (profit + depreciation − capital spending) divided by market value. If a safe bond pays more, why take the risk?", pct(oeY), isNum(oeY) ? oeY * 100 >= o.tsy : null)
    ];
    P.buffett = {name:"Warren Buffett", style:"Quality at a fair price · 1960s–", tests,
      intro:"Drawn from Buffett’s shareholder letters: a wonderful business with high returns, little debt and a moat, bought when its earnings compare well with a safe bond.",
      extras:[["Owner earnings (FY)", money(oe)], ["Note", negEq ? "Negative equity usually comes from big buybacks; judge ROE with care." : "Owner earnings here subtract all capital spending, which is stricter than Buffett’s “maintenance” version."]]};
  }

  /* Lynch */
  {
    const g = isNum(m.epsG) ? m.epsG * 100 : null;
    const peg = (isNum(m.pe) && g > 0) ? m.pe / g : null;
    let pegCond = null, pegVal = "—";
    if (m.mcap){
      if (!(m.eps0 > 0)) { pegCond = isNum(m.eps0) ? false : null; pegVal = isNum(m.eps0) ? "Losing money" : "—"; }
      else if (!(g > 0)) { pegCond = isNum(g) ? false : null; pegVal = isNum(g) ? "Earnings shrinking" : "—"; }
      else { pegCond = peg <= 1; pegVal = `${num(peg, 2)} (P/E ${num(m.pe)}, growth ${num(g)}%)`; }
    }
    const dyRatio = (isNum(m.pe) && isNum(g) && isNum(m.yld)) ? (g + m.yld * 100) / m.pe : null;
    const de = (isNum(y0.equity) && y0.equity > 0) ? div(m.debt, y0.equity) : null;
    const netCash = isNum(m.debt) ? m.cashAll - m.debt : null;
    const ncps = div(netCash, sh);
    const invG = (y0.inventory > 0 && y1.inventory > 0) ? y0.inventory / y1.inventory - 1 : null;
    const salesG = (y0.revenue > 0 && y1.revenue > 0) ? y0.revenue / y1.revenue - 1 : null;
    let cat = "—";
    if (isNum(m.eps0) && m.eps0 <= 0) cat = "Turnaround candidate";
    else if (isNum(g)) cat = g < 5 ? "Slow grower" : g < 15 ? "Stalwart" : "Fast grower";
    if (isNum(m.pb) && m.pb < 1 && netCash > 0) cat = "Asset play";
    const tests = [
      T("Growth at a reasonable price", "PEG ≤ 1", "Lynch’s famous ratio: P/E divided by the earnings growth rate. Under 1 means you’re not overpaying for growth.", pegVal, pegCond),
      T("Growth plus dividend vs. P/E", "(Growth + yield) ÷ P/E ≥ 1.5", "Lynch’s version for dividend payers: 1 is poor, 1.5 okay, 2 or more excellent.", isNum(dyRatio) ? num(dyRatio, 2) : "—", isNum(dyRatio) ? dyRatio >= 1.5 : (pegCond === false ? false : null)),
      T("Strong balance sheet", "Debt-to-equity ≤ 0.5", "Companies without much debt can’t be pushed into bankruptcy by a bad stretch.", m.debt === 0 ? "No debt" : (isNum(de) ? num(de, 2) : (isNum(y0.equity) && y0.equity <= 0 ? "Negative equity" : "—")), m.debt === 0 ? true : (isNum(de) ? de <= 0.5 : (isNum(y0.equity) && y0.equity <= 0 ? false : null))),
      T("Net cash", "Cash exceeds debt", "Lynch liked to subtract net cash per share from the price to see what you really pay for the business.", isNum(ncps) ? usd(ncps) + "/share" + (price ? ` (${pct(ncps / price, 0)} of price)` : "") : "—", isNum(netCash) ? netCash > 0 : null),
      T("Inventory under control", "Inventory grows no faster than sales", "Piling-up inventory is a warning that products aren’t selling.", isNum(invG) ? `Inventory ${invG >= 0 ? "+" : ""}${pct(invG, 0)}, sales ${salesG >= 0 ? "+" : ""}${pct(salesG, 0)}` : "No inventory reported", isNum(invG) && isNum(salesG) ? invG <= salesG : null)
    ];
    P.lynch = {name:"Peter Lynch", style:"Growth at a reasonable price · 1977–90", tests,
      intro:"From One Up on Wall Street: know what kind of company you own, don’t overpay for its growth, and check the balance sheet for trouble.",
      extras:[["Lynch category", cat], ["5-yr EPS growth", isNum(g) ? num(g) + "% a year" : "—"], ["Dividend yield", pct(m.yld)]],
      homework:["Lynch’s six categories also include cyclicals (autos, steel, airlines). Those need judgment: buy near the bottom of the cycle, not the top.", "Can you explain why you own it in two minutes, the way you’d tell a friend?"]};
  }

  /* Fisher */
  {
    const fiveRev = Y.slice(0, 6).map(y => y.revenue);
    let ups = 0, comps = 0;
    for (let i = 0; i < fiveRev.length - 1; i++) if (isNum(fiveRev[i]) && isNum(fiveRev[i+1])) { comps++; if (fiveRev[i] > fiveRev[i+1]) ups++; }
    const rd = div(y0.rnd, y0.revenue);
    const omNow = om(y0), omOld = om(Y[n5] || {});
    const shG = cagr(y0.dilShares, (Y[n5]||{}).dilShares, n5);
    const tests = [
      T("Big growth runway", "5-yr sales growth ≥ 10% a year", "Fisher hunted companies whose sales could keep growing for years.", isNum(m.revG) ? pct(m.revG) + " a year" : "—", isNum(m.revG) ? m.revG >= 0.10 : null),
      T("Growth that keeps going", "Sales up in 4+ of the last 5 years", "He wanted steady expansion, not a one-time jump.", comps ? `${ups} of ${comps} yrs` : "—", comps >= 3 ? ups >= Math.min(4, comps - 1) : null),
      T("Invests in the future", "R&D ≥ 3% of sales", "Fisher asked whether research would produce the next generation of products.", isNum(rd) ? pct(rd) : "No R&D reported", isNum(rd) ? rd >= 0.03 : null),
      T("Worthwhile profit margins", "Operating margin ≥ 15%", "Fat margins give a company room to invest and to survive competition.", pct(omNow), isNum(omNow) ? omNow >= 0.15 : null),
      T("Margins improving", "Operating margin ≥ 5 years ago", "Fisher wanted management actively working to keep or widen margins.", isNum(omNow) && isNum(omOld) ? `${pct(omOld)} → ${pct(omNow)}` : "—", isNum(omNow) && isNum(omOld) ? omNow >= omOld : null),
      T("Owners not diluted", "Share count grows ≤ 1% a year", "Issuing lots of new stock shrinks each owner’s slice of future growth.", isNum(shG) ? (shG >= 0 ? "+" : "") + pct(shG) + " a year" : "—", isNum(shG) ? shG <= 0.01 : null)
    ];
    P.fisher = {name:"Philip Fisher", style:"Long-term growth · 1950s–90s", tests,
      intro:"Based on the measurable parts of Fisher’s 15 points from Common Stocks and Uncommon Profits. Most of his points were about people and products, which he researched by “scuttlebutt”: talking to customers, suppliers and competitors.",
      extras:[["R&D spending (FY)", money(y0.rnd)]],
      homework:["Does management talk openly about problems, not just good news?", "Does the company have a sales team and products customers truly prefer?", "What do competitors and suppliers say about it?"]};
  }

  /* Greenblatt */
  {
    const tests = [
      T("Cheap", "Earnings yield ≥ 8%", "Operating profit (EBIT) divided by enterprise value: what the whole business earns compared with what it costs to buy it, debt included.", pct(m.ey), m.mcap ? (isNum(m.ey) ? m.ey >= 0.08 : (isNum(m.ev) && m.ev <= 0 ? true : null)) : null),
      T("Good business", "Return on capital ≥ 25%", "EBIT divided by the working capital and equipment the business needs. High numbers mean it makes a lot from a little.", pct(m.roc), isNum(m.roc) ? m.roc >= 0.25 : null)
    ];
    P.greenblatt = {name:"Joel Greenblatt", style:"The Magic Formula · 1985–", tests,
      intro:"From The Little Book That Beats the Market: rank stocks by how cheap they are and how good the business is, and buy the ones that score well on both. Greenblatt left out banks and utilities, whose numbers don’t fit the formula.",
      extras:[["EBIT (FY)", money(m.ebit)], ["Enterprise value", money(m.ev)]]};
  }

  /* Piotroski */
  {
    const begin1 = y1.assets ?? y0.assets, begin2 = y2.assets ?? y1.assets;
    const roa0 = div(y0.netIncome, begin1), roa1 = div(y1.netIncome, begin2);
    const lt0 = y0.ltDebt ?? (y0.assets != null ? 0 : null), lt1 = y1.ltDebt ?? (y1.assets != null ? 0 : null);
    const lev0 = div(lt0, avg([y0.assets, y1.assets])), lev1 = div(lt1, avg([y1.assets, y2.assets ?? y1.assets]));
    const cr0 = div(y0.curAssets, y0.curLiab), cr1 = div(y1.curAssets, y1.curLiab);
    const at0 = div(y0.revenue, begin1), at1 = div(y1.revenue, begin2);
    const g0 = gm(y0), g1 = gm(y1);
    const both = (a, b) => isNum(a) && isNum(b);
    const tests = [
      T("Profitable", "Return on assets > 0", "Is the company making money at all?", pct(roa0), isNum(roa0) ? roa0 > 0 : null),
      T("Cash coming in", "Operating cash flow > 0", "Profits should show up as real cash.", money(y0.cfo), isNum(y0.cfo) ? y0.cfo > 0 : null),
      T("Getting more profitable", "ROA up from last year", "Improvement matters more than the level.", both(roa0, roa1) ? `${pct(roa1)} → ${pct(roa0)}` : "—", both(roa0, roa1) ? roa0 > roa1 : null),
      T("Earnings are real", "Cash flow > net income", "When cash beats reported profit, accounting tricks are less likely.", `${money(y0.cfo)} vs ${money(y0.netIncome)}`, both(y0.cfo, y0.netIncome) ? y0.cfo > y0.netIncome : null),
      T("Less debt", "Long-term debt ÷ assets went down", "Borrowing less (or not at all) is a sign of strength.", both(lev0, lev1) ? `${pct(lev1)} → ${pct(lev0)}` : "—", both(lev0, lev1) ? (lev0 < lev1 || (lev0 === 0 && lev1 === 0)) : null),
      T("Better able to pay bills", "Current ratio went up", "More short-term breathing room than a year ago.", both(cr0, cr1) ? `${num(cr1, 2)} → ${num(cr0, 2)}` : "—", both(cr0, cr1) ? cr0 > cr1 : null),
      T("No new shares", "Share count didn’t rise", "Healthy companies don’t need to sell more stock to raise money.", both(y0.dilShares, y1.dilShares) ? `${num(y1.dilShares/1e6)}M → ${num(y0.dilShares/1e6)}M` : "—", both(y0.dilShares, y1.dilShares) ? y0.dilShares <= y1.dilShares : null),
      T("Better margins", "Gross margin went up", "Rising margins suggest pricing power or lower costs.", both(g0, g1) ? `${pct(g1)} → ${pct(g0)}` : "—", both(g0, g1) ? g0 > g1 : null),
      T("Using assets better", "Asset turnover went up", "More sales from each dollar of assets.", both(at0, at1) ? `${num(at1, 2)} → ${num(at0, 2)}` : "—", both(at0, at1) ? at0 > at1 : null)
    ];
    P.piotroski = {name:"Joseph Piotroski", style:"The F-Score · 2000–", tests,
      intro:"A Stanford accounting professor’s nine yes-or-no checks, comparing the latest year with the one before. A score of 8–9 signals strong, improving finances; 0–2 signals trouble. It doesn’t use the stock price at all.",
      extras:[["Compares", y1.end ? `${fyLabel(y1)} → ${fyLabel(y0)}` : "Needs two years of data"]]};
  }

  /* Slegers: his 18-point quality checklist */
  {
    const five = Y.slice(0, Math.min(5, Y.length));
    const taxRate = y => { const r = (y.pretax > 0 && isNum(y.netIncome)) ? 1 - y.netIncome / y.pretax : null; return (isNum(r) && r >= 0 && r <= 0.5) ? r : 0.21; };
    const roic = y => {
      const ebit = y.opIncome ?? (isNum(y.pretax) ? y.pretax + (y.interest || 0) : null);
      const d = debtOf(y);
      const ic = (isNum(y.equity) && isNum(d)) ? y.equity + d - (y.cash || 0) - (y.sti || 0) : null;
      return (isNum(ebit) && ic > 0) ? ebit * (1 - taxRate(y)) / ic : null;
    };
    const roicNow = roic(y0);
    const roics = Y.slice(0, 3).map(roic).filter(isNum);
    const roicAvg = roics.length ? avg(roics) : null;
    const gms = five.map(gm).filter(isNum);
    const gmMin = gms.length ? Math.min(...gms) : null, gmNow = gm(y0);
    const negEq = isNum(y0.equity) && y0.equity <= 0;
    const r0 = roe(y0);
    const ni0 = y0.netIncome;
    // Balance sheet
    const cov = (isNum(m.ebit) && y0.interest > 0) ? m.ebit / y0.interest : null;
    let covVal = "—", covCond = null;
    if (m.debt === 0){ covVal = "No debt"; covCond = true; }
    else if (isNum(cov)){ covVal = num(cov) + "×"; covCond = cov > 15; }
    else if (y0.interest === 0){ covVal = "No interest paid"; covCond = true; }
    const fcf0 = isNum(y0.cfo) ? y0.cfo - (y0.capex || 0) : null;
    const netDebt = isNum(m.debt) ? m.debt - m.cashAll : null;
    let ndVal = "—", ndCond = null;
    if (isNum(netDebt) && netDebt <= 0){ ndVal = "Net cash"; ndCond = true; }
    else if (isNum(netDebt) && isNum(fcf0)){ if (fcf0 > 0){ const r = netDebt / fcf0; ndVal = num(r) + "×"; ndCond = r < 4; } else { ndVal = "Negative FCF"; ndCond = false; } }
    const gw = isNum(y0.assets) ? (y0.goodwill || 0) / y0.assets : null;
    // Capital needs
    const capexSales = div(y0.capex, y0.revenue);
    let coVal = "—", coCond = null;
    if (isNum(y0.capex) && isNum(y0.cfo)){ if (y0.cfo > 0){ const r = y0.capex / y0.cfo; coVal = pct(r, 0); coCond = r < 0.25; } else { coVal = "Negative cash flow"; coCond = false; } }
    // Profitability
    const nm = div(ni0, y0.revenue);
    let convVal = "—", convCond = null;
    const convYears = five.filter(y => isNum(y.netIncome) && isNum(y.cfo));
    if (convYears.length >= 3){
      if (convYears.some(y => y.netIncome <= 0)){ convVal = "Loss year(s)"; convCond = false; }
      else { const r = avg(convYears.map(y => (y.cfo - (y.capex || 0)) / y.netIncome)); convVal = pct(r, 0); convCond = r > 0.8; }
    }
    let sbcVal = "Not reported", sbcCond = null;
    if (isNum(y0.sbc) && isNum(ni0)){ if (ni0 > 0){ const r = y0.sbc / ni0; sbcVal = pct(r); sbcCond = r < 0.10; } else { sbcVal = "Losing money"; sbcCond = false; } }
    // Forecasts (typed in by the user)
    const E = D.est || {};
    const two = (a, b) => isNum(a) && isNum(b) ? Math.sqrt((1 + a/100) * (1 + b/100)) - 1 : (isNum(a) ? a/100 : (isNum(b) ? b/100 : null));
    const fRev = two(E.rev1, E.rev2), fEps = two(E.eps1, E.eps2), fLt = isNum(E.lt) ? E.lt / 100 : null;
    const fVal = v => isNum(v) ? pct(v) + " a year" : "Enter below";
    const tests = [
      T("1. Gross margin", "> 40%", "Sustainable competitive advantage: high gross margins show customers will pay up for the product.", pct(gmNow), isNum(gmNow) ? gmNow > 0.40 : null),
      T("2. Return on invested capital", "> 15%", "Sustainable competitive advantage: after-tax operating profit compared with all the money (equity and debt) tied up in the business.", pct(roicNow), isNum(roicNow) ? roicNow > 0.15 : null),
      T("3. Interest coverage", "> 15×", "Healthy balance sheet: operating profit divided by interest owed. High numbers mean debt is no threat.", covVal, covCond),
      T("4. Net debt ÷ free cash flow", "< 4×", "Healthy balance sheet: how many years of free cash flow it would take to pay off debt (after subtracting cash).", ndVal, ndCond),
      T("5. Goodwill ÷ assets", "< 20%", "Healthy balance sheet: goodwill is what a company overpaid in acquisitions. Too much of it can mean growth was bought, not built.", isNum(gw) ? pct(gw) + (y0.goodwill == null ? " (none reported)" : "") : "—", isNum(gw) ? gw < 0.20 : null),
      T("6. Capital spending ÷ sales", "< 5%", "Capital needs: the less a company must spend on equipment and buildings, the more it can put toward growth.", pct(capexSales), isNum(capexSales) ? capexSales < 0.05 : null),
      T("7. Capital spending ÷ operating cash flow", "< 25%", "Capital needs: how much of the cash the business brings in has to go right back into keeping it running.", coVal, coCond),
      T("8. Return on equity", "> 20%", "Capital allocation: how much profit management earns on the owners’ money.", negEq ? "Negative equity" : pct(r0), negEq ? null : (isNum(r0) ? r0 > 0.20 : null)),
      T("9. Return on invested capital", "> 15%", "Capital allocation: whether money management reinvests right now earns a high return.", pct(roicNow), isNum(roicNow) ? roicNow > 0.15 : null),
      T("10. Gross profit margin", "> 40%", "Profitability: what’s left of each sales dollar after the direct cost of making the product.", pct(gmNow), isNum(gmNow) ? gmNow > 0.40 : null),
      T("11. Net profit margin", "> 10%", "Profitability: how much of each sales dollar becomes profit for owners.", pct(nm), isNum(nm) ? nm > 0.10 : null),
      T("12. Free cash flow ÷ net income", "> 80%, 5-yr average", "Profitability: are reported profits turning into real cash? Slegers says cash flow matters more than earnings.", convVal, convCond),
      T("13. Stock pay ÷ net income", "< 10%", "Stock-based compensation: paying employees in stock is a real cost to owners, because it creates new shares.", sbcVal, sbcCond),
      T("14. Revenue growth, past 5 yrs", "> 5% a year", "Did the company grow? Sales growth is the engine behind long-term stock returns.", isNum(m.revG) ? pct(m.revG) + " a year" : "—", isNum(m.revG) ? m.revG > 0.05 : null),
      T("15. EPS growth, past 5 yrs", "> 7% a year", "Did the company grow? Over time, a stock tends to follow its earnings per share.", isNum(m.epsG) ? pct(m.epsG) + " a year" : "—", isNum(m.epsG) ? m.epsG > 0.07 : null),
      T("16. Expected revenue growth, next 2 yrs", "> 5% a year", "Does the future look bright? Analysts’ sales forecasts (you type these in below).", fVal(fRev), isNum(fRev) ? fRev > 0.05 : null),
      T("17. Expected EPS growth, next 2 yrs", "> 7% a year", "Does the future look bright? Analysts’ earnings forecasts (you type these in below).", fVal(fEps), isNum(fEps) ? fEps > 0.07 : null),
      T("18. Long-term EPS growth estimate", "> 7% a year", "Does the future look bright? Analysts’ long-term earnings growth forecast (you type this in below).", fVal(fLt), isNum(fLt) ? fLt > 0.07 : null)
    ];
    const expRet = (isNum(m.epsG) && isNum(m.yld)) ? m.epsG + m.yld : null;
    P.slegers = {name:"Pieter Slegers", style:"Quality compounding · 2020s–", tests,
      intro:"Slegers’ 18-point quality checklist, grouped into seven questions: Does it have a lasting advantage? A healthy balance sheet? Does it need much capital? Is capital allocated well? Is it profitable? Is stock pay under control? Is it growing, and does the future look bright? Gross margin and ROIC appear twice because each one answers two of his questions. Points 16–18 need analysts’ forecasts, which aren’t in SEC filings; type them into the box below.",
      extras:[["P/E (price is judged separately from his 18 points)", num(m.pe)], ["His expected-return math (EPS growth + dividend yield, if the P/E stays put)", isNum(expRet) ? pct(expRet) + " a year" : "—"], ["Free cash flow (FY)", money(fcf0)]],
      homework:["Is it founder-led, or do insiders own a big stake? Slegers calls this “skin in the game.” Check the company’s proxy statement (DEF 14A) on the SEC site.", "Can you explain in a sentence or two how the company makes money? If not, it’s outside your circle of competence."]};
  }

  /* Neff */
  {
    const g = isNum(m.epsG) ? m.epsG * 100 : null;
    const yPct = isNum(m.yld) ? m.yld * 100 : null;
    const trr = (isNum(m.pe) && isNum(g) && isNum(yPct)) ? (g + yPct) / m.pe : null;
    const fcfs = Y.slice(0, 3).map(y => isNum(y.cfo) ? y.cfo - (y.capex || 0) : null).filter(isNum);
    const e = Y.slice(0, 6).map(eps);
    let ups = 0, comps = 0;
    for (let i = 0; i < e.length - 1; i++) if (isNum(e[i]) && isNum(e[i+1])) { comps++; if (e[i] > e[i+1]) ups++; }
    let peCond = null, peVal = "—";
    if (m.mcap){ if (m.eps0 > 0){ peCond = m.pe <= 12; peVal = num(m.pe); } else if (isNum(m.eps0)){ peCond = false; peVal = "Losing money"; } }
    const tests = [
      T("Low price vs. earnings", "P/E ≤ 12", "Neff bought stocks other investors were ignoring, usually at P/Es far below the market’s. 12 stands in for “well below the market.”", peVal, peCond),
      T("Steady, not frantic, growth", "EPS growth 7%–20% a year", "He wanted real growth but distrusted very fast growers, which he thought rarely last.", isNum(g) ? num(g) + "% a year" : "—", isNum(g) ? (g >= 7 && g <= 20) : null),
      T("Dividend protection", "Dividend yield ≥ 2%", "A solid dividend pays you while you wait and cushions the stock if the market falls.", pct(m.yld), (m.mcap && isNum(m.yld)) ? m.yld >= 0.02 : null),
      T("Total return ratio", "(Growth + yield) ÷ P/E ≥ 2", "Neff’s signature measure. He looked for stocks scoring about twice the market’s ratio.", isNum(trr) ? num(trr, 2) : "—", isNum(trr) ? trr >= 2 : (peCond === false ? false : null)),
      T("Strong free cash flow", "Positive free cash flow each of last 3 yrs", "Cash left over after investing in the business backs up the dividend and the earnings.", fcfs.length ? fcfs.map(v => money(v)).join(", ") : "—", fcfs.length >= 2 ? fcfs.every(v => v > 0) : null),
      T("Earnings keep climbing", "EPS up in 3+ of the last 5 years", "Neff wanted a solid case that earnings would keep growing, not a one-year blip.", comps ? `${ups} of ${comps} yrs` : "—", comps >= 3 ? ups >= Math.min(3, comps - 1) : null)
    ];
    P.neff = {name:"John Neff", style:"Low-P/E value · 1964–95", tests,
      intro:"From John Neff on Investing: buy solid, growing companies when they’re out of favor and cheap, collect a good dividend while you wait, and sell once other investors catch on.",
      extras:[["5-yr EPS growth", isNum(g) ? num(g) + "% a year" : "—"], ["Dividend yield", pct(m.yld)]],
      homework:["Why is this stock unpopular right now? Neff wanted a temporary problem, not a broken business.", "Is it a cyclical company (autos, steel, airlines)? Neff bought those only when he could see earnings starting to recover."]};
  }

  return {m, P};
}

const LINES = {
  graham:{buy:"The numbers give me a real margin of safety.", watch:"Sound enough, but I’d want a cheaper price or a sturdier balance sheet.", skeptical:"Too much of this price rests on hope rather than assets.", walk:"At this price, this is speculation, not investment."},
  buffett:{buy:"A wonderful business at a sensible price. I’d be glad to own it for decades.", watch:"I like parts of this business. I’d wait for a better price or more proof.", skeptical:"I’m not convinced this business can defend its profits.", walk:"Not the kind of business I’d want to own forever."},
  lynch:{buy:"Growth at a reasonable price. This is a story I’d buy.", watch:"Decent story. I’d check the next couple of quarters first.", skeptical:"You’re paying a lot for the growth you’re getting.", walk:"The story doesn’t add up on the numbers."},
  fisher:{buy:"A real growth company. Now go talk to its customers and competitors.", watch:"Promising, but I’d want to know more about management and what’s coming next.", skeptical:"I don’t see the long runway of growth I look for.", walk:"Not the kind of outstanding company I’d hold for years."},
  greenblatt:{buy:"Good business, bargain price. The formula likes it.", watch:"Passes half the formula: good or cheap, but not both.", skeptical:"Passes half the formula: good or cheap, but not both.", walk:"Neither cheap nor especially good. The formula would skip it."},
  piotroski:{buy:"Financial health is strong and getting stronger.", watch:"Mixed signals: some fundamentals improving, some slipping.", skeptical:"More things are getting worse than better.", walk:"Weak and weakening fundamentals."},
  slegers:{buy:"A true quality compounder at a fair price. Let time do the work.", watch:"The quality is there, but I’d want a wider moat or a better price.", skeptical:"Too few signs of a business that compounds year after year.", walk:"Not a quality compounder. Say no fast and move on."},
  neff:{buy:"Solid company, cheap price, good dividend. Exactly what I like to buy when nobody else wants it.", watch:"Some of what I look for, but the price or the dividend isn’t quite there.", skeptical:"Too pricey for the growth and dividend you get.", walk:"Popular and priced for it. I’ll look elsewhere."}
};
const BIO = {
  graham:{bio:"The “father of value investing,” he taught Warren Buffett and wrote The Intelligent Investor.", worked:"Graham-Newman Corporation (his own firm) and Columbia Business School"},
  buffett:{bio:"Graham’s most famous student, he ran Berkshire Hathaway as CEO for 60 years and turned it into one of the world’s biggest companies.", worked:"Graham-Newman, then Berkshire Hathaway (CEO 1965–2025, now chairman emeritus)"},
  lynch:{bio:"He grew Fidelity’s Magellan Fund into the largest mutual fund in the world by buying companies he could understand.", worked:"Fidelity Investments (Magellan Fund manager, 1977–1990)"},
  fisher:{bio:"A pioneer of growth investing who bought outstanding companies and held them for decades.", worked:"Fisher & Company, the San Francisco money-management firm he founded in 1931"},
  greenblatt:{bio:"A hedge-fund manager who boiled value investing down to a simple two-number formula.", worked:"Gotham Capital (founded 1985) and Columbia Business School"},
  piotroski:{bio:"An accounting professor who created a nine-point test to tell strong cheap stocks from weak ones.", worked:"University of Chicago (where he published the F-Score in 2000), now Stanford Graduate School of Business"},
  slegers:{bio:"A Belgian investor who writes one of the most-read investing newsletters about buying high-quality companies.", worked:"A Belgian asset-management firm, then Compounding Quality, the newsletter he founded"},
  neff:{bio:"He beat the market for three decades by buying solid companies that other investors had given up on.", worked:"Wellington Management, where he ran Vanguard’s Windsor Fund from 1964 to 1995"}
};
const VLABEL = {buy:"Would buy", watch:"Interested", skeptical:"Skeptical", walk:"Would pass", nd:"Not enough data", index:"Buy the index"};
const vOf = inv => inv.bogle ? {key:"index", p:"—", n:""} : verdict(inv.tests);
function verdict(tests){
  const scored = tests.filter(t => t.st !== "na"), p = scored.filter(t => t.st === "pass").length;
  if (scored.length < Math.ceil(tests.length / 2)) return {key:"nd", p, n:scored.length};
  const r = p / scored.length;
  return {key: r >= .8 ? "buy" : r >= .5 ? "watch" : r >= .3 ? "skeptical" : "walk", p, n:scored.length};
}


const ORDER = ["graham","buffett","lynch","fisher","greenblatt","piotroski","slegers","neff"];

const API = {CONCEPTS, extract, analyze, verdict, vOf, origOf, ORDER, LINES, BIO, VLABEL,
  isNum, div, avg, cagr, money, pct, num, usd, fyLabel, esc, CPI_1973};
if (typeof module === "object" && module.exports) module.exports = API;
else root.PanelCore = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
