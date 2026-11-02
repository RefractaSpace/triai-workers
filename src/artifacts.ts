/* artifacts.ts — 아티팩트 보관함 (파이 artifacts.py): 대화 기록에서 ```html/svg/mermaid/jsx 블록을 찾아 모음 */
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { allConvs, loadConv } from "./db";
import type { Conv, Turn } from "./history";

const FENCE = /(?:^|\n)```(html|svg|mermaid|jsx|tsx|react)[^\n]*\n([\s\S]*?)\n```/g;
export const KIND: Record<string, string> = { html: "웹페이지", svg: "그림(SVG)", mermaid: "도표", jsx: "React 앱", tsx: "React 앱", react: "React 앱" };
const DEFAULT_TITLES = new Set([...Object.values(KIND), "도표"]);

/** artifact.js의 artHash와 같은 값 (djb2, 32비트, 36진수 — UTF-16 단위) */
export function artHash(t: string): string {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return "a" + h.toString(36) + t.length.toString(36);
}
const pick = (src: string, re: RegExp) => { const m = re.exec(src); return m ? m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || null : null; };
export function titleOf(src: string, lang: string): string {
  if (lang === "html" || lang === "svg") return pick(src, /<title[^>]*>([\s\S]*?)<\/title>/i) || pick(src, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || KIND[lang];
  if (lang === "mermaid") return pick(src, /^\s*%%\s*title:\s*(.+)$/m) || pick(src, /^\s*title\s+(.+)$/m) || "도표";
  return pick(src, /\/\/\s*title:\s*(.+)/) || pick(src, /<h1[^>]*>([\s\S]*?)<\/h1>/) || pick(src, /export\s+default\s+function\s+(\w+)/) || "React 앱";
}
function* texts(t: Turn): Generator<[string, string]> {
  for (const [key, a] of Object.entries<any>(t.answers || {})) if (a && !a.error && a.text) yield [key, a.text];
  if (t.synth?.text) yield ["synth", t.synth.text];
}
export function scan(conv: Conv) {
  const out: any[] = [];
  conv.turns.forEach((t, ti) => {
    for (const [key, text] of texts(t)) {
      let n = 0;
      for (const m of text.matchAll(FENCE)) {
        const [, lang, body] = m;
        out.push({ id: artHash(lang + body), lang, title: titleOf(body, lang), kind: KIND[lang], turn: ti, key, n: n++, lines: body.split("\n").length,
          time: t.time, conv_id: conv.id, conv_title: conv.title || "" });
      }
    }
  });
  return out;
}
export async function list(env: Env, user: string, q = "") {
  const items = (await allConvs(env, user, 500)).flatMap(scan);
  const groups = new Map<string, any>();
  for (const a of items) {
    const named = !DEFAULT_TITLES.has(a.title);
    const k = named ? `${a.conv_id}|${a.lang}|${a.title}` : `${a.conv_id}|${a.id}`;
    const g = groups.get(k);
    if (!g || a.turn > g.turn || (a.turn === g.turn && a.n >= g.n)) groups.set(k, { ...a, versions: (g?.versions || 0) + 1 });
    else g.versions++;
  }
  let out = [...groups.values()].sort((a, b) => ((a.time || "") < (b.time || "") ? 1 : -1));
  const ql = q.trim().toLowerCase();
  if (ql) out = out.filter(a => a.title.toLowerCase().includes(ql) || a.conv_title.toLowerCase().includes(ql));
  return out.slice(0, 300);
}
export async function get(env: Env, user: string, convId: string, turn: number, key: string, n: number) {
  const conv = await loadConv(env, user, convId);
  const t = conv.turns[turn];
  if (!t) throw new HTTPException(404, { message: "아티팩트를 찾을 수 없어요" });
  for (const [k, text] of texts(t)) if (k === key) {
    const ms = [...text.matchAll(FENCE)];
    if (n >= 0 && n < ms.length) { const [, lang, body] = ms[n]; return { lang, src: body, title: titleOf(body, lang), id: artHash(lang + body) }; }
  }
  throw new HTTPException(404, { message: "아티팩트를 찾을 수 없어요" });
}
