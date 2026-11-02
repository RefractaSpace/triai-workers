/* admin.js — 관리 화면(사용량·모델 성적·백업)과 질문 종류 편집
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 관리 ═════════ */
function usageChart(daily){
  const W=680,H=180,pad=28,bw=(W-pad-8)/daily.length;
  const tot=d=>(d.claude||0)+(d.gpt||0)+(d.gemini||0);
  const max=Math.max(...daily.map(tot),0.0001);
  let bars="";
  daily.forEach((d,i)=>{
    let y=H-20; const x=pad+i*bw+1;
    for(const p of ["claude","gpt","gemini"]){const v=d[p]||0;if(!v)continue;const h=v/max*(H-40);y-=h;
      bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw-2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="var(--${p})"><title>${d.day} ${PROV[p].name} $${v.toFixed(4)}</title></rect>`}
  });
  const lbl=[0,Math.floor(daily.length/2),daily.length-1].map(i=>`<text x="${pad+i*bw+bw/2}" y="${H-4}" text-anchor="middle" font-size="11" fill="var(--muted)">${daily[i].day.slice(5)}</text>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 30일 일별 사용 금액">
    <line x1="${pad}" y1="${H-20}" x2="${W-8}" y2="${H-20}" stroke="var(--line)"/>
    <text x="${pad-4}" y="24" text-anchor="end" font-size="11" fill="var(--muted)">$${max.toFixed(max<0.1?3:2)}</text>
    <line x1="${pad}" y1="20" x2="${W-8}" y2="20" stroke="var(--line)" stroke-dasharray="3 4"/>${bars}${lbl}</svg>
    <div class="legend">${Object.entries(PROV).map(([p,v])=>`<span><i class="dot" style="background:${v.color}"></i>${v.name}</span>`).join("")}</div>`;
}
function routingTable(r){
  const st=r.stats||{sub:{},big:{}};
  const keys=[...new Set([...Object.values(st.big),...Object.values(st.sub)].flatMap(o=>Object.keys(o)))];
  if(!keys.length) return `<p class="muted small" style="margin:0">아직 평가가 없어요.</p>`;
  const cell=x=>{ if(!x||!(x.w+x.l)) return `<td class="n muted">—</td>`;
    const rate=(x.w+1)/(x.w+x.l+2)*100; return `<td class="n">${rate.toFixed(0)}% <small class="muted">(${x.w}승 ${x.l}패)</small></td>` };
  let rows="";
  for(const b of r.categories){
    if(!st.big[b.id]) continue;
    rows+=`<tr><td><b>${esc(b.name)}</b></td>${keys.map(k=>cell(st.big[b.id][k])).join("")}</tr>`;
    for(const x of b.subs) if(st.sub[x.id]) rows+=`<tr><td style="padding-left:22px" class="muted">› ${esc(x.name)}</td>${keys.map(k=>cell(st.sub[x.id][k])).join("")}</tr>`;
  }
  return `<div style="overflow-x:auto"><table class="t"><thead><tr><th>질문 종류</th>${keys.map(k=>`<th class="n">${esc(nameOf(k))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function openAdmin(){
  setView("admin");
  $("#page").innerHTML=`<div class="page"><div class="page-head"><div style="flex:1"><h1>관리</h1><p>사용량, 연결 상태, 백업과 정리를 여기서 해요.</p></div></div><p class="muted">불러오는 중...</p></div>`;
  let s; try{s=await getJSON("/api/admin/stats")}catch(err){return toast(err.message)}
  const m=s.maintenance, models=Object.entries(s.by_model).sort((a,b)=>b[1].calls-a[1].calls);
  $("#page").innerHTML=`<div class="page">
    <div class="page-head"><div style="flex:1"><h1>관리</h1><p>사용량, 연결 상태, 백업과 정리를 여기서 해요.</p></div></div>
    <div class="cards">
      <div class="kpi"><small>이번 달 사용</small><b>$${s.month_total.toFixed(3)}</b></div>
      <div class="kpi"><small>전체 누적</small><b>$${s.all_total.toFixed(3)}</b></div>
      <div class="kpi"><small>대화 · 질문</small><b>${s.conversations} · ${s.turns}</b></div>
      <div class="kpi"><small>프로젝트</small><b>${s.projects}</b></div>
    </div>
    <div class="admin-grid">
      <div class="box wide"><h3>최근 30일 사용 금액</h3>${usageChart(s.daily)}
        <p class="muted small" style="margin:6px 0 0">pricing.json 단가로 계산한 추정치예요. 실제 청구액은 각 회사 콘솔 기준이에요.</p></div>

      <div class="box wide"><h3>모델별 성적</h3>${models.length?`<table class="t"><thead><tr><th>모델</th><th class="n">호출</th><th class="n">실패</th><th class="n">평균 시간</th><th class="n">비용</th></tr></thead><tbody>
        ${models.map(([name,v])=>`<tr><td><span class="dot" style="display:inline-block;margin-right:8px;background:${PROV[v.provider]?.color}"></span>${esc(name)}</td><td class="n">${v.calls}</td><td class="n" style="${v.errors?"color:var(--danger)":""}">${v.errors}</td><td class="n">${v.avg_sec}초</td><td class="n">$${v.cost.toFixed(4)}</td></tr>`).join("")}
        </tbody></table><p class="muted small" style="margin:8px 0 0">실패가 많은 모델은 설정에서 다른 모델로 바꾸는 게 좋아요.</p>`:`<p class="muted small" style="margin:0">아직 기록이 없어요.</p>`}</div>

      <div class="box wide"><h3>자동 모드 학습 현황</h3>${routingTable(s.routing)}
        <p class="muted small" style="margin:8px 0 0">답변 아래 👍👎, 비교할 때 ★ 최고를 누르면 쌓여요. 세부 분류 평가가 3개 미만이면 큰 분류 성적을, 그것도 부족하면 담당 모델을 써요.</p>
        <div class="actions"><button class="btn ghost" id="editCats">질문 종류·담당 모델 편집</button></div></div>

      <div class="box"><h3>API 연결 상태</h3><div id="keys">${Object.entries(PROV).map(([p,v])=>`<div class="kv"><span><i class="dot" style="display:inline-block;margin-right:8px;background:${v.color}"></i>${v.name}</span><span class="pill" data-k="${p}">${state.status.keys[p]?(p==="local"?"실행 중":"키 있음 · 미확인"):(p==="local"?"꺼짐":"키 없음")}</span></div>`).join("")}</div>
        <div class="actions"><button class="btn ghost" id="checkKeys">연결 확인</button><span class="muted small">모델 목록만 요청해서 무료예요</span></div></div>

      <div class="box"><h3>자체 점검</h3>
        <div class="kv"><span>마지막 점검</span><span class="muted">${m?m.time.replace("T"," "):"없음"}</span></div>
        <div class="kv"><span>격리한 깨진 파일</span><span class="${s.broken.length?"pill bad":"pill ok"}">${s.broken.length}개</span></div>
        <div class="kv"><span>자동 백업</span><span class="pill ${state.status.settings.auto_backup?"ok":""}">${state.status.settings.auto_backup?"켜짐 · 하루 1번":"꺼짐"}</span></div>
        <p class="muted small" style="margin:8px 0 0">서버를 켤 때마다 깨진 파일 격리, 끊긴 프로젝트 연결 복구, 하루 1번 자동 백업을 해요.</p>
        <div class="actions"><button class="btn ghost" id="runMaint">지금 점검 + 백업</button></div></div>

      <div class="box"><h3>백업과 복원</h3>
        <div class="kv"><span>데이터 크기</span><span class="muted">${fmtBytes(s.storage.data)}</span></div>
        <div class="kv"><span>백업 폴더</span><span class="muted">${fmtBytes(s.storage.backups)} · ${s.backups.length}개</span></div>
        <div class="actions"><a class="btn" href="/api/admin/backup" download>백업 다운로드</a><button class="btn ghost" id="restoreBtn">백업에서 복원</button><input type="file" id="restoreIn" accept=".zip" hidden></div>
        ${s.backups.length?`<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">저장된 백업 ${s.backups.length}개</summary>
          ${s.backups.map(b=>`<div class="file"><span>${esc(b.name)}</span><small>${fmtBytes(b.size)}</small><a class="small" style="color:var(--accent)" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>받기</a></div>`).join("")}</details>`:""}</div>

      <div class="box"><h3>오래된 대화 정리</h3>
        <p class="muted small" style="margin:0 0 8px">정리하기 전에 자동으로 백업을 만들어요.</p>
        <div class="actions" style="margin-top:0"><input class="sm" type="number" id="cleanDays" value="90" min="1" style="width:90px"><span class="small">일 넘게 안 쓴 대화</span></div>
        <label class="small" style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="cleanProj"> 프로젝트 안의 대화도 포함</label>
        <div class="actions"><button class="btn danger" id="cleanBtn">정리하기</button></div></div>
    </div></div>`;

  $("#editCats").onclick=openCats;
  $("#checkKeys").onclick=async()=>{
    const b=$("#checkKeys");b.disabled=true;b.textContent="확인 중...";
    try{const r=await getJSON("/api/admin/check-keys");
      for(const [p,v] of Object.entries(r)){const el=document.querySelector(`[data-k="${p}"]`);el.textContent=v.msg;el.className="pill "+(v.ok?"ok":"bad");el.title=v.detail||v.msg}}
    catch(err){toast(err.message)} b.disabled=false;b.textContent="연결 확인";
  };
  $("#runMaint").onclick=async()=>{
    try{const r=await sendJSON("/api/admin/maintenance","POST",{});
      toast(`점검 완료 · 깨진 파일 ${r.broken_moved.length}개 격리 · 연결 복구 ${r.orphans_fixed}개 · 백업 ${r.backup?"생성":"없음"}`);openAdmin()}
    catch(err){toast(err.message)}
  };
  $("#restoreBtn").onclick=()=>$("#restoreIn").click();
  $("#restoreIn").onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    if(!await confirmBox("백업에서 복원",`지금의 모든 대화·프로젝트·설정이 "${esc(f.name)}" 내용으로 바뀌어요. 바뀌기 전 상태는 자동으로 백업해 둬요.`,"복원",true)) return;
    try{const r=await(await api("/api/admin/restore",{method:"POST",headers:{"Content-Type":"application/zip"},body:f})).json();
      toast(`복원 완료 · 파일 ${r.files}개 · 이전 상태는 ${r.safety_backup}에 보관`);
      state.status=await getJSON("/api/status");await loadProjects();loadConvs();openAdmin()}
    catch(err){toast(err.message)}
  };
  $("#cleanBtn").onclick=async()=>{
    const days=+$("#cleanDays").value, inc=$("#cleanProj").checked;
    if(!(days>=1)) return toast("1일 이상으로 입력하세요.");
    if(!await confirmBox("대화 정리",`${days}일 넘게 안 쓴 대화${inc?"(프로젝트 포함)":"(프로젝트 제외)"}를 삭제할까요? 삭제 전에 백업을 만들어요.`,"정리",true)) return;
    try{const r=await sendJSON("/api/admin/cleanup","POST",{days,include_projects:inc});toast(`대화 ${r.deleted}개를 정리했어요.`);loadConvs();openAdmin()}
    catch(err){toast(err.message)}
  };
}
/* ═════════ 질문 종류 편집 ═════════ */
async function openCats(){
  setView("cats");
  let cats, cands, cl;
  try{ [cats,cands,cl]=await Promise.all([getJSON("/api/categories"),getJSON("/api/candidates"),getJSON("/api/classifier")]); }catch(err){ return toast(err.message) }
  state.cands=cands;
  const modelSel=(v,cls)=>`<select class="sm ${cls}"><option value="">담당 지정 안 함</option>${cands.map(c=>
    `<option value="${esc(c.key)}" ${c.key===v?"selected":""}>${esc(c.name)}${c.loaded?" (켜짐)":""}</option>`).join("")}${v&&!cands.some(c=>c.key===v)?`<option value="${esc(v)}" selected>${esc(nameOf(v))} (없음)</option>`:""}</select>`;
  const subRow=x=>`<div class="cat-sub" data-id="${esc(x.id||"")}">
      <input class="sm c-name" value="${esc(x.name)}" placeholder="세부 이름" maxlength="20">
      <input class="sm c-kw" value="${esc(x.keywords||"")}" placeholder="키워드 (| 로 구분, 예: 에러|버그|고쳐)">
      ${modelSel(x.model,"c-model")}<span class="c-btns"><button class="icon-btn c-up" aria-label="위로 (먼저 검사)" title="위로 — 위에 있을수록 먼저 검사해요">↑</button><button class="icon-btn c-del" aria-label="세부 분류 삭제">✕</button></span>
      <details class="c-exwrap"><summary class="small muted">AI 예시 문장 ${(x.examples||"").split("\n").filter(Boolean).length}개</summary>
        <textarea class="c-ex" rows="4" placeholder="한 줄에 하나씩. 이 분류에 들어갈 만한 질문을 적으면 AI가 비슷한 질문을 이 분류로 판별해요">${esc(x.examples||"")}</textarea></details></div>`;
  const bigBox=b=>`<div class="box cat-big" data-id="${esc(b.id||"")}">
      <div class="cat-head"><input class="sm c-bname" value="${esc(b.name)}" placeholder="큰 분류 이름" maxlength="20">
        ${modelSel(b.model,"c-bmodel")}<button class="btn danger c-bdel" style="padding:4px 10px">분류 삭제</button></div>
      <div class="cat-subs">${b.subs.map(subRow).join("")}</div>
      <button class="btn ghost c-add" style="margin-top:8px;padding:4px 10px;font-size:13px">+ 세부 분류</button></div>`;
  $("#page").innerHTML=`<div class="page">
    <button class="crumb" id="backAdmin" style="margin-left:-8px">← 관리</button>
    <div class="page-head"><div style="flex:1"><h1>질문 종류 편집</h1>
      <p>AI는 질문을 각 분류의 <b>예시 문장</b>과 비교해서 판별해요. 키워드는 AI 분류기가 없을 때만 쓰여요(위에 있는 것부터 검사). 담당 모델은 평가가 부족할 때 쓰여요.</p></div>
      <button class="btn ghost" id="resetCats">기본값으로</button><button class="btn" id="saveCats">저장</button></div>
    <div class="box" style="margin-bottom:12px"><h3>AI 분류기</h3>
      <div class="kv"><span>1단계 임베딩 AI <small class="muted">(항상 사용 · CPU)</small></span><span class="pill ${cl.embed_ok?"ok":"bad"}">${esc(cl.embed_model)} · ${cl.embed_ok?"설치됨":"없음"}</span></div>
      <div class="kv"><span>2단계 작은 AI <small class="muted">(헷갈릴 때만 · CPU)</small></span><span class="pill ${cl.judge_ok?"ok":""}">${esc(cl.judge_model)} · ${cl.judge_ok?"설치됨":"없음 (선택)"}</span></div>
      ${cl.mode!=="ai"?`<p class="small muted">설정에서 분류 방식이 '키워드'로 되어 있어요.</p>`:!cl.embed_ok?`<p class="small" style="color:var(--danger)">임베딩 AI가 없어서 지금은 키워드로 판별 중이에요. 터미널에서 <code>ollama pull ${esc(cl.embed_model)}</code> 실행 후 새로고침하세요.</p>`:""}
      <div class="actions"><input class="sm" id="clsText" placeholder="판별 테스트: 질문을 입력하고 Enter" style="flex:1;min-width:200px"><button class="btn ghost" id="clsBtn">판별해보기</button></div>
      <div id="clsOut" class="small" style="margin-top:8px"></div></div>
    <div id="catList" class="cat-list">${cats.map(bigBox).join("")}</div>
    <button class="btn ghost" id="addBig" style="margin-top:12px">+ 큰 분류 추가</button>
    <p class="muted small">키워드 문법: <code>에러|버그</code> = 둘 중 하나, <code>안\s*돼</code> = 띄어쓰기 상관없이 "안돼/안 돼". 질문 앞에 <code>#세부이름</code>을 붙이면 판별 없이 그 분류로 보내요.</p></div>`;
  $("#backAdmin").onclick=openAdmin;
  const runTest=async()=>{ const q=$("#clsText").value.trim(); if(!q) return; $("#clsOut").textContent="판별 중...";
    try{ const r=await sendJSON("/api/classify-test","POST",{text:q});
      $("#clsOut").innerHTML=`<b>${esc(r.label)}</b> · ${METHOD[r.method]||r.method}${r.unsure?" (헷갈림 — 2단계 AI가 없어서 1등으로 결정)":""}`
        + (r.top?.length?`<div class="muted" style="margin-top:4px">${r.top.map((x,i)=>`${i+1}등 ${esc(x.label)} ${x.score}`).join(" · ")}</div>`:"");
    }catch(err){ $("#clsOut").textContent=err.message } };
  $("#clsBtn").onclick=runTest; $("#clsText").onkeydown=e=>{ if(e.key==="Enter") runTest() };
  const list=$("#catList");
  list.onclick=e=>{
    if(e.target.closest(".c-up")){ const sub=e.target.closest(".cat-sub"); if(sub.previousElementSibling) sub.parentElement.insertBefore(sub,sub.previousElementSibling); return }
    if(e.target.closest(".c-del")){ const sub=e.target.closest(".cat-sub"); if(sub.parentElement.children.length<=1) return toast("세부 분류는 하나 이상 있어야 해요"); sub.remove() }
    else if(e.target.closest(".c-add")) e.target.closest(".cat-big").querySelector(".cat-subs").insertAdjacentHTML("beforeend",subRow({name:"",keywords:"",model:"",examples:""}));
    else if(e.target.closest(".c-bdel")){ if(list.children.length<=1) return toast("큰 분류는 하나 이상 있어야 해요"); e.target.closest(".cat-big").remove() }
  };
  $("#addBig").onclick=()=>list.insertAdjacentHTML("beforeend",bigBox({name:"",model:"",subs:[{name:"",keywords:"",model:""}]}));
  const collect=()=>[...list.querySelectorAll(".cat-big")].map(b=>({id:b.dataset.id,name:b.querySelector(".c-bname").value.trim(),model:b.querySelector(".c-bmodel").value,
    subs:[...b.querySelectorAll(".cat-sub")].map(x=>({id:x.dataset.id,name:x.querySelector(".c-name").value.trim(),keywords:x.querySelector(".c-kw").value.trim(),model:x.querySelector(".c-model").value,examples:x.querySelector(".c-ex").value}))}));
  $("#saveCats").onclick=async()=>{ try{ state.cats=await sendJSON("/api/categories","PUT",{categories:collect()}); toast("저장했어요. 다음 질문부터 적용돼요."); openCats() }catch(err){ toast(err.message) } };
  $("#resetCats").onclick=async()=>{ if(await confirmBox("기본값으로 되돌리기","직접 바꾼 종류·키워드·담당 모델이 모두 초기화돼요. 쌓인 평가는 그대로 남아요.","되돌리기",true)){ state.cats=await sendJSON("/api/categories/reset","POST",{}); openCats() } };
}
