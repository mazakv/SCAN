/* ==================================================================
   worker/rankings-snippet.js  —  D1 랭킹 API  (추가 전용 코드)

   ★ 기존 index.js 의 인증/캡차/라우팅 코드는 한 줄도 수정하지 않습니다.
     아래 두 곳에 "붙여넣기만" 하면 됩니다.

   [붙여넣기 ①]  PART A 전체  →  index.js 의  `export default {`  바로 위
   [붙여넣기 ②]  PART B 두 줄  →  index.js 라우터 안, `if (path === '/api/health')` 바로 위

   이 코드가 기존 index.js 에서 "가져다 쓰기만" 하는 것 (이미 있음, 수정 X):
     json(), ok(), fail(), requireUser()

   새 엔드포인트
     GET  /api/rankings?game=number-forge&difficulty=normal&limit=20&offset=0
          → 누구나 조회 가능. 로그인 토큰을 같이 보내면 `me`(내 순위)도 내려줍니다.
     POST /api/rankings      (Authorization: Bearer <JWT> 필수)
          { game, difficulty, score, stage, combo, durationMs }
          → 유저×게임×난이도별 "최고 기록"만 D1에 저장(upsert)

   기존 /api/score, /api/leaderboard(Supabase 경유)는 그대로 남아 있고, 이 코드는 사용하지 않습니다.
================================================================== */


/* ╔══════════════════════════════════════════════════════════════╗
   ║  PART A  —  `export default {` 바로 위에 붙여넣기              ║
   ╚══════════════════════════════════════════════════════════════╝ */

/* ---------- 랭킹: 설정 ---------- */
const RANK_GAMES = new Set(['number-forge', 'pixel-detective', 'mirror-beam']);
const RANK_DIFFICULTIES = new Set(['easy', 'normal', 'hard', 'extreme']);
// 난이도별 점수 상한 (게임의 점수 공식상 이론적 최대치보다 넉넉하게 잡은 서버 검증용 값)
const RANK_SCORE_CAPS = { easy: 20000, normal: 35000, hard: 60000, extreme: 90000 };
const RANK_MAX_STAGE = 5;
const RANK_MIN_MS_PER_STAGE = 2000;      // 스테이지 1개를 2초 안에 클리어했다면 비정상
const RANK_COOLDOWN_SEC = 10;            // 같은 게임·난이도 연속 제출 최소 간격

/* ---------- 랭킹: SQL ---------- */
// 순위(place)는 동점이면 같은 순위(1,2,2,4…). 동점자는 먼저 달성한 사람이 위에 표시됩니다.
const RANK_LIST_SQL = `
  SELECT RANK() OVER (ORDER BY r.best_score DESC) AS place,
         u.username,
         r.best_score, r.best_stage, r.best_combo, r.plays,
         strftime('%Y-%m-%dT%H:%M:%SZ', r.achieved_at) AS achieved_at
    FROM rankings r
    JOIN users u ON u.id = r.user_id
   WHERE r.game = ? AND r.difficulty = ?
   ORDER BY r.best_score DESC, r.achieved_at ASC, u.username ASC
   LIMIT ? OFFSET ?`;

const RANK_COUNT_SQL = `
  SELECT COUNT(*) AS total
    FROM rankings r
    JOIN users u ON u.id = r.user_id
   WHERE r.game = ? AND r.difficulty = ?`;

// 내 기록 + 내 순위(나보다 높은 점수의 수 + 1)
const RANK_ME_SQL = `
  SELECT r.best_score, r.best_stage, r.best_combo, r.plays,
         strftime('%Y-%m-%dT%H:%M:%SZ', r.achieved_at) AS achieved_at,
         (SELECT COUNT(*) + 1
            FROM rankings x
            JOIN users ux ON ux.id = x.user_id
           WHERE x.game = r.game AND x.difficulty = r.difficulty
             AND x.best_score > r.best_score) AS place
    FROM rankings r
   WHERE r.user_id = ? AND r.game = ? AND r.difficulty = ?`;

// 더 높은 점수일 때만 최고 기록(점수/스테이지/콤보/달성시각)을 갱신하고, 플레이 횟수는 항상 +1
const RANK_UPSERT_SQL = `
  INSERT INTO rankings
    (user_id, game, difficulty, best_score, best_stage, best_combo, plays, achieved_at, last_played_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  ON CONFLICT(user_id, game, difficulty) DO UPDATE SET
    best_stage  = CASE WHEN excluded.best_score > rankings.best_score THEN excluded.best_stage ELSE rankings.best_stage END,
    best_combo  = CASE WHEN excluded.best_score > rankings.best_score THEN excluded.best_combo ELSE rankings.best_combo END,
    achieved_at = CASE WHEN excluded.best_score > rankings.best_score THEN datetime('now')      ELSE rankings.achieved_at END,
    best_score  = MAX(rankings.best_score, excluded.best_score),
    plays       = rankings.plays + 1,
    last_played_at = datetime('now')`;

const RANK_PREV_SQL = `
  SELECT best_score,
         CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', last_played_at) AS INTEGER) AS age_sec
    FROM rankings
   WHERE user_id = ? AND game = ? AND difficulty = ?`;

/* ---------- 랭킹: 헬퍼 ---------- */
function rankInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function rankRows(results, myUsername) {
  return (results || []).map((r) => ({
    rank: Number(r.place),
    username: r.username,
    score: r.best_score,
    stage: r.best_stage,
    combo: r.best_combo,
    plays: r.plays,
    achieved_at: r.achieved_at,
    is_me: !!myUsername && r.username === myUsername,
  }));
}

function rankMe(row) {
  if (!row) return null;
  return {
    rank: Number(row.place),
    score: row.best_score,
    stage: row.best_stage,
    combo: row.best_combo,
    plays: row.plays,
    achieved_at: row.achieved_at,
  };
}

// 마이그레이션(sql/rankings.sql)을 안 돌렸을 때 원인을 바로 알 수 있게 안내합니다.
function rankDbError(request, err) {
  const msg = String((err && err.message) || err || '');
  console.error('rankings db error:', msg);
  if (/no such table/i.test(msg))
    return fail(request, '랭킹 테이블이 아직 없어요. sql/rankings.sql 을 D1에 먼저 적용해 주세요.', 503);
  return fail(request, '랭킹을 처리하는 중 오류가 발생했어요.', 500);
}

/* ---------- 랭킹: GET /api/rankings ---------- */
async function handleRankingsGet(request, env, url) {
  const game = String(url.searchParams.get('game') || 'number-forge');
  const difficulty = String(url.searchParams.get('difficulty') || 'normal');
  if (!RANK_GAMES.has(game)) return fail(request, '알 수 없는 게임입니다.');
  if (!RANK_DIFFICULTIES.has(difficulty)) return fail(request, '알 수 없는 난이도입니다.');

  const limit = rankInt(url.searchParams.get('limit'), 1, 50, 20);
  const offset = rankInt(url.searchParams.get('offset'), 0, 1000, 0);

  // 로그인은 선택 사항: 토큰이 유효하면 내 순위도 함께, 아니면 me: null
  const claims = await requireUser(request, env);

  try {
    const statements = [
      env.DB.prepare(RANK_LIST_SQL).bind(game, difficulty, limit, offset),
      env.DB.prepare(RANK_COUNT_SQL).bind(game, difficulty),
    ];
    if (claims) statements.push(env.DB.prepare(RANK_ME_SQL).bind(claims.sub, game, difficulty));

    const [list, count, mine] = await env.DB.batch(statements);
    const rows = rankRows(list.results, claims && claims.username);
    const total = (count.results && count.results[0] && count.results[0].total) || 0;

    return ok(request, {
      game,
      difficulty,
      total,
      has_more: offset + rows.length < total,
      rows,
      me: mine ? rankMe(mine.results && mine.results[0]) : null,
    });
  } catch (err) {
    return rankDbError(request, err);
  }
}

/* ---------- 랭킹: POST /api/rankings ---------- */
async function handleRankingsSubmit(request, env) {
  const claims = await requireUser(request, env);
  if (!claims)
    return fail(request, '게스트는 리더보드에 점수를 등록할 수 없습니다. 로그인 후 이용해 주세요.', 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(request, '요청 형식이 올바르지 않습니다.');

  const game = String(body.game || '');
  const difficulty = String(body.difficulty || '');
  const score = Number(body.score);
  const stage = Number(body.stage);
  const combo = Number(body.combo);
  const durationMs = Number(body.durationMs);

  if (!RANK_GAMES.has(game)) return fail(request, '알 수 없는 게임입니다.');
  if (!RANK_DIFFICULTIES.has(difficulty)) return fail(request, '알 수 없는 난이도입니다.');
  if (!Number.isInteger(stage) || stage < 1 || stage > RANK_MAX_STAGE)
    return fail(request, '스테이지 값이 올바르지 않습니다.');
  if (!Number.isInteger(combo) || combo < 0 || combo > RANK_MAX_STAGE)
    return fail(request, '콤보 값이 올바르지 않습니다.');
  if (!Number.isInteger(score) || score < 1 || score > RANK_SCORE_CAPS[difficulty])
    return fail(request, '점수 값이 올바르지 않습니다.');
  if (!Number.isFinite(durationMs) || durationMs < Math.max(3000, stage * RANK_MIN_MS_PER_STAGE)
      || durationMs > 6 * 60 * 60 * 1000)
    return fail(request, '플레이 기록이 올바르지 않습니다.');

  try {
    // 탈퇴/삭제된 계정의 토큰이면 거부
    const owner = await env.DB.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').bind(claims.sub).first();
    if (!owner) return fail(request, '계정을 찾을 수 없습니다. 다시 로그인해 주세요.', 401);

    const prev = await env.DB.prepare(RANK_PREV_SQL).bind(claims.sub, game, difficulty).first();
    if (prev && prev.age_sec < RANK_COOLDOWN_SEC)
      return fail(request, '잠시 후 다시 시도해 주세요.', 429);

    // 한 번의 왕복으로: 저장 → 내 순위 → 상위 5명  (batch 는 순서대로 실행되는 트랜잭션)
    const [, mine, top] = await env.DB.batch([
      env.DB.prepare(RANK_UPSERT_SQL).bind(claims.sub, game, difficulty, score, stage, combo),
      env.DB.prepare(RANK_ME_SQL).bind(claims.sub, game, difficulty),
      env.DB.prepare(RANK_LIST_SQL).bind(game, difficulty, 5, 0),
    ]);

    return ok(request, {
      message: '점수가 등록되었습니다.',
      is_new_best: !prev || score > prev.best_score,
      me: rankMe(mine.results && mine.results[0]),
      top: rankRows(top.results, claims.username),
    });
  } catch (err) {
    return rankDbError(request, err);
  }
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  PART B  —  라우터 안에 붙여넣기 (아래 두 줄)                   ║
   ║  위치: index.js 의  `if (path === '/api/health')`  바로 위      ║
   ╚══════════════════════════════════════════════════════════════╝

      if (path === '/api/rankings' && request.method === 'GET')
        return await handleRankingsGet(request, env, url);

      if (path === '/api/rankings' && request.method === 'POST')
        return await handleRankingsSubmit(request, env);

   ※ 사용 중인 index.js 가 `path` 대신 `url.pathname` 을 쓰는 버전이라면
     위 두 줄의 `path` 를 `url.pathname` 으로 바꿔 주세요.
   ※ OPTIONS(CORS 사전 요청)는 기존 코드가 이미 204 로 처리하므로 추가할 것이 없습니다.
*/
