/* agents.js — 콘솔 에이전트 팀: 설정 화면에 '질문당 예산'과 '일할 환경' 항목 추가
   (에이전트 고르기는 위쪽 모델 선택 → 에이전트 팀, 어떤 에이전트인지는 설정 → 모델 → 목록 불러오기)
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요. */
new MutationObserver(() => {
  const box = document.getElementById("featSettings");
  if (!box || document.getElementById("agSet")) return;
  const s = state.status?.settings || {};
  box.insertAdjacentHTML("beforeend", `<div id="agSet">
    <h3 class="set-h">콘솔 에이전트 팀</h3>
    <label for="agBudget">질문 1개당 최대 금액 (USD) <small>— 에이전트가 이만큼 쓰면 그 자리에서 멈춰요. 하루 예산 한도도 같이 지켜요</small></label>
    <input id="agBudget" type="number" min="0.05" max="50" step="any" value="${s.agent_budget ?? 2}">
    <label for="agEnv">일할 환경 <small>— safe-limited: 허용한 사이트만 · open-research: 인터넷 전체 (비밀 정보는 넣지 마세요)</small></label>
    <select id="agEnv"><option value="">자동 (safe-limited 먼저)</option>${s.agent_env ? `<option value="${esc(s.agent_env)}" selected>${esc(s.agent_env)}</option>` : ""}</select></div>`);
  if (state.status?.keys?.agent) getJSON("/api/agents").then(d => {
    const sel = document.getElementById("agEnv"); if (!sel) return;
    sel.innerHTML = `<option value="">자동 (safe-limited 먼저)</option>` + (d.envs || []).map(e =>
      `<option value="${esc(e.name)}" ${e.name === s.agent_env || e.id === s.agent_env ? "selected" : ""}>${esc(e.name)}</option>`).join("");
  }).catch(() => {});
}).observe(document.body, { childList: true, subtree: true });
window.agentSettingsValues = () => document.getElementById("agBudget") ? {
  agent_budget: Math.max(0.05, Math.min(50, +$("#agBudget").value || 2)),
  agent_env: $("#agEnv").value } : {};
