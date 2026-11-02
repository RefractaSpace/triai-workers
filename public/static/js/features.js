/* features.js — 웹 검색 · 음성 입력/읽어주기 · 사용자 지정 스타일 · 전체 기억 관리
   core.js의 도구들($, api, getJSON, sendJSON, dialog, toast, esc, state)을 그대로 씁니다. */

/* ═════════ 🌐 웹 검색 켜기 ═════════ */
state.web = false;
$("#webBtn").onclick = () => {
  state.web = !state.web;
  $("#webBtn").classList.toggle("on", state.web);
  $("#webBtn").setAttribute("aria-pressed", state.web);
  toast(state.web ? "웹 검색 켬 — 보내면 먼저 검색해서 출처와 함께 답해요" : "웹 검색 끔");
};

/* ═════════ 🧠 깊게 생각 (보낸 뒤에도 켜진 채로 둠 — 어려운 대화는 계속 깊게) ═════════ */
state.deep = false;
$("#deepBtn").onclick = () => {
  state.deep = !state.deep;
  $("#deepBtn").classList.toggle("on", state.deep);
  $("#deepBtn").setAttribute("aria-pressed", state.deep);
  toast(state.deep ? "깊게 생각 켬 — 오래 생각하고 답해요 (Claude는 비용, Cloudflare는 무료 한도를 더 써요)" : "깊게 생각 끔");
};

/* ═════════ 🎤 음성 입력 (내 컴퓨터의 Whisper로 인식) ═════════ */
const voice = { rec: null, chunks: [], stream: null, busy: false };
const voiceMode = () => localStorage.getItem("voiceMode") === "1";   // 말하면 자동 전송 + 답 읽어주기

// 녹음(webm 등)을 16kHz 모노 WAV로 변환 → 서버가 추가 프로그램 없이 읽을 수 있게
async function toWav16k(blob) {
  const ctx = new AudioContext();
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * 16000)), 16000);
  const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

async function startRec() {
  try { voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast("마이크를 쓸 수 없어요. 브라우저 주소창 옆에서 마이크 권한을 허용해주세요."); }
  voice.chunks = [];
  voice.rec = new MediaRecorder(voice.stream);
  voice.rec.ondataavailable = e => e.data.size && voice.chunks.push(e.data);
  voice.rec.onstop = finishRec;
  voice.rec.start();
  $("#micBtn").classList.add("rec"); $("#micBtn").title = "녹음 중 — 다시 누르면 끝";
  speechSynthesis.cancel();   // 말하는 중이면 읽어주기 멈춤
}
function stopRec() {
  voice.rec?.stop(); voice.stream?.getTracks().forEach(t => t.stop());
  $("#micBtn").classList.remove("rec");
}
async function finishRec() {
  voice.busy = true; $("#micBtn").classList.add("wait"); $("#micBtn").title = "알아듣는 중…";
  try {
    const wav = await toWav16k(new Blob(voice.chunks, { type: voice.rec.mimeType }));
    const r = await api("/api/voice/transcribe", { method: "POST", body: wav, headers: { "Content-Type": "audio/wav" } });
    const { text } = await r.json();
    if (!text) return toast("말소리를 못 들었어요. 마이크에 조금 더 가까이 말해보세요.");
    const box = $("#input");
    box.value = (box.value ? box.value.trimEnd() + " " : "") + text;
    box.dispatchEvent(new Event("input"));
    if (voiceMode() && !state.busy) send(); else box.focus();
  } catch (e) { toast(e.message || "음성 인식 실패"); }
  finally { voice.busy = false; $("#micBtn").classList.remove("wait"); $("#micBtn").title = "눌러서 말하기 · 다시 누르면 끝"; }
}
$("#micBtn").onclick = () => {
  if (voice.busy) return;
  if (!window.MediaRecorder) return toast("이 브라우저는 녹음을 지원하지 않아요 (Chrome이나 Edge를 써주세요)");
  voice.rec?.state === "recording" ? stopRec() : startRec();
};

/* ═════════ 🔊 답 읽어주기 (Windows 기본 한국어 음성) ═════════ */
function speakable(md) {   // 코드·링크·기호를 빼서 자연스럽게 읽히게
  return md.replace(/```[\s\S]*?```/g, " 코드 부분은 생략할게요. ")
    .replace(/<[^>]+>/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[\d+\]/g, "")
    .replace(/https?:\/\/\S+/g, "").replace(/[#*_`>|~]/g, "").replace(/\$+/g, "").replace(/\s+/g, " ").trim();
}
function speak(text, btn) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  u.lang = "ko-KR";
  const ko = speechSynthesis.getVoices().find(v => v.lang?.startsWith("ko"));
  if (ko) u.voice = ko;
  if (btn) { btn.textContent = "■ 멈춤"; u.onend = u.onerror = () => btn.textContent = "🔊 읽기"; }
  speechSynthesis.speak(u);
}
window.featuresEnhance = root => {
  root.querySelectorAll(".ans .meta").forEach(meta => {
    if (meta.querySelector(".speak-btn") || !meta.textContent.trim()) return;
    const b = document.createElement("button"); b.className = "speak-btn"; b.textContent = "🔊 읽기";
    b.title = "답을 소리로 읽어주기";
    b.onclick = () => {
      if (speechSynthesis.speaking && b.textContent.startsWith("■")) { speechSynthesis.cancel(); b.textContent = "🔊 읽기"; return; }
      const card = meta.closest(".ans"); speak(card._text || card.querySelector(".body").innerText, b);
    };
    meta.append(b);
  });
};
window.onAnswerDone = r => { if (voiceMode() && r?.text && !r.error) speak(r.text); };

/* ═════════ 사용자 지정 스타일 ═════════ */
async function loadStyles() {
  const sel = $("#styleSel"), keep = localStorage.getItem("style") || "default";
  sel.querySelectorAll("[data-custom],[data-act]").forEach(o => o.remove());
  let list = [];
  try { list = await getJSON("/api/styles"); } catch {}
  if (list.length) {
    const g = document.createElement("optgroup"); g.label = "내 스타일"; g.dataset.custom = 1;
    list.forEach(s => g.append(new Option(s.name, "custom:" + s.id)));
    sel.append(g);
  }
  const make = new Option("＋ 내 글로 스타일 만들기…", "__make"); make.dataset.act = 1; sel.append(make);
  if (list.length) { const m = new Option("스타일 관리…", "__manage"); m.dataset.act = 1; sel.append(m); }
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : "default";
  state.customStyles = list;
}
$("#styleSel").addEventListener("change", async e => {
  const v = e.target.value;
  if (v === "__make" || v === "__manage") {
    e.target.value = localStorage.getItem("style") || "default";
    v === "__make" ? makeStyle() : manageStyles();
  }
});
async function makeStyle() {
  const v = await dialog("내 글로 스타일 만들기", `
    <p class="muted small" style="margin:0 0 8px">내가 쓴 글을 붙여넣으면 AI가 말투·문장 길이·자주 쓰는 표현을 분석해서, 앞으로 그 문체로 답해요. 글이 길수록 정확해요 (200자 이상).</p>
    <label for="stN">스타일 이름</label><input id="stN" maxlength="20" placeholder="예: 내 블로그 말투">
    <label for="stS">내가 쓴 글</label><textarea id="stS" rows="8" placeholder="블로그 글, 보고서, 친구에게 보낸 긴 메시지 등"></textarea>`,
    [{ label: "취소", value: null, kind: "ghost" }, { label: "분석해서 만들기", value: "ok" }]);
  if (!v) return;
  toast("문체를 분석하는 중… (AI가 읽는 데 잠깐 걸려요)");
  try {
    const s = await sendJSON("/api/styles", "POST", { name: $("#stN").value, sample: $("#stS").value });
    await loadStyles(); $("#styleSel").value = "custom:" + s.id; localStorage.setItem("style", "custom:" + s.id);
    const ok = await dialog(`스타일 "${esc(s.name)}" 완성`, `<p class="muted small" style="margin:0 0 6px">AI가 분석한 문체예요. 고쳐도 돼요.</p>
      <textarea id="stD" rows="9">${esc(s.description)}</textarea>`, [{ label: "닫기", value: null, kind: "ghost" }, { label: "저장", value: "ok" }]);
    if (ok) await sendJSON(`/api/styles/${s.id}`, "PUT", { name: s.name, description: $("#stD").value });
  } catch (e) { toast(e.message); }
}
async function manageStyles() {
  const list = await getJSON("/api/styles");
  const v = await dialog("내 스타일 관리", list.map(s => `<div class="mem-row"><b>${esc(s.name)}</b>
      <textarea class="st-desc" data-id="${s.id}" rows="4">${esc(s.description)}</textarea>
      <button class="btn ghost chip" data-del-style="${s.id}">삭제</button></div>`).join(""),
    [{ label: "닫기", value: null, kind: "ghost" }, { label: "저장", value: "ok" }],
    () => document.querySelectorAll("[data-del-style]").forEach(b => b.onclick = async () => {
      await api(`/api/styles/${b.dataset.delStyle}`, { method: "DELETE" }); b.closest(".mem-row").remove(); toast("삭제했어요");
    }));
  if (v) for (const ta of document.querySelectorAll(".st-desc")) {
    const s = list.find(x => x.id === ta.dataset.id);
    if (s && ta.value !== s.description) await sendJSON(`/api/styles/${s.id}`, "PUT", { name: s.name, description: ta.value });
  }
  loadStyles();
}

/* ═════════ 전체 기억 관리 ═════════ */
async function openMemory() {
  const draw = async () => {
    const { items } = await getJSON("/api/memory");
    $("#memBox").innerHTML = items.length ? items.map(m => `<div class="mem-row" data-id="${m.id}">
        <input class="mem-text" value="${esc(m.text)}"><button class="icon-btn" data-mdel aria-label="지우기">✕</button></div>`).join("")
      : `<p class="muted small" style="margin:0">아직 기억이 없어요. 대화에서 "기억해: …"라고 말하거나 답변 아래 🧠를 눌러보세요.</p>`;
    $("#memBox").querySelectorAll("[data-mdel]").forEach(b => b.onclick = async () => {
      await api(`/api/memory/${b.closest(".mem-row").dataset.id}`, { method: "DELETE" }); draw(); });
    $("#memBox").querySelectorAll(".mem-text").forEach(inp => inp.onchange = () =>
      sendJSON(`/api/memory/${inp.closest(".mem-row").dataset.id}`, "PUT", { text: inp.value }));
  };
  await dialog("기억 관리", `<p class="muted small" style="margin:0 0 8px">모든 대화에서 AI가 참고하는 나에 대한 기억이에요. 이 컴퓨터에만 저장돼요 (API 모델을 쓰면 질문과 함께 그 회사로 전달돼요). 칸을 고치면 바로 저장돼요.</p>
    <div id="memBox"></div><div class="actions"><input class="sm" id="memNew" placeholder="직접 추가" style="flex:1"><button class="btn ghost" id="memAddBtn">추가</button></div>`,
    [{ label: "전부 지우기", value: "clear", kind: "danger", left: true }, { label: "닫기", value: null }],
    () => { draw(); $("#memAddBtn").onclick = async () => { const t = $("#memNew").value.trim(); if (t) { await sendJSON("/api/memory", "POST", { text: t }); $("#memNew").value = ""; draw(); } }; })
    .then(async v => { if (v === "clear" && await confirmBox("기억 전부 지우기", "모든 기억을 지울까요? 되돌릴 수 없어요.", "지우기", true)) { await api("/api/memory", { method: "DELETE" }); toast("기억을 모두 지웠어요"); } });
}

/* ═════════ 설정 화면에 새 항목 ═════════ */
new MutationObserver(() => {
  const box = document.getElementById("featSettings");
  if (!box || box.dataset.filled) return;
  box.dataset.filled = 1;
  const s = state.status?.settings || {};
  box.innerHTML = `
    <h3 class="set-h">기억 · 검색 · 음성</h3>
    <label class="check-row"><input type="checkbox" id="fMem" ${s.memory_enabled !== false ? "checked" : ""}> 전체 기억 — 모든 대화에서 나에 대한 기억을 참고</label>
    <button class="btn ghost chip" id="fMemBtn" type="button" style="margin:4px 0 10px">기억 관리…</button>
    <label class="check-row"><input type="checkbox" id="fWeb" ${s.web_search !== false ? "checked" : ""}> AI가 필요하면 스스로 웹 검색</label>
    <label for="fEng">검색 엔진</label>
    <select id="fEng">
      <option value="duckduckgo" ${(s.search_engine || "duckduckgo") === "duckduckgo" ? "selected" : ""}>DuckDuckGo (키 필요 없음, 기본)</option>
      <option value="wikipedia" ${s.search_engine === "wikipedia" ? "selected" : ""}>위키백과만 (개념·역사 질문에 정확)</option>
      <option value="brave" ${s.search_engine === "brave" ? "selected" : ""}>Brave Search (.env에 BRAVE_API_KEY 필요)</option></select>
    <label for="fWm">음성 인식 모델 <small>— 클수록 정확하지만 느림 (처음 쓸 때 한 번 내려받음)</small></label>
    <select id="fWm">${["tiny", "base", "small", "medium"].map(m => `<option ${(s.whisper_model || "small") === m ? "selected" : ""}>${m}</option>`).join("")}</select>
    <label for="fWords">음성 인식 단어 목록 <small>— 자주 쓰는 용어를 넣으면 정확해져요 (예: 비추력 → 안 넣으면 '비출력'으로 들림)</small></label>
    <textarea id="fWords" rows="2">${esc(s.voice_words || "")}</textarea>
    <label class="check-row"><input type="checkbox" id="fVm" ${voiceMode() ? "checked" : ""}> 음성 대화 모드 — 🎤로 말하면 바로 보내고, 답을 소리로 읽어줌</label>`;
  $("#fMemBtn").onclick = openMemory;
}).observe(document.body, { childList: true, subtree: true });

window.featSettingsValues = () => {
  if (!document.getElementById("fMem")) return {};
  localStorage.setItem("voiceMode", $("#fVm").checked ? "1" : "0");
  return { memory_enabled: $("#fMem").checked, web_search: $("#fWeb").checked, search_engine: $("#fEng").value,
           whisper_model: $("#fWm").value, voice_words: $("#fWords").value };
};

loadStyles();
speechSynthesis?.getVoices();   // 목소리 목록 미리 불러오기
