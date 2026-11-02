/* app-bridge.js — 안드로이드·윈도우 앱 안에서 열렸을 때만 켜지는 연결 고리
   앱이 window.TriAIApp 을 넣어줌 → 여기서 '서버 바꾸기' 버튼, 폰 읽어주기, 복사, 저장을 앱 기능으로 바꿔 끼움.
   그냥 브라우저에서 열면 TriAIApp이 없어서 아무것도 안 함. */
(() => {
  const A = window.TriAIApp;
  if (!A) return;
  const platform = String(A.platform?.() || "app");
  const T = () => window.__triaiTok || "";   // 앱이 메인 화면에만 넣어주는 이번 실행용 비밀값
  document.documentElement.classList.add("in-app", "in-" + platform);

  if (platform === "android") {
    // 안드로이드 WebView에는 브라우저 읽어주기(speechSynthesis)가 없음 → 폰 TTS로 대신
    let cur = null;
    window.__triaiSpeechEnd = () => { const u = cur; cur = null; u?.onend?.() };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text || ""; this.lang = "ko-KR"; this.rate = 1 } };
    const shim = {
      speak(u) { cur = u; A.speak(T(), String(u.text), Number(u.rate) || 1) },
      cancel() { const u = cur; cur = null; A.stopSpeak(T()); u?.onend?.() },
      get speaking() { return !!cur },
      getVoices() { return [{ lang: "ko-KR", name: "Android" }] },
    };
    Object.defineProperty(window, "speechSynthesis", { value: shim, configurable: true });
    // 복사: WebView에서 clipboard API가 막힐 때가 있어서 앱으로
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: { writeText: t => { A.copy(T(), String(t)); return Promise.resolve() }, readText: () => Promise.resolve("") } });
    } catch { }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style"); st.textContent = "#installApp{display:none!important}";   // 이미 앱이라 '앱으로 설치'는 필요 없음
    document.head.append(st);
    const settings = document.getElementById("openSettings");
    if (settings && A.changeServer) {
      const b = document.createElement("button");
      b.className = "nav"; b.id = "changeServer"; b.style.paddingLeft = "0";
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>서버 바꾸기';
      b.onclick = () => A.changeServer(T());
      settings.before(b);
    }
  });
})();
