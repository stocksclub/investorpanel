(function(){
"use strict";
const C = PanelCore, UI = PanelUI;
const {analyze, money, num, pct, esc} = C;
const $ = s => document.querySelector(s);
const settings = UI.loadSettings();
const state = {tsy:settings.tsy, cpi:settings.cpi, ix:0, sel:"graham"};
let DATA = null;

function render(){
  const ix = DATA.indices[state.ix];
  $("#seg").innerHTML = DATA.indices.map((x, i) => `<button type="button" data-i="${i}" aria-pressed="${i === state.ix}">${esc(x.name)}</button>`).join("");
  $("#seg").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { state.ix = +b.dataset.i; render(); }));
  $("#ixName").textContent = ix.name + " as one company";
  $("#ixAbout").textContent = ix.about;
  if (!ix.used){
    $("#ixFacts").textContent = "This index’s member list couldn’t be loaded this time. It should be back after the next update.";
    $("#ixJudges").innerHTML = ""; $("#ixDetail").innerHTML = ""; $("#holdings").innerHTML = "";
    return;
  }
  const {m, P} = analyze(ix.D, {price:ix.price, tsy:state.tsy, cpi:state.cpi});
  const y0 = ix.D.years[0];
  const facts = [
    ["Weighting", ix.method === "price" ? "By share price" : "By market value"],
    ["Companies scored", `${ix.used} of ${ix.members}`],
    ["Share of the index scored", pct(ix.coverage, 0)],
    ["P/E", num(m.pe)],
    ["Dividend yield", pct(m.yld)],
    ["Net margin", pct(C.div(y0.netIncome, y0.revenue))]
  ];
  if (ix.method !== "price") facts.splice(3, 0, ["Market value scored", money(m.mcap)]);
  $("#ixFacts").innerHTML = facts.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join("");
  UI.renderPanel($("#ixJudges"), $("#ixDetail"), P, state.sel, k => { state.sel = k; render(); });

  const top = ix.holdings.slice(0, ix.method === "price" ? 30 : 15);
  const maxW = top.length ? top[0].w : 1;
  $("#holdNote").textContent = ix.method === "price"
    ? "All 30 Dow companies, by their share of the index. A higher share price means a bigger weight."
    : `The ${top.length} biggest of ${ix.priced} companies, by their share of the index’s total market value.`;
  $("#holdings").innerHTML = `<tbody>${top.map(h => `<tr><td><a href="score.html?t=${encodeURIComponent(h.t)}">${esc(h.t)}</a></td><td>${esc(h.n)}</td><td class="w"><span class="wbar" style="width:${Math.max(2, h.w / maxW * 120).toFixed(0)}px"></span>${(h.w * 100).toFixed(1)}%</td></tr>`).join("")}</tbody>`;
}

$("#tsy").value = state.tsy; $("#cpi").value = state.cpi;
$("#tsy").addEventListener("input", e => { const v = parseFloat(e.target.value); state.tsy = isFinite(v) ? v : 4.5; UI.saveSettings(state); if (DATA) render(); });
$("#cpi").addEventListener("input", e => { const v = parseFloat(e.target.value); state.cpi = isFinite(v) && v > 0 ? v : 337.511; UI.saveSettings(state); if (DATA) render(); });

UI.fetchJSON("data/indices.json").then(d => {
  const st = $("#dataStatus");
  if (!d || !d.indices || !d.indices.length){
    st.className = "status err";
    st.textContent = "The index data hasn’t been built yet. If you run this site, start the “Update data and publish” workflow on GitHub.";
    return;
  }
  DATA = d;
  st.textContent = `Filings checked ${UI.niceDate(d.updated)}; prices from ${UI.niceDate(d.pricesUpdated)}.`;
  $("#content").classList.remove("hidden");
  render();
});
})();
