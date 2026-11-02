-- 보안 강화 + 2단계 기능
CREATE TABLE IF NOT EXISTS audit (                -- 감사 기록: 로그인·관리자 작업·비밀번호 변경
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  user TEXT,
  ip TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_time ON audit(time DESC);
CREATE TABLE IF NOT EXISTS rate (                 -- 속도 제한 창 (키 = 종류:주체:시간창)
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_user ON projects(user, updated DESC);
CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user TEXT NOT NULL,
  name TEXT NOT NULL,
  chars INTEGER NOT NULL,
  content TEXT NOT NULL,
  added TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_files_project ON project_files(project_id);
ALTER TABLE shares ADD COLUMN aid TEXT NOT NULL DEFAULT '';
ALTER TABLE shares ADD COLUMN src TEXT NOT NULL DEFAULT '';
