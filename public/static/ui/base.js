/* base.js — 모든 화면 파일이 함께 쓰는 기반: 상태, 서버 통신, 작은 도우미, 팝업 메뉴, 시트
   (파일들은 index.html 순서대로 불러오고, 여기서 만든 함수·변수를 그대로 함께 써요) */
"use strict";

const PROV = {
  claude: { name: "Claude", cls: "claude" }, gpt: { name: "GPT", cls: "gpt" },
  gemini: { name: "Gemini", cls: "gemini" }, cf: { name: "Cloudflare", cls: "cf" },
  agent: { name: "에이전트 팀", cls: "agent" }, local: { name: "로컬", cls: "local" },
};
const CHAT_PROVS = ["claude", "gpt", "gemini", "cf"];

const store = {   // 기기에만 남기는 가벼운 선택값 (실패해도 앱은 그대로 동작)
  get(k, d) { try { const v = localStorage.getItem("triai." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("triai." + k, JSON.stringify(v)); } catch {} },
};

const state = {
  me: null, status: null,
  convs: [], projects: [], modes: [], presets: [], styles: [],
  conv: null, convId: null, projectId: null,     // 지금 대화 / 새 대화를 만들 프로젝트
  pick: store.get("pick", "auto"),               // auto | claude | gpt | gemini | cf | all | mode:<id>
  models: store.get("models", {}),               // 사람이 고른 모델 (없으면 서버 기본값)
  preset: store.get("preset", "default"), style: store.get("style", "default"),
  web: false, deep: false,
  attach: [],                                    // {name, kind:"image"|"text", content, url?}
  busy: false, abort: null, runId: null,
  view: "chat",
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const provOf = k => String(k || "").split("@")[0];
const nameOf = k => k === "synth" ? "종합" : String(k).startsWith("local@") ? String(k).slice(6).replace(/^(ollama|lms):/, "") : PROV[provOf(k)]?.name || k;
const modelOf = p => state.models[p] || state.status?.defaults?.[p] || "";
const hasKey = p => !!state.status?.keys?.[p];

const ICON = {
  copy: `<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>`,
  up: `<svg viewBox="0 0 24 24"><path d="M7 11v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Zm0 0 4-7.5a2 2 0 0 1 2 2V9h5.3a2 2 0 0 1 2 2.3l-1.1 7A2 2 0 0 1 17.2 20H7"/></svg>`,
  down: `<svg viewBox="0 0 24 24"><path d="M17 13V4h2.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1Zm0 0-4 7.5a2 2 0 0 1-2-2V15H5.7a2 2 0 0 1-2-2.3l1.1-7A2 2 0 0 1 6.8 4H17"/></svg>`,
  star: `<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/></svg>`,
  retry: `<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg>`,
  more: `<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/></svg>`,
  edit: `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg>`,
  branch: `<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-11.5 7"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  web: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5Z"/></svg>`,
  file: `<svg viewBox="0 0 24 24"><path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8Z"/><path d="M14 3.5V8h4.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/></svg>`,
  synth: `<svg viewBox="0 0 24 24"><path d="M5 5l7 7M19 5l-7 7v7"/></svg>`,
  ask: `<svg viewBox="0 0 24 24"><path d="M4 6.5h9M4 12h6M4 17.5h9M17 9v7M13.5 12.5h7"/></svg>`,
};

/* ── 서버 통신 ── */
async function api(path, opt = {}) {
  // X-TriAI: 'TriAI 화면에서 보낸 요청' 표시. 서버는 이게 없으면 데이터를 바꾸는 요청을 거부해요 (CSRF 방어)
  const r = await fetch(path, { ...opt, headers: { "Content-Type": "application/json", ...(opt.headers || {}), "X-TriAI": "1" } });
  if (r.status === 401) { location.href = "/gw/login"; throw new Error("로그인이 필요해요"); }
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch {} throw new Error(typeof m === "string" ? m : JSON.stringify(m)); }
  return r;
}
const getJSON = async p => (await api(p)).json();
const sendJSON = async (p, method, body) => (await api(p, { method, body: body == null ? undefined : JSON.stringify(body) })).json();
async function streamNDJSON(res, onEvent) {
  const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onEvent(JSON.parse(line)); }
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

/* ── 알림 ── */
function toast(msg, ms = 3200) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
}
const fail = e => toast(e?.message || String(e), 5000);

/* ── 숫자·시간 ── */
const fmtUsd = c => c == null ? "" : c < 0.01 ? "$" + c.toFixed(4) : "$" + c.toFixed(2);
const fmtSec = s => s == null ? "" : s < 10 ? s.toFixed(1) + "초" : Math.round(s) + "초";
function dayGroup(iso) {
  const d = new Date(String(iso).replace(" ", "T")), now = new Date();
  if (isNaN(d)) return "이전";
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  return days <= 0 ? "오늘" : days === 1 ? "어제" : days < 7 ? "지난 7일" : days < 30 ? "지난 30일" : `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

/* ── 팝업 메뉴: items = [{label, sub, icon, on, danger, disabled, toggle, act}] | "-" | {head} ── */
function openMenu(anchor, items, { align = "start", above = false } = {}) {
  const m = $("#menu");
  const host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;   // 열린 창(최상위 층) 안에 넣어야 보임
  if (m.parentElement !== host) host.append(m);
  m.innerHTML = "";
  for (const it of items) {
    if (it === "-") { m.append(document.createElement("hr")); continue; }
    if (it.head) { m.append(h(`<h4>${esc(it.head)}</h4>`)); continue; }
    const b = h(`<button class="mi${it.on ? " on" : ""}${it.danger ? " danger" : ""}" role="menuitem"${it.disabled ? " disabled" : ""}>
      ${it.toggle ? "" : `<span class="chk">${ICON.check}</span>`}${it.icon ? `<span class="em">${it.icon}</span>` : ""}
      <span class="mt"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span>${it.toggle ? `<span class="sw"></span>` : ""}</button>`);
    b.onclick = e => { e.stopPropagation(); if (it.toggle) { b.classList.toggle("on"); it.act?.(b.classList.contains("on")); } else { closeMenu(); it.act?.(); } };
    m.append(b);
  }
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  let x = align === "end" ? r.right - mw : r.left; x = Math.max(8, Math.min(x, innerWidth - mw - 8));
  let y = above || r.bottom + mh + 8 > innerHeight ? r.top - mh - 6 : r.bottom + 6; y = Math.max(8, y);
  m.style.left = x + "px"; m.style.top = y + "px";
  m._anchor = anchor;
  m.querySelector(".mi:not(:disabled)")?.focus({ preventScroll: true });
}
function closeMenu() { const m = $("#menu"); if (!m.hidden) { m.hidden = true; m._anchor?.focus?.({ preventScroll: true }); m._anchor = null; } }
document.addEventListener("pointerdown", e => { if (!$("#menu").hidden && !e.target.closest("#menu")) { $("#menu").hidden = true; } });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#menu").hidden) { closeMenu(); e.preventDefault(); }
  if ($("#menu").hidden || !["ArrowDown", "ArrowUp"].includes(e.key)) return;
  const all = $$("#menu .mi:not(:disabled)"), i = all.indexOf(document.activeElement);
  all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus(); e.preventDefault();
});
window.addEventListener("resize", () => { $("#menu").hidden = true; });

/* ── 시트(가운데 창) ── */
function openSheet(title, bodyHTML, { tabs = null, foot = "", wide = false, el = null } = {}) {
  const s = el || $("#sheet");
  s.innerHTML = `<div class="sh-head"><h2>${esc(title)}</h2><button class="icon" data-close aria-label="닫기">${ICON.x}</button></div>
    ${tabs ? `<div class="sh-tabs"><div class="seg" role="tablist">${tabs.map((t, i) => `<button data-t="${t[0]}" class="${i ? "" : "on"}" role="tab">${esc(t[1])}</button>`).join("")}</div></div>` : ""}
    <div class="sh-body">${bodyHTML}</div>${foot ? `<div class="sh-foot">${foot}</div>` : ""}`;
  s.style.width = wide ? "min(880px,calc(100vw - 24px))" : "";
  s.querySelector("[data-close]").onclick = () => s.close();
  if (!s.open) s.showModal();
  return s;
}
for (const d of ["#sheet", "#askSheet"]) $(d).addEventListener("click", e => { if (e.target === $(d)) $(d).close(); });   // 바깥 누르면 닫기

/** 확인·입력 상자 (Promise) */
function ask(title, { msg = "", input = null, area = false, ok = "확인", danger = false, value = "" } = {}) {
  return new Promise(res => {
    const s = openSheet(title, `${msg ? `<p style="margin:0 0 14px;color:var(--ink-2)">${msg}</p>` : ""}${input != null
      ? (area ? `<textarea class="ta" id="askIn" rows="6" placeholder="${esc(input)}">${esc(value)}</textarea>` : `<input class="inp" id="askIn" style="width:100%" placeholder="${esc(input)}" value="${esc(value)}">`) : ""}`,
      { foot: `<button class="btn" data-no>취소</button><button class="btn ${danger ? "danger" : "primary"}" data-ok>${esc(ok)}</button>`, el: $("#askSheet") });
    s.style.width = "min(440px,calc(100vw - 24px))";
    let done = false; const fin = v => { if (done) return; done = true; s.close(); res(v); };
    s.querySelector("[data-ok]").onclick = () => fin(input != null ? s.querySelector("#askIn").value : true);
    s.querySelector("[data-no]").onclick = () => fin(null);
    s.addEventListener("close", () => fin(null), { once: true });
    const inp = s.querySelector("#askIn");
    if (inp) { inp.focus(); inp.select?.(); if (!area) inp.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); s.querySelector("[data-ok]").click(); } }; }
    else s.querySelector("[data-ok]").focus();
  });
}

async function copyText(t, msg = "복사했어요") { try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast("복사하지 못했어요 — 브라우저가 막았어요"); } }
