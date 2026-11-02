/* composer.js — 입력창: 파일·이미지 첨부, 보내기와 스트리밍 받기
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 첨부 ═════════ */
state.attach=[];   // [{name, kind:"text"|"image"|"image_ref", content, url?}]
const IMG_RE=/\.(png|jpe?g|gif|webp|bmp)$/i;
function renderAttach(){
  const row=$("#attachRow"); row.hidden=!state.attach.length;
  row.innerHTML=state.attach.map((a,i)=>`<span class="att-chip">${a.kind==="text"?"📄":a.kind==="pdf"?"📕":a.kind==="file"?"📦":`<img src="${a.url||"/api/uploads/"+a.content}" alt="">`} ${esc(a.name)}
    <button data-rm="${i}" aria-label="첨부 빼기">✕</button></span>`).join("");
}
$("#attachRow").onclick=e=>{const b=e.target.closest("[data-rm]"); if(b){state.attach.splice(+b.dataset.rm,1);renderAttach()}};
/* 파일 1개 → 첨부 형태로
   이미지 → 그대로 / PDF → 서버가 글자 추출 / 글자·코드 → 그대로
   zip·STL·STEP → 서버가 글로 변환 (/api/convert: zip 안의 파일 내용, 3D 모델의 크기·부피 등) */
const CONVERT_EXT=/\.(zip|stl|step|stp)$/i;
const b64Of=f=>new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(String(fr.result).split(",")[1]||"");fr.onerror=()=>no(new Error("파일을 못 읽었어요"));fr.readAsDataURL(f)});
async function fileToAttachment(f,{images=true}={}){
  if(images&&(f.type.startsWith("image/")||IMG_RE.test(f.name))){
    if(f.size>8e6) throw new Error("이미지는 8MB까지예요");
    const content=await b64Of(f); return {name:f.name,kind:"image",content,url:`data:${f.type||"image/png"};base64,${content}`};
  }
  if(/\.pdf$/i.test(f.name)||f.type==="application/pdf"){
    if(f.size>30e6) throw new Error("PDF는 30MB까지예요");
    return {name:f.name,kind:"pdf",content:await b64Of(f)};
  }
  if(CONVERT_EXT.test(f.name)&&state.mode==="agent"){   // 에이전트는 원본을 직접 열어보니 변환 필요 없음
    if(f.size>100e6) throw new Error("에이전트에게 보내는 파일은 100MB까지예요");
    return {name:f.name,kind:"file",content:"",orig:await b64Of(f)};
  }
  if(CONVERT_EXT.test(f.name)){
    if(f.size>50e6) throw new Error("50MB까지예요");
    const orig=await b64Of(f);
    const r=await sendJSON("/api/convert","POST",{name:f.name,content:orig});
    return {name:f.name,kind:"text",content:r.content,raw:!!r.raw,orig};   // orig: 에이전트 팀에게는 원본 파일을 그대로
  }
  if(TEXT_EXT.test(f.name)||f.type.startsWith("text/")){
    const text=await f.text();
    if(text.includes("\u0000")) throw new Error("텍스트 파일이 아니에요");
    if(text.length>200000) throw new Error("너무 커요 (20만 자까지)");
    return {name:f.name,kind:"text",content:text};
  }
  if(state.mode==="agent"){   // 에이전트 팀은 어떤 파일이든 원본 그대로 작업 공간에 받아서 직접 열어봄
    if(f.size>100e6) throw new Error("에이전트에게 보내는 파일은 100MB까지예요");
    return {name:f.name,kind:"file",content:"",orig:await b64Of(f)};
  }
  throw new Error("텍스트·코드·PDF·이미지·zip·STL·STEP 파일만 첨부할 수 있어요 (Word는 PDF로 저장해서 · 에이전트 팀을 고르면 어떤 파일이든 원본으로 보낼 수 있어요)");
}
async function addFiles(files){
  for(const f of files){
    if(state.attach.length>=8){toast("첨부는 8개까지예요");break}
    try{ const a=await fileToAttachment(f); state.attach.push(a);
      if(a.kind==="file") toast(`${f.name} → 에이전트 팀 작업 공간에 원본으로 보내요 (다른 AI에게는 안 보여요)`);
      else if(a.raw) toast(`${f.name} → 전체 데이터 ${a.content.length.toLocaleString()}자 (약 ${Math.round(a.content.length/2.5).toLocaleString()}토큰) · 통째로 보내요. 입력창 아래 예상 비용을 확인하세요`);
      else if(CONVERT_EXT.test(f.name)) toast(`${f.name} → 글 ${a.content.length.toLocaleString()}자로 바꿨어요`) }
    catch(err){ toast(`${f.name}: ${err.message}`) }
    renderAttach();
  }
  renderAttach(); preview();
}
$("#attachBtn").onclick=()=>$("#attachIn").click();
$("#attachIn").onchange=e=>{addFiles(e.target.files);e.target.value=""};
$("#composer").addEventListener("dragover",e=>{e.preventDefault();$("#composer").classList.add("drag")});
$("#composer").addEventListener("dragleave",()=>$("#composer").classList.remove("drag"));
$("#composer").addEventListener("drop",e=>{e.preventDefault();$("#composer").classList.remove("drag");addFiles(e.dataTransfer.files)});
$("#input").addEventListener("paste",e=>{const fs=[...e.clipboardData.files]; if(fs.length){e.preventDefault();addFiles(fs)}});
$("#styleSel").value=localStorage.getItem("style")||"default";
$("#styleSel").onchange=()=>localStorage.setItem("style",$("#styleSel").value);
// 에이전트 팀이면 원본 파일(orig)도 보냄 → 서버가 에이전트 작업 공간에 진짜 파일로 넣음
const attachPayload=list=>list.map(a=>({name:a.name,kind:a.kind,content:a.content,raw:!!a.raw,
  ...(state.mode==="agent"&&a.orig?{orig:a.orig}:{})}));
/* ═════════ 보내기 ═════════ */
async function send(opt={}){
  const fromBox = opt.text===undefined;
  const text = fromBox ? $("#input").value.trim() : opt.text; if(!text||state.busy) return;
  const attach = fromBox ? state.attach.slice() : (opt.attach||[]);
  const replaceFrom = opt.replaceFrom ?? null;
  const provs=activeProviders();
  if(!provs.length) return toast("사용할 수 있는 AI가 없어요. Ollama를 켜거나 .env에 API 키를 넣으세요.");
  const projectId = state.conv ? state.conv.project_id : state.projectId;
  if(fromBox){ $("#input").value=""; state.attach=[]; renderAttach(); autosize(); }
  if(replaceFrom!==null) document.querySelectorAll("#thread .turn").forEach(t=>{ if(+t.dataset.turn>=replaceFrom) t.remove() });
  if(state.view!=="chat"){ state.conv=null; setView("chat"); $("#thread").innerHTML=""; }
  const auto = state.mode==="auto";   // 로컬 모델이 여러 개면 제공자가 하나여도 고를 게 있음
  if(!state.conv){ $("#crumb").hidden=!projectId; if(projectId){$("#crumb").textContent=projName(projectId)+"  /";$("#crumb").dataset.pid=projectId} }
  const keyOf = p => p==="local" ? "local@"+modelOf("local") : p;   // 로컬은 모델별로 따로 기록
  const shown = auto ? [] : provs.map(keyOf);   // 자동이면 서버가 고를 때까지 빈 칸
  const fake={q:text,answers:Object.fromEntries(shown.map(p=>[p,null])),synth:null,
    _files:attach.filter(a=>a.kind==="text"), images:attach.filter(a=>a.kind==="image_ref").map(a=>a.content),
    _imgs:attach.filter(a=>a.kind==="image").map(a=>a.url)};
  const idx = replaceFrom!==null ? replaceFrom : (state.conv?state.conv.turns.length:0);
  const el=renderTurn(fake,idx,false); scrollDown(true);
  if(auto) el.querySelector(".answers").innerHTML=`<div class="thinking"><i></i><i></i><i></i></div>`;
  let lives={}; shown.forEach(p=>lives[p]=makeLive(el.querySelector(`[data-key="${p}"]`)));
  setBusy(true);
  try{
    const device = await window.deviceCatalog?.() || null;   // 윈도우 앱: 내 컴퓨터 도구 목록 (브라우저면 null)
    const res=await api("/api/chat",{method:"POST",signal:state.abort.signal,
      body:JSON.stringify({conv_id:state.convId,project_id:projectId,bot_id:state.conv?null:state.botId,text,targets:targetsOf(provs),auto,
        replace_from:replaceFrom,attachments:attachPayload(attach),style:$("#styleSel").value,web:!!state.web,
        preset:$("#presetSel")?.value||null,agent:!!state.agent,deep:!!state.deep,mode:state.modeSel||null,device})});
    let turnIdx=idx;
    await streamNDJSON(res,ev=>{
      if(ev.type==="meta"){
        state.convId=ev.conv_id;state.runId=ev.run_id;el.querySelector(".trim-slot").innerHTML=trimNote(ev.trimmed);
        if(auto){ const p=ev.providers[0]; el.querySelector(".route-slot").innerHTML=routeChip(ev.route);
          el.querySelector(".answers").innerHTML=ansCard(p,null); lives={[p]:makeLive(el.querySelector(`[data-key="${p}"]`))}; }
      }
      else if(ev.type==="delta") lives[ev.key].push(ev.d);
      else if(ev.type==="think") lives[ev.key].think(ev.d);
      else if(ev.type==="status") toast(ev.text);
      else if(ev.type==="tool_request") window.deviceTool?.(ev, el.querySelector(`[data-key="${ev.key}"]`));   // 기다리지 않고 따로 처리
      else if(ev.type==="sources") el.querySelector(".src-slot").insertAdjacentHTML("beforeend",sourcesHTML(ev.items));
      else if(ev.type==="rag") el.querySelector(".src-slot").insertAdjacentHTML("afterbegin",window.ragHTML?.(ev.items)||"");
      else if(ev.type==="done"){ lives[ev.key].finish(ev.result); window.onAnswerDone?.(ev.result) }
      else if(ev.type==="end"){setSpend(ev.spent_today);turnIdx=ev.turn; if(ev.remembered) toast(`기억했어요: ${ev.remembered}`);
        if(ev.handoff?.status==="sent"){ toast(`→ ${ev.handoff.to_name}에게 자동으로 넘겼어요. 끝나면 봇 메뉴에 표시돼요.`); setTimeout(refreshUnread,5000) } }
    });
    state.conv=await getJSON("/api/conversations/"+state.convId);
    setView("chat");   // 봇·프로젝트 경로 표시 갱신
    el.dataset.turn=turnIdx;
    refreshTurn(turnIdx);   // 평가 버튼·다른 AI 버튼이 붙은 최종 모습으로
    window.artAutoOpen?.(turnIdx);   // 이번 답에서 만든 아티팩트는 옆 창에 바로 열기
    if(turnIdx>0) refreshTurn(turnIdx-1);   // 이전 턴의 '다시 생성' 버튼 없애기
  }catch(err){
    toast(err.name==="AbortError"?"연결을 끊었어요. 이 턴은 저장되지 않았어요.":err.message);
    el.remove();
    if(state.convId){try{state.conv=await getJSON("/api/conversations/"+state.convId); if(replaceFrom!==null) openConv(state.convId)}catch{}}
    else newChat(projectId);
    if(err.name!=="AbortError"&&fromBox){$("#input").value=text;state.attach=attach;renderAttach();autosize()}
  }finally{setBusy(false);loadConvs();preview()}
}
async function runSynth(idx,judge){
  const el=$(`.turn[data-turn="${idx}"]`),slot=el.querySelector(".synth-slot");
  slot.innerHTML=`<div class="synth ans" data-key="synth"><div class="who"><span class="dot" style="background:var(--accent)"></span>종합 답변<span class="model">${PROV[judge].name} · ${esc(modelOf(judge))}</span></div><div class="body"><div class="thinking"><i></i><i></i><i></i></div></div><div class="meta"></div></div>`;
  const live=makeLive(slot.querySelector(".ans")); setBusy(true);
  try{
    const res=await api("/api/synth",{method:"POST",signal:state.abort.signal,body:JSON.stringify({conv_id:state.convId,turn:idx,judge:{provider:judge,model:modelOf(judge)}})});
    await streamNDJSON(res,ev=>{
      if(ev.type==="meta"){state.runId=ev.run_id;slot.querySelector(".body").insertAdjacentHTML("afterend",labelsLine(ev.labels))}
      else if(ev.type==="delta")live.push(ev.d);else if(ev.type==="done")live.finish(ev.result);else if(ev.type==="end")setSpend(ev.spent_today)});
    state.conv=await getJSON("/api/conversations/"+state.convId);
  }catch(err){toast(err.name==="AbortError"?"종합을 중지했어요.":err.message);renderSynthSlot(el,state.conv.turns[idx],idx)}
  finally{setBusy(false)}
}
function setBusy(b){
  state.busy=b; state.abort=b?new AbortController():null; if(!b) state.runId=null;
  $("#send").disabled=!b&&!$("#input").value.trim();
  $("#send").setAttribute("aria-label",b?"중지":"보내기"); $("#send").innerHTML=b?STOP_ICON:SEND_ICON;
}
async function stop(){
  // 서버에 중지 신호 → 서버가 AI 회사와의 연결을 끊음 (요금 멈춤). 받은 부분까지는 저장돼요.
  const b=$("#send"); b.disabled=true;
  try{ if(state.runId){ await api("/api/cancel/"+state.runId,{method:"POST"}); return } }catch{}
  state.abort?.abort();   // 서버에 연락이 안 되면 최후의 수단으로 연결 자체를 끊음
}
$("#send").onclick=()=>{state.busy?stop():send()};
let pvTimer=null, pvSeq=0;
function preview(){   // 입력하는 동안: 누구에게 가는지 + 예상 비용 (AI 호출 없음)
  clearTimeout(pvTimer);
  const hint=$("#hint"), text=$("#input").value.trim();
  if(!text||state.busy||!state.status){ hint.textContent="Enter 보내기 · Shift+Enter 줄바꿈"; return }
  pvTimer=setTimeout(async()=>{
    const seq=++pvSeq, provs=activeProviders(); if(!provs.length) return;
    try{
      const r=await sendJSON("/api/estimate","POST",{conv_id:state.convId,project_id:state.conv?state.conv.project_id:state.projectId,
        text,targets:targetsOf(provs),auto:state.mode==="auto",deep:!!state.deep,mode:state.modeSel||null,
        attachments:attachPayload(state.attach.filter(a=>a.kind==="text"))});   // 첨부(특히 STL 전체)도 비용에 포함
      if(seq!==pvSeq) return;   // 더 최근 입력이 있으면 무시
      if(r.error){hint.textContent=r.error;return}
      if(r.agent){ hint.textContent=`🤖 에이전트 팀 (${modelOf("agent")}) · 이 질문 최대 $${(r.expected||0).toFixed(2)} — 넘으면 자동으로 멈춰요 · 보통 몇 분 걸려요`; return }
      const cost = r.expected===0 ? "무료 (내 컴퓨터)" : r.expected ? `예상 약 $${r.expected.toFixed(4)}` : "예상 비용 ?";
      const sw = r.switch ? " · ⚠ 모델 교체 (첫 답 수십 초)" : "";
      const how = r.cls ? (r.cls.unsure ? " (헷갈림 — 보낼 때 AI가 다시 판단)" : ` (${METHOD[r.cls.method]||""})`) : "";
      hint.textContent = r.route ? `${r.category}${how} → ${nameOf(r.route.provider)} · ${cost}${sw}`
        : `${r.category} · ${Object.keys(r.per).length>1?Object.keys(r.per).length+"개 합계 ":""}${cost}${sw}`;
      hint.title = r.route ? r.route.reason : "";
    }catch{}
  },350);
}
function autosize(){const t=$("#input");t.style.height="auto";t.style.height=Math.min(t.scrollHeight,220)+"px";if(!state.busy)$("#send").disabled=!t.value.trim()}
$("#input").addEventListener("input",()=>{autosize();preview()});
$("#input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}});

function setSpend(v){
  state.status.spent_today=v; const lim=state.status.settings.daily_limit;
  $("#spendText").textContent=lim?`오늘 사용 $${v.toFixed(4)} / $${lim.toFixed(2)}`:`오늘 사용 $${v.toFixed(4)} (한도 없음)`;
  const pct=lim?Math.min(v/lim*100,100):0; $("#spendBar").style.width=pct+"%"; $("#spendBar").classList.toggle("warn",pct>=80);
}
