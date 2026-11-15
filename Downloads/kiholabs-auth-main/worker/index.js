/**
 * kiholabs-auth — Cloudflare Worker
 * ------------------------------------------------------------------
 * 엔드포인트
 *   POST /api/register    { username, password, email }        → 회원가입 (phone 제거됨)
 *   POST /api/login       { username, password }               → { token, user }
 *   GET  /api/me          Authorization: Bearer <token>        → { user }
 *   POST /api/score       Bearer + { game, mode, score, ... }  → Supabase 기록 + 내 순위
 *   GET  /api/leaderboard?game=pixel-detective&limit=10        → 상위 랭킹(비로그인도 조회 가능)
 *
 * 바인딩 / 시크릿 (wrangler)
 *   [[d1_databases]] binding = "DB"            → login-db
 *   시크릿: JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   (선택) TURNSTILE_SECRET — 넣으면 캡차 검증이 켜집니다.
 *
 * 비밀번호 규칙: 8자 이상 20자 미만(=최대 19자), 영문+숫자 포함
 */

const ALLOWED_ORIGINS = [
  'https://kiholabs.com',
  'https://www.kiholabs.com',
];

const PASSWORD_MIN = 8;
const PASSWORD_MAX_EXCLUSIVE = 20; // 20자 미만
const TOKEN_TTL_SEC = 60 * 60 * 24 * 7; // 7일

// 배포 확인용: GET /api/health 응답의 version 이 이 값이면 이 코드가 실제로 배포된 것입니다.
const WORKER_VERSION = '2026-09-21-unified-v1'; // 라우팅을 이 파일 하나로 통합

const GAMES = new Set(['pixel-detective', 'mirror-beam', 'number-forge', 'code-breaker', 'memory-grid', 'light-switch', 'color-flood']);
const SCORE_CAP = 200000;

/* ================================================================
   CORS
================================================================ */
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  });
}

const ok = (request, data) => json(request, { success: true, ...data });
const fail = (request, message, status = 400) =>
  json(request, { success: false, error: message }, status);

/* ================================================================
   비밀번호 해시 (PBKDF2-SHA256, WebCrypto)
   저장 형식: pbkdf2$<iterations>$<saltBase64>$<hashBase64>
================================================================ */
const PBKDF2_ITER = 100000;

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
  );
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 기존 계정 호환: 예전에 SHA-256 hex 로 저장했다면 그대로 로그인되고,
 * 로그인 성공 시 자동으로 PBKDF2 형식으로 재저장(업그레이드)합니다.
 */
async function verifyPassword(password, stored) {
  if (!stored) return { valid: false, needsUpgrade: false };

  if (stored.startsWith('pbkdf2$')) {
    const [, iterStr, saltB64, hashB64] = stored.split('$');
    const bits = await pbkdf2(password, unb64(saltB64), Number(iterStr));
    return { valid: timingSafeEqual(b64(bits), hashB64), needsUpgrade: false };
  }

  const legacy = await sha256Hex(password);
  return { valid: timingSafeEqual(legacy, stored), needsUpgrade: true };
}

/* ================================================================
   JWT (HS256)
================================================================ */
function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function signToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify(header)));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function verifyToken(token, secret) {
  try {
    const [head, body, sig] = String(token).split('.');
    if (!head || !body || !sig) return null;
    const valid = await crypto.subtle.verify(
      'HMAC', await hmacKey(secret),
      Uint8Array.from(b64urlDecode(sig), (c) => c.charCodeAt(0)),
      new TextEncoder().encode(`${head}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(b64urlDecode(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  return verifyToken(token, env.JWT_SECRET);
}

/* ================================================================
   입력 검증  (phone 없음 / 비밀번호 20자 미만)
================================================================ */
const RE_USERNAME = /^[A-Za-z0-9_]{4,20}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateRegister({ username, password, email }) {
  if (typeof username !== 'string' || !RE_USERNAME.test(username.trim()))
    return '아이디는 영문, 숫자, 밑줄(_) 4~20자로 입력해 주세요.';

  if (typeof email !== 'string' || !RE_EMAIL.test(email.trim()))
    return '올바른 이메일 주소를 입력해 주세요.';

  return passwordProblem(password);
}

function passwordProblem(password) {
  if (typeof password !== 'string') return '비밀번호를 입력해 주세요.';
  if (password.length < PASSWORD_MIN)
    return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
  if (password.length >= PASSWORD_MAX_EXCLUSIVE)
    return `비밀번호는 ${PASSWORD_MAX_EXCLUSIVE}자 미만(최대 ${PASSWORD_MAX_EXCLUSIVE - 1}자)이어야 합니다.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    return '비밀번호에는 영문과 숫자가 모두 포함되어야 합니다.';
  return '';
}

/* ================================================================
   Turnstile (시크릿이 있을 때만 검증)
================================================================ */
/**
 * 반환: { ok:true }
 *       { ok:false, reason:'missing' }                    토큰이 요청에 없음 (프론트가 안 보냄)
 *       { ok:false, reason:'rejected', codes:[...] }      Cloudflare가 토큰/시크릿을 거부
 *                                                         (예: invalid-input-secret, timeout-or-duplicate)
 * TURNSTILE_SECRET 이 설정되어 있지 않으면 검증을 건너뜁니다.
 */
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  let data = null;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form,
    });
    data = await res.json();
  } catch {
    return { ok: false, reason: 'rejected', codes: ['siteverify-unreachable'] };
  }
  if (data && data.success) return { ok: true };
  return { ok: false, reason: 'rejected', codes: (data && data['error-codes']) || [] };
}

function captchaFail(request, result) {
  const missing = result.reason === 'missing';
  return json(request, {
    success: false,
    code: missing ? 'captcha_missing' : 'captcha_rejected',
    error: missing
      ? '로봇 방지 확인이 필요해요. 캡차를 완료한 뒤 다시 시도해 주세요.'
      : '로봇 방지 확인에 실패했어요. 캡차를 다시 완료해 주세요.',
    details: result.codes || undefined,
  }, 403);
}

/* ================================================================
   Supabase REST 헬퍼 (service_role 키는 Worker 시크릿에만 존재)
================================================================ */
async function supabase(env, path, init = {}) {
  const url = `${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

/* ================================================================
   Handlers
================================================================ */
async function handleRegister(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return fail(request, '요청 형식이 올바르지 않습니다.');

  const captchaResult = await verifyTurnstile(
    env, body.turnstileToken, request.headers.get('CF-Connecting-IP')
  );
  if (!captchaResult.ok) return captchaFail(request, captchaResult);

  const message = validateRegister(body);
  if (message) return fail(request, message);

  const username = body.username.trim();
  const email = body.email.trim().toLowerCase();

  const dup = await env.DB
    .prepare('SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1')
    .bind(username, email).first();
  if (dup) return fail(request, '이미 사용 중인 아이디 또는 이메일입니다.', 409);

  const passwordHash = await hashPassword(body.password);

  // phone 컬럼은 더 이상 사용하지 않습니다.
  const result = await env.DB
    .prepare(
      `INSERT INTO users (username, password_hash, email, created_at)
       VALUES (?, ?, ?, datetime('now'))
       RETURNING id, username, email, created_at`
    )
    .bind(username, passwordHash, email)
    .first();

  return ok(request, { message: '회원가입이 완료되었습니다.', user: result });
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return fail(request, '요청 형식이 올바르지 않습니다.');

  const captchaResult = await verifyTurnstile(
    env, body.turnstileToken, request.headers.get('CF-Connecting-IP')
  );
  if (!captchaResult.ok) return captchaFail(request, captchaResult);

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return fail(request, '아이디와 비밀번호를 모두 입력해 주세요.');
  if (password.length >= PASSWORD_MAX_EXCLUSIVE)
    return fail(request, `비밀번호는 ${PASSWORD_MAX_EXCLUSIVE}자 미만이어야 합니다.`);

  const row = await env.DB
    .prepare('SELECT id, username, email, password_hash, created_at FROM users WHERE username = ? LIMIT 1')
    .bind(username).first();

  const check = row
    ? await verifyPassword(password, row.password_hash)
    : { valid: false, needsUpgrade: false };

  if (!row || !check.valid)
    return fail(request, '아이디 또는 비밀번호가 올바르지 않습니다.', 401);

  if (check.needsUpgrade) {
    const upgraded = await hashPassword(password);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(upgraded, row.id).run();
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signToken(
    { sub: row.id, username: row.username, iat: now, exp: now + TOKEN_TTL_SEC },
    env.JWT_SECRET
  );

  return ok(request, {
    message: '로그인되었습니다.',
    token,
    expiresIn: TOKEN_TTL_SEC,
    user: { id: row.id, username: row.username, email: row.email, created_at: row.created_at },
  });
}

async function handleMe(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);

  const row = await env.DB
    .prepare('SELECT id, username, email, created_at FROM users WHERE id = ? LIMIT 1')
    .bind(claims.sub).first();
  if (!row) return fail(request, '계정을 찾을 수 없습니다.', 404);

  return ok(request, { user: row });
}

async function handleScore(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '게스트는 리더보드에 점수를 등록할 수 없습니다. 로그인 후 이용해 주세요.', 401);

  const body = await request.json().catch(() => null);
  if (!body) return fail(request, '요청 형식이 올바르지 않습니다.');

  const game = String(body.game || '');
  const score = Number(body.score);
  const durationMs = Number(body.durationMs || 0);
  const stage = Number(body.stage || 0);
  const moves = Number(body.moves || 0);
  const combo = Number(body.combo || 0);
  const mode = String(body.mode || 'classic').slice(0, 20);

  if (!GAMES.has(game)) return fail(request, '알 수 없는 게임입니다.');
  if (!Number.isFinite(score) || score < 0 || score > SCORE_CAP)
    return fail(request, '점수 값이 올바르지 않습니다.');
  if (durationMs < 3000) return fail(request, '플레이 기록이 너무 짧습니다.');

  // 10초 내 중복 제출 차단
  const recent = await supabase(
    env,
    `/scores?user_id=eq.${encodeURIComponent(claims.sub)}&game=eq.${encodeURIComponent(game)}` +
      `&created_at=gte.${encodeURIComponent(new Date(Date.now() - 10000).toISOString())}` +
      `&select=id&limit=1`
  );
  if (recent.ok && Array.isArray(recent.data) && recent.data.length)
    return fail(request, '잠시 후 다시 시도해 주세요.', 429);

  const insert = await supabase(env, '/scores', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      user_id: String(claims.sub),
      username: claims.username,
      game, mode, score: Math.round(score),
      stage, moves, combo,
      duration_ms: Math.round(durationMs),
    }]),
  });
  if (!insert.ok) return fail(request, '점수를 저장하지 못했습니다.', 502);

  // 내 순위 = 나보다 높은 점수의 개수 + 1
  const higher = await supabase(
    env,
    `/scores?game=eq.${encodeURIComponent(game)}&score=gt.${Math.round(score)}&select=id`,
    { headers: { Prefer: 'count=exact', Range: '0-0' } }
  );
  let rank = null;
  if (higher.ok && Array.isArray(higher.data)) rank = higher.data.length + 1;

  const top = await supabase(
    env,
    `/scores?game=eq.${encodeURIComponent(game)}&select=username,score,created_at&order=score.desc&limit=10`
  );

  return ok(request, {
    message: '점수가 등록되었습니다.',
    rank,
    top: top.ok ? top.data : [],
  });
}

async function handleLeaderboard(request, env, url) {
  const game = String(url.searchParams.get('game') || '');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 10)));
  if (!GAMES.has(game)) return fail(request, '알 수 없는 게임입니다.');

  const res = await supabase(
    env,
    `/scores?game=eq.${encodeURIComponent(game)}&select=username,score,stage,created_at&order=score.desc&limit=${limit}`
  );
  if (!res.ok) return fail(request, '리더보드를 불러오지 못했습니다.', 502);

  return ok(request, { game, top: res.data || [] });
}

/* ================================================================
   Router
================================================================ */
/* ==================================================================
   아래 두 블록(랭킹 API, 태그/등급/퀘스트 API)은 원래 별도 스니펫 파일로
   제공되었다가, Cloudflare 대시보드의 개별 라우팅을 없애고 이 Worker
   하나가 모든 경로를 처리하도록 이 파일에 합쳐졌습니다.
   worker/rankings-snippet.js, worker/tags-snippet.js 는 더 이상 붙여넣을
   필요가 없습니다(참고용으로만 남겨둡니다).
================================================================== */

/* ---------- 랭킹: 설정 ---------- */
const RANK_GAMES = new Set(['number-forge', 'pixel-detective', 'mirror-beam', 'code-breaker', 'memory-grid', 'light-switch', 'color-flood']);
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

/* ---------- 태그: 설정 ---------- */
const TAG_DIFFS = ['easy', 'normal', 'hard', 'extreme'];
const TAG_DIFF_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', extreme: 'Extreme' };
const TAG_DAILY_STAGE_CAP = 300;     // 하루에 등급 경험치로 인정하는 클리어 스테이지 상한 (도배 방지)
const TAG_RUN_COOLDOWN_SEC = 10;     // 기록 제출 최소 간격
const TAG_EQUIP_SLOTS = 3;           // 동시에 장착 가능한 태그 수
const ADMIN_USERNAMES = new Set(['admin', 'kiho']);   // 이 계정은 모든 태그를 보유·장착할 수 있음(관리자 특전)
function isAdminName(username) { return !!username && ADMIN_USERNAMES.has(username); }

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

/* ---------- 태그: 퀘스트 카탈로그 (약 90개 — 손으로 다 쓰지 않고 계열별로 생성) ----------
   각 항목: { id, name, style, metric, goal, desc, category, limited?, season?, unit? }
   metric: stages | cleared | perfect | combo | played
         | easy|normal|hard|extreme (해당 난이도 완주 횟수)
         | easy_perfect|normal_perfect|hard_perfect|extreme_perfect (해당 난이도 퍼펙트 횟수)
         | hard_plus (Hard+Extreme 완주 합)
         | all_diffs (한 번이라도 클리어한 난이도 수) | all_diffs_min (모든 난이도의 최소 완주 횟수)
         | podium (TOP3 진입 여부) | champion (1위 여부) | top10 | top50
         | speed (5스테이지 완주 최고 기록, goal=ms, 이하일 때 달성 — unit:'speed_ms')
         | flag_night_owl | flag_early_bird | flag_weekend (특정 시간대 플레이 1회)
   한정판(limited:true) 태그의 id/season 은 이미 지급된 사용자가 있을 수 있으니 절대 바꾸지 않습니다. */
function tagStyleByRatio(i, n, legendaryAtEnd) {
  if (n <= 1) return 'quest-common';
  if (legendaryAtEnd && i === n - 1 && n >= 4) return 'quest-legendary';
  const r = i / (n - 1);
  return r < 0.34 ? 'quest-common' : r < 0.67 ? 'quest-rare' : 'quest-epic';
}

// [목표값, 표시 이름] 쌍의 목록으로 같은 계열의 퀘스트를 한 번에 만듭니다.
function tagFamily(idPrefix, metric, category, pairs, descOf, opts) {
  opts = opts || {};
  return pairs.map(function (pair, i) {
    const goal = pair[0], name = pair[1];
    return {
      id: idPrefix + '-' + goal, name: name, category: category, metric: metric, goal: goal,
      style: opts.style || tagStyleByRatio(i, pairs.length, opts.legendaryAtEnd !== false),
      desc: descOf(goal), unit: opts.unit,
    };
  });
}

const TAG_QUESTS = [].concat(
  // ── 한정판 (시즌 1 동안만 획득 가능 — id/season 절대 변경 금지: 이미 받은 유저가 있을 수 있음) ──
  [
    { id: 'ltd-s1-pioneer',   limited: true, season: 1, name: '시즌 1 개척자', style: 'limited-a', category: 'limited', metric: 'cleared',   goal: 1,   desc: '시즌 1 동안 5스테이지를 한 번 완주하세요.' },
    { id: 'ltd-s1-blaze',     limited: true, season: 1, name: '시즌 1 불꽃',   style: 'limited-b', category: 'limited', metric: 'hard_plus', goal: 1,   desc: '시즌 1 동안 Hard 또는 Extreme을 완주하세요.' },
    { id: 'ltd-s1-collector', limited: true, season: 1, name: '시즌 1 수집가', style: 'limited-c', category: 'limited', metric: 'stages',    goal: 100, desc: '시즌 1 동안 누적 100스테이지를 클리어하세요.' },
  ],
  // ── 기존 대표 퀘스트 (id 유지) ──
  [
    { id: 'q-first-clear', name: '첫 완주',         style: 'quest-common', category: 'cleared',  metric: 'cleared',   goal: 1,  desc: '어떤 난이도든 5스테이지를 완주하세요.' },
    { id: 'q-marathon',    name: '마라토너',        style: 'quest-common', category: 'stages',   metric: 'stages',    goal: 50, desc: '누적 50스테이지를 클리어하세요.' },
    { id: 'q-easy-5',      name: '이지 마스터',     style: 'quest-common', category: 'difficulty', metric: 'easy',    goal: 5,  desc: 'Easy를 5번 완주하세요.' },
    { id: 'q-normal-3',    name: '노멀 정복자',     style: 'quest-rare',   category: 'difficulty', metric: 'normal',  goal: 3,  desc: 'Normal을 3번 완주하세요.' },
    { id: 'q-hard-1',      name: '하드 도전자',     style: 'quest-rare',   category: 'difficulty', metric: 'hard',    goal: 1,  desc: 'Hard를 1번 완주하세요.' },
    { id: 'q-perfect-3',   name: '무결점',          style: 'quest-rare',   category: 'perfect',  metric: 'perfect',   goal: 3,  desc: '기회를 하나도 잃지 않는 완주(퍼펙트)를 3번 달성하세요.' },
    { id: 'q-combo-5',     name: '콤보 장인',       style: 'quest-rare',   category: 'combo',    metric: 'combo',     goal: 5,  desc: '5스테이지 연속 무실수(콤보 ×5)를 달성하세요.' },
    { id: 'q-extreme-1',   name: '익스트림 생존자', style: 'quest-epic',   category: 'difficulty', metric: 'extreme', goal: 1,  desc: 'Extreme을 1번 완주하세요.' },
    { id: 'q-all-diffs',   name: '올라운더',        style: 'quest-epic',   category: 'special',  metric: 'all_diffs', goal: 4,  desc: '4개 난이도를 모두 한 번 이상 완주하세요.' },
    { id: 'q-podium',      name: '시상대',          style: 'quest-epic',   category: 'rank',     metric: 'podium',    goal: 1,  desc: '어떤 난이도든 랭킹 TOP 3에 오르세요.' },
    { id: 'q-champion',    name: '챔피언',          style: 'quest-epic',   category: 'rank',     metric: 'champion',  goal: 1,  desc: '어떤 난이도든 랭킹 1위에 오르세요.' },
  ],
  // ── 누적 스테이지 ──
  tagFamily('q-stage', 'stages', 'stages',
    [[10, '입문자'], [25, '수련생'], [100, '스테이지 100'], [200, '스테이지 200'], [300, '스테이지 300'],
     [500, '스테이지 500'], [750, '스테이지 750'], [1000, '천 스테이지'], [1500, '스테이지 1500'], [2000, '스테이지 2000']],
    (g) => `누적 ${g} 스테이지를 클리어하세요.`),
  // ── 완주 횟수 ──
  tagFamily('q-clear', 'cleared', 'cleared',
    [[5, '완주 5회'], [10, '완주 10회'], [25, '완주 25회'], [50, '완주 50회'], [100, '완주 100회'], [200, '완주 200회'], [300, '완주 300회']],
    (g) => `5스테이지 완주를 누적 ${g}회 달성하세요.`),
  // ── 퍼펙트 ──
  tagFamily('q-pf', 'perfect', 'perfect',
    [[1, '첫 퍼펙트'], [5, '퍼펙트 5회'], [10, '퍼펙트 10회'], [25, '퍼펙트 25회'], [50, '퍼펙트 50회'], [100, '퍼펙트 100회']],
    (g) => `퍼펙트 완주를 누적 ${g}회 달성하세요.`),
  // ── 콤보 ──
  tagFamily('q-cb', 'combo', 'combo',
    [[2, '콤보 ×2'], [3, '콤보 ×3'], [4, '콤보 ×4']],
    (g) => `5스테이지 연속 무실수 콤보 ×${g}를 달성하세요.`),
  // ── 누적 플레이 ──
  tagFamily('q-play', 'played', 'played',
    [[10, '입문 도전'], [50, '꾸준한 도전자'], [100, '플레이 100회'], [250, '플레이 250회'], [500, '플레이 500회'], [1000, '플레이 1000회']],
    (g) => `누적 ${g}회 플레이하세요.`),
  // ── 난이도별 완주 ──
  tagFamily('q-easy', 'easy', 'difficulty',
    [[1, 'Easy 첫걸음'], [10, 'Easy 10회'], [25, 'Easy 25회'], [50, 'Easy 50회'], [100, 'Easy 100회'], [200, 'Easy 200회']],
    (g) => `Easy를 ${g}번 완주하세요.`),
  tagFamily('q-normal', 'normal', 'difficulty',
    [[1, 'Normal 첫걸음'], [5, 'Normal 5회'], [10, 'Normal 10회'], [25, 'Normal 25회'], [50, 'Normal 50회'], [100, 'Normal 100회']],
    (g) => `Normal을 ${g}번 완주하세요.`),
  tagFamily('q-hard', 'hard', 'difficulty',
    [[3, 'Hard 3회'], [5, 'Hard 5회'], [10, 'Hard 10회'], [25, 'Hard 25회'], [50, 'Hard 50회']],
    (g) => `Hard를 ${g}번 완주하세요.`),
  tagFamily('q-extreme', 'extreme', 'difficulty',
    [[3, 'Extreme 3회'], [5, 'Extreme 5회'], [10, 'Extreme 10회'], [15, 'Extreme 15회'], [25, 'Extreme 25회']],
    (g) => `Extreme을 ${g}번 완주하세요.`),
  // ── 난이도별 퍼펙트 ──
  tagFamily('q-easy-pf', 'easy_perfect', 'perfect', [[1, 'Easy 퍼펙트'], [5, 'Easy 퍼펙트 5회'], [10, 'Easy 퍼펙트 10회']], (g) => `Easy 퍼펙트 완주 ${g}회.`, { style: 'quest-rare' }),
  tagFamily('q-normal-pf', 'normal_perfect', 'perfect', [[1, 'Normal 퍼펙트'], [5, 'Normal 퍼펙트 5회'], [10, 'Normal 퍼펙트 10회']], (g) => `Normal 퍼펙트 완주 ${g}회.`, { style: 'quest-rare' }),
  tagFamily('q-hard-pf', 'hard_perfect', 'perfect', [[1, 'Hard 퍼펙트'], [3, 'Hard 퍼펙트 3회'], [5, 'Hard 퍼펙트 5회']], (g) => `Hard 퍼펙트 완주 ${g}회.`, { style: 'quest-epic' }),
  tagFamily('q-extreme-pf', 'extreme_perfect', 'perfect', [[1, 'Extreme 퍼펙트'], [3, 'Extreme 퍼펙트 3회']], (g) => `Extreme 퍼펙트 완주 ${g}회.`, { style: 'quest-epic' }),
  // ── 랭킹 ──
  [
    { id: 'q-top50', name: 'TOP 50', style: 'quest-rare', category: 'rank', metric: 'top50', goal: 1, desc: '어떤 난이도든 랭킹 TOP 50에 오르세요.' },
    { id: 'q-top10', name: 'TOP 10', style: 'quest-epic', category: 'rank', metric: 'top10', goal: 1, desc: '어떤 난이도든 랭킹 TOP 10에 오르세요.' },
  ],
  // ── 속도 (5스테이지 완주 최고 기록) ──
  [
    { id: 'q-speed-180', name: '스피드러너', style: 'quest-epic', category: 'speed', metric: 'speed', goal: 180000, unit: 'speed_ms', desc: '5스테이지를 3분 안에 완주하세요.' },
    { id: 'q-speed-120', name: '질주자',     style: 'quest-epic', category: 'speed', metric: 'speed', goal: 120000, unit: 'speed_ms', desc: '5스테이지를 2분 안에 완주하세요.' },
    { id: 'q-speed-90',  name: '섬광',       style: 'quest-epic', category: 'speed', metric: 'speed', goal: 90000,  unit: 'speed_ms', desc: '5스테이지를 90초 안에 완주하세요.' },
    { id: 'q-speed-60',  name: '광속',       style: 'quest-legendary', category: 'speed', metric: 'speed', goal: 60000, unit: 'speed_ms', desc: '5스테이지를 60초 안에 완주하세요.' },
  ],
  // ── 시간대 플레이버 (서버 시각 기준 KST) ──
  [
    { id: 'q-night-owl',  name: '올빼미',   style: 'quest-rare', category: 'flavor', metric: 'flag_night_owl',  goal: 1, desc: '새벽 0시~5시(한국시간) 사이에 플레이하세요.' },
    { id: 'q-early-bird', name: '얼리버드', style: 'quest-rare', category: 'flavor', metric: 'flag_early_bird', goal: 1, desc: '이른 아침 5시~7시(한국시간) 사이에 플레이하세요.' },
    { id: 'q-weekend',    name: '주말 전사', style: 'quest-rare', category: 'flavor', metric: 'flag_weekend',   goal: 1, desc: '주말(토·일)에 플레이하세요.' },
  ],
  // ── 종합 ──
  [
    { id: 'q-all-diffs-5', name: '올라운더 마스터', style: 'quest-legendary', category: 'special', metric: 'all_diffs_min', goal: 5, desc: '4개 난이도를 각각 5번씩 완주하세요.' },
    { id: 'q-hardplus-10', name: '고난도 헌터',     style: 'quest-epic',      category: 'special', metric: 'hard_plus',     goal: 10, desc: 'Hard와 Extreme을 합쳐 10번 완주하세요.' },
    { id: 'q-hardplus-50',  name: '고난도 사냥꾼', style: 'quest-epic',      category: 'special', metric: 'hard_plus',     goal: 50,  desc: 'Hard와 Extreme을 합쳐 50번 완주하세요.' },
    { id: 'q-hardplus-100', name: '고난도 지배자', style: 'quest-legendary', category: 'special', metric: 'hard_plus',     goal: 100, desc: 'Hard와 Extreme을 합쳐 100번 완주하세요.' },
    { id: 'q-all-diffs-25', name: '사원소 마스터', style: 'quest-legendary', category: 'special', metric: 'all_diffs_min', goal: 25,  desc: '4개 난이도를 각각 25번씩 완주하세요.' },
  ],
  // ── 추가 퀘스트 (뱃지 확장) ──
  [
    { id: 'q-stage-5',     name: '첫 발자국',     style: 'quest-common', category: 'stages',     metric: 'stages',         goal: 5,    desc: '누적 5스테이지를 클리어하세요.' },
    { id: 'q-stage-3000',  name: '스테이지 3000', style: 'quest-legendary', category: 'stages',  metric: 'stages',         goal: 3000, desc: '누적 3000 스테이지를 클리어하세요.' },
    { id: 'q-clear-500',   name: '완주 500회',    style: 'quest-legendary', category: 'cleared', metric: 'cleared',        goal: 500,  desc: '5스테이지 완주를 누적 500회 달성하세요.' },
    { id: 'q-pf-200',      name: '퍼펙트 200회',  style: 'quest-legendary', category: 'perfect', metric: 'perfect',        goal: 200,  desc: '퍼펙트 완주를 누적 200회 달성하세요.' },
    { id: 'q-play-2000',   name: '플레이 2000회', style: 'quest-legendary', category: 'played',  metric: 'played',         goal: 2000, desc: '누적 2000회 플레이하세요.' },
    { id: 'q-hard-75',     name: 'Hard 75회',     style: 'quest-epic',   category: 'difficulty', metric: 'hard',           goal: 75,   desc: 'Hard를 75번 완주하세요.' },
    { id: 'q-hard-100',    name: 'Hard 100회',    style: 'quest-legendary', category: 'difficulty', metric: 'hard',        goal: 100,  desc: 'Hard를 100번 완주하세요.' },
    { id: 'q-extreme-50',  name: 'Extreme 50회',  style: 'quest-legendary', category: 'difficulty', metric: 'extreme',     goal: 50,   desc: 'Extreme을 50번 완주하세요.' },
    { id: 'q-extreme-pf-10', name: 'Extreme 퍼펙트 10회', style: 'quest-legendary', category: 'perfect', metric: 'extreme_perfect', goal: 10, desc: 'Extreme 퍼펙트 완주 10회.' },
    { id: 'q-speed-45',    name: '초광속',        style: 'quest-legendary', category: 'speed', metric: 'speed', goal: 45000, unit: 'speed_ms', desc: '5스테이지를 45초 안에 완주하세요.' },
  ],
  // ── 추가 퀘스트 2차 (뱃지 대량 확장: 기존 metric 만 사용) ──
  tagFamily('q-stage', 'stages', 'stages',
    [[15, '스테이지 15'], [40, '스테이지 40'], [60, '스테이지 60'], [150, '스테이지 150'], [400, '스테이지 400'],
     [600, '스테이지 600'], [1250, '스테이지 1250'], [2500, '스테이지 2500']],
    (g) => `누적 ${g} 스테이지를 클리어하세요.`),
  tagFamily('q-clear', 'cleared', 'cleared',
    [[15, '완주 15회'], [75, '완주 75회'], [150, '완주 150회'], [400, '완주 400회']],
    (g) => `5스테이지 완주를 누적 ${g}회 달성하세요.`),
  tagFamily('q-pf', 'perfect', 'perfect',
    [[2, '퍼펙트 2회'], [15, '퍼펙트 15회'], [75, '퍼펙트 75회'], [150, '퍼펙트 150회']],
    (g) => `퍼펙트 완주를 누적 ${g}회 달성하세요.`),
  tagFamily('q-play', 'played', 'played',
    [[25, '플레이 25회'], [75, '플레이 75회'], [150, '플레이 150회'], [300, '플레이 300회'], [750, '플레이 750회'], [1500, '플레이 1500회']],
    (g) => `누적 ${g}회 플레이하세요.`),
  tagFamily('q-easy', 'easy', 'difficulty', [[75, 'Easy 75회'], [150, 'Easy 150회'], [300, 'Easy 300회']],
    (g) => `Easy를 ${g}번 완주하세요.`, { style: 'quest-common' }),
  tagFamily('q-normal', 'normal', 'difficulty', [[75, 'Normal 75회'], [150, 'Normal 150회'], [200, 'Normal 200회']],
    (g) => `Normal을 ${g}번 완주하세요.`, { style: 'quest-rare' }),
  tagFamily('q-hard', 'hard', 'difficulty', [[15, 'Hard 15회'], [20, 'Hard 20회'], [150, 'Hard 150회']],
    (g) => `Hard를 ${g}번 완주하세요.`, { style: 'quest-epic' }),
  tagFamily('q-extreme', 'extreme', 'difficulty', [[7, 'Extreme 7회'], [20, 'Extreme 20회'], [35, 'Extreme 35회'], [75, 'Extreme 75회'], [100, 'Extreme 100회']],
    (g) => `Extreme을 ${g}번 완주하세요.`, { style: 'quest-legendary' }),
  tagFamily('q-easy-pf', 'easy_perfect', 'perfect', [[25, 'Easy 퍼펙트 25회']], (g) => `Easy 퍼펙트 완주 ${g}회.`, { style: 'quest-rare' }),
  tagFamily('q-normal-pf', 'normal_perfect', 'perfect', [[25, 'Normal 퍼펙트 25회']], (g) => `Normal 퍼펙트 완주 ${g}회.`, { style: 'quest-epic' }),
  tagFamily('q-hard-pf', 'hard_perfect', 'perfect', [[10, 'Hard 퍼펙트 10회'], [20, 'Hard 퍼펙트 20회']], (g) => `Hard 퍼펙트 완주 ${g}회.`, { style: 'quest-legendary' }),
  tagFamily('q-extreme-pf', 'extreme_perfect', 'perfect', [[5, 'Extreme 퍼펙트 5회'], [25, 'Extreme 퍼펙트 25회']], (g) => `Extreme 퍼펙트 완주 ${g}회.`, { style: 'quest-legendary' }),
  [
    { id: 'q-speed-150', name: '러너',     style: 'quest-rare', category: 'speed', metric: 'speed', goal: 150000, unit: 'speed_ms', desc: '5스테이지를 2분 30초 안에 완주하세요.' },
    { id: 'q-speed-75',  name: '번개 손',  style: 'quest-epic', category: 'speed', metric: 'speed', goal: 75000,  unit: 'speed_ms', desc: '5스테이지를 75초 안에 완주하세요.' },
    { id: 'q-hardplus-25',  name: '고난도 단련자', style: 'quest-epic',      category: 'special', metric: 'hard_plus', goal: 25,  desc: 'Hard와 Extreme을 합쳐 25번 완주하세요.' },
    { id: 'q-hardplus-200', name: '고난도 군주',   style: 'quest-legendary', category: 'special', metric: 'hard_plus', goal: 200, desc: 'Hard와 Extreme을 합쳐 200번 완주하세요.' },
    { id: 'q-all-diffs-2',  name: '사원소 입문',   style: 'quest-rare',      category: 'special', metric: 'all_diffs_min', goal: 2,   desc: '4개 난이도를 각각 2번씩 완주하세요.' },
    { id: 'q-all-diffs-10', name: '사원소 숙련',   style: 'quest-epic',      category: 'special', metric: 'all_diffs_min', goal: 10,  desc: '4개 난이도를 각각 10번씩 완주하세요.' },
    { id: 'q-all-diffs-50', name: '사원소 군주',   style: 'quest-legendary', category: 'special', metric: 'all_diffs_min', goal: 50,  desc: '4개 난이도를 각각 50번씩 완주하세요.' },
  ],
  // ── 전용 칭호: 특정 계정 이름에게만 자동으로 주어짐(플레이로는 절대 얻을 수 없음, 관리자 특전도 적용 안 됨) ──
  [
    { id: 'exclusive-aura', name: 'AURA', style: 'aura', category: 'exclusive', exclusive: 'AURA',
      desc: 'AURA 계정에게만 자동으로 주어지는 전용 칭호예요. 다른 계정은 관리자도 가질 수 없어요.' },
  ]
);

/* ---------- 태그: SQL ---------- */
// 보드 한 줄에 표시할 태그(최대 3개)를 GROUP_CONCAT으로 한 번에 가져옵니다: "1:tier-2,2:q-first-clear"
const TAG_BOARD_SQL = `
  SELECT RANK() OVER (ORDER BY r.best_score DESC) AS place,
         u.username,
         r.best_score, r.best_stage, r.best_combo, r.plays,
         strftime('%Y-%m-%dT%H:%M:%SZ', r.achieved_at) AS achieved_at,
         eq.slots AS equipped_slots,
         COALESCE(st.total, 0) AS total_stages,
         c.bg_id AS bg_id, COALESCE(c.avatar_v, 0) AS avatar_v, fr.frame_id AS frame_id
    FROM rankings r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN user_cosmetics c ON c.user_id = r.user_id
    LEFT JOIN user_frame fr ON fr.user_id = r.user_id
    LEFT JOIN (SELECT user_id, SUM(stages_cleared) AS total FROM user_stats GROUP BY user_id) st
           ON st.user_id = r.user_id
    LEFT JOIN (SELECT user_id, GROUP_CONCAT(slot || ':' || tag_id, ',') AS slots
                 FROM user_equipped GROUP BY user_id) eq
           ON eq.user_id = r.user_id
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
         COALESCE(MAX(best_combo), 0)     AS combo,
         MIN(fastest_clear_ms)            AS fastest_ms
    FROM user_stats WHERE user_id = ? GROUP BY difficulty`;

const TAG_PROFILE_SQL = `SELECT best_place, flag_night_owl, flag_early_bird, flag_weekend FROM user_profiles WHERE user_id = ?`;

const TAG_EQUIPPED_SQL = `SELECT slot, tag_id FROM user_equipped WHERE user_id = ? ORDER BY slot`;

const TAG_PROFILE_RUN_SQL = `
  SELECT day_key, day_stages, date('now') AS today,
         CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', last_run_at) AS INTEGER) AS age_sec
    FROM user_profiles WHERE user_id = ?`;

const TAG_STATS_UPSERT_SQL = `
  INSERT INTO user_stats (user_id, game, difficulty, stages_cleared, runs_played, runs_cleared, perfect_runs, best_combo, fastest_clear_ms)
  VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
  ON CONFLICT(user_id, game, difficulty) DO UPDATE SET
    stages_cleared   = user_stats.stages_cleared + excluded.stages_cleared,
    runs_played      = user_stats.runs_played + 1,
    runs_cleared     = user_stats.runs_cleared + excluded.runs_cleared,
    perfect_runs     = user_stats.perfect_runs + excluded.perfect_runs,
    best_combo       = MAX(user_stats.best_combo, excluded.best_combo),
    fastest_clear_ms = CASE
                          WHEN excluded.fastest_clear_ms IS NULL THEN user_stats.fastest_clear_ms
                          WHEN user_stats.fastest_clear_ms IS NULL THEN excluded.fastest_clear_ms
                          ELSE MIN(user_stats.fastest_clear_ms, excluded.fastest_clear_ms)
                        END`;

const TAG_PROFILE_UPSERT_SQL = `
  INSERT INTO user_profiles (user_id, last_run_at, day_key, day_stages, flag_night_owl, flag_early_bird, flag_weekend, updated_at)
  VALUES (?, datetime('now'), date('now'), ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    day_stages      = CASE WHEN user_profiles.day_key = date('now')
                           THEN user_profiles.day_stages + excluded.day_stages
                           ELSE excluded.day_stages END,
    day_key         = date('now'),
    last_run_at     = datetime('now'),
    flag_night_owl  = MAX(user_profiles.flag_night_owl, excluded.flag_night_owl),
    flag_early_bird = MAX(user_profiles.flag_early_bird, excluded.flag_early_bird),
    flag_weekend    = MAX(user_profiles.flag_weekend, excluded.flag_weekend),
    updated_at      = datetime('now')`;

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
  if (q) return { id, kind: q.exclusive ? 'exclusive' : q.limited ? 'limited' : 'quest', name: q.name, style: q.style };
  m = /^s(\d+)-(.+)-(easy|normal|hard|extreme)-([123])$/.exec(id);
  if (m) {
    return { id, kind: 'season', name: `시즌 ${m[1]} ${TAG_DIFF_NAMES[m[3]]} ${m[4]}등`, style: 'season-' + m[4] };
  }
  return null;
}

const TAG_CATALOG_IDS = TAG_TIERS.map((t) => 'tier-' + t.level).concat(TAG_QUESTS.map((q) => q.id));

// 퀘스트 현재 진행값 (speed 는 tagDone 에서 별도로 판정)
function tagMetric(metric, s) {
  let m;
  if (metric === 'stages') return s.stages;
  if (metric === 'cleared') return s.cleared;
  if (metric === 'perfect') return s.perfect;
  if (metric === 'combo') return s.combo;
  if (metric === 'played') return s.played;
  if (TAG_DIFFS.indexOf(metric) !== -1) return s.byDiff[metric].cleared;
  if ((m = /^(easy|normal|hard|extreme)_perfect$/.exec(metric))) return s.byDiff[m[1]].perfect;
  if (metric === 'hard_plus') return s.byDiff.hard.cleared + s.byDiff.extreme.cleared;
  if (metric === 'all_diffs') return TAG_DIFFS.filter((d) => s.byDiff[d].cleared > 0).length;
  if (metric === 'all_diffs_min') return Math.min.apply(null, TAG_DIFFS.map((d) => s.byDiff[d].cleared));
  if (metric === 'podium') return s.bestPlace && s.bestPlace <= 3 ? 1 : 0;
  if (metric === 'champion') return s.bestPlace === 1 ? 1 : 0;
  if (metric === 'top10') return s.bestPlace && s.bestPlace <= 10 ? 1 : 0;
  if (metric === 'top50') return s.bestPlace && s.bestPlace <= 50 ? 1 : 0;
  if (metric === 'speed') return s.fastestMs;
  if (metric === 'flag_night_owl') return s.flags.night_owl ? 1 : 0;
  if (metric === 'flag_early_bird') return s.flags.early_bird ? 1 : 0;
  if (metric === 'flag_weekend') return s.flags.weekend ? 1 : 0;
  return 0;
}
function tagDone(q, s) {
  if (q.metric === 'speed') return s.fastestMs != null && s.fastestMs <= q.goal;
  return tagMetric(q.metric, s) >= q.goal;
}

// "1:tier-2,2:q-first-clear" 형태의 GROUP_CONCAT 문자열 → 슬롯 배열(최대 3, 빈 슬롯은 없음)
function tagParseSlots(raw) {
  if (!raw) return [];
  return String(raw).split(',').map((pair) => {
    const i = pair.indexOf(':');
    return i === -1 ? null : { slot: Number(pair.slice(0, i)), tag_id: pair.slice(i + 1) };
  }).filter(Boolean).sort((a, b) => a.slot - b.slot);
}

function tagBoardRows(results, myUsername) {
  return (results || []).map((r) => {
    const equipped = tagParseSlots(r.equipped_slots).map((s) => tagInfo(s.tag_id)).filter(Boolean);
    const tags = equipped.length ? equipped : [tagInfo('tier-' + tagTierOf(r.total_stages || 0).level)];
    return {
      rank: Number(r.place),
      username: r.username,
      score: r.best_score,
      stage: r.best_stage,
      combo: r.best_combo,
      plays: r.plays,
      achieved_at: r.achieved_at,
      is_me: !!myUsername && r.username === myUsername,
      tags,
      bg: bgInfo(r.bg_id) && r.bg_id !== 'plain' ? r.bg_id : null,
      avatar: r.avatar_v ? Number(r.avatar_v) : null,
      frame: frameInfo(r.frame_id) ? r.frame_id : null,
    };
  });
}

// 시즌 + (로그인 시) 누적 통계/프로필/장착 슬롯을 한 번에 읽기
async function tagLoadState(env, userId) {
  const stmts = [env.DB.prepare(TAG_SEASON_SQL)];
  if (userId !== null && userId !== undefined) {
    stmts.push(env.DB.prepare(TAG_STATS_GROUP_SQL).bind(userId));
    stmts.push(env.DB.prepare(TAG_PROFILE_SQL).bind(userId));
    stmts.push(env.DB.prepare(TAG_EQUIPPED_SQL).bind(userId));
  }
  const res = await env.DB.batch(stmts);

  const s = {
    season: 1, seasonStartedAt: null,
    stages: 0, played: 0, cleared: 0, perfect: 0, combo: 0, fastestMs: null,
    byDiff: {}, bestPlace: null, equippedSlots: [], flags: { night_owl: false, early_bird: false, weekend: false },
  };
  TAG_DIFFS.forEach((d) => { s.byDiff[d] = { cleared: 0, stages: 0, perfect: 0 }; });

  const season = res[0].results && res[0].results[0];
  if (season) { s.season = season.current_season; s.seasonStartedAt = season.started_at; }

  if (res[1]) {
    for (const r of res[1].results || []) {
      s.stages += r.stages; s.played += r.played; s.cleared += r.cleared; s.perfect += r.perfect;
      s.combo = Math.max(s.combo, r.combo);
      if (r.fastest_ms != null) s.fastestMs = s.fastestMs == null ? r.fastest_ms : Math.min(s.fastestMs, r.fastest_ms);
      if (s.byDiff[r.difficulty]) s.byDiff[r.difficulty] = { cleared: r.cleared, stages: r.stages, perfect: r.perfect };
    }
    const prof = res[2] && res[2].results && res[2].results[0];
    if (prof) {
      s.bestPlace = prof.best_place || null;
      s.flags = { night_owl: !!prof.flag_night_owl, early_bird: !!prof.flag_early_bird, weekend: !!prof.flag_weekend };
    }
    s.equippedSlots = (res[3] && res[3].results || []).map((r) => ({ slot: r.slot, tag_id: r.tag_id }));
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

// 계정 이름이 정확히 일치하는 사람에게만 자동 지급되는 전용 칭호 — 플레이로는 얻을 수 없고,
// isAdminName() 특전도 여기엔 적용되지 않습니다(TAG_QUESTS 의 exclusive 필드 기준).
async function tagEnsureExclusiveTags(env, userId, username) {
  const mine = TAG_QUESTS.filter((q) => q.exclusive && q.exclusive === username);
  if (!mine.length) return;
  const values = [], binds = [];
  mine.forEach((q) => { values.push("(?, ?, 'exclusive')"); binds.push(userId, q.id); });
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

// KST(UTC+9) 기준으로 지금이 새벽/이른아침/주말인지 — 기록 제출 시각으로 판정합니다.
function tagTimeFlags(now) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours(), day = kst.getUTCDay();   // day: 0=일 6=토 (KST 기준으로 시프트했으므로 getUTC* 사용)
  return {
    night_owl: hour >= 0 && hour < 5,
    early_bird: hour >= 5 && hour < 7,
    weekend: day === 0 || day === 6,
  };
}

function tagDbError(request, err) {
  const msg = String((err && err.message) || err || '');
  console.error('tags db error:', msg);
  if (/no such table|no such column/i.test(msg))
    return fail(request, '등급/태그 테이블이 아직 없어요. sql/tags.sql 과 sql/multi-equip.sql 을 D1에 먼저 적용해 주세요.', 503);
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
    await ensureCosmetics(env);
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
    const flags = tagTimeFlags(new Date());

    await ensureCosmetics(env);   // 랭킹 줄(TAG_BOARD_SQL)이 user_cosmetics 를 조인하므로 첫 호출에서도 테이블이 있어야 함
    const out = await env.DB.batch([
      env.DB.prepare(RANK_UPSERT_SQL).bind(claims.sub, game, difficulty, score, stage, combo),
      env.DB.prepare(TAG_STATS_UPSERT_SQL).bind(
        claims.sub, game, difficulty, counted, fullRun ? 1 : 0, fullRun && perfect ? 1 : 0, combo,
        fullRun ? Math.round(durationMs) : null),
      env.DB.prepare(TAG_PROFILE_UPSERT_SQL).bind(
        claims.sub, counted, flags.night_owl ? 1 : 0, flags.early_bird ? 1 : 0, flags.weekend ? 1 : 0),
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

    // 지금 받을 수 있는 퀘스트 수 (관리자는 항상 0 — 이미 전부 보유)
    let questsReady = 0;
    if (!isAdminName(claims.username)) {
      const st = await tagLoadState(env, claims.sub);
      const owned = new Set((await tagOwned(env, claims.sub)).map((r) => r.tag_id));
      questsReady = TAG_QUESTS.filter((q) =>
        !owned.has(q.id) && (!q.limited || q.season === st.season) && tagDone(q, st)).length;
    }

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

/* ---------- GET /api/tags/me  (등급 · 태그 · 퀘스트 · 시즌 · 장착 슬롯) ---------- */
async function handleTagsMe(request, env) {
  const claims = await requireUser(request, env);   // 로그인 안 했으면 진행도 없이 카탈로그만
  const admin = !!claims && isAdminName(claims.username);

  try {
    const st = await tagLoadState(env, claims ? claims.sub : null);
    let ownedRows = [], places = [];
    if (claims) {
      await tagEnsureTierTags(env, claims.sub, st.stages);
      await tagEnsureExclusiveTags(env, claims.sub, claims.username);
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
      // 전용 칭호(exclusive)는 계정 이름으로만 결정됩니다 — 관리자 특전(admin ||)도 여기엔 적용하지 않습니다.
      if (q.exclusive) {
        const got = owned.has(q.id);
        return {
          id: q.id, name: q.name, desc: q.desc, style: q.style, category: q.category, unit: null,
          limited: false, season: null, exclusive: true,
          goal: 1, current: got ? 1 : 0, done: got, claimed: got, available: true,
          tag: tagInfo(q.id),
        };
      }
      const done = admin || tagDone(q, st);
      const raw = tagMetric(q.metric, st);
      return {
        id: q.id, name: q.name, desc: q.desc, style: q.style, category: q.category, unit: q.unit || null,
        limited: !!q.limited, season: q.season || null,
        goal: q.goal, current: q.unit === 'speed_ms' ? raw : Math.min(Math.max(raw, 0), q.goal),
        done,
        claimed: admin || owned.has(q.id),
        available: admin || !q.limited || q.season === st.season,   // 한정판은 그 시즌 중에만 (관리자는 예외)
        tag: tagInfo(q.id),
      };
    });

    const equippedTags = st.equippedSlots.map((e) => ({ slot: e.slot, tag: tagInfo(e.tag_id) })).filter((e) => e.tag);
    const slots = [1, 2, 3].map((n) => (equippedTags.find((e) => e.slot === n) || {}).tag || null);
    const displayTags = slots.filter(Boolean).length ? slots.filter(Boolean) : [tagTierBrief(tier)];

    const seasonTags = ownedRows
      .filter((r) => r.source === 'season')
      .map((r) => tagInfo(r.tag_id))
      .filter(Boolean)
      .sort((a, b) => b.id.localeCompare(a.id));

    return ok(request, {
      authed: !!claims,
      is_admin: admin,
      season: { current: st.season, started_at: st.seasonStartedAt },
      stats: {
        stages: st.stages, played: st.played, cleared: st.cleared, perfect: st.perfect,
        combo: st.combo, best_place: st.bestPlace, fastest_ms: st.fastestMs,
      },
      tier: tagTierBrief(tier),
      next_tier: next ? { ...tagTierBrief(next), remaining: next.min - st.stages } : null,
      tiers: TAG_TIERS.map((t) => ({ ...tagTierBrief(t), owned: admin || (!!claims && st.stages >= t.min) })),
      equip_slots: TAG_EQUIP_SLOTS,
      equipped: slots,          // [태그|null, 태그|null, 태그|null] — 내가 실제로 고른 것
      display_tags: displayTags, // 리더보드에 실제로 표시되는 것(아무것도 안 골랐으면 현재 등급)
      quests,
      quests_ready: admin ? 0 : quests.filter((q) => q.done && !q.claimed && q.available).length,
      season_tags: seasonTags,
      my_places: places.map((r) => ({ game: r.game, difficulty: r.difficulty, place: Number(r.place), score: r.best_score })),
    });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/tags/equip  { tag_id, slot? } ----------
   slot 을 생략하면 비어 있는 슬롯 중 가장 앞자리에 자동으로 장착합니다.
   tag_id 가 null 이면 그 슬롯을 해제합니다(slot 필수). */
async function handleTagsEquip(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);
  const admin = isAdminName(claims.username);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(request, '요청 형식이 올바르지 않습니다.');
  const tagId = body.tag_id === null || body.tag_id === undefined || body.tag_id === '' ? null : String(body.tag_id);
  let slot = body.slot === null || body.slot === undefined ? null : Number(body.slot);
  if (slot !== null && (!Number.isInteger(slot) || slot < 1 || slot > TAG_EQUIP_SLOTS))
    return fail(request, `슬롯 번호는 1~${TAG_EQUIP_SLOTS} 사이여야 합니다.`);
  if (tagId === null && slot === null) return fail(request, '해제할 슬롯 번호(slot)를 알려주세요.');

  try {
    const st = await tagLoadState(env, claims.sub);
    await tagEnsureTierTags(env, claims.sub, st.stages);     // 방금 오른 등급 태그도 바로 장착할 수 있게
    await tagEnsureExclusiveTags(env, claims.sub, claims.username);

    if (tagId !== null) {
      const info = tagInfo(tagId);
      if (!info) return fail(request, '알 수 없는 태그입니다.');
      // 전용 칭호(exclusive)는 관리자 특전을 적용하지 않습니다 — 실제로 소유한 계정만 장착 가능.
      const bypass = admin && info.kind !== 'exclusive';
      if (!bypass) {
        const has = await env.DB
          .prepare('SELECT 1 AS ok FROM user_tags WHERE user_id = ? AND tag_id = ?').bind(claims.sub, tagId).first();
        if (!has) return fail(request, info.kind === 'exclusive' ? '이 칭호는 전용 계정만 장착할 수 있어요.' : '아직 획득하지 못한 태그예요.', 403);
      }
      const already = st.equippedSlots.find((e) => e.tag_id === tagId);
      if (already && already.slot !== slot) return fail(request, '이미 다른 슬롯에 장착 중인 태그예요.', 409);

      if (slot === null) {
        const used = new Set(st.equippedSlots.map((e) => e.slot));
        for (let n = 1; n <= TAG_EQUIP_SLOTS; n++) if (!used.has(n)) { slot = n; break; }
        if (slot === null)
          return fail(request, `이미 ${TAG_EQUIP_SLOTS}개를 장착했어요. 뺄 슬롯(slot)을 지정해 주세요.`, 409);
      }

      await env.DB.prepare(
        `INSERT INTO user_equipped (user_id, slot, tag_id) VALUES (?, ?, ?)
         ON CONFLICT(user_id, slot) DO UPDATE SET tag_id = excluded.tag_id`
      ).bind(claims.sub, slot, tagId).run();
    } else {
      await env.DB.prepare('DELETE FROM user_equipped WHERE user_id = ? AND slot = ?').bind(claims.sub, slot).run();
    }

    const { results } = await env.DB.prepare(TAG_EQUIPPED_SQL).bind(claims.sub).all();
    const bySlot = {}; (results || []).forEach((r) => { bySlot[r.slot] = tagInfo(r.tag_id); });
    const slots = [1, 2, 3].map((n) => bySlot[n] || null);

    return ok(request, {
      equipped: slots,
      display_tags: slots.filter(Boolean).length ? slots.filter(Boolean) : [tagTierBrief(tagTierOf(st.stages))],
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
  if (quest.exclusive)
    return fail(request, '이 칭호는 직접 받는 게 아니라 전용 계정에 자동으로 주어져요.', 400);

  try {
    if (!isAdminName(claims.username)) {
      const st = await tagLoadState(env, claims.sub);
      if (quest.limited && quest.season !== st.season)
        return fail(request, '이 한정판 태그는 시즌이 끝나서 더 이상 받을 수 없어요.', 410);
      if (!tagDone(quest, st))
        return fail(request, '아직 퀘스트 조건을 달성하지 못했어요.', 400);
    }

    const res = await env.DB
      .prepare(`INSERT OR IGNORE INTO user_tags (user_id, tag_id, source) VALUES (?, ?, ?)`)
      .bind(claims.sub, quest.id, quest.limited ? 'limited' : 'quest').run();
    const changed = res && res.meta ? res.meta.changes : 1;

    return ok(request, { already: !changed, tag: tagInfo(quest.id) });
  } catch (err) {
    return tagDbError(request, err);
  }
}


/* ================================================================
   프로필 · 프로필 사진 · 배경(랭킹 줄 꾸미기) · 비밀번호 변경
   테이블은 처음 쓸 때 자동으로 만들어집니다(sql/profile.sql 로 미리 만들어도 됩니다).
================================================================ */
const COSMETICS_DDL = [
  `CREATE TABLE IF NOT EXISTS user_cosmetics (
     user_id    INTEGER PRIMARY KEY,
     bio        TEXT    NOT NULL DEFAULT '',
     bg_id      TEXT,
     avatar_v   INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS user_avatars (
     user_id INTEGER PRIMARY KEY,
     mime    TEXT NOT NULL,
     b64     TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS user_frame (
     user_id  INTEGER PRIMARY KEY,
     frame_id TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS user_intro (
     user_id  INTEGER PRIMARY KEY,
     intro_id TEXT NOT NULL
   )`,
];
let cosmeticsReady = null;
function ensureCosmetics(env) {
  if (!cosmeticsReady) {
    cosmeticsReady = env.DB.batch(COSMETICS_DDL.map((q) => env.DB.prepare(q)))
      .catch((e) => { cosmeticsReady = null; throw e; });
  }
  return cosmeticsReady;
}

const BIO_MAX = 100;
const AVATAR_MAX_BYTES = 60 * 1024;

/* 배경 카탈로그 — 모양(CSS)은 kiho-badge.js 의 같은 id 가 그립니다.
   unlock: free | tier(level) | tag(tag_id) | exclusive(name) */
const BG_CATALOG = [
  { id: 'plain',      name: '기본',            category: 'basic', desc: '누구나 쓰는 기본 배경이에요.', unlock: { type: 'free' } },

  { id: 'bronze',     name: '브론즈 노을',     category: 'tier', desc: '따뜻한 구릿빛 노을.',            unlock: { type: 'tier', level: 2 } },
  { id: 'silver',     name: '실버 물결',       category: 'tier', desc: '은빛으로 일렁이는 물결.',        unlock: { type: 'tier', level: 3 } },
  { id: 'gold',       name: '골드 러시',       category: 'tier', desc: '반짝이는 황금빛 줄무늬.',        unlock: { type: 'tier', level: 4 } },
  { id: 'platinum',   name: '플래티넘 미스트', category: 'tier', desc: '차갑고 맑은 안개.',              unlock: { type: 'tier', level: 5 } },
  { id: 'emerald',    name: '에메랄드 숲',     category: 'tier', desc: '깊고 푸른 숲의 빛.',             unlock: { type: 'tier', level: 6 } },
  { id: 'diamond',    name: '다이아 프리즘',   category: 'tier', desc: '빛이 갈라지는 프리즘.',          unlock: { type: 'tier', level: 7 } },
  { id: 'master',     name: '마스터 네뷸라',   category: 'tier', desc: '보랏빛 성운.',                   unlock: { type: 'tier', level: 8 } },
  { id: 'grandmaster',name: '그랜드 선셋',     category: 'tier', desc: '붉게 타오르는 해질녘.',          unlock: { type: 'tier', level: 9 } },
  { id: 'challenger', name: '챌린저 번개',     category: 'tier', desc: '번쩍이는 전기 줄기.',            unlock: { type: 'tier', level: 10 } },
  { id: 'myth',       name: '신화 은하',       category: 'tier', desc: '별이 흐르는 은하수.',            unlock: { type: 'tier', level: 11 } },
  { id: 'legend',     name: '레전드 오로라',   category: 'tier', desc: '황금빛으로 일렁이는 오로라.',    unlock: { type: 'tier', level: 12 } },

  { id: 'paper',      name: '첫걸음 종이',     category: 'tag', desc: '처음 클리어한 기념 종이 질감.',   unlock: { type: 'tag', tag_id: 'q-first-clear' } },
  { id: 'nightsky',   name: '한밤 별빛',       category: 'tag', desc: '새벽에 플레이한 올빼미를 위한 밤하늘.', unlock: { type: 'tag', tag_id: 'q-night-owl' } },
  { id: 'dawn',       name: '새벽 안개',       category: 'tag', desc: '이른 아침의 푸르스름한 안개.',    unlock: { type: 'tag', tag_id: 'q-early-bird' } },
  { id: 'weekend',    name: '주말 파스텔',     category: 'tag', desc: '여유로운 주말의 파스텔 톤.',      unlock: { type: 'tag', tag_id: 'q-weekend' } },
  { id: 'ember',      name: '불씨',            category: 'tag', desc: 'Hard 를 넘은 사람의 불씨.',       unlock: { type: 'tag', tag_id: 'q-hard-1' } },
  { id: 'lava',       name: '용암',            category: 'tag', desc: 'Extreme 를 넘은 사람의 용암.',    unlock: { type: 'tag', tag_id: 'q-extreme-1' } },
  { id: 'crystal',    name: '크리스탈',        category: 'tag', desc: '퍼펙트 완주의 투명한 결정.',      unlock: { type: 'tag', tag_id: 'q-perfect-3' } },
  { id: 'neon',       name: '네온 그리드',     category: 'tag', desc: '콤보를 쌓은 사람의 네온 격자.',   unlock: { type: 'tag', tag_id: 'q-combo-5' } },
  { id: 'speed',      name: '스피드 라인',     category: 'tag', desc: '빠르게 달리는 속도선.',           unlock: { type: 'tag', tag_id: 'q-speed-60' } },
  { id: 'rainbow',    name: '무지개',          category: 'tag', desc: '모든 난이도를 맛본 사람의 무지개.', unlock: { type: 'tag', tag_id: 'q-all-diffs' } },
  { id: 'spotlight',  name: '포디움 스포트라이트', category: 'tag', desc: 'TOP 3 에 오른 사람에게 쏟아지는 조명.', unlock: { type: 'tag', tag_id: 'q-podium' } },
  { id: 'topten',     name: '탑텐 스파크',     category: 'tag', desc: 'TOP 10 의 불꽃.',                 unlock: { type: 'tag', tag_id: 'q-top10' } },
  { id: 'crown',      name: '챔피언 왕관',     category: 'tag', desc: '1위에 오른 사람만의 황금 왕관 무늬.', unlock: { type: 'tag', tag_id: 'q-champion' } },
  { id: 'pioneer',    name: '시즌 1 개척자',   category: 'tag', desc: '시즌 1 한정 태그 보유자의 기념 배경.', unlock: { type: 'tag', tag_id: 'ltd-s1-pioneer' } },

  { id: 'storm',      name: '폭풍우',          category: 'tag', desc: 'Hard 100스테이지를 돌파한 사람의 번개 구름.', unlock: { type: 'tag', tag_id: 'q-hard-100' } },
  { id: 'ocean',      name: '심해',            category: 'tag', desc: '2000판을 플레이한 사람의 깊은 바다.', unlock: { type: 'tag', tag_id: 'q-play-2000' } },
  { id: 'matrix',     name: '매트릭스',        category: 'tag', desc: '3000스테이지를 클리어한 사람의 디지털 비.', unlock: { type: 'tag', tag_id: 'q-stage-3000' } },
  { id: 'sakura',     name: '벚꽃',            category: 'tag', desc: '마라톤 완주자에게 흩날리는 꽃잎.', unlock: { type: 'tag', tag_id: 'q-marathon' } },
  { id: 'sunrise',    name: '선라이즈',        category: 'tag', desc: '45초 안에 클리어한 사람의 아침 햇살.', unlock: { type: 'tag', tag_id: 'q-speed-45' } },
  { id: 'blaze',      name: '시즌 1 불꽃',     category: 'tag', desc: '시즌 1 동안 Hard 이상을 완주한 기념 불꽃.', unlock: { type: 'tag', tag_id: 'ltd-s1-blaze' } },
  { id: 'void',       name: '보이드',          category: 'tag', desc: 'Extreme 50스테이지를 넘은 사람의 허공.', unlock: { type: 'tag', tag_id: 'q-extreme-50' } },

  { id: 'aura',       name: 'AURA',            category: 'exclusive', desc: 'AURA 계정에게만 주어지는 전용 배경. 관리자도 가질 수 없어요.', unlock: { type: 'exclusive', name: 'AURA' } },
];

function bgInfo(id) { return id ? BG_CATALOG.find((b) => b.id === id) || null : null; }

function bgUnlockLabel(bg) {
  const u = bg.unlock;
  if (u.type === 'free') return '기본 제공';
  if (u.type === 'tier') { const t = TAG_TIERS[u.level - 1]; return `${t.name} 등급 달성 (누적 ${t.min} 스테이지)`; }
  if (u.type === 'tag') { const t = tagInfo(u.tag_id); return `태그 “${t ? t.name : u.tag_id}” 획득`; }
  if (u.type === 'exclusive') return `${u.name} 계정 전용`;
  return '';
}

function bgUnlocked(bg, ctx) {
  const u = bg.unlock;
  if (u.type === 'free') return true;
  if (u.type === 'exclusive') return !!ctx.username && ctx.username === u.name;   // 관리자 특전 없음
  if (ctx.admin) return true;
  if (u.type === 'tier') return ctx.stages >= TAG_TIERS[u.level - 1].min;
  if (u.type === 'tag') return ctx.ownedTags.has(u.tag_id);
  return false;
}

async function bgContext(env, claims) {
  const ctx = { stages: 0, ownedTags: new Set(), username: claims.username, admin: isAdminName(claims.username), equipped: null, bio: '', bestPlace: null, frame: null };
  const [st, tags, cos, prof, fr] = await env.DB.batch([
    env.DB.prepare('SELECT COALESCE(SUM(stages_cleared), 0) AS total FROM user_stats WHERE user_id = ?').bind(claims.sub),
    env.DB.prepare('SELECT tag_id FROM user_tags WHERE user_id = ?').bind(claims.sub),
    env.DB.prepare('SELECT bg_id, bio FROM user_cosmetics WHERE user_id = ?').bind(claims.sub),
    env.DB.prepare(TAG_PROFILE_SQL).bind(claims.sub),
    env.DB.prepare('SELECT frame_id FROM user_frame WHERE user_id = ?').bind(claims.sub),
  ]);
  const pr = prof.results && prof.results[0];
  ctx.bestPlace = pr && pr.best_place ? Number(pr.best_place) : null;
  ctx.frame = fr.results && fr.results[0] ? fr.results[0].frame_id : null;
  ctx.stages = Number(st.results && st.results[0] && st.results[0].total) || 0;
  (tags.results || []).forEach((r) => ctx.ownedTags.add(r.tag_id));
  const c = cos.results && cos.results[0];
  if (c) { ctx.equipped = c.bg_id || null; ctx.bio = c.bio || ''; }
  return ctx;
}

/* ---------- GET /api/backgrounds ---------- */
async function handleBackgroundsGet(request, env) {
  const claims = await requireUser(request, env);
  try {
    await ensureCosmetics(env);
    const ctx = claims ? await bgContext(env, claims) : null;
    const list = BG_CATALOG.map((b) => ({
      id: b.id, name: b.name, desc: b.desc, category: b.category, unlock_label: bgUnlockLabel(b),
      owned: ctx ? bgUnlocked(b, ctx) : b.unlock.type === 'free',
    }));
    return ok(request, {
      authed: !!claims,
      backgrounds: list,
      equipped: ctx && bgInfo(ctx.equipped) ? ctx.equipped : 'plain',
    });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/backgrounds/equip  { bg_id } ---------- */
async function handleBackgroundEquip(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(request, '요청 형식이 올바르지 않습니다.');
  const id = body.bg_id === null || body.bg_id === undefined || body.bg_id === '' ? 'plain' : String(body.bg_id);
  const bg = bgInfo(id);
  if (!bg) return fail(request, '알 수 없는 배경입니다.');

  try {
    await ensureCosmetics(env);
    const ctx = await bgContext(env, claims);
    if (!bgUnlocked(bg, ctx))
      return fail(request, bg.unlock.type === 'exclusive' ? '이 배경은 전용 계정만 쓸 수 있어요.' : '아직 획득하지 못한 배경이에요.', 403);
    await env.DB.prepare(
      `INSERT INTO user_cosmetics (user_id, bg_id) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET bg_id = excluded.bg_id, updated_at = datetime('now')`
    ).bind(claims.sub, id === 'plain' ? null : id).run();
    return ok(request, { equipped: id });
  } catch (err) {
    return tagDbError(request, err);
  }
}


/* ---------- 프로필 테두리 (모양·애니메이션은 kiho-profile.js 의 같은 id 가 그립니다) ---------- */
const FRAME_TIER_DEFS = [
  ['t-bronze',      2,  '브론즈 불씨',      '따뜻한 구릿빛으로 천천히 도는 링.'],
  ['t-silver',      3,  '실버 샤인',        '은빛으로 반짝이며 도는 링.'],
  ['t-gold',        4,  '골드 펄스',        '황금빛으로 숨 쉬듯 빛나는 링.'],
  ['t-platinum',    5,  '플래티넘 프로스트', '얼음 조각이 도는 점선 링.'],
  ['t-emerald',     6,  '에메랄드 리프',    '초록 불빛이 맥박처럼 뛰며 반짝여요.'],
  ['t-diamond',     7,  '다이아 프리즘',    '무지갯빛으로 빠르게 도는 링.'],
  ['t-master',      8,  '마스터 이중 성운', '두 개의 링이 서로 반대로 돌아요.'],
  ['t-grandmaster', 9,  '그랜드 화염',      '타오르는 불꽃처럼 일렁이는 링.'],
  ['t-challenger',  10, '챌린저 번개',      '번쩍이는 전기가 빠르게 도는 링.'],
  ['t-myth',        11, '신화 궤도',        '별 하나가 링 둘레를 돌아요.'],
  ['t-legend',      12, '레전드 오로라',    '오로라 빛과 이중 링, 떠도는 별빛.'],
];
const FRAME_CATALOG = [
  { id: 'plain', name: '자동', category: 'basic', desc: '1·2·3위면 왕관, TOP 10 이면 별, 아니면 등급 색 링이 자동으로 붙어요.', unlock: { type: 'free' } },
  ...FRAME_TIER_DEFS.map(([id, level, name, desc]) => ({ id, name, category: 'tier', desc, unlock: { type: 'tier', level } })),

  { id: 'g-first',    name: '첫걸음 민트',    category: 'tag', desc: '민트빛으로 은은하게 뛰는 링.',               unlock: { type: 'tag', tag_id: 'q-first-clear' } },
  { id: 'g-owl',      name: '올빼미 달',      category: 'tag', desc: '달이 사진 둘레를 돌아요.',                   unlock: { type: 'tag', tag_id: 'q-night-owl' } },
  { id: 'g-early',    name: '새벽 해',        category: 'tag', desc: '작은 해가 사진 둘레를 돌아요.',              unlock: { type: 'tag', tag_id: 'q-early-bird' } },
  { id: 'g-neon',     name: '네온 점멸',      category: 'tag', desc: '분홍·하늘색 네온이 깜빡여요.',               unlock: { type: 'tag', tag_id: 'q-combo-5' } },
  { id: 'g-crystal',  name: '크리스탈',       category: 'tag', desc: '투명한 조각이 반짝이며 도는 링.',            unlock: { type: 'tag', tag_id: 'q-perfect-3' } },
  { id: 'g-speed',    name: '스피드 체이스',  category: 'tag', desc: '빛이 눈 깜짝할 새 달려요.',                  unlock: { type: 'tag', tag_id: 'q-speed-45' } },
  { id: 'g-lava',     name: '용암',           category: 'tag', desc: '꿈틀대는 용암 빛 링.',                       unlock: { type: 'tag', tag_id: 'q-extreme-1' } },
  { id: 'g-rainbow',  name: '무지개',         category: 'tag', desc: '색이 계속 바뀌며 도는 링.',                  unlock: { type: 'tag', tag_id: 'q-all-diffs' } },
  { id: 'g-marathon', name: '마라톤',         category: 'tag', desc: '꾸준히 달리는 점선 링.',                     unlock: { type: 'tag', tag_id: 'q-marathon' } },
  { id: 'g-blaze',    name: '시즌 1 불꽃',    category: 'tag', desc: '불똥이 튀는 시즌 1 기념 링.',                unlock: { type: 'tag', tag_id: 'ltd-s1-blaze' } },
  { id: 'g-pioneer',  name: '시즌 1 개척자',  category: 'tag', desc: '별빛이 도는 시즌 1 기념 링.',                unlock: { type: 'tag', tag_id: 'ltd-s1-pioneer' } },
  { id: 'g-storm',    name: '폭풍우',         category: 'tag', desc: '번개가 내리치는 먹구름 링.',                 unlock: { type: 'tag', tag_id: 'q-hard-100' } },
  { id: 'g-matrix',   name: '매트릭스',       category: 'tag', desc: '초록 코드가 빠르게 흐르는 링.',              unlock: { type: 'tag', tag_id: 'q-stage-3000' } },
  { id: 'g-void',     name: '보이드',         category: 'tag', desc: '허공으로 번지는 보랏빛 파동.',               unlock: { type: 'tag', tag_id: 'q-extreme-50' } },
  { id: 'g-ocean',    name: '심해 거품',      category: 'tag', desc: '거품이 올라오는 깊은 바다 링.',              unlock: { type: 'tag', tag_id: 'q-play-2000' } },

  { id: 'crown-gold',   name: '황금 왕관', category: 'rank', desc: '1위를 한 번이라도 해본 사람의 금 왕관.',   unlock: { type: 'rank', max: 1 } },
  { id: 'crown-silver', name: '은 왕관',   category: 'rank', desc: '2위 이내에 들어본 사람의 은 왕관.',        unlock: { type: 'rank', max: 2 } },
  { id: 'crown-bronze', name: '동 왕관',   category: 'rank', desc: '3위 이내에 들어본 사람의 동 왕관.',        unlock: { type: 'rank', max: 3 } },
  { id: 'star',         name: '별 테두리', category: 'rank', desc: 'TOP 10 에 들어본 사람의 별 테두리.',       unlock: { type: 'rank', max: 10 } },

  { id: 'x-aura', name: 'AURA 오라', category: 'exclusive', desc: 'AURA 계정만 쓸 수 있는 전용 테두리. 관리자도 가질 수 없어요.', unlock: { type: 'exclusive', name: 'AURA' } },
];
function frameInfo(id) { return id ? FRAME_CATALOG.find((f) => f.id === id) || null : null; }
function frameUnlockLabel(f) {
  const u = f.unlock;
  if (u.type === 'rank') return `역대 ${u.max}위 이내 달성`;
  return bgUnlockLabel(f);
}
function frameUnlocked(f, ctx) {
  const u = f.unlock;
  if (u.type === 'rank') return ctx.admin || (!!ctx.bestPlace && ctx.bestPlace <= u.max);
  return bgUnlocked(f, ctx);
}

/* ---------- GET /api/frames ---------- */
async function handleFramesGet(request, env) {
  const claims = await requireUser(request, env);
  try {
    await ensureCosmetics(env);
    const ctx = claims ? await bgContext(env, claims) : null;
    const list = FRAME_CATALOG.map((f) => ({
      id: f.id, name: f.name, desc: f.desc, category: f.category, unlock_label: frameUnlockLabel(f),
      owned: ctx ? frameUnlocked(f, ctx) : f.unlock.type === 'free',
    }));
    return ok(request, { authed: !!claims, frames: list, equipped: ctx && frameInfo(ctx.frame) ? ctx.frame : 'plain' });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/frames/equip  { frame_id } ---------- */
async function handleFrameEquip(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(request, '요청 형식이 올바르지 않습니다.');
  const id = body.frame_id === null || body.frame_id === undefined || body.frame_id === '' ? 'plain' : String(body.frame_id);
  const f = frameInfo(id);
  if (!f) return fail(request, '알 수 없는 테두리입니다.');
  try {
    await ensureCosmetics(env);
    const ctx = await bgContext(env, claims);
    if (!frameUnlocked(f, ctx))
      return fail(request, f.unlock.type === 'exclusive' ? '이 테두리는 전용 계정만 쓸 수 있어요.' : '아직 획득하지 못한 테두리예요.', 403);
    if (id === 'plain') await env.DB.prepare('DELETE FROM user_frame WHERE user_id = ?').bind(claims.sub).run();
    else await env.DB.prepare(
      `INSERT INTO user_frame (user_id, frame_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET frame_id = excluded.frame_id`
    ).bind(claims.sub, id).run();
    return ok(request, { equipped: id });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- 프로필 입장 애니메이션 (연출은 kiho-profile.js 의 같은 id 가 그립니다) ---------- */
const INTRO_TIER_DEFS = [
  ['i-spark',  2,  '브론즈 스파크',   '구릿빛 불꽃이 사방으로 튀어요.'],
  ['i-sweep',  3,  '실버 스윕',       '은빛 광선이 카드를 쓸고 지나가요.'],
  ['i-gold',   4,  '골드 샤워',       '금빛 가루가 쏟아져 내려요.'],
  ['i-frost',  5,  '플래티넘 서리',   '얼음 결정이 퍼지며 카드가 맺혀요.'],
  ['i-leaf',   6,  '에메랄드 잎새',   '초록 잎이 소용돌이치며 올라와요.'],
  ['i-prism',  7,  '다이아 프리즘',   '무지갯빛 빛줄기가 번쩍여요.'],
  ['i-nebula', 8,  '마스터 성운',     '보랏빛 성운 속에서 카드가 떠올라요.'],
  ['i-flame',  9,  '그랜드 화염',     '불길이 치솟으며 카드가 나타나요.'],
  ['i-bolt',   10, '챌린저 낙뢰',     '번개가 내리치고 화면이 번쩍여요.'],
  ['i-galaxy', 11, '신화 은하',       '은하가 소용돌이치며 카드로 빨려 들어와요.'],
  ['i-legend', 12, '레전드 강림',     '오로라 빛기둥과 금빛 별이 내려와요.'],
];
const INTRO_CATALOG = [
  { id: 'plain', name: '기본', category: 'basic', desc: '부드럽게 떠오르는 기본 등장 효과예요.', unlock: { type: 'free' } },
  ...INTRO_TIER_DEFS.map(([id, level, name, desc]) => ({ id, name, category: 'tier', desc, unlock: { type: 'tier', level } })),

  { id: 'i-owl',     name: '별똥별 밤',     category: 'tag', desc: '밤하늘에 별똥별이 흐르며 등장해요.',       unlock: { type: 'tag', tag_id: 'q-night-owl' } },
  { id: 'i-sakura',  name: '벚꽃 흩날림',   category: 'tag', desc: '꽃잎이 흩날리며 카드가 열려요.',           unlock: { type: 'tag', tag_id: 'q-marathon' } },
  { id: 'i-glitch',  name: '글리치',        category: 'tag', desc: '화면이 지직거리며 카드가 튀어나와요.',     unlock: { type: 'tag', tag_id: 'q-combo-5' } },
  { id: 'i-matrix',  name: '매트릭스 비',   category: 'tag', desc: '초록 코드가 쏟아지며 카드가 해독돼요.',    unlock: { type: 'tag', tag_id: 'q-stage-3000' } },
  { id: 'i-void',    name: '보이드 흡입',   category: 'tag', desc: '허공으로 빨려 들어갔다가 카드가 솟아요.',  unlock: { type: 'tag', tag_id: 'q-extreme-50' } },
  { id: 'i-rainbow', name: '무지개 아치',   category: 'tag', desc: '색색의 빛이 퍼지며 카드가 나타나요.',      unlock: { type: 'tag', tag_id: 'q-all-diffs' } },
  { id: 'i-speed',   name: '스피드 라인',   category: 'tag', desc: '속도선이 스치고 카드가 순식간에 도착해요.', unlock: { type: 'tag', tag_id: 'q-speed-45' } },
  { id: 'i-ocean',   name: '심해 물결',     category: 'tag', desc: '거품이 올라오며 카드가 떠올라요.',         unlock: { type: 'tag', tag_id: 'q-play-2000' } },
  { id: 'i-pioneer', name: '개척자 별빛',   category: 'tag', desc: '시즌 1 개척자만의 별빛 입장.',             unlock: { type: 'tag', tag_id: 'ltd-s1-pioneer' } },

  { id: 'i-top10',   name: '별 폭죽',       category: 'rank', desc: 'TOP 10 에 들어본 사람의 별 폭죽.',        unlock: { type: 'rank', max: 10 } },
  { id: 'i-podium',  name: '포디움 조명',   category: 'rank', desc: 'TOP 3 에 들어본 사람을 비추는 조명.',     unlock: { type: 'rank', max: 3 } },
  { id: 'i-crown',   name: '왕의 입장',     category: 'rank', desc: '1위를 해본 사람에게 내려오는 황금 왕관과 폭죽.', unlock: { type: 'rank', max: 1 } },

  { id: 'x-aura',    name: 'AURA 강림',     category: 'exclusive', desc: 'AURA 계정만 쓸 수 있는 전용 입장 효과. 관리자도 가질 수 없어요.', unlock: { type: 'exclusive', name: 'AURA' } },
];
function introInfo(id) { return id ? INTRO_CATALOG.find((f) => f.id === id) || null : null; }

async function introEquippedOf(env, userId) {
  const r = await env.DB.prepare('SELECT intro_id FROM user_intro WHERE user_id = ?').bind(userId).first();
  return r && introInfo(r.intro_id) ? r.intro_id : null;
}

/* ---------- GET /api/intros ---------- */
async function handleIntrosGet(request, env) {
  const claims = await requireUser(request, env);
  try {
    await ensureCosmetics(env);
    const ctx = claims ? await bgContext(env, claims) : null;
    const eq = claims ? await introEquippedOf(env, claims.sub) : null;
    const list = INTRO_CATALOG.map((f) => ({
      id: f.id, name: f.name, desc: f.desc, category: f.category, unlock_label: frameUnlockLabel(f),
      owned: ctx ? frameUnlocked(f, ctx) : f.unlock.type === 'free',
    }));
    return ok(request, { authed: !!claims, intros: list, equipped: eq || 'plain' });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/intros/equip  { intro_id } ---------- */
async function handleIntroEquip(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(request, '요청 형식이 올바르지 않습니다.');
  const id = body.intro_id === null || body.intro_id === undefined || body.intro_id === '' ? 'plain' : String(body.intro_id);
  const f = introInfo(id);
  if (!f) return fail(request, '알 수 없는 입장 효과입니다.');
  try {
    await ensureCosmetics(env);
    const ctx = await bgContext(env, claims);
    if (!frameUnlocked(f, ctx))
      return fail(request, f.unlock.type === 'exclusive' ? '이 입장 효과는 전용 계정만 쓸 수 있어요.' : '아직 획득하지 못한 입장 효과예요.', 403);
    if (id === 'plain') await env.DB.prepare('DELETE FROM user_intro WHERE user_id = ?').bind(claims.sub).run();
    else await env.DB.prepare(
      `INSERT INTO user_intro (user_id, intro_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET intro_id = excluded.intro_id`
    ).bind(claims.sub, id).run();
    return ok(request, { equipped: id });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- GET /api/profile?u=아이디  (누구나 조회 — 이메일 등 민감정보는 내려주지 않음) ---------- */
async function handleProfileGet(request, env, url) {
  const name = String(url.searchParams.get('u') || '').trim();
  if (!RE_USERNAME.test(name)) return fail(request, '올바른 아이디가 아니에요.');
  const claims = await requireUser(request, env);

  try {
    await ensureCosmetics(env);
    const user = await env.DB.prepare('SELECT id, username, created_at FROM users WHERE username = ? LIMIT 1').bind(name).first();
    if (!user) return fail(request, '존재하지 않는 사용자예요.', 404);

    const [st, cosRes, placesRes, tagCnt, bgOwn, frRow, inRow] = await Promise.all([
      tagLoadState(env, user.id),
      env.DB.prepare('SELECT bio, bg_id, avatar_v FROM user_cosmetics WHERE user_id = ?').bind(user.id).first(),
      env.DB.prepare(TAG_MY_PLACES_SQL).bind(user.id).all(),
      env.DB.prepare('SELECT COUNT(*) AS c FROM user_tags WHERE user_id = ?').bind(user.id).first(),
      env.DB.prepare('SELECT tag_id FROM user_tags WHERE user_id = ?').bind(user.id).all(),
      env.DB.prepare('SELECT frame_id FROM user_frame WHERE user_id = ?').bind(user.id).first(),
      env.DB.prepare('SELECT intro_id FROM user_intro WHERE user_id = ?').bind(user.id).first(),
    ]);

    const equipped = [1, 2, 3].map((n) => (st.equippedSlots.find((e) => e.slot === n) || {}).tag_id).filter(Boolean).map(tagInfo).filter(Boolean);
    const tier = tagTierOf(st.stages);
    const tags = equipped.length ? equipped : [tagTierBrief(tier)];
    const places = (placesRes.results || [])
      .map((r) => ({ game: r.game, difficulty: r.difficulty, place: Number(r.place), score: r.best_score }))
      .sort((a, b) => a.place - b.place || b.score - a.score)
      .slice(0, 8);

    // 테두리(왕관): 지금 1·2·3위인 판이 하나라도 있으면 해당 왕관, TOP 10 이면 별 테두리
    const topPlace = places.length ? places[0].place : null;
    const autoFrame = topPlace === 1 ? 'crown-gold' : topPlace === 2 ? 'crown-silver' : topPlace === 3 ? 'crown-bronze' : topPlace && topPlace <= 10 ? 'star' : null;
    const chosenFrame = frRow && frameInfo(frRow.frame_id) ? frRow.frame_id : null;
    const frame = chosenFrame || autoFrame;
    const nextTier = TAG_TIERS.find((t) => t.min > st.stages) || null;
    const bgCtx = { stages: st.stages, ownedTags: new Set((bgOwn.results || []).map((r) => r.tag_id)), username: user.username, admin: isAdminName(user.username) };
    const bgOwned = BG_CATALOG.filter((b) => bgUnlocked(b, bgCtx)).length;
    const d = st.byDiff || {};

    return ok(request, {
      profile: {
        username: user.username,
        frame,
        frame_equipped: chosenFrame,
        intro: inRow && introInfo(inRow.intro_id) ? inRow.intro_id : null,
        intro_total: INTRO_CATALOG.length,
        intro_count: INTRO_CATALOG.filter((f) => frameUnlocked(f, Object.assign({ bestPlace: st.bestPlace }, bgCtx))).length,
        frame_total: FRAME_CATALOG.length,
        frame_count: FRAME_CATALOG.filter((f) => frameUnlocked(f, Object.assign({ bestPlace: st.bestPlace }, bgCtx))).length,
        next_tier: nextTier ? { name: nextTier.name, min: nextTier.min, level: nextTier.level } : null,
        tag_count: Number(tagCnt && tagCnt.c) || 0,
        tag_total: TAG_QUESTS.length,
        bg_count: bgOwned,
        bg_total: BG_CATALOG.length,
        diffs: TAG_DIFFS.map((k) => ({ difficulty: k, cleared: (d[k] || {}).cleared || 0, stages: (d[k] || {}).stages || 0, perfect: (d[k] || {}).perfect || 0 })),
        fastest_ms: st.fastestMs,
        joined: user.created_at,
        bio: (cosRes && cosRes.bio) || '',
        avatar: cosRes && cosRes.avatar_v ? Number(cosRes.avatar_v) : null,
        bg: cosRes && bgInfo(cosRes.bg_id) ? cosRes.bg_id : null,
        tags,
        tier: tagTierBrief(tier),
        stats: { stages: st.stages, played: st.played, cleared: st.cleared, perfect: st.perfect, combo: st.combo, best_place: st.bestPlace },
        places,
        is_me: !!claims && claims.sub === user.id,
      },
    });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/profile  { bio } ---------- */
function cleanBio(raw) {
  // 제어문자·방향 전환 문자를 공백으로, 연속 공백은 하나로
  return String(raw).replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function handleProfileUpdate(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || typeof body.bio !== 'string') return fail(request, '한마디를 문자열로 보내 주세요.');
  const bio = cleanBio(body.bio);
  if ([...bio].length > BIO_MAX) return fail(request, `한마디는 ${BIO_MAX}자까지 쓸 수 있어요.`);

  try {
    await ensureCosmetics(env);
    await env.DB.prepare(
      `INSERT INTO user_cosmetics (user_id, bio) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET bio = excluded.bio, updated_at = datetime('now')`
    ).bind(claims.sub, bio).run();
    return ok(request, { bio });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/profile/avatar  { image: 'data:image/jpeg;base64,...' } | { remove: true } ---------- */
function sniffImage(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

async function handleAvatarUpdate(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);
  const raw = await request.text();
  if (raw.length > AVATAR_MAX_BYTES * 2) return fail(request, '사진 용량이 너무 커요.', 413);
  let body = null; try { body = JSON.parse(raw); } catch (e) { /* 아래에서 처리 */ }
  if (!body || typeof body !== 'object') return fail(request, '요청 형식이 올바르지 않습니다.');

  try {
    await ensureCosmetics(env);
    if (body.remove === true) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM user_avatars WHERE user_id = ?').bind(claims.sub),
        env.DB.prepare(`UPDATE user_cosmetics SET avatar_v = 0, updated_at = datetime('now') WHERE user_id = ?`).bind(claims.sub),
      ]);
      return ok(request, { avatar: null });
    }

    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(body.image || ''));
    if (!m) return fail(request, 'JPG·PNG·WEBP 사진만 올릴 수 있어요.');
    let bytes;
    try { bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); } catch (e) { return fail(request, '사진 데이터가 올바르지 않아요.'); }
    if (bytes.length > AVATAR_MAX_BYTES) return fail(request, '사진 용량이 너무 커요. (최대 60KB — 올리면 자동으로 줄여 줘요)', 413);
    const mime = sniffImage(bytes);
    if (!mime) return fail(request, '올바른 사진 파일이 아니에요.');

    const v = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_avatars (user_id, mime, b64) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, b64 = excluded.b64`
      ).bind(claims.sub, mime, m[1]),
      env.DB.prepare(
        `INSERT INTO user_cosmetics (user_id, avatar_v) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET avatar_v = excluded.avatar_v, updated_at = datetime('now')`
      ).bind(claims.sub, v),
    ]);
    return ok(request, { avatar: v });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- GET /api/avatar?u=아이디&v=버전  (이미지 바이트) ---------- */
async function handleAvatarGet(request, env, url) {
  const name = String(url.searchParams.get('u') || '').trim();
  if (!RE_USERNAME.test(name)) return fail(request, '올바른 아이디가 아니에요.', 404);
  try {
    await ensureCosmetics(env);
    const row = await env.DB
      .prepare('SELECT a.mime AS mime, a.b64 AS b64 FROM users u JOIN user_avatars a ON a.user_id = u.id WHERE u.username = ? LIMIT 1')
      .bind(name).first();
    if (!row) return fail(request, '프로필 사진이 없어요.', 404);
    const bytes = Uint8Array.from(atob(row.b64), (c) => c.charCodeAt(0));
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': row.mime,
        'Cache-Control': url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        ...corsHeaders(request),
      },
    });
  } catch (err) {
    return tagDbError(request, err);
  }
}

/* ---------- POST /api/password  { current_password, new_password } ---------- */
async function handlePasswordChange(request, env) {
  const claims = await requireUser(request, env);
  if (!claims) return fail(request, '로그인이 필요합니다.', 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail(request, '요청 형식이 올바르지 않습니다.');
  const current = String(body.current_password || '');
  const next = body.new_password;

  if (!current) return fail(request, '현재 비밀번호를 입력해 주세요.');
  if (current.length >= PASSWORD_MAX_EXCLUSIVE) return fail(request, '현재 비밀번호가 올바르지 않습니다.', 403);
  const problem = passwordProblem(next);
  if (problem) return fail(request, problem);
  if (next === current) return fail(request, '새 비밀번호가 현재 비밀번호와 같아요.');

  const row = await env.DB.prepare('SELECT id, password_hash FROM users WHERE id = ? LIMIT 1').bind(claims.sub).first();
  if (!row) return fail(request, '계정을 찾을 수 없습니다.', 404);
  const check = await verifyPassword(current, row.password_hash);
  // 401 이 아니라 403 — 클라이언트가 401 을 "세션 만료"로 오해해 로그아웃하지 않도록
  if (!check.valid) return fail(request, '현재 비밀번호가 올바르지 않습니다.', 403);

  const hash = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, row.id).run();
  return ok(request, { message: '비밀번호를 바꿨어요.' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // '/api/login/' 처럼 끝에 슬래시가 붙어도 같은 경로로 처리합니다.
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: corsHeaders(request) });

    try {
      if (path === '/api/register' && request.method === 'POST')
        return await handleRegister(request, env);

      if (path === '/api/login' && request.method === 'POST')
        return await handleLogin(request, env);

      if (path === '/api/me' && request.method === 'GET')
        return await handleMe(request, env);

      if (path === '/api/score' && request.method === 'POST')
        return await handleScore(request, env);

      if (path === '/api/leaderboard' && request.method === 'GET')
        return await handleLeaderboard(request, env, url);


      /* ---------- 랭킹 (D1, 유저×게임×난이도별 최고 기록) ---------- */
      if (path === '/api/rankings' && request.method === 'GET')
        return await handleRankingsGet(request, env, url);

      if (path === '/api/rankings' && request.method === 'POST')
        return await handleRankingsSubmit(request, env);

      /* ---------- 등급 · 태그 · 퀘스트 · TOP 100 보드 ---------- */
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

      /* ---------- 프로필 · 사진 · 배경 · 비밀번호 ---------- */
      if (path === '/api/profile' && request.method === 'GET')
        return await handleProfileGet(request, env, url);

      if (path === '/api/profile' && request.method === 'POST')
        return await handleProfileUpdate(request, env);

      if (path === '/api/profile/avatar' && request.method === 'POST')
        return await handleAvatarUpdate(request, env);

      if (path === '/api/avatar' && request.method === 'GET')
        return await handleAvatarGet(request, env, url);

      if (path === '/api/backgrounds' && request.method === 'GET')
        return await handleBackgroundsGet(request, env);

      if (path === '/api/backgrounds/equip' && request.method === 'POST')
        return await handleBackgroundEquip(request, env);

      if (path === '/api/frames' && request.method === 'GET')
        return await handleFramesGet(request, env);

      if (path === '/api/frames/equip' && request.method === 'POST')
        return await handleFrameEquip(request, env);

      if (path === '/api/intros' && request.method === 'GET')
        return await handleIntrosGet(request, env);

      if (path === '/api/intros/equip' && request.method === 'POST')
        return await handleIntroEquip(request, env);

      if (path === '/api/password' && request.method === 'POST')
        return await handlePasswordChange(request, env);

      if (path === '/api/health')
        return ok(request, {
          status: 'up',
          version: WORKER_VERSION,
          time: new Date().toISOString(),
          // 값 자체는 노출하지 않고, 필요한 바인딩/시크릿이 잡혀 있는지만 알려줍니다.
          bindings: {
            DB: !!env.DB,
            JWT_SECRET: !!env.JWT_SECRET,
            SUPABASE_URL: !!env.SUPABASE_URL,
            SUPABASE_SERVICE_KEY: !!env.SUPABASE_SERVICE_KEY,
            TURNSTILE_SECRET: !!env.TURNSTILE_SECRET, // true 면 로그인/가입에 캡차 토큰이 필수
          },
        });

      return fail(request, `요청한 경로를 찾을 수 없습니다. (${request.method} ${path})`, 404);
    } catch (err) {
      console.error('unhandled error', err && err.message);
      return fail(request, '서버 처리 중 오류가 발생했습니다.', 500);
    }
  },
};
