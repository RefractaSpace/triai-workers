/* projects.ts — 프로젝트: 지침·지식 파일 (파이 projects.py, D1 저장) */
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { newId, nowIso, safeId } from "./db";

export const MAX_FILE_CHARS = 200_000, MAX_PROJECT_CHARS = 400_000;

async function row(env: Env, user: string, pid: string) {
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id=? AND user=?").bind(safeId(pid), user).first<any>();
  if (!p) throw new HTTPException(404, { message: "프로젝트를 찾을 수 없어요" });
  return p;
}
async function files(env: Env, pid: string) {
  return (await env.DB.prepare("SELECT id,name,chars,added FROM project_files WHERE project_id=? ORDER BY added").bind(pid).all<any>()).results;
}
async function summary(env: Env, user: string, p: any) {
  const fs = await files(env, p.id);
  const cc = await env.DB.prepare("SELECT COUNT(*) AS n FROM conversations WHERE user=? AND project_id=?").bind(user, p.id).first<{ n: number }>();
  return { id: p.id, name: p.name, description: p.description, instructions: p.instructions, created: p.created, updated: p.updated,
    files: fs, chars: fs.reduce((n: number, f: any) => n + f.chars, 0), conv_count: cc?.n || 0 };
}
export async function list(env: Env, user: string) {
  const rows = (await env.DB.prepare("SELECT * FROM projects WHERE user=? ORDER BY updated DESC").bind(user).all<any>()).results;
  return Promise.all(rows.map(p => summary(env, user, p)));
}
export async function get(env: Env, user: string, pid: string) { return summary(env, user, await row(env, user, pid)); }
export async function exists(env: Env, user: string, pid: string) { await row(env, user, pid); }
export async function create(env: Env, user: string, req: any) {
  const name = String(req?.name || "").trim();
  if (!name) throw new HTTPException(400, { message: "프로젝트 이름을 입력하세요" });
  const p = { id: newId(12), user, name: name.slice(0, 60), description: String(req.description || "").trim(), instructions: String(req.instructions || ""), created: nowIso(), updated: nowIso() };
  await env.DB.prepare("INSERT INTO projects(id,user,name,description,instructions,created,updated) VALUES(?,?,?,?,?,?,?)")
    .bind(p.id, user, p.name, p.description, p.instructions, p.created, p.updated).run();
  return summary(env, user, p);
}
export async function update(env: Env, user: string, pid: string, req: any) {
  await row(env, user, pid);
  const name = String(req?.name || "").trim();
  if (!name) throw new HTTPException(400, { message: "프로젝트 이름을 입력하세요" });
  await env.DB.prepare("UPDATE projects SET name=?, description=?, instructions=?, updated=? WHERE id=? AND user=?")
    .bind(name.slice(0, 60), String(req.description || "").trim(), String(req.instructions || ""), nowIso(), pid, user).run();
  return get(env, user, pid);
}
export async function touch(env: Env, user: string, pid: string) {
  await env.DB.prepare("UPDATE projects SET updated=? WHERE id=? AND user=?").bind(nowIso(), pid, user).run();
}
export async function remove(env: Env, user: string, pid: string, deleteChats: boolean) {
  await row(env, user, pid);
  await env.DB.batch([
    deleteChats ? env.DB.prepare("DELETE FROM conversations WHERE user=? AND project_id=?").bind(user, pid)
                : env.DB.prepare("UPDATE conversations SET project_id=NULL, data=json_set(data,'$.project_id',NULL) WHERE user=? AND project_id=?").bind(user, pid),
    env.DB.prepare("DELETE FROM project_files WHERE project_id=? AND user=?").bind(pid, user),
    env.DB.prepare("DELETE FROM projects WHERE id=? AND user=?").bind(pid, user),
  ]);
  return { ok: true };
}
export async function addFile(env: Env, user: string, pid: string, req: any) {
  await row(env, user, pid);
  const text = String(req?.content || "").replace(/\0/g, "");
  if (!text.trim()) throw new HTTPException(400, { message: "파일 내용이 비어 있어요" });
  if (text.length > MAX_FILE_CHARS) throw new HTTPException(400, { message: `파일이 너무 커요 (${text.length.toLocaleString()}자). 한 파일은 ${MAX_FILE_CHARS.toLocaleString()}자까지예요.` });
  const total = (await files(env, pid)).reduce((n: number, f: any) => n + f.chars, 0) + text.length;
  if (total > MAX_PROJECT_CHARS) throw new HTTPException(400, { message: `프로젝트 지식이 한도(${MAX_PROJECT_CHARS.toLocaleString()}자)를 넘어요. 다른 파일을 지우고 다시 올리세요.` });
  const name = String(req.name || "파일").split(/[\\/]/).pop()!.slice(0, 120);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO project_files(id,project_id,user,name,chars,content,added) VALUES(?,?,?,?,?,?,?)").bind(newId(10), pid, user, name, text.length, text, nowIso()),
    env.DB.prepare("UPDATE projects SET updated=? WHERE id=?").bind(nowIso(), pid),
  ]);
  return get(env, user, pid);
}
export async function readFile(env: Env, user: string, pid: string, fid: string) {
  const f = await env.DB.prepare("SELECT content FROM project_files WHERE id=? AND project_id=? AND user=?").bind(safeId(fid), safeId(pid), user).first<{ content: string }>();
  if (!f) throw new HTTPException(404, { message: "파일이 없어요" });
  return { content: f.content };
}
export async function deleteFile(env: Env, user: string, pid: string, fid: string) {
  await row(env, user, pid);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM project_files WHERE id=? AND project_id=? AND user=?").bind(safeId(fid), pid, user),
    env.DB.prepare("UPDATE projects SET updated=? WHERE id=?").bind(nowIso(), pid),
  ]);
  return get(env, user, pid);
}
/** 프로젝트 지침 + 지식 파일을 시스템 프롬프트에 붙일 글 */
export async function context(env: Env, user: string, pid?: string | null): Promise<string> {
  if (!pid) return "";
  let p: any;
  try { p = await row(env, user, pid); } catch { return ""; }
  const parts: string[] = [];
  if ((p.instructions || "").trim()) parts.push(`<project_instructions>\n${p.instructions.trim()}\n</project_instructions>`);
  const fs = (await env.DB.prepare("SELECT name, content FROM project_files WHERE project_id=? ORDER BY added").bind(pid).all<any>()).results;
  if (fs.length) parts.push("<project_knowledge>\n아래는 사용자가 올린 참고 자료야. 관련 있을 때 근거로 사용해.\n" + fs.map(f => `<file name="${f.name}">\n${f.content}\n</file>`).join("\n") + "\n</project_knowledge>");
  return parts.join("\n\n");
}
