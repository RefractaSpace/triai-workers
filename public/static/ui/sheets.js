/* sheets.js — 설정 창: 일반 · 모델 · 기억 · 프리셋·스타일 · 모드 · 공유 링크 · 계정 */
"use strict";

const TABS = [["general", "일반"], ["models", "모델"], ["tools", "도구"], ["connections", "연결 (MCP)"], ["local", "로컬 모델"], ["agents", "에이전트 팀"], ["sensors", "센서 기기"], "-",
  ["memory", "기억"], ["presets", "프리셋·스타일"], ["modes", "모드"], "-", ["shares", "공유 링크"], ["account", "계정"]];

function openSettings(tab = "general") {
  const s = $("#sheet");
  s.innerHTML = `<div class="sh-head"><h2>설정</h2><button class="icon" data-close aria-label="닫기">${ICON.x}</button></div>
    <div class="sh-split"><nav class="sh-nav" aria-label="설정 메뉴">${TABS.map(t => t === "-" ? "<hr>" : `<button data-t="${t[0]}">${esc(t[1])}</button>`).join("")}</nav><div class="sh-body"></div></div>`;
  s.className = "sheet navd"; s.style.width = "";
  s.querySelector("[data-close]").onclick = () => s.close();
  s.addEventListener("close", () => { s.className = "sheet"; }, { once: true });
  if (!s.open) s.showModal();
  const go = t => {
    s.querySelectorAll(".sh-nav [data-t]").forEach(b => b.classList.toggle("on", b.dataset.t === t));
    const body = s.querySelector(".sh-body"); body.scrollTop = 0;
    body.innerHTML = `<div class="list-empty">불러오는 중…</div>`;
    PANES[t](body).catch(e => { body.innerHTML = `<div class="list-empty">${esc(e.message)}</div>`; });
  };
  s.querySelectorAll(".sh-nav [data-t]").forEach(b => b.onclick = () => go(b.dataset.t));
  go(TABS.some(t => t[0] === tab) ? tab : "general");
}
const row = (title, sub, ctrl) => `<div class="row"><div class="rt"><span>${title}</span>${sub ? `<small>${sub}</small>` : ""}</div>${ctrl}</div>`;

async function saveSettings(patch) {
  const s = await sendJSON("/api/settings", "PUT", { ...state.status.settings, ...patch });
  state.status.settings = s; setSpend(state.spent); return s;
}

const PANES = {
  /* ── 일반 ── */
  async general(el) {
    const st = state.status.settings;
    el.innerHTML = `
      <div class="group-t">AI에게 늘 주는 지시</div>
      <div class="group" style="padding:12px 14px"><textarea class="ta" id="sSys" rows="4">${esc(st.system)}</textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn small" id="sSysSave">저장</button></div></div>
      <div class="group-t">답</div>
      <div class="group">
        ${row("아티팩트", "웹페이지·도표·React 앱을 오른쪽 창에서 바로 실행", `<input type="checkbox" class="toggle" data-k="artifacts"${st.artifacts !== false ? " checked" : ""}>`)}
        ${row("기억 사용", "기억해 둔 것을 답할 때 활용", `<input type="checkbox" class="toggle" data-k="memory_enabled"${st.memory_enabled !== false ? " checked" : ""}>`)}
        ${row("최대 답 길이", "토큰 (한글 1자 ≈ 1~2 토큰)", `<input class="inp" type="number" min="256" max="131072" step="256" style="width:110px" data-n="max_tokens" value="${esc(st.max_tokens)}">`)}
        ${row("기억할 대화 길이", "이보다 길면 오래된 부분을 자동 요약 (글자 수)", `<input class="inp" type="number" min="2000" step="1000" style="width:110px" data-n="history_chars" value="${esc(st.history_chars)}">`)}
        ${row("웹 검색 엔진", "", `<select class="sel" data-s="search_engine">${[["duckduckgo", "DuckDuckGo"], ["brave", "Brave (키 필요)"], ["wikipedia", "위키백과"]].map(([v, n]) => `<option value="${v}"${st.search_engine === v ? " selected" : ""}>${n}</option>`).join("")}</select>`)}
      </div>
      <div class="group-t">비용</div>
      <div class="group">
        ${row("하루 한도", state.me?.limit ? `관리자가 정한 최대 $${(+state.me.limit).toFixed(2)}` : "넘으면 그날은 더 묻지 않아요", `<input class="inp" type="number" min="0" step="0.1" style="width:110px" data-n="daily_limit" value="${esc(st.daily_limit)}">`)}
        <div class="row"><div class="rt"><span>오늘 쓴 돈</span><div class="bar"><i id="spBar"></i></div></div><span class="rv">${fmtUsd(state.spent || 0) || "$0"}</span></div>
      </div>`;
    const pct = Math.min(100, (state.spent || 0) / (+st.daily_limit || 1) * 100);
    $("#spBar", el).style.width = pct + "%"; $("#spBar", el).classList.toggle("warn", pct > 80);
    $("#sSysSave", el).onclick = async () => { try { await saveSettings({ system: $("#sSys", el).value }); toast("저장했어요"); } catch (e) { fail(e); } };
    el.querySelectorAll("[data-k]").forEach(i => i.onchange = () => saveSettings({ [i.dataset.k]: i.checked }).then(() => toast("저장했어요")).catch(fail));
    el.querySelectorAll("[data-n]").forEach(i => i.onchange = () => saveSettings({ [i.dataset.n]: Number(i.value) }).then(s => { i.value = s[i.dataset.n]; toast("저장했어요"); }).catch(fail));
    el.querySelectorAll("[data-s]").forEach(i => i.onchange = () => saveSettings({ [i.dataset.s]: i.value }).then(() => toast("저장했어요")).catch(fail));
  },

  /* ── 모델 ── */
  async models(el) {
    el.innerHTML = `<p class="small muted" style="margin:0 0 14px">AI마다 쓸 모델을 골라요. 이 기기에만 저장돼요. 비싼 모델일수록 똑똑하지만 비용이 커요.</p><div class="group" id="mList"></div>`;
    const box = $("#mList", el);
    box.innerHTML = CHAT_PROVS.map(p => row(`<i class="dot ${p}" style="margin-right:8px"></i>${PROV[p].name}`, hasKey(p) ? `기본: ${esc(state.status.defaults[p])}` : "API 키 없음 — 관리자가 비밀값을 넣어야 해요",
      `<select class="sel" data-p="${p}"${hasKey(p) ? "" : " disabled"}><option>${esc(modelOf(p))}</option></select>`)).join("");
    await Promise.all(CHAT_PROVS.filter(hasKey).map(async p => {
      let list = []; try { list = await getJSON(`/api/models/${p}`); } catch {}
      const sel = box.querySelector(`[data-p="${p}"]`), cur = modelOf(p);
      if (!list.includes(cur)) list.unshift(cur);
      sel.innerHTML = list.map(m => `<option${m === cur ? " selected" : ""}>${esc(m)}</option>`).join("");
      sel.onchange = () => { state.models[p] = sel.value === state.status.defaults[p] ? undefined : sel.value; store.set("models", state.models); toast(`${PROV[p].name}: ${sel.value}`); paintPick(); };
    }));
  },

  /* ── 도구 (답 중간에 AI가 쓰는 것) ── */
  async tools(el) {
    const st = state.status.settings;
    el.innerHTML = `<h3>도구</h3><p class="lead">AI가 답을 쓰다가 필요하면 직접 쓰는 도구예요. 쓸 때마다 답 안에 기록이 남아요.</p>
      <div class="group">
        ${row("코드 실행", "계산·그래프를 파이썬으로 직접 돌려서 확인 — 이 기기 브라우저 안의 격리 상자에서 (인터넷·내 파일 접근 불가)", `<input type="checkbox" class="toggle" data-k="code_tool"${st.code_tool !== false ? " checked" : ""}>`)}
        ${row("답 중간 웹 검색", "모르는 것·최신 정보를 AI가 스스로 검색하고 페이지를 읽음 (무료)", `<input type="checkbox" class="toggle" data-k="web_search"${st.web_search !== false ? " checked" : ""}>`)}
        ${row("그림 만들기", hasKey("cf") ? "Cloudflare 무료 한도에서 그림 생성 (FLUX)" : "Cloudflare 비밀값이 있어야 해요", `<input type="checkbox" class="toggle" data-k="image_tool"${st.image_tool ? " checked" : ""}${hasKey("cf") ? "" : " disabled"}>`)}
      </div>
      <div class="group-t">내 컴퓨터 도구</div>
      <div class="group">${APP
        ? row("윈도우 TriAI 앱에서 열었어요 <span class='tag ok'>켜짐</span>", "연결한 폴더 읽기·찾기, 파일 쓰기·명령 실행(매번 허락), 화면 캡처, 내 컴퓨터의 MCP를 AI가 쓸 수 있어요", APP.openDeviceSettings ? `<button class="btn small" id="devSet">기기 설정</button>` : "")
        : row("이 창에서는 꺼져 있어요 <span class='tag'>브라우저</span>", "윈도우 TriAI 앱으로 이 주소를 열면 켜져요. 실제 실행은 늘 내 앞의 앱이 하고, 쓰기·명령은 앱이 허락을 받아요.", "")}</div>
      <div class="row small muted" style="padding:0 4px">코드 실행 상자는 처음 쓸 때 파이썬(약 10MB)을 내려받아서 10초쯤 걸려요.</div>`;
    el.querySelectorAll("[data-k]").forEach(i => i.onchange = () => saveSettings({ [i.dataset.k]: i.checked }).then(() => toast("저장했어요")).catch(fail));
    $("#devSet", el)?.addEventListener("click", () => APP.openDeviceSettings());
  },

  /* ── 연결 (원격 MCP) ── */
  async connections(el) {
    const { servers, presets } = await getJSON("/api/mcp");
    el.innerHTML = `<h3>연결</h3><p class="lead">깃허브 같은 앱을 연결하면 AI가 그 앱의 도구를 써요 (MCP). 바꾸는 도구(쓰기)는 '쓰기 허용'을 켠 연결에서만 돼요. 토큰은 암호화해서 저장하고 다시 보여주지 않아요.</p>
      <div class="group" id="mcpList">${servers.length ? servers.map(sv => `<div class="row" data-id="${esc(sv.id)}"><div class="rt"><span>${esc(sv.name)}${sv.error ? ` <span class="tag bad">오류</span>` : sv.tools.length ? ` <span class="tag ok">도구 ${sv.tools.length}개</span>` : ""}</span>
        <small>${esc(sv.url)}${sv.error ? " — " + esc(sv.error) : ""}</small></div>
        <label class="small muted" style="display:flex;align-items:center;gap:6px">쓰기 허용<input type="checkbox" class="toggle" data-w${sv.allow_write ? " checked" : ""}></label>
        <label class="small muted" style="display:flex;align-items:center;gap:6px">사용<input type="checkbox" class="toggle" data-on${sv.on ? " checked" : ""}></label>
        <button class="icon" data-more aria-label="${esc(sv.name)} 메뉴">${ICON.more}</button></div>`).join("") : `<div class="list-empty">아직 연결한 앱이 없어요</div>`}</div>
      <details class="group" style="padding:12px 14px"${servers.length ? "" : " open"}><summary style="cursor:pointer;font-weight:550">새로 연결하기</summary>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0">${Object.entries(presets).map(([k, p]) => `<button class="btn small" data-preset="${esc(k)}">${esc(p.name)}</button>`).join("")}</div>
        <label class="small" style="display:block">이름<input class="inp" id="mName" style="width:100%" placeholder="예) 깃허브"></label>
        <label class="small" style="display:block;margin-top:8px">주소 (https)<input class="inp" id="mUrl" style="width:100%" placeholder="https://…/mcp"></label>
        <label class="small" style="display:block;margin-top:8px">토큰 (필요할 때만)<input class="inp" id="mTok" type="password" autocomplete="off" style="width:100%"></label>
        <p class="small muted" id="mHelp" style="margin:8px 0 0"></p>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn primary small" id="mAdd">연결</button></div></details>`;
    el.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => { const p = presets[b.dataset.preset]; $("#mName", el).value = p.name; $("#mUrl", el).value = p.url; $("#mHelp", el).textContent = p.help; $("#mTok", el).focus(); });
    $("#mAdd", el).onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "연결하는 중…";
      try { const sv = await sendJSON("/api/mcp", "POST", { name: $("#mName", el).value, url: $("#mUrl", el).value, token: $("#mTok", el).value }); toast(sv.error ? "저장했지만 연결에 실패했어요: " + sv.error : `연결했어요 — 도구 ${sv.tools.length}개`, 5000); PANES.connections(el); }
      catch (err) { fail(err); b.disabled = false; b.textContent = "연결"; }
    };
    for (const r of el.querySelectorAll("#mcpList .row[data-id]")) {
      const id = r.dataset.id, sv = servers.find(x => x.id === id);
      r.querySelector("[data-on]").onchange = ev => sendJSON(`/api/mcp/${id}`, "PATCH", { on: ev.target.checked }).catch(fail);
      r.querySelector("[data-w]").onchange = async ev => {
        if (ev.target.checked && !await ask("쓰기 허용", { msg: `'${esc(sv.name)}'에서 AI가 무언가를 바꾸는 도구(글 쓰기·지우기 등)도 쓸 수 있게 할까요? AI는 사용자가 분명히 원할 때만 쓰도록 안내받지만, 실수할 수 있어요.`, ok: "허용" })) { ev.target.checked = false; return; }
        sendJSON(`/api/mcp/${id}`, "PATCH", { allow_write: ev.target.checked }).catch(fail);
      };
      r.querySelector("[data-more]").onclick = ev => openMenu(ev.currentTarget, [
        { label: "다시 연결 · 도구 새로 받기", act: async () => { try { const x = await sendJSON(`/api/mcp/${id}/refresh`, "POST", {}); toast(`도구 ${x.tools.length}개`); } catch (e2) { fail(e2); } PANES.connections(el); } },
        { label: "도구 목록 보기", act: () => openMenu(r, [{ head: `${sv.name} 도구` }, ...sv.tools.slice(0, 60).map(t => ({ label: t.name + (t.read_only ? "" : " (쓰기)"), sub: t.description, act: () => {} }))], { align: "end" }) },
        { label: "토큰 바꾸기", act: async () => { const v = await ask("토큰 바꾸기", { input: "새 토큰 (비우면 토큰 없이)", ok: "저장" }); if (v == null) return; try { await sendJSON(`/api/mcp/${id}`, "PATCH", { token: v }); toast("바꿨어요"); } catch (e2) { fail(e2); } } },
        "-",
        { label: "연결 끊기", danger: true, act: async () => { try { await sendJSON(`/api/mcp/${id}`, "DELETE"); PANES.connections(el); } catch (e2) { fail(e2); } } },
      ], { align: "end" });
    }
  },

  /* ── 로컬 모델 ── */
  async local(el) {
    el.innerHTML = `<h3>로컬 모델</h3><p class="lead">내 컴퓨터에서 도는 무료 AI예요. Cloudflare 서버는 내 컴퓨터에 닿을 수 없어서, <b>모델이 깔린 그 컴퓨터에서 TriAI를 열었을 때만</b> 써요. 이 브라우저가 직접 연결하고, 답은 대화에 저장돼요.</p>
      <div class="group">
        ${row("로컬 모델 쓰기", "켜면 AI 고르기 메뉴에 내 컴퓨터의 모델이 나와요 (이 기기에만 저장)", `<input type="checkbox" class="toggle" id="lOn"${localOn() ? " checked" : ""}>`)}
        ${row("Ollama 주소", "", `<select class="sel" id="lOl">${["http://localhost:11434", "http://127.0.0.1:11434"].map(u => `<option${LOCAL_SRC.ollama.url() === u ? " selected" : ""}>${u}</option>`).join("")}</select>`)}
        ${row("LM Studio 주소", "", `<select class="sel" id="lLm">${["http://localhost:1234", "http://127.0.0.1:1234"].map(u => `<option${LOCAL_SRC.lms.url() === u ? " selected" : ""}>${u}</option>`).join("")}</select>`)}
        <div class="row"><div class="rt"><span>찾은 모델</span><small id="lFound">아직 찾지 않았어요</small></div><button class="btn small" id="lFind">찾기</button></div>
      </div>
      <div class="group-t">처음 한 번 준비</div>
      <div class="group" style="padding:12px 16px"><ol class="steps">
        <li><b>Ollama</b>: 이 사이트에서 연결을 허락해야 해요. 윈도우 검색 → '시스템 환경 변수 편집' → 환경 변수 → 새로 만들기: 이름 <code>OLLAMA_ORIGINS</code>, 값 <code>${esc(location.origin)}</code> → Ollama 다시 켜기</li>
        <li><b>LM Studio</b>: Developer → 서버 켜기 → 설정에서 <b>Enable CORS</b> 켜기</li>
        <li>크롬이 '로컬 네트워크 접근'을 물으면 <b>허용</b></li>
      </ol></div>`;
    $("#lOn", el).onchange = e => { store.set("localOn", e.target.checked); if (e.target.checked) listLocal().then(paintFound); };
    $("#lOl", el).onchange = e => store.set("ollamaUrl", e.target.value);
    $("#lLm", el).onchange = e => store.set("lmsUrl", e.target.value);
    const paintFound = ({ models, errs }) => { const f = $("#lFound", el); if (f) f.textContent = models.length ? models.map(m => m.name).join(", ") : "못 찾았어요 — " + errs.join(" · "); };
    $("#lFind", el).onclick = async e => { const b = e.currentTarget; b.textContent = "찾는 중…"; paintFound(await listLocal()); b.textContent = "다시 찾기"; };
    if (state.localModels?.length) paintFound({ models: state.localModels, errs: [] });
  },

  /* ── 에이전트 팀 ── */
  async agents(el) {
    const st = state.status.settings, r = await getJSON("/api/agents");
    const cur = modelOf("agent") || "Commander";
    el.innerHTML = `<h3>에이전트 팀</h3><p class="lead">Claude Console에서 만든 에이전트 팀에게 일을 맡겨요. 대화마다 Console 세션이 하나 생기고, 질문당 예산에 닿으면 바로 멈춰요. 비쌀 수 있어서 자동·비교에는 안 들어가요.</p>
      ${r.error ? `<div class="a-err" style="margin-bottom:14px">${esc(r.error)}</div>` : ""}
      <div class="group">
        ${row("쓸 에이전트", "", `<select class="sel" id="agPick">${(r.agents.length ? r.agents : [{ name: cur, model: "", description: "" }]).map(a => `<option value="${esc(a.name)}"${a.name === cur ? " selected" : ""}>${esc(a.name)}${a.model ? " · " + esc(a.model) : ""}</option>`).join("")}</select>`)}
        ${row("일할 환경", "에이전트가 코드를 돌리는 곳 (인터넷이 제한된 쪽 추천)", `<select class="sel" id="agEnv"><option value="">자동 (safe-limited 먼저)</option>${r.envs.map(e => `<option value="${esc(e.name)}"${st.agent_env === e.name ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select>`)}
        ${row("질문당 예산", r.cap != null ? `오늘 남은 예산을 넘지 않아요 — 지금 최대 $${(+r.cap).toFixed(2)}` : "", `<input class="inp" type="number" min="0.1" max="50" step="0.5" style="width:100px" id="agBud" value="${esc(st.agent_budget ?? 2)}">`)}
      </div>`;
    $("#agPick", el).onchange = e => { state.models.agent = e.target.value; store.set("models", state.models); paintPick(); toast("에이전트: " + e.target.value); };
    $("#agEnv", el).onchange = e => saveSettings({ agent_env: e.target.value }).then(() => toast("저장했어요")).catch(fail);
    $("#agBud", el).onchange = e => saveSettings({ agent_budget: Math.max(0.1, Number(e.target.value) || 2) }).then(() => { toast("저장했어요"); paintPick(); }).catch(fail);
  },

  /* ── 센서 기기 (ESP32) ── */
  async sensors(el) {
    const { devices, fw } = await getJSON("/api/sensors");
    el.innerHTML = `<h3>센서 기기</h3><p class="lead">ESP32 집 센서를 TriAI에 연결해요. 기기마다 열쇠가 하나씩 있고, 열쇠는 만들 때 한 번만 보여줘요 (잃어버리면 '새 열쇠').</p>
      <div class="group" id="snDevs">${devices.length ? devices.map(d => row(esc(d.name), `${esc(sensorAgo(d.last_seen))}${d.fw ? " · 펌웨어 " + esc(d.fw) : ""} · id ${esc(d.id)}`, `<button class="icon" data-more="${esc(d.id)}" aria-label="${esc(d.name)} 메뉴">${ICON.more}</button>`)).join("")
        : `<div class="list-empty">아직 없어요</div>`}</div>
      <div class="group" style="display:flex;gap:8px;padding:10px;border:1px solid var(--line)"><input class="inp" id="snName" style="flex:1" placeholder="새 기기 이름 (예: 내 방)" maxlength="30"><button class="btn primary" id="snNew">추가</button></div>
      <div id="snKey"></div>
      ${state.me.admin ? `<div class="group-t" style="margin-top:22px">무선 업데이트 (관리자)</div>
      <div class="group" style="padding:12px 16px">
        <p class="small muted" style="margin:0 0 10px">아두이노 IDE → 스케치 → <b>컴파일된 바이너리 내보내기</b> → 생긴 <code>.ino.bin</code>을 올리면, 버전이 낮은 센서들이 다음 연락(1분 안)에 스스로 받아서 바꿔요. MD5로 파일이 온전한지 확인해요.</p>
        <p class="small" style="margin:0 0 10px">지금 올라간 펌웨어: ${fw ? `<b>${esc(fw.version)}</b> · ${(fw.size / 1024).toFixed(0)}KB · ${esc(fw.time)}` : "없음"}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="inp" id="fwVer" placeholder="버전 (예: 1.0.1)" style="width:140px"><input type="file" id="fwFile" accept=".bin" class="inp" style="flex:1;min-width:180px"><button class="btn primary" id="fwUp">올리기</button></div>
      </div>` : ""}`;
    const showKey = (name, key) => {
      $("#snKey", el).innerHTML = `<div class="group" style="padding:12px 16px;border-color:var(--accent)"><b>'${esc(name)}' 열쇠 — 지금만 보여요</b>
        <p class="small muted" style="margin:6px 0 0">펌웨어 폴더의 <code>config.h</code>에 아래 두 줄을 붙여 넣으세요.</p>
        <div class="keybox" id="snCfg">#define TRIAI_HOST  "${esc(location.host)}"\n#define DEVICE_KEY  "${esc(key)}"</div>
        <button class="btn small" id="snCopy">복사</button></div>`;
      $("#snCopy", el).onclick = () => copyText($("#snCfg", el).textContent, "복사했어요");
    };
    $("#snNew", el).onclick = async () => {
      try { const r = await sendJSON("/api/sensors", "POST", { name: $("#snName", el).value }); await PANES.sensors(el); showKey(r.name, r.key); } catch (e) { fail(e); }
    };
    el.querySelectorAll("[data-more]").forEach(b => b.onclick = () => {
      const d = devices.find(x => x.id === b.dataset.more);
      openMenu(b, [
        { label: "이름 바꾸기", act: async () => { const v = await ask("이름 바꾸기", { input: "이름", value: d.name, ok: "저장" }); if (!v) return; try { await sendJSON(`/api/sensors/${d.id}`, "PATCH", { name: v }); PANES.sensors(el); } catch (e) { fail(e); } } },
        { label: "새 열쇠 만들기", sub: "옛 열쇠는 바로 못 씀", act: async () => { if (!await ask("새 열쇠", { msg: "기기에 넣은 옛 열쇠는 바로 막혀요. 펌웨어의 열쇠를 바꿔서 다시 올려야 해요.", ok: "새로 만들기" })) return; try { const r = await sendJSON(`/api/sensors/${d.id}/rekey`, "POST", {}); showKey(d.name, r.key); } catch (e) { fail(e); } } },
        "-",
        { label: "삭제 (기록도 지움)", danger: true, act: async () => { if (!await ask("센서 기기 삭제", { msg: `'${esc(d.name)}'와 모든 기록을 지울까요?`, ok: "삭제", danger: true })) return; try { await sendJSON(`/api/sensors/${d.id}`, "DELETE"); PANES.sensors(el); } catch (e) { fail(e); } } },
      ], { align: "end" });
    });
    $("#fwUp", el)?.addEventListener("click", async e => {
      const f = $("#fwFile", el).files[0], v = $("#fwVer", el).value.trim(), b = e.currentTarget;
      if (!f || !v) return toast("버전과 .bin 파일을 모두 골라 주세요");
      b.disabled = true; b.textContent = "올리는 중…";
      try {
        const buf = new Uint8Array(await f.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const m = await sendJSON("/api/admin/firmware", "POST", { version: v, b64: btoa(bin) }); toast(`펌웨어 ${m.version} 올림 — 센서들이 1분 안에 받아요`); PANES.sensors(el);
      } catch (err) { fail(err); b.disabled = false; b.textContent = "올리기"; }
    });
  },

  /* ── 기억 ── */
  async memory(el) {
    const m = await getJSON("/api/memory");
    el.innerHTML = `<p class="small muted" style="margin:0 0 14px">AI가 나에 대해 기억하는 것이에요. 대화에서 "기억해: …"라고 말해도 여기에 들어가요.${m.enabled ? "" : " <b>지금은 기억 사용이 꺼져 있어요 (일반 탭).</b>"}</p>
      <div class="group" style="display:flex;gap:8px;padding:10px;border:1px solid var(--line)"><input class="inp" id="memIn" style="flex:1" placeholder="예) 답은 중학생도 이해할 수 있게 설명해 줘"><button class="btn primary" id="memAdd">추가</button></div>
      <div class="group" id="memList"></div>
      ${m.items.length ? `<button class="btn danger small" id="memClear">전부 지우기</button>` : ""}`;
    const list = $("#memList", el);
    list.innerHTML = m.items.length ? m.items.slice().reverse().map(x => `<div class="row" data-id="${esc(x.id)}"><div class="rt"><span>${esc(x.text)}</span><small>${esc(dayGroup(x.time))}${x.source === "said" ? " · 대화에서" : ""}</small></div>
      <button class="icon" data-edit aria-label="고치기">${ICON.edit}</button><button class="icon" data-del aria-label="지우기">${ICON.trash}</button></div>`).join("")
      : `<div class="list-empty">아직 기억하는 게 없어요</div>`;
    const add = async () => { const v = $("#memIn", el).value.trim(); if (!v) return; try { await sendJSON("/api/memory", "POST", { text: v }); PANES.memory(el); } catch (e) { fail(e); } };
    $("#memAdd", el).onclick = add; $("#memIn", el).onkeydown = e => { if (e.key === "Enter" && !e.isComposing) add(); };
    list.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { try { await sendJSON(`/api/memory/${b.closest(".row").dataset.id}`, "DELETE"); PANES.memory(el); } catch (e) { fail(e); } });
    list.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
      const r = b.closest(".row"), it = m.items.find(x => x.id === r.dataset.id);
      r.innerHTML = `<input class="inp" style="flex:1" value="${esc(it.text)}"><button class="btn small primary">저장</button>`;
      const inp = r.querySelector("input"); inp.focus();
      const save = async () => { try { await sendJSON(`/api/memory/${it.id}`, "PUT", { text: inp.value }); PANES.memory(el); } catch (e) { fail(e); } };
      r.querySelector("button").onclick = save; inp.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) save(); };
    });
    $("#memClear", el)?.addEventListener("click", async () => {
      if (!await ask("기억 전부 지우기", { msg: "기억한 것을 모두 지울까요? 되돌릴 수 없어요.", ok: "전부 지우기", danger: true })) return;
      try { await sendJSON("/api/memory", "DELETE"); } catch (e) { fail(e); } PANES.memory(el);
    });
  },

  /* ── 프리셋 · 스타일 ── */
  async presets(el) {
    [state.presets, state.styles] = await Promise.all([getJSON("/api/presets"), getJSON("/api/styles")]);
    el.innerHTML = `<div class="group-t">프리셋 — 답의 '성격' (창의성·정확도)</div>
      <div class="group">${state.presets.map(p => row(esc(p.name) + (p.builtin ? ` <small class="muted">기본</small>` : ""), esc(p.desc || presetDesc(p)),
        p.builtin ? "" : `<button class="icon" data-delp="${esc(p.id)}" aria-label="지우기">${ICON.trash}</button>`)).join("")}</div>
      <details class="group" style="padding:12px 14px"><summary style="cursor:pointer;font-weight:550">새 프리셋 만들기</summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:12px">
          <label class="small">이름<input class="inp" id="pName" style="width:100%"></label>
          <label class="small">창의성 (temperature 0~2)<input class="inp" id="pTemp" type="number" step="0.1" min="0" max="2" style="width:100%" placeholder="예) 0.7"></label>
          <label class="small">top_p (0~1)<input class="inp" id="pTopP" type="number" step="0.05" min="0" max="1" style="width:100%"></label>
          <label class="small">설명<input class="inp" id="pDesc" style="width:100%"></label>
        </div><div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn primary small" id="pSave">만들기</button></div></details>
      <div class="group-t" style="margin-top:22px">내 문체 스타일 — 내가 쓴 글을 분석해서 그 문체로 답하게</div>
      <div class="group">${state.styles.length ? state.styles.map(s => row(esc(s.name), esc((s.description || "").slice(0, 80)), `<button class="icon" data-dels="${esc(s.id)}" aria-label="지우기">${ICON.trash}</button>`)).join("") : `<div class="list-empty">아직 없어요</div>`}</div>
      <details class="group" style="padding:12px 14px"><summary style="cursor:pointer;font-weight:550">새 스타일 만들기</summary>
        <label class="small" style="display:block;margin-top:12px">이름<input class="inp" id="stName" style="width:100%"></label>
        <label class="small" style="display:block;margin-top:10px">내가 쓴 글 (200자 이상 — 길수록 정확)<textarea class="ta" id="stSample" rows="6"></textarea></label>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn primary small" id="stSave">분석해서 만들기</button></div></details>`;
    $("#pSave", el).onclick = async () => {
      try { await sendJSON("/api/presets", "POST", { name: $("#pName", el).value, desc: $("#pDesc", el).value, temperature: $("#pTemp", el).value, top_p: $("#pTopP", el).value }); toast("만들었어요"); PANES.presets(el); } catch (e) { fail(e); }
    };
    el.querySelectorAll("[data-delp]").forEach(b => b.onclick = async () => { try { await sendJSON(`/api/presets/${b.dataset.delp}`, "DELETE"); if (state.preset === b.dataset.delp) { state.preset = "default"; store.set("preset", "default"); paintPick(); } PANES.presets(el); } catch (e) { fail(e); } });
    $("#stSave", el).onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "분석하는 중…";
      try { await sendJSON("/api/styles", "POST", { name: $("#stName", el).value, sample: $("#stSample", el).value }); toast("스타일을 만들었어요 — 옵션에서 고를 수 있어요"); PANES.presets(el); }
      catch (err) { fail(err); b.disabled = false; b.textContent = "분석해서 만들기"; }
    };
    el.querySelectorAll("[data-dels]").forEach(b => b.onclick = async () => { try { await sendJSON(`/api/styles/${b.dataset.dels}`, "DELETE"); PANES.presets(el); } catch (e) { fail(e); } });
  },

  /* ── 모드 ── */
  async modes(el) {
    state.modes = await getJSON("/api/modes");
    el.innerHTML = `<p class="small muted" style="margin:0 0 14px">모드는 그 일에 맞는 모델·지시·검색을 한 번에 켜요. 입력창의 AI 버튼에서 고를 수 있어요.</p>
      <div class="group">${state.modes.map(m => row(`${m.icon} ${esc(m.name)}`, `${esc(m.desc)}<br>지금: ${esc(nameOf(m.provider))} · ${esc(m.model)}${m.available ? "" : " — <b>쓸 수 없음 (키 없음)</b>"}${m.web ? " · 웹 검색" : ""}`,
        `<button class="btn small" data-mode="${esc(m.id)}">모델 바꾸기</button>`)).join("")}</div>`;
    el.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
      const m = state.modes.find(x => x.id === b.dataset.mode);
      openMenu(b, [{ head: m.name + " 모드에 쓸 AI" }, { label: "기본값으로", act: () => setMode(m.id, { provider: "" }) },
        ...CHAT_PROVS.filter(hasKey).map(p => ({ label: PROV[p].name, sub: modelOf(p), icon: `<i class="dot ${p}"></i>`, on: m.chosen?.provider === p, act: () => setMode(m.id, { provider: p, model: modelOf(p) }) }))], { align: "end" });
    });
    async function setMode(id, body) { try { await sendJSON(`/api/modes/${id}`, "PUT", body); toast("바꿨어요"); PANES.modes(el); paintPick(); } catch (e) { fail(e); } }
  },

  /* ── 공유 링크 ── */
  async shares(el) {
    const list = await getJSON("/gw/share");
    el.innerHTML = `<p class="small muted" style="margin:0 0 14px">로그인 없이 누구나 볼 수 있게 만든 아티팩트 링크예요. 끊으면 그 주소는 바로 못 열어요.</p>
      <div class="group">${list.length ? list.map(x => row(esc(x.title), `${esc(dayGroup(x.created))} · 조회 ${x.views}회`,
        `<button class="btn small" data-copy="${esc(x.id)}">복사</button><button class="btn small danger" data-cut="${esc(x.id)}">끊기</button>`)).join("") : `<div class="list-empty">공유한 링크가 없어요</div>`}</div>`;
    el.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => copyText(location.origin + "/s/" + b.dataset.copy, "링크를 복사했어요"));
    el.querySelectorAll("[data-cut]").forEach(b => b.onclick = async () => { try { await sendJSON(`/gw/share/${b.dataset.cut}`, "DELETE"); PANES.shares(el); toast("링크를 끊었어요"); } catch (e) { fail(e); } });
  },

  /* ── 계정 ── */
  async account(el) {
    el.innerHTML = `<div class="group">
      ${row(`<b>${esc(state.me.user)}</b>`, state.me.admin ? "관리자" : "사용자", "")}
      ${row("비밀번호 바꾸기", "바꾸면 다른 기기는 모두 로그아웃돼요", `<a class="btn small" href="/gw/password">바꾸기</a>`)}
      ${state.me.admin ? row("관리", "사용자 추가·한도·감사 기록", `<a class="btn small" href="/gw/admin">열기</a>`) : ""}
      ${row("예전 화면", "새 화면에서 아직 없는 기능이 필요할 때", `<a class="btn small" href="/classic.html">열기</a>`)}
      ${row("로그아웃", "", `<a class="btn small danger" href="/gw/logout">로그아웃</a>`)}</div>
      <p class="small muted">TriAI는 Cloudflare 위에서 돌아가요. 대화는 내 계정의 데이터베이스에만 저장돼요.</p>`;
  },
};
const presetDesc = p => ["temperature", "top_p", "top_k", "format"].filter(k => p[k] != null).map(k => `${k} ${p[k]}`).join(" · ") || "모델 기본값";
