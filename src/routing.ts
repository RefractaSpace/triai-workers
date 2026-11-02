/* routing.ts — '자동' 모드의 두뇌 (파이 routing.py 그대로): 키워드 분류 → 평가(👍👎★) 승률로 모델 선택 */
export type Sub = { id: string; name: string; model: string; keywords: string };
export type Cat = { id: string; name: string; model: string; subs: Sub[] };
export const NAMES: Record<string, string> = { claude: "Claude", gpt: "GPT", gemini: "Gemini", local: "로컬", agent: "에이전트 팀", cf: "Cloudflare" };
const MIN_VOTES = 3;
export const DEFAULT_CATEGORIES: Cat[] = [
  {
    "id": "code",
    "name": "코딩",
    "model": "",
    "subs": [
      {
        "id": "code_debug",
        "name": "디버깅",
        "model": "",
        "keywords": "에러|오류|버그|디버그|안\\s*돼|작동\\s*안|traceback|exception|error|failed|고쳐"
      },
      {
        "id": "code_explain",
        "name": "코드 설명",
        "model": "",
        "keywords": "코드.*(설명|분석|이해)|이 코드|무슨 뜻|어떻게 작동"
      },
      {
        "id": "code_write",
        "name": "코드 작성",
        "model": "",
        "keywords": "```|코드|코딩|함수|프로그램|스크립트|파이썬|python|javascript|자바스크립트|typescript|c\\+\\+|\\bjava\\b|sql|html|css|api|알고리즘|아두이노|arduino|def |class |import |#include"
      }
    ]
  },
  {
    "id": "math",
    "name": "수학·공학",
    "model": "",
    "subs": [
      {
        "id": "math_proof",
        "name": "증명",
        "model": "",
        "keywords": "증명|보여라|유도해"
      },
      {
        "id": "math_calc",
        "name": "계산",
        "model": "",
        "keywords": "계산|구해|얼마|값을|몇\\s|\\d\\s*[\\+\\-\\*/\\^=]\\s*\\d|√|∫|Σ|방정식|적분|미분"
      },
      {
        "id": "math_concept",
        "name": "공학·과학 개념",
        "model": "",
        "keywords": "수식|공식|물리|화학|추력|비추력|노즐|로켓|엔진|행렬|벡터|확률|통계|역학|열역학|유체"
      }
    ]
  },
  {
    "id": "lang",
    "name": "언어",
    "model": "",
    "subs": [
      {
        "id": "lang_translate",
        "name": "번역",
        "model": "",
        "keywords": "번역|영어로|일본어로|중국어로|한국어로|translate|in english|in korean"
      },
      {
        "id": "lang_study",
        "name": "외국어 공부",
        "model": "",
        "keywords": "문법|단어|발음|영어\\s*공부|일본어\\s*공부|뜻이\\s*뭐|grammar"
      }
    ]
  },
  {
    "id": "write",
    "name": "글쓰기",
    "model": "",
    "subs": [
      {
        "id": "write_edit",
        "name": "교정",
        "model": "",
        "keywords": "다듬어|고쳐\\s*써|맞춤법|교정|퇴고|문장.*(자연|매끄)"
      },
      {
        "id": "write_creative",
        "name": "창작",
        "model": "",
        "keywords": "소설|가사|시를|시\\s*써|이야기|스토리|캐릭터|세계관"
      },
      {
        "id": "write_doc",
        "name": "문서",
        "model": "",
        "keywords": "써\\s*줘|작성해|보고서|발표|자기소개서|이메일|편지|에세이|기획서|계획서"
      }
    ]
  },
  {
    "id": "summary",
    "name": "정리",
    "model": "",
    "subs": [
      {
        "id": "summary_long",
        "name": "긴 자료 분석",
        "model": "",
        "keywords": ""
      },
      {
        "id": "summary_short",
        "name": "요약",
        "model": "",
        "keywords": "요약|정리해|핵심만|줄여"
      }
    ]
  },
  {
    "id": "study",
    "name": "공부",
    "model": "",
    "subs": [
      {
        "id": "study_quiz",
        "name": "퀴즈·암기",
        "model": "",
        "keywords": "퀴즈|문제\\s*내|암기|외우|시험\\s*대비"
      },
      {
        "id": "study_concept",
        "name": "개념 설명",
        "model": "",
        "keywords": "뭐야|무엇|왜|원리|설명해|알려\\s*줘|차이"
      }
    ]
  },
  {
    "id": "idea",
    "name": "아이디어",
    "model": "",
    "subs": [
      {
        "id": "idea_plan",
        "name": "계획·일정",
        "model": "",
        "keywords": "계획|일정|스케줄|순서|로드맵|할\\s*일"
      },
      {
        "id": "idea_brain",
        "name": "브레인스토밍",
        "model": "",
        "keywords": "아이디어|추천해|주제|이름\\s*지어|어떤\\s*게\\s*좋"
      }
    ]
  },
  {
    "id": "daily",
    "name": "일상",
    "model": "",
    "subs": [
      {
        "id": "daily_chat",
        "name": "짧은 대화",
        "model": "",
        "keywords": "^(안녕|고마워|ㅎㅇ|ㄱㅅ|오케이|ok|좋아)"
      },
      {
        "id": "daily_general",
        "name": "기타",
        "model": "",
        "keywords": ""
      }
    ]
  }
];
const FALLBACK: [string, string] = ["daily", "daily_general"], SHORT: [string, string] = ["daily", "daily_chat"], LONG: [string, string] = ["summary", "summary_long"];
const QUICK_BIGS = new Set(["daily"]);
export const LEGACY: Record<string, [string, string]> = { code: ["code", "code_write"], math: ["math", "math_concept"], translate: ["lang", "lang_translate"],
  writing: ["write", "write_doc"], long: LONG, quick: SHORT, general: FALLBACK };

export const defaults = (): Cat[] => JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
const re = (k: string) => { try { return new RegExp(k, "iu"); } catch { return null; } };   // 파이썬 정규식과 거의 호환 (\s, \d, \b)

export function index(cats: Cat[]): Record<string, [string, string, string, Sub]> {
  const ix: Record<string, [string, string, string, Sub]> = {};
  for (const b of cats) for (const s of b.subs) ix[s.id] = [b.id, b.name, s.name, s];
  return ix;
}
export function label(cats: Cat[], sub: string): string { const ix = index(cats); return sub in ix ? `${ix[sub][1]} › ${ix[sub][2]}` : "분류 없음"; }
const norm = (s: string) => s.replace(/[\s·›>/]/g, "").toLowerCase();

export function parseTag(text: string, cats: Cat[]): [string, [string, string] | null] {
  const m = /(?:^|\s)#(\S+)/.exec(text);
  if (!m) return [text, null];
  const tag = norm(m[1]);
  const rest = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim();
  for (const b of cats) for (const s of b.subs) if (tag === norm(s.name) || tag === norm(s.id)) return [rest, [b.id, s.id]];
  for (const b of cats) if (tag === norm(b.name) || tag === norm(b.id)) {
    for (const s of b.subs) if (s.keywords && re(s.keywords)?.test(rest)) return [rest, [b.id, s.id]];
    return [rest, [b.id, b.subs[b.subs.length - 1].id]];
  }
  return [text, null];
}

export function classify(text: string, cats: Cat[]): [string, string] {
  const t = text.trim(), ix = index(cats);
  if (t.length > 6000 && LONG[1] in ix) return LONG;
  for (const b of cats) for (const s of b.subs) if (s.keywords && re(s.keywords)?.test(t)) return [b.id, s.id];
  if (t.length < 25 && SHORT[1] in ix) return SHORT;
  if (FALLBACK[1] in ix) return FALLBACK;
  const last = cats[cats.length - 1];
  return [last.id, last.subs[last.subs.length - 1].id];
}

export const answerKey = (p: string, model: string) => (p === "local" ? `local@${model}` : p);
export const keyName = (k: string) => (k.startsWith("local@") ? `로컬 ${k.slice(6)}` : NAMES[k] ?? k);

type WL = { w: number; l: number };
export type Stats = { sub: Record<string, Record<string, WL>>; big: Record<string, Record<string, WL>> };
export function statsFromConvs(convs: { turns?: any[] }[]): Stats {
  const st: Stats = { sub: {}, big: {} };
  const add = (big: string, sub: string, key: string, win: boolean) => {
    for (const [lvl, cid] of [["sub", sub], ["big", big]] as const) {
      const s = ((st[lvl][cid] ??= {})[key] ??= { w: 0, l: 0 });
      s[win ? "w" : "l"]++;
    }
  };
  for (const c of convs) for (const t of c.turns || []) {
    let sub = t.category, big = t.group;
    if (sub in LEGACY && !big) [big, sub] = LEGACY[sub];
    if (!sub || !big) continue;
    for (const [key, a] of Object.entries<any>(t.answers || {})) {
      const k = key !== "local" ? key : answerKey("local", a.model || "");
      if (a.rating) add(big, sub, k, a.rating > 0);
    }
    if (t.best) for (const [key, a] of Object.entries<any>(t.answers || {})) {
      if (a.error) continue;
      add(big, sub, key !== "local" ? key : answerKey("local", a.model || ""), key === t.best);
    }
  }
  return st;
}

// 결정적 난수 (seed 문자열 → 0~1): 같은 질문엔 같은 선택
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

export function choose(group: string, sub: string, cands: Record<string, string>, stats: Stats, costs: Record<string, number | null>,
                       cats: Cat[], explore = 0.1, seed = ""): [string, string, boolean] {
  const keys = Object.keys(cands), ix = index(cats);
  const lab = sub in ix ? `${ix[sub][1]} › ${ix[sub][2]}` : "분류 없음";
  const cost = (k: string) => (costs[k] ?? 1e9);
  const byCost = (a: string, b: string) => cost(a) - cost(b);
  if (keys.length === 1) return [keys[0], `${lab}: 사용 가능한 모델이 하나뿐`, false];
  for (const [lvl, cid, what] of [["sub", sub, "세부"], ["big", group, "큰 분류"]] as const) {
    const row = stats[lvl][cid] || {};
    const rec: Record<string, WL> = Object.fromEntries(keys.map(k => [k, row[k] || { w: 0, l: 0 }]));
    const total = Object.values(rec).reduce((n, r) => n + r.w + r.l, 0);
    if (total < MIN_VOTES) continue;
    const rng = seeded(seed + lvl);
    const thin = keys.filter(k => rec[k].w + rec[k].l < MIN_VOTES);
    if (thin.length && rng() < explore) { const k = thin[Math.floor(rng() * thin.length)]; return [k, `${lab}: ${keyName(k)}의 평가가 적어서 가끔 시험 삼아 선택`, false]; }
    const score: Record<string, number> = Object.fromEntries(keys.map(k => [k, (rec[k].w + 1) / (rec[k].w + rec[k].l + 2)]));
    const top = Math.max(...Object.values(score));
    const close = keys.filter(k => score[k] >= top - 0.05).sort(byCost);
    const k = close[0], r = rec[k];
    let why = `${lab}: ${what} 평가 승률 ${Math.round(score[k] * 100)}% (${r.w}승 ${r.l}패)`;
    if (close.length > 1) why += " · 비슷한 후보 중 가장 쌈";
    return [k, why, false];
  }
  const b = cats.find(x => x.id === group), s = ix[sub]?.[3];
  for (const [assigned, where] of [[s?.model, "세부 담당"], [b?.model, "큰 분류 담당"]] as const)
    if (assigned && assigned in cands) return [assigned, `${lab}: 평가가 아직 적어서 ${where} 모델(${keyName(assigned)})`, false];
  const k = [...keys].sort(byCost)[0];
  return [k, `${lab}: 평가·담당 지정이 없어서 가장 싼 후보`, false];
}

export function validate(cats: any): Cat[] {
  if (!Array.isArray(cats) || !cats.length) throw new Error("큰 분류가 하나 이상 있어야 해요");
  const seen = new Set<string>(); const out: Cat[] = [];
  for (const b of cats) {
    const name = String(b?.name ?? "").trim();
    if (!name) throw new Error("이름이 빈 큰 분류가 있어요");
    const bid = String(b.id ?? "").trim() || "c" + Math.abs([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 1000000;
    const subs = b.subs || [];
    if (!subs.length) throw new Error(`'${name}'에 세부 분류가 하나도 없어요`);
    const nb: Cat = { id: bid, name: name.slice(0, 20), model: String(b.model ?? ""), subs: [] };
    for (const s of subs) {
      const sname = String(s?.name ?? "").trim();
      if (!sname) throw new Error(`'${name}' 안에 이름이 빈 세부 분류가 있어요`);
      if (nb.subs.some(x => x.name === sname.slice(0, 20))) throw new Error(`'${name}' 안에 '${sname}'가 두 번 있어요`);
      let sid = String(s.id ?? "").trim() || `${bid}_${nb.subs.length}`;
      const base = sid; let n = 2;
      while (seen.has(sid)) sid = `${base}_${n++}`;
      const kw = String(s.keywords ?? "").trim();
      if (kw && !re(kw)) throw new Error(`'${sname}'의 키워드 정규식이 잘못됐어요`);
      seen.add(sid);
      nb.subs.push({ id: sid, name: sname.slice(0, 20), model: String(s.model ?? ""), keywords: kw });
    }
    out.push(nb);
  }
  return out;
}
