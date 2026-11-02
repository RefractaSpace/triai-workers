/* camera.js — 📷 방 카메라 버튼 (라즈베리파이에 웹캠이 있고, 볼 권한이 있을 때만 보임)
   누르면 지금 사진을 찍어 첨부칸에 넣음 → 보내기 전에 직접 보고 지울 수 있음 */
(() => {
  window.addEventListener("DOMContentLoaded", async () => {
    let ok = false;
    try { ok = (await api("/api/cam/status")).available } catch { }
    const tools = document.querySelector(".comp-tools");
    if (!ok || !tools) return;
    const b = document.createElement("button");
    b.className = "icon-btn"; b.id = "camBtn"; b.type = "button";
    b.setAttribute("aria-label", "방 카메라로 찍어서 첨부");
    b.title = "방 카메라로 찍어서 첨부 — 보내기 전에 첨부칸에서 확인할 수 있어요";
    b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api("/api/cam/snapshot");
        state.attach.push({ name: "방카메라.jpg", kind: "image", content: r.image, url: "data:image/jpeg;base64," + r.image });
        renderAttach();
        toast("방 카메라 사진을 첨부했어요 (Claude·GPT·로컬 모델만 볼 수 있어요)");
      } catch (e) { toast("카메라: " + e.message) }
      finally { b.disabled = false }
    };
    tools.prepend(b);
  });
})();
