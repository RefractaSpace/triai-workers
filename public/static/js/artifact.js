/* artifact.js — 답 안의 코드 블록 버튼(복사·미리보기)과 아티팩트 격리 창
   TriAI 화면 코드는 여러 파일로 나뉘어 있고, index.html에 적힌 순서대로 불러와요.
   파일끼리 함수·변수를 그대로 함께 써요 (core.js의 $, api, state 등). */

/* ═════════ 코드 블록 · 아티팩트 ═════════ */
function enhanceCode(root){
  root.querySelectorAll(".md pre > code").forEach(code=>{
    const pre=code.parentElement; if(pre.dataset.done) return; pre.dataset.done=1;
    const lang=(code.className.match(/language-([\w-]+)/)||[])[1]||"";
    const bar=document.createElement("div"); bar.className="code-bar";
    const isArt = state.status?.settings?.artifacts!==false && (lang==="html"||lang==="svg");
    const isPy = state.status?.settings?.code_tool!==false && (lang==="python"||lang==="py");   // 모델이 ```run 대신 보여주기만 한 코드도 바로 실행
    bar.innerHTML=`<span>${lang==="run"?"🐍 실행한 코드":lang==="text"?"":esc(lang)}</span>`
      + (isArt?`<button data-art>▶ 미리보기</button>`:"") + (isPy?`<button data-run title="파이의 코드 실행 상자에서 실행 (작업 폴더 안에서만)">▶ 실행</button>`:"") + `<button data-cpy>복사</button>`;
    pre.before(bar);
    bar.querySelector("[data-cpy]").onclick=async e=>{ await navigator.clipboard.writeText(code.textContent); e.target.textContent="복사됨"; setTimeout(()=>e.target.textContent="복사",1200) };
    if(isArt) bar.querySelector("[data-art]").onclick=()=>openArtifact(code.textContent, lang);
    if(isPy) bar.querySelector("[data-run]").onclick=async e=>{
      const b=e.target; if(b.disabled) return; b.disabled=true; b.textContent="실행 중…";
      let out=pre.nextElementSibling?.classList.contains("run-out") ? pre.nextElementSibling : null;
      if(!out){ out=document.createElement("div"); out.className="run-out md"; pre.after(out) }
      out.innerHTML=`<div class="thinking"><i></i><i></i><i></i></div>`;
      try{ const r=await sendJSON("/api/run","POST",{code:code.textContent,conv_id:state.convId||null}); out.innerHTML=md(r.markdown); math(out) }
      catch(err){ out.innerHTML=`<p class="err">${esc(err.message)}</p>` }
      b.disabled=false; b.textContent="▶ 다시 실행";
    };
    if(lang==="text" && pre.previousElementSibling?.previousElementSibling?.classList?.contains("run-label")) bar.remove();
  });
}
/* ═════════ 아티팩트 (Claude 아티팩트처럼) ═════════
   답 안의 ```html / ```svg / ```mermaid / ```jsx(React) 블록 → 코드 대신 '카드'
   · 쓰는 중이면 "작성 중… N줄" 카드, 다 쓰면 옆 창이 자동으로 열림
   · 같은 제목으로 다시 만들면 버전 (v1, v2 … ‹ › 로 넘기기)
   · 실행은 늘 격리된 창(/static/artifact.html, 외부 통신 금지)에서 */
const ART_FENCE=/(?:^|\n)```(html|svg|mermaid|jsx|tsx|react)[^\n]*\n([\s\S]*?)(\n```|$)/g;
const ARTS={};   // id → {src, lang, title}
const ART_KIND={html:["웹페이지","🌐"],svg:["그림(SVG)","🖼"],mermaid:["도표","📊"],jsx:["React 앱","⚛"],tsx:["React 앱","⚛"],react:["React 앱","⚛"]};
function artHash(t){ let h=5381; for(let i=0;i<t.length;i++) h=((h<<5)+h+t.charCodeAt(i))|0; return "a"+(h>>>0).toString(36)+t.length.toString(36) }
function artTitle(src, lang){
  const pick=re=>{ const m=src.match(re); return m && m[1].replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim().slice(0,60) };
  if(lang==="html"||lang==="svg") return pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || ART_KIND[lang][0];
  if(lang==="mermaid") return pick(/^\s*%%\s*title:\s*(.+)$/m) || pick(/^\s*title\s+(.+)$/m) || "도표";
  return pick(/\/\/\s*title:\s*(.+)/) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/) || pick(/export\s+default\s+function\s+(\w+)/) || "React 앱";
}
function artCard(a){
  if(state.status?.settings?.artifacts===false) return `<pre><code class="language-${a.lang}">${esc(a.body)}</code></pre>`;
  const [kind,icon]=ART_KIND[a.lang]||["아티팩트","📄"], lines=a.body.split("\n").length;
  if(!a.done){ artLive(a.lang,a.body); return `<div class="art-card writing"><span class="ac-ic">${icon}</span><span class="ac-t"><b>${esc(kind)} 만드는 중…</b><small>${lines}줄 작성</small></span><span class="ac-spin"></span></div>` }
  const id=artHash(a.lang+a.body), title=artTitle(a.body,a.lang);
  ARTS[id]={src:a.body, lang:a.lang, title};
  return `<button class="art-card" data-art-id="${id}" data-title="${esc(title)}"><span class="ac-ic">${icon}</span>
    <span class="ac-t"><b>${esc(title)}</b><small>${esc(kind)} · ${lines}줄 · 눌러서 열기</small></span><span class="ac-go">›</span></button>`;
}
document.addEventListener("click",e=>{ const c=e.target.closest(".art-card[data-art-id]"); if(c) openArtifactId(c.dataset.artId) });
/* 쓰는 동안: 옆 창에 코드가 실시간으로 (넓은 화면, 답을 받는 중일 때만) — 다 쓰면 artAutoOpen이 미리보기로 바꿈 */
let artLiveFrame=0, artLiveData=null;
function artLive(lang, body){
  artLiveData={lang,body};
  if(!artLiveFrame) artLiveFrame=requestAnimationFrame(()=>{ artLiveFrame=0; artLivePaint() });
}
function artLivePaint(){
  const d=artLiveData; if(!d || !state.busy || innerWidth<1000) return;
  const panel=artPanel(), [kind,icon]=ART_KIND[d.lang]||["아티팩트","📄"], pre=panel.querySelector(".art-code");
  if(!panel._live){   // 처음 한 번: 미리보기 대신 코드 화면으로
    panel._live=true; panel._id=null; panel.classList.add("open","writing"); document.body.classList.add("art-open");
    panel.querySelector(".ah-ic").textContent=icon; panel.querySelector(".ah-ver").hidden=true; panel.querySelector(".art-err").hidden=true;
    panel.querySelector("iframe").hidden=true; pre.hidden=false;
    panel.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("on",x.dataset.tab==="code"));
  }
  panel.querySelector(".ah-t b").textContent=`${kind} 만드는 중…`;
  panel.querySelector(".ah-t small").textContent=`${d.body.split("\n").length}줄`;
  const atEnd=pre.scrollHeight-pre.scrollTop-pre.clientHeight<40;   // 사용자가 위로 올려 보고 있으면 끌어내리지 않음
  pre.textContent=d.body; if(atEnd) pre.scrollTop=pre.scrollHeight;
}
/* 이번 답에서 새로 만든 아티팩트는 자동으로 열기 (대화를 다시 불러올 때는 안 열림) */
window.artAutoOpen=turn=>{ const t=document.querySelector(`#thread [data-turn="${turn}"]`)||document.querySelector("#thread .turn:last-child");
  const cards=t?.querySelectorAll(".art-card[data-art-id]"), panel=$("#artPanel");
  if(cards?.length && innerWidth>=760) openArtifactId(cards[cards.length-1].dataset.artId);
  else if(panel?._live){ panel._live=false; panel.classList.remove("open","writing"); document.body.classList.remove("art-open") } };   // 끝까지 못 쓰고 끝난 경우
const artNamed = a => !Object.values(ART_KIND).some(k=>k[0]===a.title);   // 기본 이름(웹페이지 등)뿐이면 서로 다른 것일 수 있어 버전으로 안 묶음
function artVersions(id){   // 같은 제목의 아티팩트들 (대화 순서) = 버전
  const a=ARTS[id], seen=new Set(), list=[];
  if(!artNamed(a)) return [id];
  document.querySelectorAll("#thread .art-card[data-art-id]").forEach(c=>{ const x=ARTS[c.dataset.artId];
    if(x && x.title===a.title && x.lang===a.lang && !seen.has(c.dataset.artId)){ seen.add(c.dataset.artId); list.push(c.dataset.artId) } });
  return list.length?list:[id];
}
const CDN="https://cdn.jsdelivr.net/npm";
/* React 아티팩트에서 쓸 수 있는 라이브러리 (브라우저용 UMD 파일 → 전역 변수) */
const REACT_LIBS={
  "react":{g:"React"}, "react-dom":{g:"ReactDOM"}, "react-dom/client":{g:"ReactDOM"},
  "recharts":{g:"Recharts", src:["prop-types@15.8.1/prop-types.min.js","recharts@2.15.0/umd/Recharts.js"]},
  "lucide-react":{g:"LucideReact", src:["lucide-react@0.468.0/dist/umd/lucide-react.min.js"], pre:"window.react=React;"},
};
function reactDoc(src){
  let name="App"; const libs=new Set(), unknown=new Set(), binds=[];
  const named=list=>list.split(",").map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/^type\s+/,"").replace(/\s+as\s+/," : ")).join(", ");
  let code=src.replace(/^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,(m,what,mod)=>{
    const lib=REACT_LIBS[mod]; if(!lib){ unknown.add(mod); return "" }
    libs.add(mod); what=what.trim();
    const ns=what.match(/^\*\s+as\s+(\w+)$/); if(ns){ binds.push(`const ${ns[1]}=${lib.g};`); return "" }
    const def=what.match(/^(\w+)\s*(?:,|$)/); if(def && def[1]!==lib.g) binds.push(`const ${def[1]}=${lib.g};`);
    const br=what.match(/\{([\s\S]*)\}/); if(br) binds.push(`const {${named(br[1])}}=${lib.g};`);
    return "";
  }).replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm,"")
    .replace(/export\s+default\s+function\s+(\w+)/,(_,n)=>{ name=n; return "function "+n })
    .replace(/export\s+default\s+(\w+)\s*;?/,(_,n)=>{ name=n; return "" }).replace(/^\s*export\s+(?=(const|function|class)\s)/gm,"");
  const extra=[...libs].flatMap(m=>(REACT_LIBS[m].pre?[`<script>${REACT_LIBS[m].pre}<\/script>`]:[]).concat((REACT_LIBS[m].src||[]).map(f=>`<script src="${CDN}/${f}"><\/script>`))).join("");
  const warn=unknown.size?`window.__artErr&&__artErr("쓸 수 없는 라이브러리: ${[...unknown].join(", ").replace(/"/g,"")} (React·recharts·lucide-react만 돼요)");`:"";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="${CDN}/react@18.3.1/umd/react.production.min.js"><\/script><script src="${CDN}/react-dom@18.3.1/umd/react-dom.production.min.js"><\/script>
${extra}<script src="${CDN}/@babel/standalone@7.26.4/babel.min.js"><\/script><script src="${CDN}/@tailwindcss/browser@4.0.6/dist/index.global.js"><\/script>
<style>body{margin:0;font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif}</style></head><body><div id="root"></div>
<script>${warn}addEventListener("error",e=>{const r=document.getElementById("root");if(r&&!r.childElementCount)r.innerHTML='<pre style="color:#c00;padding:16px;white-space:pre-wrap">오류: '+String(e.message).replace(/</g,"&lt;")+'</pre>'})<\/script>
<script type="text/babel" data-presets="react,typescript" data-type="module">
const {useState,useEffect,useRef,useMemo,useCallback,useReducer,useLayoutEffect,Fragment}=React;
${binds.map(b=>b.replace(/^const \{([^}]*)\}=React;$/,(m,l)=>{ const left=l.split(",").map(x=>x.trim()).filter(x=>x&&!["useState","useEffect","useRef","useMemo","useCallback","useReducer","useLayoutEffect","Fragment"].includes(x)); return left.length?`const {${left.join(", ")}}=React;`:"" })).join("\n")}
${code.replace(/<\/script/gi,"<\\/script")}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(${name}));
<\/script></body></html>`;
}
function artifactDoc(src, lang){
  if(lang==="svg") return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${src}</body>`;
  if(lang==="mermaid") return `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#fff;font-family:system-ui,"Malgun Gothic",sans-serif}
.mermaid{width:100%;margin:0;display:flex;justify-content:center}.mermaid svg{width:100%!important;max-width:1100px!important;height:auto}</style>
<pre class="mermaid">${esc(src)}</pre><script src="${CDN}/mermaid@11.4.1/dist/mermaid.min.js"><\/script>
<script>mermaid.parseError=function(e){window.__artErr&&__artErr("도표 문법 오류: "+(e&&e.message||e))};
mermaid.initialize({startOnLoad:true,theme:"default",securityLevel:"strict",themeVariables:{fontSize:"16px"},flowchart:{useMaxWidth:true}})<\/script>`;
  if(lang==="jsx"||lang==="tsx"||lang==="react") return reactDoc(src);
  return /<html|<!doctype/i.test(src) ? src : `<!doctype html><meta charset="utf-8"><body>${src}</body>`;
}
function openArtifact(src, lang){ const id=artHash(lang+src); ARTS[id]=ARTS[id]||{src,lang,title:artTitle(src,lang)}; openArtifactId(id) }
function artPanel(){
  let panel=$("#artPanel");
  if(!panel){
    panel=document.createElement("aside"); panel.id="artPanel"; panel.className="art-panel"; panel.setAttribute("aria-label","아티팩트");
    panel.innerHTML=`<div class="art-head"><span class="ah-ic"></span><div class="ah-t"><b></b><small></small></div>
      <div class="ah-ver"><button class="icon-btn" data-ver="-1" aria-label="이전 버전">‹</button><span></span><button class="icon-btn" data-ver="1" aria-label="다음 버전">›</button></div>
      <span class="spacer"></span>
      <div class="seg"><button data-tab="view" class="on">미리보기</button><button data-tab="code">코드</button></div>
      <button class="icon-btn" data-share aria-label="공개 링크 만들기" title="공개 링크 만들기 (로그인 없이 누구나 보기)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></button>
      <button class="icon-btn" data-copy aria-label="코드 복사" title="코드 복사"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
      <button class="icon-btn" data-dl aria-label="다운로드" title="다운로드"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg></button>
      <button class="icon-btn" data-full aria-label="크게 보기" title="크게 보기"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <div class="art-err" hidden role="alert"><span class="ae-ic">⚠</span><span class="ae-msg"></span><button class="btn" data-fix>고쳐줘</button><button class="icon-btn" data-errx aria-label="오류 알림 닫기">✕</button></div>
      <div class="art-body"><iframe sandbox="allow-scripts allow-modals" title="아티팩트 미리보기"></iframe><pre class="art-code" hidden></pre></div>
      <div class="art-foot small muted">격리된 창에서 실행돼요 — 이 안의 코드는 TriAI 데이터나 내 파일, 인터넷에 접근할 수 없어요.</div>`;
    document.body.append(panel);
    panel.querySelector("[data-close]").onclick=()=>{ panel.classList.remove("open","full"); document.body.classList.remove("art-open");
      document.querySelectorAll(".art-card.on").forEach(c=>c.classList.remove("on")) };
    panel.querySelector("[data-share]").onclick=()=>window.artShare?.(panel._id);
    panel.querySelector("[data-full]").onclick=()=>panel.classList.toggle("full");
    panel.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{ const v=b.dataset.tab==="view";
      panel.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("on",x===b));
      panel.querySelector("iframe").hidden=!v; panel.querySelector(".art-code").hidden=v; });
    panel.querySelectorAll("[data-ver]").forEach(b=>b.onclick=()=>{ const vs=artVersions(panel._id), i=vs.indexOf(panel._id)+ +b.dataset.ver;
      if(i>=0&&i<vs.length) openArtifactId(vs[i]) });
    panel.querySelector("[data-copy]").onclick=async()=>{ await navigator.clipboard.writeText(ARTS[panel._id].src); toast("코드를 복사했어요") };
    panel.querySelector("[data-dl]").onclick=()=>{ const x=ARTS[panel._id], ext={svg:"svg",mermaid:"mmd",jsx:"jsx",tsx:"tsx",react:"jsx"}[x.lang]||"html";
      const name=(x.title.replace(/[\\/:*?"<>|]/g,"").trim()||"artifact")+"."+ext, body=ext==="html"?artifactDoc(x.src,x.lang):x.src, type=ext==="svg"?"image/svg+xml":ext==="html"?"text/html":"text/plain";
      if(window.TriAIApp?.saveFile){ window.TriAIApp.saveFile(window.__triaiTok||"", name, type, body); return; }   // 안드로이드 앱
      const l=document.createElement("a"); l.href=URL.createObjectURL(new Blob([body],{type})); l.download=name; l.click(); };
    document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&panel.classList.contains("full")) panel.classList.remove("full") });
    window.addEventListener("message",e=>{   // 격리된 창에서 온 오류 → 빨간 줄 + [고쳐줘]
      if(e.source!==panel.querySelector("iframe").contentWindow || !e.data?.artifactError || panel._live) return;
      const box=panel.querySelector(".art-err"), m=String(e.data.artifactError);
      panel._errs=panel._errs||[]; if(!panel._errs.includes(m)) panel._errs.push(m);
      box.querySelector(".ae-msg").textContent=panel._errs[0]+(panel._errs.length>1?` (외 ${panel._errs.length-1}개)`:""); box.hidden=false;
    });
    panel.querySelector("[data-errx]").onclick=()=>{ panel.querySelector(".art-err").hidden=true };
    panel.querySelector("[data-fix]").onclick=()=>{
      const a=ARTS[panel._id], errs=(panel._errs||[]).slice(0,3).map(x=>"- "+x).join("\n");
      if(state.busy) return toast("답변이 끝난 뒤에 눌러 주세요.");
      panel.querySelector(".art-err").hidden=true;
      send({text:`아티팩트 '${a.title}'를 실행하니 오류가 났어요:\n${errs}\n\n원인을 한 줄로 말하고, 같은 이름(${a.lang==="html"?"<title>":"제목"})으로 고친 전체 코드를 다시 써 줘.`});
    };
  }
  return panel;
}
function openArtifactId(id){
  const a=ARTS[id]; if(!a) return;
  const panel=artPanel();
  panel._id=id; panel._live=false; panel._errs=[]; panel.querySelector(".art-err").hidden=true; panel.classList.remove("writing");
  const [kind,icon]=ART_KIND[a.lang]||["아티팩트","📄"], vs=artVersions(id), vi=vs.indexOf(id);
  panel.querySelector(".ah-ic").textContent=icon; panel.querySelector(".ah-t b").textContent=a.title; panel.querySelector(".ah-t small").textContent=kind;
  panel.querySelector(".ah-ver").hidden=vs.length<2; panel.querySelector(".ah-ver span").textContent=`v${vi+1} / ${vs.length}`;
  panel.querySelector('[data-ver="-1"]').disabled=vi<=0; panel.querySelector('[data-ver="1"]').disabled=vi>=vs.length-1;
  document.querySelectorAll(".art-card.on").forEach(c=>c.classList.remove("on"));
  document.querySelectorAll(`.art-card[data-art-id="${id}"]`).forEach(c=>c.classList.add("on"));
  // 아티팩트 전용 페이지를 띄우고, 준비되면 HTML을 메시지로 보냄.
  //  - sandbox에 allow-same-origin을 안 줌 → 출처가 없는 창이라 TriAI API·저장소 접근 불가
  //  - 전용 페이지에는 서버가 '밖으로 보내기 금지' 정책(CSP)을 붙임 → 외부 통신·이미지로 정보 유출 불가
  const frame = panel.querySelector("iframe"), doc = artifactDoc(a.src, a.lang);
  const onReady = e => { if (e.source === frame.contentWindow && e.data?.artifactReady) {
    window.removeEventListener("message", onReady); frame.contentWindow.postMessage({ html: doc }, "*"); } };
  window.addEventListener("message", onReady);
  frame.src = "/static/artifact.html?t=" + Date.now();
  panel.querySelector(".art-code").textContent = a.src;
  panel.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("on",x.dataset.tab==="view"));
  frame.hidden=false; panel.querySelector(".art-code").hidden=true;
  panel.classList.add("open"); document.body.classList.add("art-open");   // 넓은 화면: 대화가 왼쪽으로 비켜서 나란히 (가리지 않게)
  artLabelVersions();
}
/* 같은 이름의 카드에 '버전 n' 표시 */
function artLabelVersions(){
  const groups={};
  document.querySelectorAll("#thread .art-card[data-art-id]").forEach(c=>{ const a=ARTS[c.dataset.artId]; if(!a) return;
    const k=artNamed(a)?a.lang+"|"+a.title:c.dataset.artId; (groups[k]=groups[k]||[]); if(!groups[k].includes(c.dataset.artId)) groups[k].push(c.dataset.artId);
    const n=groups[k].indexOf(c.dataset.artId)+1, s=c.querySelector(".ac-t small"), base=s.dataset.base||(s.dataset.base=s.textContent);
    s.textContent = n>1 ? `버전 ${n} · `+base : base });
}
const fmtCost = c => c==null ? "비용 ?" : "$"+c.toFixed(4);
const fmtBytes = b => b<1024? b+" B" : b<1048576? (b/1024).toFixed(1)+" KB" : (b/1048576).toFixed(1)+" MB";
const fmtChars = n => n>=10000 ? (n/10000).toFixed(1)+"만 자" : n.toLocaleString()+"자";
function ago(iso){
  const s=(Date.now()-new Date(iso))/1000;
  if(s<60) return "방금"; if(s<3600) return Math.floor(s/60)+"분 전"; if(s<86400) return Math.floor(s/3600)+"시간 전";
  if(s<86400*30) return Math.floor(s/86400)+"일 전"; return iso.slice(0,10);
}
function modelOf(p){return state.models[p] || state.status.defaults[p]}
function activeProviders(){  // 자동·비교 모드면 키 있는 AI 전부가 후보
  const k=state.status.keys;
  return (state.mode==="all"||state.mode==="auto") ? Object.keys(PROV).filter(p=>k[p]&&p!=="agent") : (k[state.mode]?[state.mode]:[]);
}
// 답변 이름표(key): "claude" | "gpt" | "gemini" | "local@모델이름"
const provOf = k => String(k).split("@")[0];
const P_ = k => PROV[provOf(k)] || {name:k,color:"var(--muted)"};
const nameOf = k => k.startsWith("local@") ? `로컬 ${k.slice(6)}` : P_(k).name;
const targetOf = k => k.startsWith("local@") ? {provider:"local",model:k.slice(6)} : {provider:k,model:modelOf(k)};
const targetsOf = keys => keys.map(targetOf);
function paintTri(svg,on){const cs=svg.querySelectorAll("circle");["claude","gpt","gemini"].forEach((p,i)=>cs[i].setAttribute("class",on.includes(p)?"on-"+p:""))}
const projName = id => state.projects.find(p=>p.id===id)?.name;

async function api(path,opt={}){
  // X-TriAI: 'TriAI 화면에서 보낸 요청'이라는 표시. 서버는 이게 없으면 데이터를 바꾸는 요청을 거부해요 (보안)
  const r=await fetch(path,{...opt,headers:{"Content-Type":"application/json",...(opt.headers||{}),"X-TriAI":"1"}});
  if(!r.ok){let m=r.statusText;try{m=(await r.json()).detail||m}catch{};throw new Error(typeof m==="string"?m:JSON.stringify(m))}
  return r;
}
const getJSON = async p => (await api(p)).json();
const sendJSON = async (p,method,body) => (await api(p,{method,body:JSON.stringify(body)})).json();
async function streamNDJSON(res,onEvent){
  const reader=res.body.getReader(),dec=new TextDecoder();let buf="";
  while(true){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
    let i;while((i=buf.indexOf("\n"))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(line.trim())onEvent(JSON.parse(line))}}
}

/* 공용 대화상자: dialog(제목, 본문HTML, [{label, value, kind}]) → 누른 버튼의 value */
function dialog(title, body, buttons, onOpen){
  return new Promise(res=>{
    const panel=$("#dlgPanel");
    panel.innerHTML=`<h2>${esc(title)}</h2>${body}<div class="actions">${buttons.map((b,i)=>
      `<button class="btn ${b.kind||""} ${b.left?"left":""}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div>`;
    $("#dlg").classList.add("open");
    const close=v=>{$("#dlg").classList.remove("open");document.removeEventListener("keydown",key);res(v)};
    const key=e=>{if(e.key==="Escape")close(null); if(e.key==="Enter"&&e.target.tagName==="INPUT"){e.preventDefault();close(buttons[buttons.length-1].value)}};
    document.addEventListener("keydown",key);
    panel.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>close(buttons[+b.dataset.i].value));
    $("#dlg").onclick=e=>{if(e.target.id==="dlg")close(null)};
    if(onOpen) onOpen();
    setTimeout(()=>panel.querySelector("input,textarea")?.focus(),30);
  });
}
const confirmBox = (title,msg,okLabel="확인",danger=false) =>
  dialog(title,`<p class="muted" style="margin:0">${msg}</p>`,[{label:"취소",value:false,kind:"ghost"},{label:okLabel,value:true,kind:danger?"danger":""}]);
