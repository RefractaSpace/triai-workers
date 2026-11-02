export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  SESSION_SECRET?: string;      // 첫 관리자 만들기 코드 등에 씀 (없으면 setup 코드는 KV에 임시 생성)
  TRIAI_PUBLIC?: string;
  TRIAI_MOCK_AI?: string;      // 테스트용: 진짜 AI 대신 가짜 답 (요금 0)
  TRIAI_GLOBAL_DAILY_LIMIT?: string;   // 계정 전체 하루 상한 (USD) — 비어 있으면 없음
  BRAVE_API_KEY?: string;      // 있으면 Brave 검색 (없으면 DuckDuckGo/위키백과)
  MCP_SECRET?: string;         // 앱 연동(MCP) 토큰 암호화 열쇠 (없으면 SESSION_SECRET에서 만듦)
}

export type Provider = "claude" | "gpt" | "gemini" | "cf";
export const PROVIDERS: Provider[] = ["claude", "gpt", "gemini", "cf"];
export const KEY_NAMES: Record<Provider, keyof Env> = {
  claude: "ANTHROPIC_API_KEY", gpt: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", cf: "CLOUDFLARE_API_TOKEN",
};
export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: "claude-sonnet-5-5", gpt: "gpt-5.6-luna", gemini: "gemini-3.8-flash", cf: "@cf/openai/gpt-oss-120b",
};
export const NAMES: Record<string, string> = { claude: "Claude", gpt: "GPT", gemini: "Gemini", cf: "Cloudflare", local: "로컬", agent: "에이전트 팀" };

export function hasKey(env: Env, p: string): boolean {
  if (env.TRIAI_MOCK_AI && (p in KEY_NAMES || p === "agent")) return true;
  if (p === "agent") return !!env.ANTHROPIC_API_KEY;   // 콘솔 에이전트 팀 = Claude 키
  if (p === "local") return true;                      // 로컬 모델은 화면(내 컴퓨터)이 직접 부름
  if (p === "cf") return !!(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
  if (!(p in KEY_NAMES)) return false;
  return !!env[KEY_NAMES[p as Provider]];
}

export function missingMsg(p: string): string {
  if (p === "cf") return "CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID 비밀값이 없어요 (wrangler secret put)";
  if (p === "agent") return "에이전트 팀은 ANTHROPIC_API_KEY 비밀값이 필요해요";
  return `${KEY_NAMES[p as Provider] ?? p} 비밀값이 없어요 (wrangler secret put)`;
}
