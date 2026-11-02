/* db.ts — D1 저장소: 대화·설정·사용량·업로드 (사람별로 분리) */
import type { Env } from "./env";
import type { Conv } from "./history";
import { HTTPException } from "hono/http-exception";

export const nowIso = () => {   // 파이와 같은 모양(초 단위, 한국 시간)
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 19);
};
export const today = () => nowIso().slice(0, 10);
export const newId = (n = 12) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, n); };

export function safeId(x: unknown): string {
  const s = String(x ?? "");
  if (!s || !/^[A-Za-z0-9-]{1,40}$/.test(s)) throw new HTTPException(400, { message: "잘못된 ID" });
  return s;
}

export const DEFAULT_SETTINGS = {
  system: "한국어로 명확하고 정확하게 답해줘.", max_tokens: 4000, daily_limit: 1.0, keep_backups: 7, auto_backup: true,
  history_chars: 60000, explore_rate: 0.1, assumed_output: 600, classifier: "keyword", code_tool: true, artifacts: true,
  image_tool: false, memory_enabled: true, web_search: true, search_engine: "duckduckgo", whisper_model: "small",
  agent_steps: 10, rag_threshold: 12000, vram_gb: 0, agent_budget: 2.0, agent_env: "", voice_words: "",
};
export type Settings = typeof DEFAULT_SETTINGS & Record<string, any>;

// ── 사람별 작은 JSON (settings, categories, …) ──
export async function kvGet<T>(env: Env, user: string, key: string, def: T): Promise<T> {
  const r = await env.DB.prepare("SELECT data FROM kv WHERE user=? AND key=?").bind(user, key).first<{ data: string }>();
  if (!r) return def;
  try { return JSON.parse(r.data) as T; } catch { return def; }
}
export async function kvPut(env: Env, user: string, key: string, data: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO kv(user,key,data,updated) VALUES(?,?,?,?) ON CONFLICT(user,key) DO UPDATE SET data=excluded.data, updated=excluded.updated")
    .bind(user, key, JSON.stringify(data), nowIso()).run();
}

export async function settings(env: Env, user: string, hardLimit?: number | null): Promise<Settings> {
  const saved = await kvGet<Record<string, any>>(env, user, "settings", {});
  const s: Settings = { ...DEFAULT_SETTINGS, ...saved };
  if (hardLimit) {   // 관리자가 정한 하루 한도: 스스로 낮출 수만 있음
    const mine = "daily_limit" in saved ? Number(saved.daily_limit || 0) : hardLimit;
    s.daily_limit = Math.min(mine || hardLimit, hardLimit);
  }
  return s;
}

// ── 사용 금액 ──
export async function addCost(env: Env, user: string, provider: string, usd: number | null | undefined): Promise<void> {
  if (!usd) return;
  await env.DB.prepare("INSERT INTO usage(user,day,provider,usd) VALUES(?,?,?,?) ON CONFLICT(user,day,provider) DO UPDATE SET usd=usd+excluded.usd")
    .bind(user, today(), provider, usd).run();
}
export async function spentToday(env: Env, user: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(usd),0) AS s FROM usage WHERE user=? AND day=?").bind(user, today()).first<{ s: number }>();
  return r?.s || 0;
}

// ── 대화 ──
export async function loadConv(env: Env, user: string, cid: string): Promise<Conv> {
  const r = await env.DB.prepare("SELECT data FROM conversations WHERE id=? AND user=?").bind(safeId(cid), user).first<{ data: string }>();
  if (!r) throw new HTTPException(404, { message: "대화를 찾을 수 없어요" });
  return JSON.parse(r.data);
}
export async function saveConv(env: Env, user: string, c: Conv): Promise<void> {
  await env.DB.prepare(`INSERT INTO conversations(id,user,title,created,updated,project_id,bot_id,unread,turns,data) VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated=excluded.updated, project_id=excluded.project_id, bot_id=excluded.bot_id,
     unread=excluded.unread, turns=excluded.turns, data=excluded.data WHERE conversations.user=excluded.user`)
    .bind(c.id, user, c.title, c.created, c.updated, c.project_id ?? null, c.bot_id ?? null, c.unread ? 1 : 0, c.turns.length, JSON.stringify(c)).run();
}
/** 최신본 읽기 → fn으로 고치기 → 저장 (두 창에서 동시에 보내도 D1은 요청 단위로 직렬화됨) */
export async function updateConv(env: Env, user: string, cid: string, fn: (c: Conv) => void, fallback?: Conv): Promise<Conv> {
  let c: Conv;
  try { c = await loadConv(env, user, cid); }
  catch (e) { if (!fallback) throw e; c = fallback; }
  fn(c);
  c.updated = nowIso();
  await saveConv(env, user, c);
  return c;
}
export async function listConvs(env: Env, user: string, project?: string | null) {
  const rows = await env.DB.prepare("SELECT id,title,updated,project_id,bot_id,unread,turns FROM conversations WHERE user=? ORDER BY updated DESC LIMIT 2000").bind(user).all<any>();
  let out = rows.results.map(r => ({ id: r.id, title: r.title, updated: r.updated, project_id: r.project_id, turns: r.turns, bot_id: r.bot_id, unread: !!r.unread }));
  if (project) out = out.filter(r => r.project_id === project);
  return out;
}
export async function allConvs(env: Env, user: string, limit = 300): Promise<Conv[]> {   // 자동 모드 평가 통계용 (최근 것만)
  const rows = await env.DB.prepare("SELECT data FROM conversations WHERE user=? ORDER BY updated DESC LIMIT ?").bind(user, limit).all<{ data: string }>();
  const out: Conv[] = [];
  for (const r of rows.results) { try { out.push(JSON.parse(r.data)); } catch { /* 깨진 건 건너뜀 */ } }
  return out;
}
export async function deleteConv(env: Env, user: string, cid: string): Promise<void> {
  await env.DB.prepare("DELETE FROM conversations WHERE id=? AND user=?").bind(safeId(cid), user).run();
}

// ── 업로드 이미지 ──
export async function putUpload(env: Env, user: string, b64: string, mime: string): Promise<string> {
  const id = newId(12);
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  await env.DB.prepare("INSERT INTO uploads(id,user,mime,bytes,created) VALUES(?,?,?,?,?)").bind(id, user, mime, bin, nowIso()).run();
  return id;
}
export async function getUpload(env: Env, user: string, id: string): Promise<{ mime: string; bytes: ArrayBuffer } | null> {
  const r = await env.DB.prepare("SELECT mime, bytes FROM uploads WHERE id=? AND user=?").bind(safeId(id), user).first<{ mime: string; bytes: any }>();
  if (!r) return null;
  // D1은 BLOB을 숫자 배열로 돌려줄 때가 있어서 → 진짜 바이트로 바꿈 (안 그러면 "137,80,78…" 글자가 그대로 나감)
  const raw = r.bytes, bytes = raw instanceof ArrayBuffer ? raw : ArrayBuffer.isView(raw) ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) : new Uint8Array(raw as number[]).buffer;
  return { mime: r.mime, bytes: bytes as ArrayBuffer };
}
export function b64(buf: ArrayBuffer): string {
  let s = ""; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
