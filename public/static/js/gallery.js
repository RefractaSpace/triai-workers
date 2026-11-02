/* gallery.js — 아티팩트 보관함 + 공개 링크
   · 보관함: 모든 대화에서 만든 아티팩트를 모아 봄 (같은 대화·같은 제목은 버전으로 묶어 최신 것만)
   · 공개 링크: 파이(게이트웨이)에 읽기 전용 사본을 올려서 로그인 없이 볼 수 있는 주소를 만듦
     - 보는 사람 쪽에서도 격리된 창에서만 실행 (TriAI 쿠키·데이터 접근 불가, 외부 통신 금지) */

let pubCache=null;   // 내 공개 링크 목록 (aid → 링크)
async function pubLinks(force){
  if(pubCache && !force) return pubCache;
  if(!state.status?.gateway) return null;   // 내 컴퓨터에서 혼자 쓸 때는 공개 링크 없음
  try{ pubCache=await getJSON("/gw/share") }catch{ pubCache=null }   // 게이트웨이 없이(PC 단독) 돌 때는 공유 없음
  return pubCache;
}
const pubURL = id => location.origin+"/s/"+id;

window.artShare=async id=>{
  const a=ARTS[id]; if(!a) return;
  if(!state.status?.gateway) return toast("공개 링크는 파이(게이트웨이)로 접속했을 때만 만들 수 있어요");
  const ok=await confirmBox("공개 링크 만들기",
    `<b>${esc(a.title)}</b>를 <b>로그인 없이 누구나</b> 볼 수 있는 주소로 만들어요.<br>링크를 아는 사람만 볼 수 있고, 언제든 끊을 수 있어요.<br>
     <span class="small">개인 정보(이름·주소·사진)가 들어 있지 않은지 먼저 확인하세요.</span>`,"링크 만들기");
  if(!ok) return;
  let r;
  try{ r=await sendJSON("/gw/share","POST",{aid:id,title:a.title,lang:a.lang,src:a.src,doc:artifactDoc(a.src,a.lang)}) }
  catch(err){ return toast(/Not Found|404/.test(err.message)?"공개 링크는 파이(게이트웨이)로 접속했을 때만 만들 수 있어요":err.message) }
  pubCache=null;
  showLink(r.id, a.title, r.again);
};

async function showLink(sid, title, again){
  const url=pubURL(sid);
  const v=await dialog(again?"이미 공유한 아티팩트예요":"공개 링크를 만들었어요",
    `<p class="muted small" style="margin:0 0 10px">${esc(title)} — 이 주소를 보내면 로그인 없이 볼 수 있어요.</p>
     <div class="link-row"><input readonly value="${esc(url)}" aria-label="공개 링크"></div>`,
    [{label:"링크 끊기",value:"del",kind:"ghost danger",left:true},{label:"열어 보기",value:"open",kind:"ghost"},{label:"복사",value:"copy"}]);
  if(v==="copy"){ try{ await navigator.clipboard.writeText(url); toast("링크를 복사했어요") }catch{ toast(url) } }
  if(v==="open") window.open(url,"_blank","noopener");
  if(v==="del" && await confirmBox("링크 끊기","이 주소로는 더 이상 볼 수 없게 돼요. (아티팩트 자체는 대화에 그대로 있어요)","끊기",true)){
    try{ await api("/gw/share/"+sid,{method:"DELETE"}); pubCache=null; toast("링크를 끊었어요"); if(state.view==="artifacts") openGallery() }catch(err){ toast(err.message) }
  }
}

const GAL_ICON={html:"🌐",svg:"🖼",mermaid:"📊",jsx:"⚛",tsx:"⚛",react:"⚛"};
async function openGallery(q=""){
  setView("artifacts");
  let list=[]; try{ list=await getJSON("/api/artifacts?q="+encodeURIComponent(q)) }catch(err){ toast(err.message) }
  const links=await pubLinks(true), byAid={}; (links||[]).forEach(l=>byAid[l.aid]=l);
  const kinds=[["","전체"],["html","웹페이지"],["jsx","React 앱"],["svg","그림"],["mermaid","도표"]];
  const card=a=>{ const l=byAid[a.id];
    return `<div class="pcard gal-card" data-gal="${esc(a.conv_id)}|${a.turn}|${esc(a.key)}|${a.n}" data-lang="${a.lang==="tsx"||a.lang==="react"?"jsx":a.lang}" tabindex="0" role="button">
      <div class="gal-top"><span class="gal-ic" aria-hidden="true">${GAL_ICON[a.lang]||"📄"}</span>${l?`<span class="gal-pub" title="공개 링크 있음 · ${l.views||0}번 열림">🔗 공개</span>`:""}</div>
      <b>${esc(a.title)}</b>
      <span class="desc">${esc(a.conv_title||"대화")}</span>
      <span class="stat">${esc(a.kind)} · ${a.lines}줄${a.versions>1?` · 버전 ${a.versions}개`:""}${a.time?` · ${ago(a.time)}`:""}</span>
      <span class="gal-act"><button class="btn ghost chip" data-goconv="${esc(a.conv_id)}">대화로</button>${l?`<button class="btn ghost chip" data-link="${esc(l.id)}">링크</button>`:""}</span></div>` };
  $("#page").innerHTML=`<div class="page"><div class="page-head"><div style="flex:1"><h1>아티팩트</h1>
    <p>대화에서 만든 웹페이지·앱·그림·도표를 모아 봐요. 눌러서 열고, 링크 버튼으로 로그인 없이 볼 수 있는 주소를 만들 수 있어요.</p></div></div>
    <div class="gal-tools"><input id="galQ" class="side-search" placeholder="제목·대화 이름으로 찾기" value="${esc(q)}" aria-label="아티팩트 찾기">
      <div class="seg" id="galKind">${kinds.map(([k,n],i)=>`<button data-k="${k}" class="${i?"":"on"}">${n}</button>`).join("")}</div></div>
    <div class="grid" id="galGrid">${list.map(card).join("")||`<div class="empty-note" style="grid-column:1/-1">${q?"찾는 아티팩트가 없어요.":"아직 없어요. 대화에서 \"계산기 웹페이지 만들어 줘\"처럼 부탁하면 여기에 모여요."}</div>`}</div>
    ${links===null?`<p class="small muted" style="margin:18px 4px">공개 링크는 파이(게이트웨이)로 접속했을 때 쓸 수 있어요.</p>`:""}</div>`;
  $("#galQ").onkeydown=e=>{ if(e.key==="Enter") openGallery(e.target.value) };
  $("#galKind").onclick=e=>{ const b=e.target.closest("[data-k]"); if(!b) return;
    $("#galKind").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
    document.querySelectorAll("#galGrid .gal-card").forEach(c=>c.hidden=!!b.dataset.k && c.dataset.lang!==b.dataset.k) };
  const open=async c=>{ const [cid,turn,key,n]=c.dataset.gal.split("|");
    try{ const a=await getJSON(`/api/artifacts/${encodeURIComponent(cid)}/${turn}/${encodeURIComponent(key)}/${n}`); openArtifact(a.src,a.lang) }catch(err){ toast(err.message) } };
  $("#page").onclick=e=>{
    const g=e.target.closest("[data-goconv]"); if(g){ openConv(g.dataset.goconv); return }
    const l=e.target.closest("[data-link]"); if(l){ const c=l.closest(".gal-card"); showLink(l.dataset.link, c.querySelector("b").textContent); return }
    const c=e.target.closest(".gal-card"); if(c) open(c);
  };
  $("#page").onkeydown=e=>{ const c=e.target.closest?.(".gal-card"); if(c && (e.key==="Enter"||e.key===" ") && e.target===c){ e.preventDefault(); open(c) } };
}
