/* tools.js — 화면(내 기기)에서 실행하는 것들
   · 코드 실행 상자: AI의 ```run 파이썬 → /static/runner.html (격리 창 + 워커, Pyodide)
   · 내 컴퓨터 도구: AI의 ```tool → 윈도우 TriAI 앱(window.TriAIApp)이 실행 (쓰기·명령은 앱이 사람에게 허락받음)
   · 로컬 모델: 내 컴퓨터의 Ollama(11434)·LM Studio(1234)에 브라우저가 직접 연결 → 답을 서버에 저장
   서버(Cloudflare)는 내 컴퓨터에 닿을 수 없어서, 이것들은 전부 화면이 하고 결과만 서버로 보내요. */
"use strict";

const APP = window.TriAIApp && typeof window.TriAIApp.runTool === "function" ? window.TriAIApp : null;
const canRun = () => state.status?.settings?.code_tool !== false;

async function deviceCatalog() {
  if (!APP) return null;
  try { const c = await APP.deviceCatalog(); return c && (c.folders?.length || c.commands || c.screenshot || c.mcp?.length) ? c : null; } catch { return null; }
}

/* ── 코드 실행 상자 ── */
const runner = { frame: null, ready: null, onReady: null, waits: {} };
function runnerReady() {
  if (runner.frame?.isConnected) return runner.ready;
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-scripts"); f.title = "코드 실행 상자"; f.hidden = true; f.src = "/static/runner.html";
  runner.ready = new Promise((res, rej) => { runner.onReady = res; setTimeout(() => rej(new Error("코드 실행 상자를 열지 못했어요")), 20000); });
  runner.frame = f; document.body.append(f);
  return runner.ready;
}
addEventListener("message", e => {
  if (!runner.frame || e.source !== runner.frame.contentWindow) return;
  const d = e.data || {};
  if (d.runReady) runner.onReady?.();
  else if (d.runStatus) runner.waits[d.runStatus.id]?.status?.(d.runStatus.text);
  else if (d.runResult) { const w = runner.waits[d.runResult.id]; if (w) { delete runner.waits[d.runResult.id]; w.res(d.runResult); } }
});
async function runPython(code, onStatus) {
  await runnerReady();
  const id = Math.random().toString(36).slice(2);
  return new Promise(res => { runner.waits[id] = { res, status: onStatus }; runner.frame.contentWindow.postMessage({ run: { id, code } }, "*"); });
}
async function uploadImages(list) {
  const ids = [];
  for (const b64 of (list || []).slice(0, 6)) {
    try { ids.push((await sendJSON("/api/uploads", "POST", { b64, mime: "image/png" })).id); } catch (e) { toast("그림을 올리지 못했어요: " + e.message); }
  }
  return ids;
}

/** 기다리는 도구 하나 실행 → 서버에 보낼 결과 */
async function execPending(p, onStatus = () => {}) {
  if (p.kind === "run") {
    if (!canRun()) return { ok: false, error: "코드 실행이 꺼져 있어요 (설정 → 도구)" };
    onStatus("▶ 코드 실행 중…");
    const r = await runPython(p.code || "", onStatus);
    return { ok: !!r.ok, stdout: r.stdout || "", error: r.error || "", sec: r.sec, image_ids: await uploadImages(r.images) };
  }
  if (p.kind === "tool") {
    if (!APP) return { ok: false, text: "윈도우 TriAI 앱이 아니라서 내 컴퓨터 도구를 실행할 수 없어요" };
    onStatus(`${p.label} — 앱에서 실행 중… (허락이 필요하면 앱 창을 확인하세요)`);
    let r;
    try { r = await APP.runTool({ name: p.name, args: p.args || {}, label: p.label }); }
    catch (e) { r = { ok: false, text: "앱에서 실행하다 오류: " + (e?.message || e) }; }
    const out = { ok: !!r?.ok, text: String(r?.text ?? ""), denied: !!r?.denied };
    if (r?.image) out.image_ids = await uploadImages([r.image]);
    return out;
  }
  return { ok: false, text: "알 수 없는 도구" };
}

/* ── 로컬 모델 (Ollama · LM Studio) ── */
const LOCAL_SRC = {
  ollama: { name: "Ollama", url: () => store.get("ollamaUrl", "http://localhost:11434") },
  lms: { name: "LM Studio", url: () => store.get("lmsUrl", "http://localhost:1234") },
};
const localOn = () => store.get("localOn", false);
async function listLocal({ quiet = true } = {}) {
  const out = [], errs = [];
  await Promise.all(Object.entries(LOCAL_SRC).map(async ([src, s]) => {
    try {
      const r = await fetch(s.url() + (src === "ollama" ? "/api/tags" : "/v1/models"), { signal: AbortSignal.timeout(2500) });
      const j = await r.json();
      const names = src === "ollama" ? (j.models || []).map(m => m.name) : (j.data || []).map(m => m.id);
      for (const n of names) out.push({ id: `${src}:${n}`, name: n, src });
    } catch (e) { errs.push(`${s.name}: ${e.name === "TimeoutError" ? "응답 없음" : "연결 안 됨"}`); }
  }));
  state.localModels = out;
  if (!quiet && !out.length) toast("로컬 모델을 찾지 못했어요 — " + errs.join(" · "), 6000);
  return { models: out, errs };
}

/** 로컬 모델 스트리밍 → {t:"delta"|"think"|"usage"} */
async function* localStream(model, messages, system, job, signal) {
  const [src, ...rest] = model.split(":"), name = rest.join(":"), base = LOCAL_SRC[src]?.url();
  if (!base) throw new Error("알 수 없는 로컬 모델: " + model);
  const p = job.params || {}, max = p.num_predict || job.max_tokens;
  let res;
  const hint = src === "ollama" ? "Ollama가 켜져 있는지, 환경변수 OLLAMA_ORIGINS에 이 주소(" + location.origin + ")를 넣었는지 확인하세요"
    : "LM Studio의 서버가 켜져 있고 'CORS 허용'이 켜져 있는지 확인하세요";
  try {
    if (src === "ollama") {
      res = await fetch(base + "/api/chat", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        model: name, stream: true, ...(p.format === "json" ? { format: "json" } : {}),
        options: { num_predict: max, ...(p.temperature != null ? { temperature: p.temperature } : {}), ...(p.top_p != null ? { top_p: p.top_p } : {}), ...(p.top_k != null ? { top_k: p.top_k } : {}), ...(p.repeat_penalty != null ? { repeat_penalty: p.repeat_penalty } : {}) },
        messages: [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images } : {}) }))] }) });
    } else {
      res = await fetch(base + "/v1/chat/completions", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        model: name, stream: true, max_tokens: max, stream_options: { include_usage: true },
        ...(p.temperature != null ? { temperature: p.temperature } : {}), ...(p.top_p != null ? { top_p: p.top_p } : {}),
        messages: [{ role: "system", content: system }, ...messages.map(m => m.images?.length && m.role === "user"
          ? { role: "user", content: [...m.images.map(b => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + b } })), { type: "text", text: m.content }] }
          : { role: m.role, content: m.content })] }) });
    }
  } catch (e) { if (e.name === "AbortError") throw e; throw new Error(`${LOCAL_SRC[src].name}에 연결할 수 없어요 — ${hint}`); }
  if (!res.ok) throw new Error(`${LOCAL_SRC[src].name} 오류 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", inThink = false, usage = null;
  const split = function* (txt) {   // <think>…</think> 를 '생각'으로
    while (txt) {
      if (inThink) { const i = txt.indexOf("</think>"); if (i < 0) { yield { t: "think", d: txt }; return; } if (i) yield { t: "think", d: txt.slice(0, i) }; inThink = false; txt = txt.slice(i + 8); }
      else { const i = txt.indexOf("<think>"); if (i < 0) { yield { t: "delta", d: txt }; return; } if (i) yield { t: "delta", d: txt.slice(0, i) }; inThink = true; txt = txt.slice(i + 7); }
    }
  };
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      if (src !== "ollama") { if (!line.startsWith("data:")) continue; line = line.slice(5).trim(); if (line === "[DONE]") continue; }
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (src === "ollama") {
        if (j.error) throw new Error("Ollama: " + j.error);
        if (j.message?.thinking) yield { t: "think", d: j.message.thinking };
        if (j.message?.content) yield* split(j.message.content);
        if (j.done) usage = { in: j.prompt_eval_count || 0, out: j.eval_count || 0, tps: j.eval_duration ? Math.round(j.eval_count / (j.eval_duration / 1e9) * 10) / 10 : null };
      } else {
        const d = j.choices?.[0]?.delta || {};
        if (d.reasoning_content || d.reasoning) yield { t: "think", d: d.reasoning_content || d.reasoning };
        if (d.content) yield* split(d.content);
        if (j.usage) usage = { in: j.usage.prompt_tokens || 0, out: j.usage.completion_tokens || 0 };
      }
    }
  }
  yield { t: "usage", u: usage };
}

const TOOL_BLOCK = /```(tool|run|mcp|search|fetch|image|sensor)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
function findBlockJS(text, on) {
  TOOL_BLOCK.lastIndex = 0; let best = null, m;
  while ((m = TOOL_BLOCK.exec(text))) if (on[m[1]] && (!best || m.index + m[0].length < best.end)) best = { kind: m[1], body: m[2], end: m.index + m[0].length };
  return best;
}

/** 로컬 모델 답 만들기 (+ 답 중간 도구) → 서버에 저장. a = 화면의 답 객체 (실시간으로 채움), paint = 다시 그리기 */
async function runLocalJob(convId, turn, key, a, paint, signal) {
  const job = await sendJSON("/api/local/job", "POST", { conv_id: convId, turn, key, device: await deviceCatalog(), run: canRun() });
  const on = { run: job.tools.run, tool: job.tools.device && !!APP, search: job.tools.search, fetch: job.tools.search, image: job.tools.image, mcp: job.tools.mcp, sensor: job.tools.sensors };
  const msgs = job.messages.slice();
  const t0 = performance.now(); let ttft = null, inTok = 0, outTok = 0, tps = null, rounds = 0, error = null, stopped = false;
  Object.assign(a, { text: "", thinking: "", model: job.model, provider: "local", _status: "내 컴퓨터의 모델이 쓰는 중…" });
  try {
    for (;;) {
      let round = "", found = null, usage = null;
      for await (const ev of localStream(job.model, msgs, job.system, job, signal)) {
        if (ev.t === "delta") {
          if (ttft == null) ttft = (performance.now() - t0) / 1000;
          const prev = round.length; round += ev.d;
          const f = rounds < 12 && round.includes("```") ? findBlockJS(round, on) : null;
          if (f) { a.text += round.slice(prev, f.end); round = round.slice(0, f.end); found = f; break; }
          a.text += ev.d;
        } else if (ev.t === "think") a.thinking += ev.d;
        else if (ev.t === "usage") usage = ev.u;
        a._status = null; paint();
      }
      inTok += usage?.in || Math.ceil((job.system.length + msgs.reduce((n, m) => n + m.content.length, 0)) / 2);
      outTok += usage?.out || Math.ceil(round.length / 2); if (usage?.tps) tps = usage.tps;
      if (!found) break;
      rounds++; msgs.push({ role: "assistant", content: round });
      let r;
      if (found.kind === "run" || found.kind === "tool") {
        let pend = { kind: found.kind, code: found.body };
        if (found.kind === "tool") { try { const d = JSON.parse(found.body); pend = { kind: "tool", name: String(d.name || ""), args: d.args || {}, label: "🧩 " + d.name }; } catch { pend = { kind: "tool", name: "?", args: {}, label: "🧩 도구" }; } }
        const res = await execPending(pend, s => { a._status = s; paint(); });
        r = await sendJSON("/api/tool/exec", "POST", { kind: "result", pending: pend, result: res });
      } else {
        a._status = found.kind === "search" ? "🔍 검색 중…" : found.kind === "image" ? "🎨 그림 그리는 중…" : found.kind === "sensor" ? "📈 센서 기록 보는 중…" : "도구 실행 중…"; paint();
        r = await sendJSON("/api/tool/exec", "POST", { kind: found.kind, body: found.body });
      }
      a.text += r.rec; msgs.push({ role: "user", content: r.follow }); a._status = "이어서 쓰는 중…"; paint();
    }
  } catch (e) { if (e.name === "AbortError") stopped = true; else error = e.message; }
  const sec = Math.round((performance.now() - t0) / 10) / 100;
  if (!tps && outTok && ttft != null && sec - ttft > 0.05) tps = Math.round(outTok / (sec - ttft) * 10) / 10;
  const result = { model: job.model, text: a.text, thinking: a.thinking || undefined, in: inTok, out: outTok, sec, tps, ttft: ttft && Math.round(ttft * 100) / 100, error, stopped, estimated: true };
  const saved = await sendJSON("/api/local/save", "POST", { conv_id: convId, turn, key, id: job.id, result });
  return saved.turn;
}

/* ── 윈도우 앱: 화면 캡처 버튼 · 빠른 질문 ── */
if (APP) {
  document.body.classList.add("in-app");
  if (APP.screenshot) {
    const b = h(`<button type="button" class="icon" id="shotBtn" aria-label="화면 캡처해서 첨부" title="화면 캡처해서 첨부"><svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/></svg></button>`);
    $("#attachBtn").after(b);
    b.onclick = async () => {
      try { const b64 = await APP.screenshot(); if (!b64) return; state.attach.push({ name: "화면.png", kind: "image", content: b64, url: "data:image/png;base64," + b64 }); paintAttach(); $("#input").focus(); }
      catch (e) { toast("화면을 찍지 못했어요: " + (e?.message || e)); }
    };
  }
  APP.onQuickAsk?.(async ({ text, shot }) => {
    if (state.busy) return toast("답이 끝난 뒤에 다시 해 주세요");
    newChat();
    if (shot) { try { const b64 = await APP.screenshot(); if (b64) state.attach.push({ name: "화면.png", kind: "image", content: b64, url: "data:image/png;base64," + b64 }); } catch {} }
    $("#input").value = text || ""; send();
  });
}
