/*
sensors.ts — 집 센서 (ESP32 → TriAI)

  ESP32 ──HTTPS──▶ POST /api/sensor   Authorization: Bearer <기기 열쇠>   {"readings":{"temp":23.4,"hum":48},"fw":"1.0.0","rssi":-60}
                 ◀── {"ok":true, "t":서버시각, "stats":{24시간 최저·최고}, "msg":"TriAI에서 보낸 글"?, "fw":{"version","md5","size"}?}
  새 펌웨어가 있으면 → GET /api/sensor/fw (같은 열쇠) → .bin + x-MD5 헤더 → ESP32가 MD5를 확인하고 바꿈 (무선 업데이트)

  · 기기 열쇠는 만들 때 한 번만 보여주고, 서버에는 SHA-256만 저장
  · 기기는 자기 주인 사용자에게만 기록 · 펌웨어는 관리자가 올림 (모든 기기 공통)
  · 측정값은 90일 보관 (가끔 청소)
*/
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { newId, nowIso } from "./db";

const KEEP_DAYS = 90;
const MIN_GAP_S = 20;                // 이보다 자주 보내면 저장은 건너뜀 (응답은 줌)
const FW_KEY = "sensor_fw", FW_META = "sensor_fw_meta";
const METRICS: Record<string, [string, string]> = {   // 이름 → [한국어, 단위]
  temp: ["온도", "°C"], hum: ["습도", "%"], press: ["기압", "hPa"], light: ["밝기", "%"], rssi: ["와이파이", "dBm"],
};

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const nowS = () => Math.floor(Date.now() / 1000);

export type Device = { id: string; user: string; name: string; created: string; last_seen: number | null; fw: string | null; rssi: number | null; latest: any; msg: string | null };
const row2dev = (r: any): Device => ({ ...r, latest: r.latest ? JSON.parse(r.latest) : null });

// ── 사용자 쪽 ──
export async function list(env: Env, user: string): Promise<Omit<Device, "user">[]> {
  const rows = (await env.DB.prepare("SELECT id,user,name,created,last_seen,fw,rssi,latest,msg FROM sensor_devices WHERE user=? ORDER BY created").bind(user).all<any>()).results;
  return rows.map(r => { const { user: _u, ...d } = row2dev(r); return d; });
}
export async function create(env: Env, user: string, name: string): Promise<{ id: string; name: string; key: string }> {
  name = String(name || "").trim().slice(0, 30);
  if (!name) throw new HTTPException(400, { message: "기기 이름을 입력하세요 (예: 내 방)" });
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sensor_devices WHERE user=?").bind(user).first<{ n: number }>();
  if ((n?.n || 0) >= 20) throw new HTTPException(400, { message: "센서 기기는 20개까지예요" });
  const id = newId(12), key = newId(32) + newId(32);          // 64자 (32바이트 무작위)
  await env.DB.prepare("INSERT INTO sensor_devices(id,user,name,key_hash,created) VALUES(?,?,?,?,?)").bind(id, user, name, await sha256(key), nowIso()).run();
  return { id, name, key };
}
async function own(env: Env, user: string, id: string): Promise<Device> {
  const r = await env.DB.prepare("SELECT * FROM sensor_devices WHERE id=? AND user=?").bind(String(id), user).first<any>();
  if (!r) throw new HTTPException(404, { message: "센서 기기를 찾을 수 없어요" });
  return row2dev(r);
}
export async function rename(env: Env, user: string, id: string, name: string) {
  await own(env, user, id);
  name = String(name || "").trim().slice(0, 30);
  if (!name) throw new HTTPException(400, { message: "이름이 비었어요" });
  await env.DB.prepare("UPDATE sensor_devices SET name=? WHERE id=?").bind(name, id).run();
  return { ok: true };
}
export async function rekey(env: Env, user: string, id: string) {
  await own(env, user, id);
  const key = newId(32) + newId(32);
  await env.DB.prepare("UPDATE sensor_devices SET key_hash=? WHERE id=?").bind(await sha256(key), id).run();
  return { id, key };
}
export async function remove(env: Env, user: string, id: string) {
  await own(env, user, id);
  await env.DB.batch([env.DB.prepare("DELETE FROM sensor_readings WHERE device=?").bind(id), env.DB.prepare("DELETE FROM sensor_devices WHERE id=?").bind(id)]);
  return { ok: true };
}
export async function sendMsg(env: Env, user: string, id: string, text: string) {
  await own(env, user, id);
  const t = String(text || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 60);
  await env.DB.prepare("UPDATE sensor_devices SET msg=?, msg_time=? WHERE id=?").bind(t || null, t ? nowS() : null, id).run();
  return { ok: true, msg: t };
}

/** 시간 구간별 평균 (그래프용) — 점 최대 ~150개 */
export async function series(env: Env, user: string, id: string, hours: number) {
  const dev = await own(env, user, id);
  hours = Math.max(1, Math.min(Number(hours) || 24, 24 * 90));
  const from = nowS() - hours * 3600, bucket = Math.max(60, Math.ceil(hours * 3600 / 150 / 60) * 60);
  const rows = (await env.DB.prepare("SELECT ts, data FROM sensor_readings WHERE device=? AND ts>=? ORDER BY ts").bind(id, from).all<{ ts: number; data: string }>()).results;
  const buckets = new Map<number, Record<string, [number, number]>>();
  for (const r of rows) {
    let d: any; try { d = JSON.parse(r.data); } catch { continue; }
    const b = Math.floor(r.ts / bucket) * bucket, acc = buckets.get(b) || {};
    for (const [k, v] of Object.entries(d)) if (typeof v === "number" && isFinite(v)) { const a = acc[k] || [0, 0]; a[0] += v; a[1]++; acc[k] = a; }
    buckets.set(b, acc);
  }
  const ts = [...buckets.keys()].sort((a, b) => a - b);
  const keys = [...new Set(ts.flatMap(t => Object.keys(buckets.get(t)!)))].filter(k => k in METRICS);
  const out: Record<string, (number | null)[]> = {};
  for (const k of keys) out[k] = ts.map(t => { const a = buckets.get(t)![k]; return a ? Math.round(a[0] / a[1] * 10) / 10 : null; });
  return { device: { id: dev.id, name: dev.name }, hours, bucket, ts, series: out, metrics: Object.fromEntries(keys.map(k => [k, METRICS[k]])) };
}

// ── 기기 쪽 ──
async function deviceOf(env: Env, auth: string | undefined): Promise<Device> {
  const key = (auth || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[0-9a-f]{64}$/.test(key)) throw new HTTPException(401, { message: "기기 열쇠가 없거나 모양이 틀려요" });
  const r = await env.DB.prepare("SELECT * FROM sensor_devices WHERE key_hash=?").bind(await sha256(key)).first<any>();
  if (!r) throw new HTTPException(401, { message: "모르는 기기 열쇠예요 (TriAI → 설정 → 센서 기기에서 확인)" });
  return row2dev(r);
}
export const deviceId = async (env: Env, auth?: string) => (await deviceOf(env, auth)).id;

function cleanReadings(raw: any): Record<string, number> {
  const out: Record<string, number> = {};
  const lim: Record<string, [number, number]> = { temp: [-40, 85], hum: [0, 100], press: [300, 1100], light: [0, 100] };
  for (const [k, [lo, hi]] of Object.entries(lim)) { const v = Number(raw?.[k]); if (raw?.[k] != null && isFinite(v) && v >= lo && v <= hi) out[k] = Math.round(v * 100) / 100; }
  return out;
}
const verNum = (v: string) => String(v || "0").split(".").map(x => parseInt(x) || 0).reduce((n, x) => n * 1000 + x, 0);

export async function ingest(env: Env, auth: string | undefined, body: any) {
  const dev = await deviceOf(env, auth);
  const t = nowS(), readings = cleanReadings(body?.readings);
  const rssi = Number.isFinite(+body?.rssi) ? Math.max(-120, Math.min(0, Math.round(+body.rssi))) : null;
  const fw = String(body?.fw || "").slice(0, 20) || null;
  const stmts = [env.DB.prepare("UPDATE sensor_devices SET last_seen=?, fw=?, rssi=?, latest=?, msg=NULL, msg_time=NULL WHERE id=?")
    .bind(t, fw, rssi, JSON.stringify({ ...readings, ts: t }), dev.id)];
  if (Object.keys(readings).length && (!dev.last_seen || t - dev.last_seen >= MIN_GAP_S))
    stmts.push(env.DB.prepare("INSERT INTO sensor_readings(device,ts,data) VALUES(?,?,?)").bind(dev.id, t, JSON.stringify({ ...readings, ...(rssi != null ? { rssi } : {}) })));
  await env.DB.batch(stmts);
  if (Math.random() < 0.01) await env.DB.prepare("DELETE FROM sensor_readings WHERE ts < ?").bind(t - KEEP_DAYS * 86400).run();
  const st = await env.DB.prepare("SELECT MIN(json_extract(data,'$.temp')) AS tmin, MAX(json_extract(data,'$.temp')) AS tmax, MIN(json_extract(data,'$.hum')) AS hmin, MAX(json_extract(data,'$.hum')) AS hmax FROM sensor_readings WHERE device=? AND ts>=?")
    .bind(dev.id, t - 86400).first<any>();
  const meta = await env.KV.get(FW_META, "json") as any;
  const out: any = { ok: true, t, name: dev.name, stats: st };
  if (dev.msg) out.msg = dev.msg;
  if (meta && fw && verNum(meta.version) > verNum(fw)) out.fw = { version: meta.version, md5: meta.md5, size: meta.size };
  return out;
}
export async function firmware(env: Env, auth: string | undefined): Promise<Response> {
  await deviceOf(env, auth);
  const meta = await env.KV.get(FW_META, "json") as any;
  const bin = await env.KV.get(FW_KEY, "arrayBuffer");
  if (!meta || !bin) throw new HTTPException(404, { message: "올려 둔 펌웨어가 없어요" });
  return new Response(bin, { headers: { "content-type": "application/octet-stream", "content-length": String(bin.byteLength), "x-MD5": meta.md5, "x-fw-version": meta.version, "cache-control": "no-store" } });
}

// ── 관리자: 펌웨어 올리기 ──
export async function putFirmware(env: Env, req: { version: string; b64: string }) {
  const version = String(req?.version || "").trim();
  if (!/^\d{1,3}(\.\d{1,3}){1,2}$/.test(version)) throw new HTTPException(400, { message: "버전은 1.2.3 같은 숫자 모양으로 (config.h의 FW_VERSION과 같게)" });
  let bin: Uint8Array;
  try { bin = Uint8Array.from(atob(String(req?.b64 || "")), c => c.charCodeAt(0)); } catch { throw new HTTPException(400, { message: "파일을 읽을 수 없어요" }); }
  if (bin.length < 100_000 || bin.length > 4_000_000) throw new HTTPException(400, { message: "ESP32 펌웨어(.bin)가 아닌 것 같아요 (크기 확인)" });
  if (bin[0] !== 0xE9) throw new HTTPException(400, { message: "ESP32 앱 펌웨어 파일이 아니에요 (첫 바이트가 0xE9여야 해요 — 'Export Compiled Binary'의 .ino.bin)" });
  const md5 = hex(await crypto.subtle.digest("MD5", bin));
  const meta = { version, md5, size: bin.length, time: nowIso() };
  await env.KV.put(FW_KEY, bin);
  await env.KV.put(FW_META, JSON.stringify(meta));
  return meta;
}
export const fwMeta = async (env: Env) => (await env.KV.get(FW_META, "json")) || null;

// ── AI 쪽: 최근 상태 요약 (시스템 지침) · ```sensor 도구 ──
export async function summary(env: Env, user: string): Promise<string> {
  const devs = (await list(env, user)).filter(d => d.latest && d.last_seen && nowS() - d.last_seen < 6 * 3600);
  if (!devs.length) return "";
  const lines = devs.map(d => {
    const v = Object.entries(d.latest).filter(([k]) => k in METRICS).map(([k, x]) => `${METRICS[k][0]} ${x}${METRICS[k][1]}`).join(", ");
    return `- ${d.name} (id ${d.id}, ${Math.round((nowS() - (d.last_seen || 0)) / 60)}분 전): ${v}`;
  });
  return "<home_sensors>\n사용자 집의 센서 최근값 (사용자가 방 온도·습도 등을 물으면 이걸로 답해. 지난 기록이 필요하면 ```sensor 블록에 \"기기id 시간수\"를 쓰고 닫아. 예: ```sensor\\nabc123 24\\n```):\n"
    + lines.join("\n") + "\n</home_sensors>";
}
export async function toolText(env: Env, user: string, body: string): Promise<[string, string, boolean]> {
  const [idRaw, hRaw] = body.trim().split(/\s+/);
  const devs = await list(env, user);
  const d = devs.find(x => x.id === idRaw) || devs.find(x => x.name === idRaw) || (devs.length === 1 ? devs[0] : null);
  if (!d) return ["센서 기록", `[센서 오류] '${idRaw}' 기기가 없어요. 있는 기기: ${devs.map(x => `${x.name}(${x.id})`).join(", ") || "없음"}`, false];
  const hours = Math.max(1, Math.min(Number(hRaw) || 24, 24 * 30));
  const s = await series(env, user, d.id, hours);
  if (!s.ts.length) return [`📈 ${d.name} 최근 ${hours}시간`, `[센서 기록: ${d.name}] 이 기간 기록이 없어요.`, false];
  const fmt = (t: number) => new Date((t + 9 * 3600) * 1000).toISOString().slice(5, 16).replace("T", " ");
  const step = Math.max(1, Math.ceil(s.ts.length / 48));
  const keys = Object.keys(s.series);
  const table = [`시각(한국) | ${keys.map(k => `${METRICS[k][0]}(${METRICS[k][1]})`).join(" | ")}`,
    ...s.ts.map((t, i) => [t, i] as const).filter(([, i]) => i % step === 0).map(([t, i]) => `${fmt(t)} | ${keys.map(k => s.series[k][i] ?? "-").join(" | ")}`)];
  const stat = keys.map(k => { const xs = s.series[k].filter((x): x is number => x != null); return `${METRICS[k][0]} 최저 ${Math.min(...xs)} · 최고 ${Math.max(...xs)} · 평균 ${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10}${METRICS[k][1]}`; });
  return [`📈 ${d.name} 최근 ${hours}시간`, `[센서 기록: ${d.name}, 최근 ${hours}시간, ${Math.round(s.bucket / 60)}분 평균]\n${stat.join("\n")}\n\n${table.join("\n")}\n\n이 기록을 바탕으로 답을 이어서 써. 그래프가 도움이 되면 \`\`\`chart 블록으로 그려.`, true];
}
