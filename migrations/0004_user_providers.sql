-- 사람마다 쓸 수 있는 AI 회사 (팀원 계정: Cloudflare만 등). NULL = 전부
ALTER TABLE users ADD COLUMN providers TEXT;
