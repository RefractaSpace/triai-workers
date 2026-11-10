/*
providers.ts — 네 회사 API를 공통 스트리밍 이벤트로 (파이 때 providers.py와 같은 규약)
  {t:"delta", d}  답 조각 · {t:"think", d} 생각 조각 · {t:"tick"} 살아있음 · {t:"usage", u:{in,cached,write,out}} 마지막 1번
SDK 없이 fetch + SSE 직접 파싱 (Workers에서 가볍게)
*/
import { Env, Provider, DEFAULT_MODELS, hasKey, missingMsg } from "./env";
export type { Provider };
import PRICING from "./pricing.json";

export type Msg = { role: "user" | "assistant"; content: string; images?: string[] };
export type Ev = { t: "delta"; d: string } | { t: "think"; d: string } | { t: "tick" } | { t: "usage"; u: Usage };
export type Usage = { in: number; cached: number; write: number; out: number };
export type GenOpts = { deep?: boolean; temperature?: number; top_p?: number; top_k?: number; format?: any; signal?: AbortSignal; extra?: Record<string, any> };

const DEEP_MAX_TOKENS = 32000;

export const CF_MODELS = [
  "@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b", "@cf/zai-org/glm-5.3", "@cf/zai-org/glm-5.3-flash",
  "@cf/moonshotai/kimi-k2.7-code", "@cf/deepseek-ai/deepseek-v4-pro-0813", "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  "@cf/qwen/qwen3.8-27b", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/google/gemma-4-26b-a4b-it", "@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/qwen/qwq-32b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
];
export const CF_VISION = new Set(["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct", "@cf/zai-org/glm-5.3-flash", "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  "@cf/qwen/qwen3.8-27b", "@cf/moonshotai/kimi-k2.6"]);

export function canSee(p: string, model: string): boolean {
  return p === "claude" || p === "gpt" || p === "gemini" || (p === "cf" && CF_VISION.has(model));
}

export function imgMime(b64: string): string {
  for (const [sig, mime] of [["iVBOR", "image/png"], ["/9j/", "image/jpeg"], ["R0lGOD", "image/gif"], ["UklGR", "image/webp"]])
    if (b64.startsWith(sig)) return mime;
  return "image/png";
}

export function estimateCost(model: string, u: Usage, provider?: string): number | null {
  const p = (PRICING as unknown as Record<string, { input: number; output: number; cached_input?: number; cache_write?: number }>)[model];
  if (!p) return null;
  const cached = p.cached_input ?? p.input * 0.1, write = p.cache_write ?? p.input * 1.25;
  const plain = Math.max(u.in - u.cached - u.write, 0);
  return (plain * p.input + u.cached * cached + u.write * write + u.out * p.output) / 1e6;
}

// ── SSE 읽기: "data: {...}" 줄을 JSON으로 하나씩 ──
export async function* sse(res: Response): AsyncGenerator<any> {
  if (!res.body) return;
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { yield JSON.parse(data); } catch { /* 조각난 줄은 건너뜀 */ }
    }
  }
}

async function fail(res: Response, who: string): Promise<never> {
  const body = (await res.text()).slice(0, 400);
  throw new Error(`${who} ${res.status}: ${body}`);
}

// ── Claude (Messages API, 캐시 표시 포함) ──
async function* streamClaude(env: Env, model: string, messages: Msg[], system: string, maxTokens: number, o: GenOpts): AsyncGenerator<Ev> {
  const key = env.ANTHROPIC_API_KEY!, ws = (env.ANTHROPIC_WORKSPACE_ID || "").trim();
  if (key.startsWith("sk-ant-usr-") && !ws) throw new Error("이 Claude 키(sk-ant-usr-)는 ANTHROPIC_WORKSPACE_ID 비밀값이 필요해요");
  const msgs: any[] = messages.map(m => {
    const imgs = m.images || [];
    if (imgs.length && m.role === "user")
      return { role: m.role, content: [...imgs.map(b => ({ type: "image", source: { type: "base64", media_type: imgMime(b), data: b } })),
                                        { type: "text", text: m.content || "(그림)" }] };
    return { role: m.role, content: m.content };
  });
  for (let i = msgs.length - 2; i >= 0; i--)   // 마지막 AI 답에 캐시 지점 → 다음 질문 때 그 앞은 싸게
    if (msgs[i].role === "assistant" && typeof msgs[i].content === "string") {
      msgs[i].content = [{ type: "text", text: msgs[i].content, cache_control: { type: "ephemeral" } }]; break;
    }
  const body: any = { model, max_tokens: maxTokens, messages: msgs, stream: true };
  if (system) body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  if (o.deep) { body.max_tokens = Math.max(maxTokens, DEEP_MAX_TOKENS); body.thinking = { type: "adaptive" }; body.output_config = { effort: "high" }; }
  else if (o.temperature != null) body.temperature = Math.min(1, o.temperature);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: o.signal,
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", ...(ws ? { "anthropic-workspace-id": ws } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, "Claude");
  const u: Usage = { in: 0, cached: 0, write: 0, out: 0 };
  for await (const ev of sse(res)) {
    if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta") yield { t: "delta", d: ev.delta.text };
      else if (ev.delta?.type === "thinking_delta") yield { t: "think", d: ev.delta.thinking };
      else yield { t: "tick" };
    } else if (ev.type === "message_start") {
      const mu = ev.message?.usage || {};
      u.cached = mu.cache_read_input_tokens || 0; u.write = mu.cache_creation_input_tokens || 0;
      u.in = (mu.input_tokens || 0) + u.cached + u.write;
    } else if (ev.type === "message_delta") {
      u.out = ev.usage?.output_tokens ?? u.out;
    } else if (ev.type === "error") throw new Error(`Claude: ${JSON.stringify(ev.error).slice(0, 300)}`);
    else yield { t: "tick" };
  }
  yield { t: "usage", u };
}

// ── GPT (Responses API) ──
async function* streamGpt(env: Env, model: string, messages: Msg[], system: string, maxTokens: number, o: GenOpts): AsyncGenerator<Ev> {
  const input = messages.map(m => {
    const imgs = m.images || [];
    if (imgs.length && m.role === "user")
      return { role: "user", content: [{ type: "input_text", text: m.content || "(그림)" }, ...imgs.map(b => ({ type: "input_image", image_url: `data:${imgMime(b)};base64,${b}` }))] };
    return { role: m.role, content: m.content };
  });
  const body: any = { model, input, max_output_tokens: maxTokens, stream: true };
  if (system) body.instructions = system;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", signal: o.signal, headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, "GPT");
  let u: Usage = { in: 0, cached: 0, write: 0, out: 0 };
  for await (const ev of sse(res)) {
    if (ev.type === "response.output_text.delta") yield { t: "delta", d: ev.delta };
    else if (ev.type === "response.completed") {
      const ru = ev.response?.usage || {};
      u = { in: ru.input_tokens || 0, cached: ru.input_tokens_details?.cached_tokens || 0, write: 0, out: ru.output_tokens || 0 };
    } else if (ev.type === "error" || ev.type === "response.failed") throw new Error(`GPT: ${JSON.stringify(ev.error || ev.response?.error).slice(0, 300)}`);
    else yield { t: "tick" };
  }
  yield { t: "usage", u };
}

// ── Gemini (streamGenerateContent, SSE) ──
async function* streamGemini(env: Env, model: string, messages: Msg[], system: string, maxTokens: number, o: GenOpts): AsyncGenerator<Ev> {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content || "(그림)" }, ...(m.images || []).map(b => ({ inline_data: { mime_type: imgMime(b), data: b } }))],
  }));
  const body: any = { contents, generationConfig: { maxOutputTokens: maxTokens, ...(o.temperature != null ? { temperature: o.temperature } : {}), ...(o.top_p != null ? { topP: o.top_p } : {}), ...(o.top_k != null ? { topK: o.top_k } : {}), ...(o.format === "json" ? { responseMimeType: "application/json" } : {}) } };
  if (system) body.system_instruction = { parts: [{ text: system }] };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST", signal: o.signal, headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! }, body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, "Gemini");
  let usage: any = null;
  for await (const ev of sse(res)) {
    const parts = ev.candidates?.[0]?.content?.parts || [];
    let got = false;
    for (const p of parts) if (p.text) { got = true; yield p.thought ? { t: "think", d: p.text } : { t: "delta", d: p.text }; }
    if (!got) yield { t: "tick" };
    if (ev.usageMetadata) usage = ev.usageMetadata;
    if (ev.promptFeedback?.blockReason) throw new Error(`Gemini: 차단됨 (${ev.promptFeedback.blockReason})`);
  }
  const g = (k: string) => (usage?.[k] || 0) as number;
  yield { t: "usage", u: { in: g("promptTokenCount"), cached: g("cachedContentTokenCount"), write: 0, out: g("candidatesTokenCount") + g("thoughtsTokenCount") } };
}

// ── Cloudflare Workers AI (OpenAI 호환 채팅) ──
export const CF_QUOTA_MSG = "CF_QUOTA: Cloudflare 무료 AI의 오늘 한도(하루 1만 뉴런)를 다 썼어요 — 한국 시간 오전 9시(UTC 0시)에 다시 채워져요";
export async function cfExhausted(env: Env): Promise<boolean> { return !!(await env.KV.get("cf_exhausted")); }
async function cfMarkExhausted(env: Env) {
  const now = new Date(); const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  await env.KV.put("cf_exhausted", "1", { expirationTtl: Math.max(60, Math.floor((next - now.getTime()) / 1000)) });
}
function isCfQuota(e: unknown): boolean { const s = String(e).toLowerCase(); return ["neuron", "free allocation", "4006"].some(k => s.includes(k)); }

async function* streamCf(env: Env, model: string, messages: Msg[], system: string, maxTokens: number, o: GenOpts): AsyncGenerator<Ev> {
  if (await cfExhausted(env)) throw new Error(CF_QUOTA_MSG);
  try { yield* streamCfRaw(env, model, messages, system, maxTokens, o); }
  catch (e) { if (isCfQuota(e)) { await cfMarkExhausted(env); throw new Error(CF_QUOTA_MSG); } throw e; }
}
async function* streamCfRaw(env: Env, model: string, messages: Msg[], system: string, maxTokens: number, o: GenOpts): AsyncGenerator<Ev> {
  const acc = (env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const part = (m: Msg) => (m.images?.length && CF_VISION.has(model))
    ? [{ type: "text", text: m.content || "(사진)" }, ...m.images.map(b => ({ type: "image_url", image_url: { url: `data:${imgMime(b)};base64,${b}` } }))]
    : m.content;
  const msgs = [...(system ? [{ role: "system", content: system }] : []), ...messages.map(m => ({ role: m.role, content: part(m) }))];
  const effort = o.deep ? "high" : undefined;
  const body: any = { model, messages: msgs, max_tokens: effort ? Math.max(maxTokens, DEEP_MAX_TOKENS) : maxTokens, stream: true,
    stream_options: { include_usage: true }, ...(effort ? { reasoning_effort: effort } : {}), ...(o.temperature != null ? { temperature: o.temperature } : {}), ...(o.top_p != null ? { top_p: o.top_p } : {}),
    ...(o.format === "json" ? { response_format: { type: "json_object" } } : {}) };
  let res: Response;
  if (env.AI) {   // 바인딩: 토큰·계정 ID 필요 없음
    const { model: _m, stream_options: _so, ...inp } = body;
    let out: any;
    try { out = await env.AI.run(model, inp, { signal: o.signal }); }
    catch (e: any) { throw new Error(`Cloudflare: ${String(e?.message || e).slice(0, 300)}`); }
    if (out instanceof ReadableStream) res = new Response(out);
    else {   // 스트림이 아니라 한 번에 온 경우
      const text = out?.response ?? out?.choices?.[0]?.message?.content ?? (typeof out === "string" ? out : "");
      const think = out?.choices?.[0]?.message?.reasoning_content;
      if (think) yield { t: "think", d: String(think) };
      if (text) yield { t: "delta", d: String(text) };
      const u = out?.usage || {};
      yield { t: "usage", u: { in: u.prompt_tokens || 0, cached: 0, write: 0, out: u.completion_tokens || 0 } };
      return;
    }
  } else {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/v1/chat/completions`, {
      method: "POST", signal: o.signal, headers: { "content-type": "application/json", authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, body: JSON.stringify(body),
    });
    if (!res.ok) await fail(res, "Cloudflare");
  }
  let usage: any = null;
  for await (const ch of sse(res)) {
    if (ch.usage) usage = ch.usage;
    let got = false;
    for (const c of ch.choices || []) {
      const d = c.delta || {};
      const think = d.reasoning_content || d.reasoning;
      if (think) yield { t: "think", d: String(think) };
      if (d.content != null && d.content !== "") { got = true; yield { t: "delta", d: String(d.content) }; }
    }
    if (typeof ch.response === "string" && ch.response) { got = true; yield { t: "delta", d: ch.response }; }   // 바인딩의 옛 모양 {"response":"…"}
    if (!got) yield { t: "tick" };
    if (ch.error) throw new Error(`Cloudflare: ${JSON.stringify(ch.error).slice(0, 300)}`);
  }
  yield { t: "usage", u: { in: usage?.prompt_tokens || 0, cached: 0, write: 0, out: usage?.completion_tokens || 0 } };
}

export const STREAMERS: Record<Provider, (env: Env, model: string, messages: Msg[], system: string, maxTokens: number, o: GenOpts) => AsyncGenerator<Ev>> = {
  claude: streamClaude, gpt: streamGpt, gemini: streamGemini, cf: streamCf,
};

// ── 모델 목록 (KV에 10분 캐시) · 키 점검 ──
export async function fetchModels(env: Env, p: string): Promise<string[]> {
  if (!hasKey(env, p)) return [];
  if (p === "cf") return [...new Set([DEFAULT_MODELS.cf, ...CF_MODELS])];
  if (p === "claude") {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" } });
    if (!r.ok) await fail(r, "Claude");
    return ((await r.json()) as any).data.map((m: any) => m.id).sort();
  }
  if (p === "gpt") {
    const r = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` } });
    if (!r.ok) await fail(r, "GPT");
    return ((await r.json()) as any).data.map((m: any) => m.id as string).filter((i: string) => /^(gpt|o)/.test(i)).sort();
  }
  if (p === "gemini") {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": env.GEMINI_API_KEY! } });
    if (!r.ok) await fail(r, "Gemini");
    return ((await r.json()) as any).models.filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent") && m.name.includes("gemini"))
      .map((m: any) => String(m.name).replace(/^models\//, "")).sort();
  }
  return [];
}

export async function listModels(env: Env, p: string): Promise<string[]> {
  const ck = `models:${p}`;
  const hit = await env.KV.get(ck, "json") as string[] | null;
  if (hit) return hit;
  try { const ms = await fetchModels(env, p); if (ms.length) await env.KV.put(ck, JSON.stringify(ms), { expirationTtl: 600 }); return ms; }
  catch { return []; }
}

/** 오류 글에서 비밀을 지움 — 회사 API가 돌려준 오류에 주소(계정 ID 자리)·키가 섞여 나와 화면에 보이는 일 방지 */
export function redact(s: string): string {
  return String(s)
    .replace(/\/accounts\/[^/\s"']+/g, "/accounts/***")
    .replace(/\b(cfut_|cfat_|sk-ant-[a-z]+-|sk-proj-|sk-|AIza|ghp_|github_pat_|xox[bp]-)[A-Za-z0-9_\-]{6,}/g, "$1***")
    .replace(/\b[A-Za-z0-9_\-]{40,}\b/g, "***");
}
export function friendlyError(raw: string): string {
  const low = raw.toLowerCase();
  if (low.includes("cf_quota")) return "Cloudflare 무료 한도 소진 (오전 9시에 다시 채워짐)";
  if (["401", "authentication", "api key not valid", "invalid api key", "incorrect api key", "permission_denied", "403"].some(k => low.includes(k))) return "키가 올바르지 않아요";
  if (low.includes("429") || low.includes("quota") || low.includes("rate limit") || low.includes("insufficient")) return "사용 한도 초과 또는 크레딧 부족";
  if (low.includes("not found") || low.includes("404") || low.includes("does not exist")) return "모델 이름이 없어요 — 설정에서 목록 불러오기";
  if (["connect", "timeout", "network", "resolve"].some(k => low.includes(k))) return "인터넷 연결을 확인하세요";
  return "오류 — 자세한 내용은 마우스를 올려 확인";
}

export async function checkKey(env: Env, p: string): Promise<{ ok: boolean; msg: string; detail?: string }> {
  if (!hasKey(env, p)) return { ok: false, msg: missingMsg(p) };
  if (p === "cf") {
    if (env.AI) {
      try { await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8-fast", { messages: [{ role: "user", content: "ok" }], max_tokens: 1 }); return { ok: true, msg: "정상 · Workers AI 바인딩 연결됨 (토큰 필요 없음)" }; }
      catch (e) { return { ok: false, msg: "Workers AI 바인딩 오류", detail: redact(String(e)).slice(0, 300) }; }
    }
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${(env.CLOUDFLARE_ACCOUNT_ID || "").trim()}/ai/models/search?per_page=1`,
        { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
      return r.ok ? { ok: true, msg: "정상 · Workers AI 연결됨" } : { ok: false, msg: r.status === 401 || r.status === 403 ? "토큰이나 계정 ID가 맞지 않아요" : `오류 ${r.status}` };
    } catch (e) { return { ok: false, msg: "인터넷 연결을 확인하세요", detail: String(e).slice(0, 300) }; }
  }
  try { return { ok: true, msg: `정상 · 모델 ${(await fetchModels(env, p)).length}개` }; }
  catch (e) { const raw = String(e); return { ok: false, msg: friendlyError(raw), detail: raw.slice(0, 500) }; }
}
