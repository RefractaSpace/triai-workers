/* history.ts — 모델마다 보낼 지난 대화 만들기·자르기 (파이 history.py 그대로) */
import type { Msg } from "./providers";

export const SUMMARY_ACK = "앞선 대화 내용을 기억하고 이어서 도울게요.";

export type Turn = { q: string; answers: Record<string, any>; synth?: any; files?: any[]; images?: string[]; [k: string]: any };
export type Conv = { id: string; title: string; created: string; updated: string; project_id?: string | null; bot_id?: string | null;
  turns: Turn[]; summary?: { upto: number; text: string; sig?: string } | null; archive?: any[]; unread?: boolean; [k: string]: any };

export function ownAnswer(t: Turn, key: string): any {
  let a = t.answers?.[key];
  if (a == null && key.startsWith("local@")) { const old = t.answers?.["local"]; if (old && old.model === key.slice(6)) a = old; }
  return a;
}

export function withFiles(q: string, files?: any[]): string {
  let out = "";
  for (const f of files || []) {
    if (f.indexed) out += `<file name="${f.name}" note="긴 문서라 질문마다 관련 부분만 [문서 발췌]로 보내요"/>\n`;
    else out += `<file name="${f.name}">\n${f.content}\n</file>\n`;
  }
  return out + q;
}

export async function summaryValid(conv: Conv): Promise<{ upto: number; text: string } | null> {
  const sm = conv.summary;
  if (!sm || !sm.text || !(sm.upto > 0) || sm.upto > conv.turns.length) return null;
  if (sm.sig && sm.sig !== await fingerprint(conv.turns.slice(0, sm.upto))) return null;
  return sm;
}

export function bestText(t: Turn): string {   // compact.py best_text: 종합 답 → 첫 정상 답
  if (t.synth && !t.synth.error && t.synth.text) return t.synth.text;
  const a = (Object.values(t.answers || {}) as any[]).find(x => !x.error && x.text);
  return a?.text || "";
}

export async function fingerprint(turns: Turn[]): Promise<string> {   // compact.py와 같은 규칙 (sha1 앞 16자)
  const s = turns.map(t => `${t.time ?? "None"}\x00${t.q ?? "None"}\x00${bestText(t).slice(0, 200)}\x01`).join("");
  const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export async function historyFor(conv: Conv, key: string): Promise<Msg[]> {
  let msgs: Msg[] = [];
  const sm = await summaryValid(conv);
  let turns = conv.turns;
  if (sm) {
    msgs = [{ role: "user", content: `[앞선 대화 ${sm.upto}턴 요약 — 자동으로 만든 기억 메모]\n${sm.text}` }, { role: "assistant", content: SUMMARY_ACK }];
    const raw = turns.slice(0, sm.upto).flatMap(t => (t.files || []).filter((f: any) => f.raw));
    if (raw.length) msgs[0] = { ...msgs[0], content: withFiles("", raw) + "\n" + msgs[0].content };
    turns = turns.slice(sm.upto);
  }
  for (const t of turns) {
    const a = ownAnswer(t, key);
    let text: string | undefined = a && !a.error ? a.text : undefined;
    if (!text && t.synth && !t.synth.error) text = t.synth.text;
    if (!text) text = Object.values(t.answers || {}).find((x: any) => !x.error && x.text)?.text;
    if (text) msgs.push({ role: "user", content: withFiles(t.q, t.files) }, { role: "assistant", content: text });
  }
  return msgs;
}

export function trimHistory(msgs: Msg[], limit: number): [Msg[], number] {
  let dropped = 0;
  let head = msgs.length > 1 && msgs[1].content === SUMMARY_ACK ? msgs.slice(0, 2) : [];
  let body = msgs.slice(head.length);
  const size = () => [...head, ...body].reduce((n, m) => n + m.content.length, 0);
  while (body.length && size() > limit) { body = body.slice(2); dropped++; }
  if (head.length && size() > limit) head = [];
  let out = [...head, ...body];
  if (dropped && out.length && !head.length) out = [{ ...out[0], content: `(앞선 대화 ${dropped}턴은 길이 제한으로 생략됨)\n\n` + out[0].content }, ...out.slice(1)];
  return [out, dropped];
}

export const roughTokens = (text: string) => Math.ceil(text.length / 2);
