/* skills.js — 스킬 화면: 목록·켜고 끄기·보기·만들기·Claude 스킬 zip 가져오기·AI 제안
   AI는 평소에 스킬 '목록(이름+설명)'만 보고, 필요할 때 ```skill 블록으로 본문을 불러와요. */

async function openSkills(){
  setView("skills");
  let list=[]; try{ list=await getJSON("/api/skills") }catch(err){ toast(err.message) }
  const card=s=>`<div class="pcard" data-skill="${esc(s.name)}" style="cursor:pointer">
    <b style="display:flex;gap:8px;align-items:center"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</span>
      <label class="check-row" style="margin:0;font-weight:400;font-size:13px" title="끄면 AI가 이 스킬을 안 써요"><input type="checkbox" data-on="${esc(s.name)}" ${s.on?"checked":""}> 사용</label></b>
    <span class="desc">${esc(s.description)}</span>
    <span class="stat">${s.builtin?"기본 스킬":"내 스킬"} · ${s.chars.toLocaleString()}자${s.files.length?` · 참고 파일 ${s.files.length}개`:""}</span></div>`;
  const mine=list.filter(s=>!s.builtin), base=list.filter(s=>s.builtin);
  $("#page").innerHTML=`<div class="page"><div class="page-head"><div style="flex:1"><h1>스킬</h1>
    <p>특정 일을 잘하는 방법을 적어 둔 지침이에요. AI가 질문에 맞는 스킬을 스스로 골라서 따라요 — 평소에는 이름과 설명만 보고, 필요할 때만 내용을 읽어서 토큰을 아껴요.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="skSuggest">대화로 제안 받기</button>
    <button class="btn ghost" id="skImport">Claude 스킬 가져오기</button><button class="btn" id="skNew">새 스킬</button></div></div>
    <input type="file" id="skZip" accept=".zip" hidden>
    <div id="skProps"></div>
    <h3 class="muted small" style="margin:18px 4px 8px">내 스킬 ${mine.length}개</h3>
    <div class="grid">${mine.map(card).join("")||`<div class="empty-note" style="grid-column:1/-1">아직 없어요. "새 스킬"로 만들거나, Claude에서 쓰던 스킬 폴더를 zip으로 가져오세요.</div>`}</div>
    <h3 class="muted small" style="margin:22px 4px 8px">기본 스킬 ${base.length}개</h3>
    <div class="grid">${base.map(card).join("")}</div></div>`;
  $("#page").onclick=async e=>{
    if(e.target.closest("[data-on]")) return;   // 체크박스는 change에서
    const c=e.target.closest("[data-skill]"); if(c) viewSkill(c.dataset.skill);
  };
  $("#page").onchange=async e=>{
    const t=e.target.closest("[data-on]"); if(!t) return;
    try{ await sendJSON(`/api/skills/${encodeURIComponent(t.dataset.on)}/on`,"PUT",{on:t.checked}); toast(t.checked?"스킬을 켰어요":"스킬을 껐어요 — AI가 이 스킬을 안 써요") }
    catch(err){ toast(err.message); t.checked=!t.checked }
  };
  $("#skNew").onclick=()=>editSkill();
  $("#skImport").onclick=()=>$("#skZip").click();
  $("#skZip").onchange=async e=>{
    const f=e.target.files[0]; e.target.value=""; if(!f) return;
    if(f.size>3e6) return toast("zip이 너무 커요 (3MB까지)");
    const b64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(String(fr.result).split(",")[1]);fr.readAsDataURL(f)});
    try{ const made=await sendJSON("/api/skills/import","POST",{data:b64}); toast(`가져왔어요: ${made.map(s=>s.name).join(", ")}`); openSkills() }
    catch(err){ toast(err.message) }
  };
  $("#skSuggest").onclick=async()=>{
    const box=$("#skProps"); box.innerHTML=`<div class="thinking" style="margin:14px 4px"><i></i><i></i><i></i></div><p class="muted small" style="margin:0 4px">최근 대화 40개를 보고 반복되는 일을 찾는 중… (AI 1번 사용)</p>`;
    let props; try{ props=await sendJSON("/api/skills/suggest","POST",{}) }catch(err){ box.innerHTML=""; return toast(err.message) }
    if(!props.length){ box.innerHTML=`<div class="empty-note" style="margin-top:12px">반복되는 일을 찾지 못했어요. 대화가 더 쌓이면 다시 해 보세요.</div>`; return }
    box.innerHTML=`<h3 class="muted small" style="margin:18px 4px 8px">AI의 제안 — 마음에 들면 저장하세요</h3><div class="grid">${props.map((p,i)=>`<div class="pcard">
      <b>${esc(p.name)}</b><span class="desc" style="-webkit-line-clamp:3">${esc(p.description)}</span>
      <span class="stat">왜: ${esc(p.why)}</span>
      <div style="display:flex;gap:8px;margin-top:6px"><button class="btn ghost" data-pedit="${i}">고쳐서 저장</button><button class="btn" data-psave="${i}">저장</button></div></div>`).join("")}</div>`;
    box.onclick=async e=>{
      const s=e.target.closest("[data-psave]"), ed=e.target.closest("[data-pedit]");
      if(s){ const p=props[+s.dataset.psave]; try{ await sendJSON("/api/skills","POST",p); toast(`저장했어요: ${p.name}`); openSkills() }catch(err){ toast(err.message) } }
      if(ed) editSkill(props[+ed.dataset.pedit]);
    };
  };
}

async function viewSkill(name){
  let s; try{ s=await getJSON("/api/skills/"+encodeURIComponent(name)) }catch(err){ return toast(err.message) }
  const v=await dialog(s.name,`<p class="muted small" style="margin:0 0 8px">${esc(s.description)}</p>
    <div class="md" style="max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px 14px">${md(s.body)}</div>
    ${s.files.length?`<p class="muted small" style="margin:8px 0 0">참고 파일: ${s.files.map(esc).join(", ")}</p>`:""}`,
    [...(s.builtin?[]:[{label:"삭제",value:"del",kind:"danger",left:true}]),{label:"닫기",value:null,kind:"ghost"},{label:s.builtin?"복사해서 고치기":"고치기",value:"edit"}]);
  if(v==="edit") editSkill({name:s.builtin?s.name+"-my":s.name, description:s.description, body:s.body});
  if(v==="del" && await confirmBox("스킬 삭제",`'${esc(s.name)}' 스킬을 지울까요? 되돌릴 수 없어요.`,"삭제",true)){
    try{ await api("/api/skills/"+encodeURIComponent(s.name),{method:"DELETE"}); toast("지웠어요"); openSkills() }catch(err){ toast(err.message) }
  }
}

async function editSkill(p={name:"",description:"",body:""}){
  const v=await dialog(p.name?"스킬 고치기":"새 스킬",`
    <label for="skn">이름 <small>— 영어 소문자·숫자·- (예: weekly-report)</small></label><input id="skn" maxlength="63" value="${esc(p.name)}">
    <label for="skd">언제 쓰는지 <small>— AI가 이 문장을 보고 고르니 구체적으로</small></label><input id="skd" maxlength="400" value="${esc(p.description)}" placeholder="예: 주간 공부 계획표를 표로 만들 때">
    <label for="skb">지침 <small>— 순서·양식·주의할 점 (마크다운)</small></label>
    <textarea id="skb" style="min-height:260px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px">${esc(p.body)}</textarea>`,
    [{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"ok"}]);
  if(!v) return;
  try{ await sendJSON("/api/skills","POST",{name:$("#skn").value,description:$("#skd").value,body:$("#skb").value}); toast("저장했어요"); openSkills() }
  catch(err){ toast(err.message) }
}
