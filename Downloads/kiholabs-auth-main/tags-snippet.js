/* ==================================================================
   worker/tags-snippet.js  —  등급 · 태그 · 퀘스트 · 시즌 · TOP100 보드 API  (추가 전용 코드)

   ★ 기존 index.js 와, 이미 붙여 넣은 rankings-snippet.js 는 수정하지 않습니다.
     아래 두 곳에 "붙여넣기만" 하면 됩니다.

   [붙여넣기 ①]  PART A 전체  →  index.js 의 `export default {` 바로 위 (rankings-snippet 의 PART A 다음 줄)
   [붙여넣기 ②]  PART B 다섯 줄 →  라우터 안, `if (path === '/api/health')` 바로 위

   이 코드가 "가져다 쓰기만" 하는 것 (이미 있음, 수정 X)
     index.js          : json(), ok(), fail(), requireUser()
     rankings-snippet  : RANK_GAMES, RANK_DIFFICULTIES, RANK_SCORE_CAPS, RANK_MAX_STAGE, RANK_MIN_MS_PER_STAGE,
                         RANK_COUNT_SQL, RANK_ME_SQL, RANK_PREV_SQL, RANK_UPSERT_SQL, rankInt(), rankMe()

   새 엔드포인트
     GET  /api/board?game=&difficulty=&limit=100   TOP 100 보드(행마다 태그 포함: 장착한 태그, 없으면 현재 등급 태그). 로그인 시 me 도 내려줌
     POST /api/runs                                한 판 결과 보고: 랭킹 저장 + 등급 경험치 + 퀘스트 진행 (로그인 필수)
     GET  /api/tags/me                             등급/태그/퀘스트/시즌 정보 (로그인 안 해도 카탈로그는 내려줌)
     POST /api/tags/equip   { tag_id | null }      태그 장착 / 해제(null → 등급 태그 자동 표시)
     POST /api/quests/claim { quest_id }           완료한 퀘스트(한정판 포함)의 태그 받기

   시즌 종료는 웹 API 가 아니라 sql/season-end.sql 로 소유자가 직접 실행합니다.
================================================================== */


/* ╔══════════════════════════════════════════════════════════════╗
   ║  PART A  —  `export default {` 바로 위에 붙여넣기              ║
   ╚══════════════════════════════════════════════════════════════╝ */

/* ---------- 태그: 설정 ---------- */
const TAG_DIFFS = ['easy', 'normal', 'hard', 'extreme'];
const TAG_DIFF_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', extreme: 'Extreme' };
const TAG_DAILY_STAGE_CAP = 300;     // 하루에 등급 경험치로 인정하는 클리어 스테이지 상한 (도배 방지)
const TAG_RUN_COOLDOWN_SEC = 10;     // 기록 제출 최소 간격

// 등급 = 누적 클리어 스테이지 수.  숫자를 바꾸면 곧바로 반영됩니다.
const TAG_TIERS = [
  { level: 1,  name: '새싹',         min: 0 },
  { level: 2,  name: '브론즈',       min: 5 },
  { level: 3,  name: '실버',         min: 15 },
  { level: 4,  name: '골드',         min: 35 },
  { level: 5,  name: '플래티넘',     min: 70 },
  { level: 6,  name: '에메랄드',     min: 120 },
  { level: 7,  name: '다이아',       min: 190 },
  { level: 8,  name: '마스터',       min: 290 },
  { level: 9,  name: '그랜드마스터', min: 430 },
  { level: 10, name: '챌린저',       min: 620 },
  { level: 11, name: '신화',         min: 850 },
  { level: 12, name: '레전드',       min: 1200 },
];

// 퀘스트 = 태그를 받는 미션.  id 는 곧 태그 id 입니다.
// limited:true + season:N  → 그 시즌이 진행 중일 때만 받을 수 있는 한정판 태그
// metric: stages | cleared | perfect | combo | easy | normal | hard | extreme | hard_plus | all_diffs | podium | champion
const TAG_QUESTS = [
  // ── 한정판 (시즌 1) ──
  { id: 'ltd-s1-pioneer',   limited: true, season: 1, name: '시즌 1 개척자', style: 'limited-a', metric: 'cleared',   goal: 1,   desc: '시즌 1 동안 5스테이지를 한 번 완주하세요.' },
  { id: 'ltd-s1-blaze',     limited: true, season: 1, name: '시즌 1 불꽃',   style: 'limited-b', metric: 'hard_plus', goal: 1,   desc: '시즌 1 동안 Hard 또는 Extreme을 완주하세요.' },
  { id: 'ltd-s1-collector', limited: true, season: 1, name: '시즌 1 수집가', style: 'limited-c', metric: 'stages',    goal: 100, desc: '시즌 1 동안 누적 100스테이지를 클리어하세요.' },
  // ── 일반 퀘스트 ──
  { id: 'q-first-clear', name: '첫 완주',         style: 'quest-common', metric: 'cleared',   goal: 1,  desc: '어떤 난이도든 5스테이지를 완주하세요.' },
  { id: 'q-marathon',    name: '마라토너',        style: 'quest-common', metric: 'stages',    goal: 50, desc: '누적 50스테이지를 클리어하세요.' },
  { id: 'q-easy-5',      name: '이지 마스터',     style: 'quest-common', metric: 'easy',      goal: 5,  desc: 'Easy를 5번 완주하세요.' },
  { id: 'q-normal-3',    name: '노멀 정복자',     style: 'quest-rare',   metric: 'normal',    goal: 3,  desc: 'Normal을 3번 완주하세요.' },
  { id: 'q-hard-1',      name: '하드 도전자',     style: 'quest-rare',   metric: 'hard',      goal: 1,  desc: 'Hard를 1번 완주하세요.' },
  { id: 'q-perfect-3',   name: '무결점',          style: 'quest-rare',   metric: 'perfect',   goal: 3,  desc: '기회를 하나도 잃지 않는 완주(퍼펙트)를 3번 달성하세요.' },
  { id: 'q-combo-5',     name: '콤보 장인',       style: 'quest-rare',   metric: 'combo',     goal: 5,  desc: '5스테이지 연속 무실수(콤보 ×5)를 달성하세요.' },
  { id: 'q-extreme-1',   name: '익스트림 생존자', style: 'quest-epic',   metric: 'extreme',   goal: 1,  desc: 'Extreme을 1번 완주하세요.' },
  { id: 'q-all-diffs',   name: '올라운더',        style: 'quest-epic',   metric: 'all_diffs', goal: 4,  desc: '4개 난이도를 모두 한 번 이상 완주하세요.' },
  { id: 'q-podium',      name: '시상대',          style: 'quest-epic',   metric: 'podium',    goal: 1,  desc: '어떤 난이도든 랭킹 TOP 3에 오르세요.' },
  { id: 'q-champion',    name: '챔피언',          style: 'quest-epic',   metric: 'champion',  goal: 1,  desc: '어떤 난이도든 랭킹 1위에 오르세요.' },
];

/* ---------- 태그: SQL ---------- */
const TAG_BOARD_SQL = `
  SELECT RANK() OVER (ORDER BY r.best_score DESC) AS place,
         u.username,
         r.best_score, r.best_stage, r.best_combo, r.plays,
         strftime('%Y-%m-%dT%H:%M:%SZ', r.achieved_at) AS achieved_at,
         p.equipped_tag,
         COALESCE(st.total, 0) AS total_stages
    FROM rankings r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN user_profiles p ON p.user_id = r.user_id
    LEFT JOIN (SELECT user_id, SUM(stages_cleared) AS total FROM user_stats GROUP BY user_id) st
           ON st.user_id = r.user_id
   WHERE r.game = ? AND r.difficulty = ?
   ORDER BY r.best_score DESC, r.achieved_at ASC, u.username ASC
   LIMIT ? OFFSET ?`;

const TAG_SEASON_SQL = `
  SELECT current_season, strftime('%Y-%m-%dT%H:%M:%SZ', started_at) AS started_at
    FROM season_state WHERE id = 1`;

const TAG_STATS_GROUP_SQL = `
  SELECT difficulty,
         COALESCE(SUM(stages_cleared), 0) AS stages,
         COALESCE(SUM(runs_played), 0)    AS played,
         COALESCE(SUM(runs_cleared), 0)   AS cleared,
         COALESCE(SUM(perfect_runs), 0)   AS perfect,
         COALESCE(MAX(best_combo), 0)     AS combo
    FROM user_stats WHERE user_id = ? GROUP BY difficulty`;

const TAG_PROFILE_SQL = `SELECT equipped_tag, best_place FROM user_profiles WHERE user_id = ?`;

const TAG_PROFILE_RUN_SQL = `
  SELECT day_key, day_stages, date('now') AS today,
         CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', last_run_at) AS INTEGER) AS age_sec
    FROM user_profiles WHERE user_id = ?`;

const TAG_STATS_UPSERT_SQL = `
  INSERT INTO user_stats (user_id, game, difficulty, stages_cleared, runs_played, runs_cleared, perfect_runs, best_combo)
  VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  ON CONFLICT(user_id, game, difficulty) DO UPDATE SET
    stages_cleared = user_stats.stages_cleared + excluded.stages_cleared,
    runs_played    = user_stats.runs_played + 1,
    runs_cleared   = user_stats.runs_cleared + excluded.runs_cleared,
    perfect_runs   = user_stats.perfect_runs + excluded.perfect_runs,
    best_combo     = MAX(user_stats.best_combo, excluded.best_combo)`;

const TAG_PROFILE_UPSERT_SQL = `
  INSERT INTO user_profiles (user_id, last_run_at, day_key, day_stages, updated_at)
  VALUES (?, datetime('now'), date('now'), ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    day_stages  = CASE WHEN user_profiles.day_key = date('now')
                       THEN user_profiles.day_stages + excluded.day_stages
                       ELSE excluded.day_stages END,
    day_key     = date('now'),
    last_run_at = datetime('now'),
    updated_at  = datetime('now')`;

// 방금 저장한 기록의 현재 순위를 계산해서, 지금까지의 최고 순위(best_place)를 갱신
const TAG_BEST_PLACE_SQL = `
  UPDATE user_profiles
     SET best_place = MIN(COALESCE(best_place, 999999),
           (SELECT COUNT(*) + 1
              FROM rankings x
              JOIN users ux ON ux.id = x.user_id
             WHERE x.game = ? AND x.difficulty = ?
               AND x.best_score > (SELECT best_score FROM rankings
                                    WHERE user_id = ? AND game = ? AND difficulty = ?)))
   WHERE user_id = ?`;

const TAG_MY_PLACES_SQL = `
  SELECT r.game, r.difficulty, r.best_score,
         (SELECT COUNT(*) + 1
            FROM rankings x
            JOIN users ux ON ux.id = x.user_id
           WHERE x.game = r.game AND x.difficulty = r.difficulty
             AND x.best_score > r.best_score) AS place
    FROM rankings r
   WHERE r.user_id = ?`;

/* ---------- 태그: 헬퍼 ---------- */
function tagTierOf(stages) {
  let cur = TAG_TIERS[0];
  for (const t of TAG_TIERS) if (stages >= t.min) cur = t;
  return cur;
}
function tagNextTier(stages) { return TAG_TIERS.find((t) => t.min > stages) || null; }
function tagTierBrief(t) {
  return t ? { level: t.level, id: 'tier-' + t.level, name: t.name, style: 'tier-' + t.level, min: t.min } : null;
}

// 태그 id → 화면에 그릴 정보 { id, kind, name, style }  (알 수 없는 id 는 null)
function tagInfo(id) {
  if (!id) return null;
  let m = /^tier-(\d+)$/.exec(id);
  if (m) {
    const t = TAG_TIERS[Number(m[1]) - 1];
    return t ? { id, kind: 'tier', name: t.name, style: 'tier-' + t.level } : null;
  }
  const q = TAG_QUESTS.find((x) => x.id === id);
  if (q) return { id, kind: q.limited ? 'limited' : 'quest', name: q.name, style: q.style };
  m = /^s(\d+)-(.+)-(easy|normal|hard|extreme)-([123])$/.exec(id);
  if (m) {
    return { id, kind: 'season', name: `시즌 ${m[1]} ${TAG_DIFF_NAMES[m[3]]} ${m[4]}등`, style: 'season-' + m[4] };
  }
  return null;
}

// 퀘스트 현재 진행값
function tagMetric(metric, s) {
  switch (metric) {
    case 'stages':    return s.stages;
    case 'cleared':   return s.cleared;
    case 'perfect':   return s.perfect;
    case 'combo':     return s.combo;
    case 'easy': case 'normal': case 'hard': case 'extreme': return s.byDiff[metric].cleared;
    case 'hard_plus': return s.byDiff.hard.cleared + s.byDiff.extreme.cleared;
    case 'all_diffs': return TAG_DIFFS.filter((d) => s.byDiff[d].cleared > 0).length;
    case 'podium':    return s.bestPlace && s.bestPlace <= 3 ? 1 : 0;
    case 'champion':  return s.bestPlace === 1 ? 1 : 0;
    default:          return 0;
  }
}

function tagBoardRows(results, myUsername) {
  return (results || []).map((r) => ({
    rank: Number(r.place),
    username: r.username,
    score: r.best_score,
    stage: r.best_stage,
    combo: r.best_combo,
    plays: r.plays,
    achieved_at: r.achieved_at,
    is_me: !!myUsername && r.username === myUsername,
    tag: tagInfo(r.equipped_tag) || tagInfo('tier-' + tagTierOf(r.total_stages || 0).level),
  }));
}

// 시즌 + (로그인 시) 누적 통계/프로필을 한 번에 읽기
async function tagLoadState(env, userId) {
  const stmts = [env.DB.prepare(TAG_SEASON_SQL)];
  if (userId !== null && userId !== undefined) {
    stmts.push(env.DB.prepare(TAG_STATS_GROUP_SQL).bind(userId));
    stmts.push(env.DB.prepare(TAG_PROFILE_SQL).bind(userId));
  }
  const res = await env.DB.batch(stmts);

  const s = {
    season: 1, seasonStartedAt: null,
    stages: 0, played: 0, cleared: 0, perfect: 0, combo: 0,
    byDiff: {}, bestPlace: null, equipped: null,
  };
  TAG_DIFFS.forEach((d) => { s.byDiff[d] = { cleared: 0, stages: 0 }; });

  const season = res[0].results && res[0].results[0];
  if (season) { s.season = season.current_season; s.seasonStartedAt = season.started_at; }

  if (res[1]) {
    for (const r of res[1].results || []) {
      s.stages += r.stages; s.played += r.played; s.cleared += r.cleared; s.perfect += r.perfect;
      s.combo = Math.max(s.combo, r.combo);
      if (s.byDiff[r.difficulty]) s.byDiff[r.difficulty] = { cleared: r.cleared, stages: r.stages };
    }
    const prof = res[2] && res[2].results && res[2].results[0];
    if (prof) { s.equipped = prof.equipped_tag || null; s.bestPlace = prof.best_place || null; }
  }
  return s;
}

// 도달한 등급의 태그를 모두 지급 (이미 있으면 무시)
async function tagEnsureTierTags(env, userId, stages) {
  const level = tagTierOf(stages).level;
  const values = [], binds = [];
  for (let i = 1; i <= level; i++) { values.push("(?, ?, 'tier')"); binds.push(userId, 'tier-' + i); }
  await env.DB
    .prepare(`INSERT OR IGNORE INTO user_tags (user_id, tag_id, source) VALUES ${values.join(',')}`)
    .bind(...binds).run();
}

async function tagOwned(env, userId) {
  const { results } = await env.DB
    .prepare(`SELECT tag_id, source, strftime('%Y-%m-%dT%H:%M:%SZ', obtained_at) AS obtained_at FROM user_tags WHERE user_id = ?`)
    .bind(userId).all();
  return results || [];
}

function tagDbError(request, err) {
  const msg = String((err && err.message) || err || '');
  console.error('tags db error:', msg);
  if (/no such table|no such column/i.test(msg))
    return fail(request, '등급/태그 테이블이 아직 없어요. sql/tags.sql 을 D1에 먼저 적용해 주세요.', 503);
  return fail(request, '처리하는 중 오류가 발생했어요.', 500);
}

/* ---------- GET /api/board  (TOP 100 보드) ---------- */
async function handleBoardGet(request, env, url) {
  const game = String(url.searchParams.get('game') || 'number-forge');
  const difficulty = String(url.searchParams.get('difficulty') || 'normal');
  if (!RANK_GAMES.has(game)) return fail(request, '알 수 없는 게임입니다.');
  if (!RANK_DIFFICULTIES.has(difficulty)) return fail(request, '알 수 없는 난이도입니다.');

  const limit = rankInt(url.searchParams.get('limit'), 1, 100, 100);
  const offset = rankInt(url.searchParams.get('offset'), 0, 1000, 0);
  const claims = await requireUser(request, env);   // 선택: 있으면 내 순위도 함께

  try {
    const stmts = [
      env.DB.prepare(TAG_BOARD_SQL).bind(game, difficulty, limit, offset),
      env.DB.prepare(RANK_COUNT_SQL).bind(game, difficulty),
      env.DB.prepare(TAG_SEASON_SQL),
    ];
    if (claims) stmts.push(env.DB.prepare(RANK_ME_SQL).bind(claims.sub, game, difficulty));

    const [list, count, season, mine] = await env.DB.batch(stmts);
    const rows = tagBoardRows(list.results, claims && claims.username);
    const total = (count.results && count.results[0] && count.results[0].total) || 0;
    const s = season.results && season.results[0];

    return ok(request, {
      game, difficulty, total, limit,
      has_more: offset + rows.length < total,
      rows,
      me: mine ? rankMe(mine.results && mine.results[0]) : null,
      season: { current: s ? s.current_season : 1, started_at: s ? s.started_at : null },
    });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/runs  (한 판 결과: 랭킹 + 등급 경험치 + 퀘스트) ---------- */
async function handleRunsSubmit(request, env) {
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
  const perfect = body.perfect === true;

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
    const owner = await env.DB.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').bind(claims.sub).first();
    if (!owner) return fail(request, '계정을 찾을 수 없습니다. 다시 로그인해 주세요.', 401);

    const [prev, prof, sum] = await env.DB.batch([
      env.DB.prepare(RANK_PREV_SQL).bind(claims.sub, game, difficulty),
      env.DB.prepare(TAG_PROFILE_RUN_SQL).bind(claims.sub),
      env.DB.prepare('SELECT COALESCE(SUM(stages_cleared), 0) AS stages FROM user_stats WHERE user_id = ?').bind(claims.sub),
    ]);
    const prevRow = prev.results && prev.results[0];
    const profRow = prof.results && prof.results[0];
    const prevStages = (sum.results && sum.results[0] && sum.results[0].stages) || 0;

    const age = profRow && profRow.age_sec !== null && profRow.age_sec !== undefined ? profRow.age_sec : null;
    if (age !== null && age < TAG_RUN_COOLDOWN_SEC) return fail(request, '잠시 후 다시 시도해 주세요.', 429);

    // 하루 상한을 넘으면 점수는 랭킹에 반영하되, 등급 경험치는 남은 만큼만 인정
    const usedToday = profRow && profRow.day_key === profRow.today ? (profRow.day_stages || 0) : 0;
    const counted = Math.max(0, Math.min(stage, TAG_DAILY_STAGE_CAP - usedToday));
    const fullRun = stage === RANK_MAX_STAGE && counted === stage;

    const out = await env.DB.batch([
      env.DB.prepare(RANK_UPSERT_SQL).bind(claims.sub, game, difficulty, score, stage, combo),
      env.DB.prepare(TAG_STATS_UPSERT_SQL).bind(
        claims.sub, game, difficulty, counted, fullRun ? 1 : 0, fullRun && perfect ? 1 : 0, combo),
      env.DB.prepare(TAG_PROFILE_UPSERT_SQL).bind(claims.sub, counted),
      env.DB.prepare(TAG_BEST_PLACE_SQL).bind(game, difficulty, claims.sub, game, difficulty, claims.sub),
      env.DB.prepare(RANK_ME_SQL).bind(claims.sub, game, difficulty),
      env.DB.prepare(TAG_BOARD_SQL).bind(game, difficulty, 5, 0),
    ]);
    const mine = out[4], top = out[5];

    // 등급 상승 확인 + 등급 태그 지급
    const newStages = prevStages + counted;
    const tierBefore = tagTierOf(prevStages), tierAfter = tagTierOf(newStages);
    await tagEnsureTierTags(env, claims.sub, newStages);
    const nextTier = tagNextTier(newStages);

    // 지금 받을 수 있는 퀘스트 수
    const st = await tagLoadState(env, claims.sub);
    const owned = new Set((await tagOwned(env, claims.sub)).map((r) => r.tag_id));
    const questsReady = TAG_QUESTS.filter((q) =>
      !owned.has(q.id) && (!q.limited || q.season === st.season) && tagMetric(q.metric, st) >= q.goal).length;

    return ok(request, {
      message: '점수가 등록되었습니다.',
      is_new_best: !prevRow || score > prevRow.best_score,
      me: rankMe(mine.results && mine.results[0]),
      top: tagBoardRows(top.results, claims.username),
      counted,
      daily_capped: counted < stage,
      progress: {
        stages: newStages,
        tier: tagTierBrief(tierAfter),
        next: nextTier ? { ...tagTierBrief(nextTier), remaining: nextTier.min - newStages } : null,
        tier_up: tierAfter.level > tierBefore.level
          ? { from: tagTierBrief(tierBefore), to: tagTierBrief(tierAfter) } : null,
      },
      quests_ready: questsReady,
    });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- GET /api/tags/me  (등급 · 태그 · 퀘스트 · 시즌) ---------- */
async function handleTagsMe(request, env) {
  const claims = await requireUser(request, env);   // 로그인 안 했으면 진행도 없이 카탈로그만

  try {
    const st = await tagLoadState(env, claims ? claims.sub : null);
    let ownedRows = [], places = [];
    if (claims) {
      await tagEnsureTierTags(env, claims.sub, st.stages);
      const [o, p] = await env.DB.batch([
        env.DB.prepare(`SELECT tag_id, source, strftime('%Y-%m-%dT%H:%M:%SZ', obtained_at) AS obtained_at FROM user_tags WHERE user_id = ?`).bind(claims.sub),
        env.DB.prepare(TAG_MY_PLACES_SQL).bind(claims.sub),
      ]);
      ownedRows = o.results || [];
      places = p.results || [];
    }
    const owned = new Set(ownedRows.map((r) => r.tag_id));

    const tier = tagTierOf(st.stages);
    const next = tagNextTier(st.stages);

    const quests = TAG_QUESTS.map((q) => {
      const raw = tagMetric(q.metric, st);
      const current = Math.min(raw, q.goal);
      return {
        id: q.id, name: q.name, desc: q.desc, style: q.style,
        limited: !!q.limited, season: q.season || null,
        goal: q.goal, current,
        done: raw >= q.goal,
        claimed: owned.has(q.id),
        available: !q.limited || q.season === st.season,   // 한정판은 그 시즌 중에만
        tag: tagInfo(q.id),
      };
    });

    const seasonTags = ownedRows
      .filter((r) => r.source === 'season')
      .map((r) => tagInfo(r.tag_id))
      .filter(Boolean)
      .sort((a, b) => b.id.localeCompare(a.id));

    return ok(request, {
      authed: !!claims,
      season: { current: st.season, started_at: st.seasonStartedAt },
      stats: {
        stages: st.stages, played: st.played, cleared: st.cleared, perfect: st.perfect,
        combo: st.combo, best_place: st.bestPlace,
      },
      tier: tagTierBrief(tier),
      next_tier: next ? { ...tagTierBrief(next), remaining: next.min - st.stages } : null,
      tiers: TAG_TIERS.map((t) => ({ ...tagTierBrief(t), owned: !!claims && st.stages >= t.min })),
      equipped: tagInfo(st.equipped),
      display_tag: tagInfo(st.equipped) || tagInfo('tier-' + tier.level),   // 장착 안 했으면 현재 등급 태그가 표시됨
      quests,
      quests_ready: quests.filter((q) => q.done && !q.claimed && q.available).length,
      season_tags: seasonTags,
      my_places: places.map((r) => ({ game: r.game, difficulty: r.difficulty, place: Number(r.place), score: r.best_score })),
    });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/tags/equip ---------- */
async function handleTagsEquip(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(request, '요청 형식이 올바르지 않습니다.');
  // tag_id 가 null 이면 '해제' — 이름 옆에는 현재 등급 태그가 자동으로 표시됩니다.
  const tagId = body.tag_id === null || body.tag_id === undefined || body.tag_id === '' ? null : String(body.tag_id);

  try {
    const st = await tagLoadState(env, claims.sub);
    await tagEnsureTierTags(env, claims.sub, st.stages);     // 방금 오른 등급 태그도 바로 장착할 수 있게

    if (tagId !== null) {
      if (!tagInfo(tagId)) return fail(request, '알 수 없는 태그입니다.');
      const has = await env.DB
        .prepare('SELECT 1 AS ok FROM user_tags WHERE user_id = ? AND tag_id = ?').bind(claims.sub, tagId).first();
      if (!has) return fail(request, '아직 획득하지 못한 태그예요.', 403);
    }
    await env.DB.prepare(
      `INSERT INTO user_profiles (user_id, equipped_tag, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET equipped_tag = excluded.equipped_tag, updated_at = datetime('now')`
    ).bind(claims.sub, tagId).run();

    return ok(request, {
      equipped: tagInfo(tagId),
      display_tag: tagInfo(tagId) || tagInfo('tier-' + tagTierOf(st.stages).level),
    });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/quests/claim ---------- */
async function handleQuestClaim(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);

  const body = await request.json().catch(() => null);
  const quest = body && TAG_QUESTS.find((q) => q.id === String(body.quest_id || ''));
  if (!quest) return fail(request, '알 수 없는 퀘스트입니다.', 404);

  try {
    const st = await tagLoadState(env, claims.sub);
    if (quest.limited && quest.season !== st.season)
      return fail(request, '이 한정판 태그는 시즌이 끝나서 더 이상 받을 수 없어요.', 410);
    if (tagMetric(quest.metric, st) < quest.goal)
      return fail(request, '아직 퀘스트 조건을 달성하지 못했어요.', 400);

    const res = await env.DB
      .prepare(`INSERT OR IGNORE INTO user_tags (user_id, tag_id, source) VALUES (?, ?, ?)`)
      .bind(claims.sub, quest.id, quest.limited ? 'limited' : 'quest').run();
    const changed = res && res.meta ? res.meta.changes : 1;

    return ok(request, { already: !changed, tag: tagInfo(quest.id) });
  } catch (err) {
    return tagDbError(request, err);
  }
}


/* ╔══════════════════════════════════════════════════════════════╗
   ║  PART B  —  라우터 안에 붙여넣기 (아래 다섯 줄)                 ║
   ║  위치: index.js 의  `if (path === '/api/health')`  바로 위      ║
   ╚══════════════════════════════════════════════════════════════╝

      if (path === '/api/board' && request.method === 'GET')
        return await handleBoardGet(request, env, url);

      if (path === '/api/runs' && request.method === 'POST')
        return await handleRunsSubmit(request, env);

      if (path === '/api/tags/me' && request.method === 'GET')
        return await handleTagsMe(request, env);

      if (path === '/api/tags/equip' && request.method === 'POST')
        return await handleTagsEquip(request, env);

      if (path === '/api/quests/claim' && request.method === 'POST')
        return await handleQuestClaim(request, env);

   ※ `path` 대신 `url.pathname` 을 쓰는 버전이면 위 다섯 줄의 `path` 를 `url.pathname` 으로 바꿔 주세요.
*/
