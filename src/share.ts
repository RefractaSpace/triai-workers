/* share.ts — 아티팩트 공개 링크 /s/<id> (파이 게이트웨이 pub_* 와 같은 규칙: 격리 창, 바깥 통신 금지) */
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { nowIso } from "./db";
import { ARTIFACT_CSP } from "./security";
import { esc } from "./auth";

export const PUB_MAX = 1_000_000, PUB_PER_USER = 100;
const okId = (sid: string) => { if (!/^[A-Za-z0-9]{16,40}$/.test(sid)) throw new HTTPException(404, { message: "없는 링크예요" }); return sid; };
const newSid = () => { const b = crypto.getRandomValues(new Uint8Array(18)); return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, "a").slice(0, 24); };

export async function mine(env: Env, user: string) {
  return (await env.DB.prepare("SELECT id, aid, title, kind AS lang, created, views FROM shares WHERE user=? ORDER BY created DESC").bind(user).all<any>()).results;
}
export async function create(env: Env, user: string, b: any) {
  const doc = String(b?.doc || ""), src = String(b?.src || "");
  if (!doc.trim() || doc.length > PUB_MAX) throw new HTTPException(400, { message: "공유할 내용이 비었거나 너무 커요 (1MB까지)" });
  const aid = String(b.aid || "").slice(0, 40);
  const list = await mine(env, user);
  const same = aid ? list.find(x => x.aid === aid) : null;
  if (same) return { id: same.id, url: `/s/${same.id}`, again: true };
  if (list.length >= PUB_PER_USER) throw new HTTPException(400, { message: `공개 링크는 ${PUB_PER_USER}개까지예요. 안 쓰는 링크를 끊어 주세요` });
  const sid = newSid();
  await env.DB.prepare("INSERT INTO shares(id,user,title,kind,body,views,created,aid,src) VALUES(?,?,?,?,?,0,?,?,?)")
    .bind(sid, user, String(b.title || "아티팩트").slice(0, 80), String(b.lang || "html").slice(0, 10), doc, nowIso(), aid, src.slice(0, PUB_MAX)).run();
  return { id: sid, url: `/s/${sid}` };
}
export async function remove(env: Env, user: string, admin: boolean, sid: string) {
  const r = await env.DB.prepare("SELECT user FROM shares WHERE id=?").bind(okId(sid)).first<{ user: string }>();
  if (!r) throw new HTTPException(404, { message: "없는 링크예요" });
  if (r.user !== user && !admin) throw new HTTPException(403, { message: "만든 사람이나 관리자만 끊을 수 있어요" });
  await env.DB.prepare("DELETE FROM shares WHERE id=?").bind(sid).run();
  return { ok: true };
}
const seen = new Map<string, number>();   // 같은 곳에서 10분 안에 다시 열면 안 셈 (인스턴스 안에서만 — 충분)
export async function countView(env: Env, sid: string, ip: string) {
  const k = ip + sid, t = Date.now();
  if (t - (seen.get(k) || 0) < 600_000) return;
  if (seen.size > 5000) seen.clear();
  seen.set(k, t);
  await env.DB.prepare("UPDATE shares SET views=views+1 WHERE id=?").bind(sid).run();
}
const pubHeaders = (csp: string, status = 200) => ({ status, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": csp, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" } });
export async function viewPage(env: Env, sid: string, ip: string): Promise<Response> {
  const d = await env.DB.prepare("SELECT title FROM shares WHERE id=?").bind(okId(sid)).first<{ title: string }>();
  if (!d) return new Response("<!doctype html><meta charset='utf-8'><title>없는 링크</title><p style='font:16px system-ui;padding:40px'>링크가 끊겼거나 없는 주소예요.</p>", pubHeaders("default-src 'none'; style-src 'unsafe-inline'", 404));
  await countView(env, sid, ip);
  const t = esc(d.title);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><style>
:root{--bg:#f3f2ef;--ink:#1d1d1f;--sub:#6e6e73;--line:#dcdad5}@media(prefers-color-scheme:dark){:root{--bg:#151516;--ink:#f2f2f2;--sub:#9a9aa0;--line:#2c2c2f}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:14px/1.4 -apple-system,"Segoe UI",system-ui,"Malgun Gothic",sans-serif}
.bar{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line)}.bar b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bar span{color:var(--sub);font-size:12.5px;margin-left:auto;white-space:nowrap}
iframe{display:block;width:100%;height:calc(100% - 46px);border:0;background:#fff}</style></head><body>
<div class="bar"><b>${t}</b><span>TriAI 사용자가 만든 페이지 · 읽기 전용</span></div>
<iframe src="/s/${sid}/frame" sandbox="allow-scripts allow-modals allow-popups" title="${t}"></iframe></body></html>`;
  return new Response(html, pubHeaders("default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'"));
}
export async function framePage(env: Env, sid: string): Promise<Response> {
  const d = await env.DB.prepare("SELECT body FROM shares WHERE id=?").bind(okId(sid)).first<{ body: string }>();
  if (!d) throw new HTTPException(404, { message: "없는 링크예요" });
  return new Response(d.body, pubHeaders(ARTIFACT_CSP));
}
