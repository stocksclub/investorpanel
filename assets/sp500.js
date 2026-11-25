(function(){
"use strict";
const C = PanelCore, UI = PanelUI;
const {analyze, verdict, ORDER, VLABEL, isNum, money, num, pct, esc} = C;
const $ = s => document.querySelector(s);

const settings = UI.loadSettings();
const state = {tsy:settings.tsy, cpi:settings.cpi, idxSel:"graham", who:"panel", sector:"", q:"", limit:25};
let SITE = null, ROWS = [], INDEX = null;

const SUM_FIELDS = ["revenue","costRev","grossProfit","opIncome","netIncome","pretax","interest","dilShares","cfo","capex","da","divPaid","rnd","assets","curAssets","curLiab","liabilities","equity","ltDebt","stDebt","cash","sti","ppe","inventory","goodwill","sbc"];
const EXCLUDE = new Set(["Financials","Real Estate"]);
const SHORT = {graham:"Graham",buffett:"Buffett",lynch:"Lynch",fisher:"Fisher",greenblatt:"Greenblatt",piotroski:"Piotroski",slegers:"Slegers",neff:"Neff"};

/* ---------- The index as one company ---------- */
function buildIndex(){
  const members = SITE.companies.filter(c => !EXCLUDE.has(c.s) && c.D.years.length >= 11 && isNum(SITE.prices[c.t]) && c.D.sharesOut);
  if (!members.length) return null;
  const mcap = members.reduce((s, c) => s + SITE.prices[c.t] * c.D.sharesOut, 0);
  const years = [];
  for (let i = 0; i < 11; i++){
    const y = {}, yrCount = {};
    SUM_FIELDS.forEach(f => { y[f] = 0; });
    members.forEach(c => {
      const cy = c.D.years[i];
      SUM_FIELDS.forEach(f => { if (isNum(cy[f])) y[f] += cy[f]; });
      const yr = (cy.end || "").slice(0, 4); yrCount[yr] = (yrCount[yr] || 0) + 1;
    });
    const yr = Object.keys(yrCount).sort((a, b) => yrCount[b] - yrCount[a])[0];
    y.end = `${yr}-12-31`;
    // Treat the index as one company with a single share: EPS = total profit, dividends per share = total dividends.
    y.eps = y.netIncome; y.dps = y.divPaid;
    SUM_FIELDS.forEach(f => { if (y[f] === 0 && f !== "dilShares") y[f] = null; });
    years.push(y);
  }
  return {D:{name:"S&P 500 (as one company)", years, sharesOut:1}, price:mcap, count:members.length};
}

function renderIndex(){
  if (!INDEX){ $("#idxFacts").textContent = "Not enough data yet to build the index view."; return; }
  const {m, P} = analyze(INDEX.D, {price:INDEX.price, tsy:state.tsy, cpi:state.cpi});
  const y0 = INDEX.D.years[0];
  $("#idxFacts").innerHTML = [
    ["Companies included", `${INDEX.count} of ${SITE.companies.length}`],
    ["Market value", money(m.mcap)],
    ["Sales", money(y0.revenue)],
    ["Profit", money(y0.netIncome)],
    ["P/E", num(m.pe)],
    ["Dividend yield", pct(m.yld)]
  ].map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join("");
  UI.renderPanel($("#idxJudges"), $("#idxDetail"), P, state.idxSel, k => { state.idxSel = k; renderIndex(); });
}

/* ---------- Every company ---------- */
function scoreAll(){
  ROWS = SITE.companies.map(c => {
    const px = SITE.prices[c.t];
    const {m, P} = analyze(c.D, {price:isNum(px) ? px : null, tsy:state.tsy, cpi:state.cpi});
    const vs = {};
    ORDER.forEach(k => { vs[k] = verdict(P[k].tests); });
    const buys = ORDER.filter(k => vs[k].key === "buy").length, watch = ORDER.filter(k => vs[k].key === "watch").length;
    return {c, mcap:m.mcap || 0, vs, buys, watch};
  });
}
const ratio = v => (v.key === "nd" || !v.n) ? -1 : v.p / v.n;
function sorter(who){
  if (who === "panel") return (a, b) => b.buys - a.buys || b.watch - a.watch || b.mcap - a.mcap;
  return (a, b) => ratio(b.vs[who]) - ratio(a.vs[who]) || b.vs[who].p - a.vs[who].p || b.mcap - a.mcap;
}
const link = c => `index.html?t=${encodeURIComponent(c.t)}`;

function renderFavs(){
  $("#favs").innerHTML = ORDER.map(k => {
    const best = ROWS.filter(r => ratio(r.vs[k]) >= 0).sort(sorter(k))[0];
    if (!best) return "";
    const v = best.vs[k];
    return `<div class="fav"><div class="who">${esc(SHORT[k])}${SHORT[k].endsWith("s") ? "’" : "’s"} top pick</div>
      <div class="pick"><a href="${link(best.c)}">${esc(best.c.t)}</a></div>
      <div class="why">${esc(best.c.n)} · ${v.p} of ${v.n} tests</div></div>`;
  }).join("");
}

function renderBoard(){
  const q = state.q.trim().toLowerCase();
  let rows = ROWS.filter(r => (!state.sector || r.c.s === state.sector) && (!q || r.c.t.toLowerCase().includes(q) || r.c.n.toLowerCase().includes(q)));
  rows.sort(sorter(state.who));
  const total = rows.length;
  rows = rows.slice(0, state.limit);
  const panel = state.who === "panel";
  const head = `<thead><tr><th>#</th><th>Company</th><th>Sector</th><th>${panel ? "Panel votes" : "Score"}</th><th>${panel ? "Investors who would buy" : "Verdict"}</th></tr></thead>`;
  if (!rows.length){ $("#board").innerHTML = head + `<tbody><tr><td colspan="5" class="empty">No companies match.</td></tr></tbody>`; return; }
  const body = rows.map((r, i) => {
    let score, verdictCell;
    if (panel){
      score = `<div class="dots">${ORDER.map(k => `<i class="${r.vs[k].key === "buy" ? "buy" : r.vs[k].key === "watch" ? "watch" : ""}" title="${esc(SHORT[k])}: ${esc(VLABEL[r.vs[k].key])}"></i>`).join("")}</div>`;
      const names = ORDER.filter(k => r.vs[k].key === "buy").map(k => SHORT[k]);
      verdictCell = `<span class="tiny">${names.length ? esc(names.join(", ")) : "None"}${r.watch ? ` · ${r.watch} interested` : ""}</span>`;
    } else {
      const v = r.vs[state.who], w = Math.max(0, ratio(v)) * 100;
      score = `<div class="scorebar"><span class="bar"><i style="width:${w.toFixed(0)}%"></i></span>${v.p} of ${v.n}</div>`;
      verdictCell = `<span class="verdict v-${v.key}">${esc(VLABEL[v.key])}</span>`;
    }
    return `<tr><td class="rank">${i + 1}</td><td class="co"><a href="${link(r.c)}">${esc(r.c.t)}</a><span>${esc(r.c.n)}</span></td><td class="sector">${esc(r.c.s || "")}</td><td>${score}</td><td>${verdictCell}</td></tr>`;
  }).join("");
  $("#board").innerHTML = head + `<tbody>${body}</tbody>` + (total > rows.length ? `<tfoot><tr><td colspan="5" class="tiny" style="padding-top:10px">Showing ${rows.length} of ${total}.</td></tr></tfoot>` : "");
}

function renderAll(){
  INDEX = buildIndex();
  scoreAll();
  renderIndex(); renderFavs(); renderBoard();
}

/* ---------- Controls ---------- */
$("#who").innerHTML = `<option value="panel">The whole panel</option>` + ORDER.map(k => `<option value="${k}">${esc(C.BIO[k] ? SHORT[k] : k)}</option>`).join("");
$("#who").addEventListener("change", e => { state.who = e.target.value; renderBoard(); });
$("#sector").addEventListener("change", e => { state.sector = e.target.value; renderBoard(); });
$("#q").addEventListener("input", e => { state.q = e.target.value; renderBoard(); });
$("#limit").addEventListener("change", e => { state.limit = +e.target.value; renderBoard(); });
$("#tsy").value = state.tsy; $("#cpi").value = state.cpi;
let t = null;
const later = () => { clearTimeout(t); t = setTimeout(renderAll, 300); };
$("#tsy").addEventListener("input", e => { const v = parseFloat(e.target.value); state.tsy = isFinite(v) ? v : 4.5; UI.saveSettings(state); later(); });
$("#cpi").addEventListener("input", e => { const v = parseFloat(e.target.value); state.cpi = isFinite(v) && v > 0 ? v : 337.511; UI.saveSettings(state); later(); });

UI.loadSiteData().then(data => {
  const st = $("#dataStatus");
  if (!data || !data.companies.length){
    st.className = "status err";
    st.textContent = "The S&P 500 data hasn’t been built yet. If you run this site, start the “Update data and publish” workflow on GitHub (see the README).";
    return;
  }
  SITE = data;
  const sectors = [...new Set(SITE.companies.map(c => c.s).filter(Boolean))].sort();
  $("#sector").innerHTML += sectors.map(s => `<option>${esc(s)}</option>`).join("");
  st.className = "status";
  st.textContent = `${SITE.companies.length} companies. Filings checked ${UI.niceDate(SITE.updated)}; prices from ${UI.niceDate(SITE.pricesUpdated)}.`;
  $("#content").classList.remove("hidden");
  renderAll();
});
})();
