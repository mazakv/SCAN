-- ============================================================
-- 시즌 종료 미리보기 — 조회만 하고 아무것도 바꾸지 않습니다.
--   npx wrangler d1 execute login-db --remote --file=./sql/season-preview.sql
--
-- 지금 시즌 종료 스크립트를 실행하면 누가 어떤 태그를 받는지 보여 줍니다.
-- ============================================================

SELECT (SELECT current_season FROM season_state WHERE id = 1) AS season,
       t.game, t.difficulty, t.place, u.username, t.best_score,
       's' || (SELECT current_season FROM season_state WHERE id = 1) || '-' || t.game || '-' || t.difficulty || '-' || t.place AS tag_id
  FROM (
    SELECT r.game, r.difficulty, r.user_id, r.best_score,
           RANK() OVER (PARTITION BY r.game, r.difficulty ORDER BY r.best_score DESC) AS place
      FROM rankings r
  ) t
  JOIN users u ON u.id = t.user_id
 WHERE t.place <= 3
 ORDER BY t.game, t.difficulty, t.place, u.username;
