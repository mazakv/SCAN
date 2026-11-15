-- ============================================================
-- D1 (login-db) — 프로필 · 프로필 사진 · 배경 테이블
--
-- 실행(선택):  npx wrangler d1 execute login-db --remote --file=./sql/profile.sql
--
-- · Worker 가 처음 쓸 때 자동으로 만들기 때문에 꼭 실행할 필요는 없어요.
-- · 여러 번 실행해도 안전합니다 (IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id    INTEGER PRIMARY KEY,           -- users.id
  bio        TEXT    NOT NULL DEFAULT '',   -- 한마디 (최대 100자)
  bg_id      TEXT,                          -- 장착한 배경 id (NULL = 기본)
  avatar_v   INTEGER NOT NULL DEFAULT 0,    -- 프로필 사진 버전(0 = 사진 없음) — 캐시 갱신용
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_avatars (
  user_id INTEGER PRIMARY KEY,
  mime    TEXT NOT NULL,                    -- image/jpeg | image/png | image/webp
  b64     TEXT NOT NULL                     -- base64 (최대 60KB)
);

CREATE TABLE IF NOT EXISTS user_frame (
  user_id  INTEGER PRIMARY KEY,
  frame_id TEXT NOT NULL                    -- 장착한 프로필 테두리 id (없으면 자동)
);

CREATE TABLE IF NOT EXISTS user_intro (
  user_id  INTEGER PRIMARY KEY,
  intro_id TEXT NOT NULL                    -- 장착한 프로필 입장 애니메이션 id (없으면 기본)
);
