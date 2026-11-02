/* auth.ts — 로그인·세션·사람 관리 (파이 게이트웨이와 같은 규칙·같은 해시 → 기존 비밀번호 그대로) */
import type { Context } from "hono";
type C = Context<{ Bindings: Env; Variables: any }, any, any>;
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env";
import { nowIso } from "./db";

export const COOKIE = "triai_session";
export const SESSION_DAYS = 7;          // 활동 없이 7일 지나면 만료 (쓰는 동안은 자동 연장)
const ITER = 100_000;          // Cloudflare Workers(실제 서버)는 PBKDF2 반복을 10만 번까지만 허락 — 로컬 시험기에는 이 제한이 없어서 배포해서야 발견
const OLD_ITER = 200_000;      // 파이 시절 해시 (salt$hash) — Workers에서는 계산 불가 → 관리자가 비밀번호를 새로 정해 줘야 함

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16)));

async function pbkdf2(pw: string, salt: Uint8Array, iterations = ITER): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return hex(bits);
}
export async function hashPw(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `v2$${ITER}$${hex(salt)}$${await pbkdf2(pw, salt)}`;    // 반복 횟수를 같이 저장 → 나중에 바꿔도 옛 해시 확인 가능
}
export async function checkPw(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  let salt: string, h: string, iter: number;
  if (parts[0] === "v2" && parts.length === 4) { iter = Number(parts[1]); salt = parts[2]; h = parts[3]; }
  else if (parts.length === 2) { [salt, h] = parts; iter = OLD_ITER; }
  else return false;
  if (!salt || !h || !(iter > 0) || iter > ITER) return false;   // 파이 시절(20만 번) 해시는 여기서 확인 불가 → 로그인 실패
  const mine = await pbkdf2(pw, unhex(salt), iter);
  if (mine.length !== h.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= mine.charCodeAt(i) ^ h.charCodeAt(i);   // 시간 차이로 못 맞히게
  return diff === 0;
}
export const validName = (n: string) => /^[A-Za-z0-9_-]{2,20}$/.test(n);
export const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

export type User = { name: string; admin: boolean; daily_limit: number; providers: string[] | null };   // providers: 쓸 수 있는 AI 회사 (null = 전부)
const provs = (raw: any): string[] | null => { try { const v = raw ? JSON.parse(raw) : null; return Array.isArray(v) ? v.map(String) : null; } catch { return null; } };
export const ALL_PROVIDERS = ["cf", "claude", "gpt", "gemini", "agent", "local"];
export const PROVIDER_NAMES: Record<string, string> = { cf: "Cloudflare(무료)", claude: "Claude", gpt: "GPT", gemini: "Gemini", agent: "에이전트 팀", local: "로컬 모델" };

export async function getUser(env: Env, name: string): Promise<User | null> {
  const r = await env.DB.prepare("SELECT name, admin, daily_limit, providers FROM users WHERE name=?").bind(name).first<any>();
  return r ? { name: r.name, admin: !!r.admin, daily_limit: r.daily_limit, providers: provs(r.providers) } : null;
}
export async function userCount(env: Env): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n || 0;
}
export async function listUsers(env: Env): Promise<User[]> {
  const rows = await env.DB.prepare("SELECT name, admin, daily_limit, providers FROM users ORDER BY created").all<any>();
  return rows.results.map(r => ({ name: r.name, admin: !!r.admin, daily_limit: r.daily_limit, providers: provs(r.providers) }));
}
export async function addUser(env: Env, name: string, pw: string | null, admin: boolean, limit: number, providers?: string[] | null): Promise<void> {
  const cur = await env.DB.prepare("SELECT pw, providers FROM users WHERE name=?").bind(name).first<{ pw: string; providers: string | null }>();
  const stored = pw ? await hashPw(pw) : cur?.pw;
  if (!stored) throw new Error("비밀번호가 필요해요");
  const pv = providers === undefined ? (cur?.providers ?? null) : providers && providers.length ? JSON.stringify(providers.filter(p => ALL_PROVIDERS.includes(p))) : null;
  await env.DB.prepare("INSERT INTO users(name,pw,admin,daily_limit,created,providers) VALUES(?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET pw=excluded.pw, admin=excluded.admin, daily_limit=excluded.daily_limit, providers=excluded.providers")
    .bind(name, stored, admin ? 1 : 0, limit, nowIso(), pv).run();
}

export async function newSession(env: Env, name: string): Promise<string> {
  const tok = hex(crypto.getRandomValues(new Uint8Array(32)));
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE exp < ?").bind(Math.floor(Date.now() / 1000)),
    env.DB.prepare("INSERT INTO sessions(hash,user,exp) VALUES(?,?,?)").bind(await sha256(tok), name, exp),
  ]);
  return tok;
}
export async function currentUser(c: C): Promise<User | null> {
  const tok = getCookie(c, COOKIE);
  if (!tok) return null;
  const db = c.env.DB as D1Database;
  const s = await db.prepare("SELECT s.user AS user, s.exp AS exp, u.admin AS admin, u.daily_limit AS daily_limit, u.providers AS providers FROM sessions s JOIN users u ON u.name=s.user WHERE s.hash=?")
    .bind(await sha256(tok)).first<any>();
  const now = Date.now() / 1000;
  if (!s || s.exp < now) return null;
  if (s.exp - now < SESSION_DAYS * 86400 - 3600) await db.prepare("UPDATE sessions SET exp=? WHERE hash=?").bind(Math.floor(now + SESSION_DAYS * 86400), await sha256(tok)).run();
  return { name: s.user, admin: !!s.admin, daily_limit: s.daily_limit, providers: provs(s.providers) };
}
export async function dropSessions(env: Env, opt: { name?: string; tok?: string }): Promise<void> {
  if (opt.tok) await env.DB.prepare("DELETE FROM sessions WHERE hash=?").bind(await sha256(opt.tok)).run();
  if (opt.name) await env.DB.prepare("DELETE FROM sessions WHERE user=?").bind(opt.name).run();
}
export function setSessionCookie(c: C, tok: string): void {
  setCookie(c, COOKIE, tok, { maxAge: SESSION_DAYS * 86400, httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/" });
}
export function clearSessionCookie(c: C): void { deleteCookie(c, COOKIE, { path: "/" }); }

// ── 로그인 시도 제한: 같은 IP가 10분에 5번 틀리면 막음 ──
export const clientIp = (c: C) => c.req.header("cf-connecting-ip") || "?";
export async function tooManyFails(env: Env, ip: string): Promise<boolean> {
  const r = await env.DB.prepare("SELECT times FROM login_fails WHERE ip=?").bind(ip).first<{ times: string }>();
  const now = Date.now() / 1000;
  const ts: number[] = r ? JSON.parse(r.times).filter((t: number) => now - t < 600) : [];
  return ts.length >= 5;
}
export async function noteFail(env: Env, ip: string): Promise<void> {
  const r = await env.DB.prepare("SELECT times FROM login_fails WHERE ip=?").bind(ip).first<{ times: string }>();
  const now = Date.now() / 1000;
  const ts: number[] = (r ? JSON.parse(r.times) : []).filter((t: number) => now - t < 600);
  ts.push(now);
  await env.DB.prepare("INSERT INTO login_fails(ip,times) VALUES(?,?) ON CONFLICT(ip) DO UPDATE SET times=excluded.times").bind(ip, JSON.stringify(ts)).run();
}
export async function clearFails(env: Env, ip: string): Promise<void> { await env.DB.prepare("DELETE FROM login_fails WHERE ip=?").bind(ip).run(); }

export const sameOrigin = (c: C) => {
  const origin = c.req.header("origin");
  if (origin) { try { return new URL(origin).host.toLowerCase() === new URL(c.req.url).host.toLowerCase(); } catch { return false; } }
  return ["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site") as any);
};

// ── 화면 (파이 게이트웨이와 같은 모양) ──
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
export function page(body: string, w = 360): Response {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TriAI</title><style>
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f6f5f2;color:#1f1e1c;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
.box{background:#fff;border:1px solid #e5e2db;border-radius:14px;padding:28px;width:min(92vw,${w}px);box-sizing:border-box}
h1{font-size:20px;margin:0 0 18px} label{display:block;font-size:13px;color:#6b6760;margin:12px 0 4px}
input,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d8d4cc;border-radius:8px;font-size:15px}
button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:8px;background:#1f1e1c;color:#fff;font-size:15px;cursor:pointer}
.err{color:#b42318;font-size:13px;margin-top:10px} .ok{color:#067647;font-size:13px;margin-top:10px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 18px} td,th{border-bottom:1px solid #eee;padding:7px 4px;text-align:left}
.row{display:flex;gap:8px} .row>*{flex:1} a{color:#1f1e1c} .small{font-size:12px;color:#6b6760} code{background:#eee;padding:1px 5px;border-radius:4px}
@media(prefers-color-scheme:dark){body{background:#1b1a18;color:#eee}.box{background:#262522;border-color:#3a3833}
input,select{background:#1b1a18;color:#eee;border-color:#3a3833}button{background:#eee;color:#1b1a18}td,th{border-color:#3a3833}a{color:#eee}code{background:#3a3833}}
</style></head><body><div class="box">${body}</div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", "x-frame-options": "DENY" } });
}
export const loginForm = (msg = "") => page(`<h1>TriAI 로그인</h1><form method="post" action="/gw/login">
<label for="u">아이디</label><input id="u" name="username" autocomplete="username" required autofocus>
<label for="p">비밀번호</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button>들어가기</button>${msg ? `<div class="err">${esc(msg)}</div>` : ""}</form>`);
export const setupForm = (msg = "") => page(`<h1>TriAI 처음 설정</h1><p class="small">관리자 계정을 만들어요. 배포할 때 정한 <b>SESSION_SECRET</b> 값(1회용 코드)이 필요해요.</p>
<form method="post" action="/gw/setup">
<label for="c">1회용 코드</label><input id="c" name="code" autocomplete="one-time-code" required autofocus>
<label for="u">관리자 아이디 (영문·숫자·-·_ 2~20자)</label><input id="u" name="username" autocomplete="username" required>
<label for="p">비밀번호 (8자 이상)</label><input id="p" name="password" type="password" autocomplete="new-password" required minlength="8">
<label for="p2">비밀번호 한 번 더</label><input id="p2" name="password2" type="password" autocomplete="new-password" required minlength="8">
<button>관리자 만들기</button>${msg ? `<div class="err">${esc(msg)}</div>` : ""}</form>`);
export function adminPage(me: string, users: User[], msg = "", ok = true, audit: any[] = []): Response {
  const rows = users.map(u => `<tr><td>${esc(u.name)}${u.admin ? " 👑" : ""}</td><td>$${u.daily_limit.toFixed(2)}</td><td>${u.providers ? esc(u.providers.map(p => PROVIDER_NAMES[p] || p).join(", ")) : "전부"}</td></tr>`).join("");
  const boxes = ALL_PROVIDERS.map(p => `<label style="display:inline-flex;gap:4px;align-items:center;margin:4px 10px 0 0;font-size:14px;color:inherit"><input type="checkbox" name="prov" value="${p}" style="width:auto" checked>${esc(PROVIDER_NAMES[p])}</label>`).join("");
  const note = msg ? `<div class="${ok ? "ok" : "err"}">${esc(msg)}</div>` : "";
  return page(`<h1>사람 관리</h1><table><tr><th>아이디</th><th>하루 한도</th><th>쓸 수 있는 AI</th></tr>${rows}</table>
<form method="post" action="/gw/admin/user">
<div class="row"><div><label for="n">아이디 (영문·숫자)</label><input id="n" name="name" required></div>
<div><label for="pw">비밀번호 (8자 이상, 새로 만들거나 바꿀 때)</label><input id="pw" name="password" type="password"></div></div>
<div class="row"><div><label for="l">하루 한도 (USD)</label><input id="l" name="limit" type="number" step="any" min="0.1" max="100" value="1"></div></div>
<label>쓸 수 있는 AI (팀원 계정은 Cloudflare만 켜 두면 요금이 안 나가요)</label><div>${boxes}</div>
<div class="row"><button name="action" value="save">추가 / 바꾸기</button><button name="action" value="delete" style="background:#b42318">삭제</button></div>
</form>${note}
<p class="small">삭제해도 그 사람의 대화 기록은 남아요. · <a href="/">TriAI로</a> · <a href="/gw/password">비밀번호 바꾸기</a> · <a href="/gw/logout">로그아웃 (${esc(me)})</a></p>
<h1 style="margin-top:24px;font-size:16px">최근 기록</h1><table><tr><th>시각</th><th>누가</th><th>IP</th><th>무엇</th></tr>${audit.map(a => `<tr><td>${esc(a.time)}</td><td>${esc(a.user || "")}</td><td>${esc(a.ip || "")}</td><td>${esc(a.action)}${a.detail ? " · " + esc(a.detail) : ""}</td></tr>`).join("")}</table>`, 720);
}
export const passwordForm = (msg = "", ok = false) => page(`<h1>비밀번호 바꾸기</h1><form method="post" action="/gw/password">
<label for="c">지금 비밀번호</label><input id="c" name="current" type="password" autocomplete="current-password" required autofocus>
<label for="p">새 비밀번호 (8자 이상)</label><input id="p" name="password" type="password" autocomplete="new-password" required minlength="8">
<label for="p2">새 비밀번호 한 번 더</label><input id="p2" name="password2" type="password" autocomplete="new-password" required minlength="8">
<button>바꾸기</button>${msg ? `<div class="${ok ? "ok" : "err"}">${esc(msg)}</div>` : ""}</form><p class="small"><a href="/">TriAI로</a></p>`);
