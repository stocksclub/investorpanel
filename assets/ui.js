/* The Investor Panel: shared rendering for the judges and the test-by-test detail. */
(function (root) {
"use strict";
const C = root.PanelCore;
const {esc, verdict, vOf, origOf, ORDER, LINES, BIO, VLABEL} = C;
const MARKS = {pass:"✓", fail:"✗", na:"–", info:"•"}, WORDS = {pass:"Passes", fail:"Fails", na:"No data", info:"Info"};

const INITIALS = {graham:"BG", buffett:"WB", lynch:"PL", fisher:"PF", greenblatt:"JG", piotroski:"JP", slegers:"PS", neff:"JN"};
// Where to learn more about each investor.
const LEARN = {
  graham:["Wikipedia","https://en.wikipedia.org/wiki/Benjamin_Graham"],
  buffett:["Wikipedia","https://en.wikipedia.org/wiki/Warren_Buffett"],
  lynch:["Wikipedia","https://en.wikipedia.org/wiki/Peter_Lynch"],
  fisher:["Wikipedia","https://en.wikipedia.org/wiki/Philip_Arthur_Fisher"],
  greenblatt:["Wikipedia","https://en.wikipedia.org/wiki/Joel_Greenblatt"],
  piotroski:["Wikipedia (his F-Score)","https://en.wikipedia.org/wiki/Piotroski_F-score"],
  slegers:["his Compounding Quality site","https://www.compoundingquality.net/"],
  neff:["Wikipedia","https://en.wikipedia.org/wiki/John_Neff"]
};
// A photo shows if you add assets/img/<investor>.jpg (for example assets/img/graham.jpg); otherwise initials.
function avatar(k, size){
  return `<span class="avatar${size ? " " + size : ""}" aria-hidden="true"><span>${INITIALS[k]}</span><img src="assets/img/${k}.jpg" alt="" onerror="this.remove()"></span>`;
}
function renderMeetPanel(el){
  el.innerHTML = ORDER.map(k => `<article class="meet">
    ${avatar(k, "lg")}
    <div><h3>${esc(nameOf(k))}</h3>
    <p>${esc(BIO[k].bio)}</p>
    <p class="tiny"><b>Worked for:</b> ${esc(BIO[k].worked)}</p>
    <a href="${LEARN[k][1]}" target="_blank" rel="noopener">Learn more on ${esc(LEARN[k][0])} →</a></div>
  </article>`).join("");
}
const NAMES = {graham:"Benjamin Graham", buffett:"Warren Buffett", lynch:"Peter Lynch", fisher:"Philip Fisher", greenblatt:"Joel Greenblatt", piotroski:"Joseph Piotroski", slegers:"Pieter Slegers", neff:"John Neff"};
function nameOf(k){ return NAMES[k] || k; }

// opts.cmp = {label, P}: show a comparison (like the company's sector) next to every score and test.
// opts.trendsHref(k): link to that investor's charts.
function renderPanel(judgesEl, detailEl, P, sel, onSelect, opts){
  opts = opts || {};
  const cmp = opts.cmp && opts.cmp.P ? opts.cmp : null;
  judgesEl.innerHTML = ORDER.map(k => {
    const inv = P[k], v = vOf(inv), hasOrig = inv.tests.some(t => t.orig);
    const o = hasOrig ? origOf(inv) : null, cv = cmp ? verdict(cmp.P[k].tests) : null;
    return `<button type="button" class="judge" data-k="${k}" aria-pressed="${sel === k}">
      <div class="paddle" aria-hidden="true"><span class="s">${v.p}</span><span class="o">of ${v.n}</span></div>
      <div class="who">${esc(inv.name)}</div>
      <div class="style">${esc(inv.style)}</div>
      <span class="verdict v-${v.key}">${VLABEL[v.key]}</span>
      ${hasOrig ? `<span class="orig">Inflation-adjusted. Original 1973 rules: ${o.p} of ${o.n}</span>` : ""}
      ${cv ? `<span class="orig cmpline">${esc(cmp.label)}: ${cv.p} of ${cv.n}</span>` : ""}
      <p class="line">${v.key === "nd" ? "Not enough reported data for a fair verdict." : "“" + esc(LINES[k][v.key]) + "”"}</p>
      <p class="bio">${esc(BIO[k].bio)}<br><b>Worked for:</b> ${esc(BIO[k].worked)}</p>
    </button>`;
  }).join("");
  judgesEl.querySelectorAll(".judge").forEach(b => b.addEventListener("click", () => onSelect(b.dataset.k)));

  const inv = P[sel], v = verdict(inv.tests), hasOrig = inv.tests.some(t => t.orig);
  const o = hasOrig ? origOf(inv) : null;
  const ct = cmp ? cmp.P[sel].tests : null, cv = cmp ? verdict(ct) : null;
  detailEl.innerHTML = `
    <div class="detail-head">${avatar(sel)}<div>
      <h3>${esc(inv.name)}: ${v.p} of ${v.n} tests passed${hasOrig ? ` (inflation-adjusted) · ${o.p} of ${o.n} under the original 1973 rules` : ""}</h3>
      ${cv ? `<p class="tiny" style="margin:2px 0 0">${esc(cmp.label)}: ${cv.p} of ${cv.n} tests passed</p>` : ""}
    </div></div>
    <p class="intro"><b>Who he is:</b> ${esc(BIO[sel].bio)} <b>Worked for:</b> ${esc(BIO[sel].worked)}. <a href="${LEARN[sel][1]}" target="_blank" rel="noopener">Learn more on ${esc(LEARN[sel][0])}</a>.</p>
    <p class="intro">${esc(inv.intro)}</p>
    <p class="detail-links"><a class="btn ghost" href="index.html#${sel}">What do these tests mean? →</a>${opts.trendsHref ? ` <a class="btn ghost" href="${opts.trendsHref(sel)}">See how these numbers changed over time →</a>` : ""}</p>
    <table class="tests"><tbody>
      ${inv.tests.map((t, i) => `<tr>
        <td class="mark ${t.st}"><span aria-hidden="true">${MARKS[t.st]}</span><span class="hidden">${WORDS[t.st]}</span></td>
        <td><div class="lbl">${esc(t.label)}</div><div class="why">${esc(t.why)}</div></td>
        <td class="val">${esc(t.value)}<span class="rule">${esc(t.rule)}</span>${ct && ct[i] ? `<span class="cmpv"><span class="mark ${ct[i].st}" aria-hidden="true">${MARKS[ct[i].st]}</span> ${esc(cmp.short || cmp.label)}: ${esc(ct[i].value)}</span>` : ""}</td>
      </tr>`).join("")}
    </tbody></table>
    ${inv.extras ? `<div class="extras">${inv.extras.map(([k, val]) => `<span>${esc(k)}: <b>${esc(val)}</b></span>`).join("")}</div>` : ""}
    ${inv.homework ? `<div class="homework"><b>Your homework (the numbers can’t answer these):</b><ul>${inv.homework.map(h => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
  `;
}

/* ---------- Line charts (plain SVG, no libraries) ---------- */
function fmtVal(v, f){
  if (!C.isNum(v)) return "—";
  if (f === "pct") return C.pct(v, Math.abs(v) < 0.1 ? 1 : 0);
  if (f === "money") return C.money(v);
  if (f === "usd") return C.usd(v);
  if (f === "x") return C.num(v, Math.abs(v) < 10 ? 2 : 1);
  return Math.round(v).toLocaleString();
}
// series: [{name, cls, values}] aligned with labels; rule: a number drawn as a dashed line.
function lineChart(labels, series, rule, f){
  const W = 340, H = 180, L = 52, R = 10, T = 12, B = 26;
  const vals = series.flatMap(s => s.values).filter(C.isNum).concat(C.isNum(rule) ? [rule] : []);
  if (!series.some(s => s.values.some(C.isNum))) return `<div class="nochart">No data for this one.</div>`;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi){ lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = i => L + (labels.length < 2 ? (W - L - R) / 2 : i * (W - L - R) / (labels.length - 1));
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
  ticks.forEach(t => { svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${esc(fmtVal(t, f))}</text>`; });
  const step = Math.max(1, Math.ceil(labels.length / 6));
  labels.forEach((lb, i) => { if (i % step === 0 || i === labels.length - 1) svg += `<text x="${x(i)}" y="${H - 6}" class="axis" text-anchor="middle">${esc(lb)}</text>`; });
  if (C.isNum(rule) && rule >= lo && rule <= hi) svg += `<line x1="${L}" x2="${W - R}" y1="${y(rule)}" y2="${y(rule)}" class="rule"/>`;
  series.forEach(s => {
    let d = "", pen = false;
    s.values.forEach((v, i) => { if (C.isNum(v)){ d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; } else pen = false; });
    svg += `<path d="${d}" class="ln ${s.cls}"/>`;
    s.values.forEach((v, i) => { if (C.isNum(v)) svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="pt ${s.cls}"><title>${esc(s.name)} ${esc(labels[i])}: ${esc(fmtVal(v, f))}</title></circle>`; });
  });
  return svg + `</svg>`;
}

/* Settings shared by both pages */
const SKEY = "investorPanel.settings.v1";
function loadSettings(){
  try { const s = JSON.parse(localStorage.getItem(SKEY) || "{}") || {}; return {tsy: C.isNum(s.tsy) ? s.tsy : 4.5, cpi: C.isNum(s.cpi) && s.cpi > 0 ? s.cpi : 337.511}; }
  catch(e){ return {tsy:4.5, cpi:337.511}; }
}
function saveSettings(s){ try { localStorage.setItem(SKEY, JSON.stringify({tsy:s.tsy, cpi:s.cpi})); } catch(e){} }

/* Read one of the site's data files; returns null if it isn't there. */
async function fetchJSON(path){
  try { const r = await fetch(path, {cache:"no-cache"}); return r.ok ? await r.json() : null; }
  catch(e){ return null; }
}
function niceDate(iso){
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"});
}

root.PanelUI = {renderPanel, renderMeetPanel, avatar, lineChart, fmtVal, nameOf, loadSettings, saveSettings, fetchJSON, niceDate, LEARN};
})(globalThis);
