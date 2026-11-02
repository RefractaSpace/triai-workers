/* chat.ts — 질문 계획(분류·모델 선택·비용) → 여러 AI 동시 스트리밍 → 저장 (파이 chat.py + engine.py) */
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { hasKey, missingMsg, DEFAULT_MODELS } from "./env";
import * as P from "./providers";
import * as R from "./routing";
import { Conv, Turn, historyFor, trimHistory, withFiles, roughTokens, ownAnswer } from "./history";
import { Settings, addCost, allConvs, kvGet, loadConv, newId, nowIso, putUpload, getUpload, b64, settings as loadSettings, spentToday, updateConv } from "./db";
import { modeGet, modePick, presetParams, styleGet } from "./catalog";
import * as PJ from "./projects";
import * as S from "./search";
import { summarize } from "./compact";
import * as T from "./tools";
import * as M from "./mcp";
import * as AG from "./agents";
import * as SN from "./sensors";

export const ARTIFACT_HINT = `[아티팩트]
사용자가 웹페이지·계산기·게임·시뮬레이션 같은 인터랙티브한 것, 도표, 그림을 원하면 아티팩트로 만들어. 아티팩트는 답 안에 카드로 보이고 화면 옆 창에서 바로 실행돼. 종류:
- \`\`\`html : CSS·자바스크립트까지 들어 있는 완전한 HTML 한 파일. <title>에 짧은 이름을 꼭 써.
- \`\`\`jsx : React 컴포넌트 하나 (export default function 이름). React 훅은 import 없이 써도 되고, Tailwind 클래스를 쓸 수 있어. 첫 줄에 // title: 이름
- \`\`\`svg : 그림 (아이콘·도식). <title>에 이름.
- \`\`\`mermaid : 순서도·구조도·시퀀스·간트 같은 도표. 첫 줄에 %% title: 이름
규칙: 외부 이미지·API·인터넷은 못 써 (격리돼 있음) — 데이터는 코드 안에 넣어. 사용자가 고쳐 달라고 하면 같은 이름(<title>)으로 전체를 다시 써 (새 버전이 돼). 아티팩트 앞뒤 설명은 짧게.
[차트] 숫자 비교·변화를 보여줄 때는 아티팩트 대신 \`\`\`chart 블록에 JSON만 써 — 답 안에 바로 그려져: {"type":"line|bar|scatter","title":"제목","x":["1월","2월"],"series":[{"name":"이름","data":[1,2]}],"xlabel":"","ylabel":"","unit":"℃"} (scatter는 series마다 "points":[[x,y],…]). 시간 흐름=line, 항목 비교=bar, 두 숫자의 관계=scatter. 계열은 line·bar 8개, scatter 3개까지, y축은 하나만 (단위가 다른 두 값은 차트 두 개로). 원형 차트는 없어. 지어낸 숫자로 차트를 만들지 마.`;

const STYLES: Record<string, string> = {
  default: "", concise: "답변 스타일: 핵심만 짧게. 불필요한 서론·반복·마무리 인사 없이.",
  detailed: "답변 스타일: 자세하고 체계적으로. 근거와 예시, 주의할 점까지 포함.",
  beginner: "답변 스타일: 중학생도 이해할 수 있게. 어려운 용어는 쉬운 말과 비유로 먼저 풀고, 필요하면 단계별로.",
  formal: "답변 스타일: 보고서처럼 격식 있는 문체로.",
};

export type Target = { provider: string; model: string };
export type Attachment = { name: string; kind: string; content?: string; raw?: boolean };
export type ChatReq = { conv_id?: string | null; project_id?: string | null; text: string; targets: Target[]; auto?: boolean;
  replace_from?: number | null; attachments?: Attachment[]; style?: string; web?: boolean; deep?: boolean; mode?: string | null; preset?: string | null;
  device?: any; run?: boolean };

export type Job = { key: string; provider: string; model: string; messages: P.Msg[]; est_in: number; est_cost: number | null; dropped: number; deep: boolean; params?: Record<string, any> };
export type Plan = { conv: Conv; system: string; text: string; full: string; group: string; category: string; files: any[]; images: string[];
  image_ids: string[]; label: string; forced: boolean; route: any; jobs: Job[]; expected: number; trimmed: number; cls: any; web: boolean; mode: string | null; tools: T.ToolCfg; agentCap: number };

export type Ctx = { env: Env; user: string; s: Settings; later?: (p: Promise<unknown>) => void; allow?: Set<string> | null };
/** 이 사람이 이 AI를 쓸 수 있나 (키가 있고 + 관리자가 허락한 회사) */
export const can = (ctx: Ctx, p: string) => hasKey(ctx.env, p) && (!ctx.allow || ctx.allow.has(p));
const NOT_ALLOWED = "이 계정은 쓸 수 없는 AI예요 (관리자가 정한 범위 밖)";

export async function fullSystem(ctx: Ctx, style = "default", tools = false, projectId?: string | null): Promise<string> {
  let s = ctx.s.system;
  if (tools && ctx.s.artifacts !== false) s += "\n\n" + ARTIFACT_HINT;
  const mem = tools && ctx.s.memory_enabled !== false ? await kvGet<{ id: string; text: string }[]>(ctx.env, ctx.user, "memory", []) : [];
  if (mem.length) s += "\n\n<user_memory>\n사용자에 대해 기억하고 있는 것 (필요할 때만 자연스럽게 활용):\n" + mem.map(m => "- " + m.text).join("\n") + "\n</user_memory>";
  if ((style || "").startsWith("custom:")) { const cs = await styleGet(ctx.env, ctx.user, style.slice(7)); if (cs) s += `\n\n[답변 문체 — 아래 특징을 따라 써]\n${cs.description}`; }
  else if (STYLES[style || "default"]) s += "\n\n" + STYLES[style];
  if (tools) { const hs = await SN.summary(ctx.env, ctx.user).catch(() => ""); if (hs) s += "\n\n" + hs; }
  const pc = await PJ.context(ctx.env, ctx.user, projectId);
  if (pc) s += "\n\n" + pc;
  return s;
}

const chatProviders = (ts: Target[]) => ts.filter(t => t.provider in DEFAULT_MODELS || ((t.provider === "local" || t.provider === "agent") && String(t.model || "").trim()));

export async function planRequest(ctx: Ctx, req: ChatReq, preview = false): Promise<Plan> {
  const { env, user, s } = ctx;
  let conv: Conv;
  if (req.conv_id) conv = await loadConv(env, user, req.conv_id);
  else {
    const title = req.text.trim().replace(/\n/g, " ");
    conv = { id: newId(12), title: title.slice(0, 40) + (title.length > 40 ? "…" : ""), created: nowIso(), updated: nowIso(),
      project_id: req.project_id ?? null, bot_id: null, turns: [] };
  }
  if (req.replace_from != null) {
    if (!(req.replace_from >= 0 && req.replace_from <= conv.turns.length)) throw new HTTPException(400, { message: "잘못된 턴 번호" });
    conv = { ...conv, turns: conv.turns.slice(0, req.replace_from) };
  }
  if (!req.conv_id && req.project_id) await PJ.exists(env, user, req.project_id);
  let mode: Awaited<ReturnType<typeof modeGet>> | null = null;
  if (req.mode) {   // [+] 모드: 자동·비교를 끄고 그 모드의 모델 하나만, 웹·깊게는 모드 기본값을 더함
    mode = await modeGet(env, user, req.mode);
    const [prov, model] = await modePick(env, user, req.mode);
    if (ctx.allow && !ctx.allow.has(prov)) throw new HTTPException(403, { message: `'${mode.name}' 모드는 ${prov} AI를 써서 이 계정에서는 못 써요` });
    req = { ...req, auto: false, targets: [{ provider: prov, model }], web: req.web || mode.web, deep: req.deep || mode.deep };
  }
  const cats = await getCats(env, user);
  let system = await fullSystem(ctx, req.style, true, conv.project_id);
  if (mode) system += "\n\n" + mode.prompt;
  const tools = await toolCfg(ctx, req);
  system += T.hints(tools);
  const params = await presetParams(env, user, req.preset);
  const [text, forced] = R.parseTag(req.text, cats);
  const files = (req.attachments || []).filter(a => a.kind === "text")
    .map(a => ({ name: a.name.slice(0, 120), content: (a.content || "").replace(/\0/g, ""), ...(a.raw ? { raw: true } : {}) }));
  if ((req.attachments || []).some(a => a.kind === "pdf")) throw new HTTPException(400, { message: "서버 없는 TriAI는 PDF를 아직 못 읽어요 — 글자로 복사해서 붙여 주세요" });
  const refImgs: string[] = [], imageIds: string[] = [], newImgs: string[] = [];
  for (const a of req.attachments || []) {
    if (a.kind === "image" && a.content) newImgs.push(a.content);
    else if (a.kind === "image_ref" && a.content) {
      const u = await getUpload(env, user, a.content);
      if (u) { refImgs.push(b64(u.bytes)); imageIds.push(a.content); }
    }
  }
  const images = [...refImgs, ...newImgs].slice(0, 4);
  const total = files.reduce((n, f) => n + f.content.length, 0);
  if (total > 200_000) throw new HTTPException(400, { message: "첨부 파일이 너무 커요 (합계 20만 자까지)" });
  const full = withFiles(text, files);
  const [group, sub] = forced ?? R.classify(text, cats);
  const cls = { method: forced ? "tag" : "keyword", score: null, unsure: false };
  let outGuess = Math.min(Number(s.assumed_output), Number(s.max_tokens));
  if (req.deep) outGuess = Math.max(outGuess, 4000);

  let targets = chatProviders(req.targets || []);
  if ((req.auto || targets.length > 1) && await P.cfExhausted(env)) targets = targets.filter(t => t.provider !== "cf");
  if (ctx.allow && targets.length && !targets.some(t => ctx.allow!.has(t.provider))) throw new HTTPException(403, { message: NOT_ALLOWED });
  let pairs: [string, string][] = targets.filter(t => can(ctx, t.provider)).map(t => [t.provider, String(t.model || DEFAULT_MODELS[t.provider as keyof typeof DEFAULT_MODELS]).slice(0, 120)]);
  if (images.length) {
    pairs = pairs.filter(([p, m]) => P.canSee(p, m) || p === "local");
    if (!pairs.length) throw new HTTPException(400, { message: "이 모델은 이미지를 못 봐요. Claude·GPT·Gemini를 고르세요." });
  }
  const jobs: Record<string, Job> = {};
  for (const [prov, model] of pairs) {
    const key = R.answerKey(prov, model);
    if (key in jobs) continue;
    let limit = Number(s.history_chars);
    limit += conv.turns.flatMap(t => t.files || []).filter((f: any) => f.raw).reduce((n: number, f: any) => n + (f.content || "").length, 0);
    const [hist, dropped] = trimHistory(await historyFor(conv, key), limit);
    const last: P.Msg = { role: "user", content: full, ...(images.length ? { images } : {}) };
    const messages = [...hist, last];
    const tin = roughTokens(system + messages.map(m => m.content).join(""));
    jobs[key] = { key, provider: prov, model, messages, est_in: tin, est_cost: P.estimateCost(model, { in: tin, cached: 0, write: 0, out: outGuess }, prov), dropped, deep: !!req.deep, params };
  }
  if (!Object.keys(jobs).length) {
    const missing = (req.targets || []).map(t => t.provider).filter(p => !can(ctx, p));
    throw new HTTPException(400, { message: missing.length ? missingMsg(missing[0]) : "사용할 수 있는 AI가 없어요. 관리자가 API 키 비밀값을 넣어야 해요." });
  }
  let route: any = null, chosen = jobs;
  if (req.auto) {
    const pool = Object.fromEntries(Object.entries(jobs).filter(([, j]) => j.provider !== "local" && j.provider !== "agent"));   // 자동은 클라우드 AI 중에서만
    if (Object.keys(pool).length) chosen = pool;
    const stats = R.statsFromConvs(preview ? [] : await allConvs(env, user));
    const [pick, why] = R.choose(group, sub, Object.fromEntries(Object.entries(chosen).map(([k, j]) => [k, j.model])), stats,
      Object.fromEntries(Object.entries(chosen).map(([k, j]) => [k, j.est_cost])), cats, Number(s.explore_rate), `${req.conv_id || "new"}:${conv.turns.length}:${text}`);
    route = { provider: pick, reason: why + (forced ? " (#직접 지정)" : ""), switch: false };
    chosen = { [pick]: jobs[pick] };
  }
  const list = Object.values(chosen);
  return { conv, system, text, full, group, category: sub, files, images, image_ids: imageIds, label: R.label(cats, sub), forced: !!forced, route,
    jobs: list, expected: list.reduce((n, j) => n + (j.est_cost || 0), 0), trimmed: Math.max(...list.map(j => j.dropped)), cls, web: !!req.web, mode: req.mode ?? null,
    tools, agentCap: list.some(j => j.provider === "agent") ? await agentCap(ctx) : 0 };
}

export async function getCats(env: Env, user: string): Promise<R.Cat[]> {
  const c = await kvGet<any>(env, user, "categories", null);
  try { return c ? R.validate(c) : R.defaults(); } catch { return R.defaults(); }
}

export async function checkBudget(ctx: Ctx, expected = 0): Promise<void> {
  const lim = Number(ctx.s.daily_limit);
  if (!lim) return;
  const spent = await spentToday(ctx.env, ctx.user);
  if (spent >= lim) throw new HTTPException(402, { message: `오늘 예산 $${lim.toFixed(2)}를 다 썼어요. 설정에서 한도를 바꿀 수 있어요.` });
  if (spent + expected > lim) throw new HTTPException(402, { message: `이번 질문 예상 비용(약 $${expected.toFixed(4)})을 더하면 오늘 한도 $${lim.toFixed(2)}를 넘어요. 남은 금액 $${(lim - spent).toFixed(4)}.` });
}

// ── 여러 AI 동시에 부르기: 이벤트를 한 줄(ndjson)씩 내보냄 ──
async function* mockStream(_env: Env, model: string, messages: P.Msg[], _system: string, _max: number, o: P.GenOpts): AsyncGenerator<P.Ev> {
  const q = messages[messages.length - 1]?.content || "";
  let words: string[];
  if (/^\[(도구 결과|실행 결과|웹 검색|MCP|그림|웹페이지|도구 오류)/.test(q)) words = `[가짜 ${model}] 도구 결과를 받았어요: ${q.split("\n").slice(1).join(" ").slice(0, 60)} 끝.`.split(" ");
  else {
    words = `[가짜 ${model}] "${q.slice(0, 40)}"에 대한 답이에요. 지난 대화 ${(messages.length - 1) / 2}턴을 봤어요.`.split(" ");
    if (/아티팩트|html/i.test(q)) words.push("\n```html\n<!doctype html><title>가짜 페이지</title><h1>안녕</h1>\n```\n");
    if (/도구 테스트/.test(q)) words.push("\n```tool\n{\"name\": \"fs_list\", \"args\": {\"path\": \"C:/Users\"}}\n```\n", "이건 블록 뒤라서 안 보여야 해요");
    if (/코드 테스트/.test(q)) words.push("\n```run\nimport math\nprint(math.sqrt(2))\n```\n", "숨김");
    if (/검색 테스트/.test(q)) words.push("\n```search\n누리호 발사\n```\n", "숨김");
    if (/MCP 테스트/.test(q)) words.push("\n```mcp\n{\"server\": \"deepwiki\", \"tool\": \"read_wiki_structure\", \"args\": {\"repoName\": \"pyodide/pyodide\"}}\n```\n", "숨김");
    if (/센서 테스트/.test(q)) words.push("\n```sensor\n아무거나 24\n```\n", "숨김");
    if (/그림 테스트/.test(q)) words.push("\n```image\na rocket on a launch pad at sunset\n```\n", "숨김");
  }
  for (const w of words) { if (o.signal?.aborted) return; await new Promise(r => setTimeout(r, 15)); yield { t: "delta", d: w + " " }; }
  yield { t: "usage", u: { in: 100, cached: 0, write: 0, out: words.length } };
}

export type Emit = (ev: Record<string, unknown>) => void;
export type Result = { provider: string; model: string; text: string; thinking?: string; in: number; cached: number; write: number; out: number;
  cost: number | null; sec: number; error: string | null; stopped: boolean; estimated: boolean; ttft?: number; tps?: number;
  pending?: T.Pending; loop?: T.LoopMsg[]; rounds?: number };
export type RunJob = { key: string; provider: string; model: string; messages: P.Msg[]; deep?: boolean; params?: Record<string, any>; tools?: T.ToolCfg; extra?: Record<string, any> };
/** 이어 쓰기: 지난 상태 (답 글, 생각, 도구 주고받은 기록, 횟수) */
export type Carry = { text: string; thinking?: string; loop: T.LoopMsg[]; rounds: number };

export const publicResult = (r: any) => { if (!r) return r; const { loop, ...rest } = r; return rest; };

/** AI 1개 실행 (+ 답 중간 도구 루프) */
export async function runOne(ctx: Ctx, job: RunJob, system: string, maxTokens: number, signal: AbortSignal, emit: Emit, carry?: Carry): Promise<Result> {
  const { key, provider: prov, model } = job;
  const res: Result = { provider: prov, model, text: carry?.text || "", ...(carry?.thinking ? { thinking: carry.thinking } : {}), in: 0, cached: 0, write: 0, out: 0, cost: null, sec: 0, error: null, stopped: false, estimated: false };
  const cfg = job.tools || T.NO_TOOLS;
  const loop: T.LoopMsg[] = [...(carry?.loop || [])];
  let rounds = carry?.rounds || 0, fixedCost: number | null = null;
  const t0 = Date.now(); let tFirst: number | null = null, outTok = 0;
  try {
    if (prov === "local") {   // 로컬 모델: 서버는 못 부름 → 화면(내 컴퓨터)에게 맡김
      res.pending = { id: newId(12), kind: "local", label: "로컬 모델" };
      emit({ type: "local", key, model, id: res.pending.id });
      return res;
    }
    if (!hasKey(ctx.env, prov)) throw new Error(missingMsg(prov));
    if (ctx.allow && !ctx.allow.has(prov)) throw new Error(NOT_ALLOWED);
    const streamer = ctx.env.TRIAI_MOCK_AI ? mockStream : prov === "agent" ? AG.stream : P.STREAMERS[prov as P.Provider];
    if (!streamer) throw new Error(missingMsg(prov));
    const gp = job.params || {}, vision = P.canSee(prov, model);
    for (;;) {
      const msgs = [...job.messages, ...(await T.resolveImages(ctx.env, ctx.user, loop, vision))];
      const detect = rounds < T.MAX_ROUNDS && prov !== "agent";
      const ac = new AbortController(); const stop = () => ac.abort(); signal.addEventListener("abort", stop);
      let round = "", found: ReturnType<typeof T.findBlock> = null, usage: (P.Usage & { cost?: number }) | null = null;
      try {
        for await (const ev of streamer(ctx.env, model, msgs, system, gp.num_predict || maxTokens, { deep: job.deep, signal: ac.signal, temperature: gp.temperature, top_p: gp.top_p, top_k: gp.top_k, format: gp.format, extra: job.extra })) {
          if (signal.aborted) { res.stopped = true; break; }
          if (ev.t === "delta") {
            if (tFirst === null && ev.d) tFirst = Date.now();
            const prev = round.length; round += ev.d;
            if (detect && ev.d.includes("`") || detect && round.slice(Math.max(0, prev - 3)).includes("```")) {
              const f = T.findBlock(round, cfg);
              if (f) { const out = round.slice(prev, f.end); if (out) { res.text += out; emit({ type: "delta", key, d: out }); } round = round.slice(0, f.end); found = f; break; }
            }
            res.text += ev.d; emit({ type: "delta", key, d: ev.d });
          } else if (ev.t === "think") { res.thinking = (res.thinking || "") + ev.d; emit({ type: "think", key, d: ev.d }); }
          else if (ev.t === "usage") usage = ev.u;
        }
      } finally { signal.removeEventListener("abort", stop); if (found) ac.abort(); }
      if (usage) { res.in += usage.in; res.cached += usage.cached; res.write += usage.write; res.out += usage.out; if (usage.cost != null) fixedCost = (fixedCost || 0) + usage.cost; }
      else { res.in += roughTokens(system + msgs.map(m => m.content).join("")); res.out += roughTokens(round); res.estimated = true; }
      outTok += usage ? usage.out : roughTokens(round);
      if (!found || res.stopped) break;
      rounds++;
      loop.push({ role: "assistant", content: round });
      if (T.CLIENT_KINDS.has(found.kind)) {   // 화면이 실행할 도구 → 멈추고 기다림
        const p = T.pendingFor(found.kind, found.body);
        let err = typeof p === "string" ? p : "";
        if (!err && typeof p !== "string" && p.kind === "tool" && !T.knownTool(p.name!, cfg.device!)) err = `'${p.name}' 도구는 지금 이 컴퓨터에서 쓸 수 없어요 (윈도우 앱의 기기 설정에서 켜져 있는지 확인)`;
        if (err) { const rec = T.record("🧩 도구", "fail", err); res.text += rec; emit({ type: "delta", key, d: rec }); loop.push({ role: "user", content: `[도구 오류] ${err}` }); continue; }
        res.pending = p as T.Pending;
        emit({ type: "status", key, text: (p as T.Pending).kind === "run" ? "▶ 코드 실행 기다리는 중…" : `${(p as T.Pending).label} — 실행 기다리는 중…` });
        break;
      }
      const { rec, follow } = await T.execServer(ctx.env, ctx.user, found.kind, found.body, cfg, ev => emit({ ...ev, key }));
      res.text += rec; emit({ type: "delta", key, d: rec });
      loop.push({ role: "user", content: follow });
    }
    res.cost = fixedCost ?? P.estimateCost(model, res, prov);
    if (!res.text.trim() && !res.stopped && !res.pending) res.error = "빈 답변이에요. 설정에서 최대 토큰을 늘려보세요.";
  } catch (e: any) {
    if (signal.aborted) res.stopped = true;
    else { const raw = `${e?.name || "Error"}: ${e?.message || e}`; res.error = `${P.friendlyError(raw)} — ${raw.slice(0, 300)}`; }
  }
  if ((res.thinking || "").length > 20000) res.thinking = res.thinking!.slice(0, 20000) + "\n…(생략)";
  res.sec = Math.round((Date.now() - t0) / 10) / 100;
  if (tFirst !== null) { res.ttft = Math.round((tFirst - t0) / 10) / 100; const gen = (Date.now() - tFirst) / 1000; if (outTok && gen > 0.05) res.tps = Math.round(outTok / gen * 10) / 10; }
  if (loop.length) { res.loop = loop; res.rounds = rounds; }
  await addCost(ctx.env, ctx.user, prov, res.cost);
  return res;
}

export async function runParallel(ctx: Ctx, jobs: RunJob[], system: string, maxTokens: number, signal: AbortSignal, emit: Emit): Promise<Record<string, Result>> {
  const results: Record<string, Result> = {};
  await Promise.all(jobs.map(async job => {
    const res = await runOne(ctx, job, system, maxTokens, signal, emit);
    results[job.key] = res;
    emit({ type: "done", key: job.key, result: publicResult(res) });
  }));
  return results;
}

/** 질문 하나 실행: 스트리밍 이벤트 → 저장 → end */
export async function execute(ctx: Ctx, req: ChatReq, plan: Plan, signal: AbortSignal, emit: Emit): Promise<void> {
  const { env, user, s } = ctx;
  const { conv, system, jobs } = plan;
  const turnIx = (req.replace_from != null ? req.replace_from : conv.turns.length);
  emit({ type: "meta", conv_id: conv.id, title: conv.title, run_id: newId(10), trimmed: plan.trimmed, route: plan.route,
    providers: jobs.map(j => j.key), category: plan.label, switch: false, turn: turnIx });
  let sources: S.Row[] = [], webCtx = "";
  if (plan.web) {   // 🌐: 먼저 검색 → 결과를 AI에게 주는 질문 끝에 붙임 (저장되는 질문은 원래 그대로)
    const deepR = plan.mode === "research";
    if (!deepR) emit({ type: "status", text: "🌐 검색하는 중…" });
    try {
      if (deepR) { for await (const [k, v] of S.deepResearch(env, plan.text, new Set(jobs.map(j => j.provider)), s.search_engine)) { if (signal.aborted) break; if (k === "status") emit({ type: "status", text: v }); else sources = v as S.Row[]; } }
      else sources = await S.research(env, plan.text, 5, 2, s.search_engine);
    } catch (e: any) { emit({ type: "status", text: `검색 실패: ${String(e?.message || e).slice(0, 100)} — 검색 없이 답할게요` }); }
    if (sources.length) {
      webCtx = S.asContext(plan.text.slice(0, 100), sources) + (deepR ? S.REPORT_HINT : "");
      for (const j of jobs) { const last = j.messages[j.messages.length - 1]; j.messages = [...j.messages.slice(0, -1), { ...last, content: `${last.content}\n\n${webCtx}` }]; }
      emit({ type: "sources", items: sources.map(r => ({ title: r.title, url: r.url })) });
    }
  }
  const runJobs: RunJob[] = jobs.map(j => ({ ...j, tools: j.provider === "agent" ? T.NO_TOOLS : plan.tools,
    extra: j.provider === "agent" ? { user, conv: conv.id, turn: turnIx, cap: plan.agentCap, env_name: s.agent_env } : undefined }));
  const answers = await runParallel(ctx, runJobs, system, Number(s.max_tokens), signal, emit);
  const imgIds = [...plan.image_ids];
  for (const b of plan.images.slice(imgIds.length)) imgIds.push(await putUpload(env, user, b, P.imgMime(b)));
  const anyPending = Object.values(answers).some(a => a.pending);
  const turn: Turn = { q: plan.text, answers, synth: null, trimmed: plan.trimmed, time: nowIso(), files: plan.files, images: imgIds, agent: false,
    preset: req.preset ?? null, rag: [], sources: sources.map(r => ({ title: r.title, url: r.url })), category: plan.category, group: plan.group, route: plan.route, best: null, forced: plan.forced, cls: plan.cls,
    ...(anyPending ? { sysopt: { style: req.style || "default", mode: plan.mode, preset: req.preset ?? null }, ...(webCtx ? { web_ctx: webCtx } : {}) } : {}) };
  const saved = await updateConv(env, user, conv.id, c => {
    if (req.replace_from != null) {
      const old = c.turns.slice(req.replace_from);
      if (old.length) (c.archive ??= []).push({ time: nowIso(), from: req.replace_from, turns: old });
      c.turns = c.turns.slice(0, req.replace_from);
      if ((c.summary?.upto || 0) > req.replace_from) delete c.summary;
    }
    c.turns.push(turn);
  }, conv);
  if (saved.project_id) await PJ.touch(env, user, saved.project_id);
  const remembered = await captureMemory(env, user, plan.text);
  emit({ type: "end", turn: saved.turns.length - 1, spent_today: await spentToday(env, user), remembered, handoff: null,
    pending: Object.entries(answers).filter(([, a]) => a.pending).map(([k, a]) => ({ key: k, ...a.pending })) });
  const later = ctx.later || ((p: Promise<unknown>) => { p.catch(() => {}); });
  if (!anyPending) later(summarize(env, user, saved.id, Number(s.history_chars)).catch(e => console.error("[대화 요약]", e)));   // 길어졌으면 뒤에서 오래된 턴을 요약
}

/** 이 질문에 쓸 도구들 */
export async function toolCfg(ctx: Ctx, req: { device?: any; run?: boolean }): Promise<T.ToolCfg> {
  const s = ctx.s;
  return { device: T.cleanCatalog(req.device), run: !!req.run && s.code_tool !== false, mcp: await M.active(ctx.env, ctx.user),
    search: s.web_search !== false, image: !!s.image_tool && can(ctx, "cf"), engine: s.search_engine,
    sensors: !!(await ctx.env.DB.prepare("SELECT 1 FROM sensor_devices WHERE user=? LIMIT 1").bind(ctx.user).first()) };
}
/** 에이전트 1질문 예산 = min(질문당 예산, 오늘 남은 예산) */
export async function agentCap(ctx: Ctx): Promise<number> {
  let cap = Number(ctx.s.agent_budget || 2) || 2;
  const lim = Number(ctx.s.daily_limit || 0);
  if (lim) cap = Math.min(cap, Math.max(lim - await spentToday(ctx.env, ctx.user), 0));
  return Math.round(cap * 10000) / 10000;
}

/** 지난 질문까지의 기록 + 그 질문 (이어 쓰기·로컬 저장에서 같은 모양으로 다시 만듦) */
async function baseMessages(ctx: Ctx, conv: Conv, turnIx: number, key: string): Promise<P.Msg[]> {
  const t = conv.turns[turnIx];
  const past: Conv = { ...conv, turns: conv.turns.slice(0, turnIx) };
  const [hist] = trimHistory(await historyFor(past, key), Number(ctx.s.history_chars));
  const imgs: string[] = [];
  for (const i of t.images || []) { const u = await getUpload(ctx.env, ctx.user, i); if (u) imgs.push(b64(u.bytes)); }
  return [...hist, { role: "user", content: withFiles(t.q, t.files) + (t.web_ctx ? `\n\n${t.web_ctx}` : ""), ...(imgs.length ? { images: imgs } : {}) }];
}
async function systemFor(ctx: Ctx, conv: Conv, t: Turn, cfg: T.ToolCfg): Promise<string> {
  const o = t.sysopt || {};
  let system = await fullSystem(ctx, o.style || "default", true, conv.project_id);
  if (o.mode) { try { system += "\n\n" + (await modeGet(ctx.env, ctx.user, o.mode)).prompt; } catch { /* 모드가 없어짐 */ } }
  return system + T.hints(cfg);
}

/** 화면이 도구(코드 실행·내 컴퓨터)를 실행하고 결과를 보냄 → 이어서 씀 */
export async function resume(ctx: Ctx, req: { conv_id: string; turn: number; key: string; id: string; result: T.ClientResult; device?: any; run?: boolean }, signal: AbortSignal, emit: Emit): Promise<void> {
  const { env, user, s } = ctx;
  const conv = await loadConv(env, user, req.conv_id);
  const t = conv.turns[req.turn];
  const a: Result | undefined = t?.answers?.[req.key];
  if (!t || !a) throw new HTTPException(404, { message: "이어 쓸 답을 찾을 수 없어요" });
  if (!a.pending || a.pending.id !== req.id || a.pending.kind === "local") throw new HTTPException(409, { message: "이미 끝났거나 다른 요청이에요" });
  await checkBudget(ctx);
  // 결과 그림(코드 그래프·화면 캡처)은 이 사람 것만 인정
  const ids: string[] = [];
  for (const id of (req.result?.image_ids || []).slice(0, 6)) if (await getUpload(env, user, String(id))) ids.push(String(id));
  const r: T.ClientResult = { ...req.result, image_ids: ids, text: String(req.result?.text ?? "").slice(0, 200_000), stdout: String(req.result?.stdout ?? "").slice(0, 200_000) };
  const { rec, follow, images } = T.clientFollow(a.pending, r);
  const cfg = await toolCfg(ctx, req);
  const system = await systemFor(ctx, conv, t, cfg);
  emit({ type: "meta", run_id: newId(10), providers: [req.key], conv_id: conv.id, turn: req.turn });
  emit({ type: "delta", key: req.key, d: rec });
  const base = await baseMessages(ctx, conv, req.turn, req.key);
  const carry: Carry = { text: a.text + rec, thinking: a.thinking, loop: [...(a.loop || []), { role: "user", content: follow, ...(images.length ? { image_ids: images } : {}) }], rounds: a.rounds || 0 };
  const params = await presetParams(env, user, t.sysopt?.preset ?? t.preset);
  const job: RunJob = { key: req.key, provider: a.provider, model: a.model, messages: base, params, tools: r.stopped ? T.NO_TOOLS : cfg };
  let res: Result;
  if (r.stopped) { res = { ...a, text: carry.text, loop: carry.loop, in: 0, cached: 0, write: 0, out: 0, cost: 0, sec: 0, stopped: true } as Result; delete res.pending; }
  else res = await runOne(ctx, job, system, Number(s.max_tokens), signal, emit, carry);
  const merged: Result = { ...res, in: (a.in || 0) + res.in, cached: (a.cached || 0) + res.cached, write: (a.write || 0) + res.write, out: (a.out || 0) + res.out,
    cost: a.cost == null && res.cost == null ? null : (a.cost || 0) + (r.stopped ? 0 : res.cost || 0), sec: Math.round(((a.sec || 0) + (r.stopped ? 0 : res.sec)) * 100) / 100,
    estimated: !!(a.estimated || res.estimated) };
  if (!merged.pending) delete merged.pending;
  const saved = await updateConv(env, user, conv.id, c => { const tt = c.turns[req.turn]; if (tt) tt.answers[req.key] = merged; });
  emit({ type: "done", key: req.key, result: publicResult(merged) });
  emit({ type: "end", turn: req.turn, spent_today: await spentToday(env, user), pending: merged.pending ? [{ key: req.key, ...merged.pending }] : [] });
  if (!Object.values<any>(saved.turns[req.turn]?.answers || {}).some(x => x.pending)) {
    const later = ctx.later || ((p: Promise<unknown>) => { p.catch(() => {}); });
    later(summarize(env, user, saved.id, Number(s.history_chars)).catch(() => {}));
  }
}

/** 로컬 모델 답 저장 (화면이 내 컴퓨터의 Ollama·LM Studio로 만든 답) */
export async function localSave(ctx: Ctx, req: { conv_id: string; turn: number; key: string; id: string; result: any }): Promise<any> {
  const { env, user } = ctx;
  const r = req.result || {};
  const clean: Result = { provider: "local", model: String(r.model || req.key.replace(/^local@/, "")).slice(0, 120), text: String(r.text || "").slice(0, 400_000),
    ...(r.thinking ? { thinking: String(r.thinking).slice(0, 20000) } : {}), in: Math.max(0, +r.in || 0), cached: 0, write: 0, out: Math.max(0, +r.out || 0), cost: 0,
    sec: Math.max(0, +r.sec || 0), error: r.error ? String(r.error).slice(0, 500) : null, stopped: !!r.stopped, estimated: !!r.estimated,
    ...(r.tps ? { tps: +r.tps } : {}), ...(r.ttft ? { ttft: +r.ttft } : {}) };
  const saved = await updateConv(env, user, req.conv_id, c => {
    const a = c.turns[req.turn]?.answers?.[req.key];
    if (!a) throw new HTTPException(404, { message: "저장할 자리를 찾을 수 없어요" });
    if (!a.pending || a.pending.id !== req.id) throw new HTTPException(409, { message: "이미 저장됐거나 다른 요청이에요" });
    c.turns[req.turn].answers[req.key] = clean;
  });
  return { ok: true, turn: saved.turns[req.turn] };
}

/** 로컬 모델 작업 내용 (화면이 내 컴퓨터의 모델에 그대로 보냄) */
export async function localJob(ctx: Ctx, req: { conv_id: string; turn: number; key: string; device?: any; run?: boolean }) {
  const conv = await loadConv(ctx.env, ctx.user, req.conv_id);
  const t = conv.turns[req.turn], a = t?.answers?.[req.key];
  if (!a?.pending || a.pending.kind !== "local") throw new HTTPException(409, { message: "기다리는 로컬 답이 없어요" });
  const cfg = await toolCfg(ctx, req);
  return { id: a.pending.id, model: a.model, messages: await baseMessages(ctx, conv, req.turn, req.key), system: await systemFor(ctx, conv, t, cfg),
    max_tokens: Number(ctx.s.max_tokens), params: await presetParams(ctx.env, ctx.user, t.sysopt?.preset ?? t.preset),
    tools: { run: cfg.run, device: !!cfg.device, search: cfg.search, image: cfg.image, mcp: cfg.mcp.length > 0, sensors: !!cfg.sensors } };
}

/** 로컬 모델이 쓴 서버 도구 블록(검색·읽기·그림·MCP) 실행 */
export async function toolExec(ctx: Ctx, req: { kind: string; body?: string; pending?: any; result?: T.ClientResult }): Promise<{ rec: string; follow: string }> {
  if (req.kind === "result") {   // 로컬 모델이 화면에서 실행한 코드·기기 도구 결과 → 서버와 같은 모양의 기록·안내글
    const pk = req.pending?.kind === "run" ? "run" : "tool";
    const p: T.Pending = { id: "local", kind: pk, name: String(req.pending?.name || "").slice(0, 120), args: req.pending?.args || {}, label: pk === "run" ? "▶ 코드 실행" : T.deviceLabel(String(req.pending?.name || ""), req.pending?.args || {}) };
    const ids: string[] = [];
    for (const id of (req.result?.image_ids || []).slice(0, 6)) if (await getUpload(ctx.env, ctx.user, String(id))) ids.push(String(id));
    const { rec, follow } = T.clientFollow(p, { ...req.result, image_ids: ids, text: String(req.result?.text ?? "").slice(0, 200_000), stdout: String(req.result?.stdout ?? "").slice(0, 200_000) });
    return { rec, follow };
  }
  const cfg = await toolCfg(ctx, {});
  if (!["search", "fetch", "image", "mcp", "sensor"].includes(req.kind)) throw new HTTPException(400, { message: "서버에서 실행하지 않는 도구예요" });
  if ((req.kind === "search" || req.kind === "fetch") && !cfg.search) throw new HTTPException(400, { message: "답 중간 웹 검색이 꺼져 있어요 (설정 → 도구)" });
  if (req.kind === "image" && !cfg.image) throw new HTTPException(400, { message: "그림 만들기가 꺼져 있어요 (설정 → 도구)" });
  return T.execServer(ctx.env, ctx.user, req.kind, String(req.body || "").slice(0, 20_000), cfg, () => {});
}

/** "기억해: …" → 기억 목록에 저장 */
export async function captureMemory(env: Env, user: string, text: string): Promise<string | null> {
  const m = /^\s*(기억해\s*줘?|기억해|기억할\s*것|앞으로는?|이제부터|항상|remember)\s*[:,：]?\s*([\s\S]+)/i.exec(text);
  if (!m || m[2].trim().length < 2) return null;
  let rule = m[2].trim().replace(/\.$/, "");
  if (/^(앞으로|이제부터|항상)/.test(m[1].trim())) rule = m[0].trim();
  const { kvPut } = await import("./db");
  const mem = await kvGet<{ id: string; text: string; time: string }[]>(env, user, "memory", []);
  if (mem.some(x => x.text === rule)) return rule;
  const item = { id: newId(8), text: rule.slice(0, 300), source: "said", time: nowIso() };
  await kvPut(env, user, "memory", [...mem, item].slice(-60));
  return item.text;
}

/** 다른 AI에게도 묻기 */
export async function askMore(ctx: Ctx, convId: string, turnIx: number, targets: Target[], signal: AbortSignal, emit: Emit): Promise<void> {
  const { env, user, s } = ctx;
  const conv = await loadConv(env, user, convId);
  if (!(turnIx >= 0 && turnIx < conv.turns.length)) throw new HTTPException(400, { message: "잘못된 턴 번호" });
  const t = conv.turns[turnIx];
  const system = await fullSystem(ctx, "default", true, conv.project_id);
  const past: Conv = { ...conv, turns: conv.turns.slice(0, turnIx) };
  const outGuess = Math.min(Number(s.assumed_output), Number(s.max_tokens));
  const jobs: Job[] = [];
  for (const tg of chatProviders(targets)) {
    const key = R.answerKey(tg.provider, tg.model);
    const prev = ownAnswer(t, key);
    if (prev && !prev.error) continue;
    if (!can(ctx, tg.provider)) continue;
    if (t.images?.length && !P.canSee(tg.provider, tg.model)) continue;
    const [hist] = trimHistory(await historyFor(past, key), Number(s.history_chars));
    const imgs: string[] = [];
    for (const i of t.images || []) { const u = await getUpload(env, user, i); if (u) imgs.push(b64(u.bytes)); }
    const last: P.Msg = { role: "user", content: withFiles(t.q, t.files), ...(imgs.length ? { images: imgs } : {}) };
    const messages = [...hist, last];
    const tin = roughTokens(system + messages.map(m => m.content).join(""));
    jobs.push({ key, provider: tg.provider, model: tg.model, messages, est_in: tin, est_cost: P.estimateCost(tg.model, { in: tin, cached: 0, write: 0, out: outGuess }, tg.provider), dropped: 0, deep: false });
  }
  if (!jobs.length) throw new HTTPException(400, { message: "새로 물어볼 모델이 없어요 (이미지가 있는 질문은 이미지를 볼 수 있는 모델만 가능)" });
  await checkBudget(ctx, jobs.reduce((n, j) => n + (j.est_cost || 0), 0));
  emit({ type: "meta", run_id: newId(10), providers: jobs.map(j => j.key) });
  const res = await runParallel(ctx, jobs, system, Number(s.max_tokens), signal, emit);
  await updateConv(env, user, convId, c => Object.assign(c.turns[turnIx].answers, res));
  emit({ type: "end", spent_today: await spentToday(env, user) });
}

/** 종합: 여러 답을 심판 모델이 비교·통합 */
export async function synth(ctx: Ctx, convId: string, turnIx: number, judge: Target, signal: AbortSignal, emit: Emit): Promise<void> {
  const { env, user, s } = ctx;
  if (!can(ctx, judge.provider)) throw new HTTPException(403, { message: NOT_ALLOWED });
  await checkBudget(ctx);
  const conv = await loadConv(env, user, convId);
  if (!(turnIx >= 0 && turnIx < conv.turns.length)) throw new HTTPException(400, { message: "잘못된 턴 번호" });
  const t = conv.turns[turnIx];
  const ok = Object.entries<any>(t.answers).filter(([, a]) => !a.error && (a.text || "").trim());
  for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
  const labels: Record<string, string> = Object.fromEntries(ok.map(([p], i) => [String.fromCharCode(65 + i), p]));
  const body = ok.map(([, a], i) => `[답변 ${String.fromCharCode(65 + i)}]\n${a.text}`).join("\n\n");
  const prompt = `질문: ${t.q}\n\n${body}\n\n위 답변들은 서로 다른 AI가 쓴 것이고, 누가 썼는지는 알려주지 않아. 1) 답변끼리 다른 점과 틀린 부분을 '답변 A' 같은 이름으로 짧게 짚고, 2) 정확한 내용만 모아 최종 답변 하나를 작성해줘.`;
  const system = await fullSystem(ctx);
  emit({ type: "meta", run_id: newId(10), labels });
  const res = await runParallel(ctx, [{ key: "synth", provider: judge.provider, model: judge.model, messages: [{ role: "user", content: prompt }] }], system, Number(s.max_tokens), signal, emit);
  await updateConv(env, user, convId, c => { c.turns[turnIx].synth = { ...res.synth, labels }; });
  emit({ type: "end", spent_today: await spentToday(env, user), labels });
}

export const ctxOf = async (env: Env, user: string, hardLimit: number | null, providers?: string[] | null): Promise<Ctx> =>
  ({ env, user, s: await loadSettings(env, user, hardLimit), allow: providers ? new Set(providers) : null });
