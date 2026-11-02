/* thread.js — 대화 화면 그리기: 질문·답 카드, 평가, 분류 칩, 넘기기·기억 버튼
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 대화 렌더링 ═════════ */
function metaHTML(a,o={}){
  const est=a.estimated?"약 ":"";
  const fb = o.fb ? `<span class="fb">
      <button data-fb="up" class="${a.rating>0?"on":""}" title="좋은 답 — 자동 모드가 학습해요" aria-label="좋아요">👍</button>
      <button data-fb="down" class="${a.rating<0?"on":""}" title="별로인 답" aria-label="별로예요">👎</button>
      ${o.multi?`<button data-fb="best" class="${o.best?"on":""}" title="이 질문에서 제일 좋은 답">★ 최고</button>`:""}</span>` : "";
  const speed = a.tps ? `<span title="초당 생성 토큰${a.ttft!=null?` · 첫 글자까지 ${a.ttft}초`:""}${a.load_s>0.5?` · 모델 불러오기 ${a.load_s}초`:""}">⚡ ${a.tps} tok/s</span>` : "";
  return `${fb}${a.stopped?`<span class="pill">중지됨</span>`:""}<span title="${a.ttft!=null?`첫 글자까지 ${a.ttft}초`:""}">${a.sec}초</span>${speed}
    <span>${est}${(a.in||0).toLocaleString()} → ${(a.out||0).toLocaleString()} 토큰</span>
    ${a.cached?`<span title="캐시로 싸게 읽은 입력 토큰">캐시 ${a.cached.toLocaleString()}</span>`:""}
    <span>${a.provider==="local"?"무료":a.cost==null?"비용 ?":est+"$"+a.cost.toFixed(4)}</span>${a.session?`<span title="Console → Sessions에서 이 id로 에이전트끼리 주고받은 내용을 볼 수 있어요" class="muted">세션 ${esc(a.session.slice(-8))}</span>`:""}<button data-copy>복사</button>`;
}
const bodyHTML = a => (a.error?`<div class="err">${esc(a.error)}</div>`
  : (a.stopped&&!a.text.trim()) ? `<p class="muted small" style="margin:0">글자가 나오기 전에 중지했어요.</p>` : `<div class="md">${md(a.text)}</div>`);
const ansBody = a => (a.thinking?thinkHTML(a.thinking,false):"") + bodyHTML(a) + (a.warning?`<div class="err" style="opacity:.85">⚠️ ${esc(a.warning)}</div>`:"");
function handoffHTML(h){
  if(h.status==="sent") return `<div class="handoff sent">→ ${esc(h.to_name)}에게 자동으로 넘김${h.note?` · "${esc(h.note)}"`:""}
    <button data-flow="${h.chain}">흐름 보기</button></div>`;
  return `<div class="handoff blocked">넘기려 했지만 멈춤: ${esc(h.reason||"")}${h.chain?` <button data-flow="${h.chain}">흐름 보기</button>`:""}</div>`;
}
function ansCard(p,a,o={}){
  return `<div class="ans" data-key="${p}">
    <div class="who"><span class="dot" style="background:${P_(p).color}"></span>${P_(p).name}<span class="model">${esc(a?.model||(p.includes("@")?p.slice(p.indexOf("@")+1):modelOf(p)))}</span></div>
    <div class="body">${a?ansBody(a):`<div class="thinking"><i></i><i></i><i></i></div>`}</div>
    <div class="meta">${a&&!a.error?metaHTML(a,{fb:o.fb,multi:o.multi,best:o.best===p}):""}</div>${a&&a.handoff?handoffHTML(a.handoff):""}</div>`;
}
const routeChip = r => r ? `<div class="route"><span class="dot" style="background:${P_(r.provider).color}"></span>자동 → ${esc(nameOf(r.provider))} · ${esc(r.reason)}${r.switch?` <span class="pill">모델 교체</span>`:""}</div>` : "";
function catLabel(sub){
  for(const b of state.cats||[]) for(const x of b.subs) if(x.id===sub) return `${b.name} › ${x.name}`;
  return null;
}
const METHOD = {ai:"AI", "ai-judge":"AI 판단", keyword:"키워드", tag:"#지정", length:"긴 글"};
const catChip = t => { const l=catLabel(t.category); if(!l) return "";
  const m = t.category_fixed ? "고침" : METHOD[t.cls?.method] || "";
  const tip = t.cls?.method==="ai" ? `임베딩 AI가 예시 문장과 비교해서 판별 (유사도 ${t.cls.score})` : t.cls?.method==="ai-judge" ? "헷갈려서 작은 AI가 직접 판단" : t.cls?.method==="keyword" ? "키워드로 판별 (AI 분류 모델이 없거나 꺼져 있음)" : "";
  return `<button class="catchip" data-cat title="${esc(tip)} — 틀렸으면 눌러서 고치기. 고친 질문은 AI의 예시로 추가돼요">${esc(l)}${m?` · ${m}`:""} ✎</button>` };
function buildTurn(t,idx,saved=true){
  const provs=Object.keys(t.answers), multi=provs.length>1;
  const el=document.createElement("div"); el.className="turn"+(multi?" wide":""); el.dataset.turn=idx;
  el.innerHTML=`<div class="user">${saved?`<button class="edit-btn" data-edit title="질문 고쳐서 다시 보내기">✎ 편집</button>`:""}<div class="bubble">${attachView(t)}${esc(t.q)}</div></div><div class="trim-slot">${trimNote(t.trimmed)}</div>
    <div class="route-slot">${t.from_handoff?`<div class="route">📨 ${esc(t.from_handoff.from_name)}에게서 넘겨받음 (${t.from_handoff.hop}/${t.from_handoff.max}번째) <button class="catchip" data-flow="${t.from_handoff.chain}">흐름 보기</button></div>`:""}${routeChip(t.route)}${saved?catChip(t):""}</div>
    <div class="answers ${multi?"multi":""}">${provs.map(p=>ansCard(p,t.answers[p],{fb:saved,multi,best:t.best})).join("")}</div><div class="src-slot">${sourcesHTML(t.sources)}${window.ragHTML?.(t.rag)||""}</div><div class="synth-slot"></div>`;
  provs.forEach(p=>{if(t.answers[p]&&!t.answers[p].error) el.querySelector(`[data-key="${p}"]`)._text=t.answers[p].text});
  if(saved) renderSynthSlot(el,t,idx);
  if(t.sources?.length) linkCites(el,t.sources);
  const sm=state.conv?.summary;
  if(saved && sm && sm.upto===idx && idx<=(state.conv.turns||[]).length)   // 이 턴 앞까지는 요약으로 기억 중
    el.insertAdjacentHTML("afterbegin",`<div class="sum-line"><span>🗂 위 ${sm.upto}턴은 요약해서 기억하고 있어요</span><button class="catchip" data-sumview>요약 보기</button></div>`);
  math(el);
  return el;
}
document.addEventListener("click",e=>{
  if(!e.target.closest("[data-sumview]")) return;
  const sm=state.conv?.summary; if(!sm) return;
  dialog("AI가 기억하는 앞선 대화 요약",`<p class="muted small" style="margin:0 0 8px">대화가 길어져서 오래된 ${sm.upto}턴을 이렇게 줄여서 AI에게 보내요. 최근 턴은 원문 그대로 가요.${sm.model?` (요약: ${esc(sm.model)})`:""}</p><div class="md">${md(sm.text)}</div>`,[{label:"닫기",value:null}]);
});
/* 답 속 [3] → 누르면 3번 출처가 열리는 작은 번호 (코드·링크 안은 그대로) */
function linkCites(root, src){
  root.querySelectorAll(".answers .md, .synth-slot .md").forEach(box=>{
    const walk=document.createTreeWalker(box,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest("code,pre,a,.katex")?NodeFilter.FILTER_REJECT:/\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP});
    const nodes=[]; while(walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach(n=>{
      const html=esc(n.nodeValue).replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g,(m,list)=>{
        const nums=list.split(",").map(x=>+x.trim()); if(nums.some(k=>k<1||k>src.length)) return m;
        return nums.map(k=>`<a class="cite" href="${esc(src[k-1].url)}" target="_blank" rel="noopener noreferrer" title="${esc(src[k-1].title||src[k-1].url)}">${k}</a>`).join("") });
      const span=document.createElement("span"); span.innerHTML=html; n.replaceWith(...span.childNodes);
    });
  });
}
const sourcesHTML = rows => rows&&rows.length ? `<div class="sources"><b>🌐 검색한 출처</b>${rows.map((r,i)=>`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">[${i+1}] ${esc(r.title||r.url)}</a>`).join("")}</div>` : "";
function attachView(t){
  const f=(t.files||t._files||[]).map(x=>`<span class="att-chip">📄 ${esc(x.name)}</span>`).join("");
  const im=(t.images||[]).map(id=>`<img class="att-img" src="/api/uploads/${id}" alt="첨부 이미지">`).join("")
         + (t._imgs||[]).map(u=>`<img class="att-img" src="${u}" alt="첨부 이미지">`).join("");
  return (f||im) ? `<div class="att-view">${im}${f}</div>` : "";
}
function renderTurn(t,idx,saved=true){ const el=buildTurn(t,idx,saved); $("#thread").append(el); return el; }
function refreshTurn(idx){  // 저장된 최신 상태로 그 턴만 다시 그림
  const old=$(`.turn[data-turn="${idx}"]`); if(old&&state.conv?.turns[idx]) old.replaceWith(buildTurn(state.conv.turns[idx],idx));
}
const trimNote = n => n ? `<div class="note">앞선 대화 ${n}턴은 길이 제한 때문에 AI에게 보내지 않았어요 (설정에서 조절)</div>` : "";
const labelsLine = l => l&&Object.keys(l).length ? `<div class="labels">심판에게는 이름을 숨기고 보여줬어요 · ${Object.entries(l).map(([k,p])=>`답변 ${k} = ${esc(nameOf(p))}`).join(" · ")}</div>` : "";
function renderSynthSlot(el,t,idx){
  const slot=el.querySelector(".synth-slot");
  const ok=Object.values(t.answers||{}).filter(a=>a&&!a.error).length;
  if(t.synth){
    const s=t.synth;
    slot.innerHTML=`<div class="synth ans" data-key="synth"><div class="who"><span class="dot" style="background:var(--accent)"></span>종합 답변<span class="model">${P_(s.provider).name} · ${esc(s.model)}</span></div>
      <div class="body">${bodyHTML(s)}</div>${labelsLine(s.labels)}<div class="meta">${s.error?"":metaHTML(s)}</div></div>`;
    slot.querySelector(".ans")._text=s.text; math(slot);
    return;
  }
  // 아직 답하지 않은 후보: 키가 있는 API + 설치된 로컬 모델 (예전 'local' 답은 모델 이름으로 비교)
  const answered=new Set(Object.entries(t.answers||{}).filter(([k,a])=>a&&!a.error).map(([k,a])=>k==="local"?"local@"+a.model:k));
  const missing=(state.cands||[]).filter(c=>!(t.images||[]).length||c.vision).map(c=>c.key).filter(k=>!answered.has(k)).slice(0,5);
  let html="";
  if(missing.length) html+=`<span class="small muted">다른 모델에게도 묻기</span>${missing.map(k=>
    `<button class="btn ghost chip" data-more="${esc(k)}" title="${k.startsWith("local@")&&!(state.cands.find(c=>c.key===k)||{}).loaded?"아직 안 켜진 모델이라 첫 답이 늦을 수 있어요":""}"><span class="dot" style="background:${P_(k).color}"></span>${esc(nameOf(k))}</button>`).join("")}`;
  if(ok>=2){
    const opts=Object.keys(PROV).filter(p=>state.status.keys[p]&&p!=="agent").map(p=>`<option value="${p}">${PROV[p].name}</option>`).join("");
    html+=`<span class="grow"></span><select class="sm" aria-label="심판 AI">${opts}</select><button class="btn ghost" data-synth="${idx}">비교해서 하나로 종합</button>`;
  }
  const okAns=Object.values(t.answers||{}).some(a=>a&&!a.error&&a.text);
  if(okAns && (state.bots||[]).length) html+=`<button class="btn ghost chip" data-handoff title="이 답을 다른 봇에게 넘겨서 이어서 처리">→ 봇에게 넘기기</button>`;
  if(okAns && (state.conv?.bot_id || state.status?.settings?.memory_enabled!==false)) html+=`<button class="btn ghost chip" data-suggest title="이 대화에서 앞으로 기억할 만한 것을 AI가 찾아줘요">🧠 기억할 점</button>`;
  if(state.conv && idx<state.conv.turns.length-1) html+=`<button class="btn ghost chip" data-branch title="이 질문까지 복사해서 새 대화로 — 원래 대화는 그대로">⑂ 여기서 가지치기</button>`;
  if(state.conv && idx===state.conv.turns.length-1) html=`<button class="btn ghost chip" data-regen title="같은 질문을 다시 보내서 새 답 받기 (지금 답은 보관함으로)">↻ 다시 생성</button>`+html;
  slot.innerHTML = html ? `<div class="synth-bar">${html}</div>` : "";
}
$("#thread").onclick=async e=>{
  const cp=e.target.closest("[data-copy]");
  if(cp){await navigator.clipboard.writeText(cp.closest(".ans")._text||"");cp.textContent="복사됨";setTimeout(()=>cp.textContent="복사",1400);return}
  const sb=e.target.closest("[data-synth]"); if(sb&&!state.busy) return runSynth(+sb.dataset.synth, sb.previousElementSibling.value);
  const oldAttach = t => [...(t.files||[]).map(f=>({name:f.name,kind:"text",content:f.content})),
                          ...(t.images||[]).map(id=>({name:"이미지",kind:"image_ref",content:id}))];
  if(e.target.closest("[data-regen]")&&!state.busy){
    const idx=state.conv.turns.length-1, t=state.conv.turns[idx];
    return send({text:t.q, attach:oldAttach(t), replaceFrom:idx});
  }
  const eb=e.target.closest("[data-edit]");
  if(eb&&!state.busy){
    const turnEl=eb.closest(".turn"), idx=+turnEl.dataset.turn, t=state.conv.turns[idx];
    const after=state.conv.turns.length-1-idx;
    const box=turnEl.querySelector(".user");
    box.innerHTML=`<div class="edit-box"><textarea rows="3">${esc(t.q)}</textarea>
      <div class="edit-actions"><span class="small muted">${after?`보내면 아래 대화 ${after}턴은 보관함으로 옮겨져요. `:""}${(t.files||[]).length||(t.images||[]).length?"첨부는 그대로 유지돼요.":""}</span>
      <button class="btn ghost" data-ecancel>취소</button><button class="btn" data-esend>보내기</button></div></div>`;
    const ta=box.querySelector("textarea"); ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length);
    box.querySelector("[data-ecancel]").onclick=()=>refreshTurn(idx);
    box.querySelector("[data-esend]").onclick=()=>{ const v=ta.value.trim(); if(v) send({text:v, attach:oldAttach(t), replaceFrom:idx}) };
    ta.onkeydown=ev=>{ if(ev.key==="Enter"&&!ev.shiftKey&&!ev.isComposing){ev.preventDefault();box.querySelector("[data-esend]").click()} if(ev.key==="Escape") refreshTurn(idx) };
    return;
  }
  const hb=e.target.closest("[data-handoff]");
  if(hb&&!state.busy){
    const idx=+hb.closest(".turn").dataset.turn, me=state.conv.bot_id;
    const opts=state.bots.filter(b=>b.id!==me).map(b=>`<option value="${b.id}">${esc(b.emoji+" "+b.name)}</option>`).join("");
    if(!opts) return toast("넘겨줄 다른 봇이 없어요. 봇 페이지에서 만들어주세요.");
    const v=await dialog("다른 봇에게 넘기기",`<label for="hbBot">받을 봇</label><select id="hbBot">${opts}</select>
      <label for="hbNote">부탁할 일 <small>— 비우면 "네 역할에 맞게 이어서 처리"</small></label><input id="hbNote" placeholder="예: 이 내용으로 발표 대본 써줘">
      <p class="muted small">받은 봇이 뒤에서 일하고, 끝나면 봇 메뉴에 새 결과 표시가 떠요.</p>`,[{label:"취소",value:null,kind:"ghost"},{label:"넘기기",value:"ok"}]);
    if(v){ try{ const r=await sendJSON("/api/bots/handoff","POST",{conv_id:state.convId,turn:idx,to_bot:$("#hbBot").value,note:$("#hbNote").value});
      toast(`${r.to}에게 넘겼어요. 끝나면 알려줄게요.`); setTimeout(refreshUnread,4000) }catch(err){toast(err.message)} }
    return;
  }
  const sg=e.target.closest("[data-suggest]");
  if(sg&&!state.busy){
    const idx=+sg.closest(".turn").dataset.turn, bid=state.conv.bot_id;
    const base = bid ? `/api/bots/${bid}/memory` : "/api/memory";   // 봇 대화면 봇 기억, 아니면 전체 기억
    sg.disabled=true; sg.textContent="찾는 중…";
    try{
      const r=await sendJSON(`${base}/suggest`,"POST",{conv_id:state.convId,turn:idx});
      if(!r.suggestions.length){ toast("새로 기억할 만한 것을 못 찾았어요."); return }
      const v=await dialog(bid?"봇이 기억할 점":"기억할 점",`<p class="muted small" style="margin:0 0 8px">저장할 것만 고르세요. ${bid?"봇 페이지":"설정 → 기억 관리"}에서 언제든 지울 수 있어요.</p>
        ${r.suggestions.map((x,i)=>`<label class="check-row"><input type="checkbox" class="sgk" value="${i}" checked> ${esc(x)}</label>`).join("")}`,
        [{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"ok"}]);
      if(v){ const pick=[...document.querySelectorAll(".sgk:checked")].map(c=>r.suggestions[+c.value]);
        for(const x of pick) await sendJSON(base,"POST",{text:x});
        toast(`${pick.length}개를 기억했어요.`); loadBots() }
    }catch(err){toast(err.message)} finally{ refreshTurn(idx) }
    return;
  }
  const cb=e.target.closest("[data-cat]");
  if(cb&&!state.busy){
    const idx=+cb.closest(".turn").dataset.turn, t=state.conv.turns[idx];
    const opts=(state.cats||[]).map(b=>`<optgroup label="${esc(b.name)}">${b.subs.map(x=>`<option value="${x.id}" ${x.id===t.category?"selected":""}>${esc(x.name)}</option>`).join("")}</optgroup>`).join("");
    const v=await dialog("질문 종류 고치기",`<p class="muted small" style="margin:0 0 8px">"${esc(t.q.slice(0,60))}" — 올바른 종류를 고르면 이 질문의 평가가 그 종류로 기록되고, AI 분류기의 예시로도 추가돼서 비슷한 질문을 더 잘 맞히게 돼요. 다음부터는 질문 앞에 #종류이름 을 붙여서 직접 지정할 수도 있어요.</p><select id="dv">${opts}</select>`,[{label:"취소",value:null,kind:"ghost"},{label:"저장",value:"ok"}]);
    if(v){ try{ state.conv.turns[idx]=await sendJSON("/api/turn-category","POST",{conv_id:state.convId,turn:idx,sub:$("#dv").value}); refreshTurn(idx); toast("종류를 고쳤어요.") }catch(err){toast(err.message)} }
    return;
  }
  const mb=e.target.closest("[data-more]"); if(mb&&!state.busy) return runAskMore(+mb.closest(".turn").dataset.turn, [mb.dataset.more]);
  const fb=e.target.closest("[data-fb]");
  if(fb&&!state.busy){
    const idx=+fb.closest(".turn").dataset.turn, prov=fb.closest(".ans").dataset.key, cur=fb.classList.contains("on");
    const value = fb.dataset.fb==="best" ? "best" : (cur ? "none" : fb.dataset.fb);
    try{ state.conv.turns[idx]=await sendJSON("/api/feedback","POST",{conv_id:state.convId,turn:idx,provider:prov,value}); refreshTurn(idx);
      if(!cur) toast(fb.dataset.fb==="down"?"기록했어요. 자동 모드가 이 종류 질문에서 참고해요.":"기록했어요. 자동 모드가 학습해요."); }
    catch(err){toast(err.message)}
  }
};
async function runAskMore(idx,provs){
  const el=$(`.turn[data-turn="${idx}"]`), box=el.querySelector(".answers");
  el.classList.add("wide"); box.classList.add("multi");
  el.querySelector(".synth-slot").innerHTML="";
  const lives={};
  provs.forEach(p=>{ box.querySelector(`[data-key="${p}"]`)?.remove(); box.insertAdjacentHTML("beforeend",ansCard(p,null)); lives[p]=makeLive(box.querySelector(`[data-key="${p}"]`)) });
  setBusy(true);
  try{
    const res=await api("/api/ask-more",{method:"POST",signal:state.abort.signal,body:JSON.stringify({conv_id:state.convId,turn:idx,targets:targetsOf(provs)})});
    await streamNDJSON(res,ev=>{
      if(ev.type==="meta") state.runId=ev.run_id;
      else if(ev.type==="think") lives[ev.key].think(ev.d);
      else if(ev.type==="delta") lives[ev.key].push(ev.d);
      else if(ev.type==="done") lives[ev.key].finish(ev.result);
      else if(ev.type==="end") setSpend(ev.spent_today);
    });
  }catch(err){ toast(err.message) }
  finally{ try{state.conv=await getJSON("/api/conversations/"+state.convId)}catch{} refreshTurn(idx); setBusy(false) }
}
function makeLive(card){
  let text="",think="",queued=false,done=false; const body=card.querySelector(".body");
  const draw=()=>{ queued=false; if(done) return;
    const th = think ? thinkHTML(think, !text) : "";   // 생각 중일 땐 펼쳐서, 답이 나오기 시작하면 접어서
    const shown = text.replace(/\n?\[\[\s*넘기기[\s\S]*$/, "");   // 봇이 쓰는 넘기기 줄은 보여주지 않음
    body.innerHTML = th + (text?`<div class="md cursor">${md(shown)}</div>`:(think?"":`<div class="thinking"><i></i><i></i><i></i></div>`)); scrollDown() };
  const q=()=>{ if(!queued){queued=true;requestAnimationFrame(draw)} };
  return {
    push(d){text+=d;card._text=text;q()},
    think(d){think+=d;q()},
    finish(r){done=true;body.innerHTML=ansBody(r);card._text=r.text;card.querySelector(".meta").innerHTML=r.error?"":metaHTML(r);math(body)}
  };
}
const thinkHTML=(t,open)=>`<details class="think" ${open?"open":""}><summary>${open?"생각하는 중…":`생각 과정 (${t.length.toLocaleString()}자)`}</summary><div class="think-body">${esc(t)}</div></details>`;
let stick=true;
$("#scroll").addEventListener("scroll",()=>{const s=$("#scroll");stick=s.scrollHeight-s.scrollTop-s.clientHeight<80});
function scrollDown(force){const s=$("#scroll");if(force||stick)s.scrollTop=s.scrollHeight}
