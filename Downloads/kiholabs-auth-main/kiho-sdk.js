/* ==================================================================
   Kiho Labs — 공용 세션 / 리더보드 SDK  (kiho-sdk.js)

   ★ 반드시 login.html · games.html · 각 게임 페이지와 "같은 폴더"에 올려 주세요.
     페이지에서는 상대경로로 불러옵니다:  <script src="kiho-sdk.js"></script>
     (경로가 틀리면 404 → "Kiho is not defined" 오류가 납니다.)

   window.Kiho
     .login(token, user, remember)   로그인 성공 시 세션 저장
                                     remember=true  → localStorage (브라우저를 껐다 켜도 유지 = 자동 로그인)
                                     remember=false → sessionStorage (탭을 닫으면 사라짐)
     .startGuest()                   게스트 세션 시작
     .logout()                       세션 삭제 (자동 로그인 해제)
     .user() / .isMember() / .isGuest() / .displayName()
     .remembered()                   자동 로그인이 켜진 상태인지
     .verify()                       저장된 토큰이 아직 유효한지 서버에 확인 → Promise<user|null>
     .submitScore(payload)           회원만 서버 전송, 게스트면 { blocked:true }
     .leaderboard(game, limit)
     .pendingScore() / .clearPending()
================================================================== */
(function (global) {
  'use strict';

   var CONFIG = {
     API_BASE: 'https://api.kiholabs.com',
     LOGIN_PAGE: 'login.html',
     HUB_PAGE: 'games.html',
     TIMEOUT_MS: 15000
   };

  var KEY_TOKEN = 'kiho.token';
  var KEY_USER = 'kiho.user';
  var KEY_GUEST = 'kiho.guest';
  var KEY_PENDING = 'kiho.pendingScore';
  var KEY_REMEMBER = 'kiho.remember';   // '1' 이면 자동 로그인 사용 중

  /* ---------- 저장소 (시크릿 모드 등에서 막히면 메모리로 대체) ---------- */
  function probe(storage) {
    try {
      storage.setItem('__kiho__', '1');
      storage.removeItem('__kiho__');
      return storage;
    } catch (e) { return null; }
  }
  var LOCAL = probe(global.localStorage);
  var SESSION = probe(global.sessionStorage);
  var memory = {};

  function readFrom(storage, key) {
    if (storage) return storage.getItem(key);
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }
  /* 값은 두 저장소 어디에 있든 찾아 읽습니다(자동 로그인 여부와 무관하게 복원). */
  function get(key) {
    var v = readFrom(LOCAL, key);
    if (v === null || v === undefined) v = readFrom(SESSION, key);
    if (v === null || v === undefined) v = Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    return v;
  }
  function set(key, val, persistent) {
    var target = persistent ? LOCAL : SESSION;
    if (target) target.setItem(key, val); else memory[key] = val;
    // 반대편 저장소에 남은 옛 값 제거
    var other = persistent ? SESSION : LOCAL;
    if (other) other.removeItem(key);
  }
  function del(key) {
    if (LOCAL) LOCAL.removeItem(key);
    if (SESSION) SESSION.removeItem(key);
    delete memory[key];
  }
  function parse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

  /* ---------- 토큰 ---------- */
  function decode(token) {
    try {
      var body = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(body + '='.repeat((4 - body.length % 4) % 4)));
    } catch (e) { return null; }
  }

  function token() {
    var t = get(KEY_TOKEN);
    if (!t) return null;
    var payload = decode(t);
    if (payload && payload.exp && payload.exp * 1000 <= Date.now()) { logout(); return null; }
    return t;
  }

  /** 토큰 만료까지 남은 시간(ms). 자동 로그인 안내 문구에 쓸 수 있습니다. */
  function expiresIn() {
    var payload = decode(get(KEY_TOKEN) || '');
    return payload && payload.exp ? Math.max(0, payload.exp * 1000 - Date.now()) : 0;
  }

  /* ---------- 세션 ---------- */
  function user() { return parse(get(KEY_USER)); }
  function isMember() { return !!token() && !!user(); }
  function isGuest() { return !isMember() && get(KEY_GUEST) === '1'; }
  function remembered() { return get(KEY_REMEMBER) === '1'; }

  function login(newToken, newUser, remember) {
    var persistent = remember !== false;           // 기본값: 자동 로그인 사용
    del(KEY_TOKEN); del(KEY_USER); del(KEY_GUEST); del(KEY_REMEMBER);
    set(KEY_TOKEN, newToken || '', persistent);
    set(KEY_USER, JSON.stringify(newUser || {}), persistent);
    if (persistent && LOCAL) LOCAL.setItem(KEY_REMEMBER, '1');
    emit({ mode: 'member', user: newUser, remember: persistent });
  }

  function startGuest() {
    del(KEY_TOKEN); del(KEY_USER); del(KEY_REMEMBER);
    set(KEY_GUEST, '1', false);
    emit({ mode: 'guest' });
  }

  function logout() {
    del(KEY_TOKEN); del(KEY_USER); del(KEY_GUEST); del(KEY_REMEMBER);
    emit({ mode: 'none' });
  }

  function emit(detail) {
    try { global.dispatchEvent(new CustomEvent('kiho:session', { detail: detail })); } catch (e) {}
  }

  function displayName() {
    var u = user();
    if (u && (u.nickname || u.username)) return u.nickname || u.username;
    return isGuest() ? '게스트' : '';
  }

  function requireGameAccess() {
    if (isMember() || isGuest()) return true;
    location.replace(CONFIG.LOGIN_PAGE + '?next=' + encodeURIComponent(location.pathname));
    return false;
  }

  /* ---------- HTTP ---------- */
  function request(path, options) {
    options = options || {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);
    var headers = { 'Accept': 'application/json' };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.auth) {
      var t = token();
      if (t) headers['Authorization'] = 'Bearer ' + t;
    }
    return fetch(String(CONFIG.API_BASE).replace(/\/$/, '') + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: ctrl.signal
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { status: res.status, ok: res.ok && !!data && data.success === true, data: data };
      });
    }).finally(function () { clearTimeout(timer); });
  }

  /**
   * 자동 로그인 검증: 저장된 토큰으로 /api/me 를 호출합니다.
   *  - 유효하면 최신 사용자 정보로 갱신하고 user 객체를 돌려줍니다.
   *  - 만료/삭제된 계정이면 세션을 비우고 null 을 돌려줍니다.
   *  - 네트워크 오류면 세션을 지우지 않고 저장된 user 를 그대로 돌려줍니다(오프라인 배려).
   */
  function verify() {
    if (!token()) return Promise.resolve(null);
    return request('/api/me', { auth: true })
      .then(function (r) {
        if (r.ok && r.data && r.data.user) {
          var persistent = remembered();
          set(KEY_USER, JSON.stringify(r.data.user), persistent);
          return r.data.user;
        }
        if (r.status === 401 || r.status === 404) { logout(); return null; }
        return user();
      })
      .catch(function () { return user(); });
  }

  /* ---------- 점수 ---------- */
  function submitScore(payload) {
    payload = payload || {};
    if (!isMember()) {
      set(KEY_PENDING, JSON.stringify({ at: Date.now(), payload: payload }), true);
      return Promise.resolve({ blocked: true, reason: 'guest' });
    }
    return request('/api/score', { method: 'POST', auth: true, body: payload })
      .then(function (r) {
        if (r.ok) { del(KEY_PENDING); return { ok: true, rank: r.data.rank, top: r.data.top || [] }; }
        if (r.status === 401) { logout(); return { ok: false, error: '로그인이 만료되었어요. 다시 로그인해 주세요.' }; }
        return { ok: false, error: (r.data && r.data.error) || '점수를 등록하지 못했어요.' };
      })
      .catch(function () { return { ok: false, error: '서버에 연결하지 못했어요.' }; });
  }

  function leaderboard(game, limit) {
    return request('/api/leaderboard?game=' + encodeURIComponent(game) + '&limit=' + (limit || 10))
      .then(function (r) { return r.ok ? (r.data.top || []) : []; })
      .catch(function () { return []; });
  }

  function pendingScore() { return parse(get(KEY_PENDING)); }
  function clearPending() { del(KEY_PENDING); }

  global.Kiho = {
    CONFIG: CONFIG,
    login: login, startGuest: startGuest, logout: logout,
    token: token, expiresIn: expiresIn,
    user: user, displayName: displayName,
    isMember: isMember, isGuest: isGuest, remembered: remembered,
    verify: verify, requireGameAccess: requireGameAccess,
    submitScore: submitScore, leaderboard: leaderboard,
    pendingScore: pendingScore, clearPending: clearPending
  };
})(window);
