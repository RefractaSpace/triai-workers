/* settings.js — 설정 대화상자
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 설정 ═════════ */
function modelRows(){
  return Object.entries(PROV).map(([p,v])=>{
    const list=state.lists[p]||[],cur=modelOf(p),dis=state.status.keys[p]?"":"disabled";
    const field=list.length?`<select data-model="${p}" ${dis}>${(list.includes(cur)?list:[cur,...list]).map(m=>`<option ${m===cur?"selected":""}>${esc(m)}</option>`).join("")}</select>`
      :`<input data-model="${p}" value="${esc(cur)}" ${dis}>`;
    return `<div class="model-row"><span class="dot" style="background:${v.color}"></span><span>${v.name}</span>${field}</div>`;
  }).join("");
}
$("#openSettings").onclick=async()=>{
  const s=state.status.settings;
  const body=`<label>모델 <small>— 목록을 불러오면 지금 쓸 수 있는 모델만 보여요</small></label>
    <div id="modelRows">${modelRows()}</div><button class="btn ghost" id="loadModels" type="button">목록 불러오기</button>
    <label for="sysPrompt">기본 시스템 프롬프트 <small>— 모든 대화에 공통 (프로젝트 지침은 여기에 더해져요)</small></label>
    <textarea id="sysPrompt" rows="3">${esc(s.system)}</textarea>
    <label for="maxTok">최대 출력 토큰 <small>— 추론(생각) 토큰도 여기서 소모돼요</small></label>
    <input id="maxTok" type="number" min="256" max="131072" step="256" value="${s.max_tokens}">
    <label for="limit">하루 예산 한도 (USD) <small>— 넘으면 전송이 막혀요. 0이면 제한 없음</small></label>
    <input id="limit" type="number" min="0" step="0.5" value="${s.daily_limit}">
    <label for="histC">AI에게 보낼 지난 대화 길이 (글자) <small>— 넘으면 오래된 것부터 뺌. ⚠️ 로컬 모델은 이 값보다 <b>모델 → 설정 → 기억 길이</b>가 진짜 한도예요 (늘려도 기억 길이를 넘을 수 없음)</small></label>
    <input id="histC" type="number" min="2000" max="2000000" step="any" value="${s.history_chars??60000}">
    <label for="explore">자동 모드 탐색 비율 (%) <small>— 평가가 적은 AI를 가끔 시험해서 데이터를 고르게 모음. 0이면 끔</small></label>
    <input id="explore" type="number" min="0" max="50" step="5" value="${Math.round((s.explore_rate??0.1)*100)}">
    <label class="check-row"><input type="checkbox" id="codeTool" ${s.code_tool!==false?"checked":""}> 코드 실행 — AI가 계산할 때 파이썬을 직접 돌려서 정확하게 (작업 폴더 안에서만 · 파일 삭제·명령·인터넷 차단)</label>
    <label class="check-row"><input type="checkbox" id="artTool" ${s.artifacts!==false?"checked":""}> 아티팩트 — AI가 만든 웹페이지·도구를 옆 창에서 바로 실행</label>
    <label class="check-row"><input type="checkbox" id="imgTool" ${s.image_tool!==false?"checked":""}> 그림 만들기 — "○○ 그려줘"라고 하면 AI가 그림을 만듦 (Cloudflare 무료 · 하루 30장)</label>
    <label for="clsMode">질문 분류 방식 <small>— AI: 뜻으로 판별(임베딩 모델 필요, 없으면 자동으로 키워드) · 키워드: 단어로 판별</small></label>
    <select id="clsMode"><option value="ai" ${(s.classifier??"ai")==="ai"?"selected":""}>AI</option><option value="keyword" ${s.classifier==="keyword"?"selected":""}>키워드</option></select>
    <div id="featSettings"></div>
    <label for="keepB">백업 보관 개수 <small>— 종류별로 최근 몇 개를 남길지</small></label>
    <input id="keepB" type="number" min="1" max="100" value="${s.keep_backups}">
    <label class="check-row"><input type="checkbox" id="autoB" ${s.auto_backup?"checked":""}> 서버를 켤 때 하루 1번 자동 백업</label>`;
  const p=dialog("설정",body,[{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"save"}]);
  $("#loadModels").onclick=async()=>{
    const b=$("#loadModels");b.disabled=true;b.textContent="불러오는 중...";
    await Promise.all(Object.keys(PROV).filter(k=>state.status.keys[k]).map(async k=>{try{state.lists[k]=await getJSON("/api/models/"+k)}catch{state.lists[k]=[]}}));
    const bad=Object.keys(PROV).filter(k=>state.status.keys[k]&&!state.lists[k]?.length);
    if(bad.length) toast(bad.map(k=>PROV[k].name).join(", ")+" 목록을 못 불러왔어요. 관리 → 연결 확인을 눌러보세요.");
    $("#modelRows").innerHTML=modelRows(); b.disabled=false;b.textContent="목록 불러오기";
  };
  const snap=()=>({models:[...document.querySelectorAll("[data-model]")].map(f=>[f.dataset.model,f.value.trim()]),
    system:$("#sysPrompt").value,max_tokens:+$("#maxTok").value||4000,daily_limit:+$("#limit").value||0,
    keep_backups:Math.max(1,+$("#keepB").value||7),auto_backup:$("#autoB").checked,
    ...(window.featSettingsValues?.()||{}), ...(window.lmSettingsValues?.()||{}), ...(window.agentSettingsValues?.()||{}),
    history_chars:Math.max(2000,+$("#histC").value||60000),
    explore_rate:Math.min(0.5,Math.max(0,(+$("#explore").value||0)/100)), assumed_output:s.assumed_output??600,
    classifier:$("#clsMode").value, code_tool:$("#codeTool").checked, artifacts:$("#artTool").checked, image_tool:$("#imgTool").checked});
  if(await p!=="save") return;
  const data=snap();   // 대화상자는 숨겨질 뿐 내용은 남아 있어서 닫힌 뒤에도 값을 읽을 수 있음
  data.models.forEach(([k,v])=>{if(v)state.models[k]=v}); localStorage.setItem("models",JSON.stringify(state.models));
  try{const {models,...rest}=data;state.status.settings=await sendJSON("/api/settings","PUT",rest);setSpend(state.status.spent_today);renderPicker();toast("설정을 저장했어요.")}
  catch(err){toast(err.message)}
};
