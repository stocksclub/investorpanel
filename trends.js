(function(){
"use strict";
const C = PanelCore, UI = PanelUI;
const {ORDER, CHARTS, esc} = C;
const $ = s => document.querySelector(s);
const settings = UI.loadSettings();
const q = new URLSearchParams(location.search);
const state = {t:"", inv:ORDER.includes(q.get("inv")) ? q.get("inv") : "graham", cmp:"", co:null, coSeries:null};
let SECTORS = [], timer = null;
// Size-based numbers (dollars, per-share amounts, share counts) can’t be compared with a whole sector.
const ABS = new Set(["revenue", "eps", "dps", "cfo", "fcf", "sharesM", "netCashPS"]);
const normTicker = t => t.trim().toUpperCase().replace(/[./]/g, "-");
const status = $("#status");

function sectorSeries(){
  const sec = SECTORS.find(x => x.name === state.cmp && x.used);
  if (!sec) return null;
  if (!sec._series) sec._series = C.trendSeries(sec.D, sec.ph, settings);
  return {sec, series:sec._series};
}

function render(){
  if (!state.co) return;
  $("#out").classList.remove("hidden");
  $("#coName").textContent = `${state.co.n} (${state.co.t})`;
  $("#picker").innerHTML = ORDER.map(k => `<button type="button" data-k="${k}" aria-pressed="${k === state.inv}">${UI.avatar(k)}${esc(UI.nameOf(k))}</button>`).join("");
  $("#picker").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    state.inv = b.dataset.k; render();
    history.replaceState(null, "", `?t=${encodeURIComponent(state.co.t)}&inv=${state.inv}`);
  }));
  const S = state.coSeries, ss = sectorSeries();
  const years = [...new Set(S.map(r => r.year).concat(ss ? ss.series.map(r => r.year) : []))].sort((a, b) => a - b);
  const labels = years.map(String);
  const pick = (series, fn) => years.map(y => { const r = series.find(x => x.year === y); return r ? fn(r) : null; });
  const secName = ss ? `${ss.sec.name} sector${ss.sec.etf ? ` (like ${ss.sec.etf})` : ""}` : "";
  $("#legend").innerHTML = `<span><i class="co"></i>${esc(state.co.t)}</span>` + (ss ? `<span><i class="sec"></i>${esc(secName)}</span>` : "") + `<span><i class="rl"></i>${esc(UI.nameOf(state.inv))}’s line</span>`;

  const scoreSeries = [{name:state.co.t, cls:"co", values:pick(S, r => r.scores[state.inv])}];
  if (ss) scoreSeries.push({name:secName, cls:"sec", values:pick(ss.series, r => r.scores[state.inv])});
  $("#scoreChart").innerHTML = UI.lineChart(labels, scoreSeries, null, "pct");

  $("#charts").innerHTML = CHARTS[state.inv].map(ch => {
    const rule = typeof ch.rule === "function" ? ch.rule(settings) : ch.rule;
    const series = [{name:state.co.t, cls:"co", values:pick(S, r => r.m[ch.k])}];
    const abs = ABS.has(ch.k);
    if (ss && !abs) series.push({name:secName, cls:"sec", values:pick(ss.series, r => r.m[ch.k])});
    const ruleText = C.isNum(rule) ? `His line: ${ch.dir === "below" ? "at most" : "at least"} ${UI.fmtVal(rule, ch.f)}` : "No set line; watch the trend";
    return `<div class="chart-card"><h3 class="chart-title">${esc(ch.l)}</h3><p class="tiny" style="margin:0 0 4px">${esc(ruleText)}${ss && abs ? ". Dollar and share totals aren’t comparable with a whole sector, so no sector line." : ""}</p>${UI.lineChart(labels, series, rule, ch.f)}</div>`;
  }).join("");
  $("#priceNote").textContent = state.co.ph && state.co.ph.some(C.isNum) ? "" : "There’s no price history for this company, so price-based charts (like P/E) are empty. Price history covers S&P 500, Nasdaq-100 and Dow companies.";
}

async function load(t){
  const co = await UI.fetchJSON(`data/co/${encodeURIComponent(t)}.json`);
  if (normTicker($("#ticker").value) !== t) return;
  if (!co){ status.className = "status"; status.textContent = `${t} isn’t in the site’s data.`; return; }
  state.co = co; state.coSeries = C.trendSeries(co.D, co.ph, settings);
  if (co.s && SECTORS.some(x => x.name === co.s && x.used)){ state.cmp = co.s; $("#cmpSector").value = co.s; }
  status.className = "status ok";
  status.textContent = `${co.D.years.length} years of annual reports, ${co.D.years[co.D.years.length - 1].end.slice(0, 4)}–${co.D.years[0].end.slice(0, 4)}.`;
  history.replaceState(null, "", `?t=${encodeURIComponent(t)}&inv=${state.inv}`);
  render();
}
$("#ticker").addEventListener("input", () => {
  const t = normTicker($("#ticker").value);
  clearTimeout(timer);
  if (t) timer = setTimeout(() => load(t), 350);
});
$("#cmpSector").addEventListener("change", e => { state.cmp = e.target.value; render(); });
// Lets other pages (and the Claude preview) open a company and investor directly.
window.TrendsPage = {open(t, inv){ if (ORDER.includes(inv)) state.inv = inv; $("#ticker").value = t; load(normTicker(t)); }};

UI.fetchJSON("data/sectors.json").then(sec => {
  SECTORS = (sec && sec.sectors) || [];
  $("#cmpSector").innerHTML = `<option value="">No comparison</option>` + SECTORS.filter(x => x.used).map(x => `<option value="${esc(x.name)}">${esc(x.name)}${x.etf ? ` (like ${esc(x.etf)})` : ""}</option>`).join("");
  const t = q.get("t");
  if (t){ $("#ticker").value = t.toUpperCase(); load(normTicker(t)); }
});
})();
