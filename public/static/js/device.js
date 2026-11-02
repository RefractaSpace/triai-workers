/* device.js — '내 컴퓨터' 도구 (윈도우 앱 안에서만 켜짐)
   · 질문할 때 앱이 알려준 도구 목록(연결 폴더·명령·화면·MCP)을 같이 보냄 → AI가 필요하면 ```tool 블록으로 요청
   · 서버가 tool_request를 보내면 → 앱에 실행을 부탁(쓰기·명령은 앱이 사람에게 허락을 받음) → 결과를 서버로 돌려줌
   · 📸 화면 캡처 버튼, Ctrl+Alt+Space 빠른 질문
   그냥 브라우저에서 열면 window.TriAIApp.runTool이 없어서 아무것도 안 함. */
(() => {
  const A = window.TriAIApp;
  const has = A && typeof A.runTool === "function";

  /* 질문에 붙일 도구 목록 (없거나 비었으면 null → 서버는 도구 안내를 안 붙임) */
  window.deviceCatalog = async () => {
    if (!has) return null;
    try {
      const c = await A.deviceCatalog();
      return c && (c.folders?.length || c.commands || c.screenshot || c.mcp?.length) ? c : null;
    } catch { return null }
  };

  /* 서버의 도구 요청 → 앱에서 실행 → 결과 돌려주기 (답 카드에 진행 상황 표시) */
  window.deviceTool = async (ev, card) => {
    let chip = null;
    if (card) {
      chip = document.createElement("div");
      chip.className = "dev-chip";
      chip.textContent = `${ev.label || ev.name} · 기다리는 중…`;
      (card.querySelector(".body") || card).after(chip);
    }
    let res;
    if (!has) res = { ok: false, text: "윈도우 앱이 아니라서 내 컴퓨터 도구를 실행할 수 없어요" };
    else {
      try { res = await A.runTool({ name: ev.name, args: ev.args || {}, label: ev.label || ev.name }) }
      catch (e) { res = { ok: false, text: "앱에서 실행하다 오류: " + (e?.message || e) } }
    }
    res = { ok: !!res?.ok, text: String(res?.text ?? ""), image: res?.image || null, denied: !!res?.denied };
    if (chip) {
      chip.textContent = `${ev.label || ev.name} · ${res.denied ? "거절함" : res.ok ? "완료" : "실패"}`;
      chip.classList.add(res.denied ? "no" : res.ok ? "ok" : "bad");
    }
    try { await api("/api/device/result", { method: "POST", body: JSON.stringify({ id: ev.id, ...res }) }) }
    catch (e) { toast("도구 결과를 서버에 못 보냈어요: " + e.message) }
  };

  if (!has) return;

  /* 📸 화면 캡처 → 첨부 */
  async function captureToAttach() {
    try {
      const b64 = await A.screenshot();
      if (!b64) return;
      state.attach.push({ name: "화면.png", kind: "image", content: b64, url: "data:image/png;base64," + b64 });
      renderAttach();
      $("#input").focus();
    } catch (e) { toast("화면을 찍지 못했어요: " + (e?.message || e)) }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const tools = document.querySelector(".comp-tools");
    if (tools && A.screenshot) {
      const b = document.createElement("button");
      b.className = "icon-btn"; b.id = "shotBtn"; b.type = "button";
      b.setAttribute("aria-label", "화면 캡처해서 첨부");
      b.title = "화면 캡처해서 첨부 — TriAI 창을 잠깐 숨기고 지금 화면을 찍어요";
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/></svg>';
      b.onclick = captureToAttach;
      tools.prepend(b);
    }
    const settings = document.getElementById("openSettings");
    if (settings && A.openDeviceSettings) {
      const d = document.createElement("button");
      d.className = "nav"; d.id = "deviceSettings"; d.style.paddingLeft = "0";
      d.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>내 컴퓨터 도구';
      d.onclick = () => A.openDeviceSettings();
      settings.before(d);
    }
  });

  /* Ctrl+Alt+Space 빠른 질문 → 새 대화로 바로 보내기 (화면 첨부 선택) */
  A.onQuickAsk?.(async ({ text, shot }) => {
    if (state.busy) return toast("답변이 끝난 뒤에 다시 해주세요.");
    newChat();
    const attach = [];
    if (shot) {
      try { const b64 = await A.screenshot(); if (b64) attach.push({ name: "화면.png", kind: "image", content: b64, url: "data:image/png;base64," + b64 }) }
      catch { }
    }
    send({ text, attach });
  });
})();
