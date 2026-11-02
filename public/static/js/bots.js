/* bots.js — 봇 목록·상세, 기억, 루틴, 넘기기 흐름 보기
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 봇 ═════════ */
const botOf = id => (state.bots||[]).find(b=>b.id===id);
async function loadBots(){ try{ state.bots=await getJSON("/api/bots") }catch{ state.bots=[] } }
async function refreshUnread(){
  try{ const u=await getJSON("/api/bots-unread"); const b=$("#botBadge"); b.hidden=!u.total; b.textContent=u.total;
    if(u.total && state.view!=="chat") loadConvs(); }catch{}
}
setInterval(refreshUnread, 30000);
const modelLabel = k => !k||k==="auto" ? "자동 선택" : nameOf(k);
function modelOptions(cur){
  return `<option value="auto" ${!cur||cur==="auto"?"selected":""}>자동 선택 (질문마다 알아서)</option>`+(state.cands||[]).map(c=>
    `<option value="${esc(c.key)}" ${c.key===cur?"selected":""}>${esc(c.name)}</option>`).join("");
}

async function openBots(){
  await loadBots(); setView("bots");
  $("#page").innerHTML=`<div class="page"><div class="page-head"><div style="flex:1"><h1>봇</h1>
    <p>이름과 역할이 있는 AI 팀원이에요. 봇마다 대화방·기억·루틴(예약 작업)이 따로 있고, 서로 일을 넘겨줄 수 있어요.</p></div>
    <button class="btn" id="newBot">새 봇</button></div>
    <div class="grid" id="bgrid">${state.bots.length?state.bots.map(b=>`<button class="pcard" data-bid="${b.id}">
      <b><span class="bot-emoji">${esc(b.emoji)}</span>${esc(b.name)}${b.team?` <span class="team-tag" title="이 팀 사람들이 역할·기억을 같이 써요">👥 ${esc(b.team_name||"팀")}</span>`:""}${b.unread?` <span class="badge">${b.unread}</span>`:""}</b>
      <span class="desc">${esc(b.role)||"역할 지침 없음"}</span>
      <span class="stat">${esc(modelLabel(b.model))} · 대화 ${b.conv_count} · 기억 ${b.memory.length} · 루틴 ${b.routines}</span></button>`).join("")
      : `<div class="empty-note" style="grid-column:1/-1">아직 봇이 없어요. "새 봇"에서 코드 리뷰어, 개념 선생님 같은 봇을 만들어보세요.</div>`}</div></div>`;
  $("#newBot").onclick=()=>botDialog();
  $("#bgrid").onclick=e=>{const c=e.target.closest("[data-bid]"); if(c) openBot(c.dataset.bid)};
}
async function botDialog(bot=null){
  const tpls = bot ? [] : await getJSON("/api/bots/templates").catch(()=>[]);
  const v=await dialog(bot?"봇 편집":"새 봇",`
    ${tpls.length?`<label>빠른 시작</label><div class="tpl-row">${tpls.map((t,i)=>`<button type="button" class="btn ghost chip" data-tpl="${i}">${esc(t.emoji+" "+t.name)}</button>`).join("")}</div>`:""}
    <div style="display:flex;gap:8px"><div style="width:80px"><label for="bE">이모지</label><input id="bE" value="${esc(bot?.emoji||"🤖")}" maxlength="4"></div>
      <div style="flex:1"><label for="bN">이름</label><input id="bN" value="${esc(bot?.name||"")}" maxlength="30" placeholder="예: 코드 리뷰어"></div></div>
    <label for="bR">역할 지침 <small>— 이 봇이 항상 따를 성격·규칙</small></label><textarea id="bR" rows="5" placeholder="예: 너는 꼼꼼한 코드 리뷰어야. 버그부터 짚어줘.">${esc(bot?.role||"")}</textarea>
    <label for="bM">담당 모델 <small>— 정하면 이 봇은 항상 그 모델로 답해요</small></label><select id="bM">${modelOptions(bot?.model)}</select>
    <label class="check-row"><input type="checkbox" id="bA" ${bot?.auto_handoff===false?"":"checked"}> 필요하면 다른 봇에게 스스로 넘기기</label>
    ${!bot?(window.teamSelect?.("bT","팀 봇으로 — 그 팀 사람들이 역할·기억을 같이 써요 (대화는 각자)")||""):""}
    ${bot?.team?`<p class="muted small" style="margin:4px 0 0">👥 ${esc(bot.team_name||"")} 팀 봇 · 만든 사람 ${esc(bot.owner||"?")} · 고치면 팀원 모두에게 바로 적용돼요</p>`:""}
    <p class="muted small" style="margin:4px 0 0">봇이 다른 봇의 역할이 더 맞다고 판단하면 알아서 넘겨요. 한 흐름에 최대 3번, 되돌아오기 없음.</p>`,
    bot ? [{label:"봇 삭제",value:"delete",kind:"danger",left:true},{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"save"}]
        : [{label:"취소",value:null,kind:"ghost"},{label:"만들기",value:"save"}]);
  if(v==="save"){
    const body={name:$("#bN").value,emoji:$("#bE").value,role:$("#bR").value,model:$("#bM").value,auto_handoff:$("#bA").checked,team_id:$("#bT")?.value||null};
    try{ const b = bot ? await sendJSON(`/api/bots/${bot.id}`,"PUT",body) : await sendJSON("/api/bots","POST",body);
      await loadBots(); openBot(b.id) }catch(err){ toast(err.message) }
  }
  if(v==="delete" && await confirmBox("봇 삭제",`"${esc(bot.name)}" 봇과 루틴을 삭제할까요? 대화는 일반 대화로 남아요.`,"삭제",true)){
    await api(`/api/bots/${bot.id}`,{method:"DELETE"}); await loadBots(); openBots(); loadConvs();
  }
}
document.addEventListener("click",e=>{   // 새 봇 대화상자의 빠른 시작 버튼
  const t=e.target.closest("[data-tpl]"); if(!t) return;
  getJSON("/api/bots/templates").then(ts=>{const x=ts[+t.dataset.tpl]; $("#bE").value=x.emoji; $("#bN").value=x.name; $("#bR").value=x.role});
});

async function openBot(bid){
  let b; try{ b=await getJSON("/api/bots/"+bid) }catch(err){ toast(err.message); return openBots() }
  const routines=await getJSON("/api/routines?bot="+bid);
  state.botId=bid; state.projectId=null; state.convId=null; state.conv=null;
  setView("bot");
  const when = iso => iso ? iso.replace("T"," ").slice(5,16) : "—";
  $("#page").innerHTML=`<div class="page">
    <button class="crumb" id="backBots" style="margin-left:-8px">← 모든 봇</button>
    <div class="page-head"><div style="flex:1;min-width:0"><h1><span class="bot-emoji">${esc(b.emoji)}</span>${esc(b.name)}</h1><p>${esc(modelLabel(b.model))}</p></div>
      <button class="btn ghost" id="editBot">편집</button></div>
    <div class="pj">
      <div class="pj-main">
        <div id="botComposer"></div>
        <div><div class="muted small" style="margin:4px 12px 6px">대화방 ${b.convs.length}개</div>
          <div class="row-list" id="bconvs">${b.convs.length?b.convs.map(c=>`<button class="row" data-cid="${c.id}">${c.unread?`<i class="dot unread-dot"></i>`:""}<span>${esc(c.title)}</span><small>${c.turns}턴 · ${ago(c.updated)}</small></button>`).join("")
            :`<div class="empty-note">위 입력창에 일을 맡기면 이 봇의 대화방이 생겨요.</div>`}</div></div>
      </div>
      <div class="pj-side">
        <div class="box"><h3>역할 지침<span class="spacer"></span><button class="btn ghost" id="saveRole" style="padding:3px 10px;font-size:13px" disabled>저장</button></h3>
          <textarea id="roleTa" placeholder="이 봇이 항상 따를 성격·규칙">${esc(b.role)}</textarea></div>
        <div class="box"><h3>기억 <small class="muted" style="font-weight:400">${b.memory.length}개</small></h3>
          <p class="muted small" style="margin:0 0 6px">대화에서 "기억해: …"라고 말하거나, 답변 아래 🧠로 추가돼요.</p>
          <div id="memList">${b.memory.length?b.memory.map(m=>`<div class="file"><span title="${esc(m.text)}">${esc(m.text)}</span><button data-mdel="${m.id}" aria-label="지우기">✕</button></div>`).join(""):`<p class="muted small" style="margin:0">아직 기억이 없어요.</p>`}</div>
          <div class="actions"><input class="sm" id="memIn" placeholder="직접 추가" style="flex:1"><button class="btn ghost" id="memAdd">추가</button></div></div>
        <div class="box"><h3>루틴<span class="spacer"></span><button class="btn ghost" id="addRt" style="padding:3px 10px;font-size:13px">+ 루틴</button></h3>
          <p class="muted small" style="margin:0 0 6px">정해진 시각에 봇이 혼자 일해요. 이 앱(server.py)이 켜져 있을 때만 실행돼요.</p>
          <div id="rtList">${routines.length?routines.map(r=>`<div class="rt ${r.enabled?"":"off"}">
            <div class="rt-head"><b>${esc(r.name)}</b><span class="pill">${esc(r.when)}</span></div>
            <div class="small muted">다음 ${when(r.next_run)}${r.last_run?` · 지난번 <span style="color:${r.last_run.ok?"var(--ok)":"var(--danger)"}">${esc(r.last_run.msg)}</span>`:""}${r.then_name?` · 끝나면 → ${esc(r.then_name)}`:""}</div>
            <div class="rt-btns"><button data-rrun="${r.id}">지금 실행</button><button data-redit="${r.id}">편집</button><button data-rtog="${r.id}">${r.enabled?"끄기":"켜기"}</button><button data-rdel="${r.id}">삭제</button></div></div>`).join("")
            :`<p class="muted small" style="margin:0">예: 매일 아침 8시 "오늘 공부 계획 짜줘"</p>`}</div></div>
      </div></div></div>`;
  $("#botComposer").append($("#composer-wrap"));
  $("#input").placeholder=`${b.name}에게 일 맡기기`; $("#input").focus();
  $("#backBots").onclick=openBots;
  $("#editBot").onclick=()=>botDialog(b);
  $("#bconvs").onclick=e=>{const r=e.target.closest("[data-cid]"); if(r) openConv(r.dataset.cid)};
  const ta=$("#roleTa"), sv=$("#saveRole");
  ta.oninput=()=>sv.disabled=ta.value===b.role;
  sv.onclick=async()=>{ try{ await sendJSON(`/api/bots/${bid}`,"PUT",{name:b.name,emoji:b.emoji,role:ta.value,model:b.model,auto_handoff:b.auto_handoff!==false}); b.role=ta.value; sv.disabled=true; loadBots(); toast("역할을 저장했어요.") }catch(err){toast(err.message)} };
  $("#memAdd").onclick=async()=>{ const t=$("#memIn").value.trim(); if(!t) return; await sendJSON(`/api/bots/${bid}/memory`,"POST",{text:t}); openBot(bid) };
  $("#memIn").onkeydown=e=>{ if(e.key==="Enter") $("#memAdd").click() };
  $("#memList").onclick=async e=>{ const d=e.target.closest("[data-mdel]"); if(d){ await api(`/api/bots/${bid}/memory/${d.dataset.mdel}`,{method:"DELETE"}); openBot(bid) } };
  $("#addRt").onclick=()=>routineDialog(bid);
  $("#rtList").onclick=async e=>{
    const id=k=>e.target.closest(`[data-${k}]`)?.dataset[k];
    const r=routines.find(x=>x.id===(id("rrun")||id("redit")||id("rtog")||id("rdel")));
    if(!r) return;
    if(id("rrun")){ await api(`/api/routines/${r.id}/run`,{method:"POST"}); toast("뒤에서 실행 중이에요. 끝나면 새 결과 표시가 떠요."); setTimeout(()=>{refreshUnread(); if(state.view==="bot"&&state.botId===bid) openBot(bid)},6000) }
    if(id("redit")) routineDialog(bid, r);
    if(id("rtog")){ await sendJSON(`/api/routines/${r.id}`,"PUT",{...r,enabled:!r.enabled}); openBot(bid) }
    if(id("rdel") && await confirmBox("루틴 삭제",`"${esc(r.name)}" 루틴을 삭제할까요? 지금까지의 결과 대화는 남아요.`,"삭제",true)){ await api(`/api/routines/${r.id}`,{method:"DELETE"}); openBot(bid) }
  };
}
async function routineDialog(bid, r=null){
  const s=r?.schedule||{type:"daily",time:"08:00"};
  const days=["월","화","수","목","금","토","일"];
  const others=(state.bots||[]).filter(b=>b.id!==bid);
  const v=await dialog(r?"루틴 편집":"새 루틴",`
    <label for="rN">이름</label><input id="rN" value="${esc(r?.name||"")}" placeholder="예: 아침 공부 계획">
    <label for="rP">할 일 <small>— 봇에게 보낼 메시지</small></label><textarea id="rP" rows="3" placeholder="예: 오늘 공부할 것 3가지와 순서를 정해줘">${esc(r?.prompt||"")}</textarea>
    <label for="rT">언제</label><select id="rT"><option value="daily">매일</option><option value="weekly">매주 (요일 선택)</option><option value="interval">일정 간격마다</option></select>
    <div id="rTime"><label for="rH">시각</label><input id="rH" type="time" value="${s.time||"08:00"}"></div>
    <div id="rDays" class="day-row">${days.map((d,i)=>`<label><input type="checkbox" class="rd" value="${i}" ${(s.days||[0,1,2,3,4]).includes(i)?"checked":""}> ${d}</label>`).join("")}</div>
    <div id="rInt"><label for="rM">간격 (분, 5 이상)</label><input id="rM" type="number" min="5" step="5" value="${s.minutes||60}"></div>
    <label for="rNext">끝나면 넘길 봇 <small>— 선택</small></label><select id="rNext"><option value="">없음</option>${others.map(b=>`<option value="${b.id}" ${b.id===r?.then_bot_id?"selected":""}>${esc(b.emoji+" "+b.name)}</option>`).join("")}</select>`,
    [{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"ok"}], ()=>{ $("#rT").value=s.type; $("#rT").dispatchEvent(new Event("change",{bubbles:true})) });
  if(!v) return;
  const t=$("#rT").value;
  const schedule = t==="interval" ? {type:t,minutes:+$("#rM").value} : t==="weekly" ? {type:t,time:$("#rH").value,days:[...document.querySelectorAll(".rd:checked")].map(c=>+c.value)} : {type:t,time:$("#rH").value};
  const body={bot_id:bid,name:$("#rN").value,prompt:$("#rP").value,schedule,then_bot_id:$("#rNext").value||null,enabled:r?r.enabled:true};
  try{ r ? await sendJSON(`/api/routines/${r.id}`,"PUT",body) : await sendJSON("/api/routines","POST",body); toast("루틴을 저장했어요."); openBot(bid) }
  catch(err){ toast(err.message) }
}
document.addEventListener("change",e=>{   // 루틴 대화상자: 반복 방식에 맞는 칸만 보이기
  if(e.target.id!=="rT") return;
  const t=e.target.value; $("#rTime").hidden=t==="interval"; $("#rDays").hidden=t!=="weekly"; $("#rInt").hidden=t!=="interval";
});

async function showFlow(id){
  const f=await getJSON(`/api/chains/${id}`);
  const steps=f.steps.map((s,i)=>`<div class="flow-step">
      <div class="flow-head"><b>${esc(s.bot)}</b><span class="muted small">${s.hop?`${s.hop}번째 넘김`:"시작"} · ${s.time.slice(11,16)}</span>
        <button class="btn ghost chip" data-open="${s.conv_id}">대화 열기</button></div>
      <div class="small muted">${esc(s.answer)}${s.answer.length>=200?"…":""}</div>
      ${s.handoff?`<div class="handoff ${s.handoff.status}">${s.handoff.status==="sent"?`↓ ${esc(s.handoff.to_name)}에게 넘김${s.handoff.note?` · "${esc(s.handoff.note)}"`:""}`:`넘기려 했지만 멈춤: ${esc(s.handoff.reason)}`}</div>`:""}
    </div>`).join("");
  const v=await dialog(`넘기기 흐름 ${f.running?"(진행 중)":""}`,`<p class="muted small" style="margin:0 0 8px">한 흐름에서 최대 ${f.max}번까지 넘기고, 이미 일한 봇에게는 되돌아가지 않아요.</p>
    <div class="flow">${steps||'<p class="muted">아직 기록이 없어요.</p>'}</div>`,
    f.running?[{label:"흐름 중지",value:"stop",kind:"danger",left:true},{label:"닫기",value:null}]:[{label:"닫기",value:null}],
    ()=>{ document.querySelectorAll("#dlgPanel [data-open]").forEach(b=>b.onclick=()=>{ $("#dlg").classList.remove("open"); openConv(b.dataset.open) }) });
  if(v==="stop"){ await api(`/api/chains/${id}/stop`,{method:"POST"}); toast("흐름을 중지했어요. 지금 답하던 봇도 멈춰요.") }
}
document.addEventListener("click",e=>{ const f=e.target.closest("[data-flow]"); if(f&&f.dataset.flow&&f.dataset.flow!=="null"){ e.stopPropagation(); showFlow(f.dataset.flow) } }, true);
