/* index.ts — TriAI on Cloudflare Workers: 로그인 → 화면(static 그대로) → API (파이 때와 같은 규약) */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { PROVIDERS, DEFAULT_MODELS, hasKey } from "./env";
import * as A from "./auth";
import * as P from "./providers";
import * as R from "./routing";
import * as DB from "./db";
import { ChatReq, Target, askMore, checkBudget, ctxOf, execute, getCats, planRequest, synth, fullSystem, resume, localSave, localJob, toolExec, agentCap } from "./chat";
import * as MCP from "./mcp";
import * as AG from "./agents";
import * as SN from "./sensors";
import * as TK from "./apitokens";
import { ownAnswer } from "./history";
import * as SEC from "./security";
import * as ART from "./artifacts";
import * as CAT from "./catalog";
import * as PJ from "./projects";
import * as SH from "./share";
import * as S from "./search";
import { askOnce, pickModel } from "./compact";

type Vars = { user: A.User };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const PUBLIC = new Set(["/gw/login", "/gw/setup", "/gw/ping", "/sw.js", "/static/artifact.html", "/static/runner.html", "/static/manifest.webmanifest", "/static/icon-192.png", "/static/icon-512.png", "/static/icon-maskable-512.png", "/static/apple-touch-icon.png"]);
const RUNS = new Map<string, AbortController>();   // 실행 번호 → 중지 (같은 인스턴스 안에서만; 창을 닫아도 스트림이 끊기면 멈춤)

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ detail: err.message }, err.status);
  console.error(err);
  return c.json({ detail: `서버 오류: ${P.redact(String(err)).slice(0, 200)}` }, 500);
});

// ── 보안 헤더 · 본문 크기 · 로그인 문지기 · 속도 제한 ──
app.use("*", SEC.headers);
app.use("*", SEC.bodyLimit);
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/s/")) { await SEC.rateLimit(c.env, "public", SEC.ip(c), ...SEC.LIMITS.public); return next(); }
  if ((path === "/api/sensor" && c.req.method === "POST") || (path === "/api/sensor/fw" && c.req.method === "GET")) {   // ESP32 센서: 로그인 대신 기기 열쇠
    await SEC.rateLimit(c.env, "sensor", SEC.ip(c), ...SEC.LIMITS.sensor);
    return next();
  }
  if (path.startsWith("/api/v1/")) {   // 다른 채팅·프로그램: 로그인 대신 TriAI 토큰 (Bearer)
    await SEC.rateLimit(c.env, "v1", SEC.ip(c), ...SEC.LIMITS.v1);
    return next();
  }
  if (PUBLIC.has(path)) {
    if (c.req.method === "POST") await SEC.rateLimit(c.env, "login", SEC.ip(c), ...SEC.LIMITS.login);
    return next();
  }
  const me = await A.currentUser(c);
  if (!me) {
    if (path.startsWith("/api/") || path.startsWith("/gw/")) return c.json({ detail: "로그인이 필요해요" }, 401);
    return c.redirect("/gw/login", 303);
  }
  const write = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
  if (write && (path.startsWith("/api/") || path.startsWith("/gw/")) && !A.sameOrigin(c)) return c.json({ detail: "다른 웹사이트에서 보낸 요청이에요" }, 403);
  if (write && path.startsWith("/api/") && !c.req.header("x-triai")) return c.json({ detail: "TriAI 화면에서만 바꿀 수 있어요" }, 403);
  if (path.startsWith("/api/admin") && !me.admin) return c.json({ detail: "관리자만 쓸 수 있어요" }, 403);
  if (path.startsWith("/api/") || path.startsWith("/gw/")) {
    await SEC.rateLimit(c.env, "api", me.name, ...SEC.LIMITS.api);
    if (path === "/api/chat" || path === "/api/ask-more" || path === "/api/synth" || path === "/api/resume") await SEC.rateLimit(c.env, "chat", me.name, ...SEC.LIMITS.chat);
    if ((path === "/api/uploads" || path === "/api/tool/exec") && write) await SEC.rateLimit(c.env, "upload", me.name, ...SEC.LIMITS.upload);
    if (path === "/gw/share" && write) await SEC.rateLimit(c.env, "share", me.name, ...SEC.LIMITS.share);
  }
  c.set("user", me);
  await next();
});

// ── 게이트웨이 (로그인·설정·사람 관리) ──
app.get("/gw/ping", c => c.text("ok"));
app.get("/gw/login", async c => (await A.userCount(c.env)) === 0 ? c.redirect("/gw/setup", 303) : A.loginForm());
app.post("/gw/login", async c => {
  const f = await c.req.parseBody(); const ip = A.clientIp(c);
  if (await A.tooManyFails(c.env, ip)) return A.loginForm("여러 번 틀려서 10분 동안 막혔어요");
  const name = String(f.username || "").trim(), pw = String(f.password || "");
  const row = await c.env.DB.prepare("SELECT pw FROM users WHERE name=?").bind(name).first<{ pw: string }>();
  if (!row || !(await A.checkPw(pw, row.pw))) { await A.noteFail(c.env, ip); await SEC.audit(c.env, "login_fail", { user: name.slice(0, 20), ip }); return A.loginForm("아이디나 비밀번호가 맞지 않아요"); }
  await A.clearFails(c.env, ip);
  A.setSessionCookie(c, await A.newSession(c.env, name));
  await SEC.audit(c.env, "login", { user: name, ip });
  return c.redirect("/", 303);
});
app.get("/gw/setup", async c => (await A.userCount(c.env)) ? c.redirect("/gw/login", 303) : A.setupForm());
app.post("/gw/setup", async c => {
  if (await A.userCount(c.env)) return c.redirect("/gw/login", 303);
  const f = await c.req.parseBody(); const ip = A.clientIp(c);
  if (await A.tooManyFails(c.env, ip)) return A.setupForm("여러 번 틀려서 10분 동안 막혔어요");
  const code = String(f.code || "").trim(), secret = (c.env.SESSION_SECRET || "").trim();
  if (!secret || code !== secret) { await A.noteFail(c.env, ip); return A.setupForm("1회용 코드가 맞지 않아요 (SESSION_SECRET 비밀값)"); }
  const name = String(f.username || "").trim(), pw = String(f.password || ""), pw2 = String(f.password2 || "");
  if (!A.validName(name)) return A.setupForm("아이디는 영문·숫자·-·_ 2~20자");
  if (pw.length < 8 || pw !== pw2) return A.setupForm("비밀번호는 8자 이상, 두 번 똑같이 입력해야 해요");
  await A.addUser(c.env, name, pw, true, 5);
  A.setSessionCookie(c, await A.newSession(c.env, name));
  await SEC.audit(c.env, "setup_admin", { user: name, ip });
  return c.redirect("/", 303);
});
app.get("/gw/logout", async c => { await A.dropSessions(c.env, { tok: (c.req.header("cookie") || "").match(/triai_session=([^;]+)/)?.[1] }); A.clearSessionCookie(c); return c.redirect("/gw/login", 303); });
app.get("/gw/me", c => { const u = c.get("user"); return c.json({ user: u.name, admin: u.admin, limit: u.daily_limit, leads: [], serverless: true }); });
app.get("/gw/admin", async c => { const u = c.get("user"); return u.admin ? A.adminPage(u.name, await A.listUsers(c.env), "", true, await SEC.auditList(c.env, 40)) : A.page("<h1>관리자만 볼 수 있어요</h1><p><a href='/'>TriAI로</a></p>"); });
app.get("/gw/pi", c => A.page("<h1>파이 상태</h1><p class=\"small\">이 TriAI는 라즈베리파이가 아니라 Cloudflare에서 돌아가요. 켜고 끌 기계가 없어요.</p><p><a href=\"/\">TriAI로</a></p>"));
app.get("/gw/pi/console", c => A.page("<h1>파이 조종실</h1><p class=\"small\">서버 없는 TriAI에는 조종실이 없어요. 배포·설정은 wrangler로 해요.</p><p><a href=\"/\">TriAI로</a></p>"));
app.get("/gw/password", c => A.passwordForm(c.req.query("ok") ? "바꿨어요. 다른 기기에서는 다시 로그인해야 해요." : "", true));
app.post("/gw/password", async c => {
  const me = c.get("user"); const f = await c.req.parseBody();
  const cur = String(f.current || ""), pw = String(f.password || ""), pw2 = String(f.password2 || "");
  const row = await c.env.DB.prepare("SELECT pw FROM users WHERE name=?").bind(me.name).first<{ pw: string }>();
  if (!row || !(await A.checkPw(cur, row.pw))) { await SEC.audit(c.env, "password_fail", { user: me.name, ip: SEC.ip(c) }); return A.passwordForm("지금 비밀번호가 맞지 않아요"); }
  if (pw.length < 8 || pw !== pw2) return A.passwordForm("새 비밀번호는 8자 이상, 두 번 똑같이");
  if (pw === cur) return A.passwordForm("지금 비밀번호와 달라야 해요");
  await A.addUser(c.env, me.name, pw, me.admin, me.daily_limit);   // providers는 그대로 (undefined → 유지)
  await A.dropSessions(c.env, { name: me.name });   // 다른 기기 전부 로그아웃
  A.setSessionCookie(c, await A.newSession(c.env, me.name));
  await SEC.audit(c.env, "password_change", { user: me.name, ip: SEC.ip(c) });
  return c.redirect("/gw/password?ok=1", 303);
});
app.post("/gw/admin/user", async c => {
  const me = c.get("user");
  if (!me.admin || !A.sameOrigin(c)) return A.page("<h1>권한이 없어요</h1>");
  const f = await c.req.parseBody();
  const name = String(f.name || "").trim(), pw = String(f.password || ""), action = String(f.action || "save");
  const users = await A.listUsers(c.env), exists = users.some(u => u.name === name);
  const back = async (msg: string, ok = true) => A.adminPage(me.name, await A.listUsers(c.env), msg, ok, await SEC.auditList(c.env, 40));
  if (action === "delete") {
    if (name === me.name) return back("자기 자신은 삭제할 수 없어요", false);
    await A.dropSessions(c.env, { name });
    await c.env.DB.prepare("DELETE FROM users WHERE name=?").bind(name).run();
    await SEC.audit(c.env, "admin_delete_user", { user: me.name, ip: SEC.ip(c), detail: name });
    return back(`${name} 삭제했어요`);
  }
  if (!A.validName(name)) return back("아이디는 영문·숫자·-·_ 2~20자", false);
  if (!exists && pw.length < 8) return back("새 사람은 비밀번호 8자 이상이 필요해요", false);
  if (pw && pw.length < 8) return back("비밀번호는 8자 이상", false);
  const limit = Math.max(0.1, Math.min(Number(f.limit || 1), 100));
  const all = await c.req.parseBody({ all: true });
  const picked = ([] as string[]).concat((all.prov as any) || []).map(String).filter(p => A.ALL_PROVIDERS.includes(p));
  if (!picked.length) return back("쓸 수 있는 AI를 하나 이상 골라 주세요", false);
  const providers = picked.length === A.ALL_PROVIDERS.length ? null : picked;
  await A.addUser(c.env, name, pw || null, users.find(u => u.name === name)?.admin || false, limit, providers);
  if (pw) await A.dropSessions(c.env, { name });
  await SEC.audit(c.env, exists ? "admin_edit_user" : "admin_add_user", { user: me.name, ip: SEC.ip(c), detail: `${name} limit=${limit}${pw ? " pw" : ""} ai=${providers ? providers.join(",") : "all"}` });
  return back(`${name} 저장했어요 (하루 $${limit.toFixed(2)})`);
});

// ── 상태·모델·설정 ──
app.get("/api/status", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  const keys: Record<string, boolean> = { claude: false, gpt: false, gemini: false, local: false, agent: false, cf: false };
  const defaults: Record<string, string> = { ...DEFAULT_MODELS, local: "", agent: "Commander" };
  for (const p of PROVIDERS) keys[p] = hasKey(c.env, p);
  keys.agent = hasKey(c.env, "agent"); keys.local = true;
  if (u.providers) for (const k of Object.keys(keys)) keys[k] = keys[k] && u.providers.includes(k);   // 이 계정에 허락된 AI만 보이게
  return c.json({ keys, defaults, spent_today: await DB.spentToday(c.env, u.name), settings: ctx.s, gateway: true, serverless: true });
});
app.get("/api/models/:p", async c => c.json(await P.listModels(c.env, c.req.param("p"))));
app.put("/api/settings", async c => {
  const u = c.get("user"); const d = await c.req.json<Record<string, any>>();
  d.max_tokens = Math.max(256, Math.min(Number(d.max_tokens || 4000), 131072));
  d.history_chars = Math.max(2000, Math.min(Number(d.history_chars || 60000), 2_000_000));
  if (u.daily_limit) d.daily_limit = Math.min(Number(d.daily_limit || u.daily_limit), u.daily_limit);
  const keep = Object.fromEntries(Object.entries(d).filter(([k]) => k in DB.DEFAULT_SETTINGS));
  await DB.kvPut(c.env, u.name, "settings", keep);
  return c.json((await ctxOf(c.env, u.name, u.daily_limit, u.providers)).s);
});
app.get("/api/categories", async c => c.json(await getCats(c.env, c.get("user").name)));
app.put("/api/categories", async c => {
  let cats: R.Cat[];
  try { cats = R.validate(await c.req.json()); } catch (e: any) { throw new HTTPException(400, { message: e.message }); }
  await DB.kvPut(c.env, c.get("user").name, "categories", cats); return c.json(cats);
});
app.post("/api/categories/reset", async c => { await DB.kvPut(c.env, c.get("user").name, "categories", R.defaults()); return c.json(R.defaults()); });
app.get("/api/candidates", c => { const u = c.get("user"); return c.json(PROVIDERS.filter(p => hasKey(c.env, p) && (!u.providers || u.providers.includes(p))).map(p => ({ key: p, name: R.keyName(p) }))); });
app.get("/api/admin/check-keys", async c => {
  const out: Record<string, any> = {};
  await Promise.all([...PROVIDERS, "local", "agent"].map(async p => { out[p] = PROVIDERS.includes(p as any) ? await P.checkKey(c.env, p) : { ok: false, msg: "서버 없는 TriAI에서는 없음" }; }));
  return c.json(out);
});

// ── 대화 ──
app.get("/api/conversations", async c => c.json(await DB.listConvs(c.env, c.get("user").name, c.req.query("project"))));
app.get("/api/search", async c => {
  const q = (c.req.query("q") || "").trim().toLowerCase(); if (!q) return c.json([]);
  const hits: any[] = [];
  for (const cv of await DB.allConvs(c.env, c.get("user").name, 500)) {
    let where: string | null = null, snip = "";
    if (cv.title.toLowerCase().includes(q)) where = "제목";
    for (const t of cv.turns) {
      if (where) break;
      for (const [label, txt] of [["질문", t.q], ...Object.values<any>(t.answers || {}).map(a => ["답변", a.text || ""])] as [string, string][]) {
        const i = txt.toLowerCase().indexOf(q);
        if (i >= 0) { where = label; snip = txt.slice(Math.max(0, i - 30), i + q.length + 50).replace(/\n/g, " "); break; }
      }
    }
    if (where) hits.push({ id: cv.id, title: cv.title, updated: cv.updated, where, snippet: snip, project_id: cv.project_id });
  }
  return c.json(hits.sort((a, b) => (a.updated < b.updated ? 1 : -1)).slice(0, 50));
});
app.post("/api/conversations/import", async c => {
  const u = c.get("user"); const req = await c.req.json<any>();
  const turns: any[] = [];
  for (const t of (req.turns || []).slice(0, 500)) {
    if (!t || typeof t !== "object") continue;
    const ans: Record<string, any> = {};
    for (const [k, a] of Object.entries<any>(t.answers || {})) if (a && typeof a.text === "string")
      ans[String(k).slice(0, 60)] = { provider: String(a.provider || k.split("@")[0]).slice(0, 20), model: String(a.model || "").slice(0, 80), text: a.text, error: a.error ?? null,
        cost: typeof a.cost === "number" ? a.cost : null, sec: a.sec || 0, in: Number(a.in || 0), out: Number(a.out || 0), stopped: false, estimated: true };
    const files = (t.files || []).filter((f: any) => f?.content).slice(0, 8).map((f: any) => ({ name: String(f.name || "").slice(0, 120), content: String(f.content) }));
    turns.push({ q: String(t.q || ""), answers: ans, synth: t.synth?.text ? t.synth : null, files, images: [], time: String(t.time || DB.nowIso()), trimmed: 0, best: null });
  }
  if (!turns.length) throw new HTTPException(400, { message: "가져올 내용이 없어요" });
  const title = (req.owner ? `👥 ${req.owner}: ${req.title}` : `👥 ${req.title}`).slice(0, 40);
  const conv = { id: DB.newId(12), title, created: DB.nowIso(), updated: DB.nowIso(), project_id: null, bot_id: null, turns, imported_from: String(req.owner || "").slice(0, 20) };
  await DB.saveConv(c.env, u.name, conv); return c.json({ id: conv.id, title });
});
app.get("/api/conversations/:cid", async c => c.json(await DB.loadConv(c.env, c.get("user").name, c.req.param("cid"))));
app.patch("/api/conversations/:cid", async c => {
  const req = await c.req.json<any>();
  return c.json(await DB.updateConv(c.env, c.get("user").name, c.req.param("cid"), cv => {
    if (typeof req.title === "string" && req.title.trim()) cv.title = req.title.trim().slice(0, 80);
    if (req.move) cv.project_id = req.project_id || null;
  }));
});
app.delete("/api/conversations/:cid", async c => { await DB.deleteConv(c.env, c.get("user").name, c.req.param("cid")); return c.json({ ok: true }); });
app.post("/api/conversations/:cid/read", async c => { await DB.updateConv(c.env, c.get("user").name, c.req.param("cid"), cv => { delete cv.unread; }); return c.json({ ok: true }); });
app.post("/api/conversations/:cid/branch", async c => {
  const u = c.get("user"); const { turn } = await c.req.json<{ turn: number }>();
  const cv = await DB.loadConv(c.env, u.name, c.req.param("cid"));
  if (!(turn >= 0 && turn < cv.turns.length)) throw new HTTPException(400, { message: "잘못된 턴 번호" });
  const { archive, unread, inbox, routine_id, summary, ...rest } = cv as any;
  const nid = DB.newId(12);
  const nv = { ...JSON.parse(JSON.stringify(rest)), id: nid, title: ("⑂ " + cv.title).slice(0, 40), created: DB.nowIso(), updated: DB.nowIso(),
    turns: JSON.parse(JSON.stringify(cv.turns.slice(0, turn + 1))), branched_from: { conv: cv.id, turn } };
  await DB.saveConv(c.env, u.name, nv); return c.json({ id: nid, title: nv.title });
});
app.get("/api/conversations/:cid/archive", async c => c.json([...((await DB.loadConv(c.env, c.get("user").name, c.req.param("cid"))).archive || [])].reverse()));
app.get("/api/conversations/:cid/export", async c => {
  const cv = await DB.loadConv(c.env, c.get("user").name, c.req.param("cid"));
  const lines = [`# ${cv.title}`, "", `_${cv.created.slice(0, 10)} · TriAI_`, ""];
  cv.turns.forEach((t, i) => {
    lines.push(`## ${i + 1}. 질문`, "", t.q, "");
    for (const f of t.files || []) lines.push(`> 첨부: ${f.name}`);
    for (const [key, a] of Object.entries<any>(t.answers)) lines.push(`### ${R.keyName(key === "local" ? R.answerKey("local", a.model || "") : key)} (${a.model || ""})`, "", a.text || `_오류: ${a.error}_`, "");
    if (t.synth?.text) lines.push("### 종합 답변", "", t.synth.text, "");
  });
  const fname = cv.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "대화";
  return new Response(lines.join("\n"), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}.md` } });
});
app.get("/api/uploads/:iid", async c => {
  const u = await DB.getUpload(c.env, c.get("user").name, c.req.param("iid"));
  if (!u) throw new HTTPException(404, { message: "없음" });
  return new Response(u.bytes, { headers: { "content-type": u.mime, "cache-control": "private, max-age=86400" } });
});

// ── 채팅 (스트리밍 ndjson) ──
function stream(c: any, body: (signal: AbortSignal, emit: (ev: Record<string, unknown>) => void, runId: string) => Promise<void>): Response {
  const ac = new AbortController(), runId = DB.newId(10);
  RUNS.set(runId, ac);
  const enc = new TextEncoder();
  const rs = new ReadableStream({
    start(ctrl) {
      // 글자 조각(delta/think)은 40ms마다 모아서 한 번에 보냄 → CPU 시간 절약 (무료 플랜은 요청당 CPU 10ms)
      let queue: Record<string, unknown>[] = []; let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (!queue.length) return;
        const merged: Record<string, unknown>[] = [];
        for (const ev of queue) {
          const last = merged[merged.length - 1];
          if (last && (ev.type === "delta" || ev.type === "think") && last.type === ev.type && last.key === ev.key) last.d = String(last.d) + String(ev.d);
          else merged.push({ ...ev });
        }
        queue = [];
        try { ctrl.enqueue(enc.encode(merged.map(ev => JSON.stringify(ev)).join("\n") + "\n")); } catch { /* 닫힘 */ }
      };
      const emit = (ev: Record<string, unknown>) => {
        queue.push(ev.type === "meta" ? { ...ev, run_id: runId } : ev);
        if (ev.type === "delta" || ev.type === "think") { if (!timer) timer = setTimeout(flush, 40); }
        else flush();   // meta·done·end·status 는 바로
      };
      const work = (async () => {
        try { await body(ac.signal, emit, runId); }
        catch (e: any) { emit({ type: "error", text: e instanceof HTTPException ? e.message : String(e?.message || e).slice(0, 300) }); }
        finally { if (timer) clearTimeout(timer); flush(); RUNS.delete(runId); try { ctrl.close(); } catch { /* */ } }
      })();
      c.executionCtx.waitUntil(work);   // 창을 닫아도(스트림 끊김) 저장까지는 끝냄
    },
    cancel() { ac.abort(); RUNS.delete(runId); },
  });
  return new Response(rs, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
app.post("/api/cancel/:rid", c => { const ac = RUNS.get(c.req.param("rid")); ac?.abort(); return c.json({ ok: !!ac }); });
app.post("/api/estimate", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  try {
    const plan = await planRequest(ctx, await c.req.json<ChatReq>(), true);
    return c.json({ category: plan.label, route: plan.route, expected: plan.expected, switch: false, forced: plan.forced, cls: plan.cls,
      per: Object.fromEntries(plan.jobs.map(j => [j.key, { in: j.est_in, cost: j.est_cost }])), agent: false });
  } catch (e: any) { return c.json({ error: e instanceof HTTPException ? e.message : String(e.message || e) }); }
});
app.post("/api/chat", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  const req = await c.req.json<ChatReq>();
  const plan = await planRequest(ctx, req);
  await checkBudget(ctx, plan.expected);
  await SEC.checkGlobalBudget(c.env, plan.expected);
  ctx.later = p => c.executionCtx.waitUntil(p);
  return stream(c, (signal, emit) => execute(ctx, req, plan, signal, emit));
});
// ── 답 중간 도구: 화면이 실행한 결과로 이어 쓰기 · 로컬 모델 답 저장 · 서버 도구 실행 · 결과 그림 올리기 ──
app.post("/api/resume", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  const req = await c.req.json<any>();
  if (!req?.conv_id || !Number.isInteger(req.turn) || !req.key || !req.id) throw new HTTPException(400, { message: "잘못된 요청" });
  await SEC.checkGlobalBudget(c.env, 0);
  ctx.later = p => c.executionCtx.waitUntil(p);
  return stream(c, (signal, emit) => resume(ctx, req, signal, emit));
});
app.post("/api/local/save", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  const req = await c.req.json<any>();
  if (!req?.conv_id || !Number.isInteger(req.turn) || !String(req.key || "").startsWith("local@") || !req.id) throw new HTTPException(400, { message: "잘못된 요청" });
  return c.json(await localSave(ctx, req));
});
app.post("/api/local/job", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  return c.json(await localJob(ctx, await c.req.json<any>()));
});
app.post("/api/tool/exec", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  return c.json(await toolExec(ctx, await c.req.json<any>()));
});
app.post("/api/uploads", async c => {
  const { b64, mime } = await c.req.json<{ b64: string; mime?: string }>();
  const m = String(mime || "image/png");
  if (!/^image\/(png|jpeg|gif|webp)$/.test(m)) throw new HTTPException(400, { message: "그림(png·jpg·gif·webp)만 올릴 수 있어요" });
  if (typeof b64 !== "string" || !b64 || b64.length > 2_700_000 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new HTTPException(400, { message: "그림이 비었거나 너무 커요 (2MB까지)" });
  return c.json({ id: await DB.putUpload(c.env, c.get("user").name, b64, m) });
});

// ── 앱 연동 (MCP) ──
app.get("/api/mcp", async c => c.json({ servers: (await MCP.servers(c.env, c.get("user").name)).map(MCP.pub), presets: MCP.PRESETS }));
app.post("/api/mcp", async c => { const u = c.get("user"); const s = await MCP.add(c.env, u.name, await c.req.json()); await SEC.audit(c.env, "mcp_add", { user: u.name, ip: SEC.ip(c), detail: s.url }); return c.json(MCP.pub(s)); });
app.post("/api/mcp/:sid/refresh", async c => c.json(MCP.pub(await MCP.refresh(c.env, c.get("user").name, c.req.param("sid")))));
app.patch("/api/mcp/:sid", async c => { const u = c.get("user"); const req = await c.req.json<any>(); const s = await MCP.patch(c.env, u.name, c.req.param("sid"), req);
  if (typeof req.allow_write === "boolean") await SEC.audit(c.env, "mcp_write", { user: u.name, ip: SEC.ip(c), detail: `${s.id}=${req.allow_write}` }); return c.json(MCP.pub(s)); });
app.delete("/api/mcp/:sid", async c => c.json(await MCP.remove(c.env, c.get("user").name, c.req.param("sid"))));

// ── 집 센서 (ESP32) ──
app.post("/api/sensor", async c => c.json(await SN.ingest(c.env, c.req.header("authorization"), await c.req.json().catch(() => ({})))));
app.get("/api/sensor/fw", async c => SN.firmware(c.env, c.req.header("authorization")));
// ── 다른 채팅에서 TriAI AI 쓰기 (TriAI 토큰) ──
app.get("/api/v1/models", async c => c.json(await TK.models(c.env, c.req.header("authorization"))));
app.post("/api/v1/chat", async c => c.json(await TK.chat(c.env, c.req.header("authorization"), await c.req.json().catch(() => ({})), c.req.raw.signal)));
app.get("/api/tokens", async c => c.json(await TK.list(c.env, c.get("user").name)));
app.post("/api/tokens", async c => { const u = c.get("user"); const r = await TK.create(c.env, u.name, await c.req.json().catch(() => ({})), u.providers); await SEC.audit(c.env, "token_create", { user: u.name, ip: SEC.ip(c), detail: r.name }); return c.json(r); });
app.delete("/api/tokens/:id", async c => { const u = c.get("user"); const r = await TK.remove(c.env, u.name, c.req.param("id")); await SEC.audit(c.env, "token_delete", { user: u.name, ip: SEC.ip(c), detail: c.req.param("id") }); return c.json(r); });
app.get("/api/sensors", async c => c.json({ devices: await SN.list(c.env, c.get("user").name), fw: await SN.fwMeta(c.env) }));
app.post("/api/sensors", async c => { const u = c.get("user"); const r = await SN.create(c.env, u.name, (await c.req.json<any>()).name); await SEC.audit(c.env, "sensor_add", { user: u.name, ip: SEC.ip(c), detail: r.id }); return c.json(r); });
app.patch("/api/sensors/:id", async c => c.json(await SN.rename(c.env, c.get("user").name, c.req.param("id"), (await c.req.json<any>()).name)));
app.post("/api/sensors/:id/rekey", async c => { const u = c.get("user"); const r = await SN.rekey(c.env, u.name, c.req.param("id")); await SEC.audit(c.env, "sensor_rekey", { user: u.name, ip: SEC.ip(c), detail: r.id }); return c.json(r); });
app.delete("/api/sensors/:id", async c => c.json(await SN.remove(c.env, c.get("user").name, c.req.param("id"))));
app.post("/api/sensors/:id/msg", async c => c.json(await SN.sendMsg(c.env, c.get("user").name, c.req.param("id"), (await c.req.json<any>()).text)));
app.get("/api/sensors/:id/series", async c => c.json(await SN.series(c.env, c.get("user").name, c.req.param("id"), Number(c.req.query("hours") || 24))));
app.get("/api/admin/firmware", async c => c.json(await SN.fwMeta(c.env)));
app.post("/api/admin/firmware", async c => { const u = c.get("user"); const m = await SN.putFirmware(c.env, await c.req.json<any>()); await SEC.audit(c.env, "firmware", { user: u.name, ip: SEC.ip(c), detail: `${m.version} ${m.size}B ${m.md5}` }); return c.json(m); });

// ── 콘솔 에이전트 팀 ──
app.get("/api/agents", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  if (!hasKey(c.env, "agent")) return c.json({ agents: [], envs: [], error: "ANTHROPIC_API_KEY 비밀값이 없어요" });
  if (u.providers && !u.providers.includes("agent")) return c.json({ agents: [], envs: [], error: "이 계정은 에이전트 팀을 쓸 수 없어요" });
  if (c.env.TRIAI_MOCK_AI) return c.json({ agents: [{ id: "agent_mock", name: "Commander", model: "claude-opus-5-5", description: "가짜 에이전트 (시험용)" }], envs: [{ id: "env_mock", name: "safe-limited" }], cap: await agentCap(ctx) });
  try { return c.json({ agents: await AG.listAgents(c.env, c.req.query("force") === "1"), envs: await AG.listEnvs(c.env), cap: await agentCap(ctx) }); }
  catch (e: any) { return c.json({ agents: [], envs: [], error: `Console에서 목록을 못 받았어요: ${String(e?.message || e).slice(0, 300)}` }); }
});
app.get("/api/agents/file/:conv/:fid", async c => AG.file(c.env, c.get("user").name, c.req.param("conv"), c.req.param("fid")));

app.post("/api/ask-more", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  const req = await c.req.json<{ conv_id: string; turn: number; targets: Target[] }>();
  return stream(c, (signal, emit) => askMore(ctx, req.conv_id, req.turn, req.targets, signal, emit));
});
app.post("/api/synth", async c => {
  const u = c.get("user"), ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers);
  const req = await c.req.json<{ conv_id: string; turn: number; judge: Target }>();
  return stream(c, (signal, emit) => synth(ctx, req.conv_id, req.turn, req.judge, signal, emit));
});
app.post("/api/feedback", async c => {
  const req = await c.req.json<{ conv_id: string; turn: number; provider: string; value: string }>();
  const cv = await DB.updateConv(c.env, c.get("user").name, req.conv_id, cv => {
    if (!(req.turn >= 0 && req.turn < cv.turns.length)) throw new HTTPException(400, { message: "잘못된 턴 번호" });
    const t = cv.turns[req.turn];
    if (!t.group) { const cats = R.defaults(); if (t.category in R.LEGACY) [t.group, t.category] = R.LEGACY[t.category]; else [t.group, t.category] = R.classify(t.q, cats); }
    if (req.value === "best") t.best = t.best === req.provider ? null : req.provider;
    else { const a = ownAnswer(t, req.provider); if (!a) throw new HTTPException(404, { message: "그 AI의 답이 없어요" }); a.rating = ({ up: 1, down: -1 } as any)[req.value] ?? 0; }
  });
  return c.json(cv.turns[req.turn]);
});
app.post("/api/turn-category", async c => {
  const req = await c.req.json<{ conv_id: string; turn: number; sub: string }>();
  const ix = R.index(await getCats(c.env, c.get("user").name));
  if (!(req.sub in ix)) throw new HTTPException(400, { message: "없는 분류예요" });
  const cv = await DB.updateConv(c.env, c.get("user").name, req.conv_id, cv => { const t = cv.turns[req.turn]; t.group = ix[req.sub][0]; t.category = req.sub; t.category_fixed = true; });
  return c.json(cv.turns[req.turn]);
});

// ── 기억 ──
app.get("/api/memory", async c => { const u = c.get("user"); const ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers); return c.json({ enabled: ctx.s.memory_enabled !== false, items: await DB.kvGet(c.env, u.name, "memory", []) }); });
app.post("/api/memory", async c => {
  const u = c.get("user"); const { text } = await c.req.json<{ text: string }>();
  const mem = await DB.kvGet<any[]>(c.env, u.name, "memory", []);
  const item = { id: DB.newId(8), text: String(text || "").trim().slice(0, 500), time: DB.nowIso() };
  if (!item.text) throw new HTTPException(400, { message: "내용이 없어요" });
  await DB.kvPut(c.env, u.name, "memory", [...mem, item].slice(-200)); return c.json(item);
});
app.put("/api/memory/:mid", async c => {
  const u = c.get("user"); const { text } = await c.req.json<{ text: string }>();
  const mem = await DB.kvGet<any[]>(c.env, u.name, "memory", []);
  const it = mem.find(m => m.id === c.req.param("mid")); if (!it) throw new HTTPException(404, { message: "없음" });
  it.text = String(text || "").trim().slice(0, 500); await DB.kvPut(c.env, u.name, "memory", mem); return c.json(it);
});
app.delete("/api/memory/:mid", async c => { const u = c.get("user"); const mem = await DB.kvGet<any[]>(c.env, u.name, "memory", []); await DB.kvPut(c.env, u.name, "memory", mem.filter(m => m.id !== c.req.param("mid"))); return c.json({ ok: true }); });
app.delete("/api/memory", async c => { await DB.kvPut(c.env, c.get("user").name, "memory", []); return c.json({ ok: true }); });

// ── 기억 제안 · 아티팩트 · 공유 · 프리셋 · 모드 · 스타일 · 프로젝트 · 검색 ──
app.post("/api/memory/suggest", async c => {
  const u = c.get("user"); const { conv_id, turn } = await c.req.json<{ conv_id: string; turn: number }>();
  const cv = await DB.loadConv(c.env, u.name, conv_id);
  const turns = cv.turns.slice(Math.max(0, turn - 3), turn + 1);
  const talk = turns.map(t => `사용자: ${t.q}\nAI: ${(Object.values<any>(t.answers || {}).find(a => a.text)?.text || "").slice(0, 1500)}`).join("\n\n");
  const have = await DB.kvGet<any[]>(c.env, u.name, "memory", []);
  const known = have.map(m => "- " + m.text).join("\n") || "(없음)";
  const pm = await pickModel(c.env, new Set(Object.keys(turns[turns.length - 1]?.answers || {}).map(k => k.split("@")[0])));
  if (!pm) throw new HTTPException(400, { message: "사용할 수 있는 AI가 없어요" });
  const text = await askOnce(c.env, pm[0], pm[1], "짧고 정확하게 답해.", `아래 대화에서 사용자 본인에 대한 오래 유효한 사실이나 취향(하는 일, 관심사, 선호하는 설명 방식 등) — 그날만의 일이나 민감한 개인정보는 제외 — 을 최대 3개 뽑아. 한 줄에 하나씩, '- '로 시작하는 짧은 문장으로만 답해. 이미 기억 중인 것과 같은 건 빼. 없으면 '없음'이라고만 답해.\n\n[이미 기억 중]\n${known}\n\n[대화]\n${talk}`, 400);
  const items = text.split("\n").map(x => x.trim()).filter(x => /^[-•*] /.test(x)).map(x => x.slice(2).trim()).filter(x => x && x !== "없음").slice(0, 3);
  return c.json({ suggestions: items });
});
app.get("/api/artifacts", async c => c.json(await ART.list(c.env, c.get("user").name, c.req.query("q") || "")));
app.get("/api/artifacts/:cid/:turn/:key/:n", async c => c.json(await ART.get(c.env, c.get("user").name, c.req.param("cid"), Number(c.req.param("turn")), c.req.param("key"), Number(c.req.param("n")))));
app.get("/gw/share", async c => c.json(await SH.mine(c.env, c.get("user").name)));
app.post("/gw/share", async c => { if (Number(c.req.header("content-length") || 0) > SH.PUB_MAX * 2 + 10_000) throw new HTTPException(400, { message: "아티팩트가 너무 커서 공유할 수 없어요 (1MB까지)" }); const u = c.get("user"); const r = await SH.create(c.env, u.name, await c.req.json()); await SEC.audit(c.env, "share_create", { user: u.name, ip: SEC.ip(c), detail: r.id }); return c.json(r); });
app.delete("/gw/share/:sid", async c => { const u = c.get("user"); return c.json(await SH.remove(c.env, u.name, u.admin, c.req.param("sid"))); });
app.get("/s/:sid", c => SH.viewPage(c.env, c.req.param("sid"), SEC.ip(c)));
app.get("/s/:sid/frame", c => SH.framePage(c.env, c.req.param("sid")));
app.get("/api/presets", async c => c.json(await CAT.presetsLoad(c.env, c.get("user").name)));
app.post("/api/presets", async c => { const u = c.get("user"); const items = await DB.kvGet<any[]>(c.env, u.name, "presets", []); const p = { id: DB.newId(8), ...CAT.presetClean(await c.req.json()) }; await CAT.presetSave(c.env, u.name, [...items, p]); return c.json(p); });
app.put("/api/presets/:pid", async c => {
  const u = c.get("user"); const pid = c.req.param("pid"); const items = await DB.kvGet<any[]>(c.env, u.name, "presets", []);
  const i = items.findIndex(p => p.id === pid);
  if (i < 0) throw new HTTPException(CAT.BUILTIN_PRESETS.some(p => p.id === pid) ? 400 : 404, { message: CAT.BUILTIN_PRESETS.some(p => p.id === pid) ? "기본 프리셋은 고칠 수 없어요 (복제해서 쓰세요)" : "프리셋이 없어요" });
  items[i] = { id: pid, ...CAT.presetClean(await c.req.json()) }; await CAT.presetSave(c.env, u.name, items); return c.json(items[i]);
});
app.delete("/api/presets/:pid", async c => { const u = c.get("user"); await CAT.presetSave(c.env, u.name, (await DB.kvGet<any[]>(c.env, u.name, "presets", [])).filter(p => p.id !== c.req.param("pid"))); return c.json({ ok: true }); });
app.get("/api/modes", async c => { const u = c.get("user"); const ms = await CAT.modesPublic(c.env, u.name); return c.json(u.providers ? ms.map(m => ({ ...m, available: m.available && u.providers!.includes(m.provider) })) : ms); });
app.put("/api/modes/:mid", async c => c.json(await CAT.modeSet(c.env, c.get("user").name, c.req.param("mid"), await c.req.json())));
app.get("/api/styles", async c => c.json(await CAT.stylesLoad(c.env, c.get("user").name)));
app.post("/api/styles", async c => { const u = c.get("user"); return c.json(await CAT.styleCreate(c.env, u.name, await c.req.json(), u.providers ? new Set(u.providers) : null)); });
app.put("/api/styles/:sid", async c => {
  const u = c.get("user"); const req = await c.req.json<any>(); const styles = await CAT.stylesLoad(c.env, u.name);
  const st = styles.find(x => x.id === c.req.param("sid")); if (!st) throw new HTTPException(404, { message: "스타일을 찾을 수 없어요" });
  st.name = String(req.name || "").trim().slice(0, 20) || st.name; st.description = String(req.description || "").trim().slice(0, 3000) || st.description;
  await DB.kvPut(c.env, u.name, "styles", styles); return c.json(st);
});
app.delete("/api/styles/:sid", async c => { const u = c.get("user"); await DB.kvPut(c.env, u.name, "styles", (await CAT.stylesLoad(c.env, u.name)).filter(x => x.id !== c.req.param("sid"))); return c.json({ ok: true }); });
app.get("/api/projects", async c => c.json(await PJ.list(c.env, c.get("user").name)));
app.post("/api/projects", async c => c.json(await PJ.create(c.env, c.get("user").name, await c.req.json())));
app.get("/api/projects/:pid", async c => c.json(await PJ.get(c.env, c.get("user").name, c.req.param("pid"))));
app.put("/api/projects/:pid", async c => c.json(await PJ.update(c.env, c.get("user").name, c.req.param("pid"), await c.req.json())));
app.delete("/api/projects/:pid", async c => c.json(await PJ.remove(c.env, c.get("user").name, c.req.param("pid"), c.req.query("delete_chats") === "true")));
app.post("/api/projects/:pid/files", async c => c.json(await PJ.addFile(c.env, c.get("user").name, c.req.param("pid"), await c.req.json())));
app.get("/api/projects/:pid/files/:fid", async c => c.json(await PJ.readFile(c.env, c.get("user").name, c.req.param("pid"), c.req.param("fid"))));
app.delete("/api/projects/:pid/files/:fid", async c => c.json(await PJ.deleteFile(c.env, c.get("user").name, c.req.param("pid"), c.req.param("fid"))));
app.get("/api/websearch", async c => { const u = c.get("user"); const ctx = await ctxOf(c.env, u.name, u.daily_limit, u.providers); return c.json(await S.search(c.env, c.req.query("q") || "", 5, ctx.s.search_engine)); });
app.get("/api/admin/audit", async c => c.json(await SEC.auditList(c.env, Number(c.req.query("n") || 200))));

// ── 아직 안 옮긴 기능: 화면이 깨지지 않게 빈 값 ──
const empty = (v: unknown) => (c: any) => c.json(v);
app.get("/api/bots", empty([])); app.get("/api/bots/templates", empty([])); app.get("/api/bots-unread", empty({ total: 0, by_bot: {} }));
app.get("/api/skills", empty([])); app.get("/api/routines", empty([])); app.get("/api/local-models", empty([]));
app.get("/api/classifier", empty({ mode: "keyword", embed_model: "", embed_ok: false, judge_model: "", judge_ok: false }));
app.get("/api/google/status", empty({ configured: false, connected: false, email: "", scopes: [], allow_write: false }));
app.get("/api/cam/status", empty({ available: false })); app.get("/api/voice/status", empty({ ok: false, model: "" }));
app.get("/gw/team/teams", empty([])); app.get("/gw/team/chat/unread", empty({})); app.get("/gw/team/shares", empty([]));
app.get("/api/admin/stats", async c => {
  const u = c.get("user");
  const rows = (await c.env.DB.prepare("SELECT day, provider, usd FROM usage WHERE user=? ORDER BY day").bind(u.name).all<any>()).results;
  const usage: Record<string, Record<string, number>> = {};
  for (const r of rows) (usage[r.day] ??= {})[r.provider] = (usage[r.day]?.[r.provider] || 0) + r.usd;
  const days: string[] = []; const t0 = Date.now() + 9 * 3600e3;
  for (let i = 29; i >= 0; i--) days.push(new Date(t0 - i * 86400e3).toISOString().slice(0, 10));
  const month = DB.today().slice(0, 7);
  const convs = await DB.allConvs(c.env, u.name, 1000);
  const byModel: Record<string, any> = {}; let turns = 0;
  for (const cv of convs) for (const t of cv.turns) {
    turns++;
    for (const a of [...Object.values<any>(t.answers || {}), ...(t.synth ? [t.synth] : [])]) {
      if (!a?.model) continue;
      const m = (byModel[a.model] ??= { provider: a.provider, calls: 0, errors: 0, cost: 0, sec: 0 });
      m.calls++; m.errors += a.error ? 1 : 0; m.cost += a.cost || 0; m.sec += a.sec || 0;
    }
  }
  for (const m of Object.values(byModel)) m.avg_sec = m.calls ? Math.round(m.sec / m.calls * 100) / 100 : 0;
  const sum = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + v, 0);
  const nproj = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE user=?").bind(u.name).first<{ n: number }>())?.n || 0;
  const shares = await SH.mine(c.env, u.name);
  return c.json({
    daily: days.map(d => ({ day: d, ...(usage[d] || {}) })),
    month_total: Object.entries(usage).filter(([d]) => d.startsWith(month)).reduce((n, [, v]) => n + sum(v), 0),
    all_total: Object.values(usage).reduce((n, v) => n + sum(v), 0),
    conversations: convs.length, turns, projects: nproj, by_model: byModel,
    routing: { categories: await getCats(c.env, u.name), stats: R.statsFromConvs(convs) },
    storage: { data: convs.reduce((n, cv) => n + JSON.stringify(cv).length, 0), backups: 0 }, broken: [], maintenance: null, backups: [],
    serverless: true, shares, audit: u.admin ? await SEC.auditList(c.env, 30) : [],
  });
});
/** 내 데이터 전체를 JSON 파일로 내려받기 (대화·설정·분류·기억·프리셋·스타일·프로젝트) */
app.get("/api/admin/backup", async c => {
  const u = c.get("user");
  const convs = await DB.allConvs(c.env, u.name, 100000);
  const kv = (await c.env.DB.prepare("SELECT key, data FROM kv WHERE user=?").bind(u.name).all<any>()).results;
  const projects = await PJ.list(c.env, u.name);
  const files = (await c.env.DB.prepare("SELECT id, project_id, name, content, added FROM project_files WHERE user=?").bind(u.name).all<any>()).results;
  const body = JSON.stringify({ version: "triai-workers-1", user: u.name, exported: DB.nowIso(), conversations: convs, kv: Object.fromEntries(kv.map(r => [r.key, JSON.parse(r.data)])), projects, project_files: files });
  await SEC.audit(c.env, "backup_download", { user: u.name, ip: SEC.ip(c), detail: `${convs.length} convs` });
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="triai-backup-${DB.today()}.json"` } });
});
app.all("/api/*", c => c.json({ detail: "서버 없는 TriAI에서는 아직 없는 기능이에요" }, 404));

// ── 화면: 로그인한 사람에게만 static 파일 ──
app.get("*", c => {
  const u = new URL(c.req.url);
  if (u.pathname === "/" || u.pathname === "/index.html") { u.pathname = "/index.html"; return c.env.ASSETS.fetch(new Request(u.toString(), c.req.raw)); }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
