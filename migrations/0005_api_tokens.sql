-- 다른 채팅·프로그램에서 쓰는 TriAI 토큰 (원문은 저장 안 함, SHA-256만)
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  providers TEXT NOT NULL DEFAULT '["cf"]',
  daily_limit REAL NOT NULL DEFAULT 1,
  created TEXT NOT NULL,
  last_used TEXT
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user);
