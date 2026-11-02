/* chart.js — 답 안의 ```chart 블록(JSON) → 바로 보이는 차트 (아티팩트를 열지 않아도)
   {"type":"line"|"bar"|"scatter", "title":"…", "x":["1월","2월"], "series":[{"name":"매출","data":[3,5]}],
    "xlabel":"…", "ylabel":"…", "unit":"℃"}            scatter: series[i].points = [[x,y],…]
   · 색은 검증된 순서 고정 팔레트 (색약 구분 검사 통과, 라이트·다크 따로)
   · 마우스를 올리면 값 표시, [표] 버튼으로 숫자 표 보기, 선은 4개까지 끝에 이름표 */

const CHARTS = {};
let chartSeq = 0;
const C_W = 640, C_H = 300, PAD0 = {l: 52, r: 18, t: 14, b: 40};

function niceTicks(lo, hi, n = 5){
  if(!isFinite(lo) || !isFinite(hi)) throw new Error("숫자가 너무 크거나 잘못됐어요");
  if(lo === hi){ const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d }
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  const a = Math.floor(lo / step) * step, out = [];
  for(let i = 0; i <= n + 2; i++){   // 눈금은 최대 8개 (아주 큰 수에서 v+step이 안 커져도 무한 반복 안 함)
    const v = +(a + i * step).toPrecision(12);
    if(out.length && v <= out[out.length - 1]) break;
    out.push(v);
    if(v >= hi) break;
  }
  if(out.length < 2) throw new Error("값 차이가 너무 작아서 그릴 수 없어요");
  return out;
}
function fmtNum(v, unit = ""){
  if(v == null || !isFinite(v)) return "–";
  const a = Math.abs(v);
  const s = a >= 1e8 ? (v / 1e8).toLocaleString("ko-KR", {maximumFractionDigits: 1}) + "억"
          : a >= 1e4 ? (v / 1e4).toLocaleString("ko-KR", {maximumFractionDigits: 1}) + "만"
          : v.toLocaleString("ko-KR", {maximumFractionDigits: a < 1 ? 3 : 2});
  return s + (unit || "");
}

function chartParse(body){
  let spec;
  try{ spec = JSON.parse(body) }catch(e){ throw new Error("차트 데이터(JSON) 형식이 잘못됐어요: " + e.message) }
  const type = ["line", "bar", "scatter"].includes(spec.type) ? spec.type : "line";
  let series = Array.isArray(spec.series) ? spec.series : (Array.isArray(spec.data) ? [{name: spec.ylabel || "", data: spec.data}] : []);
  series = series.filter(s => s && (Array.isArray(s.data) || Array.isArray(s.points))).map(s => ({
    name: String(s.name ?? ""),
    data: (s.data || []).map(v => v == null || v === "" ? null : +v),
    points: (s.points || []).map(p => [+p[0], +p[1]]).filter(p => isFinite(p[0]) && isFinite(p[1]))}));
  if(!series.length) throw new Error("차트에 그릴 숫자(series)가 없어요");
  const cap = type === "scatter" ? 3 : 8;   // 색 구분이 확실한 개수까지만
  if(series.length > cap) throw new Error(`계열이 ${series.length}개예요 — ${type === "scatter" ? "점 그래프는 3개" : "8개"}까지만 그려요`);
  const n = Math.max(...series.map(s => s.data.length));
  const x = (Array.isArray(spec.x) ? spec.x : Array.from({length: n}, (_, i) => i + 1)).map(String).slice(0, Math.max(n, 1));
  const W = Math.round(Math.min(C_W, Math.max(340, (window.innerWidth || C_W) - 64)));   // 폰에서도 글자가 작아지지 않게 화면 폭에 맞춰 그림
  return {W, type, title: String(spec.title || ""), x, series, xlabel: String(spec.xlabel || ""), ylabel: String(spec.ylabel || ""), unit: String(spec.unit || "")};
}

function chartSVG(c){
  const multi = c.series.length > 1, endLab = c.type === "line" && multi && c.series.length <= 4;
  const PAD = {...PAD0, r: endLab ? 46 : PAD0.r};   // 선 끝 이름표 자리
  const W = c.W, H = C_H, iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  let xs, xLab, ys = [];
  if(c.type === "scatter"){
    const px = c.series.flatMap(s => s.points.map(p => p[0])), py = c.series.flatMap(s => s.points.map(p => p[1]));
    xs = niceTicks(Math.min(...px), Math.max(...px)); ys = py;
  }else ys = c.series.flatMap(s => s.data.filter(v => v != null && isFinite(v)));
  if(!ys.length) throw new Error("숫자가 하나도 없어요");
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if(c.type === "bar" || lo > 0 && lo < hi * 0.5) lo = Math.min(0, lo);   // 막대는 0부터
  const yt = niceTicks(lo, hi), y0 = yt[0], y1 = yt[yt.length - 1];
  const Y = v => PAD.t + ih - (v - y0) / (y1 - y0) * ih;
  const n = c.x.length, band = iw / Math.max(n, 1);
  const X = c.type === "scatter" ? (v => PAD.l + (v - xs[0]) / (xs[xs.length - 1] - xs[0]) * iw)
          : c.type === "bar" ? (i => PAD.l + band * (i + 0.5)) : (i => PAD.l + (n > 1 ? i / (n - 1) * iw : iw / 2));
  let g = "";
  yt.forEach(v => { g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(v)}" y2="${Y(v)}" class="cg${v === 0 ? " zero" : ""}"/><text x="${PAD.l - 8}" y="${Y(v) + 4}" text-anchor="end" class="ct">${esc(fmtNum(v))}</text>` });
  if(c.type === "scatter") xs.forEach(v => { g += `<text x="${X(v)}" y="${H - PAD.b + 18}" text-anchor="middle" class="ct">${esc(fmtNum(v))}</text>` });
  else{ const every = Math.ceil(n / (W < 500 ? 5 : 8));
    c.x.forEach((l, i) => { if(i % every === 0 || i === n - 1 && n <= 12) g += `<text x="${X(i)}" y="${H - PAD.b + 18}" text-anchor="middle" class="ct">${esc(l.length > 10 ? l.slice(0, 9) + "…" : l)}</text>` }) }
  if(c.xlabel) g += `<text x="${PAD.l + iw / 2}" y="${H - 4}" text-anchor="middle" class="ct cl">${esc(c.xlabel)}</text>`;
  if(c.ylabel) g += `<text x="12" y="${PAD.t + ih / 2}" text-anchor="middle" class="ct cl" transform="rotate(-90 12 ${PAD.t + ih / 2})">${esc(c.ylabel)}</text>`;
  let marks = "";
  c.series.forEach((s, k) => {
    const col = `var(--s${k + 1})`;
    if(c.type === "line"){
      let d = "", pen = false;
      s.data.forEach((v, i) => { if(v == null || !isFinite(v)){ pen = false; return } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); pen = true });
      marks += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if(n <= 24) s.data.forEach((v, i) => { if(v != null && isFinite(v)) marks += `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="${col}" stroke="var(--surface)" stroke-width="2"/>` });
      const li = s.data.map((v, i) => v != null && isFinite(v) ? i : -1).filter(i => i >= 0).pop();
      if(endLab && li != null && s.name) marks += `<text x="${X(li) + 6}" y="${Y(s.data[li]) + 4}" class="ct cn">${esc(s.name.slice(0, 10))}</text>`;
    }else if(c.type === "bar"){
      const gw = band * 0.72, bw = Math.max(2, (gw - 2 * (c.series.length - 1)) / c.series.length);
      s.data.forEach((v, i) => { if(v == null || !isFinite(v)) return;
        const x = X(i) - gw / 2 + k * (bw + 2), ya = Y(Math.max(v, 0)), yb = Y(Math.min(v, 0)), h = Math.max(yb - ya, 0.5), r = Math.min(4, bw / 2, h);
        marks += v >= 0
          ? `<path d="M${x} ${yb}V${ya + r}Q${x} ${ya} ${x + r} ${ya}H${x + bw - r}Q${x + bw} ${ya} ${x + bw} ${ya + r}V${yb}Z" fill="${col}"/>`
          : `<path d="M${x} ${ya}V${yb - r}Q${x} ${yb} ${x + r} ${yb}H${x + bw - r}Q${x + bw} ${yb} ${x + bw} ${yb - r}V${ya}Z" fill="${col}"/>` });
    }else s.points.forEach(p => { marks += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="4.5" fill="${col}" fill-opacity=".85" stroke="var(--surface)" stroke-width="2"><title>${esc((s.name ? s.name + " · " : "") + fmtNum(p[0]) + ", " + fmtNum(p[1], c.unit))}</title></circle>` });
  });
  let hit = "";
  if(c.type !== "scatter") for(let i = 0; i < n; i++){ const x0 = c.type === "bar" ? PAD.l + band * i : (n > 1 ? X(i) - iw / (n - 1) / 2 : PAD.l);
    hit += `<rect x="${Math.max(PAD.l, x0)}" y="${PAD.t}" width="${c.type === "bar" ? band : n > 1 ? iw / (n - 1) : iw}" height="${ih}" fill="transparent" data-i="${i}"/>` }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title || "차트")}">${g}<line class="cx" x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" visibility="hidden"/>${marks}${hit}</svg>`;
}

function chartTable(c){
  if(c.type === "scatter") return `<table><thead><tr><th>계열</th><th>${esc(c.xlabel || "x")}</th><th>${esc(c.ylabel || "y")}</th></tr></thead><tbody>${
    c.series.flatMap(s => s.points.map(p => `<tr><td>${esc(s.name)}</td><td>${esc(fmtNum(p[0]))}</td><td>${esc(fmtNum(p[1], c.unit))}</td></tr>`)).join("")}</tbody></table>`;
  return `<table><thead><tr><th>${esc(c.xlabel || "")}</th>${c.series.map(s => `<th>${esc(s.name || c.ylabel || "값")}</th>`).join("")}</tr></thead><tbody>${
    c.x.map((l, i) => `<tr><td>${esc(l)}</td>${c.series.map(s => `<td>${esc(fmtNum(s.data[i], c.unit))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function chartHTML(body, done){
  if(!done) return `<div class="chart-box loading"><span>📈 차트 그리는 중…</span></div>`;
  let c;
  try{ c = chartParse(body); var svg = chartSVG(c) }
  catch(e){ return `<div class="chart-box err"><b>📈 차트를 못 그렸어요</b><span>${esc(e.message)}</span><pre><code>${esc(body.slice(0, 2000))}</code></pre></div>` }
  const id = "ch" + (++chartSeq); CHARTS[id] = c;
  delete CHARTS["ch" + (chartSeq - 400)];   // 답을 받는 동안 계속 다시 그려져서 — 오래된 것은 지움
  const legend = c.series.length > 1 ? `<div class="chart-legend">${c.series.map((s, k) => `<span><i style="background:var(--s${k + 1})"></i>${esc(s.name || "계열 " + (k + 1))}</span>`).join("")}</div>` : "";
  return `<figure class="chart-box" data-chart="${id}"><figcaption><b>${esc(c.title)}</b><button class="chart-tab" data-chart-table aria-pressed="false">표</button></figcaption>
    ${legend}<div class="chart-plot">${svg}<div class="chart-tip" hidden></div></div><div class="chart-table" hidden>${chartTable(c)}</div></figure>`;
}

/* 마우스·손가락: 가장 가까운 칸의 값들을 보여줌 */
document.addEventListener("pointermove", e => {
  const r = e.target.closest?.(".chart-box rect[data-i]"), box = e.target.closest?.(".chart-box");
  document.querySelectorAll(".chart-box .chart-tip:not([hidden])").forEach(t => { if(!box || !box.contains(t)) { t.hidden = true; t.closest(".chart-box").querySelector(".cx")?.setAttribute("visibility", "hidden") } });
  if(!r) return;
  const c = CHARTS[box.dataset.chart], i = +r.dataset.i, tip = box.querySelector(".chart-tip"), svg = r.ownerSVGElement;
  const cx = +r.getAttribute("x") + +r.getAttribute("width") / 2, line = svg.querySelector(".cx");
  if(c.type === "line"){ line.setAttribute("x1", cx); line.setAttribute("x2", cx); line.setAttribute("visibility", "visible") }
  tip.innerHTML = `<b>${esc(c.x[i] ?? "")}</b>` + c.series.map((s, k) => `<div><i style="background:var(--s${k + 1})"></i>${esc(s.name || c.ylabel || "값")}<span>${esc(fmtNum(s.data[i], c.unit))}</span></div>`).join("");
  tip.hidden = false;
  const pr = box.querySelector(".chart-plot").getBoundingClientRect(), sx = pr.width / c.W;
  let left = cx * sx + 12; if(left + 180 > pr.width) left = cx * sx - 12 - Math.min(180, tip.offsetWidth);
  tip.style.left = Math.max(0, left) + "px"; tip.style.top = "8px";
});
document.addEventListener("pointerleave", () => document.querySelectorAll(".chart-tip").forEach(t => t.hidden = true));
document.addEventListener("click", e => {
  const b = e.target.closest("[data-chart-table]"); if(!b) return;
  const box = b.closest(".chart-box"), on = b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", on); b.classList.toggle("on", on);
  box.querySelector(".chart-plot").hidden = on; box.querySelector(".chart-table").hidden = !on;
  const lg = box.querySelector(".chart-legend"); if(lg) lg.hidden = on;
});
