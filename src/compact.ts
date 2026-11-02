/* compact.ts — 긴 대화 자동 요약 (파이 compact.py): 답이 끝난 뒤 뒤에서(waitUntil) 오래된 턴을 요약 한 장으로 */
import type { Env } from "./env";
import { hasKey, DEFAULT_MODELS } from "./env";
import * as P from "./providers";
import { Conv, Turn, bestText, fingerprint, summaryValid } from "./history";
import { loadConv, updateConv } from "./db";

export const KEEP = 4, RATIO = 0.6, MAX_ANSWER = 4000, MAX_INPUT = 80_000, SUMMARY_MAX = 6000, FILE_CHARS = 6000;
const PROMPT = (limit: number, prev: string, body: string) => `아래는 사용자와 AI의 지난 대화야. 이어서 대화할 AI가 읽을 '기억 메모'로 요약해.
규칙:
- 사용자의 목표, 정한 결정, 숫자·이름·파일명·코드의 핵심(함수 이름, 설정값), 아직 남은 할 일을 빠짐없이
- 첨부 파일은 파일 이름과 핵심 내용(중요한 숫자·구조·결론)을 남김
- 잡담·인사·같은 말 반복은 버림
- 사용자가 싫다고 한 것, 말투·형식 요청도 꼭 남김
- 한국어, 항목(-) 위주, 최대 ${limit}자
${prev}
[요약할 대화]
${body}`;

export const turnChars = (t: Turn) => (t.q || "").length + bestText(t).length + (t.files || []).filter((f: any) => !f.indexed).reduce((n: number, f: any) => n + (f.content || "").length, 0);

export async function needs(conv: Conv, historyChars: number): Promise<[number, number] | null> {
  const sm = await summaryValid(conv);
  const start = sm ? sm.upto : 0, end = conv.turns.length - KEEP;
  if (end <= start) return null;
  const raw = conv.turns.slice(start).reduce((n, t) => n + turnChars(t), 0) + (sm ? sm.text.length : 0);
  return raw > historyChars * RATIO ? [start, end] : null;
}

const CHEAP: Record<string, string> = { cf: "@cf/openai/gpt-oss-20b", claude: "claude-haiku-5-5" };
const ORDER = ["cf", "claude", "gpt", "gemini"];
export const usedProviders = (conv: Conv) => new Set(conv.turns.flatMap(t => Object.keys(t.answers || {}).map(k => k.split("@")[0])));

/** 요약·조사 계획용 싼 모델. allowed가 있으면 그 회사들 중에서만 (대화 내용이 원래 안 가던 곳으로 새지 않게) */
export async function pickModel(env: Env, allowed?: Set<string>): Promise<[string, string] | null> {
  for (const p of ORDER) {
    if (allowed && !allowed.has(p)) continue;
    if (!hasKey(env, p) || (p === "cf" && await P.cfExhausted(env))) continue;
    return [p, CHEAP[p] || DEFAULT_MODELS[p as keyof typeof DEFAULT_MODELS]];
  }
  return null;
}

export async function buildPrompt(conv: Conv, start: number, end: number): Promise<string> {
  const sm = await summaryValid(conv);
  const parts: string[] = []; let total = 0;
  for (let i = start; i < end; i++) {
    const t = conv.turns[i];
    let a = bestText(t);
    if (a.length > MAX_ANSWER) a = a.slice(0, MAX_ANSWER / 2) + "\n…(중략)…\n" + a.slice(-MAX_ANSWER / 2);
    let files = "";
    for (const f of t.files || []) {
      if (f.indexed || f.raw) files += `[첨부: ${f.name} — 원본은 따로 보관]\n`;
      else { const c = f.content || ""; files += `[첨부: ${f.name}]\n${c.slice(0, FILE_CHARS)}${c.length > FILE_CHARS ? "…(뒷부분 생략)" : ""}\n`; }
    }
    const chunk = `### ${i + 1}번째\n${files}사용자: ${(t.q || "").slice(0, 3000)}\nAI: ${a}\n`;
    total += chunk.length;
    if (total > MAX_INPUT) { parts.push("…(너무 길어서 뒷부분 생략)…"); break; }
    parts.push(chunk);
  }
  const prev = sm && start > 0 ? `\n[이전 요약 — 이것도 합쳐서 하나로]\n${sm.text}\n` : "";
  return PROMPT(SUMMARY_MAX / 2, prev, parts.join("\n"));
}

/** 한 모델에게 짧게 묻기 (스트리밍 모아서 글만) — 요약·계획·문체 분석 공용 */
export async function askOnce(env: Env, provider: string, model: string, system: string, prompt: string, maxTokens: number, mock?: boolean): Promise<string> {
  if (env.TRIAI_MOCK_AI || mock) return `(가짜 ${model}) ` + prompt.slice(0, 60);
  const s = P.STREAMERS[provider as P.Provider];
  if (!s) return "";
  let text = "";
  for await (const ev of s(env, model, [{ role: "user", content: prompt }], system, maxTokens, {})) if (ev.t === "delta") text += ev.d;
  return text.trim();
}

/** 요약이 필요하면 만들어서 저장 */
export async function summarize(env: Env, user: string, convId: string, historyChars: number): Promise<void> {
  const conv = await loadConv(env, user, convId);
  const rng = await needs(conv, historyChars);
  if (!rng) return;
  const pm = await pickModel(env, usedProviders(conv));
  if (!pm) return;
  const [start, end] = rng;
  const text = (await askOnce(env, pm[0], pm[1], "너는 대화를 정확하게 요약하는 기록 담당이야. 지어내지 말고 대화에 있는 것만 적어.", await buildPrompt(conv, start, end), 3000)).trim();
  if (text.length < 20) return;
  const sig = await fingerprint(conv.turns.slice(0, end));
  const sm = { upto: end, text: text.slice(0, SUMMARY_MAX), time: Date.now() / 1000, model: pm[1], sig };
  const fresh = await loadConv(env, user, convId);   // 요약하는 동안 그 턴들이 바뀌었으면 버림
  if (fresh.turns.length >= end && await fingerprint(fresh.turns.slice(0, end)) === sig) await updateConv(env, user, convId, c => { c.summary = sm; });
}
