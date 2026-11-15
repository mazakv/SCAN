/* ==================================================================
   kiho-nav.js — 빠른 이동(커맨드 팔레트)
   · Ctrl+K / ⌘K / "/" 키, 또는 왼쪽 아래 ⌘ 버튼으로 열기
   · 게임 바로 시작(난이도 지정) · 리더보드(난이도별) · 도감 · 내 프로필 · 사용자 검색
   · "이어하기": 마지막으로 한 게임을 마지막 난이도로 바로 열기
   · 한글 초성 검색 지원 (예: ㅁㄹㅂ → 미러 빔 랩)
   어떤 페이지에서든 <script src="kiho-nav.js" defer></script> 한 줄이면 동작합니다.
================================================================== */
(function (global) {
  'use strict';
  if (global.KihoNav) return;

  var GAMES = [
    { id: 'number-forge',    code: 'nf', name: '넘버 포지',     file: 'number-forge.html',    kw: 'number forge 숫자 계산' },
    { id: 'pixel-detective', code: 'pd', name: '픽셀 탐정',     file: 'pixel-detective.html', kw: 'pixel detective 노노그램 퍼즐' },
    { id: 'mirror-beam',     code: 'mb', name: '미러 빔 랩',    file: 'mirror-beam.html',     kw: 'mirror beam 거울 광선 레이저' },
    { id: 'code-breaker',    code: 'cb', name: '코드 브레이커', file: 'code-breaker.html',    kw: 'code breaker 암호 추리' },
    { id: 'memory-grid',     code: 'mg', name: '메모리 그리드', file: 'memory-grid.html',     kw: 'memory grid 기억 순서' },
    { id: 'light-switch',    code: 'ls', name: '라이트 스위치', file: 'light-switch.html',    kw: 'light switch 불 끄기' },
    { id: 'color-flood',     code: 'cf', name: '컬러 플러드',   file: 'color-flood.html',     kw: 'color flood 색 채우기 플러드' }
  ];
  var DIFFS = [['easy', 'Easy', '쉬움'], ['normal', 'Normal', '보통'], ['hard', 'Hard', '어려움'], ['extreme', 'Extreme', '극한']];
  var PAGES = [
    { name: '게임 목록 (메인)', file: 'games.html', kw: 'home main 메인 홈 게임' },
    { name: '리더보드', file: 'leaderboard.html', kw: 'leaderboard ranking 랭킹 순위' },
    { name: '내 등급 · 티어', file: 'leaderboard.html?tab=tier', kw: 'tier 등급 티어' },
    { name: '내 태그 (장착)', file: 'tags.html', kw: 'tags 태그 칭호 장착' },
    { name: '태그 도감', file: 'codex.html?type=tag', kw: 'codex 도감 태그' },
    { name: '배경 도감', file: 'codex.html?type=bg', kw: 'codex 도감 배경 background' },
    { name: '테두리 도감', file: 'codex.html?type=frame', kw: 'codex 도감 테두리 frame' },
    { name: '입장 효과 도감', file: 'codex.html?type=intro', kw: 'codex 도감 입장 효과 애니메이션 intro' }
  ];

  var LS_RECENT = 'kiho.nav.recent', LS_LAST = 'kiho.nav.last';
  function sget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function parse(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }

  /* ---------- 방문 기록 ---------- */
  var here = (location.pathname.split('/').pop() || '').replace(/\.html$/, '') || 'index';
  function gameByFile(f) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].file === f + '.html' || GAMES[i].id === f) return GAMES[i]; return null; }
  (function record() {
    var g = gameByFile(here);
    if (g) sset(LS_LAST, JSON.stringify({ id: g.id, t: Date.now() }));
    var title = g ? g.name : (PAGES.filter(function (p) { return p.file.replace(/\?.*/, '') === here + '.html'; })[0] || {}).name;
    if (!title) return;
    var list = parse(sget(LS_RECENT), []).filter(function (r) { return r.file !== here + '.html'; });
    list.unshift({ file: here + '.html', name: title, t: Date.now() });
    sset(LS_RECENT, JSON.stringify(list.slice(0, 6)));
  })();

  /* ---------- 한글 초성 ---------- */
  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  function cho(s) {
    var o = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      o += (c >= 0xAC00 && c <= 0xD7A3) ? CHO.charAt(Math.floor((c - 0xAC00) / 588)) : s.charAt(i);
    }
    return o;
  }
  var ONLY_CHO = /^[ㄱ-ㅎ\s]+$/;
  function matches(item, q) {
    if (!q) return true;
    var hay = (item.label + ' ' + (item.kw || '')).toLowerCase();
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.every(function (w) {
      if (hay.indexOf(w) !== -1) return true;
      return ONLY_CHO.test(w) && cho(item.label).replace(/\s/g, '').indexOf(w) !== -1;
    });
  }

  /* ---------- 항목 만들기 ---------- */
  function member() { return !!(global.Kiho && global.Kiho.isMember && global.Kiho.isMember()); }
  function go(url) { location.assign(url); }
  function lastDiff(g) { var d = sget('kiho.' + g.code + '.difficulty'); return DIFFS.filter(function (x) { return x[0] === d; })[0] ? d : 'normal'; }
  function diffName(k) { return DIFFS.filter(function (x) { return x[0] === k; })[0][1]; }
  function playUrl(g, diff) { if (diff) sset('kiho.' + g.code + '.difficulty', diff); return g.file; }

  function buildItems(q) {
    var out = [], me = member();
    var last = parse(sget(LS_LAST), null), lg = last && GAMES.filter(function (g) { return g.id === last.id; })[0];
    if (lg && here !== lg.id) out.push({ group: '이어하기', icon: '▶', label: lg.name + ' 이어하기', hint: diffName(lastDiff(lg)), kw: 'continue resume 계속 이어', run: function () { go(playUrl(lg)); } });

    GAMES.forEach(function (g) {
      out.push({ group: '게임 시작', icon: '🎮', label: g.name, hint: diffName(lastDiff(g)) + ' · 마지막 난이도', kw: g.kw + ' play 플레이 시작', run: function () { go(playUrl(g)); } });
      DIFFS.forEach(function (d) {
        out.push({ group: '게임 시작', icon: '🎮', label: g.name + ' · ' + d[1], hint: d[2], kw: g.kw + ' ' + d[2] + ' ' + d[1] + ' play 시작', run: function () { go(playUrl(g, d[0])); } });
      });
    });
    GAMES.forEach(function (g) {
      out.push({ group: '리더보드', icon: '🏆', label: g.name + ' 리더보드', hint: '', kw: g.kw + ' leaderboard 랭킹 순위', run: function () { go('leaderboard.html?game=' + g.id + '&difficulty=' + lastDiff(g)); } });
      DIFFS.forEach(function (d) {
        out.push({ group: '리더보드', icon: '🏆', label: g.name + ' 리더보드 · ' + d[1], hint: d[2], kw: g.kw + ' ' + d[2] + ' leaderboard 랭킹 순위', run: function () { go('leaderboard.html?game=' + g.id + '&difficulty=' + d[0]); } });
      });
    });
    if (me) out.push({ group: '페이지', icon: '👤', label: '내 프로필 편집', hint: '사진·배경·테두리·입장 효과', kw: 'profile 프로필 계정 내 정보 비밀번호', run: function () { go('profile.html'); } });
    PAGES.forEach(function (p) { out.push({ group: '페이지', icon: '📄', label: p.name, hint: '', kw: p.kw, run: function () { go(p.file); } }); });
    out.push(me
      ? { group: '계정', icon: '🚪', label: '로그아웃', hint: '', kw: 'logout 로그아웃', run: function () { global.Kiho.logout(); go('login.html'); } }
      : { group: '계정', icon: '🔑', label: '로그인', hint: '', kw: 'login 로그인 가입', run: function () { go('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || 'games.html')); } });

    var filtered = out.filter(function (it) { return matches(it, q); });

    var name = q.replace(/^@/, '').trim();
    if (/^[A-Za-z0-9_]{4,20}$/.test(name)) filtered.unshift({ group: '사용자', icon: '🔎', label: name + ' 프로필 보기', hint: '아이디로 찾기', run: function () { openProfile(name); }, keep: true });

    if (!q) {   // 검색어가 없으면 최근 방문 + 자주 쓰는 것만
      var recent = parse(sget(LS_RECENT), []).filter(function (r) { return r.file !== here + '.html'; }).slice(0, 4).map(function (r) {
        return { group: '최근 방문', icon: '🕘', label: r.name, hint: '', run: function () { go(r.file); } };
      });
      var base = filtered.filter(function (it) { return it.group === '이어하기' || (it.group === '게임 시작' && it.label.indexOf('·') === -1) || (it.group === '페이지' && /프로필|게임 목록|리더보드/.test(it.label)); });
      return recent.concat(base.filter(function (it) { return it.group === '이어하기'; }), base.filter(function (it) { return it.group !== '이어하기'; }));
    }
    return filtered.slice(0, 40);
  }

  function openProfile(name) {
    close();
    function show() { if (global.KihoProfile) global.KihoProfile.open(name); }
    if (global.KihoProfile) { show(); return; }
    var s = document.createElement('script'); s.src = 'kiho-profile.js'; s.onload = show;
    s.onerror = function () { go('leaderboard.html'); };
    document.head.appendChild(s);
  }

  /* ---------- UI ---------- */
  var CSS = [
    '.kn-fab{position:fixed;left:12px;bottom:12px;z-index:2147481000;min-width:40px;height:34px;padding:0 11px;border:0;border-radius:999px;cursor:pointer;',
    'font:700 12px/1 system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif;color:#dff8f4;background:rgba(10,42,60,.78);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 8px 20px -8px rgba(0,0,0,.6);',
    '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:.62;transition:opacity .15s,transform .15s}',
    '.kn-fab:hover,.kn-fab:focus-visible{opacity:1;transform:translateY(-1px);outline:2px solid #6FF2E0;outline-offset:2px}',
    '.kn-root{position:fixed;inset:0;z-index:2147483000;display:flex;justify-content:center;align-items:flex-start;padding:min(12vh,90px) 14px 14px;background:rgba(3,14,22,.66);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);animation:kn-in .14s ease-out}',
    '@keyframes kn-in{from{opacity:0}to{opacity:1}}',
    '.kn-panel{width:min(560px,100%);max-height:min(72vh,620px);display:flex;flex-direction:column;border-radius:22px;overflow:hidden;color:#F2F8FB;background:linear-gradient(170deg,#12394e,#0a2a3c 70%);',
    'box-shadow:0 40px 80px -20px rgba(0,0,0,.7),inset 0 0 0 1px rgba(255,255,255,.16);font-family:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;animation:kn-pop .18s cubic-bezier(.3,.9,.3,1.1)}',
    '@keyframes kn-pop{from{transform:translateY(-10px) scale(.98);opacity:0}to{transform:none;opacity:1}}',
    '.kn-in{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.12)}',
    '.kn-in span{font-size:18px;opacity:.8}',
    '.kn-in input{flex:1;min-width:0;border:0;outline:0;background:none;color:inherit;font:600 16px/1.2 inherit}',
    '.kn-in input::placeholder{color:#8FAAB8}',
    '.kn-in kbd,.kn-foot kbd{padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.12);font:700 11px/1.3 system-ui;color:#B9CDD8}',
    '.kn-list{overflow:auto;padding:6px 8px 8px;margin:0;list-style:none;overscroll-behavior:contain}',
    '.kn-grp{padding:10px 10px 4px;font-size:11.5px;font-weight:800;letter-spacing:.04em;color:#8FAAB8}',
    '.kn-it{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;cursor:pointer}',
    '.kn-it[aria-selected="true"]{background:rgba(111,242,224,.16);box-shadow:inset 0 0 0 1px rgba(111,242,224,.45)}',
    '.kn-ic{flex:none;width:24px;text-align:center;font-size:16px}',
    '.kn-lb{flex:1;min-width:0;font-size:14.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.kn-ht{flex:none;font-size:12px;color:#8FAAB8}',
    '.kn-empty{padding:26px 16px;text-align:center;color:#8FAAB8;font-size:14px}',
    '.kn-foot{display:flex;gap:14px;flex-wrap:wrap;padding:9px 16px;border-top:1px solid rgba(255,255,255,.1);font-size:11.5px;color:#8FAAB8}',
    '@media (prefers-reduced-motion:reduce){.kn-root,.kn-panel{animation:none}}'
  ].join('');

  var rootEl = null, listEl = null, inputEl = null, items = [], sel = 0, prevFocus = null;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function render() {
    items = buildItems(inputEl.value.trim());
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    listEl.textContent = '';
    if (!items.length) { listEl.appendChild(el('li', 'kn-empty', '찾는 결과가 없어요. 게임 이름, 난이도, 페이지 이름이나 아이디(4자 이상)를 입력해 보세요.')); return; }
    var lastGroup = null;
    items.forEach(function (it, i) {
      if (it.group !== lastGroup) { lastGroup = it.group; var g = el('li', 'kn-grp', it.group); g.setAttribute('role', 'presentation'); listEl.appendChild(g); }
      var li = el('li', 'kn-it'); li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === sel)); li.id = 'kn-opt-' + i;
      li.appendChild(el('span', 'kn-ic', it.icon)); li.appendChild(el('span', 'kn-lb', it.label)); if (it.hint) li.appendChild(el('span', 'kn-ht', it.hint));
      li.addEventListener('mousemove', function () { if (sel !== i) { sel = i; mark(); } });
      li.addEventListener('click', function () { choose(i); });
      listEl.appendChild(li);
    });
    inputEl.setAttribute('aria-activedescendant', 'kn-opt-' + sel);
  }

  function mark() {
    var nodes = listEl.querySelectorAll('.kn-it');
    for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute('aria-selected', String(i === sel));
    var cur = nodes[sel]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    inputEl.setAttribute('aria-activedescendant', 'kn-opt-' + sel);
  }

  function choose(i) { var it = items[i]; if (!it) return; try { it.run(); } catch (e) { close(); } }

  function open() {
    if (rootEl) { inputEl.focus(); return; }
    prevFocus = document.activeElement;
    rootEl = el('div', 'kn-root');
    var panel = el('div', 'kn-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', '빠른 이동');
    var row = el('div', 'kn-in'); row.appendChild(el('span', '', '⌘'));
    inputEl = el('input'); inputEl.type = 'text'; inputEl.placeholder = '게임 · 난이도 · 페이지 · 아이디 검색  (예: ㅁㄹㅂ, hard, 리더보드)';
    inputEl.setAttribute('role', 'combobox'); inputEl.setAttribute('aria-expanded', 'true'); inputEl.setAttribute('aria-controls', 'kn-list'); inputEl.setAttribute('aria-label', '빠른 이동 검색');
    inputEl.autocomplete = 'off'; inputEl.spellcheck = false; row.appendChild(inputEl); row.appendChild(el('kbd', '', 'Esc'));
    listEl = el('ul', 'kn-list'); listEl.id = 'kn-list'; listEl.setAttribute('role', 'listbox');
    var foot = el('div', 'kn-foot');
    [['↑↓', '이동'], ['Enter', '열기'], ['Esc', '닫기'], ['Ctrl+K', '언제든 열기']].forEach(function (k) { var s = el('span'); s.appendChild(el('kbd', '', k[0])); s.appendChild(document.createTextNode(' ' + k[1])); foot.appendChild(s); });
    panel.appendChild(row); panel.appendChild(listEl); panel.appendChild(foot); rootEl.appendChild(panel);
    rootEl.addEventListener('mousedown', function (e) { if (e.target === rootEl) close(); });
    inputEl.addEventListener('input', function () { sel = 0; render(); });
    inputEl.addEventListener('keydown', function (e) {
      e.stopPropagation();   // 게임의 단축키(숫자키 등)가 검색 입력에 반응하지 않게
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { sel = (sel + 1) % items.length; mark(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel - 1 + items.length) % items.length; mark(); } }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    sel = 0; render();
    document.body.appendChild(rootEl);
    inputEl.focus();
  }

  function close() {
    if (!rootEl) return;
    if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    rootEl = null; listEl = null; inputEl = null;
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
  }

  function typing(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); rootEl ? close() : open(); return; }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !rootEl && !typing(e.target) && !document.querySelector('.kp-modal')) { e.preventDefault(); open(); }
  }, true);

  function init() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var fab = el('button', 'kn-fab', '⌘ 빠른 이동'); fab.type = 'button'; fab.setAttribute('aria-label', '빠른 이동 열기 (Ctrl+K)'); fab.title = '빠른 이동 (Ctrl+K 또는 /)';
    fab.addEventListener('click', open); document.body.appendChild(fab);
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);

  global.KihoNav = { open: open, close: close, GAMES: GAMES };
})(window);
