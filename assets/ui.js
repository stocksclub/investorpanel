/* The Investor Panel: shared rendering for the judges and the test-by-test detail. */
(function (root) {
"use strict";
const C = root.PanelCore;
const {esc, verdict, vOf, origOf, ORDER, LINES, BIO, VLABEL} = C;
const MARKS = {pass:"✓", fail:"✗", na:"–", info:"•"}, WORDS = {pass:"Passes", fail:"Fails", na:"No data", info:"Info"};

function renderPanel(judgesEl, detailEl, P, sel, onSelect){
  judgesEl.innerHTML = ORDER.map(k => {
    const inv = P[k], v = vOf(inv), hasOrig = inv.tests.some(t => t.orig);
    const o = hasOrig ? origOf(inv) : null;
    return `<button type="button" class="judge" data-k="${k}" aria-pressed="${sel === k}">
      <div class="paddle" aria-hidden="true"><span class="s">${v.p}</span><span class="o">of ${v.n}</span></div>
      <div class="who">${esc(inv.name)}</div>
      <div class="style">${esc(inv.style)}</div>
      <span class="verdict v-${v.key}">${VLABEL[v.key]}</span>
      ${hasOrig ? `<span class="orig">Inflation-adjusted. Original 1973 rules: ${o.p} of ${o.n}</span>` : ""}
      <p class="line">${v.key === "nd" ? "Not enough reported data for a fair verdict." : "“" + esc(LINES[k][v.key]) + "”"}</p>
      <p class="bio">${esc(BIO[k].bio)}<br><b>Worked for:</b> ${esc(BIO[k].worked)}</p>
    </button>`;
  }).join("");
  judgesEl.querySelectorAll(".judge").forEach(b => b.addEventListener("click", () => onSelect(b.dataset.k)));

  const inv = P[sel], v = verdict(inv.tests), hasOrig = inv.tests.some(t => t.orig);
  const o = hasOrig ? origOf(inv) : null;
  detailEl.innerHTML = `
    <h3>${esc(inv.name)}: ${v.p} of ${v.n} tests passed${hasOrig ? ` (inflation-adjusted) · ${o.p} of ${o.n} under the original 1973 rules` : ""}</h3>
    <p class="intro"><b>Who he is:</b> ${esc(BIO[sel].bio)} <b>Worked for:</b> ${esc(BIO[sel].worked)}.</p>
    <p class="intro">${esc(inv.intro)}</p>
    <table class="tests"><tbody>
      ${inv.tests.map(t => `<tr>
        <td class="mark ${t.st}"><span aria-hidden="true">${MARKS[t.st]}</span><span class="hidden">${WORDS[t.st]}</span></td>
        <td><div class="lbl">${esc(t.label)}</div><div class="why">${esc(t.why)}</div></td>
        <td class="val">${esc(t.value)}<span class="rule">${esc(t.rule)}</span></td>
      </tr>`).join("")}
    </tbody></table>
    ${inv.extras ? `<div class="extras">${inv.extras.map(([k, val]) => `<span>${esc(k)}: <b>${esc(val)}</b></span>`).join("")}</div>` : ""}
    ${inv.homework ? `<div class="homework"><b>Your homework (the numbers can’t answer these):</b><ul>${inv.homework.map(h => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
  `;
}

/* Settings shared by both pages */
const SKEY = "investorPanel.settings.v1";
function loadSettings(){
  try { const s = JSON.parse(localStorage.getItem(SKEY) || "{}") || {}; return {tsy: C.isNum(s.tsy) ? s.tsy : 4.5, cpi: C.isNum(s.cpi) && s.cpi > 0 ? s.cpi : 337.511}; }
  catch(e){ return {tsy:4.5, cpi:337.511}; }
}
function saveSettings(s){ try { localStorage.setItem(SKEY, JSON.stringify({tsy:s.tsy, cpi:s.cpi})); } catch(e){} }

/* The site's S&P 500 data (built by the scheduled data job) */
async function loadSiteData(){
  try {
    const [f, p] = await Promise.all([
      fetch("data/fundamentals.json", {cache:"no-cache"}).then(r => r.ok ? r.json() : null),
      fetch("data/prices.json", {cache:"no-cache"}).then(r => r.ok ? r.json() : null)
    ]);
    if (!f || !Array.isArray(f.companies)) return null;
    const map = {};
    f.companies.forEach(c => { map[c.t] = c; });
    return {updated:f.updated, companies:f.companies, map, prices:(p && p.prices) || {}, pricesUpdated:p && p.updated};
  } catch(e){ return null; }
}
function niceDate(iso){
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"});
}

root.PanelUI = {renderPanel, loadSettings, saveSettings, loadSiteData, niceDate};
})(globalThis);
