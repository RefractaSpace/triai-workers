/* connections.js — 앱 연동 화면: MCP 서버(깃허브 등) 추가·켜고 끄기·쓰기 허용·도구 목록 / 구글 연결
   토큰은 파이에만 저장되고 화면에는 앞 4글자만 보여요. */

async function openConnections(){
  setView("connections");
  let d={servers:[],presets:{}}, g=null;
  try{ d=await getJSON("/api/mcp") }catch(err){ toast(err.message) }
  try{ g=await getJSON("/api/google/status") }catch{ g=null }
  const srv=s=>`<div class="box" style="margin-bottom:12px">
    <h3 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:0">🔌 ${esc(s.name)} <small class="muted" style="font-weight:400">${esc(s.id)}</small></span>
      <label class="check-row" style="margin:0;font-weight:400;font-size:13px"><input type="checkbox" data-mp="${esc(s.id)}" data-k="on" ${s.on?"checked":""}> 사용</label>
      <label class="check-row" style="margin:0;font-weight:400;font-size:13px" title="이슈 만들기·삭제처럼 바꾸는 도구도 AI가 쓸 수 있게"><input type="checkbox" data-mp="${esc(s.id)}" data-k="allow_write" ${s.allow_write?"checked":""}> 쓰기 허용</label></h3>
    <p class="muted small" style="margin:0 0 8px;word-break:break-all">${esc(s.url)} · 토큰 ${s.token_hint?esc(s.token_hint):"없음"} · ${s.error?`<span style="color:var(--danger,#c8372d)">⚠ ${esc(s.error)}</span>`:`도구 ${s.tool_count}개`}</p>
    <details><summary class="small">도구 목록 보기</summary><div class="small" style="max-height:220px;overflow:auto;margin-top:6px">${s.tools.map(t=>`<div style="padding:3px 0"><code>${esc(t.name)}</code> ${t.read_only?"":"<b style='color:#b7791f'>쓰기</b>"} <span class="muted">${esc(t.description.split("\n")[0].slice(0,120))}</span></div>`).join("")||"없음"}</div></details>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn ghost" data-mr="${esc(s.id)}">다시 연결</button><button class="btn ghost" data-mt="${esc(s.id)}">토큰 바꾸기</button><button class="btn ghost" data-md="${esc(s.id)}" style="margin-left:auto">삭제</button></div></div>`;
  const gHTML = !g ? "" : g.configured ? (g.connected
      ? `<p class="small" style="margin:0 0 8px">✅ ${esc(g.email||"구글 계정")} 연결됨 · 쓸 수 있는 것: ${g.scopes.map(esc).join(", ")}</p>
         <label class="check-row small"><input type="checkbox" id="gWrite" ${g.allow_write?"checked":""}> 캘린더 일정 추가 허용 (끄면 읽기만)</label>
         <div style="display:flex;gap:8px;margin-top:8px"><a class="btn ghost" href="/api/google/connect">다시 연결</a><button class="btn ghost" id="gOff">연결 끊기</button></div>`
      : `<p class="small" style="margin:0 0 8px">구글 로그인으로 캘린더·드라이브·지메일을 AI가 볼 수 있게 해요. 메일 보내기·파일 삭제는 하지 않아요.</p><a class="btn" href="/api/google/connect">구글 계정 연결</a>`)
    : `<p class="small" style="margin:0">아직 구글 앱 등록이 안 됐어요. 관리자가 .env에 GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET을 넣어야 해요 (README의 '구글 연동').</p>`;
  $("#page").innerHTML=`<div class="page"><div class="page-head"><div style="flex:1"><h1>연결</h1>
    <p>다른 앱을 연결하면 AI가 대화 중에 그 앱의 정보를 읽거나 일을 할 수 있어요. 바꾸는 일(쓰기)은 '쓰기 허용'을 켠 곳만 해요.</p></div></div>
    ${g?`<h3 class="muted small" style="margin:10px 4px 8px">구글</h3><div class="box" style="margin-bottom:18px">${gHTML}</div>`:""}
    <h3 class="muted small" style="margin:10px 4px 8px">MCP 서버 ${d.servers.length}개</h3>
    ${d.servers.map(srv).join("")||`<div class="empty-note" style="margin-bottom:12px">아직 연결한 앱이 없어요.</div>`}
    <div class="box form"><h3>새 연결</h3>
      <label for="mcPre">종류</label><select id="mcPre"><option value="">직접 입력 (아무 MCP 서버)</option>${Object.entries(d.presets).map(([k,p])=>`<option value="${k}">${esc(p.name)}</option>`).join("")}</select>
      <div id="mcCustom"><label for="mcName">이름</label><input id="mcName" maxlength="40" placeholder="예: 노션">
      <label for="mcUrl">MCP 서버 주소 <small>— https:// 로 시작하는 Streamable HTTP 주소</small></label><input id="mcUrl" placeholder="https://example.com/mcp"></div>
      <label for="mcTok">토큰 <small id="mcHelp">— 필요하면 (Bearer 토큰)</small></label><input id="mcTok" type="password" autocomplete="off" placeholder="토큰은 이 서버에만 저장되고 다시 보여주지 않아요">
      <button class="btn" id="mcAdd" style="margin-top:10px">연결</button></div></div>`;
  const pre=$("#mcPre");
  pre.onchange=()=>{ const p=d.presets[pre.value]; $("#mcCustom").hidden=!!p; $("#mcHelp").textContent=p?`— ${p.help}`:"— 필요하면 (Bearer 토큰)" };
  $("#mcAdd").onclick=async()=>{
    const b=$("#mcAdd"); b.disabled=true; b.textContent="연결하는 중…";
    try{ const r=await sendJSON("/api/mcp","POST",{preset:pre.value,name:$("#mcName").value,url:$("#mcUrl").value,token:$("#mcTok").value});
      toast(r.warning||`연결했어요 — 도구 ${r.tool_count}개`); openConnections() }
    catch(err){ toast(err.message); b.disabled=false; b.textContent="연결" }
  };
  $("#page").onchange=async e=>{
    const t=e.target.closest("[data-mp]");
    if(t){ try{ await sendJSON("/api/mcp/"+t.dataset.mp,"PATCH",{[t.dataset.k]:t.checked});
      toast(t.dataset.k==="allow_write"?(t.checked?"쓰기 허용 — AI가 이 앱에서 무언가를 바꿀 수 있어요":"읽기만 해요"):(t.checked?"켰어요":"껐어요")) }catch(err){ toast(err.message); t.checked=!t.checked } }
    if(e.target.id==="gWrite"){ try{ await sendJSON("/api/google/settings","POST",{allow_write:e.target.checked}); toast(e.target.checked?"캘린더 일정 추가를 허용했어요":"구글은 읽기만 해요") }catch(err){ toast(err.message) } }
  };
  $("#page").onclick=async e=>{
    const r=e.target.closest("[data-mr]"), tk=e.target.closest("[data-mt]"), dl=e.target.closest("[data-md]");
    if(r){ r.disabled=true; try{ const s=await sendJSON(`/api/mcp/${r.dataset.mr}/refresh`,"POST",{}); toast(`연결됨 — 도구 ${s.tool_count}개`); openConnections() }catch(err){ toast(err.message); r.disabled=false } }
    if(tk){ const v=await dialog("토큰 바꾸기",`<label for="ntk">새 토큰</label><input id="ntk" type="password" autocomplete="off">`,[{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"ok"}]);
      if(v){ try{ await sendJSON("/api/mcp/"+tk.dataset.mt,"PATCH",{token:$("#ntk").value}); await sendJSON(`/api/mcp/${tk.dataset.mt}/refresh`,"POST",{}).catch(()=>{}); openConnections() }catch(err){ toast(err.message) } } }
    if(dl && await confirmBox("연결 삭제",`'${esc(dl.dataset.md)}' 연결과 저장된 토큰을 지울까요?`,"삭제",true)){
      try{ await api("/api/mcp/"+dl.dataset.md,{method:"DELETE"}); openConnections() }catch(err){ toast(err.message) } }
    if(e.target.id==="gOff" && await confirmBox("구글 연결 끊기","저장된 구글 로그인 정보를 지울까요?","끊기",true)){
      try{ await api("/api/google/disconnect",{method:"POST"}); openConnections() }catch(err){ toast(err.message) } }
  };
}
