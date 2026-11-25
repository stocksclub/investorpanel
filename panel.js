(function(){
"use strict";
const C = PanelCore, UI = PanelUI;
const {extract, analyze, verdict, ORDER, VLABEL, isNum, div, money, pct, num, fyLabel, esc} = C;
const $ = s => document.querySelector(s);
/* ---------- Known tickers (CIK). The company name from the file is shown so you can confirm. ---------- */
const CIKS = {AAPL:320193,MSFT:789019,AMZN:1018724,GOOGL:1652044,GOOG:1652044,META:1326801,NVDA:1045810,TSLA:1318605,"BRK-B":1067983,"BRK.B":1067983,BRK:1067983,JPM:19617,JNJ:200406,KO:21344,PEP:77476,WMT:104169,COST:909832,PG:80424,DIS:1744489,MCD:63908,NKE:320187,SBUX:829224,HD:354950,V:1403161,MA:1141391,NFLX:1065280,INTC:50863,AMD:2488,XOM:34088,CVX:93410,T:732717,VZ:732712,TGT:27419,BA:12927,CAT:18230,IBM:51143,ORCL:1341439,CSCO:858877,ADBE:796343,CRM:1108524,PFE:78003,MRK:310158,ABBV:1551152,LLY:59478,UNH:731766,F:37996,GM:1467858,HSY:47111,CMG:1058090,LULU:1397187,RBLX:1315098,UBER:1543151,ABNB:1559720,PYPL:1633917,GME:1326380,MO:764180,PM:1413329,MU:723125};

/* ---------- State ---------- */
let D = null;
const settings = UI.loadSettings();
const state = {price:null, tsy:settings.tsy, cpi:settings.cpi, sel:"graham", ticker:"", cmp:""};
let META = null, SECTORS = [];      // summary of the site's company data, if it has been built
let siteTicker = "";  // ticker currently loaded from that data
const coCache = {};
let lookTimer = null;
const normTicker = t => t.trim().toUpperCase().replace(/[./]/g, "-");
const KEY = "investorPanel.saved.v1";
function loadSaved(){ try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; } catch(e){ return []; } }
function storeSaved(list){ try { localStorage.setItem(KEY, JSON.stringify(list)); } catch(e){} }

let lastResult = null;

function render(){
  if (!D) return;
  $("#results").classList.remove("hidden");
  const {m, P} = analyze(D, {price:state.price, tsy:state.tsy, cpi:state.cpi});
  const y0 = D.years[0];
  lastResult = {m, P};
  $("#coName").textContent = D.name + (state.ticker ? ` (${state.ticker})` : "");
  $("#facts").innerHTML = [
    ["Data through", fyLabel(y0)],
    ["Revenue", money(y0.revenue)],
    ["Net income", money(y0.netIncome)],
    ["Market value", money(m.mcap)],
    ["P/E", num(m.pe)],
    ["P/B", num(m.pb)],
    ["Years on file", String(D.years.length)]
  ].map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join("");
  $("#priceNotice").classList.toggle("hidden", !!m.mcap);

  const sec = SECTORS.find(x => x.name === state.cmp && x.used);
  const cmp = sec ? {label:`${sec.name} sector${sec.etf ? ` (like ${sec.etf})` : ""}`, short:sec.etf ? `Sector (${sec.etf})` : "Sector",
    P:analyze(sec.D, {price:sec.price, tsy:state.tsy, cpi:state.cpi}).P} : null;
  UI.renderPanel($("#judges"), $("#detail"), P, state.sel, k => { state.sel = k; render(); },
    {cmp, trendsHref: siteTicker ? k => `trends.html?t=${encodeURIComponent(siteTicker)}&inv=${k}` : null});
  renderEdit();
  $("#estBox").classList.toggle("hidden", state.sel !== "slegers");
  const est = D.est || {};
  document.querySelectorAll("#estBox input").forEach(inp => { if (document.activeElement !== inp) inp.value = isNum(est[inp.dataset.e]) ? est[inp.dataset.e] : ""; });
}
document.querySelectorAll("#estBox input").forEach(inp => inp.addEventListener("input", () => {
  if (!D) return;
  D.est = D.est || {};
  const v = parseFloat(inp.value);
  D.est[inp.dataset.e] = isFinite(v) ? v : null;
  render();
}));

const FIELDS = [
  ["revenue","Revenue","M"],["costRev","Cost of revenue","M"],["grossProfit","Gross profit","M"],["opIncome","Operating income (EBIT)","M"],
  ["pretax","Pre-tax income","M"],["interest","Interest expense","M"],["netIncome","Net income","M"],["eps","EPS, diluted","ps"],
  ["dilShares","Diluted shares (millions)","sh"],["cfo","Operating cash flow","M"],["capex","Capital spending","M"],["da","Depreciation & amortization","M"],
  ["divPaid","Dividends paid","M"],["dps","Dividends per share","ps"],["rnd","R&D expense","M"],["assets","Total assets","M"],
  ["curAssets","Current assets","M"],["curLiab","Current liabilities","M"],["liabilities","Total liabilities","M"],["equity","Shareholders’ equity","M"],
  ["ltDebt","Long-term debt","M"],["stDebt","Short-term debt","M"],["cash","Cash","M"],["sti","Short-term investments","M"],
  ["ppe","Property & equipment, net","M"],["inventory","Inventory","M"],["goodwill","Goodwill","M"],["sbc","Stock-based compensation","M"]
];
let editBuilt = false;
function renderEdit(){
  const ys = D.years.slice(0, 3);
  $("#sharesIn").value = D.sharesOut ? +(D.sharesOut / 1e6).toFixed(3) : "";
  if (editBuilt && document.activeElement && document.activeElement.closest("#editTable")) return;
  const fmt = (v, u) => !isNum(v) ? "" : u === "ps" ? +v.toFixed(4) : +(v / 1e6).toFixed(2);
  $("#editTable").innerHTML = `<thead><tr><th>Item</th>${ys.map(y => `<th>${fyLabel(y)}</th>`).join("")}</tr></thead><tbody>` +
    FIELDS.map(([k, label, u]) => `<tr><td>${esc(label)}</td>${ys.map((y, i) => `<td><input type="number" step="any" data-k="${k}" data-i="${i}" data-u="${u}" value="${fmt(y[k], u)}" aria-label="${esc(label)} ${fyLabel(y)}"></td>`).join("")}</tr>`).join("") + "</tbody>";
  editBuilt = true;
}
$("#editTable").addEventListener("change", e => {
  const t = e.target; if (!t.dataset.k) return;
  const raw = t.value.trim(), u = t.dataset.u;
  D.years[+t.dataset.i][t.dataset.k] = raw === "" ? null : (u === "ps" ? +raw : +raw * 1e6);
  editBuilt = false; render();
});
$("#sharesIn").addEventListener("change", e => { const v = e.target.value.trim(); D.sharesOut = v === "" ? null : +v * 1e6; render(); });

/* ---------- Inputs ---------- */
function syncLinks(){
  const tk = $("#ticker").value.trim().toUpperCase();
  state.ticker = tk;
  if (tk && CIKS[tk] && !$("#cik").dataset.manual) $("#cik").value = CIKS[tk];
  else if (tk && !CIKS[tk] && !$("#cik").dataset.manual) $("#cik").value = "";
  const cik = $("#cik").value.replace(/\D/g, "");
  const link = $("#secLink");
  if (cik){
    link.href = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`;
    link.setAttribute("aria-disabled", "false");
  } else { link.href = "#"; link.setAttribute("aria-disabled", "true"); }
  const help = $("#cikHelp");
  if (tk && !cik) help.innerHTML = `Not in the quick list. <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(tk)}&type=10-K" target="_blank" rel="noopener">Find ${esc(tk)}’s CIK on SEC.gov</a> (use the number after “CIK#”, not the SIC code), then type it in.`;
  else help.textContent = "Popular tickers fill in the CIK automatically.";
  $("#estLink").href = tk ? `https://finance.yahoo.com/quote/${encodeURIComponent(tk)}/analysis` : "https://finance.yahoo.com/";
  $("#quoteLink").href = tk ? `https://finance.yahoo.com/quote/${encodeURIComponent(tk)}` : "https://finance.yahoo.com/";
  if (D) $("#coName").textContent = D.name + (tk ? ` (${tk})` : "");
  if (META && tk && siteTicker !== normTicker(tk)) lookupSite(normTicker(tk));
}
// Companies the site tracks have their own small data file: load it as soon as the ticker is typed.
function lookupSite(tk){
  clearTimeout(lookTimer);
  lookTimer = setTimeout(async () => {
    const co = coCache[tk] || await UI.fetchJSON(`data/co/${encodeURIComponent(tk)}.json`);
    if (normTicker(state.ticker) !== tk) return;
    if (!co){
      status.className = "status";
      status.textContent = `${tk} isn’t in the site’s data (it may be a fund, a foreign company, or a typo). You can load it from the SEC yourself below.`;
      $("#manualBox").open = true;
      return;
    }
    coCache[tk] = co;
    loadFromSite(co);
  }, 350);
}
function loadFromSite(co){
  siteTicker = co.t;
  D = JSON.parse(JSON.stringify(co.D));
  if (!$("#cik").dataset.manual){ $("#cik").value = co.cik; }
  if (co.s && SECTORS.some(x => x.name === co.s && x.used)){ state.cmp = co.s; $("#cmpSector").value = co.s; }
  const px = co.price;
  if (isNum(px)){ state.price = px; $("#price").value = px; }
  editBuilt = false;
  status.className = "status ok";
  status.textContent = `Loaded ${D.name} from this site’s data, no download needed. Filings checked ${UI.niceDate(META.updated)}` + (isNum(px) ? `; price as of ${UI.niceDate(META.pricesUpdated)}, so update it if you have a newer one.` : ".");
  render();
}
$("#ticker").addEventListener("input", syncLinks);
$("#cik").addEventListener("input", () => { $("#cik").dataset.manual = $("#cik").value ? "1" : ""; syncLinks(); });
$("#price").addEventListener("input", e => { const v = parseFloat(e.target.value); state.price = isFinite(v) && v > 0 ? v : null; render(); });
$("#tsy").addEventListener("input", e => { const v = parseFloat(e.target.value); state.tsy = isFinite(v) ? v : 4.5; UI.saveSettings(state); render(); });
$("#cpi").addEventListener("input", e => { const v = parseFloat(e.target.value); state.cpi = isFinite(v) && v > 0 ? v : 337.511; UI.saveSettings(state); render(); });

const drop = $("#drop"), status = $("#loadStatus");
["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
$("#file").addEventListener("change", e => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ""; });

function readFile(f){
  status.className = "status"; status.textContent = `Reading ${f.name}…`;
  const r = new FileReader();
  r.onload = () => {
    try {
      let txt = String(r.result);
      // If the page was saved as HTML, pull the JSON out of it
      if (!/^\s*\{/.test(txt)){ const a = txt.indexOf("{"), b = txt.lastIndexOf("}"); if (a >= 0 && b > a) txt = txt.slice(a, b + 1).replace(/&quot;/g, '"').replace(/&amp;/g, "&"); }
      const json = JSON.parse(txt);
      D = extract(json); siteTicker = "";
      editBuilt = false;
      if (!state.ticker && json.cik && !$("#cik").value) $("#cik").value = json.cik;
      status.className = "status ok"; status.textContent = `Loaded ${D.name}: ${D.years.length} years of annual reports.`;
     
      render();
      $("#results").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"start"});
    } catch(err){
      status.className = "status err";
      status.textContent = err instanceof SyntaxError ? "That file isn’t readable SEC data. Open the SEC link, save the page as a .json file, and try again." : err.message;
    }
  };
  r.onerror = () => { status.className = "status err"; status.textContent = "The file couldn’t be read. Try choosing it again."; };
  r.readAsText(f);
}

/* ---------- Saved list ---------- */
function renderSaved(){
  const list = loadSaved();
  $("#savedSec").classList.toggle("hidden", !list.length);
  $("#savedList").innerHTML = list.map((s, i) => `<span class="chip"><button class="open" type="button" data-i="${i}">${esc(s.ticker || s.name)}</button><span class="tiny">${esc(s.savedAt)}</span><button class="x" type="button" data-del="${i}" aria-label="Remove ${esc(s.ticker || s.name)}">✕</button></span>`).join("");
}
$("#savedList").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const list = loadSaved();
  if (b.dataset.del !== undefined){ list.splice(+b.dataset.del, 1); storeSaved(list); renderSaved(); return; }
  const s = list[+b.dataset.i]; if (!s) return;
  D = {name:s.name, cik:s.cik, years:s.years, sharesOut:s.sharesOut, est:s.est || null}; siteTicker = s.ticker || "";
  $("#ticker").value = s.ticker || ""; $("#cik").value = s.cik || ""; $("#cik").dataset.manual = s.cik ? "1" : "";
  syncLinks();
  if (s.price){ $("#price").value = s.price; state.price = s.price; }
  status.className = "status ok"; status.textContent = `Opened ${s.name} from your list (saved ${s.savedAt}). Update the price to re-score.`;
  editBuilt = false; render();
  $("#results").scrollIntoView({block:"start"});
});
$("#saveBtn").addEventListener("click", () => {
  if (!D) return;
  const list = loadSaved().filter(s => !(s.cik === D.cik && s.name === D.name));
  list.unshift({name:D.name, cik:D.cik, ticker:state.ticker, years:D.years, sharesOut:D.sharesOut, est:D.est || null, price:state.price, savedAt:new Date().toLocaleDateString()});
  storeSaved(list.slice(0, 40)); renderSaved();
  $("#saveBtn").textContent = "Saved"; setTimeout(() => { $("#saveBtn").textContent = "Save to my list"; }, 1500);
});

renderSaved();
$("#tsy").value = state.tsy; $("#cpi").value = state.cpi;
const qTicker = new URLSearchParams(location.search).get("t");
if (qTicker) $("#ticker").value = qTicker.toUpperCase();
syncLinks();
$("#cmpSector").addEventListener("change", e => { state.cmp = e.target.value; if (D) render(); });
Promise.all([UI.fetchJSON("data/meta.json"), UI.fetchJSON("data/sectors.json")]).then(([meta, sec]) => {
  SECTORS = (sec && sec.sectors) || [];
  $("#cmpSector").innerHTML = `<option value="">No comparison</option>` + SECTORS.filter(x => x.used).map(x => `<option value="${esc(x.name)}">${esc(x.name)}${x.etf ? ` (like ${esc(x.etf)})` : ""}</option>`).join("");
  META = meta;
  if (META){
    $("#siteNote").textContent = `About ${META.count.toLocaleString()} U.S.-listed companies load automatically: just type the ticker. Each one is compared with its sector, built the way sector funds like XLK are.`;
    syncLinks();
  } else $("#manualBox").open = true;
});
})();
