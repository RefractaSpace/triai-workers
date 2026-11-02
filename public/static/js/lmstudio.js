/* lmstudio.js — LM Studio에서 가져온 기능
   모델 관리(검색·다운로드·불러오기 설정) · 생성 설정 프리셋 · 🤖 에이전트 모드 · 📚 문서 발췌 표시 · ⑂ 가지치기
   core.js의 도구들($, api, getJSON, sendJSON, dialog, toast, esc, state, setView)을 그대로 씁니다. */

/* ═════════ 🤖 에이전트 모드 ═════════ */
state.agent = false;
$("#agentBtn").onclick = () => {
  state.agent = !state.agent;
  $("#agentBtn").classList.toggle("on", state.agent);
  $("#agentBtn").setAttribute("aria-pressed", state.agent);
  toast(state.agent ? "에이전트 모드 켬 — 계획을 세우고 계산·검색·파일 도구를 여러 번 써서 끝까지 해요" : "에이전트 모드 끔");
};

/* ═════════ 📚 문서 발췌 표시 ═════════ */
const pageText = h => h.pages ? (h.pages[0] === h.pages[1] ? `${h.pages[0]}쪽` : `${h.pages[0]}~${h.pages[1]}쪽`) : `조각 ${h.i + 1}`;
window.ragHTML = rows => rows && rows.length ? `<div class="sources rag"><b>📚 참고한 문서 부분 (질문과 관련된 곳만 골라 보냄)</b>${
  rows.map(h => `<span title="관련도 ${h.score}">${esc(h.doc)} · ${pageText(h)}</span>`).join("")}</div>` : "";

/* ═════════ ⑂ 가지치기 ═════════ */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-branch]");
  if (!b || state.busy) return;
  const idx = +b.closest(".turn").dataset.turn;
  try {
    const r = await sendJSON(`/api/conversations/${state.convId}/branch`, "POST", { turn: idx });
    toast("새 대화로 가지쳤어요 — 원래 대화는 그대로예요");
    await loadConvs(); openConv(r.id);
  } catch (err) { toast(err.message); }
});

/* ═════════ 생성 설정 프리셋 ═════════ */
async function loadPresets() {
  const sel = $("#presetSel"), keep = localStorage.getItem("preset") || "default";
  let list = [];
  try { list = await getJSON("/api/presets"); } catch {}
  sel.innerHTML = list.map(p => `<option value="${esc(p.id)}" title="${esc(p.desc || "")}">⚙ ${esc(p.name)}</option>`).join("")
    + `<option value="__manage">프리셋 관리…</option>`;
  sel.value = list.some(p => p.id === keep) ? keep : "default";
  state.presets = list;
}
$("#presetSel").addEventListener("change", e => {
  if (e.target.value === "__manage") { e.target.value = localStorage.getItem("preset") || "default"; managePresets(); return; }
  localStorage.setItem("preset", e.target.value);
  const p = state.presets?.find(x => x.id === e.target.value);
  if (p?.desc) toast(`${p.name}: ${p.desc}`);
});

const PRESET_HELP = {
  temperature: ["온도", "0~2 · 낮으면 정확하고 매번 비슷, 높으면 다양하고 창의적 (보통 0.7)"],
  top_p: ["top_p", "0~1 · 확률 높은 단어 중 상위 몇 %만 후보로 (보통 0.9)"],
  top_k: ["top_k", "1~500 · 후보 단어 개수 (보통 40)"],
  repeat_penalty: ["반복 억제", "0.5~2 · 1보다 크면 같은 말 반복을 피함 (보통 1.1)"],
  seed: ["시드", "같은 숫자면 같은 질문에 같은 답 (실험 재현용, 비우면 매번 다름)"],
  num_predict: ["최대 길이", "답의 최대 토큰 수 (비우면 설정의 기본값)"],
};
async function presetForm(p = {}) {
  const fields = Object.entries(PRESET_HELP).map(([k, [label, help]]) =>
    `<label for="pf_${k}">${label} <small>— ${help}</small></label><input id="pf_${k}" type="number" step="any" value="${p[k] ?? ""}" placeholder="비우면 모델 기본값">`).join("");
  const fmt = p.format ? (typeof p.format === "string" ? p.format : JSON.stringify(p.format, null, 2)) : "";
  const v = await dialog(p.id ? `프리셋 고치기: ${esc(p.name)}` : "새 프리셋", `
    <label for="pf_name">이름</label><input id="pf_name" maxlength="20" value="${esc(p.name || "")}" placeholder="예: 로켓 계산용">
    <label for="pf_desc">설명</label><input id="pf_desc" maxlength="100" value="${esc(p.desc || "")}">
    ${fields}
    <label for="pf_fmt">구조화 출력 <small>— 비우면 자유롭게 · <code>json</code>이면 JSON으로만 · JSON 스키마를 넣으면 그 모양을 강제 (로컬 모델만)</small></label>
    <textarea id="pf_fmt" rows="4" placeholder='{"type":"object","properties":{"isp":{"type":"number"}}}'>${esc(fmt)}</textarea>`,
    [{ label: "취소", value: null, kind: "ghost" }, { label: "저장", value: "ok" }]);
  if (!v) return;
  const body = { name: $("#pf_name").value, desc: $("#pf_desc").value, format: $("#pf_fmt").value };
  for (const k of Object.keys(PRESET_HELP)) { const x = $(`#pf_${k}`).value; if (x !== "") body[k] = Number(x); }
  try {
    const r = p.id ? await sendJSON(`/api/presets/${p.id}`, "PUT", body) : await sendJSON("/api/presets", "POST", body);
    await loadPresets(); $("#presetSel").value = r.id; localStorage.setItem("preset", r.id); toast("프리셋을 저장했어요");
  } catch (e) { toast(e.message); }
}
async function managePresets() {
  const list = await getJSON("/api/presets");
  const desc = p => Object.keys(PRESET_HELP).filter(k => p[k] != null).map(k => `${PRESET_HELP[k][0]} ${p[k]}`).join(" · ") + (p.format ? " · JSON" : "");
  const v = await dialog("생성 설정 프리셋", `<p class="muted small" style="margin:0 0 8px">AI가 답을 만드는 방식(온도 등)을 이름 붙여 저장해요. 로컬 모델은 전부, Claude는 온도만, Gemini는 온도·top_p·top_k만 반영돼요.</p>
    ${list.map(p => `<div class="mem-row"><b style="min-width:90px">${esc(p.name)}</b><span class="small muted" style="flex:1">${esc(desc(p) || p.desc || "모델 기본값")}</span>
      ${p.builtin ? `<button class="btn ghost chip" data-pcopy="${p.id}">복제</button>` : `<button class="btn ghost chip" data-pedit="${p.id}">고치기</button><button class="btn ghost chip" data-pdel="${p.id}">삭제</button>`}</div>`).join("")}`,
    [{ label: "닫기", value: null, kind: "ghost" }, { label: "＋ 새 프리셋", value: "new" }],
    () => {
      const close = () => $("#dlg").classList.remove("open");
      document.querySelectorAll("[data-pedit]").forEach(b => b.onclick = () => { close(); presetForm(list.find(p => p.id === b.dataset.pedit)); });
      document.querySelectorAll("[data-pcopy]").forEach(b => b.onclick = () => { close(); const { id, builtin, ...rest } = list.find(p => p.id === b.dataset.pcopy); presetForm({ ...rest, name: rest.name + " 복사" }); });
      document.querySelectorAll("[data-pdel]").forEach(b => b.onclick = async () => { await api(`/api/presets/${b.dataset.pdel}`, { method: "DELETE" }); b.closest(".mem-row").remove(); loadPresets(); });
    });
  if (v === "new") presetForm();
}

/* ═════════ 모델 관리 화면 ═════════ */
const FIT_ICON = { full: "🟢", partial: "🟡", too_big: "🔴" };
let pullCtl = null;   // 다운로드 취소용

async function openModels() { if(typeof state!=="undefined"&&state.status?.serverless) return;
  setView("models");
  $("#page").innerHTML = `<div class="page"><div class="page-head"><div style="flex:1"><h1>모델</h1>
    <p>내 컴퓨터의 로컬 AI 모델을 찾아서 받고, 그래픽카드에 올리고, 모델마다 설정해요.</p></div></div>
    <div id="gpuBox" class="box gpu-box">불러오는 중…</div>
    <div id="pullBox" class="box" hidden></div>
    <div class="box"><h3>모델 찾기</h3>
      <div class="tabs-row"><button class="btn ghost chip on" data-src="ollama">Ollama 공식</button><button class="btn ghost chip" data-src="hf">Hugging Face (고급)</button></div>
      <p class="muted small" id="srcNote" style="margin:6px 0">Ollama가 검증해서 올린 모델이에요. 처음이면 여기서 고르세요.</p>
      <div class="actions"><input class="sm" id="mSearch" placeholder="예: qwen3, gemma, llama, 코딩용은 coder" style="flex:1"><button class="btn" id="mSearchBtn">검색</button></div>
      <div class="actions"><input class="sm" id="mDirect" placeholder="이름을 알면 바로 받기: qwen3:8b · hf.co/사용자/저장소:Q4_K_M" style="flex:1"><button class="btn ghost" id="mDirectBtn">받기</button></div>
      <div id="mResults"></div></div>
    <div class="box"><h3>설치된 모델</h3><div id="mList">불러오는 중…</div></div></div>`;
  let src = "ollama";
  document.querySelectorAll("[data-src]").forEach(b => b.onclick = () => {
    src = b.dataset.src;
    document.querySelectorAll("[data-src]").forEach(x => x.classList.toggle("on", x === b));
    $("#srcNote").textContent = src === "hf"
      ? "GGUF 파일을 직접 받아요 (LM Studio 방식). 개인이 수정한 모델도 섞여 있으니 다운로드 수와 만든 곳을 확인하세요."
      : "Ollama가 검증해서 올린 모델이에요. 처음이면 여기서 고르세요.";
    $("#mResults").innerHTML = "";
  });
  const doSearch = async () => {
    const q = $("#mSearch").value.trim(); if (!q) return;
    $("#mResults").innerHTML = `<p class="muted small">찾는 중…</p>`;
    try { renderResults(await getJSON(`/api/local-models/search?q=${encodeURIComponent(q)}&source=${src}`), src); }
    catch (e) { $("#mResults").innerHTML = `<p class="small" style="color:var(--danger)">${esc(e.message)}</p>`; }
  };
  $("#mSearchBtn").onclick = doSearch; $("#mSearch").onkeydown = e => { if (e.key === "Enter") doSearch(); };
  $("#mDirectBtn").onclick = () => { const n = $("#mDirect").value.trim(); if (n) pull(n); };
  refreshModels();
}

async function refreshModels() {
  let d;
  try { d = await getJSON("/api/local-models"); }
  catch (e) { $("#gpuBox").innerHTML = `<p style="color:var(--danger);margin:0">${esc(e.message)}</p>`; $("#mList").innerHTML = ""; return; }
  const g = d.gpu, used = d.models.filter(m => m.loaded).reduce((s, m) => s + (m.vram_gb || 0), 0);
  const usedGb = g.used_gb ?? used, pct = Math.min(100, usedGb / g.total_gb * 100);
  $("#gpuBox").innerHTML = `<div class="kv"><b>${esc(g.name)}</b><span>${usedGb.toFixed(1)} / ${g.total_gb} GB 사용 중${g.measured ? "" : " (추정 — 설정의 그래픽카드 메모리 값)"}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>`;
  $("#mList").innerHTML = d.models.length ? d.models.map(m => `<div class="lm-row ${m.loaded ? "loaded" : ""}">
      <div class="model-main"><b>${esc(m.name)}</b>
        <span class="small muted">${m.size_gb} GB${m.params ? " · " + esc(m.params) : ""}${m.quant ? " · " + esc(m.quant) : ""}${m.vision ? " · 👁 이미지" : ""}${!m.chat ? " · 임베딩(분류·문서 검색용)" : ""}</span>
        <span class="small">${m.loaded ? `<span class="pill ok">올라가 있음 · 그래픽카드 ${m.vram_gb}GB${m.in_ram_gb > 0.1 ? ` + RAM ${m.in_ram_gb}GB` : ""}</span>` : `${FIT_ICON[m.fit.level]} ${esc(m.fit.label)} <span class="muted">(필요 약 ${m.fit.need_gb}GB)</span>`}
          ${m.settings?.num_ctx ? ` · 기억 ${m.settings.num_ctx.toLocaleString()}` : ""}</span></div>
      <div class="model-btns">${m.chat ? (m.loaded ? `<button class="btn ghost chip" data-unload="${esc(m.name)}">내리기</button>` : `<button class="btn ghost chip" data-load="${esc(m.name)}">불러오기</button>`) : ""}
        ${m.chat ? `<button class="btn ghost chip" data-mset="${esc(m.name)}">설정</button>` : ""}<button class="btn ghost chip" data-mdel="${esc(m.name)}">삭제</button></div></div>`).join("")
    : `<p class="muted small" style="margin:0">설치된 모델이 없어요. 위에서 찾아서 받아보세요. (추천: gpt-oss:20b — 16GB 그래픽카드에 맞음)</p>`;
  $("#mList").onclick = async e => {
    const t = e.target.closest("button"); if (!t) return;
    const name = t.dataset.load || t.dataset.unload || t.dataset.mset || t.dataset.mdel;
    if (t.dataset.load) { t.textContent = "올리는 중…"; t.disabled = true; try { await api(`/api/local-models/${encodeURIComponent(name)}/load`, { method: "POST" }); toast(`${name}을(를) 그래픽카드에 올렸어요`); } catch (err) { toast(err.message); } refreshModels(); }
    if (t.dataset.unload) { await api(`/api/local-models/${encodeURIComponent(name)}/unload`, { method: "POST" }); toast("내렸어요 — 메모리가 비워졌어요"); setTimeout(refreshModels, 800); }
    if (t.dataset.mset) modelSettings(d.models.find(m => m.name === name), d.default_ctx);
    if (t.dataset.mdel && await confirmBox("모델 삭제", `${esc(name)}을(를) 지울까요? 다시 쓰려면 새로 받아야 해요.`, "삭제", true)) {
      try { await api(`/api/local-models/${encodeURIComponent(name)}`, { method: "DELETE" }); toast("삭제했어요"); } catch (err) { toast(err.message); }
      refreshModels();
    }
  };
}

async function modelSettings(m, defCtx) {
  const s = m.settings || {};
  const ctxs = [2048, 4096, 8192, 16384, 32768, 65536, 131072];
  const v = await dialog(`모델 설정: ${esc(m.name)}`, `
    <label for="ms_ctx">기억 길이 (num_ctx) <small>— 클수록 긴 대화·문서를 기억하지만 그래픽카드 메모리를 더 써요</small></label>
    <select id="ms_ctx"><option value="">기본값 (${defCtx.toLocaleString()})</option>${ctxs.map(c => `<option value="${c}" ${s.num_ctx === c ? "selected" : ""}>${c.toLocaleString()} 토큰</option>`).join("")}</select>
    <label for="ms_gpu">그래픽카드에 올릴 층 수 (num_gpu) <small>— 비우면 자동. 모델이 커서 느리면 줄여서 일부를 RAM으로 (LM Studio의 GPU 오프로드)</small></label>
    <input id="ms_gpu" type="number" min="0" max="999" value="${s.num_gpu ?? ""}" placeholder="자동">
    <label for="ms_keep">메모리에 남겨둘 시간 (keep_alive) <small>— 길면 다음 질문이 빠르지만 그동안 메모리를 차지해요</small></label>
    <select id="ms_keep"><option value="">기본 (5분)</option>${[["30m", "30분"], ["1h", "1시간"], ["-1", "계속 (내리기 전까지)"]].map(([k, l]) => `<option value="${k}" ${s.keep_alive === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <p class="muted small" style="margin:10px 0 0">지금 예상: ${FIT_ICON[m.fit.level]} ${esc(m.fit.label)} (약 ${m.fit.need_gb}GB / ${m.fit.vram_gb}GB). 바꾼 설정은 다음에 불러올 때부터 적용돼요.</p>`,
    [{ label: "취소", value: null, kind: "ghost" }, { label: "저장", value: "ok" }]);
  if (!v) return;
  const gpu = $("#ms_gpu").value;
  try {
    await sendJSON(`/api/local-models/${encodeURIComponent(m.name)}/settings`, "PUT",
      { num_ctx: +$("#ms_ctx").value || null, num_gpu: gpu === "" ? null : +gpu, keep_alive: $("#ms_keep").value || null });
    toast("설정을 저장했어요"); refreshModels();
  } catch (e) { toast(e.message); }
}

function renderResults(rows, src) {
  if (!rows.length) { $("#mResults").innerHTML = `<p class="muted small">결과가 없어요.</p>`; return; }
  if (src === "ollama") {
    $("#mResults").innerHTML = rows.map(r => `<div class="lm-row"><div class="model-main"><b>${esc(r.name)}</b>
        <span class="small muted">${esc(r.desc)}</span>
        <span class="small">${r.caps.map(c => `<span class="pill">${esc(c)}</span>`).join(" ")}</span></div>
      <div class="model-btns">${(r.sizes.length ? r.sizes : ["latest"]).map(sz => `<button class="btn ghost chip" data-pull="${esc(r.name)}:${esc(sz)}" title="${esc(r.name)}:${esc(sz)} 받기">${esc(sz)}</button>`).join("")}</div></div>`).join("");
  } else {
    $("#mResults").innerHTML = rows.map(r => `<div class="lm-row"><div class="model-main"><b>${esc(r.name)}</b>
        <span class="small muted">⬇ ${r.downloads.toLocaleString()} · ♥ ${r.likes}</span></div>
      <div class="model-btns"><button class="btn ghost chip" data-hf="${esc(r.name)}">파일 보기</button></div></div>
      <div class="hf-files" data-for="${esc(r.name)}"></div>`).join("");
  }
  $("#mResults").onclick = async e => {
    const p = e.target.closest("[data-pull]"); if (p) return pull(p.dataset.pull);
    const h = e.target.closest("[data-hf]"); if (!h) return;
    const box = $("#mResults").querySelector(`.hf-files[data-for="${CSS.escape(h.dataset.hf)}"]`);
    box.innerHTML = `<p class="muted small">불러오는 중…</p>`;
    try {
      const files = await getJSON(`/api/local-models/hf-files?repo=${encodeURIComponent(h.dataset.hf)}`);
      box.innerHTML = files.length ? `<p class="muted small" style="margin:4px 0">양자화가 낮을수록(Q2, Q3) 작고 빠르지만 덜 똑똑해요. 보통 Q4_K_M이 균형이 좋아요.</p>` + files.map(f =>
        `<div class="hf-file">${FIT_ICON[f.fit.level]} <b>${esc(f.quant)}</b> <span class="muted small">${f.size_gb} GB · ${esc(f.fit.label)}</span>
          <button class="btn ghost chip" data-pull="${esc(f.pull)}">받기</button></div>`).join("") : `<p class="muted small">GGUF 파일이 없어요.</p>`;
    } catch (err) { box.innerHTML = `<p class="small" style="color:var(--danger)">${esc(err.message)}</p>`; }
  };
}

async function pull(name) {
  if (pullCtl) return toast("이미 다른 모델을 받는 중이에요");
  const box = $("#pullBox"); box.hidden = false;
  box.innerHTML = `<div class="kv"><b>⬇ ${esc(name)}</b><button class="btn ghost chip" id="pullCancel">취소</button></div>
    <div class="bar"><i id="pullBar" style="width:0%"></i></div><p class="small muted" id="pullMsg" style="margin:6px 0 0">시작하는 중…</p>`;
  pullCtl = new AbortController();
  $("#pullCancel").onclick = () => pullCtl?.abort();
  try {
    const r = await fetch("/api/local-models/pull", { method: "POST", signal: pullCtl.signal,
      headers: { "Content-Type": "application/json", "X-TriAI": "1" }, body: JSON.stringify({ name }) });
    if (!r.ok) throw new Error((await r.json()).detail || "받기 실패");
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.error) throw new Error(ev.error);
        if (ev.total && ev.completed != null) {
          $("#pullBar").style.width = (ev.completed / ev.total * 100).toFixed(1) + "%";
          $("#pullMsg").textContent = `${(ev.completed / 1e9).toFixed(2)} / ${(ev.total / 1e9).toFixed(2)} GB`;
        } else if (ev.status) $("#pullMsg").textContent = ev.status === "success" ? "완료!" : ev.status;
      }
    }
    toast(`${name} 받기 완료`); refreshModels(); renderPicker?.();
  } catch (e) {
    $("#pullMsg").textContent = e.name === "AbortError" ? "취소했어요 (받던 조각은 다음에 이어받을 수 있어요)" : `실패: ${e.message}`;
  } finally { pullCtl = null; setTimeout(() => { if (!pullCtl) box.hidden = true; }, 4000); }
}

/* ═════════ 설정 화면에 항목 추가 ═════════ */
new MutationObserver(() => {
  const box = document.getElementById("featSettings");
  if (!box || document.getElementById("lmSet")) return;
  const s = state.status?.settings || {};
  box.insertAdjacentHTML("beforeend", `<div id="lmSet">
    <h3 class="set-h">에이전트 · 문서 · 모델</h3>
    <label for="lAgent">에이전트가 도구를 쓸 수 있는 최대 횟수 <small>— 많을수록 복잡한 일을 끝까지 하지만 오래 걸려요</small></label>
    <input id="lAgent" type="number" min="3" max="30" value="${s.agent_steps ?? 10}">
    <label for="lRag">문서 검색으로 바꾸는 기준 (글자 수) <small>— 올린 파일이 이보다 길면 통째로 보내지 않고 관련 부분만 찾아서 보내요</small></label>
    <input id="lRag" type="number" min="2000" step="1000" value="${s.rag_threshold ?? 12000}">
    <label for="lVram">그래픽카드 메모리 (GB) <small>— 모델이 들어갈지 예측할 때 써요 (NVIDIA면 자동으로 읽음)</small></label>
    <input id="lVram" type="number" min="1" step="1" value="${s.vram_gb ?? 16}"></div>`);
}).observe(document.body, { childList: true, subtree: true });
window.lmSettingsValues = () => document.getElementById("lAgent") ? {
  agent_steps: Math.max(3, Math.min(30, +$("#lAgent").value || 10)),
  rag_threshold: Math.max(2000, +$("#lRag").value || 12000), vram_gb: Math.max(1, +$("#lVram").value || 16) } : {};

loadPresets();
