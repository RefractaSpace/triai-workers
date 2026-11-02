/* serverless.js — Cloudflare(서버 없음)판 화면 다듬기: 없는 기능은 숨기고, 발자국은 줄이고
   파이판 코드는 그대로 두고, /api/status 의 serverless 표시가 있을 때만 적용돼요 */
(function(){
  const NAV_HIDE = ["bots", "skills", "connections", "team"];        // 서버 없는 판에 없는 화면
  function apply(){
    if(typeof state==="undefined" || !state.status?.serverless) return false;
    document.body.classList.add("serverless");
    NAV_HIDE.forEach(k => document.querySelectorAll(`.nav[data-go="${k}"]`).forEach(b => b.hidden = true));
    ["micBtn", "agentBtn"].forEach(id => { const b = document.getElementById(id); if (b) b.hidden = true; });
    document.querySelectorAll('#side a[href="/gw/pi"], #side a[href="/gw/pi/console"]').forEach(a => a.remove());
    const out = document.querySelector('#side a[href="/gw/logout"]');
    if (out && !document.getElementById("pwLink")) {
      const a = document.createElement("a"); a.id = "pwLink"; a.href = "/gw/password"; a.textContent = "비밀번호";
      out.before(a);
    }
    return true;
  }
  // 상태를 받은 뒤·사이드바가 그려진 뒤 몇 번 다시 적용 (team.js가 꼬리를 나중에 그림)
  let n = 0; const t = setInterval(() => { if (apply() && n++ > 6) clearInterval(t); if (n > 40) clearInterval(t); }, 400);
  new MutationObserver(() => apply()).observe(document.getElementById("side") || document.body, { childList: true, subtree: false });
})();

/* ── 모델 화면: 클라우드 AI 4개의 연결 상태·기본 모델·목록 (로컬 모델 화면 대신) ── */
async function openModels(){
  if(typeof state==="undefined" || !state.status?.serverless) return;
  setView("models");
  const provs=["claude","gpt","gemini","cf"];
  $("#page").innerHTML=`<div class="page"><div class="page-head"><div style="flex:1"><h1>모델</h1>
    <p>Cloudflare에서 돌아가는 TriAI는 클라우드 AI만 써요. 키는 배포할 때 비밀값으로 넣고, 여기선 상태와 모델 목록만 봐요.</p></div></div>
    <div class="cards">${provs.map(p=>`<div class="box" data-prov="${p}"><h3><span class="dot" style="display:inline-block;margin-right:8px;background:${PROV[p]?.color}"></span>${esc(PROV[p]?.name||p)}</h3>
      <div class="kv"><span>키</span><span class="pill ${state.status.keys[p]?"ok":"bad"}">${state.status.keys[p]?"있음":"없음"}</span></div>
      <div class="kv"><span>지금 쓰는 모델</span><span class="muted" data-cur>${esc(modelOf(p))}</span></div>
      <div class="kv"><span>목록</span><span class="muted" data-list>${state.status.keys[p]?"불러오는 중…":"—"}</span></div>
      ${state.status.keys[p]?`<select class="style-sel" data-pick style="width:100%;margin-top:8px" hidden></select>`:""}
    </div>`).join("")}</div>
    <p class="muted small">모델을 고르면 바로 저장돼요 (이 브라우저에만). 모드별 모델([+] 메뉴)은 각 모드의 톱니에서 바꿔요. 키가 없으면 관리자가 <code>wrangler secret put</code>으로 넣어야 해요.</p></div>`;
  await Promise.all(provs.filter(p=>state.status.keys[p]).map(async p=>{
    const box=$(`[data-prov="${p}"]`); let list=[]; try{ list=await getJSON("/api/models/"+p) }catch{}
    state.lists=state.lists||{}; state.lists[p]=list;
    box.querySelector("[data-list]").textContent=list.length?`${list.length}개`:"못 불러옴 (키·네트워크 확인)";
    const sel=box.querySelector("[data-pick]"); if(!sel||!list.length) return;
    const cur=modelOf(p); sel.innerHTML=[...new Set([cur,...list])].map(m=>`<option value="${esc(m)}" ${m===cur?"selected":""}>${esc(m)}</option>`).join(""); sel.hidden=false;
    sel.onchange=()=>{ state.models[p]=sel.value; localStorage.setItem("models",JSON.stringify(state.models)); box.querySelector("[data-cur]").textContent=sel.value; renderPicker(); toast(`${PROV[p].name} 모델을 ${sel.value}(으)로 바꿨어요`) };
  }));
}

/* ── 관리 화면: 서버 없는 판에 없는 상자(자체 점검·백업 폴더)는 숨기고, 공유 링크·최근 기록 상자를 더함 ── */
(function(){
  const orig=window.openAdmin;
  if(typeof orig!=="function") return;
  window.openAdmin=async function(){
    await orig.apply(this, arguments);
    if(typeof state==="undefined" || !state.status?.serverless) return;
    let s; try{ s=await getJSON("/api/admin/stats") }catch{ return }
    document.querySelectorAll("#page .box").forEach(b=>{ const h=b.querySelector("h3")?.textContent||""; if(/자체 점검|백업과 복원/.test(h)) b.remove() });
    const grid=$("#page .admin-grid"); if(!grid) return;
    const shares=(s.shares||[]).map(x=>`<div class="file"><span>${esc(x.title)}</span><small>${esc(x.lang)} · 조회 ${x.views}</small><a class="small" style="color:var(--accent)" href="/s/${x.id}" target="_blank" rel="noopener">열기</a><button class="btn ghost small" data-unshare="${x.id}">끊기</button></div>`).join("");
    grid.insertAdjacentHTML("beforeend",`<div class="box"><h3>내 데이터</h3>
      <div class="kv"><span>대화 데이터</span><span class="muted">${fmtBytes(s.storage.data)}</span></div>
      <div class="actions"><a class="btn" href="/api/admin/backup" download>전체 내려받기 (JSON)</a></div>
      <p class="muted small" style="margin:8px 0 0">대화·설정·기억·프로젝트가 한 파일로 나와요. 가끔 내려받아 두면 Cloudflare에 문제가 생겨도 안전해요.</p></div>
    <div class="box"><h3>공개 링크 ${s.shares?.length||0}개</h3>${shares||`<p class="muted small" style="margin:0">아직 없어요. 아티팩트 창의 🔗 버튼으로 만들어요.</p>`}</div>
    ${s.audit?.length?`<div class="box wide"><h3>최근 기록</h3><div style="overflow-x:auto"><table class="t"><thead><tr><th>시각</th><th>누가</th><th>IP</th><th>무엇</th></tr></thead><tbody>
      ${s.audit.map(a=>`<tr><td class="muted">${esc(a.time.replace("T"," "))}</td><td>${esc(a.user||"")}</td><td class="muted">${esc(a.ip||"")}</td><td>${esc(a.action)}${a.detail?` <small class="muted">${esc(a.detail)}</small>`:""}</td></tr>`).join("")}</tbody></table></div></div>`:""}`);
    grid.querySelectorAll("[data-unshare]").forEach(b=>b.onclick=async()=>{ if(!await confirmBox("공개 링크 끊기","이 링크를 연 사람은 더 못 봐요.","끊기",true)) return; try{ await api("/gw/share/"+b.dataset.unshare,{method:"DELETE"}); b.closest(".file").remove(); toast("끊었어요") }catch(e){ toast(e.message) } });
  };
})();

/* ── 설정 창: 서버 없는 판에 없는 항목 숨기기 ── */
(function(){
  const trim=()=>{
    if(typeof state==="undefined" || !state.status?.serverless) return;
    const panel=document.getElementById("dlgPanel"); if(!panel||!/설정/.test(panel.querySelector("h2")?.textContent||"")) return;
    ["local","agent"].forEach(k=>{ const i=panel.querySelector(`[data-model="${k}"]`); const row=i?.closest(".model-row,.row,label,div"); if(row) row.hidden=true; });
    ["codeTool","imgTool","autoB"].forEach(id=>{ const el=panel.querySelector("#"+id); el?.closest("label")?.setAttribute("hidden",""); });
    ["clsMode","keepB"].forEach(id=>{ const el=panel.querySelector("#"+id); if(!el) return; panel.querySelector(`label[for="${id}"]`)?.setAttribute("hidden",""); el.hidden=true; });
    const feat=panel.querySelector("#featSettings"); if(feat) feat.hidden=true;
    panel.querySelectorAll("label,p,small").forEach(el=>{ if(/로컬 모델은 이 값보다/.test(el.textContent)) el.innerHTML=el.innerHTML.replace(/⚠️[^<]*/,"") });
  };
  new MutationObserver(trim).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["class"]});
})();
