-- 집 센서 (ESP32): 기기 · 측정값
CREATE TABLE IF NOT EXISTS sensor_devices (
  id TEXT PRIMARY KEY,                 -- 기기 id (12자)
  user TEXT NOT NULL,                  -- 주인 (TriAI 사용자)
  name TEXT NOT NULL,                  -- 사람이 붙인 이름 (예: 내 방)
  key_hash TEXT NOT NULL,              -- 기기 열쇠의 SHA-256 (열쇠 자체는 저장 안 함)
  created TEXT NOT NULL,
  last_seen INTEGER,                   -- 마지막으로 보낸 시각 (유닉스 초)
  fw TEXT,                             -- 기기가 알려준 펌웨어 버전
  rssi INTEGER,                        -- 와이파이 세기
  latest TEXT,                         -- 마지막 측정값 JSON
  msg TEXT,                            -- 기기에 보낼 메시지 (보내면 지움)
  msg_time INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sensor_key ON sensor_devices(key_hash);
CREATE INDEX IF NOT EXISTS sensor_user ON sensor_devices(user);
CREATE TABLE IF NOT EXISTS sensor_readings (
  device TEXT NOT NULL,
  ts INTEGER NOT NULL,                 -- 유닉스 초
  data TEXT NOT NULL                   -- {"temp":23.4,"hum":48,...}
);
CREATE INDEX IF NOT EXISTS sensor_readings_dev_ts ON sensor_readings(device, ts);
