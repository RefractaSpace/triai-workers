/* projects.js — 프로젝트 목록과 상세 화면
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 프로젝트 목록 ═════════ */
async function openProjects(){
  await loadProjects(); setView("projects");
  const draw=(q="")=>{
    const list=state.projects.filter(p=>(p.name+p.description).toLowerCase().includes(q.toLowerCase()));
    $("#pgrid").innerHTML = list.length ? list.map(p=>`<button class="pcard" data-pid="${p.id}"><b>${p.team?`<span class="team-tag" title="이 팀 사람들이 지침·파일을 같이 써요">👥 ${esc(p.team_name||"팀")}</span> `:""}${esc(p.name)}</b>
      <span class="desc">${esc(p.description)||"설명 없음"}</span>
      <span class="stat">내 대화 ${p.conv_count}개 · 파일 ${p.files.length}개 · ${ago(p.updated)} 수정${p.team&&p.updated_by?` (${esc(p.updated_by)})`:""}</span></button>`).join("")
      : `<div class="empty-note" style="grid-column:1/-1">${q?"검색 결과가 없어요.":"프로젝트가 없어요. 과목·연구·작업별로 만들어 두면 지침과 자료를 매번 설명하지 않아도 돼요."}</div>`;
  };
  $("#page").innerHTML=`<div class="page"><div class="page-head"><div style="flex:1"><h1>프로젝트</h1>
    <p>관련 대화, 지침, 참고 파일을 한곳에 묶어요. 프로젝트 안의 모든 대화에 지침과 파일이 자동으로 적용돼요.</p></div>
    <button class="btn" id="newProj">새 프로젝트</button></div>
    ${state.projects.length>3?`<input class="sm search" id="psearch" placeholder="프로젝트 검색">`:""}
    <div class="grid" id="pgrid"></div></div>`;
  draw();
  $("#psearch")?.addEventListener("input",e=>draw(e.target.value));
  $("#pgrid").onclick=e=>{const c=e.target.closest("[data-pid]");if(c)openProject(c.dataset.pid)};
  $("#newProj").onclick=createProjectDialog;
}
async function createProjectDialog(){
  const v=await dialog("새 프로젝트",`
    <label for="pn">이름</label><input id="pn" maxlength="60" placeholder="예: 액체로켓 엔진 설계">
    <label for="pd">설명 <small>— 선택</small></label><input id="pd" placeholder="무엇을 하는 프로젝트인지 한 줄로">
    ${window.teamSelect?.("pteam","팀 프로젝트로 — 그 팀 사람들이 지침·파일을 같이 보고 고쳐요 (대화는 각자)")||""}`,
    [{label:"취소",value:null,kind:"ghost"},{label:"만들기",value:"ok"}]);
  if(!v) return;
  const name=$("#pn").value.trim(); if(!name) return toast("이름을 입력하세요.");
  try{const p=await sendJSON("/api/projects","POST",{name,description:$("#pd").value,team_id:$("#pteam")?.value||null});await loadProjects();openProject(p.id)}
  catch(err){toast(err.message)}
}
/* ═════════ 프로젝트 상세 ═════════ */
const TEXT_EXT=/\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|cfg|log|py|js|ts|jsx|tsx|html|css|c|h|cpp|hpp|cs|java|kt|go|rs|rb|php|swift|m|sql|sh|bat|ps1|tex|ino|r|lua)$/i;
async function openProject(pid){
  let pj; try{pj=await getJSON("/api/projects/"+pid)}catch(err){toast(err.message);return openProjects()}
  await loadProjects(); state.projectId=pid; state.convId=null; state.conv=null;
  setView("project");
  const convs=await getJSON("/api/conversations?project="+pid);
  const limit=400000, pct=Math.min(pj.chars/limit*100,100);
  $("#page").innerHTML=`<div class="page">
    <button class="crumb" id="backProj" style="margin-left:-8px">← 모든 프로젝트</button>
    <div class="page-head"><div style="flex:1;min-width:0"><h1>${pj.team?`<span class="team-tag">👥 ${esc(pj.team_name||"팀")}</span> `:""}${esc(pj.name)}</h1><p>${esc(pj.description)||""}${pj.team?`<br><small class="muted">${esc(pj.team_name||"")} 팀 프로젝트 · 만든 사람 ${esc(pj.owner||"?")} · 마지막 수정 ${esc(pj.updated_by||"?")} · 지침·파일은 그 팀 모두에게 적용, 아래 대화는 내 것만 보여요</small>`:""}</p></div>
      <button class="btn ghost" id="editProj">편집</button></div>
    <div class="pj">
      <div class="pj-main">
        <div id="pjComposer"></div>
        <div><div class="muted small" style="margin:4px 12px 6px">이 프로젝트의 대화 ${convs.length}개</div>
          <div class="row-list" id="pconvs">${convs.length?convs.map(c=>`<button class="row" data-cid="${c.id}"><span>${esc(c.title)}</span><small>${c.turns}턴 · ${ago(c.updated)}</small></button>`).join("")
            :`<div class="empty-note">위 입력창에 질문하면 이 프로젝트 안에서 대화가 시작돼요.</div>`}</div></div>
      </div>
      <div class="pj-side">
        <div class="box"><h3>지침<span class="spacer"></span><button class="btn ghost" id="saveInstr" style="padding:3px 10px;font-size:13px" disabled>저장</button></h3>
          <p class="muted small" style="margin:0 0 8px">이 프로젝트의 모든 대화에서 AI가 따를 규칙이에요.</p>
          <textarea id="instr" placeholder="예: 중학생이 이해할 수 있게 설명해줘. 단위는 SI로. 확실하지 않으면 모른다고 말해줘.">${esc(pj.instructions)}</textarea></div>
        <div class="box"><h3>지식 파일<span class="spacer"></span><small class="muted" style="font-weight:400">${fmtChars(pj.chars)}</small></h3>
          <div class="bar" title="프로젝트 지식 한도 40만 자"><i style="width:${pct}%" class="${pct>=80?"warn":""}"></i></div>
          <div id="pfiles">${pj.files.length?pj.files.map(f=>`<div class="file"><span title="${esc(f.name)}">${esc(f.name)}</span><small>${fmtChars(f.chars)}</small>
            <button data-view="${f.id}" aria-label="보기">보기</button><button data-del="${f.id}" aria-label="삭제">✕</button></div>`).join("")
            :`<p class="muted small" style="margin:0">아직 파일이 없어요.</p>`}</div>
          <div class="drop" id="drop">텍스트·코드 파일을 여기로 끌어오거나 클릭<br><small>txt, md, csv, json, py 등 · PDF·Word는 텍스트로 복사해서 .txt로</small></div>
          <input type="file" id="fileIn" multiple hidden>
          <p class="muted small" style="margin:8px 0 0">파일 내용은 매 질문마다 AI에게 함께 보내져요. 파일이 클수록 질문당 비용이 올라가요.</p></div>
      </div>
    </div></div>`;
  $("#pjComposer").append($("#composer-wrap"));
  $("#input").placeholder=`${pj.name}에서 새 대화 시작`; $("#input").focus();
  $("#backProj").onclick=openProjects;
  $("#pconvs").onclick=e=>{const r=e.target.closest("[data-cid]");if(r)openConv(r.dataset.cid)};
  const instr=$("#instr"),save=$("#saveInstr");
  instr.oninput=()=>save.disabled=instr.value===pj.instructions;
  save.onclick=async()=>{try{pj={...pj,...await sendJSON("/api/projects/"+pid,"PUT",{name:pj.name,description:pj.description,instructions:instr.value})};save.disabled=true;toast("지침을 저장했어요. 다음 질문부터 적용돼요.")}catch(err){toast(err.message)}};
  $("#editProj").onclick=()=>editProjectDialog(pj);
  // 파일 업로드
  const drop=$("#drop"),fin=$("#fileIn");
  drop.onclick=()=>fin.click();
  drop.ondragover=e=>{e.preventDefault();drop.classList.add("over")};
  drop.ondragleave=()=>drop.classList.remove("over");
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove("over");uploadFiles(pid,e.dataTransfer.files)};
  fin.onchange=()=>uploadFiles(pid,fin.files);
  $("#pfiles").onclick=async e=>{
    const d=e.target.closest("[data-del]"),vw=e.target.closest("[data-view]");
    if(d){const f=pj.files.find(x=>x.id===d.dataset.del);
      if(await confirmBox("파일 삭제",`"${esc(f.name)}"을(를) 프로젝트에서 뺄까요?`,"삭제",true)){await api(`/api/projects/${pid}/files/${f.id}`,{method:"DELETE"});openProject(pid)}}
    if(vw){const f=pj.files.find(x=>x.id===vw.dataset.view);const {content}=await getJSON(`/api/projects/${pid}/files/${f.id}`);
      dialog(f.name,`<pre style="white-space:pre-wrap;max-height:60vh;overflow:auto;font-family:var(--mono);font-size:12.5px;background:var(--bg);padding:12px;border-radius:8px;margin:0">${esc(content.slice(0,20000))}${content.length>20000?"\n\n… (앞부분 2만 자만 표시)":""}</pre>`,[{label:"닫기",value:null}])}
  };
}
async function uploadFiles(pid,files){
  let ok=0;
  for(const f of files){
    try{   // 글자 파일 + zip·STL·STEP(글로 바꿔서)을 프로젝트 지식으로
      const a=await fileToAttachment(f,{images:false});
      if(a.kind!=="text") throw new Error("글로 바꿀 수 있는 파일만 넣을 수 있어요");
      await sendJSON(`/api/projects/${pid}/files`,"POST",{name:a.name,content:a.content});ok++
    }catch(err){toast(`${f.name}: ${err.message}`)}
  }
  if(ok){toast(`파일 ${ok}개를 추가했어요.`);openProject(pid)}
}
async function editProjectDialog(pj){
  const v=await dialog("프로젝트 편집",`
    <label for="pn">이름</label><input id="pn" maxlength="60" value="${esc(pj.name)}">
    <label for="pd">설명</label><input id="pd" value="${esc(pj.description)}">`,
    [{label:"프로젝트 삭제",value:"delete",kind:"danger",left:true},{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"save"}]);
  if(v==="save"){
    try{await sendJSON("/api/projects/"+pj.id,"PUT",{name:$("#pn").value,description:$("#pd").value,instructions:pj.instructions});openProject(pj.id)}catch(err){toast(err.message)}
  }
  if(v==="delete"){
    const w=await dialog("프로젝트 삭제",`<p class="muted" style="margin:0">"${esc(pj.name)}" 프로젝트의 지침과 파일이 삭제돼요.</p>
      <label class="check-row"><input type="checkbox" id="delChats"> 이 프로젝트의 대화 ${pj.conv_count}개도 함께 삭제</label>
      <p class="muted small">체크하지 않으면 대화는 "프로젝트 없음"으로 남아요.</p>`,
      [{label:"취소",value:null,kind:"ghost"},{label:"삭제",value:"ok",kind:"danger"}]);
    if(w){const all=$("#delChats").checked;await api(`/api/projects/${pj.id}?delete_chats=${all}`,{method:"DELETE"});toast("프로젝트를 삭제했어요.");openProjects();loadConvs()}
  }
}
