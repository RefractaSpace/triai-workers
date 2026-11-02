/* artifact.js — 아티팩트: 답 속 ```html/svg/mermaid/jsx 블록 → 카드 → 오른쪽 격리 창
   · 실행은 늘 /static/artifact.html (sandbox, 같은 출처 아님 + 서버가 '밖으로 보내기 금지' CSP) 에서
   · 같은 제목으로 다시 만들면 버전 (‹ ›) */
"use strict";

const ARTS = {};   // id → {src, lang, title}
const ART_KIND = { html: "웹페이지", svg: "그림", mermaid: "도표", jsx: "React 앱", tsx: "React 앱", react: "React 앱" };
const ART_ICON = {
  html: `<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17"/></svg>`,
  svg: `<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="9" cy="9" r="1.8"/><path d="m20.5 15-5-5-11 10.5"/></svg>`,
  mermaid: `<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="5" rx="1.2"/><rect x="13.5" y="15.5" width="7" height="5" rx="1.2"/><path d="M7 8.5V13a2.5 2.5 0 0 0 2.5 2.5h4"/></svg>`,
  jsx: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/></svg>`,
};
ART_ICON.tsx = ART_ICON.react = ART_ICON.jsx;

function artHash(t) { let x = 5381; for (let i = 0; i < t.length; i++) x = ((x << 5) + x + t.charCodeAt(i)) | 0; return "a" + (x >>> 0).toString(36) + t.length.toString(36); }
function artTitle(src, lang) {
  const pick = re => (src.match(re) || [])[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 60);
  if (lang === "html" || lang === "svg") return pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || ART_KIND[lang];
  if (lang === "mermaid") return pick(/^\s*%%\s*title:\s*(.+)$/m) || pick(/^\s*title\s+(.+)$/m) || "도표";
  return pick(/\/\/\s*title:\s*(.+)/) || pick(/export\s+default\s+function\s+(\w+)/) || "React 앱";
}

/** md()가 부름: 블록 하나 → 카드 HTML */
function artCard(a) {
  if (!a.done) {
    const lines = a.body.split("\n").length;
    return `<div class="art-card writing"><span class="ic">${ART_ICON[a.lang] || ART_ICON.html}</span><span class="t"><b>${esc(artTitle(a.body, a.lang))}</b><small>만드는 중… ${lines}줄</small></span></div>`;
  }
  const id = artHash(a.lang + a.body);
  ARTS[id] = ARTS[id] || { src: a.body, lang: a.lang, title: artTitle(a.body, a.lang) };
  const x = ARTS[id], on = art.id === id && !$("#art").hidden;
  return `<button class="art-card${on ? " on" : ""}" data-art-id="${id}"><span class="ic">${ART_ICON[a.lang] || ART_ICON.html}</span>
    <span class="t"><b>${esc(x.title)}</b><small>${ART_KIND[a.lang] || "아티팩트"} · ${a.body.split("\n").length}줄</small></span>
    <span class="go"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span></button>`;
}

/* React(jsx) → 바로 돌아가는 HTML (브라우저용 React + Babel) */
const CDN = "https://cdn.jsdelivr.net/npm";
const REACT_LIBS = {
  "react": { g: "React" }, "react-dom": { g: "ReactDOM" }, "react-dom/client": { g: "ReactDOM" },
  "recharts": { g: "Recharts", src: ["prop-types@15.8.1/prop-types.min.js", "recharts@2.15.0/umd/Recharts.js"] },
  "lucide-react": { g: "LucideReact", src: ["lucide-react@0.468.0/dist/umd/lucide-react.min.js"], pre: "window.react=React;" },
};
const HOOKS = ["useState", "useEffect", "useRef", "useMemo", "useCallback", "useReducer", "useLayoutEffect", "Fragment"];
function reactDoc(src) {
  let name = "App"; const libs = new Set(), unknown = new Set(), binds = [];
  const named = list => list.split(",").map(x => x.trim()).filter(Boolean).map(x => x.replace(/^type\s+/, "").replace(/\s+as\s+/, " : ")).join(", ");
  const code = src.replace(/^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm, (m, what, mod) => {
    const lib = REACT_LIBS[mod]; if (!lib) { unknown.add(mod); return ""; }
    libs.add(mod); what = what.trim();
    const ns = what.match(/^\*\s+as\s+(\w+)$/); if (ns) { binds.push(`const ${ns[1]}=${lib.g};`); return ""; }
    const def = what.match(/^(\w+)\s*(?:,|$)/); if (def && def[1] !== lib.g) binds.push(`const ${def[1]}=${lib.g};`);
    const br = what.match(/\{([\s\S]*)\}/); if (br) binds.push(`const {${named(br[1])}}=${lib.g};`);
    return "";
  }).replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm, "")
    .replace(/export\s+default\s+function\s+(\w+)/, (_, n) => { name = n; return "function " + n; })
    .replace(/export\s+default\s+(\w+)\s*;?/, (_, n) => { name = n; return ""; }).replace(/^\s*export\s+(?=(const|function|class)\s)/gm, "");
  const extra = [...libs].flatMap(m => (REACT_LIBS[m].pre ? [`<script>${REACT_LIBS[m].pre}<\/script>`] : []).concat((REACT_LIBS[m].src || []).map(f => `<script src="${CDN}/${f}"><\/script>`))).join("");
  const warn = unknown.size ? `window.__artErr&&__artErr("쓸 수 없는 라이브러리: ${[...unknown].join(", ").replace(/"/g, "")} (React·recharts·lucide-react만 돼요)");` : "";
  const binding = binds.map(b => b.replace(/^const \{([^}]*)\}=React;$/, (m, l) => { const left = l.split(",").map(x => x.trim()).filter(x => x && !HOOKS.includes(x)); return left.length ? `const {${left.join(", ")}}=React;` : ""; })).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="${CDN}/react@18.3.1/umd/react.production.min.js"><\/script><script src="${CDN}/react-dom@18.3.1/umd/react-dom.production.min.js"><\/script>
${extra}<script src="${CDN}/@babel/standalone@7.26.4/babel.min.js"><\/script><script src="${CDN}/@tailwindcss/browser@4.0.6/dist/index.global.js"><\/script>
<style>body{margin:0;font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif}</style></head><body><div id="root"></div>
<script>${warn}addEventListener("error",e=>{const r=document.getElementById("root");if(r&&!r.childElementCount)r.innerHTML='<pre style="color:#c00;padding:16px;white-space:pre-wrap">오류: '+String(e.message).replace(/</g,"&lt;")+'</pre>'})<\/script>
<script type="text/babel" data-presets="react,typescript" data-type="module">
const {${HOOKS.join(",")}}=React;
${binding}
${code.replace(/<\/script/gi, "<\\/script")}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(${name}));
<\/script></body></html>`;
}
function artifactDoc(src, lang) {
  if (lang === "svg") return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${src}</body>`;
  if (lang === "mermaid") return `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#fff;font-family:system-ui,"Malgun Gothic",sans-serif}
.mermaid{width:100%;margin:0;display:flex;justify-content:center}.mermaid svg{width:100%!important;max-width:1100px!important;height:auto}</style>
<pre class="mermaid">${esc(src)}</pre><script src="${CDN}/mermaid@11.4.1/dist/mermaid.min.js"><\/script>
<script>mermaid.parseError=function(e){window.__artErr&&__artErr("도표 문법 오류: "+(e&&e.message||e))};
mermaid.initialize({startOnLoad:true,theme:"default",securityLevel:"strict",themeVariables:{fontSize:"16px"},flowchart:{useMaxWidth:true}})<\/script>`;
  if (lang === "jsx" || lang === "tsx" || lang === "react") return reactDoc(src);
  return /<html|<!doctype/i.test(src) ? src : `<!doctype html><meta charset="utf-8"><body>${src}</body>`;
}

/* ── 오른쪽 창 ── */
const art = { id: null, errs: [], opened: new Set() };
function artVersions(id) {   // 같은 제목+종류의 카드들 (대화 순서) = 버전
  const a = ARTS[id]; if (!a) return [id];
  const ids = [];
  for (const c of $$("#thread .art-card[data-art-id]")) { const x = ARTS[c.dataset.artId]; if (x && x.title === a.title && x.lang === a.lang && !ids.includes(c.dataset.artId)) ids.push(c.dataset.artId); }
  return ids.length ? ids : [id];
}
function openArt(id) {
  const a = ARTS[id]; if (!a) return;
  art.id = id; art.errs = [];
  const p = $("#art"); p.hidden = false; document.body.classList.add("art-open");
  $("#artTitle").textContent = a.title; $("#artKind").textContent = ART_KIND[a.lang] || "아티팩트";
  const vs = artVersions(id), vi = vs.indexOf(id);
  $("#artVer").hidden = vs.length < 2; $("#artVer span").textContent = `${vi + 1} / ${vs.length}`;
  $('#artVer [data-ver="-1"]').disabled = vi <= 0; $('#artVer [data-ver="1"]').disabled = vi >= vs.length - 1;
  $("#artErr").hidden = true;
  $$(".art-card.on").forEach(c => c.classList.remove("on"));
  $$(`.art-card[data-art-id="${id}"]`).forEach(c => c.classList.add("on"));
  artTab("view");
  $("#artCode").textContent = a.src;
  // 격리 창을 새로 띄우고, 준비됐다고 알려오면 HTML을 메시지로 보냄 (allow-same-origin 없음 → TriAI 데이터 접근 불가)
  const frame = $("#artFrame"), doc = artifactDoc(a.src, a.lang);
  const onReady = e => { if (e.source === frame.contentWindow && e.data?.artifactReady) { removeEventListener("message", onReady); frame.contentWindow.postMessage({ html: doc }, "*"); } };
  addEventListener("message", onReady);
  frame.src = "/static/artifact.html?t=" + Date.now();
}
function closeArt() {
  $("#art").hidden = true; $("#art").classList.remove("full"); document.body.classList.remove("art-open");
  $$(".art-card.on").forEach(c => c.classList.remove("on")); art.id = null;
  $("#artFrame").src = "about:blank";
}
function artTab(t) {
  $$("#artTabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  $("#artFrame").hidden = t !== "view"; $("#artCode").hidden = t === "view";
}
document.addEventListener("click", e => {
  const c = e.target.closest(".art-card[data-art-id]"); if (!c) return;
  if (art.id === c.dataset.artId && !$("#art").hidden) closeArt(); else openArt(c.dataset.artId);
});
$$("#artTabs button").forEach(b => b.onclick = () => artTab(b.dataset.tab));
$$("#artVer [data-ver]").forEach(b => b.onclick = () => { const vs = artVersions(art.id), i = vs.indexOf(art.id) + +b.dataset.ver; if (vs[i]) openArt(vs[i]); });
$("#artClose").onclick = closeArt;
$("#artFull").onclick = () => $("#art").classList.toggle("full");
$("#artCopy").onclick = () => copyText(ARTS[art.id].src, "코드를 복사했어요");
$("#artDl").onclick = () => {
  const x = ARTS[art.id], ext = { svg: "svg", mermaid: "mmd", jsx: "jsx", tsx: "tsx", react: "jsx" }[x.lang] || "html";
  const body = ext === "html" ? artifactDoc(x.src, x.lang) : x.src, type = ext === "svg" ? "image/svg+xml" : ext === "html" ? "text/html" : "text/plain";
  const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([body], { type }));
  l.download = (x.title.replace(/[\\/:*?"<>|]/g, "").trim() || "artifact") + "." + ext; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 5000);
};
$("#artShare").onclick = async () => {
  const x = ARTS[art.id];
  const ok = await ask("공개 링크 만들기", { msg: `<b>${esc(x.title)}</b>을(를) 로그인 없이 누구나 볼 수 있는 링크로 만들어요. 링크를 아는 사람은 누구나 볼 수 있어요. 나중에 설정 → 공유 링크에서 끊을 수 있어요.`, ok: "링크 만들기" });
  if (!ok) return;
  try {
    const r = await sendJSON("/gw/share", "POST", { doc: artifactDoc(x.src, x.lang), src: x.src, title: x.title, lang: x.lang, aid: art.id });
    await copyText(location.origin + r.url, r.again ? "이미 있던 링크를 복사했어요" : "링크를 만들고 복사했어요");
  } catch (e) { fail(e); }
};
$("#artErrX").onclick = () => { $("#artErr").hidden = true; };
$("#artFix").onclick = () => {
  const a = ARTS[art.id]; if (!a) return;
  if (state.busy) return toast("답이 끝난 뒤에 눌러 주세요");
  $("#artErr").hidden = true;
  send({ text: `아티팩트 '${a.title}'를 실행하니 오류가 났어요:\n${art.errs.slice(0, 3).map(x => "- " + x).join("\n")}\n\n원인을 한 줄로 말하고, 같은 이름으로 고친 전체 코드를 다시 써 줘.` });
};
addEventListener("message", e => {   // 격리 창에서 온 오류 → 빨간 줄 + [고쳐 달라고 하기]
  if (e.source !== $("#artFrame").contentWindow || !e.data?.artifactError) return;
  const m = String(e.data.artifactError); if (!art.errs.includes(m)) art.errs.push(m);
  $("#artErrMsg").textContent = art.errs[0] + (art.errs.length > 1 ? ` 외 ${art.errs.length - 1}개` : ""); $("#artErr").hidden = false;
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#art").classList.contains("full")) $("#art").classList.remove("full"); });
