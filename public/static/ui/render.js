/* render.js — 답 글(마크다운) → 화면: 코드 블록, 수식, 차트, 아티팩트 카드 */
"use strict";

// 답 속 외부 이미지는 그리지 않음 (악성 페이지가 AI를 조종해 이미지 주소로 정보를 빼가는 공격 방지 — CSP가 1차로 막음)
if (window.DOMPurify) DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") || "";
    if (!/^(\/|data:image\/|blob:)/.test(src)) {
      const span = document.createElement("span"); span.className = "img-blocked";
      span.textContent = "외부 이미지는 막혀 있어요"; span.title = src.slice(0, 200);
      node.replaceWith(span);
    }
  }
  if (node.tagName === "A" && /^https?:/.test(node.getAttribute("href") || "")) {
    node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); node.setAttribute("title", node.getAttribute("href"));
  }
});

const ART_FENCE = /(?:^|\n)```(html|svg|mermaid|jsx|tsx|react)[^\n]*\n([\s\S]*?)(\n```|$)/g;
const CHART_FENCE = /(?:^|\n)```chart[^\n]*\n([\s\S]*?)(\n```|$)/g;
const MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$\w])\$(?!\s)[^\n$]+?(?<!\s)\$(?![\w$])/g;

/* 마크다운이 수식 속 \ _ * 를 바꾸기 전에 잠시 빼 둠 (코드 안은 그대로) */
function hideMath(text) {
  const saved = [];
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/);
  const out = parts.map((p, i) => i % 2 ? p : p.replace(MATH_RE, m => { saved.push(m); return `M${saved.length - 1}`; })).join("");
  return { out, saved };
}

/** 마크다운 → 안전한 HTML. ctx = {conv, turn, key} (아티팩트 버전 계산용) */
function md(text, ctx = null) {
  text = String(text ?? "");
  if (!window.marked || !window.DOMPurify) return "<p>" + esc(text).replace(/\n/g, "<br>") + "</p>";
  // 도구 요청 블록(```tool·mcp·search·fetch·image)은 숨김 — 바로 아래 '기록'이 대신 보여요 (쓰는 중인 블록도). ```run 코드는 보여줌
  text = text.replace(/(^|\n)```(?:tool|mcp|search|fetch|image|sensor)[ \t]*\r?\n[\s\S]*?\r?\n?```[ \t]*(?=\n|$)/g, "$1").replace(/(^|\n)```(?:tool|mcp|search|fetch|image|sensor)[ \t]*\r?\n[\s\S]*$/, "$1");
  const arts = [], charts = [];
  if (state.status?.settings?.artifacts !== false)
    text = text.replace(ART_FENCE, (m, lang, body, end) => { arts.push({ lang, body, done: !!end }); return `\n\nA${arts.length - 1}\n\n`; });
  text = text.replace(CHART_FENCE, (m, body, end) => { charts.push({ body, done: !!end }); return `\n\nC${charts.length - 1}\n\n`; });
  const { out, saved } = hideMath(text);
  let html = DOMPurify.sanitize(marked.parse(out, { breaks: true }));
  html = html.replace(/<p>A(\d+)<\/p>|A(\d+)/g, (_, a, b) => artCard(arts[+(a ?? b)]));
  html = html.replace(/<p>C(\d+)<\/p>|C(\d+)/g, (_, a, b) => { const c = charts[+(a ?? b)]; return window.chartHTML ? chartHTML(c.body, c.done) : ""; });
  return html.replace(/M(\d+)/g, (_, i) => esc(saved[+i]));
}

/** 다 그려진 뒤: 수식(KaTeX) + 코드 블록 버튼 */
function finish(el) {
  if (window.renderMathInElement) try {
    renderMathInElement(el, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
      { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }], throwOnError: false });
  } catch {}
  for (const code of el.querySelectorAll("pre > code")) {
    const pre = code.parentElement; if (pre.querySelector(".code-bar")) continue;
    const lang = (code.className.match(/language-([\w-]+)/) || [])[1] || "";
    const bar = h(`<div class="code-bar"><span>${esc(lang)}</span><button data-cpy>복사</button></div>`);
    bar.querySelector("[data-cpy]").onclick = async e => { await copyText(code.textContent, "코드를 복사했어요"); };
    pre.prepend(bar);
  }
}
