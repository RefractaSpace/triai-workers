/* core.js — 공통 기반: 앱 상태, 서버 통신·대화상자 같은 도우미, 화면 전환, 모델 선택
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 상태 ═════════ */
const PROV = {claude:{name:"Claude",color:"var(--claude)"}, gpt:{name:"GPT",color:"var(--gpt)"}, gemini:{name:"Gemini",color:"var(--gemini)"},
  local:{name:"로컬",color:"var(--local)"},   // 로컬 = 내 컴퓨터의 Ollama (무료)
  cf:{name:"Cloudflare",color:"var(--cf)"},   // Cloudflare Workers AI: 오픈 모델(gpt-oss 등), 하루 무료 한도
  agent:{name:"에이전트 팀",color:"var(--agent)"}};   // Claude Console의 에이전트 팀 (비쌈 → 자동·비교 모드에는 안 들어감)
const missingText = p => p==="local" ? "Ollama 꺼짐 또는 모델 없음" : p==="agent" ? "Claude 키 필요 — .env 확인"
  : p==="cf" ? "CLOUDFLARE_API_TOKEN·ACCOUNT_ID 없음 — .env 확인" : "API 키 없음 — .env 확인";
const $ = s => document.querySelector(s);
const state = {
  status:null, view:"home",           // home | chat | projects | project | admin
  convId:null, conv:null, projectId:null, projects:[],
  busy:false, abort:null, runId:null,
  mode: localStorage.getItem("mode") || "auto",   // auto | claude | gpt | gemini | all
  models: JSON.parse(localStorage.getItem("models") || "null") || {},
  lists:{},
};
const SEND_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
const STOP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>`;
$("#send").innerHTML = SEND_ICON;
/* ═════════ 도우미 ═════════ */
function toast(msg){const t=$("#toast");t.textContent=msg;t.style.display="block";clearTimeout(t._h);t._h=setTimeout(()=>t.style.display="none",4200)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
// 답 속 외부 이미지는 그리지 않음 (악성 페이지가 AI를 조종해 이미지 주소로 내 정보를 빼가는 공격 방지).
// 보안 정책(CSP)이 1차로 막고, 여기서는 왜 안 보이는지 알 수 있게 표시로 바꿔줌.
if (window.DOMPurify) DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") || "";
    if (!/^(\/|data:image\/|blob:)/.test(src)) {
      const span = document.createElement("span"); span.className = "img-blocked";
      span.textContent = "🚫 외부 이미지 차단됨"; span.title = "주소: " + src.slice(0, 200);
      node.replaceWith(span);
    }
  }
  if (node.tagName === "A" && /^https?:/.test(node.getAttribute("href") || "")) {
    node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer");
    node.setAttribute("title", node.getAttribute("href"));   // 누르기 전에 진짜 주소를 볼 수 있게
  }
});
function md(text){
  // 내 컴퓨터 도구 요청 블록(```tool {...})은 숨김 — 바로 아래 '📂 도구 — 완료' 기록이 대신 보여요 (쓰는 중인 블록도)
  text=String(text??"").replace(/```tool[ \t]*\r?\n[\s\S]*?```[ \t]*\n?/g,"").replace(/```tool[ \t]*\r?\n[\s\S]*$/,"");
  if(window.marked && window.DOMPurify){
    const arts=[];
    if(window.artCards!==false) text=text.replace(ART_FENCE,(m,lang,body,end)=>{ arts.push({lang,body,done:!!end}); return `\n\n\uE000A${arts.length-1}\uE001\n\n` });   // 아티팩트 → 카드
    const charts=[];   // ```chart (JSON) → 답 안에 바로 그리는 차트
    text=text.replace(/(?:^|\n)```chart[^\n]*\n([\s\S]*?)(\n```|$)/g,(m,body,end)=>{ charts.push({body,done:!!end}); return `\n\n\uE000C${charts.length-1}\uE001\n\n` });
    const {out,saved}=hideMath(text);
    let html=DOMPurify.sanitize(marked.parse(out,{breaks:true}));
    html=html.replace(/<p>\uE000A(\d+)\uE001<\/p>|\uE000A(\d+)\uE001/g,(_,a,b)=>artCard(arts[+(a??b)]));
    html=html.replace(/<p>\uE000C(\d+)\uE001<\/p>|\uE000C(\d+)\uE001/g,(_,a,b)=>{ const c=charts[+(a??b)]; return window.chartHTML?chartHTML(c.body,c.done):"" });
    return html.replace(/\uE000M(\d+)\uE001/g,(_,i)=>esc(saved[+i]));   // 수식은 글자 그대로 돌려놓음 → math()에서 KaTeX가 그림
  }
  return "<p>"+esc(text).replace(/\n/g,"<br>")+"</p>";
}
/* 마크다운이 \[ \( \\ _ * 를 바꿔버리기 전에 수식을 잠시 빼 둠 (코드 블록·인라인 코드 안은 건드리지 않음) */
const MATH_RE=/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$\w])\$(?!\s)[^\n$]+?(?<!\s)\$(?![\w$])/g;
function hideMath(text){
  const saved=[];
  const parts=text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/);   // 홀수 칸 = 코드
  const out=parts.map((p,i)=> i%2 ? p : p.replace(MATH_RE,m=>{ saved.push(m); return `\uE000M${saved.length-1}\uE001` })).join("");
  return {out,saved};
}
function math(el){   // 답이 다 그려진 뒤: 수식 예쁘게 + 코드 블록에 버튼 달기
  if(window.renderMathInElement) try{ renderMathInElement(el,{delimiters:[
    {left:"$$",right:"$$",display:true},{left:"\\[",right:"\\]",display:true},
    {left:"$",right:"$",display:false},{left:"\\(",right:"\\)",display:false}],throwOnError:false}) }catch{}
  enhanceCode(el);
  window.artLabelVersions?.();   // 아티팩트 카드 버전 번호
  window.featuresEnhance?.(el);   // features.js: 🔊 읽어주기 버튼 등
}
/* ═════════ 화면 전환 ═════════ */
function setView(v){
  state.view=v;
  const composer=$("#composer-wrap");
  $("#main").append(composer);   // 페이지를 다시 그릴 때 입력창이 같이 지워지지 않게 먼저 빼둠
  $("#input").placeholder="메시지를 입력하세요";
  $("#empty").hidden = v!=="home";
  $("#scroll").hidden = v!=="chat";
  $("#page").hidden = !["projects","project","admin","cats","bots","bot","models","team","skills","connections","artifacts"].includes(v);
  $("#picker-wrap").hidden = !["home","chat","project","bot"].includes(v);
  $("#convMenuBtn").hidden = v!=="chat";
  composer.hidden = !["home","chat","project","bot"].includes(v);
  if(v==="home") $("#empty").append(composer);
  // 크럼(상단 경로): 프로젝트 안의 대화/새 대화일 때 표시
  const pid = v==="chat" ? state.conv?.project_id : (v==="home" ? state.projectId : null);
  const bid = v==="chat" ? state.conv?.bot_id : (v==="home" ? state.botId : null);
  const bot = bid && botOf(bid);
  $("#crumb").hidden=!pid&&!bot;
  $("#crumb").textContent = bot ? `${bot.emoji} ${bot.name}  /` : pid ? (projName(pid)||"프로젝트")+"  /" : "";
  $("#crumb").dataset.pid=pid||""; $("#crumb").dataset.bid=bot?bid:"";
  document.querySelectorAll(".nav[data-go]").forEach(n=>n.classList.toggle("active",
    n.dataset.go==="projects" ? (v==="projects"||v==="project") : n.dataset.go==="admin" ? (v==="admin"||v==="cats")
    : n.dataset.go==="bots" ? (v==="bots"||v==="bot") : n.dataset.go===v));
  if(innerWidth<760) $("#side").classList.add("hidden");
}
$("#crumb").onclick=()=>{const b=$("#crumb").dataset.bid, p=$("#crumb").dataset.pid; if(b) openBot(b); else if(p) openProject(p)};
document.querySelectorAll(".nav[data-go]").forEach(n=>n.onclick=()=>{
  if(state.busy) return toast("답변이 끝난 뒤에 이동하세요.");
  n.dataset.go==="projects" ? openProjects() : n.dataset.go==="bots" ? openBots() : n.dataset.go==="models" ? openModels()
    : n.dataset.go==="skills" ? openSkills() : n.dataset.go==="connections" ? openConnections() : n.dataset.go==="artifacts" ? openGallery() : openAdmin();
});
/* ═════════ 모델 선택 ═════════ */
function renderPicker(){
  const m=state.mode;
  paintTri($("#pickerTri"), m==="all"?["claude","gpt","gemini"]:m==="auto"?[]:[m]);
  $("#pickerLabel").textContent = m==="all"?"모두 비교":m==="auto"?"자동":PROV[m].name;
  $("#pickerModel").textContent = m==="all"?`${activeProviders().length}개 동시`:m==="auto"?"질문마다 1개 선택":modelOf(m);
  const k=state.status.keys;
  $("#menu").innerHTML = `<button class="opt ${m==="auto"?"sel":""}" data-mode="auto">
      <svg class="tri" viewBox="0 0 24 24"><path d="M12 4 20 18H4Z"/><circle cx="12" cy="4" r="3"/><circle cx="4" cy="18" r="3"/><circle cx="20" cy="18" r="3"/></svg>
      <span><b>자동 (추천)</b><em>내 👍👎 평가를 보고 질문마다 AI 1개 선택 · 성적 비슷하면 더 싼 쪽</em></span><span class="check">✓</span></button><div class="sep"></div>`
    + Object.entries(PROV).map(([p,v])=>`<button class="opt ${state.mode===p?"sel":""}" data-mode="${p}" ${k[p]?"":"disabled"}>
      <span class="dot" style="background:${v.color}"></span><span><b>${v.name}${p==="local"?" · 무료":p==="cf"?" · 하루 무료 한도":p==="agent"?" · Console":""}</b><em>${k[p]?esc(modelOf(p))+(p==="agent"?` · 질문당 최대 $${(+(state.status.settings?.agent_budget??2)).toFixed(2)}`:""):missingText(p)}</em></span><span class="check">✓</span></button>`).join("")
    + `<div class="sep"></div><button class="opt ${state.mode==="all"?"sel":""}" data-mode="all">
      <svg class="tri" viewBox="0 0 24 24"><path d="M12 4 20 18H4Z"/><circle cx="12" cy="4" r="3" class="on-claude"/><circle cx="4" cy="18" r="3" class="on-gpt"/><circle cx="20" cy="18" r="3" class="on-gemini"/></svg>
      <span><b>모두 비교</b><em>사용 가능한 AI 전부에 동시에 · 중요한 질문에만</em></span><span class="check">✓</span></button>`;
}
$("#picker").onclick=e=>{e.stopPropagation();$("#convMenu").classList.remove("open");$("#menu").classList.toggle("open")};
$("#menu").onclick=e=>{const b=e.target.closest(".opt");if(!b||b.disabled)return;state.mode=b.dataset.mode;localStorage.setItem("mode",state.mode);renderPicker();$("#menu").classList.remove("open");preview()};
document.addEventListener("click",()=>{$("#menu").classList.remove("open");$("#convMenu").classList.remove("open")});
