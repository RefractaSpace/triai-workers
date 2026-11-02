/* security.ts — 보안 검문소: 속도 제한 · 보안 헤더(CSP) · 감사 기록 · 본문 크기 제한 · 전체 예산 상한 */
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { nowIso } from "./db";

const CDN = "https://cdn.jsdelivr.net";
// 로컬 모델: 화면이 내 컴퓨터의 Ollama(11434)·LM Studio(1234)에 직접 연결 (Cloudflare 서버는 내 컴퓨터에 못 닿음)
export const LOCAL_AI = "http://localhost:11434 http://127.0.0.1:11434 http://localhost:1234 http://127.0.0.1:1234";
// 화면 CSP: 외부 이미지·통신 금지 → 악성 웹페이지가 AI를 조종해 답 속 이미지로 정보를 빼가는 길을 막음
export const APP_CSP = [
  "default-src 'self'", `script-src 'self' ${CDN}`, `style-src 'self' 'unsafe-inline' ${CDN}`, `font-src 'self' data: ${CDN}`,
  "img-src 'self' data: blob:", "media-src 'self' blob:", `connect-src 'self' ${LOCAL_AI}`, "frame-src 'self'", "worker-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");
// 아티팩트·공유 창: AI가 만든 HTML을 실행하되 밖으로 보내는 길은 전부 막음
export const ARTIFACT_CSP = "sandbox allow-scripts allow-modals allow-popups; " + [
  "default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' ${CDN} https://cdnjs.cloudflare.com https://unpkg.com`,
  `style-src 'unsafe-inline' ${CDN} https://cdnjs.cloudflare.com https://fonts.googleapis.com`, `font-src data: ${CDN} https://fonts.gstatic.com`,
  "img-src data: blob:", "media-src data: blob:", "connect-src 'none'", "form-action 'none'", "frame-src 'none'", "base-uri 'none'", "frame-ancestors 'self'",
].join("; ");
// 코드 실행 상자: 파이썬(Pyodide, WebAssembly)을 격리된 창의 워커에서 실행. 받아오기는 CDN만 (Pyodide·패키지 파일)
export const RUNNER_CSP = "sandbox allow-scripts; " + [
  "default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${CDN} blob:`, `connect-src ${CDN}`, "worker-src blob:",
  "img-src data: blob:", "style-src 'unsafe-inline'", "form-action 'none'", "frame-src 'none'", "base-uri 'none'", "frame-ancestors 'self'",
].join("; ");
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'";

export const MAX_BODY = 6_000_000;      // 요청 본문 최대 (사진 4장 base64 포함)

/** 모든 응답에 보안 헤더 */
export const headers: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  const path = new URL(c.req.url).pathname;
  c.res = new Response(c.res.body, c.res);   // 정적 파일 응답은 헤더가 잠겨 있어서 복사본에 붙임
  const h = c.res.headers;
  if (!h.has("content-security-policy")) {
    const ct = h.get("content-type") || "";
    if (path === "/static/artifact.html") h.set("content-security-policy", ARTIFACT_CSP);
    else if (path === "/static/runner.html") h.set("content-security-policy", RUNNER_CSP);
    else if (ct.includes("text/html")) h.set("content-security-policy", APP_CSP);
  }
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "no-referrer");
  h.set("x-frame-options", path.startsWith("/s/") || path === "/static/artifact.html" || path === "/static/runner.html" ? "SAMEORIGIN" : "DENY");
  h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  h.set("permissions-policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  if (path.startsWith("/api/") || path.startsWith("/gw/")) h.set("cache-control", "no-store");
};

/** 본문 크기 제한 (헤더로 먼저, 없으면 읽고 나서) */
export const bodyLimit: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const len = Number(c.req.header("content-length") || 0);
  if (len > MAX_BODY) throw new HTTPException(413, { message: "요청이 너무 커요 (6MB까지)" });
  await next();
};

/** 속도 제한: 같은 주체(key)가 windowSec 안에 limit번 넘으면 429. D1 한 줄로 (KV는 초당 1회 쓰기 제한이 있어 부적합) */
export async function rateLimit(env: Env, kind: string, who: string, limit: number, windowSec: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000), bucket = Math.floor(now / windowSec);
  const key = `${kind}:${who}:${bucket}`;
  const r = await env.DB.prepare("INSERT INTO rate(key,n,exp) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=n+1 RETURNING n")
    .bind(key, (bucket + 2) * windowSec).first<{ n: number }>();
  if ((r?.n || 0) > limit) throw new HTTPException(429, { message: `너무 자주 요청했어요. 잠시 뒤 다시 해 주세요 (${windowSec}초에 ${limit}번까지)` });
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rate WHERE exp < ?").bind(now).run();   // 가끔 청소
}
export const LIMITS = {
  login: [10, 600], sensor: [120, 600], chat: [30, 60], upload: [60, 600], api: [600, 60], share: [20, 3600], public: [120, 60],
} as const satisfies Record<string, readonly [number, number]>;

/** 감사 기록 */
export async function audit(env: Env, action: string, opt: { user?: string | null; ip?: string; detail?: string } = {}): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO audit(time,user,ip,action,detail) VALUES(?,?,?,?,?)")
      .bind(nowIso(), opt.user ?? null, opt.ip ?? null, action, (opt.detail ?? "").slice(0, 300)).run();
  } catch { /* 기록 실패가 요청을 막지 않게 */ }
}
export async function auditList(env: Env, limit = 100) {
  return (await env.DB.prepare("SELECT time,user,ip,action,detail FROM audit ORDER BY id DESC LIMIT ?").bind(limit).all<any>()).results;
}

/** 계정 전체 하루 상한 (환경변수 TRIAI_GLOBAL_DAILY_LIMIT, USD) — 누가 뚫려도 키 요금이 폭주 못 하게 */
export async function checkGlobalBudget(env: Env, expected: number): Promise<void> {
  const lim = Number(env.TRIAI_GLOBAL_DAILY_LIMIT || 0);
  if (!lim) return;
  const { today } = await import("./db");
  const r = await env.DB.prepare("SELECT COALESCE(SUM(usd),0) AS s FROM usage WHERE day=?").bind(today()).first<{ s: number }>();
  if ((r?.s || 0) + expected > lim) throw new HTTPException(402, { message: `오늘 전체 사용 한도($${lim.toFixed(2)})에 닿았어요. 내일 다시 쓸 수 있어요.` });
}

export const ip = (c: Context) => c.req.header("cf-connecting-ip") || "?";
