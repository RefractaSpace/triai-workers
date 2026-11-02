/* sw.js — 폰·PC에 '앱으로 설치'하기 위한 서비스 워커
   · 항상 서버에서 새로 받아요 (아무것도 저장하지 않음 → 옛 화면이 남는 문제 없음, 대화가 기기에 안 남음)
   · 인터넷이 끊기면 빈 화면 대신 '연결 안 됨' 안내를 보여줘요 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).then(() => self.clients.claim()));   // 예전 버전이 저장한 것 정리
});
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TriAI</title>
<body style="font-family:system-ui,sans-serif;background:#fff;color:#1D1D1F;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center">
<div><h1 style="font-size:20px">TriAI 서버에 연결할 수 없어요</h1><p style="color:#667085;line-height:1.7">인터넷이 연결돼 있는지 확인하세요.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border:0;border-radius:10px;background:#0071E3;color:#fff">다시 시도</button>
<button id="cs" hidden onclick="TriAIApp.changeServer(window.__triaiTok||'')" style="font:inherit;padding:10px 18px;border:1px solid #C9D0DB;border-radius:10px;background:#fff;color:#1A2233;margin-left:6px">서버 바꾸기</button>
<script>if(window.TriAIApp)document.getElementById("cs").hidden=false</script></div></body>`;
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;   // 화면 이동(주소 열기)만 맡고 나머지는 브라우저가 그대로
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
