/* modes.js — 입력창 [+] 메뉴: 파일 첨부 + 모드(연구·코딩·추론·그림·사진 보기) + 모드별 모델 설정
   모드를 고르면 그 모드의 모델 하나만 써요 (자동·비교 무시). 입력창 위 칩의 ✕로 끔. */

state.modes = [];
state.modeSel = null;   // 고른 모드 id (보낸 뒤에도 유지 — 같은 일을 이어서 할 때가 많아서)

const shortModel = m => String(m||"").replace(/^@cf\/[^/]+\//,"").replace(/-instruct.*$|-fp8.*$|-\d{4}$/,"");
const modeOf = id => state.modes.find(m=>m.id===id);

async function loadModes(){
  try{ state.modes = await getJSON("/api/modes") }catch{ state.modes = [] }
  paintModeChip();
}

function paintModeChip(){
  const m = modeOf(state.modeSel);
  let chip = $("#modeChip");
  if(!m){ if(chip){ chip.remove(); if(state.status) renderPicker() } return }   // 칩이 있었을 때만 위쪽 표시를 되돌림 (처음 불러올 땐 아직 status 없음)
  if(!chip){ $("#plusBtn").parentElement.insertAdjacentHTML("afterend",`<button class="mode-chip" id="modeChip" title="모드 끄기"></button>`); chip=$("#modeChip");
    chip.onclick=()=>{ state.modeSel=null; paintModeChip(); toast("모드를 껐어요 — 원래 모델 선택으로 돌아가요") } }
  chip.innerHTML = `<span>${m.icon} ${esc(m.name)}</span><small>${esc(shortModel(m.model))}</small><b aria-hidden="true">✕</b>`;
  chip.setAttribute("aria-label",`${m.name} 모드 켜짐 (${m.model}). 누르면 꺼요`);
  if($("#pickerLabel")){ $("#pickerLabel").textContent=`${m.icon} ${m.name} 모드`; $("#pickerModel").textContent=shortModel(m.model)+"만 사용" }   // 위쪽 모델 표시도 모드로
}

function openPlusMenu(){
  const menu=$("#plusMenu");
  if(menu.classList.contains("open")){ menu.classList.remove("open"); return }
  menu.innerHTML = `<button class="opt" data-plus="attach"><span class="pi">📎</span><span><b>파일·사진 첨부</b><small>문서, 사진, 코드 파일</small></span></button>
    <div class="sep"></div>
    ${state.modes.map(m=>`<button class="opt ${state.modeSel===m.id?"on":""}" data-plus="mode" data-id="${m.id}" ${m.available?"":"disabled"}>
      <span class="pi">${m.icon}</span><span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><small class="mm">${esc(m.id==="image"?(m.image_models.find(x=>x.id===m.image_model)?.name||m.image_model):shortModel(m.model))}${m.provider==="cf"?" · 무료 한도":m.provider==="claude"?" · 크레딧":""}${m.available?"":" · 키 없음"}</small></span>
      ${state.modeSel===m.id?`<span class="ck">✓</span>`:""}</button>`).join("")}
    <div class="sep"></div>
    <button class="opt" data-plus="setup"><span class="pi">⚙</span><span><b>모드별 모델 바꾸기</b><small>예: 코딩은 Claude Sonnet으로</small></span></button>`;
  menu.classList.add("open");
  const room=$("#plusBtn").getBoundingClientRect().top-56;   // 버튼 위쪽 남은 공간만큼만 (화면 위로 넘쳐서 첫 줄이 안 보이지 않게)
  menu.style.maxHeight=Math.max(220,Math.min(room,560))+"px";
}

document.addEventListener("click",e=>{
  const menu=$("#plusMenu"); if(!menu) return;
  if(e.target.closest("#plusBtn")){ openPlusMenu(); return }
  const o=e.target.closest("[data-plus]");
  if(!o){ if(!e.target.closest("#plusMenu")) menu.classList.remove("open"); return }
  menu.classList.remove("open");
  if(o.dataset.plus==="attach") $("#attachIn").click();
  if(o.dataset.plus==="mode"){
    const id=o.dataset.id; state.modeSel = state.modeSel===id ? null : id; paintModeChip();
    const m=modeOf(id);
    if(state.modeSel) toast(`${m.icon} ${m.name} 모드 — ${shortModel(m.model)}만 써요${m.id==="vision"?" (사진을 첨부하세요)":""}`);
    $("#input")?.focus();
  }
  if(o.dataset.plus==="setup") modeSetup();
});
document.addEventListener("keydown",e=>{ if(e.key==="Escape") $("#plusMenu")?.classList.remove("open") });

async function modeSetup(){
  const provs=Object.entries(state.status?.keys||{}).filter(([p,ok])=>ok&&p!=="agent").map(([p])=>p);
  const lists={}; await Promise.all(provs.map(async p=>{ try{ lists[p]=await getJSON("/api/models/"+p) }catch{ lists[p]=[] } }));
  const pname=p=>PROV[p]?.name||p;
  const row=m=>`<div class="box" style="margin:10px 0;padding:12px 14px"><b>${m.icon} ${esc(m.name)}</b>
    <div class="model-row" style="margin-top:8px"><select data-mp="${m.id}">${provs.map(p=>`<option value="${p}" ${m.chosen.provider===p?"selected":""}>${esc(pname(p))}</option>`).join("")}</select>
      <select data-mm="${m.id}"></select></div>
    ${m.id==="image"?`<label class="small" style="margin:6px 0 4px;font-weight:600">그림 모델</label><select data-im="1">${m.image_models.map(x=>`<option value="${x.id}" ${x.id===m.image_model?"selected":""}>${esc(x.name)} — 한 장 약 ${x.neurons.toLocaleString()} 뉴런</option>`).join("")}</select>`:""}
    <button class="btn ghost" data-reset="${m.id}" style="margin-top:8px;padding:3px 10px;font-size:12.5px">기본으로</button></div>`;
  const v=dialog("모드별 모델",`<p class="muted small" style="margin:0">모드마다 쓸 모델을 정해요. Cloudflare는 무료 한도(하루 1만 뉴런)를, Claude는 크레딧을 써요.</p>${state.modes.map(row).join("")}`,
    [{label:"닫기",value:null,kind:"ghost"},{label:"저장",value:"ok"}], ()=>{
      const fill=(id)=>{ const p=document.querySelector(`[data-mp="${id}"]`).value, sel=document.querySelector(`[data-mm="${id}"]`), m=modeOf(id);
        const cur=m.chosen.provider===p?m.chosen.model:"";
        sel.innerHTML=(lists[p]||[]).map(x=>`<option ${x===cur?"selected":""}>${esc(x)}</option>`).join("")||`<option value="">모델 목록 없음</option>` };
      state.modes.forEach(m=>{ fill(m.id); document.querySelector(`[data-mp="${m.id}"]`).onchange=()=>fill(m.id) });
      document.querySelectorAll("[data-reset]").forEach(b=>b.onclick=async()=>{ await sendJSON("/api/modes/"+b.dataset.reset,"PUT",{provider:""}); await loadModes(); toast("기본 모델로 되돌렸어요"); $('#dlgPanel [data-i="0"]').click() });
    });
  if(await v!=="ok") return;
  try{
    for(const m of state.modes){
      const provider=document.querySelector(`[data-mp="${m.id}"]`)?.value, model=document.querySelector(`[data-mm="${m.id}"]`)?.value;
      const body={}; if(provider&&model&&(provider!==m.chosen.provider||model!==m.chosen.model)) Object.assign(body,{provider,model});
      if(m.id==="image"){ const im=document.querySelector("[data-im]")?.value; if(im&&im!==m.image_model) body.image_model=im }
      if(Object.keys(body).length) await sendJSON("/api/modes/"+m.id,"PUT",body);
    }
    await loadModes(); toast("모드별 모델을 저장했어요");
  }catch(err){ toast(err.message) }
}

/* [+] 버튼을 입력창 맨 앞에 (예전 📎 버튼은 숨기고 메뉴 안으로) */
(function(){
  const a=$("#attachBtn"); if(!a) return;
  a.hidden=true;
  a.insertAdjacentHTML("beforebegin",`<div style="position:relative"><button class="icon-btn" id="plusBtn" aria-label="첨부·모드" aria-haspopup="menu" title="파일 첨부 · 연구 · 코딩 · 그림 만들기…">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    <div class="menu plus-menu" id="plusMenu" role="menu"></div></div>`);
  loadModes();
})();
/* 위쪽 모델 고르기에서 직접 고르면 모드는 끔 (둘이 다르게 보이지 않게) */
$("#menu")?.addEventListener("click",e=>{ if(e.target.closest(".opt") && state.modeSel){ state.modeSel=null; $("#modeChip")?.remove() } });
