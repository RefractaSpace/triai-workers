/* team.js — 팀 기능 (라즈베리파이 게이트웨이 뒤에서만 보여요)
   · 사람마다 속한 팀이 달라요. 누구나 팀을 만들 수 있고(만든 사람 = 팀장), 팀장이 아이디로 팀원을 넣어요
   · 사이드바: 내 아이디·하루 한도·로그아웃, "팀" 메뉴
   · 팀 화면: 내 팀(만들기·팀원 관리), 공유된 대화(팀별), 사용량(관리자·팀장)
   · 대화 메뉴(⋯): 👥 팀에 공유 (어느 팀에 올릴지 고름)
   · 새 프로젝트·새 봇: "개인 / 팀 고르기" (projects.js·bots.js가 teamSelect를 씀)
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요. */
state.team = null;    // 게이트웨이 뒤면 {user, admin, limit, leads}
state.teams = [];     // 내가 속한 팀들

async function loadTeams(){ try{ state.teams = await getJSON("/gw/team/teams") }catch{ state.teams = [] } }

/* 새 프로젝트·새 봇 대화상자에 들어가는 "개인 / 팀" 선택 */
window.teamSelect = (id, hint) => !state.team ? "" : `<label for="${id}">어디에 만들까요? <small>— ${esc(hint)}</small></label>
  <select id="${id}"><option value="">🔒 나만 (개인)</option>${state.teams.map(t=>`<option value="${esc(t.id)}">👥 ${esc(t.name)} (${t.members.length}명)</option>`).join("")}</select>
  ${state.teams.length?"":`<p class="muted small" style="margin:4px 0 0">아직 속한 팀이 없어요. 왼쪽 "팀" 메뉴에서 팀을 만들 수 있어요.</p>`}`;

function teamInit(){   // main.js가 시작을 다 끝낸 뒤 부름 (그 전에 누르면 시작 화면이 덮어써서)
 if(!state.status?.gateway) return;   // 내 컴퓨터에서 혼자 쓸 때는 팀 기능 없음
 fetch("/gw/me").then(r=>r.ok?r.json():null).then(async me=>{
  if(!me) return;
  state.team = me; await loadTeams();
  $("#cmShare").hidden = false;
  $("#openSettings")?.insertAdjacentHTML("afterend",`<div class="small muted gw-links" style="padding:6px 0 0;display:flex;gap:10px;flex-wrap:wrap">
    <span>👤 ${esc(me.user)} · 하루 $${(+me.limit).toFixed(2)}</span>${me.admin?`<a href="/gw/admin">사람 관리</a><a href="/gw/pi" id="piLink">파이 상태</a><a href="/gw/pi/console">파이 조종실</a>`:""}<a href="/gw/logout">로그아웃</a></div>`);
  if(me.admin){ piAlerts(me.pi_alerts); setInterval(()=>{ if(!document.hidden) fetch("/gw/me").then(r=>r.ok?r.json():null).then(m=>m&&piAlerts(m.pi_alerts)).catch(()=>{}) }, 120000) }
  document.querySelector('.nav[data-go="projects"]')?.insertAdjacentHTML("afterend",
    `<button class="nav" data-go="team" id="teamNav"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 14.5c2.5 0 6 1 6 4.5"/></svg>팀</button>`);
  $("#teamNav").insertAdjacentHTML("beforeend",`<span class="badge" id="teamBadge" hidden></span>`);
  $("#teamNav").onclick=()=>{ if(state.busy) return toast("답변이 끝난 뒤에 이동하세요."); openTeam() };
  pollUnread(); setInterval(()=>{ if(!document.hidden) pollUnread() }, 45000);   // 안 읽은 수: 45초마다, 화면을 볼 때만
 }).catch(()=>{});
}

/* 파이에 문제가 생기면 (관리자만): 링크에 표시 + 새 문제는 한 번 알림 */
const piSeen=new Set();
function piAlerts(list){
  const a=$("#piLink"); if(!a) return;
  list=list||[];
  const bad=list.some(w=>w.level==="bad");
  a.textContent = list.length ? `파이 상태 ${bad?"🔴":"🟡"}${list.length}` : "파이 상태";
  a.title = list.map(w=>w.text).join("\n");
  const fresh=list.filter(w=>!piSeen.has(w.key));
  piSeen.clear(); list.forEach(w=>piSeen.add(w.key));   // 해결된 문제는 잊음 → 다시 생기면 또 알림
  if(fresh.length) toast(`${fresh[0].level==="bad"?"🔴":"🟡"} 파이: ${fresh[0].text}`+(fresh.length>1?` 외 ${fresh.length-1}개`:""));
}

/* 대화 메뉴 → 팀에 공유 */
$("#convMenu").addEventListener("click",async e=>{
  const b=e.target.closest('[data-cm="share"]'); if(!b||!state.conv) return;
  await loadTeams();
  if(!state.teams.length) return toast("먼저 팀을 만들거나 팀에 들어가야 공유할 수 있어요 (왼쪽 팀 메뉴).");
  const v=await dialog("팀에 공유",`<p class="muted small" style="margin:0 0 8px">"${esc(state.conv.title)}" 대화를 고른 팀 사람들이 <b>읽을 수 있게</b> 올려요.
    지금 시점의 사본이라, 공유한 뒤에 이어서 나눈 대화는 안 올라가요. 팀원은 자기 대화로 복사해서 이어 물을 수 있어요.<br>
    ⚠️ 첨부한 파일 내용도 같이 올라가요. 비밀 정보가 있으면 공유하지 마세요.</p>
    <label for="shTeam">어느 팀에?</label><select id="shTeam">${state.teams.map(t=>`<option value="${esc(t.id)}">👥 ${esc(t.name)} (${t.members.length}명)</option>`).join("")}</select>
    <label for="shNote">한 줄 메모 <small>— 선택</small></label><input id="shNote" maxlength="300" placeholder="예: 메카넘 주행 코드 정리한 거">`,
    [{label:"취소",value:null,kind:"ghost"},{label:"공유",value:"ok"}]);
  if(!v) return;
  try{ await sendJSON("/gw/team/shares","POST",{conv:state.conv,note:$("#shNote").value,team_id:$("#shTeam").value});
    toast("공유했어요. 팀 → 공유된 대화에서 보여요.") }catch(err){ toast(err.message) }
});

/* 팀 화면 */
async function openTeam(tab="", arg=""){
  setView("team"); await loadTeams();
  if(!tab) tab = state.teams.length ? "chat" : "teams";
  const canUsage = state.team?.admin || state.teams.some(t=>t.is_owner);
  const tabs=[["chat","채팅"],["teams","내 팀"],["shares","공유된 대화"],...(canUsage?[["usage","사용량"]]:[])];
  $("#page").innerHTML=`<div class="page"><div class="page-head"><div style="flex:1"><h1>팀</h1>
    <p>팀마다 프로젝트·봇·공유 대화를 따로 같이 써요. 대화는 각자 따로이고, 공유한 것만 그 팀이 봐요.</p></div>
    ${tab==="teams"?`<button class="btn" id="newTeam">새 팀</button>`:""}</div>
    <div class="tabs">${tabs.map(([k,n])=>`<button data-tab="${k}" class="${k===tab?"on":""}">${n}</button>`).join("")}</div>
    <div id="teamBody"><div class="thinking"><i></i><i></i><i></i></div></div></div>`;
  $(".tabs").onclick=e=>{const t=e.target.closest("[data-tab]"); if(t) openTeam(t.dataset.tab)};
  $(".tabs").querySelector('[data-tab="chat"]')?.insertAdjacentHTML("beforeend",`<span class="badge" id="chatTabBadge" hidden></span>`);
  paintUnread();
  $("#newTeam")?.addEventListener("click",newTeamDialog);
  try{ tab==="chat" ? await drawChat(arg) : tab==="usage" ? await drawUsage(arg) : tab==="shares" ? await drawShares(arg) : drawTeams() }
  catch(err){ $("#teamBody").innerHTML=`<div class="err">${esc(err.message)}</div>` }
}

async function newTeamDialog(){
  const v=await dialog("새 팀",`<label for="tn">팀 이름</label><input id="tn" maxlength="40" placeholder="예: FTC 팀, 학원 프로젝트">
    <p class="muted small" style="margin:8px 0 0">만든 사람이 팀장이에요. 만든 뒤에 팀원 아이디를 넣으면 돼요.</p>`,
    [{label:"취소",value:null,kind:"ghost"},{label:"만들기",value:"ok"}]);
  if(!v) return;
  try{ await sendJSON("/gw/team/teams","POST",{name:$("#tn").value}); openTeam("teams") }catch(err){ toast(err.message) }
}

function drawTeams(){
  const ts=state.teams;
  $("#teamBody").innerHTML = ts.length ? `<div class="grid">${ts.map(t=>`<div class="pcard" style="cursor:default">
      <b>👥 ${esc(t.name)} ${t.is_owner?`<span class="team-tag">팀장</span>`:""}</b>
      <span class="desc">${t.members.map(m=>`<span class="chip-name">${esc(m)}${m===t.owner?" 👑":""}${t.can_manage&&m!==t.owner?` <button class="x" data-rm="${esc(t.id)}|${esc(m)}" aria-label="${esc(m)} 빼기">✕</button>`:""}</span>`).join(" ")}</span>
      <span class="stat" style="display:flex;gap:6px;flex-wrap:wrap">
        ${t.can_manage?`<button class="btn ghost chip" data-add="${esc(t.id)}">+ 팀원</button><button class="btn ghost chip" data-ren="${esc(t.id)}">이름 바꾸기</button>`:""}
        <button class="btn ghost chip" data-ch="${esc(t.id)}">채팅</button>
        <button class="btn ghost chip" data-sh="${esc(t.id)}">공유된 대화</button>
        ${t.can_manage?`<button class="btn ghost chip" data-us="${esc(t.id)}">사용량</button>`:""}
        ${t.is_owner?`<button class="btn ghost chip" data-own="${esc(t.id)}">팀장 넘기기</button>`:`<button class="btn ghost chip" data-leave="${esc(t.id)}">나가기</button>`}
        ${t.can_manage?`<button class="btn ghost chip danger-text" data-del="${esc(t.id)}">팀 삭제</button>`:""}</span></div>`).join("")}</div>`
    : `<div class="empty-note">아직 속한 팀이 없어요. "새 팀"으로 만들거나, 팀장에게 내 아이디(<b>${esc(state.team.user)}</b>)를 알려주고 넣어달라고 하세요.</div>`;
  $("#teamBody").onclick=async e=>{
    const g=(a)=>e.target.closest(`[data-${a}]`)?.dataset[a];
    const T=id=>ts.find(t=>t.id===id);
    const edit=async(id,body,msg)=>{ try{ await sendJSON("/gw/team/teams/"+id,"POST",body); if(msg) toast(msg); openTeam("teams") }catch(err){ toast(err.message) } };
    let id;
    if(id=g("rm")){ const [tid,m]=id.split("|"); if(await confirmBox("팀원 빼기",`${esc(m)}을(를) "${esc(T(tid).name)}"에서 뺄까요? 그 사람은 이 팀의 프로젝트·봇·공유를 더 이상 못 봐요.`,"빼기",true)) edit(tid,{remove:m}) }
    if(id=g("add")){ const v=await dialog("팀원 넣기",`<label for="ta">아이디</label><input id="ta" maxlength="20" placeholder="게이트웨이 로그인 아이디">`,[{label:"취소",value:null,kind:"ghost"},{label:"넣기",value:"ok"}]);
      if(v) edit(id,{add:$("#ta").value.trim()},"넣었어요.") }
    if(id=g("ren")){ const v=await dialog("팀 이름",`<input id="tr" maxlength="40" value="${esc(T(id).name)}">`,[{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"ok"}]);
      if(v) edit(id,{rename:$("#tr").value}) }
    if(id=g("own")){ const others=T(id).members.filter(m=>m!==state.team.user); if(!others.length) return toast("넘길 팀원이 없어요.");
      const v=await dialog("팀장 넘기기",`<select id="to">${others.map(m=>`<option>${esc(m)}</option>`).join("")}</select>`,[{label:"취소",value:null,kind:"ghost"},{label:"넘기기",value:"ok"}]);
      if(v) edit(id,{owner:$("#to").value},"팀장을 넘겼어요.") }
    if(id=g("leave")){ if(await confirmBox("팀 나가기",`"${esc(T(id).name)}"에서 나갈까요?`,"나가기",true)) edit(id,{leave:true},"나왔어요.") }
    if(id=g("del")){ if(await confirmBox("팀 삭제",`"${esc(T(id).name)}" 팀과 그 팀의 프로젝트·봇·공유 대화가 모두 지워져요. 각자의 대화는 남아요. 되돌릴 수 없어요.`,"삭제",true)){
      try{ await api("/gw/team/teams/"+id,{method:"DELETE"}); await loadBots(); openTeam("teams") }catch(err){ toast(err.message) } } }
    if(id=g("ch")) openTeam("chat",id);
    if(id=g("sh")) openTeam("shares",id);
    if(id=g("us")) openTeam("usage",id);
  };
}

async function drawShares(teamId=""){
  const list=await getJSON("/gw/team/shares"+(teamId?`?team=${encodeURIComponent(teamId)}`:""));
  const me=state.team.user, manage=id=>state.teams.find(t=>t.id===id)?.can_manage;
  $("#teamBody").innerHTML = `<div style="margin-bottom:10px"><select class="sm" id="shFilter"><option value="">모든 팀</option>${state.teams.map(t=>`<option value="${esc(t.id)}" ${t.id===teamId?"selected":""}>👥 ${esc(t.name)}</option>`).join("")}</select></div>`
    + (list.length ? `<div class="row-list">${list.map(s=>`<div class="row" style="cursor:default">
      <span><b>${esc(s.title)}</b> <span class="team-tag">👥 ${esc(s.team_name||"")}</span>${s.note?`<br><small class="muted">${esc(s.note)}</small>`:""}</span>
      <small>${esc(s.owner)} · ${s.turns}턴 · ${ago(s.shared)}</small>
      <span style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn ghost chip" data-view="${s.id}">보기</button>
        <button class="btn ghost chip" data-copy="${s.id}" title="내 대화로 복사해서 이어 묻기">내 대화로</button>
        ${s.owner===me||manage(s.team_id)||state.team.admin?`<button class="btn ghost chip" data-del="${s.id}" aria-label="공유 삭제">✕</button>`:""}</span></div>`).join("")}</div>`
    : `<div class="empty-note">공유된 대화가 없어요. 대화 화면 오른쪽 위 ⋯ → "👥 팀에 공유"로 올릴 수 있어요.</div>`);
  $("#shFilter").onchange=e=>openTeam("shares",e.target.value);
  $("#teamBody").onclick=async e=>{
    const v=e.target.closest("[data-view]"), c=e.target.closest("[data-copy]"), d=e.target.closest("[data-del]");
    if(v){ const sh=await getJSON("/gw/team/shares/"+v.dataset.view);
      const ans=t=>t.synth?.text||Object.values(t.answers||{}).find(a=>a&&a.text)?.text||"(답 없음)";
      const who=t=>t.synth?.text?"종합":Object.values(t.answers||{}).filter(a=>a&&a.text).map(a=>a.model||a.provider).slice(0,1).join("");
      dialog(sh.title,`<p class="muted small" style="margin:0">👥 ${esc(sh.team_name)} · ${esc(sh.owner)} · ${ago(sh.shared)} 공유 · 읽기 전용</p>
        <div style="max-height:62vh;overflow:auto">${sh.conv.turns.map(t=>`<div class="share-turn"><div class="q">${esc(t.q)}</div>
          ${(t.files||[]).length?`<div class="small muted">📄 ${t.files.map(f=>esc(f.name)).join(", ")}</div>`:""}
          <div class="small muted">${esc(who(t))}</div><div class="md">${md(ans(t))}</div></div>`).join("")}</div>`,
        [{label:"닫기",value:null,kind:"ghost"},{label:"내 대화로 복사",value:"copy"}]).then(r=>{ if(r==="copy") copyShare(sh) });
      setTimeout(()=>document.querySelectorAll("#dlgPanel .md").forEach(el=>math(el)),0);
    }
    if(c) copyShare(await getJSON("/gw/team/shares/"+c.dataset.copy));
    if(d && await confirmBox("공유 삭제","팀 공유 목록에서 지울까요? (원래 대화는 그대로예요)","삭제",true)){
      try{ await api("/gw/team/shares/"+d.dataset.del,{method:"DELETE"}); drawShares(teamId) }catch(err){ toast(err.message) } }
  };
}
async function copyShare(sh){
  try{ const r=await sendJSON("/api/conversations/import","POST",{title:sh.title,turns:sh.conv.turns,owner:sh.owner});
    toast("내 대화로 복사했어요. 이어서 질문하면 돼요."); openConv(r.id) }catch(err){ toast(err.message) }
}

async function drawUsage(teamId=""){
  const leads=state.teams.filter(t=>t.can_manage);
  if(!teamId && !state.team.admin) teamId=leads[0]?.id||"";
  const rows=await getJSON("/gw/team/usage"+(teamId?`?team=${encodeURIComponent(teamId)}`:""));
  const tot=k=>rows.reduce((s,r)=>s+(r[k]||0),0);
  const max=Math.max(0.0001,...rows.flatMap(r=>r.daily));
  const NAME={claude:"Claude",gpt:"GPT",gemini:"Gemini",agent:"에이전트 팀",local:"로컬"};
  $("#teamBody").innerHTML=`<div style="margin-bottom:10px"><select class="sm" id="usFilter">${state.team.admin?`<option value="">모든 사람 (관리자)</option>`:""}
      ${leads.map(t=>`<option value="${esc(t.id)}" ${t.id===teamId?"selected":""}>👥 ${esc(t.name)}</option>`).join("")}</select></div>
    <div class="box" style="margin-bottom:14px"><h3>${teamId?esc(leads.find(t=>t.id===teamId)?.name||"팀"):"전체"}</h3>
      <p style="margin:0;font-size:15px">오늘 <b>$${tot("today").toFixed(2)}</b> · 7일 <b>$${tot("week").toFixed(2)}</b> · 30일 <b>$${tot("month").toFixed(2)}</b>
      <span class="muted small"> — 모두 관리자의 API 키에서 나가요 (한 사람이 여러 팀이면 팀마다 같은 금액이 보여요)</span></p></div>
    <div style="overflow-x:auto"><table class="usage-table"><tr><th>사람</th><th>오늘 / 하루 한도</th><th class="num">7일</th><th class="num">30일</th><th>30일 동안 (왼쪽이 오래된 날)</th><th>어디에 썼나 (30일)</th></tr>
    ${rows.map(r=>{const pct=Math.min(100,(r.today/(r.limit||1))*100);
      return `<tr><td><b>${esc(r.user)}</b>${r.agent?` <span class="team-tag">에이전트</span>`:""}</td>
        <td><div class="small">$${r.today.toFixed(2)} / $${(+r.limit).toFixed(2)}</div><div class="meter"><i class="${pct>=80?"warn":""}" style="width:${pct}%"></i></div></td>
        <td class="num">$${r.week.toFixed(2)}</td><td class="num">$${r.month.toFixed(2)}</td>
        <td><div class="spark" title="하루씩">${r.daily.map(v=>`<i style="height:${Math.max(2,v/max*100)}%" title="$${v.toFixed(3)}"></i>`).join("")}</div></td>
        <td class="small">${Object.entries(r.by).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${esc(NAME[k]||k)} $${v.toFixed(2)}`).join(" · ")||"—"}</td></tr>`}).join("")}
    </table></div><p class="muted small">하루 한도는 관리자가 ${state.team.admin?`<a href="/gw/admin">사람 관리</a>`:"사람 관리"}에서 바꿔요. 로컬(Ollama)은 무료라 0으로 보여요.</p>`;
  $("#usFilter").onchange=e=>openTeam("usage",e.target.value);
}

/* ═════════ 팀 채팅 (사람끼리) ═════════
   몇 초마다 '마지막으로 받은 번호 다음 글'만 물어봐요 (임시 터널은 실시간 연결을 못 써서).
   팀장이 켜 두면, 그 팀의 프로젝트·봇과 대화할 때 AI가 최근 채팅(2주, 약 4천 자)을 참고해요. */
const chat = { team:"", last:0, first:0, oldest:0, timer:null, readSent:0, unread:{}, msgs:[], loaded:false };

async function pollUnread(){
  if(!state.team) return;
  try{ chat.unread = await getJSON("/gw/team/chat/unread"); }catch{ return }
  paintUnread();
}
function paintUnread(){
  const total = Object.entries(chat.unread).reduce((s,[k,n])=>s+(k===chat.team&&chatOpen()?0:n),0);
  for(const id of ["teamBadge","chatTabBadge"]){ const b=document.getElementById(id); if(b){ b.hidden=!total; b.textContent=total>99?"99+":total } }
  document.querySelectorAll("#chatTeam option").forEach(o=>{ const n=chat.unread[o.value]; o.textContent=o.dataset.name+(n&&o.value!==chat.team?` (${n})`:"") });
}
const chatOpen = () => state.view==="team" && !!document.getElementById("chatList");

function chatTime(ts){
  const d=new Date(ts), t=d.toLocaleTimeString("ko-KR",{hour:"numeric",minute:"2-digit"});
  return t;
}
function chatDay(ts){ return new Date(ts).toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"}) }
function linkify(s){ return esc(s).replace(/https?:\/\/[^\s<]+/g,u=>`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`) }

function chatRow(m, prev){
  const me = m.user===state.team.user, t = state.teams.find(x=>x.id===chat.team);
  const canDel = !m.deleted && (me || t?.can_manage);
  const day = !prev || prev.ts.slice(0,10)!==m.ts.slice(0,10) ? `<div class="chat-day">${esc(chatDay(m.ts))}</div>` : "";
  const same = prev && prev.user===m.user && !day && (new Date(m.ts)-new Date(prev.ts))<5*60*1000;   // 5분 안 연속이면 이름 생략
  return `${day}<div class="chat-msg ${me?"mine":""} ${same?"cont":""}" data-id="${m.id}">
    ${!me&&!same?`<div class="chat-who">${esc(m.user)}${m.user===t?.owner?" 👑":""}</div>`:""}
    <div class="chat-line"><div class="chat-bubble ${m.deleted?"gone":""}">${m.deleted?"삭제된 메시지예요":linkify(m.text)}</div>
      <span class="chat-meta">${esc(chatTime(m.ts))}${canDel?` <button class="chat-del" data-del="${m.id}" aria-label="메시지 지우기">지우기</button>`:""}</span></div></div>`;
}

/* 새 글 확인 간격: 고정 주소(Cloudflare Worker)는 요청 1번 = 무료 한도(하루 10만) 1번이라 아껴 씀
   방금 대화가 오갔으면(1분 안) 3초 · 조용하면 15초 · 화면을 안 보고 있으면 확인 안 함 */
const CHAT_FAST=3000, CHAT_SLOW=15000, CHAT_ACTIVE_MS=60000;
function chatLoop(){
  clearTimeout(chat.timer);
  if(!chatOpen()) return;
  const wait = Date.now()-chat.active < CHAT_ACTIVE_MS ? CHAT_FAST : CHAT_SLOW;
  chat.timer=setTimeout(async()=>{ if(!chatOpen()) return; if(!document.hidden) await chatFetch(false); chatLoop() }, wait);
}

async function drawChat(teamId=""){
  clearTimeout(chat.timer);
  const ts = state.teams;
  if(!ts.length){ $("#teamBody").innerHTML=`<div class="empty-note">팀에 들어가면 팀원끼리 채팅할 수 있어요. "내 팀" 탭에서 팀을 만들어 보세요.</div>`; return }
  chat.team = teamId && ts.some(t=>t.id===teamId) ? teamId : (ts.some(t=>t.id===chat.team) ? chat.team : ts[0].id);
  const t = ts.find(x=>x.id===chat.team);
  Object.assign(chat,{last:0,first:0,oldest:0,readSent:0,msgs:[],loaded:false});
  $("#teamBody").innerHTML = `<div class="chat-wrap">
    <div class="chat-top">
      ${ts.length>1?`<select class="sm" id="chatTeam" aria-label="팀 고르기">${ts.map(x=>`<option value="${esc(x.id)}" data-name="👥 ${esc(x.name)}" ${x.id===chat.team?"selected":""}>👥 ${esc(x.name)}</option>`).join("")}</select>`:`<b>👥 ${esc(t.name)}</b>`}
      <span class="small muted">${t.members.length}명</span>
      <span class="chat-ai small" id="chatAi"></span>
    </div>
    <div class="chat-list" id="chatList" aria-live="polite"><div class="thinking"><i></i><i></i><i></i></div></div>
    <form class="chat-form" id="chatForm">
      <textarea id="chatIn" rows="1" maxlength="2000" placeholder="팀원에게 메시지" title="${touch()?"보내기 버튼으로 보내요":"Enter 보내기 · Shift+Enter 줄바꿈"}" aria-label="팀 채팅 메시지"></textarea>
      <button class="btn" id="chatSend" type="submit">보내기</button>
    </form></div>`;
  $("#chatTeam")?.addEventListener("change",e=>drawChat(e.target.value));
  const box=$("#chatIn");
  box.addEventListener("input",()=>{ box.style.height="auto"; box.style.height=Math.min(140,box.scrollHeight)+"px"; chat.active=Date.now() });
  box.addEventListener("keydown",e=>{   // 컴퓨터: Enter 보내기 · 폰: Enter 줄바꿈(보내기 버튼으로) · 한글 조합 중 Enter는 무시
    if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&!touch()){ e.preventDefault(); $("#chatForm").requestSubmit() } });
  $("#chatForm").onsubmit=async e=>{
    e.preventDefault(); const text=box.value.trim(); if(!text) return;
    $("#chatSend").disabled=true;
    try{ await sendJSON(`/gw/team/teams/${chat.team}/chat`,"POST",{text}); box.value=""; box.style.height="auto"; chat.active=Date.now(); await chatFetch(true); chatLoop() }
    catch(err){ toast(err.message) } finally{ $("#chatSend").disabled=false; box.focus() }
  };
  $("#chatList").onclick=async e=>{
    const d=e.target.closest("[data-del]");
    if(d && await confirmBox("메시지 지우기","이 메시지를 지울까요? '삭제된 메시지예요'로 바뀌고, AI도 더 이상 참고하지 않아요.","지우기",true)){
      try{ await api(`/gw/team/teams/${chat.team}/chat/${d.dataset.del}`,{method:"DELETE"}); const m=chat.msgs.find(x=>x.id==d.dataset.del); if(m){ m.deleted=true; m.text="" } chatRender("keep") }catch(err){ toast(err.message) } }
    if(e.target.closest("#chatMore")) chatOlder();
  };
  $("#chatAi").onclick=async e=>{
    const b=e.target.closest("[data-ai]"); if(!b) return;
    const on=b.dataset.ai==="1";
    if(!on && !await confirmBox("AI가 채팅 참고",`켜면 이 팀의 <b>프로젝트·봇</b>과 대화할 때 최근 2주 채팅(약 4천 자)이 AI(Claude·GPT·Gemini 등)에게 같이 보내져요. 그만큼 질문당 비용이 조금 늘어요.`,"켜기")) return;
    try{ await sendJSON("/gw/team/teams/"+chat.team,"POST",{ai_chat:!on}); await loadTeams(); paintAi() }catch(err){ toast(err.message) }
  };
  paintAi();
  document.querySelector(".page")?.classList.add("chat-mode");
  fitChat();
  await chatFetch(false);
  chat.active=Date.now(); chatLoop();
  box.focus();
}

const touch = () => matchMedia("(hover:none)").matches;
function fitChat(){   // 채팅 상자를 화면 아래 끝까지 (폰 키보드가 올라오면 그만큼 줄임)
  const w=document.querySelector(".chat-wrap"); if(!w) return;
  const vh=(window.visualViewport?.height||innerHeight);
  w.style.height=Math.max(300, vh - w.getBoundingClientRect().top - 12)+"px";
}
addEventListener("resize",fitChat); window.visualViewport?.addEventListener("resize",()=>{ fitChat(); const l=$("#chatList"); if(l&&document.activeElement?.id==="chatIn") l.scrollTop=l.scrollHeight });

function paintAi(){
  const t=state.teams.find(x=>x.id===chat.team); if(!t||!$("#chatAi")) return;
  const on=t.ai_chat!==false;
  $("#chatAi").innerHTML = `<span title="팀 프로젝트·팀 봇과 대화할 때 최근 2주 채팅을 AI가 참고해요">🤖 AI 참고 ${on?"<b>켜짐</b>":"꺼짐"}</span>`
    + (t.can_manage?` <button class="btn ghost chip" data-ai="${on?1:0}">${on?"끄기":"켜기"}</button>`:"");
}

function chatRender(mode){   // mode: "bottom" 맨 아래로 · "keep" 보던 곳 유지 · "older" 위에 붙인 만큼 내려서 유지
  const list=$("#chatList"); if(!list) return;
  const h0=list.scrollHeight, top0=list.scrollTop;
  const nearBottom = h0 - top0 - list.clientHeight < 80;
  let prev=null;
  list.innerHTML = (chat.first>chat.oldest ? `<button class="btn ghost chip" id="chatMore" style="align-self:center">이전 메시지 더 보기</button>` : "")
    + (chat.msgs.length ? chat.msgs.map(m=>{ const h=chatRow(m,prev); prev=m; return h }).join("")
       : `<div class="empty-note">아직 메시지가 없어요. 첫 메시지를 보내 보세요.</div>`);
  if(mode==="older") list.scrollTop = top0 + (list.scrollHeight-h0);
  else if(mode==="bottom" || nearBottom) list.scrollTop = list.scrollHeight;
  else list.scrollTop = top0;
}

async function chatFetch(scrollMine){
  if(!$("#chatList")) return;
  const team=chat.team;
  let r; try{ r=await getJSON(`/gw/team/teams/${team}/chat?`+(chat.last?`after=${chat.last}`:"limit=80")) }catch{ return }
  if(team!==chat.team) return;                       // 기다리는 사이 다른 팀으로 바꿨으면 버림
  const t=state.teams.find(x=>x.id===team); if(t && t.ai_chat!==r.ai_chat){ t.ai_chat=r.ai_chat; paintAi() }
  chat.oldest=r.oldest;
  const first=!chat.loaded; chat.loaded=true;
  if(r.messages.length){
    if(!first) chat.active=Date.now();   // 새 글이 왔으면 한동안 빠르게 확인
    chat.msgs.push(...r.messages.filter(m=>m.id>chat.last));
    chat.last=chat.msgs[chat.msgs.length-1].id;
    chat.first=chat.msgs[0].id;
  }
  if(first || r.messages.length) chatRender(first||scrollMine ? "bottom" : "keep");
  markRead();
}

async function chatOlder(){
  const r=await getJSON(`/gw/team/teams/${chat.team}/chat?before=${chat.first}&limit=80`);
  chat.oldest=r.oldest;
  if(r.messages.length){ chat.msgs.unshift(...r.messages); chat.first=r.messages[0].id }
  else chat.first=chat.oldest;
  chatRender("older");
}

async function markRead(){
  if(!chat.last || chat.readSent>=chat.last || document.hidden) return;
  chat.readSent=chat.last;
  try{ await sendJSON(`/gw/team/teams/${chat.team}/chat/read`,"POST",{id:chat.last}) }catch{}
  chat.unread[chat.team]=0; paintUnread();
}
document.addEventListener("visibilitychange",()=>{
  if(document.hidden) return;
  if(chatOpen()){ chat.active=Date.now(); chatFetch(false); chatLoop() } else pollUnread();   // 다시 보면 바로 확인
});
