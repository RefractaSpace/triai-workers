#!/usr/bin/env node
/* 파이 백업 폴더 → D1용 SQL (계정·대화·설정·분류·기억·사용량·업로드 이미지)
   사용:  node tools/import.mjs <백업의 triai 폴더> [out.sql] [--no-uploads]
     예:  node tools/import.mjs "C:\Users\sh3so\Downloads\triai-backup-20261025\files\home\pipi\triai" import.sql
   그 다음 (사용자가 실행):  npx wrangler d1 execute triai --remote --file=import.sql
   비밀번호 해시는 그대로 옮겨서 기존 비밀번호로 로그인됨. 같은 id가 이미 있으면 덮어씀. */
import fs from "node:fs";
import path from "node:path";

const [root, outFile = "import.sql", ...flags] = process.argv.slice(2);
if (!root) { console.error("사용: node tools/import.mjs <triai 폴더> [out.sql] [--no-uploads]"); process.exit(1); }
const noUploads = flags.includes("--no-uploads");
const q = v => "'" + String(v).replace(/'/g, "''") + "'";
const now = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19);
const readJson = (p, def) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return def; } };
const out = [];
const stats = { users: 0, convs: 0, kv: 0, usage: 0, uploads: 0, skipped: [] };

// 1) 계정
const users = readJson(path.join(root, "data", "gateway", "users.json"), {});
for (const [name, u] of Object.entries(users)) {
  if (!u.pw) { stats.skipped.push(`user ${name}: 비밀번호 없음`); continue; }
  out.push(`INSERT INTO users(name,pw,admin,daily_limit,created) VALUES(${q(name)},${q(u.pw)},${u.admin ? 1 : 0},${Number(u.limit ?? 1)},${q(now())}) ON CONFLICT(name) DO UPDATE SET pw=excluded.pw, admin=excluded.admin, daily_limit=excluded.daily_limit;`);
  stats.users++;
}

// 2) 사람별 데이터
const usersDir = path.join(root, "data", "users");
for (const name of fs.existsSync(usersDir) ? fs.readdirSync(usersDir) : []) {
  const d = path.join(usersDir, name, "data");
  if (!fs.existsSync(d)) continue;
  const convDir = path.join(d, "conversations");
  for (const f of fs.existsSync(convDir) ? fs.readdirSync(convDir).filter(x => x.endsWith(".json")) : []) {
    const c = readJson(path.join(convDir, f), null);
    if (!c || !c.id || !Array.isArray(c.turns)) { stats.skipped.push(`${name}/${f}: 깨짐`); continue; }
    out.push(`INSERT OR REPLACE INTO conversations(id,user,title,created,updated,project_id,bot_id,unread,turns,data) VALUES(${q(c.id)},${q(name)},${q(c.title || "")},${q(c.created || now())},${q(c.updated || now())},${c.project_id ? q(c.project_id) : "NULL"},${c.bot_id ? q(c.bot_id) : "NULL"},${c.unread ? 1 : 0},${c.turns.length},${q(JSON.stringify(c))});`);
    stats.convs++;
  }
  for (const [key, file] of [["settings", "settings.json"], ["categories", "categories.json"], ["memory", "memory.json"], ["presets", "presets.json"], ["styles", "styles.json"]]) {
    const v = readJson(path.join(d, file), null);
    if (v == null) continue;
    out.push(`INSERT OR REPLACE INTO kv(user,key,data,updated) VALUES(${q(name)},${q(key)},${q(JSON.stringify(key === "memory" && !Array.isArray(v) ? (v.items || []) : v))},${q(now())});`);
    stats.kv++;
  }
  const usage = readJson(path.join(d, "usage.json"), {});
  for (const [day, byProv] of Object.entries(usage)) for (const [prov, usd] of Object.entries(byProv)) {
    out.push(`INSERT OR REPLACE INTO usage(user,day,provider,usd) VALUES(${q(name)},${q(day)},${q(prov)},${Number(usd) || 0});`);
    stats.usage++;
  }
  const upDir = path.join(d, "uploads");
  if (!noUploads && fs.existsSync(upDir)) for (const f of fs.readdirSync(upDir).filter(x => x.endsWith(".img"))) {
    const bin = fs.readFileSync(path.join(upDir, f));
    if (bin.length > 900_000) { stats.skipped.push(`${name}/uploads/${f}: 900KB 초과`); continue; }
    const sig = bin.subarray(0, 4).toString("hex");
    const mime = sig.startsWith("89504e47") ? "image/png" : sig.startsWith("ffd8") ? "image/jpeg" : sig.startsWith("47494638") ? "image/gif" : sig.startsWith("52494646") ? "image/webp" : "image/png";
    out.push(`INSERT OR REPLACE INTO uploads(id,user,mime,bytes,created) VALUES(${q(f.slice(0, -4))},${q(name)},${q(mime)},X'${bin.toString("hex")}',${q(now())});`);
    stats.uploads++;
  }
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log(`${outFile}: 계정 ${stats.users} · 대화 ${stats.convs} · 설정류 ${stats.kv} · 사용량 ${stats.usage}일·AI · 업로드 ${stats.uploads}` + (stats.skipped.length ? `\n건너뜀:\n  ${stats.skipped.join("\n  ")}` : ""));
