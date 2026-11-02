/* main.js — 시작: 내 정보·상태·목록 불러오기 → 주소에 맞는 화면 열기 */
"use strict";

async function route(push = false) {
  const q = new URLSearchParams(location.search);
  if (q.get("c")) return openConv(q.get("c"), { push });
  if (q.get("v") === "projects") return showProjects(push);
  if (q.get("v") === "artifacts") return showArtifacts(push);
  if (q.get("v") === "sensors") return showSensors(push);
  if (q.get("p") && q.get("v") === "project") return showProject(q.get("p"), push);
  newChat({ projectId: q.get("p") || null, push });
}
addEventListener("popstate", () => route(false));

(async function boot() {
  try {
    const [me, status] = await Promise.all([getJSON("/gw/me"), getJSON("/api/status")]);
    state.me = me; state.status = status;
  } catch (e) { fail(e); return; }
  $("#meName").textContent = state.me.user;
  $("#avatar").textContent = (state.me.user || "?").slice(0, 1).toUpperCase();
  setSpend(state.status.spent_today);
  // 키가 없어진 AI를 고르고 있었다면 자동으로
  if (PROV[state.pick] && !hasKey(state.pick)) state.pick = "auto";
  const [convs, projects, modes, presets, styles] = await Promise.all(["/api/conversations", "/api/projects", "/api/modes", "/api/presets", "/api/styles"]
    .map(p => getJSON(p).catch(() => [])));
  Object.assign(state, { convs, projects, modes, presets, styles });
  if (!presets.some(p => p.id === state.preset)) state.preset = "default";
  paintPick(); paintConvs(); autoGrow();
  if (localOn()) listLocal();   // 내 컴퓨터의 로컬 모델 (뒤에서 조용히)
  await route(false);
  if (!CHAT_PROVS.some(hasKey)) toast("아직 쓸 수 있는 AI가 없어요 — 관리자가 API 키 비밀값을 넣어야 해요", 8000);
})();

// 앱으로 설치(PWA) — 서비스 워커는 아무것도 저장하지 않고 '연결 안 됨' 안내만 함
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname)))
  navigator.serviceWorker.register("/sw.js").catch(() => {});

// 키보드: ⌘/Ctrl+K 새 대화, / 입력창으로
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
  else if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !$("#sheet").open) { e.preventDefault(); input.focus(); }
});
