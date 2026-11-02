/* chat.js — 대화 화면: 질문 보내기(스트리밍), 답 그리기(여러 AI는 탭), 평가·종합·다른 AI에게 묻기, 입력창 */
"use strict";

/* ═════════ 답 그리기 ═════════ */
const PICK_NAMES = { auto: "자동", all: "모두 비교" };
function answerKeys(t) { return Object.keys(t.answers || {}); }
function defaultTab(t) {
  const ks = answerKeys(t);
  return t._tab && (t._tab === "synth" ? t.synth : ks.includes(t._tab)) ? t._tab
    : t.best && ks.includes(t.best) ? t.best : ks.find(k => !t.answers[k].error) || ks[0];
}

/** 질문 하나(질문 + 답들) 요소 만들기. t = 저장된 턴 또는 지금 받는 중인 턴 */
function buildTurn(t, idx) {
  const el = h(`<article class="turn" data-i="${idx}"></article>`);
  const files = [...(t.images || []).map(id => `<img src="/api/uploads/${esc(id)}" alt="첨부 사진" loading="lazy">`),
    ...(t._previews || []).map(u => `<img src="${esc(u)}" alt="첨부 사진">`),
    ...(t.files || []).map(f => `<span class="f">${esc(f.name)}</span>`)].join("");
  el.append(h(`<div class="q">${files ? `<div class="files">${files}</div>` : ""}<div class="bubble">${esc(t.q)}</div>
    <div class="q-act"><button class="icon" data-act="copy-q" aria-label="질문 복사" title="복사">${ICON.copy}</button>
    ${t._live ? "" : `<button class="icon" data-act="edit" aria-label="질문 고쳐서 다시" title="고쳐서 다시 묻기">${ICON.edit}</button>
    <button class="icon" data-act="branch" aria-label="여기서 갈라지기" title="여기까지 복사해 새 대화로">${ICON.branch}</button>`}</div></div>`));
  el.append(h(`<div class="a-wrap"></div>`));
  paintAnswers(el, t);
  return el;
}

/** 답 영역(탭 + 지금 탭 내용 + 아래 버튼) 다시 그리기 */
function paintAnswers(el, t) {
  const wrap = el.querySelector(".a-wrap"), ks = answerKeys(t), cur = defaultTab(t);
  const tabs = [...ks, ...(t.synth ? ["synth"] : [])];
  let html = "";
  if (t._status && !ks.some(k => t.answers[k].text)) html += `<div class="a-status"><span class="spin"></span>${esc(t._status)}</div>`;
  if (tabs.length > 1) html += `<div class="tabs" role="tablist">${tabs.map(k => {
    const a = k === "synth" ? t.synth : t.answers[k], live = t._live && !a._done;
    return `<button class="tab${k === cur ? " on" : ""}${a?.error ? " err" : ""}" data-tab="${esc(k)}" role="tab" aria-selected="${k === cur}"><i class="dot ${PROV[provOf(k)]?.cls || (k === "synth" ? "synth" : "")}${live ? " live" : ""}"></i>${esc(nameOf(k))}${t.best === k ? `<span class="star">★</span>` : ""}</button>`;
  }).join("")}</div>`;
  if (t.sources?.length) html += `<div class="sources">${t.sources.slice(0, 8).map((s, i) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.url)}">${i + 1}. ${esc(s.title || s.url)}</a>`).join("")}</div>`;
  wrap.innerHTML = html;
  const a = cur === "synth" ? t.synth : t.answers[cur];
  const box = h(`<div class="a" data-key="${esc(cur || "")}"></div>`);
  wrap.append(box);
  if (a) paintAnswer(box, t, cur, a);
  else if (t._live) box.innerHTML = `<div class="a-status"><span class="spin"></span>${esc(t._status || "생각하는 중…")}</div>`;
  if (cur === "synth" && t.synth?.labels) box.prepend(h(`<p class="small muted" style="margin:0 0 10px">${Object.entries(t.synth.labels).map(([l, k]) => `답변 ${l} = ${esc(nameOf(k))}`).join(" · ")}</p>`));
}

function paintAnswer(box, t, key, a) {
  const live = t._live && !a._done;
  let html = "";
  if (a.thinking) html += `<details class="think"${live && !a.text ? " open" : ""}><summary>${live && !a.text ? "생각하는 중" : "생각 과정"}</summary><div class="tx">${esc(a.thinking)}</div></details>`;
  if (a.error) html += `<div class="a-err">${esc(a.error)}</div>`;
  else if (!a.text && live) html += `<div class="a-status"><span class="spin"></span>${esc(a._status || t._status || "생각하는 중…")}</div>`;
  else html += `<div class="md${live ? " caret" : ""}">${md(a.text)}</div>`;
  if (live && a.text && a._status) html += `<div class="a-status"><span class="spin"></span>${esc(a._status)}</div>`;
  if (!live && a.pending) html += pendingHTML(a.pending);
  if (!live) html += footHTML(t, key, a);
  box.innerHTML = html;
  const mdEl = box.querySelector(".md");
  if (mdEl) {
    if (!live) finish(mdEl);
    else { const last = mdEl.lastElementChild; if (last && /^(P|LI|H\d)$/.test(last.tagName)) { mdEl.classList.remove("caret"); last.classList.add("caret"); } else if (last?.lastElementChild?.tagName === "LI") { mdEl.classList.remove("caret"); last.lastElementChild.classList.add("caret"); } }
  }
}

function pendingHTML(p) {
  const what = p.kind === "local" ? "로컬 모델(내 컴퓨터)이 답하기를 기다리는 중이에요" : p.kind === "run" ? "코드 실행을 기다리는 중이에요" : `내 컴퓨터 도구를 기다리는 중이에요 — ${p.label || ""}`;
  return `<div class="a-pend"><span>${esc(what)}</span><button class="btn small primary" data-act="pend-go">${p.kind === "local" ? "지금 답하게 하기" : "실행하고 이어 쓰기"}</button>${p.kind === "local" ? "" : `<button class="btn small" data-act="pend-skip">그만두기</button>`}</div>`;
}
function footHTML(t, key, a) {
  if (t._live || a.pending) return "";
  const meta = [a.model, a.provider === "local" ? "무료" : fmtUsd(a.cost), fmtSec(a.sec), a.tps ? `${a.tps} 토큰/초` : ""].filter(Boolean).join(" · ");
  const isSynth = key === "synth", n = answerKeys(t).filter(k => !t.answers[k].error).length;
  return `<div class="a-foot">
    <button class="icon" data-act="copy" aria-label="답 복사" title="복사">${ICON.copy}</button>
    ${isSynth ? "" : `<button class="icon${a.rating > 0 ? " on" : ""}" data-act="up" aria-label="좋아요" title="좋아요">${ICON.up}</button>
    <button class="icon${a.rating < 0 ? " on" : ""}" data-act="down" aria-label="별로예요" title="별로예요">${ICON.down}</button>
    ${n > 1 ? `<button class="icon${t.best === key ? " on" : ""}" data-act="best" aria-label="가장 좋은 답" title="가장 좋은 답으로 표시">${ICON.star}</button>` : ""}`}
    <button class="icon" data-act="retry" aria-label="다시 답하기" title="다시 답하기">${ICON.retry}</button>
    ${isSynth ? "" : `<button class="txt" data-act="more">다른 AI에게도</button>${n > 1 && !t.synth ? `<button class="txt" data-act="synth">종합하기</button>` : ""}`}
    <span class="meta" title="${esc(a.estimated ? "토큰 수는 어림값" : "")}">${esc(meta)}</span></div>`;
}

/* 답 영역의 버튼들 (이벤트 위임) */
$("#thread").addEventListener("click", async e => {
  const b = e.target.closest("[data-act],[data-tab]"); if (!b) return;
  const el = b.closest(".turn"), i = +el.dataset.i, t = state.conv?.turns?.[i] || (el._t);
  if (!t) return;
  if (b.dataset.tab) { t._tab = b.dataset.tab; paintAnswers(el, t); return; }
  const key = b.closest(".a")?.dataset.key, a = key === "synth" ? t.synth : t.answers?.[key];
  const act = b.dataset.act;
  try {
    if (act === "copy-q") return copyText(t.q);
    if (act === "copy") return copyText(a?.text || "");
    if (state.busy) return toast("답이 끝난 뒤에 해 주세요");
    if (act === "edit") {
      const v = await ask("질문 고쳐서 다시 묻기", { input: "질문", area: true, value: t.q, ok: "보내기", msg: "이 질문부터 뒤의 대화는 보관함으로 옮겨지고, 고친 질문으로 다시 물어요." });
      if (v && v.trim()) send({ text: v.trim(), replace_from: i });
    } else if (act === "retry") send({ text: t.q, replace_from: i, keepFiles: t });
    else if (act === "branch") {
      const cv = await sendJSON(`/api/conversations/${state.convId}/branch`, "POST", { turn: i });
      await refreshConvs(); openConv(cv.id); toast("새 대화로 갈라졌어요");
    } else if (act === "up" || act === "down" || act === "best") {
      const value = act === "best" ? "best" : (a.rating === (act === "up" ? 1 : -1) ? "none" : act);
      const nt = await sendJSON("/api/feedback", "POST", { conv_id: state.convId, turn: i, provider: key, value });
      Object.assign(t, { best: nt.best, answers: nt.answers }); paintAnswers(el, t);
    } else if (act === "more") askMoreMenu(b, i, t);
    else if (act === "synth") synthMenu(b, i, t);
    else if (act === "pend-go" || act === "pend-skip") { state.busy = true; setBusy(true); try { await processPending(i, act === "pend-skip" ? key : null); } finally { state.busy = false; setBusy(false); } }
  } catch (err) { fail(err); }
});
$("#thread").addEventListener("click", e => {
  const s = e.target.closest(".starters button"); if (s) { $("#input").value = s.textContent; send(); }
});

function askMoreMenu(btn, i, t) {
  const have = new Set(answerKeys(t).filter(k => !t.answers[k].error));
  const items = CHAT_PROVS.filter(p => !have.has(p)).map(p => ({ label: PROV[p].name, sub: hasKey(p) ? modelOf(p) : "키 없음", icon: `<i class="dot ${p}"></i>`, disabled: !hasKey(p),
    act: () => runExtra("/api/ask-more", { conv_id: state.convId, turn: i, targets: [{ provider: p, model: modelOf(p) }] }, i) }));
  if (!items.length) return toast("이미 모든 AI가 답했어요");
  openMenu(btn, [{ head: "이 질문을 다른 AI에게도" }, ...items], { above: true });
}
function synthMenu(btn, i, t) {
  openMenu(btn, [{ head: "누가 종합할까요?" }, ...CHAT_PROVS.filter(hasKey).map(p => ({ label: PROV[p].name, sub: modelOf(p), icon: `<i class="dot ${p}"></i>`,
    act: () => runExtra("/api/synth", { conv_id: state.convId, turn: i, judge: { provider: p, model: modelOf(p) } }, i, true) }))], { above: true });
}

/** 스트림 이벤트 하나 → 턴 t에 반영 */
function applyEv(t, ev) {
  const A = k => k === "synth" ? t.synth : t.answers[k];
  switch (ev.type) {
    case "status": if (ev.key && A(ev.key)) A(ev.key)._status = ev.text; else t._status = ev.text; break;
    case "sources": t.sources = ev.items || []; break;
    case "delta": { const a = A(ev.key); if (a) { a.text = (a.text || "") + ev.d; a._status = null; } break; }
    case "think": { const a = A(ev.key); if (a) a.thinking = (a.thinking || "") + ev.d; break; }
    case "done": { const r = { ...ev.result, _done: true }; if (ev.key === "synth") t.synth = { ...r, labels: t.synth?.labels }; else t.answers[ev.key] = r; if (!r.pending) autoOpenArt(r.text); break; }
    case "end": setSpend(ev.spent_today); if (ev.remembered) toast("기억했어요: " + ev.remembered); break;
    case "error": t._error = ev.text; break;
  }
}

/** 기다리는 도구·로컬 모델 처리: 실행 → /api/resume (또는 로컬 저장) → 또 기다리면 반복. onlySkip = 그 답은 실행하지 않고 끝냄 */
async function processPending(i, onlySkip = null) {
  for (let guard = 0; guard < 40; guard++) {
    const t = state.conv?.turns?.[i]; if (!t) return;
    const ent = Object.entries(t.answers || {}).find(([k, a]) => a.pending && (!onlySkip || k === onlySkip));
    if (!ent) return;
    const [key, a] = ent, p = a.pending, convId = state.convId;
    const el = $(`#thread .turn[data-i="${i}"]`);
    t._live = true; t._tab = key; a._done = false;
    const paint = throttle(() => { if (el) paintAnswers(el, t); });
    paint();
    const ac = new AbortController(); state.abort = ac;
    try {
      if (p.kind === "local") {
        const nt = await runLocalJob(convId, i, key, a, paint, ac.signal);
        if (state.conv?.turns?.[i]) state.conv.turns[i].answers[key] = nt.answers[key];
      } else {
        let result;
        if (onlySkip) result = { ok: false, stopped: true, text: "사용자가 그만뒀어요" };
        else { result = await execPending(p, s => { a._status = s; paint(); }); if (ac.signal.aborted) result = { ok: false, stopped: true, text: "사용자가 멈췄어요" }; }
        a._status = "이어서 쓰는 중…"; paint();
        const res = await api("/api/resume", { method: "POST", signal: ac.signal, body: JSON.stringify({ conv_id: convId, turn: i, key, id: p.id, result, device: await deviceCatalog(), run: canRun() }) });
        await streamNDJSON(res, ev => { if (ev.type === "meta") state.runId = ev.run_id; else applyEv(t, ev); paint(); });
      }
    } catch (e) {
      if (e.name === "AbortError") {   // 멈춤 → 기다리던 것을 끝냄 (돈이 계속 나가지 않게)
        if (p.kind !== "local") { try { const r = await api("/api/resume", { method: "POST", body: JSON.stringify({ conv_id: convId, turn: i, key, id: p.id, result: { ok: false, stopped: true, text: "사용자가 멈췄어요" } }) }); await streamNDJSON(r, ev => applyEv(t, ev)); } catch {} }
        t._live = false; if (el) paintAnswers(el, t); return;
      }
      fail(e); t._live = false; delete a._status; if (el) paintAnswers(el, t); return;
    } finally { state.abort = null; }
    t._live = false; if (el) paintAnswers(el, t);
    if (onlySkip) return;
  }
}

/** 다른 AI에게 묻기 · 종합: 같은 턴에 스트리밍으로 붙임 */
async function runExtra(path, body, i, isSynth = false) {
  const t = state.conv.turns[i], el = $(`#thread .turn[data-i="${i}"]`);
  t._live = true; state.busy = true; setBusy(true);
  const paint = throttle(() => paintAnswers(el, t));
  try {
    const res = await api(path, { method: "POST", body: JSON.stringify(body) });
    await streamNDJSON(res, ev => {
      if (ev.type === "meta") { state.runId = ev.run_id; for (const k of ev.providers || []) { t.answers[k] = { text: "" }; t._tab = k; } if (isSynth) { t.synth = { text: "", labels: ev.labels }; t._tab = "synth"; } }
      else if (ev.type === "error") toast(ev.text, 6000);
      else applyEv(t, ev);
      paint();
    });
  } catch (e) { fail(e); }
  t._live = false; state.busy = false; setBusy(false); paintAnswers(el, t);
}

function throttle(fn) { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; }

/* ═════════ 대화 열기 · 새 대화 ═════════ */
function renderThread() {
  const th = $("#thread"); th.innerHTML = "";
  const turns = state.conv?.turns || [];
  turns.forEach((t, i) => th.append(buildTurn(t, i)));
  document.body.classList.toggle("has-thread", turns.length > 0);
  setTitle();
}
function setTitle() {
  const pj = state.projects.find(p => p.id === (state.conv?.project_id || state.projectId));
  $("#topTitle").innerHTML = state.conv ? `${esc(state.conv.title)}${pj ? `<small>${esc(pj.name)}</small>` : ""}` : pj ? `<small style="margin:0">${esc(pj.name)}</small>` : "";
  $("#topAct").innerHTML = state.conv ? `<button class="icon" id="convMore" aria-label="대화 메뉴">${ICON.more}</button>` : "";
  if (state.conv) $("#convMore").onclick = e => convMenu(e.currentTarget, state.conv);
  document.title = state.conv ? state.conv.title + " — TriAI" : "TriAI";
  paintCtx();
}
async function openConv(id, { push = true } = {}) {
  if (state.busy) return toast("답이 끝난 뒤에 옮겨 주세요");
  try {
    state.conv = await getJSON(`/api/conversations/${encodeURIComponent(id)}`);
    state.convId = id; state.projectId = state.conv.project_id || null;
    showView("chat"); renderThread(); paintConvs();
    if (push) history.pushState({ c: id }, "", "/?c=" + encodeURIComponent(id));
    requestAnimationFrame(() => { $("#scroller").scrollTop = $("#scroller").scrollHeight; });
    if (state.conv.unread) sendJSON(`/api/conversations/${id}/read`, "POST", {}).catch(() => {});
    closeSideMobile();
  } catch (e) { fail(e); newChat({ push: false }); }
}
function newChat({ projectId = null, push = true } = {}) {
  if (state.busy) return toast("답이 끝난 뒤에 해 주세요");
  state.conv = null; state.convId = null; state.projectId = projectId;
  showView("chat"); renderThread(); paintConvs(); paintHello();
  if (push) history.pushState({}, "", projectId ? "/?p=" + projectId : "/");
  $("#input").focus(); closeSideMobile();
}
function paintHello() {
  const pj = state.projects.find(p => p.id === state.projectId);
  const hour = new Date().getHours();
  $("#helloText").textContent = pj ? pj.name : hour < 6 ? "늦은 밤이네요" : hour < 12 ? "좋은 아침이에요" : hour < 18 ? "무엇을 도와드릴까요?" : "오늘 저녁엔 무엇을 해 볼까요?";
  $("#helloSub").textContent = pj ? (pj.description || "이 프로젝트의 지식과 지시를 바탕으로 답해요") : "";
  const ideas = pj ? [] : ["로켓 노즐 팽창비 쉽게 설명해 줘", "중력 시뮬레이션 아티팩트 만들어 줘", "최근 5년 국내 위성 발사 횟수 차트로"];
  $("#starters").innerHTML = ideas.map(x => `<button type="button">${esc(x)}</button>`).join("");
}

/* ═════════ 보내기 ═════════ */
function buildTargets() {
  const p = state.pick;
  if (p.startsWith("mode:")) return { mode: p.slice(5), targets: [], auto: false };
  if (p === "agent") return { auto: false, targets: [{ provider: "agent", model: modelOf("agent") || "Commander" }] };
  if (p.startsWith("local:")) return { auto: false, targets: [{ provider: "local", model: p.slice(6) }] };
  const keyed = CHAT_PROVS.filter(hasKey);
  if (p === "auto") return { auto: true, targets: keyed.map(x => ({ provider: x, model: modelOf(x) })) };
  if (p === "all") return { auto: false, targets: keyed.map(x => ({ provider: x, model: modelOf(x) })) };
  return { auto: false, targets: [{ provider: p, model: modelOf(p) }] };
}

async function send(opt = {}) {
  if (state.busy) return;
  const text = (opt.text ?? $("#input").value).trim();
  if (!text && !state.attach.length) return;
  if (!state.status) return toast("아직 불러오는 중이에요");
  const replace = opt.replace_from ?? null;
  // 다시 묻기: 그 턴의 첨부(사진 id·글 파일)를 그대로 다시 붙임
  const prev = opt.keepFiles;
  const attachments = prev ? [...(prev.images || []).map(id => ({ name: "image", kind: "image_ref", content: id })), ...(prev.files || []).map(f => ({ name: f.name, kind: "text", content: f.content || "", raw: f.raw }))]
    : state.attach.map(a => ({ name: a.name, kind: a.kind, content: a.content }));
  const req = { conv_id: state.convId, project_id: state.convId ? null : state.projectId, text, ...buildTargets(),
    attachments, style: state.style, web: state.web, deep: state.deep, preset: state.preset === "default" ? null : state.preset, replace_from: replace,
    device: await deviceCatalog(), run: canRun() };
  if (!req.mode && !req.targets.length) return toast("쓸 수 있는 AI가 없어요 — 관리자가 API 키를 넣어야 해요", 5000);

  // 화면에 먼저 그림
  if (!opt.text) { $("#input").value = ""; autoGrow(); }
  const previews = prev ? [] : state.attach.filter(a => a.kind === "image").map(a => a.url);
  const files = prev ? prev.files : state.attach.filter(a => a.kind === "text").map(a => ({ name: a.name }));
  if (!prev) { state.attach = []; paintAttach(); }
  if (!state.conv) state.conv = { id: null, title: text.slice(0, 40), turns: [], project_id: state.projectId };
  if (replace != null) { state.conv.turns = state.conv.turns.slice(0, replace); renderThread(); }
  const t = { q: text, answers: {}, files, images: prev?.images || [], _previews: previews, _live: true, _status: "보내는 중…", sources: [] };
  state.conv.turns.push(t);
  const idx = state.conv.turns.length - 1, el = buildTurn(t, idx);
  el._t = t; $("#thread").append(el); document.body.classList.add("has-thread");
  el.scrollIntoView({ block: "start", behavior: "smooth" });

  state.busy = true; setBusy(true);
  const ac = new AbortController(); state.abort = ac;
  const paint = throttle(() => { paintAnswers(el, t); stick(); });
  let stick0 = true;
  const sc = $("#scroller"), stick = () => { if (stick0) sc.scrollTop = sc.scrollHeight; };
  const onScroll = () => { stick0 = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120; };
  sc.addEventListener("scroll", onScroll, { passive: true });
  let endTurn = null, newId = null;
  try {
    const res = await api("/api/chat", { method: "POST", body: JSON.stringify(req), signal: ac.signal });
    await streamNDJSON(res, ev => {
      switch (ev.type) {
        case "meta":
          state.runId = ev.run_id; newId = ev.conv_id; state.conv.title = ev.title || state.conv.title;
          for (const k of ev.providers || []) t.answers[k] = { text: "" };
          t._status = ev.route?.provider ? `자동 선택: ${nameOf(ev.route.provider)}` : "생각하는 중…";
          t.route = ev.route; lightMark(ev.providers || []);
          break;
        case "local": if (t.answers[ev.key]) t.answers[ev.key]._status = "내 컴퓨터의 모델을 부르는 중…"; break;
        case "end": endTurn = ev.turn; applyEv(t, ev); break;
        default: applyEv(t, ev);
      }
      paint();
    });
  } catch (e) {
    if (e.name !== "AbortError") t._error = e.message;
  }
  sc.removeEventListener("scroll", onScroll);
  state.busy = false; state.abort = null; setBusy(false); lightMark([]);
  if (t._error && !Object.keys(t.answers).length) {   // 아예 시작도 못 함 → 질문을 입력창에 돌려놓음
    state.conv.turns.pop(); el.remove(); if (!state.conv.turns.length && !state.convId) { state.conv = null; document.body.classList.remove("has-thread"); }
    if (!opt.text) $("#input").value = text; autoGrow(); fail({ message: t._error }); return;
  }
  if (t._error) toast(t._error, 6000);
  // 저장된 대화를 다시 받아 정확히 그림 (사진 id·비용 등)
  if (newId) {
    const wasNew = !state.convId; state.convId = newId;
    try { state.conv = await getJSON(`/api/conversations/${newId}`); } catch {}
    const lt = state.conv.turns[state.conv.turns.length - 1]; if (lt) lt._tab = t._tab;
    renderThread(); stick();
    if (wasNew) history.replaceState({ c: newId }, "", "/?c=" + newId);
    refreshConvs();
    if (endTurn != null && Object.values(state.conv.turns[endTurn]?.answers || {}).some(a => a.pending)) {   // 코드 실행·기기 도구·로컬 모델
      state.busy = true; setBusy(true);
      try { await processPending(endTurn); } finally { state.busy = false; setBusy(false); }
      refreshConvs();
    }
  } else { t._live = false; paintAnswers(el, t); }
}

/** 답 하나가 끝났는데 아티팩트가 있으면 → 오른쪽 창 자동으로 열기 (넓은 화면만) */
function autoOpenArt(text) {
  if (innerWidth < 900 || !text) return;
  const m = [...String(text).matchAll(ART_FENCE)].filter(x => x[3]).pop(); if (!m) return;
  const id = artHash(m[1] + m[2]);
  if (art.opened.has(id)) return; art.opened.add(id);
  requestAnimationFrame(() => { if (ARTS[id]) openArt(id); });
}

function stop() {
  if (state.runId) sendJSON(`/api/cancel/${state.runId}`, "POST", {}).catch(() => {});
  state.abort?.abort();
}
function setBusy(b) {
  const s = $("#send"); s.classList.toggle("stop", b); s.setAttribute("aria-label", b ? "멈추기" : "보내기");
  s.disabled = false; if (!b) syncSend();
}
function lightMark(keys) { $$(".mark circle").forEach(c => c.classList.toggle("on", keys.map(provOf).includes(c.dataset.p))); }
function setSpend(v) {
  if (v == null) return; state.spent = v;
  const lim = state.status?.settings?.daily_limit;
  $("#spend").textContent = `오늘 ${fmtUsd(v) || "$0"}${lim ? ` / $${(+lim).toFixed(2)}` : ""}`;
}

/* ═════════ 입력창 ═════════ */
const input = $("#input");
function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, innerHeight * .4) + "px"; syncSend(); }
function syncSend() { if (!state.busy) $("#send").disabled = !input.value.trim() && !state.attach.length; }
input.addEventListener("input", () => { autoGrow(); estimateSoon(); });
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && innerWidth > 600) { e.preventDefault(); send(); }
});
$("#composer").addEventListener("submit", e => { e.preventDefault(); state.busy ? stop() : send(); });

/* 예상 비용 (입력이 멈추면 한 번) */
let estT = null;
function estimateSoon() {
  clearTimeout(estT); $("#est").textContent = "";
  const text = input.value.trim(); if (!text || text.length < 2) return;
  estT = setTimeout(async () => {
    try {
      const r = await sendJSON("/api/estimate", "POST", { conv_id: state.convId, project_id: state.projectId, text, ...buildTargets(), attachments: [], preset: null });
      if (input.value.trim() === text && !r.error) $("#est").textContent = r.expected > 0 ? "≈ " + fmtUsd(r.expected) : "무료";
    } catch {}
  }, 700);
}

/* 첨부: 사진(최대 4장, 줄여서) · 글 파일 */
$("#attachBtn").onclick = () => $("#fileIn").click();
$("#fileIn").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
const comp = $("#composer");
comp.addEventListener("dragover", e => { e.preventDefault(); comp.classList.add("drag"); });
comp.addEventListener("dragleave", () => comp.classList.remove("drag"));
comp.addEventListener("drop", e => { e.preventDefault(); comp.classList.remove("drag"); addFiles([...e.dataTransfer.files]); });
input.addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });

async function addFiles(files) {
  for (const f of files) {
    try {
      if (f.type.startsWith("image/")) {
        if (state.attach.filter(a => a.kind === "image").length >= 4) { toast("사진은 4장까지예요"); continue; }
        const { b64, url } = await shrinkImage(f);
        state.attach.push({ name: f.name, kind: "image", content: b64, url });
      } else if (f.type === "application/pdf") toast("PDF는 아직 못 읽어요 — 글자를 복사해 붙여 주세요", 4500);
      else {
        if (f.size > 400_000) { toast(`${f.name}: 너무 커요 (400KB까지)`); continue; }
        state.attach.push({ name: f.name, kind: "text", content: await f.text() });
      }
    } catch (e) { fail(e); }
  }
  paintAttach();
}
function shrinkImage(file, max = 1600) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL("image/jpeg", .86);
      res({ b64: data.split(",")[1], url: data });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => rej(new Error(file.name + ": 사진을 열 수 없어요"));
    img.src = url;
  });
}
function paintAttach() {
  const row = $("#attachRow");
  row.hidden = !state.attach.length;
  row.innerHTML = state.attach.map((a, i) => `<span class="chip">${a.kind === "image" ? `<img src="${esc(a.url)}" alt="">` : ""}<span>${esc(a.name)}</span><button type="button" data-rm="${i}" aria-label="${esc(a.name)} 빼기">${ICON.x}</button></span>`).join("");
  row.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { state.attach.splice(+b.dataset.rm, 1); paintAttach(); });
  syncSend();
}

/* ── 고르는 버튼: AI · 모드 ── */
function pickLabel() {
  const p = state.pick;
  if (p.startsWith("mode:")) { const m = state.modes.find(x => x.id === p.slice(5)); return [m ? m.name : "모드", "mode"]; }
  if (p === "agent") return ["에이전트 팀", "agent"];
  if (p.startsWith("local:")) return [p.slice(6).replace(/^(ollama|lms):/, ""), "local"];
  return [PICK_NAMES[p] || PROV[p]?.name || p, PROV[p]?.cls || (p === "all" ? "all" : "")];
}
function paintPick() {
  const [label, cls] = pickLabel();
  $("#pickLabel").textContent = label;
  $("#pickDot").className = "dot " + (PROV[cls] ? cls : "");
  $("#pickDot").hidden = !PROV[cls];
  const n = [state.web, state.deep, state.preset !== "default", state.style !== "default"].filter(Boolean).length;
  $("#optBtn").classList.toggle("set", n > 0);
  $("#optLabel").textContent = n ? `옵션 ${n}` : "옵션";
}
function setPick(p) { state.pick = p; store.set("pick", p); paintPick(); estimateSoon(); }
$("#pickBtn").onclick = e => {
  const p = state.pick, keyed = CHAT_PROVS.filter(hasKey);
  openMenu(e.currentTarget, [
    { label: "자동", sub: "질문마다 가장 잘하는 AI 하나", on: p === "auto", act: () => setPick("auto"), disabled: !keyed.length },
    { label: "모두 비교", sub: `${keyed.length}개 AI가 동시에 답 — 탭으로 비교`, on: p === "all", act: () => setPick("all"), disabled: keyed.length < 2 },
    "-",
    ...CHAT_PROVS.map(x => ({ label: PROV[x].name, sub: hasKey(x) ? modelOf(x) : "API 키 없음", icon: `<i class="dot ${x}"></i>`, on: p === x, disabled: !hasKey(x), act: () => setPick(x) })),
    ...(hasKey("agent") ? [{ label: "에이전트 팀", sub: `${modelOf("agent") || "Commander"} · 질문당 최대 $${(+(state.status.settings.agent_budget || 2)).toFixed(2)}`, icon: `<i class="dot agent"></i>`, on: p === "agent", act: () => setPick("agent") }] : []),
    ...(localOn() && hasKey("local") ? ["-", { head: "로컬 모델 (내 컴퓨터)" }, ...((state.localModels || []).length ? state.localModels.map(m => ({ label: m.name, sub: LOCAL_SRC[m.src].name, icon: `<i class="dot local"></i>`, on: p === "local:" + m.id, act: () => setPick("local:" + m.id) }))
      : [{ label: "모델 찾기…", sub: "Ollama·LM Studio가 켜져 있어야 해요", act: async () => { await listLocal({ quiet: false }); if (state.localModels.length) $("#pickBtn").click(); } }])] : []),
    ...(state.modes.length ? ["-", { head: "모드" }, ...state.modes.map(m => ({ label: m.name, sub: m.desc, icon: m.icon, on: p === "mode:" + m.id, disabled: !m.available, act: () => setPick("mode:" + m.id) }))] : []),
    "-", { label: "모델 바꾸기…", act: () => openSettings("models") },
  ], { above: true });
};
$("#optBtn").onclick = e => {
  openMenu(e.currentTarget, [
    { label: "웹 검색", sub: "답하기 전에 인터넷에서 찾아봄", toggle: true, on: state.web, act: v => { state.web = v; paintPick(); } },
    { label: "깊게 생각하기", sub: "더 오래 생각 (느리고 비쌈)", toggle: true, on: state.deep, act: v => { state.deep = v; paintPick(); } },
    "-", { head: "프리셋" },
    ...state.presets.map(x => ({ label: x.name, sub: x.desc, on: state.preset === x.id, act: () => { state.preset = x.id; store.set("preset", x.id); paintPick(); } })),
    "-", { head: "답 스타일" },
    ...[["default", "기본"], ["concise", "짧게"], ["detailed", "자세히"], ["beginner", "쉽게 (중학생 눈높이)"], ["formal", "격식 있게"], ...state.styles.map(s => ["custom:" + s.id, s.name])]
      .map(([id, name]) => ({ label: name, on: state.style === id, act: () => { state.style = id; store.set("style", id); paintPick(); } })),
    "-", { label: "프리셋·스타일 관리…", act: () => openSettings("presets") },
  ], { above: true });
};

/* 입력창 위: 지금 프로젝트 표시 */
function paintCtx() {
  const pid = state.conv?.project_id || state.projectId, pj = state.projects.find(p => p.id === pid);
  $("#ctxRow").hidden = !pj;
  $("#ctxRow").innerHTML = pj ? `<span class="chip ctx-c"><svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/></svg><span>${esc(pj.name)}</span>${state.conv ? "" : `<button type="button" aria-label="프로젝트에서 빼기">${ICON.x}</button>`}</span>` : "";
  $("#ctxRow button")?.addEventListener("click", () => { state.projectId = null; paintCtx(); paintHello(); setTitle(); });
}
