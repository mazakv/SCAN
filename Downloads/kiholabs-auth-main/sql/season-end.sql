-- ============================================================
-- ★ 시즌 종료 스크립트 — 현재 시즌을 마감하고 다음 시즌을 시작합니다.
--
--   되돌릴 수 없어요. 먼저 미리보기로 누가 태그를 받는지 확인하세요:
--     npx wrangler d1 execute login-db --remote --file=./sql/season-preview.sql
--
--   확인이 끝났으면 실행:
--     npx wrangler d1 execute login-db --remote --file=./sql/season-end.sql
--
-- 하는 일
--   ① 이번 시즌 게임×난이도별 TOP 3 를 season_results 에 기록 (동점이면 공동 순위)
--   ② TOP 3 에게 '시즌 N · 난이도 · 1/2/3등' 태그 지급  (예: s1-number-forge-hard-1)
--   ③ 전체 랭킹을 rankings_archive 에 보관
--   ④ 시즌 번호 +1   (랭킹이 비어 있으면 올리지 않아요 → 실수로 두 번 실행해도 안전)
--   ⑤ 랭킹 초기화    (등급·퀘스트 진행도, 이미 받은 태그는 그대로 유지)
--
-- ※ 웹 API 로 열어 두지 않고 소유자만 실행하도록 만든 이유: 시즌 종료는 모든 유저에게 영향을 주기 때문이에요.
-- ============================================================

-- ① TOP 3 기록
INSERT OR IGNORE INTO season_results (season, game, difficulty, place, user_id, score)
SELECT (SELECT current_season FROM season_state WHERE id = 1),
       t.game, t.difficulty, t.place, t.user_id, t.best_score
  FROM (
    SELECT r.game, r.difficulty, r.user_id, r.best_score,
           RANK() OVER (PARTITION BY r.game, r.difficulty ORDER BY r.best_score DESC) AS place
      FROM rankings r
      JOIN users u ON u.id = r.user_id
  ) t
 WHERE t.place <= 3;

-- ② 태그 지급
INSERT OR IGNORE INTO user_tags (user_id, tag_id, source)
SELECT sr.user_id,
       's' || sr.season || '-' || sr.game || '-' || sr.difficulty || '-' || sr.place,
       'season'
  FROM season_results sr
 WHERE sr.season = (SELECT current_season FROM season_state WHERE id = 1);

-- ③ 전체 랭킹 보관
INSERT OR IGNORE INTO rankings_archive
  (season, user_id, game, difficulty, best_score, best_stage, best_combo, plays, achieved_at)
SELECT (SELECT current_season FROM season_state WHERE id = 1),
       user_id, game, difficulty, best_score, best_stage, best_combo, plays, achieved_at
  FROM rankings;

-- ④ 다음 시즌으로 (랭킹에 기록이 있을 때만)
UPDATE season_state
   SET current_season = current_season + 1,
       started_at = datetime('now')
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM rankings);

-- ⑤ 랭킹 초기화
DELETE FROM rankings;
