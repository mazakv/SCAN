-- ============================================================
-- D1 (login-db) — 등급 · 태그 · 퀘스트 · 시즌 테이블 추가
--
-- 실행:  npx wrangler d1 execute login-db --remote --file=./sql/tags.sql
--
-- · users / rankings 등 기존 테이블은 건드리지 않습니다.
-- · 여러 번 실행해도 안전합니다 (IF NOT EXISTS / INSERT OR IGNORE).
-- · 이미 쌓인 rankings 기록으로 등급 진행도와 '최고 순위'를 한 번 채워 줍니다(맨 아래).
-- ============================================================

-- 현재 시즌 (한 줄짜리 상태 테이블). 지금은 시즌 1.
CREATE TABLE IF NOT EXISTS season_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  current_season INTEGER NOT NULL DEFAULT 1,
  started_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO season_state (id, current_season) VALUES (1, 1);

-- 유저별 프로필: 장착 중인 태그, 지금까지 도달한 최고 순위, 도배 방지 정보
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id      INTEGER PRIMARY KEY,           -- users.id
  equipped_tag TEXT,                          -- 장착 중인 태그 id (없으면 NULL)
  best_place   INTEGER,                       -- 지금까지 도달한 최고 순위(작을수록 좋음)
  last_run_at  TEXT,                          -- 마지막 기록 제출 시각(UTC)
  day_key      TEXT,                          -- 오늘 날짜(UTC, YYYY-MM-DD)
  day_stages   INTEGER NOT NULL DEFAULT 0,    -- 오늘 등급에 반영된 클리어 스테이지 수
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 누적 통계 (등급 = 누적 클리어 스테이지 수, 퀘스트 진행도 계산용)
CREATE TABLE IF NOT EXISTS user_stats (
  user_id        INTEGER NOT NULL,
  game           TEXT    NOT NULL,
  difficulty     TEXT    NOT NULL,
  stages_cleared INTEGER NOT NULL DEFAULT 0,  -- 누적 클리어 스테이지 수
  runs_played    INTEGER NOT NULL DEFAULT 0,  -- 누적 플레이 횟수
  runs_cleared   INTEGER NOT NULL DEFAULT 0,  -- 5스테이지 완주 횟수
  perfect_runs   INTEGER NOT NULL DEFAULT 0,  -- 기회를 하나도 잃지 않은 완주 횟수
  best_combo     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game, difficulty)
);

-- 유저가 가진 태그 (등급 태그 / 퀘스트 태그 / 한정판 태그 / 시즌 랭킹 태그 모두 여기 저장)
CREATE TABLE IF NOT EXISTS user_tags (
  user_id     INTEGER NOT NULL,
  tag_id      TEXT    NOT NULL,               -- tier-3 | q-first-clear | ltd-s1-pioneer | s1-number-forge-hard-1
  source      TEXT    NOT NULL,               -- tier | quest | limited | season
  obtained_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_user_tags_user ON user_tags (user_id);

-- 시즌별 TOP 3 결과 (시즌 종료 스크립트가 채움)
CREATE TABLE IF NOT EXISTS season_results (
  season     INTEGER NOT NULL,
  game       TEXT    NOT NULL,
  difficulty TEXT    NOT NULL,
  place      INTEGER NOT NULL,               -- 1 | 2 | 3 (동점이면 공동 순위)
  user_id    INTEGER NOT NULL,
  score      INTEGER NOT NULL,
  PRIMARY KEY (season, game, difficulty, user_id)
);

-- 지난 시즌 전체 랭킹 보관용
CREATE TABLE IF NOT EXISTS rankings_archive (
  season      INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  game        TEXT    NOT NULL,
  difficulty  TEXT    NOT NULL,
  best_score  INTEGER NOT NULL,
  best_stage  INTEGER NOT NULL,
  best_combo  INTEGER NOT NULL,
  plays       INTEGER NOT NULL,
  achieved_at TEXT    NOT NULL,
  PRIMARY KEY (season, user_id, game, difficulty)
);

-- ------------------------------------------------------------
-- 기존 기록 반영 (한 번만 적용되고, 다시 실행해도 덮어쓰지 않아요)
--  · 통계 : 이미 가진 최고 기록 1판만큼(클리어 스테이지 / 완주 / 콤보)을 인정
--  · 순위 : 현재 각 난이도에서의 순위 중 가장 좋은 값
-- ------------------------------------------------------------
INSERT OR IGNORE INTO user_stats
  (user_id, game, difficulty, stages_cleared, runs_played, runs_cleared, perfect_runs, best_combo)
SELECT user_id, game, difficulty, best_stage, plays, CASE WHEN best_stage >= 5 THEN 1 ELSE 0 END, 0, best_combo
  FROM rankings;

INSERT OR IGNORE INTO user_profiles (user_id, best_place)
SELECT t.user_id, MIN(t.place)
  FROM (
    SELECT r.user_id,
           RANK() OVER (PARTITION BY r.game, r.difficulty ORDER BY r.best_score DESC) AS place
      FROM rankings r
      JOIN users u ON u.id = r.user_id
  ) t
 GROUP BY t.user_id;
