/* ==================================================================
   Kiho Labs — 관리자 태그 (kiho-badge.js)

   계정 이름(username)이 정확히 `admin` 또는 `kiho` 일 때만
   이름 옆에 반짝이는 [ADMIN] 태그를 붙입니다.

   ★ 다른 페이지와 "같은 폴더"에 올려 주세요.  <script src="kiho-badge.js"></script>
     (이 파일이 없어도 각 페이지는 이름만 평범하게 보여 주도록 만들어져 있어요.)

   사용법
     KihoBadge.render(element, username)                          →  kiho [ADMIN]
     KihoBadge.render(element, username, {suffix:'님'})           →  kiho님 [ADMIN]
     KihoBadge.render(element, username, {tag: 서버가 준 태그})   →  kiho [ADMIN] [챔피언]
     KihoBadge.tagPill(tag, {size:'lg'})                          →  등급/퀘스트/한정판/시즌 태그 요소
     KihoBadge.isAdmin(username)                                  →  true / false
     KihoBadge.isAura(username)                                   →  true / false

   tag = { id, kind, name, style }  ← Worker(/api/board, /api/tags/me)가 내려주는 값 그대로 넣으면 됩니다.
   style: tier-1~10 | quest-common/rare/epic | limited-a/b/c | season-1/2/3

   · 계정 이름이 정확히 `AURA` 일 때만, 다른 어떤 배지와도 모양이 다른 전용 글리치 칭호가
     하나 더 붙습니다(등급/퀘스트 태그와 다른 각진 모양, RGB 색수차 글리치, 시프팅 오로라 글로우).
     이 칭호는 서버 태그 시스템과 무관한 클라이언트 전용 특전이라, 다른 계정은 흉내 낼 수 없습니다.

   · 이름은 textContent 로만 넣기 때문에 특수문자가 들어 있어도 안전합니다(XSS 방지).
   · 대소문자까지 정확히 일치해야 합니다. `Admin`, `KIHO` 는 태그가 붙지 않아요.
   · CSS 는 이 파일이 스스로 <style> 로 주입합니다(별도 CSS 파일 불필요).
   · '동작 줄이기(prefers-reduced-motion)' 설정을 켠 사용자에겐 애니메이션을 끕니다.
================================================================== */
(function (global) {
  'use strict';

  var ADMIN_NAMES = ['admin', 'kiho'];
  var AURA_NAME = 'AURA';
  var STYLE_ID = 'kb-style';

  var CSS = [
    '.kb-name{display:inline-flex;align-items:center;flex-wrap:wrap;gap:0 .5em;max-width:100%;vertical-align:middle}',
    '.kb-name__text{min-width:0;overflow-wrap:anywhere}',

    /* [ADMIN] 태그 본체: 금색 그라데이션 + 맥동하는 글로우 */
    '.kb-admin{position:relative;display:inline-block;flex:none;isolation:isolate;overflow:hidden;',
    'padding:.14em .58em .16em;border-radius:.45em;',
    'font:800 .72em/1.25 "Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;',
    'letter-spacing:.16em;white-space:nowrap;user-select:none;color:#2b1a00;',
    'text-shadow:0 1px 0 rgba(255,255,255,.55);',
    'background:linear-gradient(115deg,#ff9d2e 0%,#ffc94d 32%,#ffefb0 50%,#ffc94d 68%,#ff9d2e 100%);',
    'box-shadow:0 0 0 1px rgba(255,238,170,.8) inset,0 0 8px rgba(255,190,70,.7),0 0 18px rgba(255,150,30,.4);',
    'animation:kb-pulse 1.8s ease-in-out infinite}',

    /* 왼쪽→오른쪽으로 훑고 지나가는 빛 */
    '.kb-admin::before{content:"";position:absolute;top:-45%;bottom:-45%;left:-60%;width:38%;',
    'background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.9),rgba(255,255,255,0));',
    'transform:skewX(-20deg);animation:kb-sweep 2.8s ease-in-out infinite;pointer-events:none}',

    /* 모서리에서 깜빡이는 반짝임 */
    '.kb-admin::after{content:"\\2726";position:absolute;right:.2em;top:-.02em;font-size:.55em;color:#fff;',
    'opacity:0;animation:kb-twinkle 2.8s ease-in-out infinite;pointer-events:none}',

    '@keyframes kb-pulse{0%,100%{box-shadow:0 0 0 1px rgba(255,238,170,.8) inset,0 0 6px rgba(255,190,70,.55),0 0 14px rgba(255,150,30,.28)}',
    '50%{box-shadow:0 0 0 1px rgba(255,246,200,.95) inset,0 0 12px rgba(255,200,80,.95),0 0 26px rgba(255,160,40,.6)}}',
    '@keyframes kb-sweep{0%{left:-60%}55%,100%{left:135%}}',
    '@keyframes kb-twinkle{0%,58%,100%{opacity:0;transform:scale(.4) rotate(0)}',
    '70%{opacity:1;transform:scale(1) rotate(45deg)}84%{opacity:0;transform:scale(.5) rotate(90deg)}}',

    /* ================= AURA 전용 칭호 — 각진 글리치 배지 (다른 어떤 배지와도 모양이 다름) ================= */
    '.kb-aura{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer;',
    'isolation:isolate;overflow:hidden;margin:0 .12em;padding:.3em 1.25em .32em 1.05em;',
    'font:900 .76em/1.15 "Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;',
    'letter-spacing:.38em;text-transform:uppercase;white-space:nowrap;user-select:none;color:#fff;',
    'clip-path:polygon(0% 0%,92% 0%,100% 30%,100% 100%,8% 100%,0% 70%);',       /* 양 끝이 사선으로 깎인 사이버 칩 */
    'background:',
    '  repeating-linear-gradient(0deg,rgba(255,255,255,.08) 0,rgba(255,255,255,.08) 1px,transparent 1px,transparent 3px),',
    '  linear-gradient(105deg,transparent 38%,rgba(255,255,255,.55) 50%,transparent 62%),',
    '  linear-gradient(120deg,#12002b 0%,#4b0a9a 22%,#00506b 45%,#a10a6c 68%,#12002b 100%);',
    'background-size:auto,250% 100%,300% 100%;',
    'text-shadow:0 0 4px #fff,0 0 10px rgba(130,245,255,.95),0 0 20px rgba(190,90,255,.85),0 0 34px rgba(255,80,220,.6);',
    'box-shadow:0 0 0 1px rgba(210,170,255,.85) inset,0 0 14px 2px rgba(120,60,255,.75) inset,0 0 26px rgba(60,220,255,.45) inset;',
    'animation:aura-hue 5s linear infinite,aura-flicker 3.4s steps(1) infinite,aura-flow 2.6s linear infinite}',
    '.kb-aura:hover{filter:brightness(1.25) saturate(1.2)}',
    '.kb-aura:focus-visible{outline:2px solid #5ff0ff;outline-offset:2px}',

    /* 본문 텍스트 위에 겹치는 색수차(RGB 분리) 글리치 레이어 2장 — 위/아래 밴드로 쪼개 서로 다른 타이밍으로 들썩임 */
    '.kb-aura::before,.kb-aura::after{content:attr(data-text);position:absolute;inset:0;display:flex;',
    'align-items:center;justify-content:center;padding:inherit;letter-spacing:inherit;font:inherit;',
    'text-transform:inherit;pointer-events:none;mix-blend-mode:screen}',
    '.kb-aura::before{color:#5ff0ff;clip-path:polygon(0 0,100% 0,100% 48%,0 48%);animation:aura-glitch-a 2.8s infinite steps(2,end)}',
    '.kb-aura::after{color:#ff4fe0;clip-path:polygon(0 52%,100% 52%,100% 100%,0 100%);animation:aura-glitch-b 2.4s infinite steps(2,end)}',
    '.kb-aura--lg{font-size:1.15em}',

    '.kb-aura--lg{font-size:1.15em}',
    '@keyframes aura-hue{to{filter:hue-rotate(360deg)}}',
    '@keyframes aura-flow{0%{background-position:0 0,150% 0,0% 50%}100%{background-position:0 0,-50% 0,100% 50%}}',
    '@keyframes aura-flicker{0%,91%,100%{opacity:1}92%{opacity:.5}94%{opacity:1}96%{opacity:.35}97.5%{opacity:1}}',
    '@keyframes aura-glitch-a{0%,70%,100%{transform:translate(0,0)}72%{transform:translate(-4px,-1px)}',
    '75%{transform:translate(3px,1px)}79%{transform:translate(-2px,0)}83%{transform:translate(0,0)}}',
    '@keyframes aura-glitch-b{0%,62%,100%{transform:translate(0,0)}64%{transform:translate(4px,1px)}',
    '68%{transform:translate(-3px,-1px)}72%{transform:translate(2px,0)}76%{transform:translate(0,0)}}',

    /* ================= AURA 클릭 이펙트: 해골 ================= */
    '.kb-skullfx{position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;animation:skull-bg 1.8s ease-out forwards;',
    'background:radial-gradient(circle at 50% 50%,rgba(255,40,120,.38),rgba(80,0,160,.55) 45%,rgba(0,0,0,.8) 100%)}',
    '.kb-skullfx__skull{position:absolute;left:50%;top:46%;width:min(46vw,260px);aspect-ratio:1;margin:calc(min(46vw,260px)/-2) 0 0 calc(min(46vw,260px)/-2);',
    'animation:skull-pop 1.8s cubic-bezier(.2,1.4,.4,1) forwards}',
    '.kb-skullfx__skull svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    '.kb-skullfx__skull .s-r{color:#ff2d6f;mix-blend-mode:screen;animation:skull-rgb-a .18s steps(2) infinite}',
    '.kb-skullfx__skull .s-c{color:#2de6ff;mix-blend-mode:screen;animation:skull-rgb-b .18s steps(2) infinite}',
    '.kb-skullfx__skull .s-w{color:#f2fbff;filter:drop-shadow(0 0 14px rgba(190,90,255,.9)) drop-shadow(0 0 30px rgba(255,60,200,.7))}',
    '.kb-skullfx__skull .jaw{transform-origin:50% 62%;animation:skull-jaw .22s ease-in-out 5 alternate}',
    '.kb-skullfx__eye{animation:skull-eye .3s steps(2) infinite}',
    '.kb-skullfx__p{position:absolute;font-size:22px;line-height:1;opacity:0;animation:skull-p 1.3s ease-out forwards}',
    '@keyframes skull-bg{0%{opacity:0}8%{opacity:1}70%{opacity:1}100%{opacity:0}}',
    '@keyframes skull-pop{0%{transform:scale(.1) rotate(-14deg);opacity:0}14%{transform:scale(1.18) rotate(5deg);opacity:1}',
    '24%{transform:scale(1) rotate(-3deg)}34%{transform:translate(-6px,3px)}40%{transform:translate(7px,-4px)}46%{transform:translate(-4px,0)}',
    '52%,80%{transform:scale(1) rotate(0)}100%{transform:scale(1.5) rotate(0);opacity:0;filter:blur(8px)}}',
    '@keyframes skull-rgb-a{0%{transform:translate(-7px,0)}100%{transform:translate(5px,2px)}}',
    '@keyframes skull-rgb-b{0%{transform:translate(7px,0)}100%{transform:translate(-5px,-2px)}}',
    '@keyframes skull-jaw{to{transform:translateY(6%)}}',
    '@keyframes skull-eye{0%{opacity:1}100%{opacity:.55}}',
    '@keyframes skull-p{0%{opacity:0;transform:translate(0,0) scale(.4)}15%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--rot)) scale(1.2)}}',

    /* ================= 태그 (등급 · 퀘스트 · 한정판 · 시즌 랭킹) ================= */
    '.kt{--kt-bg:linear-gradient(135deg,#e6e6e6,#a0a0a0);--kt-ink:#161616;--kt-glow:rgba(255,255,255,.18);--kt-edge:rgba(255,255,255,.45);',
    'position:relative;display:inline-flex;align-items:center;gap:.4em;flex:none;isolation:isolate;overflow:hidden;',
    'padding:.17em .68em .19em .56em;border-radius:999px;max-width:11rem;',
    'font:800 .74em/1.25 "Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;',
    'letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--kt-ink);background:var(--kt-bg);',
    'box-shadow:inset 0 0 0 1px var(--kt-edge),0 0 10px var(--kt-glow)}',
    '.kt::before{content:attr(data-glyph);font-size:.95em;line-height:1;opacity:.92}',
    '.kt--lg{font-size:1.02em;padding:.3em .95em .32em .78em;gap:.5em}',

    /* 등급 10단계 */
    '.kt--tier-1{--kt-bg:linear-gradient(135deg,#c4ffd9,#3fd98f);--kt-ink:#052e1a;--kt-glow:rgba(63,217,143,.35)}',
    '.kt--tier-2{--kt-bg:linear-gradient(135deg,#f8cfa8,#b8702f);--kt-ink:#341703;--kt-glow:rgba(214,140,70,.4)}',
    '.kt--tier-3{--kt-bg:linear-gradient(135deg,#ffffff,#9fb4c6);--kt-ink:#18242f;--kt-glow:rgba(190,210,225,.45)}',
    '.kt--tier-4{--kt-bg:linear-gradient(135deg,#fff2b6,#efb02b);--kt-ink:#3a2500;--kt-glow:rgba(255,200,70,.55)}',
    '.kt--tier-5{--kt-bg:linear-gradient(135deg,#d8fff8,#3fd0c9 58%,#8ce8ff);--kt-ink:#032a2a;--kt-glow:rgba(63,208,201,.6)}',
    '.kt--tier-6{--kt-bg:linear-gradient(135deg,#c9ffe0,#22c98a 55%,#0f9d76);--kt-ink:#032a1a;--kt-glow:rgba(34,201,138,.65)}',
    '.kt--tier-7{--kt-bg:linear-gradient(135deg,#e6f5ff,#58a8ff 55%,#b9dcff);--kt-ink:#07214a;--kt-glow:rgba(88,168,255,.65)}',
    '.kt--tier-8{--kt-bg:linear-gradient(135deg,#f2e2ff,#9b5cff 60%,#c89bff);--kt-ink:#1f0745;--kt-glow:rgba(155,92,255,.7)}',
    '.kt--tier-9{--kt-bg:linear-gradient(135deg,#ff9ec4,#e8267a 55%,#a3124f);--kt-ink:#fff;--kt-glow:rgba(232,38,122,.75);text-shadow:0 1px 2px rgba(60,0,25,.6)}',
    '.kt--tier-10{--kt-bg:linear-gradient(135deg,#ffe29a,#ff7a1f 50%,#e12d2d);--kt-ink:#2b0800;--kt-glow:rgba(255,110,30,.8)}',
    '.kt--tier-11{--kt-bg:linear-gradient(135deg,#7df9ff,#6a5cff 45%,#c026ff 75%,#ff4fd8);--kt-ink:#fff;--kt-glow:rgba(140,100,255,.85);',
    'text-shadow:0 1px 2px rgba(10,0,50,.6);animation:kt-glow 1.8s ease-in-out infinite alternate}',
    '.kt--tier-12{--kt-bg:linear-gradient(110deg,#ff9bd0,#ffe38a,#9bffd8,#9bc8ff,#d69bff,#ff9bd0,#ffe38a,#9bffd8,#9bc8ff,#d69bff,#ff9bd0);',
    '--kt-ink:#12102a;--kt-glow:rgba(214,155,255,.85);background-size:200% 100%;animation:kt-holo 5s linear infinite,kt-glow 2.2s ease-in-out infinite alternate}',

    /* 퀘스트 태그 (일반 / 희귀 / 영웅) */
    '.kt--quest-common{--kt-bg:linear-gradient(135deg,rgba(111,242,224,.28),rgba(111,242,224,.12));--kt-ink:#a9fff2;--kt-edge:rgba(111,242,224,.7);--kt-glow:rgba(111,242,224,.25)}',
    '.kt--quest-rare{--kt-bg:linear-gradient(135deg,#7c8bff,#4a56d6);--kt-ink:#fff;--kt-edge:rgba(200,208,255,.7);--kt-glow:rgba(124,139,255,.6)}',
    '.kt--quest-epic{--kt-bg:linear-gradient(135deg,#ff7ac6,#a855f7 55%,#ffb347);--kt-ink:#1e0533;--kt-edge:rgba(255,220,250,.8);--kt-glow:rgba(226,110,230,.7)}',
    '.kt--quest-legendary{--kt-bg:linear-gradient(110deg,#ffd15c,#ff4d6d,#a855f7,#ffd15c);--kt-ink:#2a0812;--kt-edge:rgba(255,225,150,.85);--kt-glow:rgba(255,120,80,.85);',
    'background-size:220% 100%;animation:kt-holo 4.5s linear infinite,kt-glow 1.8s ease-in-out infinite alternate}',

    /* 한정판 태그: 어두운 바탕 + 무지개빛으로 흐르는 테두리 */
    '.kt--limited-a,.kt--limited-b,.kt--limited-c{--kt-ink:#fff;--kt-glow:rgba(255,120,220,.7);border:1.5px solid transparent;padding:.14em .64em .16em .52em;',
    'background:linear-gradient(#160a2c,#160a2c) padding-box,var(--kt-ring) border-box;background-size:100% 100%,200% 100%;box-shadow:0 0 12px var(--kt-glow);',
    'animation:kt-holo 4s linear infinite,kt-glow 2s ease-in-out infinite alternate}',
    '.kt--limited-a{--kt-ring:linear-gradient(110deg,#ff5fd2,#ffd35f,#5ff0ff,#ff5fd2,#ffd35f,#5ff0ff,#ff5fd2);--kt-glow:rgba(255,95,210,.7)}',
    '.kt--limited-b{--kt-ring:linear-gradient(110deg,#ff5a1f,#ffd35f,#ff2d55,#ff5a1f,#ffd35f,#ff2d55,#ff5a1f);--kt-glow:rgba(255,110,40,.75)}',
    '.kt--limited-c{--kt-ring:linear-gradient(110deg,#5ff0ff,#8b7bff,#5fffb0,#5ff0ff,#8b7bff,#5fffb0,#5ff0ff);--kt-glow:rgba(95,240,255,.7)}',
    '.kt--limited-a::before,.kt--limited-b::before,.kt--limited-c::before{color:#ffe9a8}',

    /* 시즌 랭킹 1·2·3등 태그 */
    '.kt--season-1{--kt-bg:linear-gradient(135deg,#fff3b8,#ffc93c 50%,#ff9d1e);--kt-ink:#3a2200;--kt-glow:rgba(255,190,60,.85)}',
    '.kt--season-2{--kt-bg:linear-gradient(135deg,#ffffff,#c3d1dd 50%,#8fa5b8);--kt-ink:#15212b;--kt-glow:rgba(200,215,230,.7)}',
    '.kt--season-3{--kt-bg:linear-gradient(135deg,#ffd9b8,#dc935a 50%,#a9622e);--kt-ink:#2f1500;--kt-glow:rgba(220,150,90,.7)}',

    /* 높은 등급 / 한정판 / 시즌 태그는 빛이 훑고 지나가요 */
    '.kt--tier-5::after,.kt--tier-6::after,.kt--tier-7::after,.kt--tier-8::after,.kt--tier-9::after,.kt--tier-10::after,.kt--tier-11::after,.kt--tier-12::after,',
    '.kt--quest-epic::after,.kt--quest-legendary::after,.kt--limited-a::after,.kt--limited-b::after,.kt--limited-c::after,.kt--season-1::after,.kt--season-2::after,.kt--season-3::after{',
    'content:"";position:absolute;top:-45%;bottom:-45%;left:-60%;width:32%;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.7),rgba(255,255,255,0));',
    'transform:skewX(-20deg);animation:kt-sweep 3.2s ease-in-out infinite;pointer-events:none}',

    '@keyframes kt-sweep{0%{left:-60%}55%,100%{left:135%}}',
    '@keyframes kt-holo{to{background-position:100% 0}}',
    '@keyframes kt-glow{from{filter:brightness(1)}to{filter:brightness(1.18) saturate(1.1)}}',

    '@media (prefers-reduced-motion:reduce){',
    '.kb-admin,.kb-aura,.kt{animation:none!important}',
    '.kb-skullfx__skull,.kb-skullfx__skull *{animation-duration:.01s!important}',
    '.kb-admin::before,.kb-admin::after,.kb-aura::before,.kb-aura::after,.kt::after{display:none}}'
  ].join('');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  function isAdmin(username) {
    return typeof username === 'string' && ADMIN_NAMES.indexOf(username) !== -1;
  }

  // AURA 는 대소문자까지 정확히 일치해야 합니다(`aura`, `Aura` 는 해당 없음) — admin 배지와 같은 원칙.
  function isAura(username) {
    return username === AURA_NAME;
  }

  function badge() {
    var el = document.createElement('span');
    el.className = 'kb-admin';
    el.title = '관리자 계정';
    el.textContent = '[ADMIN]';
    return el;
  }

  function auraBadge() {
    var el = document.createElement('span');
    el.className = 'kb-aura';
    el.title = 'AURA 전용 칭호';
    el.setAttribute('data-text', 'AURA');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.textContent = 'AURA';
    return el;
  }

  /* ---------- AURA 클릭 이펙트: 해골 ---------- */
  var skullActive = false;
  var SKULL_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<g fill="currentColor"><path d="M32 3C16.5 3 7 13.5 7 27.5c0 8.3 3.4 14.2 9 17.4V50c0 2.2 1.8 4 4 4h4v-6h3v6h4v-6h3v6h4v-6h3v6h4c2.2 0 4-1.8 4-4v-5.1c5.6-3.2 9-9.1 9-17.4C57 13.5 47.5 3 32 3z"/></g>' +
    '<g class="holes" fill="#12002b"><ellipse class="kb-skullfx__eye" cx="21.5" cy="28" rx="7" ry="8" fill="#ff2d6f"/><ellipse class="kb-skullfx__eye" cx="42.5" cy="28" rx="7" ry="8" fill="#ff2d6f"/>' +
    '<ellipse cx="21.5" cy="28" rx="3.2" ry="4" fill="#12002b"/><ellipse cx="42.5" cy="28" rx="3.2" ry="4" fill="#12002b"/>' +
    '<path d="M32 36l-4 8h8z"/></g></svg>';

  function skullFx(source) {
    if (skullActive || !document.body) return;
    skullActive = true;
    var root = document.createElement('div');
    root.className = 'kb-skullfx';
    var sk = document.createElement('div');
    sk.className = 'kb-skullfx__skull';
    ['s-r', 's-c', 's-w'].forEach(function (cls) {
      var layer = document.createElement('div');
      layer.className = cls;
      layer.style.cssText = 'position:absolute;inset:0';
      layer.innerHTML = SKULL_SVG;
      sk.appendChild(layer);
    });
    root.appendChild(sk);

    // 클릭한 배지 위치에서 사방으로 튀는 작은 해골 조각
    var rect = source && source.getBoundingClientRect ? source.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    var ox = rect.left + rect.width / 2, oy = rect.top + rect.height / 2;
    var glyphs = ['\u2620', '\u2726', '\u2620', '\u26A1'];
    for (var i = 0; i < 18; i++) {
      var p = document.createElement('span');
      p.className = 'kb-skullfx__p';
      p.textContent = glyphs[i % glyphs.length];
      var ang = (Math.PI * 2 * i) / 18 + Math.random() * 0.3, dist = 120 + Math.random() * 220;
      p.style.cssText = 'left:' + ox + 'px;top:' + oy + 'px;color:' + (i % 2 ? '#5ff0ff' : '#ff4fe0') +
        ';--dx:' + Math.round(Math.cos(ang) * dist) + 'px;--dy:' + Math.round(Math.sin(ang) * dist) + 'px;--rot:' +
        Math.round((Math.random() - 0.5) * 540) + 'deg;animation-delay:' + Math.round(Math.random() * 160) + 'ms';
      root.appendChild(p);
    }
    document.body.appendChild(root);
    setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); skullActive = false; }, 1900);
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.kb-aura') : null;
    if (t) skullFx(t);
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('kb-aura')) {
      e.preventDefault(); skullFx(e.target);
    }
  });

  var TIER_GLYPHS = ['\u25CF', '\u25B2', '\u25C6', '\u2605', '\u2726', '\u2756', '\u272A', '\u2739', '\u2737', '\u273A', '\u2735', '\u265B'];

  function glyphFor(style) {
    var m = /^tier-(\d+)$/.exec(style);
    if (m) return TIER_GLYPHS[Number(m[1]) - 1] || TIER_GLYPHS[0];
    if (style.indexOf('season-') === 0) return '\u265B';
    if (style.indexOf('limited-') === 0) return '\u2727';
    return '\u25C8';
  }

  /* 서버가 준 태그 { id, kind, name, style } → <span class="kt kt--…"> */
  function tagPill(tag, options) {
    if (!tag || !tag.name) return null;
    var style = String(tag.style || '').replace(/[^a-z0-9-]/g, '');   // 클래스 이름으로만 쓰이도록 정리
    if (style === 'aura') {                                            // AURA 전용 태그: 글리치 배지와 같은 모양
      var a = auraBadge();
      a.setAttribute('data-text', String(tag.name));
      a.textContent = String(tag.name);
      a.title = String(tag.name);
      if (options && options.size === 'lg') a.className += ' kb-aura--lg';
      return a;
    }
    var el = document.createElement('span');
    el.className = 'kt kt--' + style + (options && options.size === 'lg' ? ' kt--lg' : '');
    el.setAttribute('data-glyph', glyphFor(style));
    el.textContent = String(tag.name);
    el.title = String(tag.name);
    return el;
  }

  function render(container, username, options) {
    options = options || {};
    var name = username == null ? '' : String(username);

    var wrap = document.createElement('span');
    wrap.className = 'kb-name';

    var text = document.createElement('span');
    text.className = 'kb-name__text';
    text.textContent = name + (options.suffix || '');
    wrap.appendChild(text);

    if (isAdmin(username)) wrap.appendChild(badge());
    // 태그는 최대 3개까지 표시합니다. options.tags(배열, 신규)를 우선 쓰고,
    // 예전 코드가 아직 options.tag(단수)를 넘기면 그것도 그대로 지원합니다.
    var list = options.tags || (options.tag ? [options.tag] : []);
    // AURA 배지는 서버 전용 태그(style:'aura')가 이미 같은 모양을 그리면 중복해서 붙이지 않습니다.
    var hasAuraTag = list.slice(0, 3).some(function (t) { return t && t.style === 'aura'; });
    if (isAura(username) && !hasAuraTag) wrap.appendChild(auraBadge());
    list.slice(0, 3).forEach(function (t) {
      var pill = tagPill(t);
      if (pill) wrap.appendChild(pill);
    });

    container.textContent = '';
    container.appendChild(wrap);
    return wrap;
  }

  injectStyle();

  global.KihoBadge = {
    ADMIN_NAMES: ADMIN_NAMES, AURA_NAME: AURA_NAME,
    isAdmin: isAdmin, isAura: isAura, badge: badge, auraBadge: auraBadge,
    tagPill: tagPill, render: render, skullFx: skullFx
  };
})(window);
