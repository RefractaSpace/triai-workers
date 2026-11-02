/*
agents.ts — 콘솔 에이전트 팀 (Claude Managed Agents)을 TriAI 대화에서 부르기 (파이 때 agents.py를 옮김)

  TriAI 대화 1개 ─── Console 세션 1개 (세션이 대화 내용을 스스로 기억 → 질문은 새 것만 보냄)
     POST /v1/sessions/{id}/events (user.message) → GET /v1/sessions/{id}/events/stream 로 실시간 받기
       agent.message → 답 · thread_created·tool_use 등 → 진행 상황(생각 칸) · session.usage → 예산 검사 · status_idle → 끝

  안전장치
   · 질문 1개당 예산(설정 agent_budget, 기본 $2)과 오늘 남은 예산 중 작은 쪽 — 닿으면 중지 신호(user.interrupt)
   · 중지 버튼·창 닫기 → 중지 신호 (에이전트가 계속 돌며 돈을 쓰지 않게)
   · Cloudflare 무료 플랜은 요청 1번에 바깥 호출 50번까지 → 사용량 확인·재연결 횟수를 그 안으로 제한
   · 결과 파일은 저장하지 않고, 받을 때마다 Console에서 가져옴 (그 대화에서 나온 파일만 받을 수 있게 확인)
*/
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import * as P from "./providers";
import { kvGet, kvPut } from "./db";

const API = "https://api.anthropic.com/v1";
const BETA = "managed-agents-2026-04-01";
const FILES_BETA = "files-api-2025-04-14";
const FIRST_HISTORY_CHARS = 30_000;
const SUB_BUDGET = 42;          // 이 요청에서 쓸 바깥 호출 최대 (무료 플랜 50 중 여유를 남김)

type Link = { session: string; agent: string; next: number | null; files?: { id: string; name: string }[] };

function headers(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  const key = env.ANTHROPIC_API_KEY || "";
  if (!key) throw new Error("ANTHROPIC_API_KEY 비밀값이 없어요");
  const h: Record<string, string> = { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": BETA, "content-type": "application/json", ...extra };
  const ws = (env.ANTHROPIC_WORKSPACE_ID || "").trim();
  if (ws) h["anthropic-workspace-id"] = ws;
  else if (key.startsWith("sk-ant-usr-")) throw new Error("이 Claude 키(sk-ant-usr-)는 ANTHROPIC_WORKSPACE_ID 비밀값이 필요해요");
  return h;
}
class Calls { n = 0; constructor(private max = SUB_BUDGET) {} take() { if (this.n >= this.max) throw new Error("바깥 호출 한도(무료 플랜 50번)에 가까워서 더 기다리지 않아요. Console에서 세션을 확인하세요."); this.n++; } left() { return this.max - this.n; } }
async function aget(env: Env, path: string, c?: Calls): Promise<any> {
  c?.take();
  const r = await fetch(`${API}${path}`, { headers: headers(env), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Console API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
async function apost(env: Env, path: string, body: any, c?: Calls): Promise<any> {
  c?.take();
  const r = await fetch(`${API}${path}`, { method: "POST", headers: headers(env), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Console API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// ── 목록 (KV에 1분 저장) ──
export async function listAgents(env: Env, force = false): Promise<{ id: string; name: string; model: string; description: string }[]> {
  if (!force) { const hit = await env.KV.get("agents:list", "json"); if (hit) return hit as any; }
  const out = ((await aget(env, "/agents")).data || []).map((a: any) => ({ id: a.id, name: a.name || a.id,
    model: typeof a.model === "object" ? a.model?.id : a.model, description: String(a.description || "").slice(0, 200) }));
  await env.KV.put("agents:list", JSON.stringify(out), { expirationTtl: 60 });
  return out;
}
export async function listEnvs(env: Env): Promise<{ id: string; name: string }[]> {
  const hit = await env.KV.get("agents:envs", "json"); if (hit) return hit as any;
  const out = ((await aget(env, "/environments")).data || []).map((e: any) => ({ id: e.id, name: e.name || e.id }));
  await env.KV.put("agents:envs", JSON.stringify(out), { expirationTtl: 60 });
  return out;
}
async function findAgent(env: Env, nameOrId: string) {
  for (const force of [false, true]) {
    const a = (await listAgents(env, force)).find(x => x.id === nameOrId || x.name === nameOrId);
    if (a) return a;
  }
  throw new Error(`Console에 '${nameOrId}' 에이전트가 없어요. 설정 → 에이전트에서 다시 고르세요.`);
}
async function pickEnv(env: Env, want: string): Promise<string> {
  const envs = await listEnvs(env);
  if (!envs.length) throw new Error("Console에 환경(Environment)이 없어요. Console → Environments에서 하나 만들어 주세요.");
  return (envs.find(e => want && (e.id === want || e.name === want)) || envs.find(e => e.name === "safe-limited") || envs[0]).id;
}

// ── 비용 ──
function usageTokens(u: any): P.Usage {
  const cc = u?.cache_creation;
  let write = cc && typeof cc === "object" ? Object.values<any>(cc).reduce((n, v) => n + (typeof v === "number" ? v : 0), 0) : 0;
  write += u?.cache_creation_input_tokens || 0;
  const cached = u?.cache_read_input_tokens || 0, plain = u?.input_tokens || 0;
  return { in: plain + cached + write, cached, write, out: u?.output_tokens || 0 };
}
function sessionCost(u: any, model: string): number {
  const lc = u?.list_cost;
  if (lc && (lc.currency ?? "USD") === "USD" && lc.amount != null && !isNaN(+lc.amount)) return +lc.amount / 100;   // 센트 단위
  const t = usageTokens(u || {});
  return P.estimateCost(model || "claude-opus-5-5", t, "claude") ?? P.estimateCost("claude-opus-5-5", t, "claude") ?? 0;
}
const diff = (a: P.Usage, b: P.Usage): P.Usage => ({ in: Math.max(a.in - b.in, 0), cached: Math.max(a.cached - b.cached, 0), write: Math.max(a.write - b.write, 0), out: Math.max(a.out - b.out, 0) });

// ── 대화 ↔ 세션 ──
const links = (env: Env, user: string) => kvGet<Record<string, Link>>(env, user, "agent_links", {});
async function setLink(env: Env, user: string, conv: string, rec: Link) {
  const all = await links(env, user); all[conv] = rec;
  const keys = Object.keys(all); for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete all[k];   // 오래된 것 정리
  await kvPut(env, user, "agent_links", all);
}
export async function linkOf(env: Env, user: string, conv: string): Promise<Link | null> { return (await links(env, user))[conv] || null; }

function historyText(msgs: P.Msg[]): string {
  const parts: string[] = []; let total = 0;
  for (const m of [...msgs].reverse()) {
    const line = `[${m.role === "user" ? "사용자" : "AI"}] ${m.content}`;
    if (total + line.length > FIRST_HISTORY_CHARS) break;
    parts.push(line); total += line.length;
  }
  return parts.reverse().join("\n\n");
}
const textOf = (ev: any) => (ev.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text || "").join("");

/** 다른 AI와 같은 모양으로 내보냄: delta(답)·think(진행)·usage(+cost). o.extra = {user, conv, turn, cap, env_name} */
export async function* stream(env: Env, model: string, messages: P.Msg[], _system: string, _max: number, o: P.GenOpts): AsyncGenerator<P.Ev> {
  const x = o.extra || {}, user = String(x.user || ""), conv = String(x.conv || "none"), turn: number | null = x.turn ?? null;
  const cap = Number(x.cap || 0);
  if (!(cap > 0)) throw new Error("오늘 예산을 다 써서 에이전트를 부를 수 없어요 (설정 → 하루 한도)");
  const calls = new Calls();
  const ag = await findAgent(env, model);
  const rec = user ? await linkOf(env, user, conv) : null;
  let sid = "", reuse = false, missed: P.Msg[] = [], baseU: any = {};
  if (rec && rec.agent === ag.id && rec.session) {
    const wentBack = turn != null && rec.next != null && turn < rec.next;
    if (!wentBack) {
      try {
        const info = await aget(env, `/sessions/${rec.session}`, calls);
        if (info.status !== "terminated" && !info.archived_at) {
          sid = rec.session; reuse = true; baseU = info.usage || {};
          if (turn != null && rec.next != null && turn > rec.next) missed = messages.slice(0, -1).slice(-2 * (turn - rec.next));
        }
      } catch { /* 새로 만듦 */ }
    }
  }
  const question = messages[messages.length - 1]?.content || "";
  let text: string;
  if (reuse) {
    text = missed.length ? `(그 사이 TriAI에서 다른 AI와 나눈 대화야. 참고만 해)\n${historyText(missed)}\n\n(새 질문)\n${question}` : question;
    yield { t: "think", d: `🔗 이어서: 세션 ${sid} · ${ag.name}\n` };
  } else {
    const title = question.trim().replace(/\n/g, " ").slice(0, 60) || "TriAI";
    const sess = await apost(env, "/sessions", { agent: ag.id, environment_id: await pickEnv(env, String(x.env_name || "")), title: `TriAI · ${title}`, metadata: { triai_conv: conv } }, calls);
    sid = sess.id;
    const past = historyText(messages.slice(0, -1));
    text = past ? `(지금까지 TriAI에서 나눈 대화야. 참고만 해)\n${past}\n\n(새 질문)\n${question}` : question;
    yield { t: "think", d: `🆕 새 세션 ${sid} · ${ag.name}\n` };
  }
  if (user) await setLink(env, user, conv, { session: sid, agent: ag.id, next: turn != null ? turn + 1 : null, files: reuse ? rec?.files || [] : [] });
  const baseCost = sessionCost(baseU, ag.model), baseTok = usageTokens(baseU);
  const live = { u: baseU, over: false };
  const interrupt = async () => { try { await fetch(`${API}/sessions/${sid}/events`, { method: "POST", headers: headers(env), body: JSON.stringify({ events: [{ type: "user.interrupt" }] }) }); } catch { /* */ } };
  const checkCap = async (u: any) => {
    live.u = u;
    if (!live.over && sessionCost(u, ag.model) - baseCost >= cap) { live.over = true; await interrupt(); }
  };
  let finished = false, sent = false, first = true, lastPoll = Date.now();
  const seen = new Set<string>();
  const deadline = Date.now() + 2 * 3600_000;
  const handle = (ev: any): (P.Ev | null)[] => {
    const out: (P.Ev | null)[] = [], ty = ev.type || "";
    if (ev.id) { if (seen.has(ev.id)) return out; seen.add(ev.id); }
    if (ty === "agent.message") { const t = textOf(ev); if (t) { out.push({ t: "delta", d: (first ? "" : "\n\n") + t }); first = false; } }
    else if (ty === "session.thread_created") out.push({ t: "think", d: `➡️ ${ev.agent_name || "?"}에게 맡김\n` });
    else if (ty === "agent.thread_message_sent") out.push({ t: "think", d: `📨 ${ev.to_agent_name || "?"}에게: ${textOf(ev).slice(0, 400)}\n` });
    else if (ty === "agent.thread_message_received") out.push({ t: "think", d: `📩 ${ev.from_agent_name || "?"}의 보고: ${textOf(ev).slice(0, 800)}\n` });
    else if (ty === "agent.tool_use") out.push({ t: "think", d: `🔧 ${ev.name || "도구"} ${JSON.stringify(ev.input || {}).slice(0, 200)}\n` });
    else if (ty === "session.status_idle") {
      const reason = ev.stop_reason?.type;
      if (reason && reason !== "end_turn" && !live.over) out.push({ t: "delta", d: `\n\n(에이전트가 '${reason}' 상태로 멈췄어요. Console의 세션 화면에서 확인하세요.)` });
      out.push(null);
    } else if (ty === "session.status_terminated" || ty === "session.error") throw new Error(`에이전트 세션 오류: ${JSON.stringify(ev).slice(0, 300)}`);
    return out;
  };
  const onAbort = () => { if (!finished) interrupt(); };
  o.signal?.addEventListener("abort", onAbort);
  try {
    while (!finished) {
      if (o.signal?.aborted) break;
      calls.take();
      const res = await fetch(`${API}/sessions/${sid}/events/stream`, { headers: headers(env, { accept: "text/event-stream" }), signal: o.signal });
      if (!res.ok) throw new Error(`Console API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (!sent) { await apost(env, `/sessions/${sid}/events`, { events: [{ type: "user.message", content: [{ type: "text", text }] }] }, calls); sent = true; }
      try {
        for await (const ev of P.sse(res)) {
          if (ev.type === "session.usage") await checkCap(ev.usage || {});
          for (const e of handle(ev)) { if (e === null) { finished = true; break; } yield e; }
          if (finished) break;
          if (Date.now() - lastPoll > 60_000 && calls.left() > 8) {   // 1분마다 사용량 확인 (하위 에이전트가 일하는 동안에도 늘어남)
            lastPoll = Date.now();
            try { await checkCap((await aget(env, `/sessions/${sid}`, calls)).usage || {}); } catch { /* */ }
          }
        }
      } catch (e) { if (o.signal?.aborted) break; if (!(e instanceof TypeError)) throw e; }
      if (finished || o.signal?.aborted) break;
      // 연결이 끊김 → 에이전트는 계속 일하는 중이니 상태 확인 후 다시 연결
      if (Date.now() > deadline) throw new Error("2시간이 넘어서 기다리기를 멈췄어요. 에이전트는 Console에서 계속 확인할 수 있어요");
      if (calls.left() < 6) throw new Error("연결이 여러 번 끊겨서 기다리기를 멈췄어요. 다음 질문에서 이어서 확인할 수 있어요 (Console에서도 볼 수 있어요)");
      const st = (await aget(env, `/sessions/${sid}`, calls)).status;
      if (st === "idle") {   // 그 사이 끝남 → 놓친 답을 기록에서 가져옴
        const evs = (await aget(env, `/sessions/${sid}/events?limit=200`, calls)).data || [];
        for (const ev of evs) if (ev.type === "agent.message") for (const e of handle(ev)) if (e) yield e;
        finished = true; break;
      }
      if (st === "terminated") throw new Error("Console에서 세션이 끝났어요");
      yield { t: "think", d: "🔄 연결이 끊겨서 다시 연결했어요 (에이전트는 계속 일하는 중)\n" };
    }
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
    if (!finished) await interrupt();
  }
  if (finished && user) {   // 결과 파일 목록 (내용은 받을 때 Console에서 가져옴)
    await new Promise(r => setTimeout(r, 2500));
    try {
      calls.take();
      const r = await fetch(`${API}/files?scope_id=${encodeURIComponent(sid)}&limit=100`, { headers: headers(env, { "anthropic-beta": `${BETA},${FILES_BETA}` }) });
      const items: any[] = r.ok ? ((await r.json()) as any).data || [] : [];
      const cur = await linkOf(env, user, conv), known = new Set((cur?.files || []).map(f => f.id));
      const fresh = items.filter(f => !known.has(f.id) && f.downloadable !== false).map(f => ({ id: String(f.id), name: String(f.filename || f.id).slice(0, 120) }));
      if (fresh.length) {
        await setLink(env, user, conv, { ...(cur as Link), files: [...(cur?.files || []), ...fresh].slice(-200) });
        yield { t: "delta", d: "\n\n📎 에이전트가 만든 파일: " + fresh.map(f => `[${f.name}](/api/agents/file/${encodeURIComponent(conv)}/${encodeURIComponent(f.id)})`).join(" · ") };
      }
    } catch { /* 파일 목록은 덤 */ }
  }
  if (live.over) yield { t: "delta", d: `\n\n⚠️ 이 질문 예산($${cap.toFixed(2)})에 닿아서 멈췄어요. 설정 → 에이전트에서 예산을 늘리거나, 일을 작게 나눠서 맡기세요.` };
  try { if (calls.left() > 0) live.u = (await aget(env, `/sessions/${sid}`, calls)).usage || live.u; } catch { /* */ }
  const tok = diff(usageTokens(live.u), baseTok);
  yield { t: "usage", u: { ...tok, cost: Math.round(Math.max(sessionCost(live.u, ag.model) - baseCost, 0) * 10000) / 10000 } as P.Usage };
}

/** 에이전트가 만든 파일 받기 — 그 사람의 그 대화에서 나온 파일만 */
export async function file(env: Env, user: string, conv: string, fid: string): Promise<Response> {
  const l = await linkOf(env, user, conv), f = l?.files?.find(x => x.id === fid);
  if (!f) throw new HTTPException(404, { message: "파일을 찾을 수 없어요" });
  const r = await fetch(`${API}/files/${encodeURIComponent(fid)}/content`, { headers: headers(env, { "anthropic-beta": `${BETA},${FILES_BETA}` }) });
  if (!r.ok) throw new HTTPException(502, { message: `Console에서 파일을 못 받았어요 (HTTP ${r.status}) — 7일이 지나 지워졌을 수 있어요` });
  return new Response(r.body, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, "cache-control": "private, no-store" } });
}
