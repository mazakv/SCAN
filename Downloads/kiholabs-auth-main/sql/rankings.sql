-- ============================================================
-- D1 (login-db) — 게임 랭킹 테이블 추가
--
-- 실행:  npx wrangler d1 execute login-db --remote --file=./sql/rankings.sql
--
-- · 기존 users 테이블/데이터는 건드리지 않습니다.
-- · 여러 번 실행해도 안전합니다 (IF NOT EXISTS).
-- · 유저 × 게임 × 난이도 조합마다 "최고 기록 1행"만 저장합니다.
--   (게임을 할 때마다 행이 늘어나지 않으므로 조회가 항상 빠릅니다.)
-- ============================================================

CREATE TABLE IF NOT EXISTS rankings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,                 -- users.id
  game           TEXT    NOT NULL,                 -- number-forge | pixel-detective | mirror-beam
  difficulty     TEXT    NOT NULL,                 -- easy | normal | hard | extreme
  best_score     INTEGER NOT NULL CHECK (best_score >= 0),
  best_stage     INTEGER NOT NULL DEFAULT 0,       -- 최고 기록 당시 클리어한 스테이지 수
  best_combo     INTEGER NOT NULL DEFAULT 0,       -- 최고 기록 당시 최대 콤보
  plays          INTEGER NOT NULL DEFAULT 1,       -- 누적 플레이(기록 제출) 횟수
  achieved_at    TEXT    NOT NULL DEFAULT (datetime('now')),  -- 최고 기록 달성 시각(UTC)
  last_played_at TEXT    NOT NULL DEFAULT (datetime('now')),  -- 마지막 제출 시각(UTC, 도배 방지용)
  UNIQUE (user_id, game, difficulty)
);

-- 리더보드 조회(게임+난이도로 거른 뒤 점수순)를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_rankings_board ON rankings (game, difficulty, best_score DESC);
