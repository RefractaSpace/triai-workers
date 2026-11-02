/* pages.js — 대화 말고 다른 페이지: 프로젝트 목록 · 프로젝트 하나 · 아티팩트 모음 */
"use strict";

function showView(v) {
  state.view = v;
  $("#chatView").hidden = v !== "chat"; $("#pageView").hidden = v === "chat";
  $$(".side-nav [data-go]").forEach(b => b.classList.toggle("on", b.dataset.go === v || (v === "project" && b.dataset.go === "projects")));
  if (v !== "chat") { $("#topTitle").textContent = ""; $("#topAct").innerHTML = ""; }
  $(".top").classList.remove("lined");
}
const pageEl = () => $("#pageView");

/* ── 프로젝트 목록 ── */
async function showProjects(push = true) {
  showView("projects");
  if (push) history.pushState({ v: "projects" }, "", "/?v=projects");
  pageEl().innerHTML = `<div class="page-in"><div class="page-h"><div><h1>프로젝트</h1><p>자료와 지시를 한곳에 모아 두면, 그 안의 대화는 모두 그걸 바탕으로 답해요.</p></div>
    <button class="btn primary" id="pjNew">${ICON.plus}새 프로젝트</button></div><div class="grid" id="pjGrid"><div class="list-empty">불러오는 중…</div></div></div>`;
  $("#pjNew").onclick = newProject;
  try { state.projects = await getJSON("/api/projects"); } catch (e) { fail(e); }
  const g = $("#pjGrid"); if (!g) return;
  g.innerHTML = state.projects.map(p => `<button class="card" data-pid="${esc(p.id)}"><b>${esc(p.name)}</b><p>${esc(p.description || p.instructions || "설명 없음")}</p>
    <small>대화 ${p.conv_count}개 · 자료 ${p.files.length}개</small></button>`).join("") + `<button class="card add" id="pjAdd">${ICON.plus}<span>새 프로젝트</span></button>`;
  g.querySelectorAll("[data-pid]").forEach(b => b.onclick = () => showProject(b.dataset.pid));
  $("#pjAdd").onclick = newProject;
}
async function newProject() {
  const name = await ask("새 프로젝트", { input: "이름 (예: 하이브리드 로켓)", ok: "만들기" });
  if (!name?.trim()) return;
  try { const p = await sendJSON("/api/projects", "POST", { name: name.trim() }); state.projects.unshift(p); showProject(p.id); } catch (e) { fail(e); }
}

/* ── 프로젝트 하나 ── */
async function showProject(pid, push = true) {
  showView("project");
  if (push) history.pushState({ p: pid }, "", "/?p=" + encodeURIComponent(pid) + "&v=project");
  let p; try { p = await getJSON(`/api/projects/${encodeURIComponent(pid)}`); } catch (e) { fail(e); return showProjects(false); }
  const i = state.projects.findIndex(x => x.id === pid); if (i >= 0) state.projects[i] = p; else state.projects.unshift(p);
  const convs = state.convs.filter(c => c.project_id === pid);
  pageEl().innerHTML = `<div class="page-in">
    <div class="page-h"><div><h1>${esc(p.name)}</h1>${p.description ? `<p>${esc(p.description)}</p>` : ""}</div>
      <button class="icon" id="pjMore" aria-label="프로젝트 메뉴">${ICON.more}</button></div>
    <div class="pj-layout">
      <div>
        <button class="new-chat" id="pjChat" style="margin-bottom:18px;padding:14px 16px">${ICON.plus}이 프로젝트에서 새 대화</button>
        <div class="pj-convs">${convs.length ? convs.map(c => `<button class="conv" data-id="${esc(c.id)}"><span>${esc(c.title)}</span><small class="muted">${esc(dayGroup(c.updated))}</small></button>`).join("")
          : `<div class="list-empty">아직 이 프로젝트의 대화가 없어요</div>`}</div>
      </div>
      <div class="pj-side">
        <div class="box"><h3><span>지시</span><button class="btn small" id="pjIns">편집</button></h3><p>${esc(p.instructions || "이 프로젝트에서 AI가 늘 지킬 것을 적어 두세요. 예) 답은 표로, 단위는 SI로")}</p></div>
        <div class="box"><h3><span>자료</span><button class="btn small" id="pjAddF">추가</button></h3>
          <div class="flist">${p.files.length ? p.files.map(f => `<div class="fi">${ICON.file}<span title="${esc(f.name)}">${esc(f.name)}</span><small>${(f.chars / 1000).toFixed(1)}천 자</small><button class="icon" data-fid="${esc(f.id)}" aria-label="${esc(f.name)} 지우기">${ICON.trash}</button></div>`).join("")
            : `<p>글 파일(.txt .md .csv 코드 등)을 올리면 대화할 때 함께 읽어요.</p>`}</div>
          <input type="file" id="pjFile" multiple hidden accept=".txt,.md,.csv,.json,.py,.js,.ts,.html,.css,.c,.cpp,.h,.java,.go,.rs,.sql,.yaml,.yml,.xml,.log"></div>
      </div>
    </div></div>`;
  $("#pjChat").onclick = () => newChat({ projectId: pid });
  pageEl().querySelectorAll(".pj-convs .conv").forEach(b => b.onclick = () => openConv(b.dataset.id));
  $("#pjIns").onclick = async () => {
    const v = await ask("프로젝트 지시", { input: "AI가 이 프로젝트에서 늘 지킬 것", area: true, value: p.instructions || "", ok: "저장" });
    if (v == null) return;
    try { await sendJSON(`/api/projects/${pid}`, "PUT", { name: p.name, description: p.description, instructions: v }); showProject(pid, false); } catch (e) { fail(e); }
  };
  $("#pjAddF").onclick = () => $("#pjFile").click();
  $("#pjFile").onchange = async e => {
    for (const f of e.target.files) {
      try { await sendJSON(`/api/projects/${pid}/files`, "POST", { name: f.name, content: await f.text() }); } catch (err) { fail(err); }
    }
    showProject(pid, false);
  };
  pageEl().querySelectorAll("[data-fid]").forEach(b => b.onclick = async () => {
    if (!await ask("자료 지우기", { msg: "이 자료를 프로젝트에서 지울까요?", ok: "지우기", danger: true })) return;
    try { await sendJSON(`/api/projects/${pid}/files/${b.dataset.fid}`, "DELETE"); showProject(pid, false); } catch (e) { fail(e); }
  });
  $("#pjMore").onclick = e => openMenu(e.currentTarget, [
    { label: "이름·설명 바꾸기", act: async () => {
      const name = await ask("프로젝트 이름", { input: "이름", value: p.name, ok: "다음" }); if (!name?.trim()) return;
      const desc = await ask("프로젝트 설명", { input: "한 줄 설명 (비워도 돼요)", value: p.description || "", ok: "저장" }); if (desc == null) return;
      try { await sendJSON(`/api/projects/${pid}`, "PUT", { name: name.trim(), description: desc, instructions: p.instructions }); showProject(pid, false); } catch (err) { fail(err); }
    } },
    "-",
    { label: "프로젝트 삭제", danger: true, act: async () => {
      if (!await ask("프로젝트 삭제", { msg: `'${esc(p.name)}'를 지울까요? 안의 대화는 지우지 않고 '프로젝트 없음'으로 옮겨요.`, ok: "삭제", danger: true })) return;
      try { await sendJSON(`/api/projects/${pid}`, "DELETE"); state.projects = state.projects.filter(x => x.id !== pid); refreshConvs(); showProjects(); } catch (err) { fail(err); }
    } },
  ], { align: "end" });
}

/* ── 아티팩트 모음 ── */
async function showArtifacts(push = true) {
  showView("artifacts");
  if (push) history.pushState({ v: "artifacts" }, "", "/?v=artifacts");
  pageEl().innerHTML = `<div class="page-in"><div class="page-h"><div><h1>아티팩트</h1><p>대화에서 만든 웹페이지·그림·도표·React 앱을 모아 봤어요.</p></div>
    <label class="search" style="width:220px;margin:0;background:var(--fill)"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input id="artQ" type="search" placeholder="아티팩트 검색"></label></div>
    <div class="grid" id="artGrid"><div class="list-empty">불러오는 중…</div></div></div>`;
  let items = [];
  const paint = () => {
    const q = $("#artQ").value.trim().toLowerCase();
    const list = items.filter(a => !q || a.title.toLowerCase().includes(q) || (a.conv_title || "").toLowerCase().includes(q));
    $("#artGrid").innerHTML = list.length ? list.map((a, i) => `<button class="card" data-i="${items.indexOf(a)}"><span class="ic" style="color:var(--muted)">${ART_ICON[a.lang] || ART_ICON.html}</span><b>${esc(a.title)}</b>
      <p>${esc(a.conv_title || "")}</p><small>${esc(ART_KIND[a.lang] || a.kind || "")}${a.versions > 1 ? ` · 버전 ${a.versions}개` : ""} · ${esc(dayGroup(a.time))}</small></button>`).join("")
      : `<div class="list-empty">${q ? "찾는 아티팩트가 없어요" : "아직 아티팩트가 없어요. 대화에서 '…를 아티팩트로 만들어 줘'라고 해 보세요."}</div>`;
    $("#artGrid").querySelectorAll("[data-i]").forEach(b => b.onclick = () => openSaved(items[+b.dataset.i]));
  };
  $("#artQ").oninput = paint;
  try { items = await getJSON("/api/artifacts"); } catch (e) { fail(e); }
  if ($("#artGrid")) paint();
}
async function openSaved(a) {
  try {
    const x = await getJSON(`/api/artifacts/${encodeURIComponent(a.conv_id)}/${a.turn}/${encodeURIComponent(a.key)}/${a.n}`);
    ARTS[x.id] = { src: x.src, lang: x.lang, title: x.title };
    openArt(x.id);
  } catch (e) { fail(e); }
}

/* 위 막대: 스크롤하면 아래 선 */
for (const sc of [$("#scroller"), $("#pageView")]) sc.addEventListener("scroll", () => $(".top").classList.toggle("lined", sc.scrollTop > 4), { passive: true });

/* ── 집 센서 (ESP32) ── */
const SENSOR_RANGE = { 24: "24시간", 168: "7일" };
async function showSensors(push = true) {
  showView("sensors");
  if (push) history.pushState({ v: "sensors" }, "", "/?v=sensors");
  pageEl().innerHTML = `<div class="page-in"><div class="page-h"><div><h1>센서</h1><p>집에 둔 ESP32 센서가 1분마다 보낸 기록이에요. AI에게 "방 온도 어때?"라고 물어도 돼요.</p></div>
    <button class="btn" id="snSet">기기 관리</button></div><div id="snList"><div class="list-empty">불러오는 중…</div></div></div>`;
  $("#snSet").onclick = () => openSettings("sensors");
  let data;
  try { data = await getJSON("/api/sensors"); } catch (e) { fail(e); return; }
  const box = $("#snList"); if (!box) return;
  if (!data.devices.length) { box.innerHTML = `<div class="list-empty">아직 센서 기기가 없어요.<br><button class="btn primary" id="snAdd" style="margin-top:14px">센서 기기 추가</button></div>`; $("#snAdd").onclick = () => openSettings("sensors"); return; }
  box.innerHTML = data.devices.map(d => sensorCard(d)).join("");
  for (const d of data.devices) {
    const card = box.querySelector(`[data-dev="${d.id}"]`);
    card.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { card.querySelectorAll("[data-h]").forEach(x => x.classList.toggle("on", x === b)); store.set("snRange", +b.dataset.h); sensorCharts(card, d.id, +b.dataset.h); });
    card.querySelector("[data-send]").onclick = async () => {
      const inp = card.querySelector("[data-msg]"); if (!inp.value.trim()) return;
      try { await sendJSON(`/api/sensors/${d.id}/msg`, "POST", { text: inp.value }); inp.value = ""; toast("다음에 기기가 연락할 때(1분 안) 화면에 떠요"); } catch (e) { fail(e); }
    };
    sensorCharts(card, d.id, store.get("snRange", 24));
  }
}
function sensorAgo(ts) {
  if (!ts) return "아직 연락 없음";
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  return m < 2 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
}
function sensorCard(d) {
  const L = d.latest || {}, stale = !d.last_seen || Date.now() / 1000 - d.last_seen > 600;
  const big = (v, u) => v == null ? `<span class="muted">—</span>` : `${(+v).toFixed(1)}<small>${u}</small>`;
  const h = store.get("snRange", 24);
  return `<section class="sn-card" data-dev="${esc(d.id)}">
    <header class="sn-head"><div><h2>${esc(d.name)}</h2><p class="small muted">${stale ? `<span class="tag bad">끊김</span> ` : ""}${esc(sensorAgo(d.last_seen))}${d.rssi != null ? ` · 와이파이 ${d.rssi} dBm` : ""}${d.fw ? ` · 펌웨어 ${esc(d.fw)}` : ""}</p></div>
      <div class="seg">${Object.entries(SENSOR_RANGE).map(([k, v]) => `<button data-h="${k}" class="${+k === h ? "on" : ""}">${v}</button>`).join("")}</div></header>
    <div class="sn-now"><div><span class="small muted">온도</span><b>${big(L.temp, "°C")}</b></div><div><span class="small muted">습도</span><b>${big(L.hum, "%")}</b></div>${L.press != null ? `<div><span class="small muted">기압</span><b>${big(L.press, "hPa")}</b></div>` : ""}</div>
    <div class="sn-charts"><div class="list-empty">그래프 불러오는 중…</div></div>
    <div class="sn-msg"><input class="inp" data-msg maxlength="60" placeholder="기기 화면에 보낼 짧은 글 (띵 소리와 함께)"><button class="btn" data-send>보내기</button></div>
  </section>`;
}
async function sensorCharts(card, id, hours) {
  const box = card.querySelector(".sn-charts");
  let s; try { s = await getJSON(`/api/sensors/${id}/series?hours=${hours}`); } catch (e) { box.innerHTML = `<div class="list-empty">${esc(e.message)}</div>`; return; }
  if (!s.ts.length) { box.innerHTML = `<div class="list-empty">이 기간 기록이 없어요</div>`; return; }
  const lab = t => { const d = new Date(t * 1000); return hours <= 24 ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}시`; };
  const x = s.ts.map(lab);
  const one = (k, title) => s.series[k] ? chartHTML(JSON.stringify({ type: "line", title, x, unit: s.metrics[k][1], series: [{ name: s.metrics[k][0], data: s.series[k] }] }), true) : "";
  box.innerHTML = one("temp", `온도 (${SENSOR_RANGE[hours] || hours + "시간"})`) + one("hum", `습도 (${SENSOR_RANGE[hours] || hours + "시간"})`);
}
