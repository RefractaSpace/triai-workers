/* catalog.ts — 프리셋(생성 설정) · 모드([+] 메뉴) · 스타일(문체) (파이 presets.py / modes.py / styles.py) */
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { hasKey, KEY_NAMES } from "./env";
import { kvGet, kvPut, newId, nowIso } from "./db";
import { askOnce, pickModel } from "./compact";

// ── 프리셋 ──
export const FIELDS = ["temperature", "top_p", "top_k", "repeat_penalty", "seed", "num_predict"] as const;
const LIMITS: Record<string, [number, number]> = { temperature: [0, 2], top_p: [0, 1], top_k: [1, 500], repeat_penalty: [0.5, 2], seed: [0, 2 ** 31 - 1], num_predict: [16, 32768] };
export const BUILTIN_PRESETS = [
  { id: "default", name: "기본", builtin: true, desc: "모델 기본값 그대로" },
  { id: "precise", name: "정확하게", builtin: true, desc: "코딩·계산·사실 질문 — 매번 비슷하고 정확한 답", temperature: 0.2, top_p: 0.9, repeat_penalty: 1.05 },
  { id: "creative", name: "창의적으로", builtin: true, desc: "글쓰기·아이디어 — 다양하고 새로운 답", temperature: 1.0, top_p: 0.95, repeat_penalty: 1.1 },
  { id: "json", name: "JSON으로만", builtin: true, desc: "프로그램에서 쓸 데이터 — 답을 JSON 형식으로 강제", temperature: 0.2, format: "json" },
];
export const presetsLoad = async (env: Env, user: string) => [...BUILTIN_PRESETS, ...(await kvGet<any[]>(env, user, "presets", []))];
export async function presetParams(env: Env, user: string, pid?: string | null): Promise<Record<string, any>> {
  if (!pid) return {};
  const p = (await presetsLoad(env, user)).find(x => x.id === pid);
  if (!p) return {};
  const out: Record<string, any> = {};
  for (const k of FIELDS) if ((p as any)[k] != null) out[k] = (p as any)[k];
  if ((p as any).format) out.format = (p as any).format;
  return out;
}
export function presetClean(req: any) {
  const name = String(req?.name || "").trim();
  if (!name) throw new HTTPException(400, { message: "프리셋 이름을 입력하세요" });
  const d: Record<string, any> = { name: name.slice(0, 20), desc: String(req.desc || "").trim().slice(0, 100) };
  for (const k of FIELDS) {
    const v = req[k];
    if (v != null && v !== "") {
      const n = Number(v), [lo, hi] = LIMITS[k];
      if (!(n >= lo && n <= hi)) throw new HTTPException(400, { message: `${k}는 ${lo}~${hi} 사이여야 해요` });
      d[k] = n;
    }
  }
  const f = String(req.format || "").trim();
  if (f && f !== "json") {
    let schema: any;
    try { schema = JSON.parse(f); } catch (e: any) { throw new HTTPException(400, { message: `JSON 스키마 형식이 틀렸어요: ${e.message}` }); }
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new HTTPException(400, { message: "JSON 스키마는 {...} 모양이어야 해요" });
    d.format = schema;
  } else if (f === "json") d.format = "json";
  return d;
}
export async function presetSave(env: Env, user: string, items: any[]) { await kvPut(env, user, "presets", items); }

// ── 모드 ──
type Mode = { icon: string; name: string; desc: string; model: [string, string]; fallback: [string, string][]; web: boolean; deep: boolean; prompt: string };
export const MODES: Record<string, Mode> = {
  research: { icon: "🔬", name: "연구", desc: "여러 자료를 찾아 읽고 출처를 단 보고서로", model: ["cf", "@cf/openai/gpt-oss-120b"], fallback: [["claude", "claude-sonnet-5-5"]], web: true, deep: true,
    prompt: "[모드: 연구]\n사용자의 질문을 깊게 조사한 보고서를 써. 앱이 질문을 여러 검색어로 나눠 미리 찾고 읽어 둔 자료([번호])가 질문 끝에 붙어 있어. 그 자료를 먼저 쓰고, 자료끼리 다르면 그 차이를 밝혀. 보고서: **한 줄 결론** → 핵심 발견(출처 번호) → 자세한 내용 → 확실하지 않은 점·한계. 출처 없는 숫자·사실은 쓰지 마. 추측은 추측이라고 표시해." },
  code: { icon: "💻", name: "코딩", desc: "코드 작성·디버깅·리뷰 특화 모델", model: ["cf", "@cf/zai-org/glm-5.3"], fallback: [["cf", "@cf/openai/gpt-oss-120b"], ["claude", "claude-sonnet-5-5"]], web: false, deep: false,
    prompt: "[모드: 코딩]\n너는 숙련된 소프트웨어 엔지니어야. 코드는 붙여 넣으면 바로 돌아가는 완성본으로, 언어 이름을 붙인 코드 블록에 써. 버그를 고칠 때는 원인을 한 문장으로 먼저 말하고 고친 부분을 보여줘. 확실하지 않은 라이브러리 함수 이름은 지어내지 말고 그렇다고 말해." },
  reason: { icon: "🧮", name: "추론·수학", desc: "증명·어려운 문제를 오래 생각해서", model: ["cf", "@cf/deepseek-ai/deepseek-v4-pro-0813"], fallback: [["cf", "@cf/openai/gpt-oss-120b"], ["claude", "claude-sonnet-5-5"]], web: false, deep: true,
    prompt: "[모드: 추론·수학]\n천천히 단계별로 생각해. 정의를 먼저 정확히 쓰고, 각 단계에 근거를 달고, 계산은 손으로 검산해. 마지막에 '검증 결과: 맞음/틀림/확인 불가'를 써. 결론에 맞추려고 중간 결과를 바꾸지 마." },
  vision: { icon: "👁", name: "사진 보고 답하기", desc: "올린 사진·화면·문제 사진을 보고 답해요", model: ["cf", "@cf/meta/llama-4-scout-17b-16e-instruct"], fallback: [["claude", "claude-haiku-5-5"]], web: false, deep: false,
    prompt: "[모드: 사진 보기]\n첨부한 사진을 자세히 보고 답해. 사진에서 보이는 것과 추측을 구분해서 말해. 글자가 있으면 그대로 옮겨 적어." },
};
export async function modeGet(env: Env, user: string, mid: string): Promise<Mode> {
  if (!(mid in MODES)) throw new HTTPException(400, { message: `모르는 모드예요: ${mid}` });
  const m = { ...MODES[mid] };
  const o = (await kvGet<Record<string, any>>(env, user, "modes", {}))[mid] || {};
  if (o.provider && o.model) m.model = [o.provider, o.model];
  return m;
}
export async function modePick(env: Env, user: string, mid: string): Promise<[string, string]> {
  const m = await modeGet(env, user, mid);
  for (const [p, model] of [m.model, ...m.fallback]) if (hasKey(env, p)) return [p, model];
  throw new HTTPException(400, { message: `${m.icon} ${m.name} 모드에 쓸 AI가 없어요 (키 확인: ${m.model[0]})` });
}
export async function modesPublic(env: Env, user: string) {
  const out = [];
  for (const mid of Object.keys(MODES)) {
    const m = await modeGet(env, user, mid);
    let prov = m.model[0], model = m.model[1], ok = true;
    try { [prov, model] = await modePick(env, user, mid); } catch { ok = false; }
    out.push({ id: mid, icon: m.icon, name: m.name, desc: m.desc, provider: prov, model, chosen: { provider: m.model[0], model: m.model[1] }, available: ok, web: m.web, deep: m.deep });
  }
  return out;
}
export async function modeSet(env: Env, user: string, mid: string, req: any) {
  await modeGet(env, user, mid);
  const o = await kvGet<Record<string, any>>(env, user, "modes", {});
  const cur = o[mid] || {};
  if (req.provider != null) {
    if (!req.provider) { delete cur.provider; delete cur.model; }
    else if (!(req.provider in KEY_NAMES) || !String(req.model || "").trim()) throw new HTTPException(400, { message: "AI 종류와 모델 이름을 모두 골라 주세요" });
    else { cur.provider = req.provider; cur.model = String(req.model).trim(); }
  }
  o[mid] = cur;
  await kvPut(env, user, "modes", o);
  return (await modesPublic(env, user)).find(x => x.id === mid);
}

// ── 스타일 ──
const ANALYZE_PROMPT = "아래 글을 쓴 사람의 문체를 분석해서, 다른 AI가 이 문체를 그대로 따라 쓸 수 있도록 지시문으로 정리해.\n다음을 포함해서 6~10줄로, 각 줄은 '- '로 시작:\n말투(존댓말/반말, 어미), 문장 길이와 리듬, 자주 쓰는 표현이나 습관, 글의 구조(제목·목록 사용 여부), 어휘 수준, 감정 표현 정도, 피해야 할 것.\n글의 '내용'은 따라 하지 말고 '쓰는 방식'만 정리해. 지시문만 답해.\n\n[글]\n";
export const stylesLoad = (env: Env, user: string) => kvGet<any[]>(env, user, "styles", []);
export async function styleGet(env: Env, user: string, sid: string) { return (await stylesLoad(env, user)).find(s => s.id === sid) || null; }
export async function styleAnalyze(env: Env, sample: string, allowed?: Set<string> | null): Promise<string> {
  const pm = await pickModel(env, allowed || undefined);
  if (!pm) throw new HTTPException(400, { message: "사용할 수 있는 AI가 없어요" });
  const text = await askOnce(env, pm[0], pm[1], "문체 분석가로서 정확하게 답해.", ANALYZE_PROMPT + sample.slice(0, 8000), 800);
  const lines = text.split("\n").map(l => l.trim()).filter(l => /^[-•*] /.test(l));
  return lines.length ? lines.join("\n") : text.trim();
}
export async function styleCreate(env: Env, user: string, req: any, allowed?: Set<string> | null) {
  const name = String(req?.name || "").trim();
  if (!name) throw new HTTPException(400, { message: "스타일 이름을 입력하세요" });
  let desc = String(req.description || "").trim();
  if (!desc) {
    if (String(req.sample || "").trim().length < 200) throw new HTTPException(400, { message: "문체를 분석하려면 글이 200자 이상 필요해요 (길수록 정확해요)" });
    desc = await styleAnalyze(env, String(req.sample), allowed);
  }
  const styles = await stylesLoad(env, user);
  const s = { id: newId(8), name: name.slice(0, 20), description: desc.slice(0, 3000), created: nowIso() };
  await kvPut(env, user, "styles", [...styles, s]);
  return s;
}
