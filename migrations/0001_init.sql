-- TriAI on Workers — 1단계 스키마
CREATE TABLE IF NOT EXISTS users (
  name TEXT PRIMARY KEY,            -- 아이디 (2~20자, 영문·숫자·-_)
  pw TEXT NOT NULL,                 -- "salt_hex$hash_hex" (PBKDF2-SHA256 200,000회, 파이 게이트웨이와 동일)
  admin INTEGER NOT NULL DEFAULT 0,
  daily_limit REAL NOT NULL DEFAULT 1.0,   -- 관리자가 정한 하루 한도(USD)
  created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,            -- sha256(토큰)
  user TEXT NOT NULL,
  exp INTEGER NOT NULL              -- unix 초
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  title TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  project_id TEXT,
  bot_id TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL                -- 대화 전체 JSON (파이 때 파일 1개와 같은 모양)
);
CREATE INDEX IF NOT EXISTS conv_user_updated ON conversations(user, updated DESC);
CREATE TABLE IF NOT EXISTS usage (
  user TEXT NOT NULL,
  day TEXT NOT NULL,                -- YYYY-MM-DD (Asia/Seoul)
  provider TEXT NOT NULL,
  usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user, day, provider)
);
CREATE TABLE IF NOT EXISTS kv (                 -- 사람별 작은 JSON들: settings, categories, presets, memory …
  user TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  updated TEXT NOT NULL,
  PRIMARY KEY (user, key)
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (             -- 공유 링크 (2단계에서 사용)
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_fails (        -- 10분에 N번 틀리면 잠깐 막기
  ip TEXT PRIMARY KEY,
  times TEXT NOT NULL
);
