(function(){
"use strict";
const C = PanelCore, UI = PanelUI;
const {ORDER, VLABEL, esc} = C;
const $ = s => document.querySelector(s);
const VKEYS = ["buy", "watch", "skeptical", "walk", "nd"];
const SHORT = {graham:"Graham",buffett:"Buffett",lynch:"Lynch",fisher:"Fisher",greenblatt:"Greenblatt",piotroski:"Piotroski",slegers:"Slegers",neff:"Neff"};
const poss = k => SHORT[k] + (SHORT[k].endsWith("s") ? "’" : "’s");
const state = {universe:"", who:"panel", sector:"", size:"", q:"", limit:25};
let ROWS = [];

// Unpack the compact rows: v holds [passed, scored, verdict] for each investor in ORDER.
function unpack(r){
  const vs = {};
  ORDER.forEach((k, i) => { const a = r.v[i] || [0, 0, 4]; vs[k] = {p:a[0], n:a[1], key:VKEYS[a[2]] || "nd"}; });
  return {t:r.t, n:r.n, s:r.s, mc:r.mc, x:r.x || "", vs,
    buys:ORDER.filter(k => vs[k].key === "buy").length, watch:ORDER.filter(k => vs[k].key === "watch").length};
}
const ratio = v => (v.key === "nd" || !v.n) ? -1 : v.p / v.n;
const sorter = who => who === "panel"
  ? (a, b) => b.buys - a.buys || b.watch - a.watch || b.mc - a.mc
  : (a, b) => ratio(b.vs[who]) - ratio(a.vs[who]) || b.vs[who].p - a.vs[who].p || b.mc - a.mc;
const inSize = (mc, s) => !s || (s === "L" ? mc > 10e9 : s === "M" ? mc > 2e9 && mc <= 10e9 : s === "S" ? mc > 3e8 && mc <= 2e9 : mc <= 3e8);
const link = t => `score.html?t=${encodeURIComponent(t)}`;

function filtered(){
  const q = state.q.trim().toLowerCase();
  return ROWS.filter(r => (!state.universe || r.x.includes(state.universe)) && (!state.sector || r.s === state.sector) && inSize(r.mc, state.size)
    && (!q || r.t.toLowerCase().includes(q) || r.n.toLowerCase().includes(q)));
}

function render(){
  const rows = filtered();
  $("#favs").innerHTML = ORDER.map(k => {
    const best = rows.filter(r => ratio(r.vs[k]) >= 0).sort(sorter(k))[0];
    if (!best) return "";
    return `<div class="fav"><div class="who">${esc(poss(k))} top pick</div>
      <div class="pick"><a href="${link(best.t)}">${esc(best.t)}</a></div>
      <div class="why">${esc(best.n)} · ${best.vs[k].p} of ${best.vs[k].n} tests</div></div>`;
  }).join("") || `<p class="tiny">No stocks match these filters.</p>`;

  const sorted = rows.slice().sort(sorter(state.who)), shown = sorted.slice(0, state.limit);
  const panel = state.who === "panel";
  const head = `<thead><tr><th>#</th><th>Company</th><th>Sector</th><th>Size</th><th>${panel ? "Panel votes" : "Score"}</th><th>${panel ? "Investors who would buy" : "Verdict"}</th><th><span class="hidden">Charts</span></th></tr></thead>`;
  if (!shown.length){ $("#board").innerHTML = head + `<tbody><tr><td colspan="7" class="empty">No companies match.</td></tr></tbody>`; return; }
  const body = shown.map((r, i) => {
    let score, verdict;
    if (panel){
      score = `<div class="dots">${ORDER.map(k => `<i class="${r.vs[k].key === "buy" ? "buy" : r.vs[k].key === "watch" ? "watch" : ""}" title="${esc(SHORT[k])}: ${esc(VLABEL[r.vs[k].key])}"></i>`).join("")}</div>`;
      const names = ORDER.filter(k => r.vs[k].key === "buy").map(k => SHORT[k]);
      verdict = `<span class="tiny">${names.length ? esc(names.join(", ")) : "None"}${r.watch ? ` · ${r.watch} interested` : ""}</span>`;
    } else {
      const v = r.vs[state.who], w = Math.max(0, ratio(v)) * 100;
      score = `<div class="scorebar"><span class="bar"><i style="width:${w.toFixed(0)}%"></i></span>${v.p} of ${v.n}</div>`;
      verdict = `<span class="verdict v-${v.key}">${esc(VLABEL[v.key])}</span>`;
    }
    return `<tr><td class="rank">${i + 1}</td><td class="co"><a href="${link(r.t)}">${esc(r.t)}</a><span>${esc(r.n)}</span></td><td class="sector">${esc(r.s)}</td><td class="sector">${esc(C.money(r.mc))}</td><td>${score}</td><td>${verdict}</td><td><a class="mini" href="trends.html?t=${encodeURIComponent(r.t)}${panel ? "" : "&inv=" + state.who}" aria-label="Trends for ${esc(r.t)}">Trends →</a></td></tr>`;
  }).join("");
  $("#board").innerHTML = head + `<tbody>${body}</tbody>` + (sorted.length > shown.length ? `<tfoot><tr><td colspan="7" class="tiny" style="padding-top:10px">Showing ${shown.length} of ${sorted.length.toLocaleString()}.</td></tr></tfoot>` : "");
}

$("#who").innerHTML = `<option value="panel">The whole panel</option>` + ORDER.map(k => `<option value="${k}">${esc(SHORT[k])}</option>`).join("");
[["universe","change"],["who","change"],["sector","change"],["size","change"],["limit","change"],["q","input"]].forEach(([id, ev]) =>
  $("#" + id).addEventListener(ev, e => { state[id] = id === "limit" ? +e.target.value : e.target.value; render(); }));

UI.fetchJSON("data/ranks.json").then(d => {
  const st = $("#dataStatus");
  if (!d || !Array.isArray(d.rows) || !d.rows.length){
    st.className = "status err";
    st.textContent = "The rankings haven’t been built yet. If you run this site, start the “Update data and publish” workflow on GitHub.";
    return;
  }
  ROWS = d.rows.map(unpack);
  const sectors = [...new Set(ROWS.map(r => r.s).filter(Boolean))].sort();
  $("#sector").innerHTML += sectors.map(s => `<option>${esc(s)}</option>`).join("");
  st.textContent = `${ROWS.length.toLocaleString()} companies. Filings checked ${UI.niceDate(d.updated)}; prices from ${UI.niceDate(d.pricesUpdated)}.`;
  $("#settingsNote").textContent = `Rankings use a 10-year Treasury yield of ${d.settings.tsy}% and a CPI of ${d.settings.cpi}. To change them, edit data/settings.json on GitHub.`;
  $("#content").classList.remove("hidden");
  render();
});
})();
