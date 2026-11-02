/* main.js — 앱 시작 (맨 마지막에 불러와요)
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 시작 ═════════ */
(async function init(){
  try{state.status=await getJSON("/api/status")}
  catch{document.body.innerHTML='<p style="margin:auto;padding:24px">서버에 연결할 수 없어요. 터미널에서 <code>python server.py</code>가 켜져 있는지 확인하세요.</p>';return}
  if(!["all","auto"].includes(state.mode)&&!state.status.keys[state.mode]) state.mode="auto";
  await Promise.all([loadProjects(), loadBots()]); renderPicker(); setSpend(state.status.spent_today); newChat(); refreshUnread();
  try{ [state.cats,state.cands]=await Promise.all([getJSON("/api/categories"),getJSON("/api/candidates")]) }catch{ state.cats=[]; state.cands=[] }
  if(!Object.values(state.status.keys).some(Boolean)) toast("사용할 수 있는 AI가 없어요. Ollama를 켜거나 .env에 API 키를 넣고 서버를 다시 켜세요.");
  window.teamInit?.();   // 라즈베리파이 게이트웨이 뒤면 팀 메뉴·로그아웃 표시
})();

/* 앱으로 설치 (폰 홈 화면·PC 앱 목록). https 주소나 이 컴퓨터(localhost)에서만 돼요 */
if("serviceWorker" in navigator && (location.protocol==="https:"||["localhost","127.0.0.1"].includes(location.hostname))){
  navigator.serviceWorker.register("/sw.js").catch(()=>{});
}
let installEvt=null;
addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); installEvt=e; $("#installApp").hidden=false });
addEventListener("appinstalled",()=>{ $("#installApp").hidden=true; toast("앱으로 설치했어요. 홈 화면에서 열 수 있어요.") });
$("#installApp").onclick=async()=>{ if(!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt=null; $("#installApp").hidden=true };
