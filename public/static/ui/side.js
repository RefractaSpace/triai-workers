/* side.js — 왼쪽 대화 목록: 날짜별 묶음, 검색, 대화 메뉴(이름 바꾸기·프로젝트로 옮기기·내보내기·삭제) */
"use strict";

async function refreshConvs() {
  try { state.convs = await getJSON("/api/conversations"); } catch (e) { fail(e); }
  paintConvs();
}
let searchHits = null;
function paintConvs() {
  const box = $("#convs");
  if (searchHits) {
    box.innerHTML = searchHits.length ? `<h3>검색 결과</h3>` + searchHits.map(x => convRow({ id: x.id, title: x.title, sub: x.snippet })).join("")
      : `<div class="empty">찾는 대화가 없어요</div>`;
    return;
  }
  if (!state.convs.length) { box.innerHTML = `<div class="empty">아직 대화가 없어요.<br>아래 입력창에 첫 질문을 써 보세요.</div>`; return; }
  let html = "", last = "";
  for (const c of state.convs.slice(0, 400)) {
    const g = dayGroup(c.updated);
    if (g !== last) { html += `<h3>${esc(g)}</h3>`; last = g; }
    html += convRow(c);
  }
  box.innerHTML = html;
}
function convRow(c) {
  const pj = c.project_id && state.projects.find(p => p.id === c.project_id);
  return `<div class="conv${c.id === state.convId ? " on" : ""}" role="listitem" data-id="${esc(c.id)}" tabindex="0">
    <span title="${esc(c.sub || c.title)}">${esc(c.title || "제목 없음")}</span>${pj ? `<em class="pj">${esc(pj.name)}</em>` : ""}
    <button class="icon more" data-more aria-label="대화 메뉴">${ICON.more}</button></div>`;
}
$("#convs").addEventListener("click", e => {
  const row = e.target.closest(".conv"); if (!row) return;
  const c = state.convs.find(x => x.id === row.dataset.id) || { id: row.dataset.id, title: row.textContent.trim() };
  if (e.target.closest("[data-more]")) { e.stopPropagation(); convMenu(e.target.closest("[data-more]"), c); return; }
  openConv(c.id);
});
$("#convs").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("conv")) openConv(e.target.dataset.id); });

function convMenu(btn, c) {
  openMenu(btn, [
    { label: "이름 바꾸기", act: async () => {
      const v = await ask("대화 이름 바꾸기", { input: "이름", value: c.title, ok: "저장" }); if (!v?.trim()) return;
      try { await sendJSON(`/api/conversations/${c.id}`, "PATCH", { title: v.trim() }); if (state.conv?.id === c.id) { state.conv.title = v.trim(); setTitle(); } refreshConvs(); } catch (e) { fail(e); }
    } },
    { label: "프로젝트로 옮기기…", act: () => moveToProject(c) },
    { label: "마크다운으로 내려받기", act: () => { const l = document.createElement("a"); l.href = `/api/conversations/${c.id}/export`; l.download = ""; l.click(); } },
    "-",
    { label: "삭제", danger: true, act: async () => {
      if (!await ask("대화 삭제", { msg: `'${esc(c.title)}'을(를) 지울까요? 되돌릴 수 없어요.`, ok: "삭제", danger: true })) return;
      try { await sendJSON(`/api/conversations/${c.id}`, "DELETE"); if (state.convId === c.id) newChat(); refreshConvs(); toast("삭제했어요"); } catch (e) { fail(e); }
    } },
  ], { align: "end" });
}
function moveToProject(c) {
  const cur = state.convs.find(x => x.id === c.id)?.project_id ?? state.conv?.project_id ?? null;
  const go = async pid => {
    try { await sendJSON(`/api/conversations/${c.id}`, "PATCH", { move: true, project_id: pid }); if (state.conv?.id === c.id) { state.conv.project_id = pid; setTitle(); } refreshConvs(); toast(pid ? "프로젝트로 옮겼어요" : "프로젝트에서 뺐어요"); } catch (e) { fail(e); }
  };
  openMenu($("#topTitle"), [{ head: "어느 프로젝트로?" }, { label: "프로젝트 없음", on: !cur, act: () => go(null) },
    ...state.projects.map(p => ({ label: p.name, on: cur === p.id, act: () => go(p.id) }))]);
}

/* 검색 (멈추면 서버에 물어봄 — 제목·내용) */
let searchT = null;
$("#searchIn").addEventListener("input", e => {
  clearTimeout(searchT); const q = e.target.value.trim();
  if (!q) { searchHits = null; paintConvs(); return; }
  searchT = setTimeout(async () => { try { searchHits = await getJSON("/api/search?q=" + encodeURIComponent(q)); paintConvs(); } catch (err) { fail(err); } }, 300);
});

/* 좁은 화면: 목록 열고 닫기 / 넓은 화면: 접기 */
function closeSideMobile() { document.body.classList.remove("side-open"); }
$("#sideOpen").onclick = () => { if (innerWidth <= 860) document.body.classList.add("side-open"); else { document.body.classList.remove("side-hidden"); store.set("sideHidden", false); } };
$("#sideClose").onclick = () => { if (innerWidth <= 860) closeSideMobile(); else { document.body.classList.add("side-hidden"); store.set("sideHidden", true); } };
$("#scrim").onclick = closeSideMobile;
if (store.get("sideHidden", false)) document.body.classList.add("side-hidden");
$("#newChat").onclick = () => newChat();
$("#home").onclick = () => newChat();
$$(".side-nav [data-go]").forEach(b => b.onclick = () => { ({ projects: showProjects, artifacts: showArtifacts, sensors: showSensors })[b.dataset.go](); closeSideMobile(); });
$("#meBtn").onclick = () => openSettings();
