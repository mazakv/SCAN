-- ============================================================
-- D1 (login-db) — 태그 동시 3개 장착 + 신규 업적(속도/시간대) 지원
--
-- 실행:  npx wrangler d1 execute login-db --remote --file=./sql/multi-equip.sql
--
-- · sql/tags.sql 이 먼저 적용되어 있어야 합니다.
-- · 이 파일은 여러 번 실행해도 안전합니다 — 단, 맨 아래 ALTER TABLE
--   4줄만 예외입니다. SQLite(D1)는 "컬럼이 없을 때만 추가"를 지원하지
--   않아서, 두 번째 실행부터는 그 4줄에서 "duplicate column name"
--   오류가 날 수 있습니다. 그건 이미 적용됐다는 뜻이니 무시하셔도 됩니다.
-- ============================================================

-- 장착 슬롯: 유저 1명당 최대 3개(slot 1~3). 등급/퀘스트/한정판/시즌 태그
-- 무엇이든 슬롯에 넣을 수 있습니다.
CREATE TABLE IF NOT EXISTS user_equipped (
  user_id INTEGER NOT NULL,
  slot    INTEGER NOT NULL CHECK (slot IN (1, 2, 3)),
  tag_id  TEXT    NOT NULL,
  PRIMARY KEY (user_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_user_equipped_user ON user_equipped (user_id);

-- 기존에 장착돼 있던 태그(1개)는 슬롯 1로 그대로 옮겨 둡니다.
INSERT OR IGNORE INTO user_equipped (user_id, slot, tag_id)
SELECT user_id, 1, equipped_tag FROM user_profiles WHERE equipped_tag IS NOT NULL;

-- 아래 4줄은 최초 1회만 필요합니다 (재실행 시 오류가 나면 이미 적용된 것 — 무시).
ALTER TABLE user_stats    ADD COLUMN fastest_clear_ms INTEGER;              -- 5스테이지 완주 최고 기록(ms)
ALTER TABLE user_profiles ADD COLUMN flag_night_owl  INTEGER NOT NULL DEFAULT 0;  -- 새벽(00~05시 KST) 플레이
ALTER TABLE user_profiles ADD COLUMN flag_early_bird INTEGER NOT NULL DEFAULT 0;  -- 이른 아침(05~07시 KST) 플레이
ALTER TABLE user_profiles ADD COLUMN flag_weekend    INTEGER NOT NULL DEFAULT 0;  -- 주말(토·일, KST) 플레이
