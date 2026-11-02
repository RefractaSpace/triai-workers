/* sidebar.js — 왼쪽 대화 목록·검색, 대화 열기와 새 대화
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 사이드바 대화 목록 ═════════ */
async function loadConvs(){
  const list=await getJSON("/api/conversations");
  $("#convs").innerHTML = list.length ? list.slice(0,60).map(c=>`<div class="conv ${c.id===state.convId&&state.view==="chat"?"active":""}" data-id="${c.id}">
      ${c.unread?`<i class="dot unread-dot" title="새 결과"></i>`:""}<span>${esc(c.title)}</span>${c.bot_id&&botOf(c.bot_id)?`<em class="tag">${esc(botOf(c.bot_id).emoji+" "+botOf(c.bot_id).name)}</em>`:c.project_id&&projName(c.project_id)?`<em class="tag">${esc(projName(c.project_id))}</em>`:""}</div>`).join("")
    : `<div class="conv-head" style="padding-top:4px">아직 대화가 없어요</div>`;
}
$("#convs").onclick=e=>{const c=e.target.closest(".conv[data-id]");if(c&&!state.busy)openConv(c.dataset.id)};
let searchTimer=null;
$("#searchIn").addEventListener("input",()=>{
  clearTimeout(searchTimer);
  const q=$("#searchIn").value.trim();
  if(!q){ $("#convHead").textContent="최근 대화"; return loadConvs() }
  searchTimer=setTimeout(async()=>{
    const hits=await getJSON("/api/search?q="+encodeURIComponent(q));
    if($("#searchIn").value.trim()!==q) return;
    $("#convHead").textContent=`검색 결과 ${hits.length}개`;
    const hl=t=>esc(t).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"),m=>`<mark>${m}</mark>`);
    $("#convs").innerHTML = hits.length ? hits.map(h=>`<div class="conv hit" data-id="${h.id}"><span><b>${hl(h.title)}</b>${h.snippet?`<small>${h.where}: …${hl(h.snippet)}…</small>`:""}</span></div>`).join("")
      : `<div class="conv-head" style="padding-top:4px">찾는 내용이 없어요</div>`;
  },250);
});
async function loadProjects(){ state.projects=await getJSON("/api/projects"); }
/* ═════════ 대화 열기/새로 ═════════ */
async function openConv(id){
  state.conv=await getJSON("/api/conversations/"+id); state.convId=id;
  if(state.conv.unread){ api(`/api/conversations/${id}/read`,{method:"POST"}).then(refreshUnread); state.conv.unread=false }
  setView("chat"); $("#thread").innerHTML="";
  state.conv.turns.forEach((t,i)=>renderTurn(t,i));
  loadConvs(); scrollDown(true);
}
function newChat(projectId=null){
  state.convId=null; state.conv=null; state.projectId=projectId; state.botId=null; $("#thread").innerHTML="";
  $("#empty h1").textContent = projectId ? `${projName(projectId)}에서 새 대화` : "무엇을 물어볼까요?";
  setView("home"); loadConvs(); $("#input").focus();
}
$("#newChat").onclick=()=>{if(!state.busy)newChat()};
$("#toggleSide").onclick=e=>{e.stopPropagation();$("#side").classList.toggle("hidden")};
$("#scrim").onclick=()=>$("#side").classList.add("hidden");   // 폰: 서랍 바깥을 누르면 닫힘
$("#convs").addEventListener("click",()=>{ if(innerWidth<760) $("#side").classList.add("hidden") });   // 폰: 대화를 고르면 서랍 닫기

/* 대화 메뉴 (⋯) */
$("#convMenuBtn").onclick=e=>{e.stopPropagation();$("#menu").classList.remove("open");$("#convMenu").classList.toggle("open")};
$("#convMenu").onclick=async e=>{
  const b=e.target.closest("[data-cm]"); if(!b||!state.conv) return;
  const c=state.conv;
  if(b.dataset.cm==="rename"){
    const v=await dialog("대화 이름 바꾸기",`<input id="dv" value="${esc(c.title)}" maxlength="80">`,[{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"ok"}]);
    const t=$("#dv")?.value.trim(); if(v&&t){ state.conv=await sendJSON(`/api/conversations/${c.id}`,"PATCH",{title:t}); loadConvs(); toast("이름을 바꿨어요.") }
  }
  if(b.dataset.cm==="move"){
    await loadProjects();
    const opts=`<option value="">프로젝트 없음</option>`+state.projects.map(p=>`<option value="${p.id}" ${p.id===c.project_id?"selected":""}>${esc(p.name)}</option>`).join("");
    const v=await dialog("프로젝트로 옮기기",`<p class="muted small" style="margin:0 0 8px">옮기면 다음 질문부터 그 프로젝트의 지침과 파일이 적용돼요.</p><select id="dv">${opts}</select>`,[{label:"취소",value:null,kind:"ghost"},{label:"옮기기",value:"ok"}]);
    if(v){ const pid=$("#dv").value||null; state.conv=await sendJSON(`/api/conversations/${c.id}`,"PATCH",{move:true,project_id:pid});
      setView("chat"); loadConvs(); toast(pid?`"${projName(pid)}"로 옮겼어요.`:"프로젝트에서 뺐어요.") }
  }
  if(b.dataset.cm==="export"){ location.href=`/api/conversations/${c.id}/export`; return }
  if(b.dataset.cm==="archive"){
    const arc=await getJSON(`/api/conversations/${c.id}/archive`);
    const first=t=>{const a=Object.values(t.answers||{}).find(x=>x&&x.text); return a?a.text.slice(0,300):"(답 없음)"};
    const body = arc.length ? arc.map(v=>`<details class="arc"><summary><b>${v.time.replace("T"," ").slice(0,16)}</b> · ${v.from+1}번째 질문부터 ${v.turns.length}턴</summary>
        ${v.turns.map(t=>`<div class="arc-turn"><div class="arc-q">${esc(t.q)}</div><div class="md small">${md(first(t))}</div></div>`).join("")}</details>`).join("")
      : `<p class="muted" style="margin:0">보관된 이전 버전이 없어요. 편집하거나 다시 생성하면 원래 대화가 여기 남아요.</p>`;
    dialog("보관함", `<div style="max-height:60vh;overflow:auto">${body}</div>`, [{label:"닫기",value:null}]);
    return;
  }
  if(b.dataset.cm==="delete"){
    if(await confirmBox("대화 삭제",`"${esc(c.title)}" 대화를 삭제할까요? 되돌릴 수 없어요. (자동 백업에는 남아 있을 수 있어요)`,"삭제",true)){
      await api("/api/conversations/"+c.id,{method:"DELETE"}); const pid=c.project_id; pid?openProject(pid):newChat(); toast("삭제했어요.") }
  }
};
