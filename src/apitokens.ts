/*
apitokens.ts — 다른 채팅·프로그램에서 TriAI의 AI(Claude·Cloudflare 등)를 쓰는 'TriAI 토큰'

  다른 채팅 ──HTTPS──▶ POST /api/v1/chat   Authorization: Bearer triai_…
                       {"provider":"cf","messages":[{"role":"user","content":"…"}]}
                  ◀── {"text":"…","model":"…","cost":0.0012,"spent_today":…}

  · 진짜 Claude 키·Cloudflare 토큰은 서버(비밀값) 밖으로 절대 안 나감. 바깥에는 TriAI 토큰만.
  · TriAI 토큰: 만들 때 한 번만 보여주고 서버엔 SHA-256만 저장, 언제든 끊기(삭제) 가능
  · 토큰마다: 쓸 수 있는 AI(주인 계정 범위 안에서만), 하루 한도(USD) — 주인 하루 한도·전체 한도도 같이 적용
*/
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { DEFAULT_MODELS, hasKey } from "./env";
import * as P from "./providers";
import PRICING from "./pricing.json";
import type { Provider } from "./env";
import { addCost, newId, nowIso, spentToday, today } from "./db";
import { getUser } from "./auth";
import { checkGlobalBudget } from "./security";
import { mockStream } from "./chat";

export const API_PROVIDERS = ["cf", "claude", "gpt", "gemini"] as const;
const MAX_TOKENS_CAP = 8192;
const MAX_INPUT_CHARS = 200_000;
const MAX_IMAGES = 1, MAX_IMAGE_BYTES = 300 * 1024, IMG_TOKENS_EST = 1600;
export const CF_VISION_DEFAULT = "@cf/meta/llama-4-scout-17b-16e-instruct";
const visionModels = (prov: string) => prov === "cf" ? [CF_VISION_DEFAULT, ...[...P.CF_VISION].filter(m => m !== CF_VISION_DEFAULT && !CF_VISION_HIDDEN.has(m))] : ["(이 provider의 모든 모델)"];
const CF_VISION_HIDDEN = new Set(["@cf/meta/llama-3.2-11b-vision-instruct"]);   // 사용 조건 동의('agree')가 먼저 필요한 모델

/** 그림 조각 확인 → base64 문자열 */
function checkImage(part: any): string {
  const mt = String(part?.media_type || "");
  if (mt !== "image/jpeg" && mt !== "image/png") throw new HTTPException(400, { message: "그림은 image/jpeg 또는 image/png만" });
  const data = String(part?.data || "").replace(/\s+/g, "");
  if (!data || data.startsWith("data:") || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HTTPException(400, { message: "그림 data는 'data:' 머리말 없는 base64여야 해요" });
  const bytes = Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new HTTPException(400, { message: `그림이 너무 커요 (${Math.round(bytes / 1024)}KB, ${MAX_IMAGE_BYTES / 1024}KB까지)` });
  const real = P.imgMime(data);
  if (real !== mt) throw new HTTPException(400, { message: `media_type(${mt})과 실제 그림(${real})이 달라요` });
  return data;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

export type ApiToken = { id: string; user: string; name: string; providers: string[]; daily_limit: number; created: string; last_used: string | null };

// ── 관리 (로그인한 사람이 자기 것만) ──
export async function list(env: Env, user: string) {
  const rows = (await env.DB.prepare("SELECT id,name,providers,daily_limit,created,last_used FROM api_tokens WHERE user=? ORDER BY created DESC").bind(user).all<any>()).results;
  return rows.map(r => ({ ...r, providers: JSON.parse(r.providers || "[]"), spent_today: 0 }));
}
export async function create(env: Env, user: string, req: any, allowedForUser: string[] | null) {
  const name = String(req?.name || "").trim().slice(0, 40);
  if (!name) throw new HTTPException(400, { message: "토큰 이름을 입력하세요 (예: 다른 채팅용)" });
  let provs = (Array.isArray(req?.providers) ? req.providers : ["cf"]).map(String).filter((p: string) => (API_PROVIDERS as readonly string[]).includes(p));
  if (allowedForUser) provs = provs.filter((p: string) => allowedForUser.includes(p));
  if (!provs.length) throw new HTTPException(400, { message: "쓸 수 있는 AI를 하나 이상 골라 주세요 (내 계정에 허락된 것만)" });
  const limit = Math.max(0.01, Math.min(Number(req?.daily_limit ?? 1) || 1, 100));
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user=?").bind(user).first<{ n: number }>();
  if ((n?.n || 0) >= 10) throw new HTTPException(400, { message: "토큰은 10개까지예요. 안 쓰는 것을 지워 주세요" });
  const id = newId(10), token = "triai_" + newId(24) + newId(24);
  await env.DB.prepare("INSERT INTO api_tokens(id,user,name,hash,providers,daily_limit,created) VALUES(?,?,?,?,?,?,?)")
    .bind(id, user, name, await sha256(token), JSON.stringify(provs), limit, nowIso()).run();
  return { id, name, providers: provs, daily_limit: limit, token };
}
export async function remove(env: Env, user: string, id: string) {
  const r = await env.DB.prepare("DELETE FROM api_tokens WHERE id=? AND user=?").bind(String(id), user).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: "토큰을 찾을 수 없어요" });
  return { ok: true };
}

// ── 토큰으로 들어온 요청 ──
async function auth(env: Env, header: string | undefined) {
  const tok = (header || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^triai_[A-Za-z0-9]{20,80}$/.test(tok)) throw new HTTPException(401, { message: "TriAI 토큰이 없거나 모양이 틀려요 (Authorization: Bearer triai_…)" });
  const r = await env.DB.prepare("SELECT * FROM api_tokens WHERE hash=?").bind(await sha256(tok)).first<any>();
  if (!r) throw new HTTPException(401, { message: "모르는 TriAI 토큰이에요 (삭제됐거나 틀림)" });
  const owner = await getUser(env, r.user);
  if (!owner) throw new HTTPException(401, { message: "토큰 주인 계정이 없어요" });
  let provs: string[] = JSON.parse(r.providers || "[]");
  if (owner.providers) provs = provs.filter(p => owner.providers!.includes(p));   // 주인 계정 범위가 줄어들면 토큰도 같이 줄어듦
  return { tok: r as ApiToken & { hash: string }, owner, provs };
}
const tokKey = (id: string) => `apitok:${id}:${today()}`;
const tokSpent = async (env: Env, id: string) => Number(await env.KV.get(tokKey(id))) || 0;

export async function models(env: Env, header: string | undefined) {
  const { provs } = await auth(env, header);
  return { providers: provs.filter(p => hasKey(env, p)).map(p => ({ provider: p, default_model: DEFAULT_MODELS[p as keyof typeof DEFAULT_MODELS],
    vision: true, vision_model: p === "cf" ? CF_VISION_DEFAULT : DEFAULT_MODELS[p as keyof typeof DEFAULT_MODELS] })),
    image_limits: { per_request: MAX_IMAGES, max_kb: MAX_IMAGE_BYTES / 1024, types: ["image/jpeg", "image/png"] } };
}

export async function chat(env: Env, header: string | undefined, body: any, signal?: AbortSignal) {
  const { tok, owner, provs } = await auth(env, header);
  const prov = String(body?.provider || "cf");
  if (!(API_PROVIDERS as readonly string[]).includes(prov)) throw new HTTPException(400, { message: `provider는 ${API_PROVIDERS.join("·")} 중 하나` });
  if (!provs.includes(prov)) throw new HTTPException(403, { message: `이 토큰으로는 '${prov}'를 쓸 수 없어요. 쓸 수 있는 것: ${provs.join(", ") || "없음"}` });
  if (!hasKey(env, prov)) throw new HTTPException(503, { message: `TriAI에 ${prov} 키가 없어요` });
  // 메시지 정리
  const raw = Array.isArray(body?.messages) ? body.messages : typeof body?.prompt === "string" ? [{ role: "user", content: body.prompt }] : [];
  let nImg = 0;
  const messages: P.Msg[] = raw.slice(-60).map((m: any) => {
    const role = m?.role === "assistant" ? "assistant" : "user";
    if (!Array.isArray(m?.content)) return { role, content: String(m?.content ?? "") };
    // 조각 배열: {"type":"text","text":…} · {"type":"image","media_type":"image/jpeg","data":"<base64>"}
    const texts: string[] = [], images: string[] = [];
    for (const part of m.content) {
      if (part?.type === "text") texts.push(String(part.text ?? ""));
      else if (part?.type === "image") {
        if (role !== "user") throw new HTTPException(400, { message: "그림은 user 메시지에만 넣을 수 있어요" });
        images.push(checkImage(part)); nImg++;
      } else throw new HTTPException(400, { message: `모르는 조각 type '${String(part?.type).slice(0, 20)}' — text 또는 image` });
    }
    return { role, content: texts.join("\n"), ...(images.length ? { images } : {}) };
  });
  if (nImg > MAX_IMAGES) throw new HTTPException(400, { message: `그림은 요청 1번에 ${MAX_IMAGES}장까지` });
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new HTTPException(400, { message: "messages의 마지막은 user여야 해요 (또는 prompt 하나)" });
  const chars = messages.reduce((n, m) => n + m.content.length, 0) + String(body?.system || "").length;
  if (chars > MAX_INPUT_CHARS) throw new HTTPException(413, { message: `입력이 너무 길어요 (${MAX_INPUT_CHARS.toLocaleString()}자까지)` });
  const model = String(body?.model || (nImg && prov === "cf" ? CF_VISION_DEFAULT : DEFAULT_MODELS[prov as keyof typeof DEFAULT_MODELS])).slice(0, 120);
  if (nImg && !P.canSee(prov, model)) throw new HTTPException(400, { res: Response.json({ error: "no_vision", detail: `이 모델(${model})은 그림을 못 봄. 그림을 볼 수 있는 모델: ${visionModels(prov).join(", ")}` }, { status: 400 }) });
  const maxTok = Math.max(16, Math.min(Number(body?.max_tokens) || 2048, MAX_TOKENS_CAP));
  // 예산: 토큰 하루 한도 · 주인 하루 한도 · 전체 한도
  const estRaw = P.estimateCost(model, { in: Math.ceil(chars / 2), cached: 0, write: 0, out: maxTok }, prov);
  if (estRaw == null && prov !== "cf") {   // 가격표에 없는 유료 모델은 한도 계산이 안 되니 막음
    const known = Object.keys(PRICING).filter(k => !k.startsWith("_") && k.startsWith(prov === "claude" ? "claude-" : prov === "gpt" ? "gpt-" : "gemini-"));
    throw new HTTPException(400, { message: `'${model}'은 가격표에 없어서 한도를 계산할 수 없어요. 쓸 수 있는 모델: ${known.join(", ")}` });
  }
  const est = (estRaw || 0) + (nImg ? (P.estimateCost(model, { in: IMG_TOKENS_EST * nImg, cached: 0, write: 0, out: 0 }, prov) || 0) : 0);   // 그림 토큰 (넉넉히 추정)
  const tSpent = await tokSpent(env, tok.id);
  if (tSpent + est > tok.daily_limit) throw new HTTPException(402, { message: `이 토큰의 오늘 한도($${tok.daily_limit.toFixed(2)})에 닿았어요 (쓴 돈 $${tSpent.toFixed(4)}, 이번 예상 $${est.toFixed(4)})` });
  const oSpent = await spentToday(env, owner.name);
  if (owner.daily_limit && oSpent + est > owner.daily_limit) throw new HTTPException(402, { message: `주인 계정의 오늘 한도($${owner.daily_limit.toFixed(2)})에 닿았어요` });
  await checkGlobalBudget(env, est);
  // 실행 (스트리밍을 모아서 한 번에)
  let text = "", thinking = "", usage: (P.Usage & { cost?: number }) | null = null;
  const t0 = Date.now();
  try {
    for await (const ev of (env.TRIAI_MOCK_AI ? mockStream : P.STREAMERS[prov as Provider])(env, model, messages, String(body?.system || "").slice(0, 50_000), maxTok,
      { temperature: body?.temperature != null ? Number(body.temperature) : undefined, signal })) {
      if (ev.t === "delta") text += ev.d; else if (ev.t === "think") thinking += ev.d; else if (ev.t === "usage") usage = ev.u;
    }
  } catch (e: any) {
    throw new HTTPException(502, { message: `${P.friendlyError(String(e?.message || e))} — ${P.redact(String(e?.message || e)).slice(0, 300)}` });
  }
  const u = usage || { in: Math.ceil(chars / 2), cached: 0, write: 0, out: Math.ceil(text.length / 2) };
  const cost = usage?.cost ?? P.estimateCost(model, u, prov) ?? 0;
  await addCost(env, owner.name, prov, cost);
  await env.KV.put(tokKey(tok.id), String(tSpent + cost), { expirationTtl: 3 * 86400 });
  await env.DB.prepare("UPDATE api_tokens SET last_used=? WHERE id=?").bind(nowIso(), tok.id).run();
  return { text, ...(thinking ? { thinking: thinking.slice(0, 20000) } : {}), provider: prov, model, usage: { input: u.in, output: u.out }, cost: Math.round(cost * 1e6) / 1e6,
    sec: Math.round((Date.now() - t0) / 10) / 100, token_spent_today: Math.round((tSpent + cost) * 1e6) / 1e6, token_daily_limit: tok.daily_limit };
}
