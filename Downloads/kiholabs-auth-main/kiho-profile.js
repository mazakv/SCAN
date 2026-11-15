/* ==================================================================
   Kiho Labs — 프로필 · 배경 · 프로필 사진 공용 스크립트 (kiho-profile.js)

   <script src="kiho-sdk.js"></script>
   <script src="kiho-badge.js"></script>
   <script src="kiho-profile.js"></script>

   KihoProfile.open(username)            프로필 팝업 열기 (랭킹에서 이름·사진을 눌렀을 때)
   KihoProfile.avatar(username, ver, px, extraClass) 프로필 사진 요소 (사진이 없으면 이름 첫 글자)
   KihoProfile.bgClass(id)               배경 id → CSS 클래스 문자열 ('' = 기본 배경)
   KihoProfile.applyBg(el, id)           요소에 배경 적용/해제
   KihoProfile.bgTile(id)                배경 미리보기 칸
   KihoProfile.API_BASE / .token() / .api(path, opts)

   · 모든 사용자 입력(이름·한마디)은 textContent 로만 넣습니다.
   · CSS 는 이 파일이 스스로 주입합니다.
================================================================== */
(function (global) {
  'use strict';

  var API_BASE = String((global.Kiho && global.Kiho.CONFIG && global.Kiho.CONFIG.API_BASE) || 'https://api.kiholabs.com').replace(/\/$/, '');

  /* ---------------- 배경 디자인 ----------------
     id 는 Worker 의 BG_CATALOG 와 같아야 합니다.  layers/sizes 는 CSS background-image / background-size,
     base 는 바탕색, anim 은 천천히 흐르는 효과(가로로 오가며 움직임). */
  var STARS = 'radial-gradient(1.5px 1.5px at 12% 30%,#fff,transparent),radial-gradient(1px 1px at 33% 72%,#fff,transparent),' +
    'radial-gradient(1.5px 1.5px at 55% 25%,#cfe9ff,transparent),radial-gradient(1px 1px at 74% 62%,#fff,transparent),' +
    'radial-gradient(2px 2px at 90% 35%,#fff,transparent),radial-gradient(1px 1px at 5% 80%,#fff,transparent),radial-gradient(1px 1px at 45% 55%,#fff,transparent)';

  var BG = {
    bronze:      { base: '#1c1410', layers: 'linear-gradient(100deg,rgba(214,130,60,.55),rgba(120,50,30,.35) 50%,rgba(255,170,90,.32))' },
    silver:      { base: '#122330', layers: 'linear-gradient(105deg,transparent 40%,rgba(255,255,255,.28) 50%,transparent 60%),repeating-linear-gradient(110deg,rgba(255,255,255,.10) 0 12px,rgba(255,255,255,.02) 12px 28px),linear-gradient(100deg,rgba(190,205,220,.38),rgba(110,130,150,.24))', sizes: '250% 100%,auto,auto', anim: 1 },
    gold:        { base: '#231a08', layers: 'linear-gradient(105deg,transparent 40%,rgba(255,240,170,.34) 50%,transparent 60%),repeating-linear-gradient(115deg,rgba(255,214,90,.26) 0 10px,rgba(255,180,40,.07) 10px 22px),linear-gradient(100deg,rgba(255,200,70,.36),rgba(120,70,0,.3))', sizes: '250% 100%,auto,auto', anim: 1 },
    platinum:    { base: '#10303a', layers: 'radial-gradient(ellipse at 20% 0%,rgba(190,255,250,.38),transparent 55%),radial-gradient(ellipse at 90% 100%,rgba(120,200,255,.32),transparent 55%)' },
    emerald:     { base: '#07261f', layers: 'radial-gradient(circle at 10% 120%,rgba(34,201,138,.6),transparent 50%),radial-gradient(circle at 85% -20%,rgba(15,157,118,.5),transparent 55%),linear-gradient(100deg,rgba(6,70,50,.5),rgba(10,50,60,.3))' },
    diamond:     { base: '#101e32', layers: 'linear-gradient(115deg,rgba(255,120,200,.3),rgba(120,200,255,.32) 30%,rgba(140,255,200,.26) 55%,rgba(255,230,120,.26) 78%,rgba(200,150,255,.32))', sizes: '300% 100%', anim: 1 },
    master:      { base: '#150c2e', layers: 'radial-gradient(circle at 15% 30%,rgba(190,120,255,.5),transparent 45%),radial-gradient(circle at 80% 70%,rgba(110,80,255,.5),transparent 50%),linear-gradient(100deg,rgba(36,11,74,.5),rgba(11,26,74,.4))' },
    grandmaster: { base: '#26100f', layers: 'linear-gradient(95deg,rgba(255,80,60,.55),rgba(255,140,60,.4) 40%,rgba(160,40,120,.5) 80%,rgba(70,20,110,.5))' },
    challenger:  { base: '#0a1230', layers: 'repeating-linear-gradient(100deg,transparent 0 46px,rgba(150,220,255,.28) 46px 48px,transparent 48px 96px),linear-gradient(100deg,rgba(40,60,180,.5),rgba(10,20,60,.2))', sizes: '220% 100%,auto', anim: 1 },
    myth:        { base: '#0d0b2c', layers: STARS + ',linear-gradient(100deg,rgba(30,20,90,.7),rgba(90,30,120,.5) 55%,rgba(20,60,120,.55))' },
    legend:      { base: '#1a1408', layers: 'linear-gradient(100deg,rgba(255,200,60,.5),rgba(120,255,200,.32) 35%,rgba(120,150,255,.38) 65%,rgba(255,120,220,.42))', sizes: '300% 100%', anim: 1 },

    paper:       { base: '#26231b', layers: 'repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 2px,transparent 2px 5px),linear-gradient(100deg,rgba(240,230,200,.28),rgba(200,190,160,.18))' },
    nightsky:    { base: '#050a24', layers: STARS + ',linear-gradient(100deg,rgba(5,10,40,.85),rgba(20,20,70,.6))' },
    dawn:        { base: '#16303f', layers: 'linear-gradient(100deg,rgba(150,190,230,.4),rgba(240,200,220,.28) 60%,rgba(255,220,170,.3))' },
    weekend:     { base: '#1d2b3a', layers: 'linear-gradient(100deg,rgba(255,190,220,.36),rgba(190,220,255,.3) 50%,rgba(200,255,220,.3))' },
    ember:       { base: '#1f0d08', layers: 'radial-gradient(circle at 10% 130%,rgba(255,120,30,.6),transparent 55%),radial-gradient(circle at 60% 140%,rgba(255,200,60,.35),transparent 50%),linear-gradient(100deg,rgba(80,20,10,.5),rgba(40,10,20,.3))' },
    lava:        { base: '#180606', layers: 'radial-gradient(ellipse at 25% 100%,rgba(255,90,20,.7),transparent 55%),radial-gradient(ellipse at 75% 100%,rgba(255,40,40,.6),transparent 55%),linear-gradient(100deg,rgba(60,0,0,.65),rgba(30,0,10,.5))', sizes: '160% 100%,160% 100%,auto', anim: 1 },
    crystal:     { base: '#0e2c3c', layers: 'linear-gradient(60deg,rgba(255,255,255,.17) 25%,transparent 25% 50%,rgba(255,255,255,.11) 50% 75%,transparent 75%),linear-gradient(100deg,rgba(130,230,255,.35),rgba(170,200,255,.25))', sizes: '56px 56px,auto' },
    neon:        { base: '#0a0224', layers: 'linear-gradient(rgba(80,255,220,.25) 1px,transparent 1px),linear-gradient(90deg,rgba(255,80,220,.22) 1px,transparent 1px),linear-gradient(100deg,rgba(10,0,40,.7),rgba(30,0,60,.55))', sizes: '22px 22px,22px 22px,auto' },
    speed:       { base: '#08243a', layers: 'repeating-linear-gradient(100deg,transparent 0 30px,rgba(255,255,255,.2) 30px 32px,transparent 32px 70px),linear-gradient(100deg,rgba(10,100,160,.45),rgba(0,40,90,.4))', sizes: '300% 100%,auto', anim: 1 },
    rainbow:     { base: '#13253a', layers: 'linear-gradient(100deg,rgba(255,90,90,.36),rgba(255,200,70,.36),rgba(120,240,140,.34),rgba(90,170,255,.36),rgba(190,110,255,.36))' },
    spotlight:   { base: '#12122a', layers: 'radial-gradient(ellipse 22% 150% at 20% -25%,rgba(255,255,230,.5),transparent 70%),radial-gradient(ellipse 22% 150% at 50% -25%,rgba(255,255,230,.34),transparent 70%),radial-gradient(ellipse 22% 150% at 80% -25%,rgba(255,255,230,.5),transparent 70%),linear-gradient(100deg,rgba(25,25,50,.8),rgba(40,30,70,.6))' },
    topten:      { base: '#1c0f0a', layers: 'radial-gradient(2px 2px at 20% 60%,#ffd27a,transparent),radial-gradient(2px 2px at 45% 30%,#ffb04d,transparent),radial-gradient(1.5px 1.5px at 70% 70%,#ffd27a,transparent),radial-gradient(2px 2px at 88% 40%,#ff9a3c,transparent),linear-gradient(100deg,rgba(90,40,10,.6),rgba(50,20,40,.5))' },
    crown:       { base: '#241a05', layers: 'linear-gradient(105deg,transparent 40%,rgba(255,255,220,.5) 50%,transparent 60%),repeating-linear-gradient(135deg,rgba(255,215,100,.16) 0 8px,rgba(255,170,40,.05) 8px 18px),linear-gradient(100deg,rgba(255,200,60,.5),rgba(150,90,0,.45))', sizes: '250% 100%,auto,auto', anim: 1 },
    pioneer:     { base: '#0b2233', layers: 'radial-gradient(circle at 12% 50%,rgba(120,255,230,.4),transparent 40%),radial-gradient(circle at 90% 50%,rgba(130,140,255,.4),transparent 45%),linear-gradient(100deg,rgba(20,60,90,.6),rgba(30,30,90,.5))' },

    aura:        { base: '#0c001d', layers: 'repeating-linear-gradient(0deg,rgba(255,255,255,.06) 0 1px,transparent 1px 3px),linear-gradient(105deg,transparent 40%,rgba(255,255,255,.35) 50%,transparent 60%),linear-gradient(120deg,rgba(18,0,43,.9),rgba(75,10,154,.8) 25%,rgba(0,80,107,.8) 50%,rgba(161,10,108,.8) 75%,rgba(18,0,43,.9))', sizes: 'auto,260% 100%,320% 100%', anim: 1 },

    storm:       { base: '#070d1f', layers: 'linear-gradient(100deg,transparent 44%,rgba(210,225,255,.6) 50%,transparent 56%),radial-gradient(ellipse at 20% 0%,rgba(80,100,170,.55),transparent 55%),radial-gradient(ellipse at 85% 10%,rgba(60,80,150,.5),transparent 55%)', sizes: '420% 100%,auto,auto', anim: 1 },
    ocean:       { base: '#04182e', layers: 'repeating-linear-gradient(100deg,rgba(120,210,255,.2) 0 18px,transparent 18px 46px),linear-gradient(100deg,rgba(10,70,140,.65),rgba(5,40,90,.5))', sizes: '200% 100%,auto', anim: 1 },
    matrix:      { base: '#00120a', layers: 'repeating-linear-gradient(180deg,rgba(60,255,140,.36) 0 2px,transparent 2px 10px),repeating-linear-gradient(90deg,rgba(0,0,0,0) 0 6px,rgba(0,40,20,.55) 6px 12px),linear-gradient(100deg,rgba(0,70,35,.5),rgba(0,25,15,.5))', sizes: '100% 60px,auto,auto', animY: 1 },
    sakura:      { base: '#2a1220', layers: 'radial-gradient(circle at 20% 30%,rgba(255,200,225,.95) 0 3px,transparent 4px),radial-gradient(circle at 70% 60%,rgba(255,170,205,.9) 0 2.5px,transparent 3.5px),radial-gradient(circle at 45% 85%,rgba(255,215,235,.9) 0 2px,transparent 3px),linear-gradient(100deg,rgba(255,150,190,.4),rgba(190,110,170,.3))', sizes: '90px 64px,120px 80px,70px 50px,auto', animY: 1 },
    sunrise:     { base: '#2a1830', layers: 'linear-gradient(105deg,transparent 38%,rgba(255,240,190,.4) 50%,transparent 62%),linear-gradient(100deg,rgba(255,150,60,.55),rgba(255,100,130,.45) 55%,rgba(90,120,230,.45))', sizes: '250% 100%,auto', anim: 1 },
    blaze:       { base: '#1a0804', layers: 'linear-gradient(0deg,rgba(255,200,60,.6),rgba(255,90,20,.5) 40%,rgba(120,10,10,0) 85%),linear-gradient(100deg,rgba(90,10,10,.55),rgba(40,5,10,.4))', sizes: '100% 300%,auto', animY: 1 },
    void:        { base: '#05000f', layers: 'radial-gradient(ellipse at 50% 50%,rgba(150,60,255,.6),transparent 55%),radial-gradient(ellipse at 10% 120%,rgba(70,0,140,.7),transparent 55%),linear-gradient(100deg,rgba(10,0,30,.8),rgba(30,0,70,.6))', sizes: '220% 100%,auto,auto', anim: 1 }
  };

  /* 정지해 있던 배경에 빛줄기가 천천히 지나가는 레이어를 얹어 움직이게 합니다. */
  (function upgradeBg() {
    function splitLayers(str) {
      var out = [], depth = 0, cur = '';
      for (var i = 0; i < str.length; i++) {
        var ch = str.charAt(i);
        if (ch === '(') depth++; else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur); return out;
    }
    var SWEEP = 'linear-gradient(105deg,transparent 38%,rgba(255,255,255,.2) 50%,transparent 62%)';
    ['bronze', 'platinum', 'emerald', 'master', 'grandmaster', 'rainbow', 'topten', 'spotlight', 'dawn', 'weekend', 'pioneer', 'ember', 'paper', 'nightsky', 'crystal', 'speed'].forEach(function (id) {
      var b = BG[id]; if (!b || b.anim) return;
      var n = splitLayers(b.layers).length;
      var sizes = b.sizes ? splitLayers(b.sizes) : []; while (sizes.length < n) sizes.push('auto');
      b.layers = SWEEP + ',' + b.layers; b.sizes = ['260% 100%'].concat(sizes).join(','); b.anim = 1;
    });
    if (BG.neon) BG.neon.animY = 1;
    if (BG.lava) BG.lava.animY = 0;
  })();

  var STYLE_ID = 'kp-style';
  function buildCss() {
    var css = [
      '.kp-av{position:relative;overflow:hidden;display:inline-grid;place-items:center;flex:none;border-radius:50%;font-weight:800;color:inherit}',
      '.kp-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%}',
      '@keyframes kbg-flow{from{background-position-x:0%}to{background-position-x:100%}}',
      '@keyframes kbg-flow-y{from{background-position-y:0%}to{background-position-y:100%}}',
      '@media (prefers-reduced-motion:no-preference){.kbg-anim{animation:kbg-flow 9s ease-in-out infinite alternate}.kbg-animy{animation:kbg-flow-y 7s linear infinite}}',
      '.kbg-tile{display:block;width:100%;height:54px;border-radius:12px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}',
      '.kbg-tile--plain{background:rgba(255,255,255,.07)}',
      '.kp-fr{--px:48px;position:relative;display:inline-block;flex:none;width:calc(var(--px) + 8px);height:calc(var(--px) + 8px);border-radius:50%;vertical-align:middle}',
      '.kp-fr-ring{position:absolute;inset:0;border-radius:50%;background:var(--ring)}',
      '.kp-fr-in{position:absolute;inset:3px;border-radius:50%;background:#0a2a3c;display:grid;place-items:center;overflow:hidden}',
      '.kp-fr-in .kp-av,.kp-fr-in .av{width:100%!important;height:100%!important;font-size:calc(var(--px)*.42)!important}',
      '.kp-crown{position:absolute;left:50%;top:calc(var(--px)*-.34);width:calc(var(--px)*.7);transform:translateX(-50%) rotate(-8deg);filter:drop-shadow(0 3px 5px rgba(0,0,0,.55));z-index:3;animation:kp-bob 2.6s ease-in-out infinite;pointer-events:none}',
      '.kp-crown svg{display:block;width:100%;height:auto}',
      '.kp-starpin{position:absolute;right:-4px;top:-4px;width:calc(var(--px)*.36);z-index:3;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}.kp-starpin svg{display:block;width:100%}',
      '.kp-fr{filter:drop-shadow(0 0 7px var(--glow,rgba(255,255,255,0)))}',
      '.kp-fr-ring{will-change:transform}',
      '.kp-fr .kp-ra-spin{animation:kp-spin var(--dur,5s) linear infinite}',
      '.kp-fr .kp-ra-spinr{animation:kp-spinr var(--dur,5s) linear infinite}',
      '.kp-fr .kp-ra-pulse{animation:kp-pulse var(--dur,2s) ease-in-out infinite}',
      '.kp-fr .kp-ra-hue{animation:kp-spin var(--dur,4s) linear infinite,kp-hue calc(var(--dur,4s)*2) linear infinite}',
      '.kp-fr .kp-ra-flick{animation:kp-spin var(--dur,3s) linear infinite,kp-flick 1.7s steps(1) infinite}',
      '.kp-fr-ring2{position:absolute;inset:-5px;border-radius:50%;-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2.5px),#000 calc(100% - 2px));mask:radial-gradient(farthest-side,transparent calc(100% - 2.5px),#000 calc(100% - 2px))}',
      '.kp-halo{animation:kp-halo 2.4s ease-in-out infinite}',
      '.kp-orb{position:absolute;inset:-8px;border-radius:50%;z-index:4;pointer-events:none;animation:kp-spin var(--d,5s) linear infinite}',
      '.kp-orb b{position:absolute;left:50%;top:0;transform:translate(-50%,-50%);line-height:1;color:var(--oc,#fff);filter:drop-shadow(0 0 4px var(--oc,#fff))}',
      '.kp-orb-sym{font-size:calc(var(--px)*.24)}.kp-orb-sym i{display:block;font-style:normal;animation:kp-spinr var(--d,5s) linear infinite}',
      '.kp-orb-dot{width:calc(var(--px)*.12);height:calc(var(--px)*.12);border-radius:50%;background:var(--oc,#fff);box-shadow:0 0 8px 2px var(--oc,#fff)}',
      '.kp-sp{position:absolute;z-index:5;font-style:normal;font-size:calc(var(--px)*.2);line-height:1;pointer-events:none;opacity:0;animation:kp-twinkle 2.3s ease-in-out infinite;text-shadow:0 0 6px currentColor}',
      '.kp-fl{position:absolute;z-index:2;width:calc(var(--px)*.17);height:calc(var(--px)*.26);border-radius:50% 50% 50% 50%/65% 65% 35% 35%;background:linear-gradient(0deg,#ff3d00,#ffb02e 60%,#fff3a0);opacity:0;pointer-events:none;animation:kp-flame 1.5s ease-out infinite}',
      '.kp-bub{position:absolute;z-index:5;width:calc(var(--px)*.1);height:calc(var(--px)*.1);border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff,rgba(160,225,255,.5) 60%,transparent 70%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.6);opacity:0;pointer-events:none;animation:kp-bubble 2.4s ease-in infinite}',
      '.kp-bolt{position:absolute;right:-6%;top:6%;z-index:6;font-style:normal;font-size:calc(var(--px)*.3);line-height:1;filter:drop-shadow(0 0 5px #7ec8ff);animation:kp-bolt 1.8s steps(1) infinite}',
      '.kp-gl{mix-blend-mode:screen;opacity:.0;animation:none}',
      '.kp-gl1{background:conic-gradient(#00f0ff,transparent,#00f0ff)!important;animation:kp-glitch-a 2.6s steps(2,end) infinite!important}',
      '.kp-gl2{background:conic-gradient(#ff2fd0,transparent,#ff2fd0)!important;animation:kp-glitch-b 2.2s steps(2,end) infinite!important}',
      '.kp-wing{position:absolute;z-index:-1;top:6%;width:calc(var(--px)*.78);pointer-events:none;filter:drop-shadow(0 0 8px rgba(255,220,140,.7))}',
      '.kp-wing svg{display:block;width:100%;height:auto}',
      '.kp-wing--l{right:84%;transform-origin:100% 60%;animation:kp-flap 2.6s ease-in-out infinite}',
      '.kp-wing--r{left:84%;transform-origin:0 60%;animation:kp-flap-r 2.6s ease-in-out infinite}.kp-wing--r svg{transform:scaleX(-1)}',
      '@keyframes kp-spinr{to{transform:rotate(-360deg)}}',
      '@keyframes kp-pulse{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.09);filter:brightness(1.4)}}',
      '@keyframes kp-hue{to{filter:hue-rotate(360deg)}}',
      '@keyframes kp-flick{0%,100%{opacity:1}13%{opacity:.62}16%{opacity:1}44%{opacity:.78}47%{opacity:1}71%{opacity:.55}74%{opacity:1}}',
      '@keyframes kp-halo{0%,100%{filter:drop-shadow(0 0 7px var(--glow,#fff))}50%{filter:drop-shadow(0 0 17px var(--glow,#fff)) drop-shadow(0 0 28px var(--glow,#fff))}}',
      '@keyframes kp-twinkle{0%,100%{opacity:0;transform:scale(.3) rotate(0)}45%,55%{opacity:1;transform:scale(1) rotate(90deg)}}',
      '@keyframes kp-flame{0%{opacity:0;transform:translateY(8%) scale(.6)}20%{opacity:.95}100%{opacity:0;transform:translateY(-130%) scale(.25)}}',
      '@keyframes kp-bubble{0%{opacity:0;transform:translateY(0) scale(.5)}20%{opacity:.9}100%{opacity:0;transform:translateY(-180%) scale(1.1)}}',
      '@keyframes kp-bolt{0%,60%,100%{opacity:0}62%,70%{opacity:1}66%{opacity:.2}}',
      '@keyframes kp-glitch-a{0%,70%,100%{transform:translate(0,0);opacity:0}72%{transform:translate(-3px,1px);opacity:.9}78%{transform:translate(2px,-1px);opacity:.7}}',
      '@keyframes kp-glitch-b{0%,60%,100%{transform:translate(0,0);opacity:0}64%{transform:translate(3px,-1px);opacity:.9}70%{transform:translate(-2px,1px);opacity:.6}}',
      '@keyframes kp-flap{0%,100%{transform:rotate(8deg) scaleX(1)}50%{transform:rotate(-6deg) scaleX(.9)}}',
      '@keyframes kp-flap-r{0%,100%{transform:rotate(-8deg) scaleX(1)}50%{transform:rotate(6deg) scaleX(.9)}}',
      '@media (prefers-reduced-motion:reduce){.kp-fr .kp-fr-ring,.kp-fr .kp-fr-ring2,.kp-orb,.kp-orb i,.kp-sp,.kp-fl,.kp-bub,.kp-bolt,.kp-gl,.kp-wing,.kp-halo{animation:none!important}.kp-sp{opacity:.9}}',
      '@keyframes kp-spin{to{transform:rotate(360deg)}}',
      '@keyframes kp-bob{0%,100%{transform:translateX(-50%) translateY(0) rotate(-8deg)}50%{transform:translateX(-50%) translateY(-3px) rotate(-5deg)}}',
      '@media (prefers-reduced-motion:reduce){.kp-fr-ring,.kp-crown{animation:none}}'
    ];
    Object.keys(BG).forEach(function (id) {
      var b = BG[id];
      css.push('html body .kbg-' + id + '.kbg-' + id + '{background-color:' + b.base + ';background-image:' + b.layers +
        ';background-size:' + (b.sizes || 'auto') + ';background-repeat:' + (b.sizes ? 'repeat' : 'no-repeat') +
        ';background-position:0 0}');
    });
    return css.join('\n');
  }
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID; s.textContent = buildCss();
    document.head.appendChild(s);
  }

  function bgClass(id) {
    if (!id || !Object.prototype.hasOwnProperty.call(BG, id)) return '';
    return 'kbg-' + id + (BG[id].anim ? ' kbg-anim' : '') + (BG[id].animY ? ' kbg-animy' : '');
  }
  function applyBg(el, id) {
    Array.prototype.slice.call(el.classList).forEach(function (c) { if (c.indexOf('kbg-') === 0) el.classList.remove(c); });
    var cls = bgClass(id);
    if (cls) cls.split(' ').forEach(function (c) { el.classList.add(c); });
    if (cls) el.setAttribute('data-bg', id); else el.removeAttribute('data-bg');
  }
  function bgTile(id) {
    var t = document.createElement('span');
    t.className = 'kbg-tile' + (bgClass(id) ? '' : ' kbg-tile--plain');
    applyBg(t, id); t.classList.add('kbg-tile');
    return t;
  }

  /* ---------------- 테두리 (왕관 · 별 · 등급 링) ---------------- */
  var TIER_RING = ['#8fa3b0', '#d98a4e', '#c9d6e0', '#ffcf4d', '#8fe9f0', '#3fe0a0', '#8fd0ff', '#b27bff', '#ff6a4d', '#5ab4ff', '#ff7ae0', '#ffd34d'];
  var CROWN_TONE = {
    'crown-gold':   { a: '#fff4b0', b: '#ffc928', c: '#c77d00', ring: ['#fff1a8', '#ffb800', '#ff7a00', '#ffe27a'] },
    'crown-silver': { a: '#ffffff', b: '#cfdbe6', c: '#7f93a6', ring: ['#ffffff', '#9fb4c6', '#e9f1f8', '#7f93a6'] },
    'crown-bronze': { a: '#ffd9b0', b: '#e0905a', c: '#8a4a22', ring: ['#ffd0a3', '#c97a45', '#ffb27a', '#8a4a22'] }
  };
  function crownSvg(tone) {
    var t = CROWN_TONE[tone]; var id = 'kpc' + tone.slice(6);
    return '<svg viewBox="0 0 64 44" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + t.a + '"/><stop offset=".55" stop-color="' + t.b + '"/><stop offset="1" stop-color="' + t.c + '"/></linearGradient></defs>' +
      '<path d="M5 36 L2 11 L18 24 L32 4 L46 24 L62 11 L59 36 Z" fill="url(#' + id + ')" stroke="rgba(0,0,0,.35)" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<rect x="5" y="36" width="54" height="6" rx="2.5" fill="url(#' + id + ')" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/>' +
      '<circle cx="2" cy="10" r="3.4" fill="' + t.a + '"/><circle cx="32" cy="4" r="3.8" fill="' + t.a + '"/><circle cx="62" cy="10" r="3.4" fill="' + t.a + '"/>' +
      '<circle cx="32" cy="30" r="3" fill="#ff4d6d" stroke="rgba(0,0,0,.3)" stroke-width=".8"/><circle cx="17" cy="32" r="2" fill="#6ff2e0"/><circle cx="47" cy="32" r="2" fill="#6ff2e0"/></svg>';
  }
  var STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="#ffd86b" stroke="rgba(0,0,0,.35)" stroke-width="1" stroke-linejoin="round"/></svg>';

  /* ---------------- 테두리 카탈로그 (id 는 Worker 의 FRAME_CATALOG 와 같아야 합니다) ----------------
     ring  : 링 색(배열이면 conic 그라디언트, 문자열이면 그대로 CSS background)
     anim  : spin | spinr | pulse | hue | flick     dur: 한 바퀴 시간(초)     glow: 바깥 빛
     ring2 : {bg, dur, rev}  바깥 보조 링       orbit: [{sym|dot, c, d, rev, off}]  궤도를 도는 물체
     sp    : 반짝이 색 배열      fire: 불꽃 개수      bub: 거품 개수      bolt: 번개 표시      wings: 날개
     glitch: AURA 글리치       halo: 빛 맥박 */
  function conic(cols) { return 'conic-gradient(from 0deg,' + cols.concat(cols[0]).join(',') + ')'; }
  var RAINBOW = ['#ff5f6d', '#ffc371', '#fff27a', '#7dffa0', '#6fe0ff', '#8b7bff', '#ff7ae0'];
  var FR = {
    't-bronze':      { ring: conic(['#ffd0a3', '#c97a45', '#8a4a22', '#e0905a']), anim: 'spin', dur: 7, glow: 'rgba(224,144,90,.45)' },
    't-silver':      { ring: 'conic-gradient(from 0deg,#6f8394,#f4f9fd 14%,#6f8394 34%,#a9bccb 62%,#ffffff 82%,#6f8394)', anim: 'spin', dur: 2.6, glow: 'rgba(200,225,245,.5)', sp: ['#fff'] },
    't-gold':        { ring: conic(['#fff1a8', '#ffb800', '#ff7a00', '#ffe27a']), anim: 'pulse', dur: 1.8, glow: 'rgba(255,190,40,.75)', sp: ['#fff2a8', '#ffd24a'] },
    't-platinum':    { ring: 'repeating-conic-gradient(#e8fffb 0 12deg,rgba(63,208,201,.28) 12deg 24deg)', anim: 'spin', dur: 9, glow: 'rgba(120,230,230,.55)', sp: ['#d8fff8', '#8ce8ff'] },
    't-emerald':     { ring: conic(['#c9ffe0', '#22c98a', '#0f9d76', '#7dffc2']), anim: 'pulse', dur: 1.3, glow: 'rgba(34,201,138,.8)', sp: ['#c9ffe0'] },
    't-diamond':     { ring: conic(RAINBOW), anim: 'hue', dur: 2.2, glow: 'rgba(140,200,255,.7)', sp: ['#fff', '#bfe6ff'] },
    't-master':      { ring: conic(['#f2e2ff', '#9b5cff', '#4d1fd1', '#c89bff']), anim: 'spin', dur: 4, glow: 'rgba(155,92,255,.8)',
                       ring2: { bg: conic(['#ff7ac6', '#6a5cff', '#7df9ff', '#ff7ac6']), dur: 6, rev: 1 } },
    't-grandmaster': { ring: conic(['#ffe29a', '#ff7a1f', '#e8267a', '#a3124f', '#ff7a1f']), anim: 'flick', dur: 3.2, glow: 'rgba(255,90,40,.85)', fire: 5 },
    't-challenger':  { ring: 'repeating-conic-gradient(#e6f7ff 0 9deg,#2f7bff 9deg 22deg,rgba(10,20,80,.9) 22deg 40deg)', anim: 'flick', dur: 1.5, glow: 'rgba(80,170,255,.9)', bolt: 1 },
    't-myth':        { ring: conic(['#7df9ff', '#6a5cff', '#c026ff', '#ff4fd8', '#6a5cff']), anim: 'spin', dur: 8, glow: 'rgba(160,110,255,.85)',
                       orbit: [{ sym: '✦', c: '#fff2a8', d: 3.4 }, { dot: 1, c: '#7df9ff', d: 5.6, rev: 1, off: -2 }], sp: ['#ffffff', '#c9b6ff'] },
    't-legend':      { ring: conic(['#ff9bd0', '#ffe38a', '#9bffd8', '#9bc8ff', '#d69bff']), anim: 'hue', dur: 4, glow: 'rgba(255,220,150,.9)', halo: 1, wings: 1,
                       ring2: { bg: conic(['#fff1a8', '#ffb800', '#fff1a8', '#ff7a00']), dur: 7, rev: 1 }, sp: ['#fff6c8', '#ffe27a', '#fff'] },

    'g-first':    { ring: conic(['#d9fff7', '#6FF2E0', '#2fbfae', '#6FF2E0']), anim: 'pulse', dur: 2.4, glow: 'rgba(111,242,224,.6)' },
    'g-owl':      { ring: conic(['#2b3b7a', '#8fa6ff', '#1a2250', '#5a6fd6']), anim: 'spin', dur: 12, glow: 'rgba(120,140,255,.6)', orbit: [{ sym: '🌙', c: '#cfd8ff', d: 7 }], sp: ['#e6ecff'] },
    'g-early':    { ring: conic(['#ffe29a', '#ff9a5c', '#ff6f91', '#ffc86b']), anim: 'spin', dur: 8, glow: 'rgba(255,170,90,.7)', orbit: [{ sym: '☀️', c: '#ffd36b', d: 6, rev: 1 }] },
    'g-neon':     { ring: conic(['#ff4fd8', '#ff4fd8', '#4ff0ff', '#4ff0ff']), anim: 'flick', dur: 4, glow: 'rgba(255,79,216,.9)' },
    'g-crystal':  { ring: 'repeating-conic-gradient(#ffffff 0 8deg,rgba(130,230,255,.5) 8deg 20deg,rgba(190,210,255,.8) 20deg 28deg)', anim: 'spin', dur: 10, glow: 'rgba(160,235,255,.7)', sp: ['#fff', '#bff3ff', '#fff', '#d8ecff'] },
    'g-speed':    { ring: 'conic-gradient(from 0deg,rgba(20,50,80,.9) 0 62%,rgba(111,242,224,.0) 62%,#6FF2E0 96%,#fff 100%)', anim: 'spin', dur: .8, glow: 'rgba(111,242,224,.75)' },
    'g-lava':     { ring: conic(['#ff2d2d', '#ff9a1f', '#ffe23a', '#ff4d1f']), anim: 'flick', dur: 4.5, glow: 'rgba(255,70,30,.85)', fire: 3, halo: 1 },
    'g-rainbow':  { ring: conic(RAINBOW), anim: 'hue', dur: 3, glow: 'rgba(255,255,255,.55)' },
    'g-marathon': { ring: 'repeating-conic-gradient(#b9ffd4 0 14deg,rgba(255,255,255,.12) 14deg 28deg)', anim: 'spin', dur: 5, glow: 'rgba(120,255,180,.5)' },
    'g-blaze':    { ring: conic(['#ffd35f', '#ff5a1f', '#ff2d55', '#ffd35f']), anim: 'flick', dur: 3, glow: 'rgba(255,110,40,.85)', fire: 4, sp: ['#ffd27a'] },
    'g-pioneer':  { ring: conic(['#7df9d9', '#8b7bff', '#5ff0ff', '#8b7bff']), anim: 'spin', dur: 6, glow: 'rgba(130,160,255,.7)', orbit: [{ sym: '✦', c: '#cfe9ff', d: 4 }] },
    'g-storm':    { ring: conic(['#1b2a52', '#6f8cff', '#0e1530', '#d9e6ff', '#1b2a52']), anim: 'flick', dur: 2.2, glow: 'rgba(130,160,255,.9)', bolt: 1 },
    'g-matrix':   { ring: 'repeating-conic-gradient(#33ff8a 0 6deg,rgba(0,40,20,.9) 6deg 18deg)', anim: 'flick', dur: 1.8, glow: 'rgba(40,255,140,.8)' },
    'g-void':     { ring: conic(['#0b0020', '#7a2bff', '#0b0020', '#c05bff']), anim: 'spinr', dur: 5, glow: 'rgba(150,60,255,.9)', halo: 1,
                    ring2: { bg: conic(['rgba(150,60,255,0)', '#b05bff', 'rgba(150,60,255,0)', '#7a2bff']), dur: 3, rev: 0 } },
    'g-ocean':    { ring: conic(['#bff3ff', '#2f9bff', '#0b3a8a', '#4fd0ff']), anim: 'spin', dur: 9, glow: 'rgba(60,170,255,.7)', bub: 5 },

    'crown-gold':   { ring: conic(['#fff1a8', '#ffb800', '#ff7a00', '#ffe27a']), anim: 'spin', dur: 5, glow: 'rgba(255,190,40,.7)', deco: 'crown-gold', sp: ['#fff2a8'], halo: 1 },
    'crown-silver': { ring: conic(['#ffffff', '#9fb4c6', '#e9f1f8', '#7f93a6']), anim: 'spin', dur: 6, glow: 'rgba(200,225,245,.55)', deco: 'crown-silver', sp: ['#fff'] },
    'crown-bronze': { ring: conic(['#ffd0a3', '#c97a45', '#ffb27a', '#8a4a22']), anim: 'spin', dur: 7, glow: 'rgba(224,144,90,.5)', deco: 'crown-bronze' },
    'star':         { ring: conic(['#ffffff', '#ffd86b', '#ffffff', 'rgba(255,255,255,.35)']), anim: 'spin', dur: 6, glow: 'rgba(255,216,107,.5)', deco: 'star' },
    'x-aura':       { ring: conic(['#12002b', '#a10a6c', '#00506b', '#4b0a9a', '#12002b']), anim: 'hue', dur: 3.2, glow: 'rgba(190,60,255,.95)', glitch: 1, halo: 1,
                      orbit: [{ sym: '☠', c: '#e6b8ff', d: 4.5 }], sp: ['#ff4fe0', '#5ff0ff'] }
  };
  var FR_TWINKLE_POS = [[8, 12], [90, 18], [4, 78], [94, 74], [50, -6]];
  var FR_FIRE_POS = [[18, 2], [46, -2], [74, 3], [32, 0], [60, -1]];
  var FR_BUB_POS = [[14, 70], [30, 90], [52, 82], [72, 92], [86, 66]];

  /* avatarEl 을 링·왕관 등으로 감싼 요소를 돌려줍니다. frame: 위 카탈로그 id | null(= 등급 색 링), tierLevel: 1~12 */
  function framed(avatarEl, px, frame, tierLevel) {
    var def = frame && FR[frame] ? FR[frame] : null;
    var w = document.createElement('span'); w.className = 'kp-fr'; w.style.setProperty('--px', px + 'px');
    if (frame) w.setAttribute('data-frame', frame);
    var ringBg, anim = 'spin', dur = 5, glow = null;
    if (def) { ringBg = typeof def.ring === 'string' ? def.ring : conic(def.ring); anim = def.anim || 'spin'; dur = def.dur || 5; glow = def.glow; }
    else { var c = TIER_RING[Math.max(0, Math.min(11, (tierLevel || 1) - 1))]; ringBg = conic([c, '#ffffff', c, 'rgba(255,255,255,.35)']); }
    w.style.setProperty('--ring', ringBg); w.style.setProperty('--dur', dur + 's');
    if (glow) w.style.setProperty('--glow', glow);
    if (def && def.halo) w.classList.add('kp-halo');
    w.style.isolation = 'isolate';

    function add(tag, cls, parent, css) { var n = document.createElement(tag); n.className = cls; if (css) n.style.cssText = css; (parent || w).appendChild(n); return n; }

    if (def && def.wings) {
      ['l', 'r'].forEach(function (side) {
        var wg = add('span', 'kp-wing kp-wing--' + side);
        wg.innerHTML = '<svg viewBox="0 0 60 50" aria-hidden="true"><defs><linearGradient id="kpw' + side + '" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c8"/><stop offset=".6" stop-color="#ffd86b"/><stop offset="1" stop-color="#ff9bd0"/></linearGradient></defs>' +
          '<path d="M58 22 C44 4 22 2 2 8 C14 12 20 16 24 20 C14 20 8 22 4 28 C16 28 22 30 28 34 C20 36 16 40 14 46 C34 44 52 38 58 26 Z" fill="url(#kpw' + side + ')" stroke="rgba(120,60,0,.4)" stroke-width="1.2" stroke-linejoin="round"/></svg>';
      });
    }
    if (def && def.ring2) {
      var r2 = add('i', 'kp-fr-ring2 kp-ra-' + (def.ring2.rev ? 'spinr' : 'spin')); r2.style.background = def.ring2.bg; r2.style.animationDuration = def.ring2.dur + 's';
    }
    var ring = add('i', 'kp-fr-ring kp-ra-' + anim);
    if (def && def.glitch) {
      add('i', 'kp-fr-ring kp-gl kp-gl1'); add('i', 'kp-fr-ring kp-gl kp-gl2');
    }
    var inner = add('span', 'kp-fr-in'); inner.appendChild(avatarEl);

    if (def && def.orbit) def.orbit.forEach(function (o) {
      var orb = add('i', 'kp-orb'); orb.style.setProperty('--d', o.d + 's'); orb.style.setProperty('--oc', o.c);
      if (o.rev) orb.style.animationDirection = 'reverse'; if (o.off) orb.style.animationDelay = o.off + 's';
      var b = add('b', o.dot ? 'kp-orb-dot' : 'kp-orb-sym', orb);
      if (!o.dot) { var iEl = add('i', '', b); iEl.textContent = o.sym; iEl.style.animationDuration = o.d + 's'; iEl.style.animationName = o.rev ? 'kp-spin' : 'kp-spinr'; }
    });
    if (def && def.sp) FR_TWINKLE_POS.slice(0, Math.min(5, def.sp.length + 2)).forEach(function (pos, i) {
      var t = add('i', 'kp-sp'); t.textContent = '✦'; t.style.cssText = 'left:' + pos[0] + '%;top:' + pos[1] + '%;color:' + def.sp[i % def.sp.length] + ';animation-delay:' + (i * 0.55).toFixed(2) + 's';
    });
    if (def && def.fire) for (var f = 0; f < def.fire; f++) add('i', 'kp-fl', null, 'left:' + FR_FIRE_POS[f % 5][0] + '%;top:' + FR_FIRE_POS[f % 5][1] + '%;animation-delay:' + (f * 0.35).toFixed(2) + 's');
    if (def && def.bub) for (var q = 0; q < def.bub; q++) add('i', 'kp-bub', null, 'left:' + FR_BUB_POS[q % 5][0] + '%;top:' + FR_BUB_POS[q % 5][1] + '%;animation-delay:' + (q * 0.45).toFixed(2) + 's');
    if (def && def.bolt) { var bo = add('i', 'kp-bolt'); bo.textContent = '⚡'; }

    var deco = def && def.deco ? def.deco : (!def ? frame : null);
    if (CROWN_TONE[deco]) { var cr = add('span', 'kp-crown'); cr.innerHTML = crownSvg(deco); }
    else if (deco === 'star') { var st = add('span', 'kp-starpin'); st.innerHTML = STAR_SVG; }
    return w;
  }

  /* 리더보드 등에서 쓰는 작은 버전: 순위 1~3 이면 왕관을 씌움 */
  function rankFrame(rank) { return rank === 1 ? 'crown-gold' : rank === 2 ? 'crown-silver' : rank === 3 ? 'crown-bronze' : null; }

  /* ---------------- 프로필 사진 ---------------- */
  function avatar(username, ver, px, extraClass) {
    var span = document.createElement('span');
    span.className = 'kp-av' + (extraClass ? ' ' + extraClass : '');
    if (px) span.style.cssText = 'width:' + px + 'px;height:' + px + 'px;font-size:' + Math.round(px * 0.42) + 'px';
    var letter = String(username || '?').charAt(0).toUpperCase();
    span.textContent = letter;
    if (ver) {
      var img = document.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
      img.src = API_BASE + '/api/avatar?u=' + encodeURIComponent(username) + '&v=' + encodeURIComponent(ver);
      span.appendChild(img);
    }
    return span;
  }

  /* ---------------- API ---------------- */
  function token() { return global.Kiho && global.Kiho.isMember && global.Kiho.isMember() && global.Kiho.token ? global.Kiho.token() : null; }
  function api(path, opts) {
    opts = opts || {};
    var ctrl = new AbortController(); var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    var headers = { 'Accept': 'application/json' };
    var t = token(); if (t) headers['Authorization'] = 'Bearer ' + t;
    var init = { method: opts.method || 'GET', headers: headers, signal: ctrl.signal };
    if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API_BASE + path, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { status: res.status, ok: res.ok && !!data && data.success === true, data: data };
      });
    }).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ---------------- 프로필 팝업 ---------------- */
  var GAME_NAMES = {
    'number-forge': '넘버 포지', 'pixel-detective': '픽셀 탐정', 'mirror-beam': '미러 빔 랩',
    'code-breaker': '코드 브레이커', 'memory-grid': '메모리 그리드', 'light-switch': '라이트 스위치', 'color-flood': '컬러 플러드'
  };
  var DIFF_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', extreme: 'Extreme' };

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function fmtJoined(iso) {
    var d = new Date(String(iso || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso || '')) ? '' : 'Z'));
    return isNaN(d) ? '' : d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }

  var MODAL_CSS = [
    '.kp-modal{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:16px;background:rgba(3,14,22,.72);',
    '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:kp-in .18s ease-out}',
    '@keyframes kp-in{from{opacity:0}to{opacity:1}}',
    '.kp-card{position:relative;width:min(440px,100%);max-height:calc(100dvh - 32px);overflow:auto;border-radius:26px;color:#F2F8FB;',
    'background:linear-gradient(170deg,#12394e,#0a2a3c 60%,#08202f);box-shadow:0 40px 80px -20px rgba(0,0,0,.7),inset 0 0 0 1px rgba(255,255,255,.16);',
    'font-family:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;animation:kp-pop .22s cubic-bezier(.3,.9,.3,1.1)}',
    '@keyframes kp-pop{from{transform:translateY(14px) scale(.97);opacity:0}to{transform:none;opacity:1}}',
    '.kp-banner{height:104px;border-radius:26px 26px 0 0;background-color:#0f3347;background-image:linear-gradient(120deg,rgba(111,242,224,.18),rgba(124,139,255,.2));box-shadow:inset 0 -1px 0 rgba(255,255,255,.12)}',
    '.kp-x{position:absolute;right:12px;top:12px;width:34px;height:34px;border:0;border-radius:50%;background:rgba(3,14,22,.55);color:#fff;font-size:18px;line-height:1;cursor:pointer;display:grid;place-items:center}',
    '.kp-x:hover{background:rgba(3,14,22,.8)} .kp-x:focus-visible,.kp-link:focus-visible{outline:2px solid #6FF2E0;outline-offset:2px}',
    '.kp-head{display:flex;align-items:flex-end;gap:14px;padding:0 20px;margin-top:-38px}',
    '.kp-head .kp-av{background:linear-gradient(160deg,#3b6a82,#1c4458)}',
    '.kp-body{padding:12px 20px 20px}',
    '.kp-name{font-size:21px;font-weight:800;letter-spacing:-.02em;line-height:1.35}',
    '.kp-tier{display:inline-block;margin-top:2px;font-size:12.5px;color:#B9CDD8}',
    '.kp-bio{margin:12px 0 0;padding:11px 14px;border-radius:14px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);font-size:14.5px;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}',
    '.kp-bio--empty{color:#8FAAB8;font-style:italic}',
    '.kp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0 0}',
    '.kp-stat{padding:10px 8px;border-radius:14px;background:rgba(255,255,255,.06);text-align:center}',
    '.kp-stat b{display:block;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums}',
    '.kp-stat span{font-size:11.5px;color:#8FAAB8}',
    '.kp-h{margin:16px 2px 8px;font-size:13px;font-weight:700;color:#B9CDD8}',
    '.kp-places{list-style:none;margin:0;padding:0;display:grid;gap:6px}',
    '.kp-places li{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;background:rgba(255,255,255,.06);font-size:13.5px}',
    '.kp-places li b{min-width:44px;color:#6FF2E0;font-variant-numeric:tabular-nums} .kp-places li span{flex:1;min-width:0}',
    '.kp-places li em{font-style:normal;color:#B9CDD8;font-variant-numeric:tabular-nums}',
    '.kp-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;font-size:12.5px;color:#8FAAB8}',
    '.kp-link{display:inline-flex;align-items:center;height:36px;padding:0 16px;border-radius:999px;background:#6FF2E0;color:#062230;font-weight:700;font-size:13.5px;text-decoration:none}',
    '.kp-state{padding:46px 20px;text-align:center;color:#B9CDD8}',
    '.kp-banner{position:relative;overflow:hidden}',
    '.kp-banner::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.22) 50%,transparent 65%);transform:translateX(-120%);animation:kp-sweep 1.3s .25s ease-out forwards}',
    '@keyframes kp-sweep{to{transform:translateX(120%)}}',
    '.kp-spark{position:absolute;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 8px 2px rgba(255,230,140,.9);opacity:0;animation:kp-spark 2.6s ease-in-out infinite}',
    '@keyframes kp-spark{0%{opacity:0;transform:translateY(14px) scale(.4)}25%{opacity:1}100%{opacity:0;transform:translateY(-34px) scale(1)}}',
    '.kp-head{margin-top:-52px;align-items:flex-end}',
    '.kp-head .kp-fr{animation:kp-avpop .6s .15s cubic-bezier(.2,1.3,.4,1) both}',
    '.kp-head .kp-fr .kp-av{box-shadow:none}',
    '@keyframes kp-avpop{from{opacity:0;transform:scale(.4) rotate(-25deg)}to{opacity:1;transform:none}}',
    '.kp-rise{opacity:0;transform:translateY(12px);animation:kp-rise .5s calc(.3s + var(--i,0) * .07s) cubic-bezier(.2,.9,.3,1) forwards}',
    '@keyframes kp-rise{to{opacity:1;transform:none}}',
    '.kp-tierbox{margin-top:10px}',
    '.kp-tierline{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;color:#B9CDD8}',
    '.kp-tierline b{color:#fff;font-size:13px}',
    '.kp-bar{position:relative;height:8px;margin-top:6px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}',
    '.kp-bar i{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:99px;background:linear-gradient(90deg,#6FF2E0,#7C8BFF);box-shadow:0 0 10px rgba(111,242,224,.6);transition:width 1.1s .55s cubic-bezier(.2,.8,.2,1)}',
    '.kp-bar--d i{background:var(--c,#6FF2E0);box-shadow:none}',
    '.kp-diffs{display:grid;gap:8px}',
    '.kp-diff{display:grid;grid-template-columns:62px 1fr auto;align-items:center;gap:10px;font-size:12.5px;color:#B9CDD8}',
    '.kp-diff .kp-bar{margin:0}.kp-diff em{font-style:normal;color:#fff;font-weight:700;font-variant-numeric:tabular-nums;min-width:34px;text-align:right}',
    '.kp-coll{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
    '.kp-collc{padding:11px 12px;border-radius:14px;background:rgba(255,255,255,.06)}',
    '.kp-collc div{display:flex;justify-content:space-between;align-items:baseline;gap:4px;font-size:12px;color:#B9CDD8}.kp-collc div b{color:#fff;font-size:13.5px;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.kp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}',
    '.kp-chip{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:99px;background:rgba(255,255,255,.08);font-size:12px;color:#dfeaf0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}',
    '.kp-chip--gold{background:linear-gradient(90deg,rgba(255,200,60,.28),rgba(255,140,40,.2));color:#ffe9a8;box-shadow:inset 0 0 0 1px rgba(255,200,60,.45)}',
    '.kp-places li:first-child b{color:#ffd86b}',
    '@media (prefers-reduced-motion:reduce){.kp-rise,.kp-head .kp-fr{animation:none;opacity:1;transform:none}.kp-banner::after,.kp-spark{display:none}.kp-bar i{transition:none}}',
    '@media (prefers-reduced-motion:reduce){.kp-modal,.kp-card{animation:none}}'
  ].join('');
  var modalCssDone = false;

  function ensureModalCss() {
    if (modalCssDone) return;
    var st = document.createElement('style'); st.textContent = MODAL_CSS + FX_CSS + '.kp-card--inline{width:100%;max-height:none;overflow:hidden;animation:none}' +
      '.kp-noanim .kp-rise,.kp-noanim .kp-fr,.kp-noanim .kp-head .kp-fr{animation:none!important;opacity:1!important;transform:none!important}.kp-noanim .kp-banner::after{display:none}.kp-noanim .kp-bar i{transition:none}';
    document.head.appendChild(st); modalCssDone = true;
  }

  var openState = null;

  function close() {
    if (!openState) return;
    var s = openState; openState = null;
    document.removeEventListener('keydown', s.onKey, true);
    if (s.root.parentNode) s.root.parentNode.removeChild(s.root);
    document.documentElement.style.overflow = s.prevOverflow;
    if (s.opener && s.opener.focus) { try { s.opener.focus(); } catch (e) {} }
  }

  function open(username) {
    if (!username) return;
    close();
    ensureModalCss();
    var root = el('div', 'kp-modal');
    var card = el('div', 'kp-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', String(username) + ' 프로필');
    var x = el('button', 'kp-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.addEventListener('click', close);
    card.appendChild(el('div', 'kp-banner')); card.appendChild(x);
    var body = el('div', 'kp-state', '불러오는 중…'); card.appendChild(body);
    root.appendChild(card);
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });

    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    var state = { root: root, onKey: onKey, prevOverflow: document.documentElement.style.overflow, opener: document.activeElement };
    openState = state;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(root);
    x.focus();

    api('/api/profile?u=' + encodeURIComponent(username)).then(function (r) {
      if (openState !== state) return;
      if (!r.ok) {
        body.textContent = (r.data && r.data.error) || (r.status === 404 ? '존재하지 않는 사용자예요.' : '프로필을 불러오지 못했어요.');
        return;
      }
      fill(card, body, r.data.profile, root);
    }, function (e) {
      if (openState !== state) return;
      body.textContent = e && e.name === 'AbortError' ? '서버 응답이 늦어지고 있어요.' : '서버에 연결하지 못했어요.';
    });
  }

  var REDUCED = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var DIFF_COLOR = { easy: '#9BF7CC', normal: '#8fd0ff', hard: '#ffc85a', extreme: '#ff8a9a' };

  function countUp(node, to, render, delay) {
    to = Number(to) || 0;
    if (REDUCED || to === 0) { node.textContent = render(to); return; }
    node.textContent = render(0);
    var start = null, dur = 900;
    setTimeout(function () {
      function step(ts) {
        if (!node.isConnected) return;
        if (start === null) start = ts;
        var k = Math.min(1, (ts - start) / dur); k = 1 - Math.pow(1 - k, 3);
        node.textContent = render(Math.round(to * k));
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }, delay);
  }
  function rise(node, i) { node.classList.add('kp-rise'); node.style.setProperty('--i', String(i)); return node; }
  function fmtTime(ms) { if (ms == null) return '-'; var s = ms / 1000; return s < 60 ? s.toFixed(1) + '초' : Math.floor(s / 60) + '분 ' + Math.round(s % 60) + '초'; }


  /* ───────── 프로필 입장 애니메이션 (캔버스 파티클 + 연출) ───────── */
  var FX_CSS = [
    '.kp-fx{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:6}',
    '.kp-fx canvas{position:absolute;left:0;top:0;width:100%;height:100%}',
    '.kp-flash{position:absolute;inset:0;background:var(--c,#fff);opacity:0;animation:kp-flash var(--d,.9s) ease-out both}',
    '@keyframes kp-flash{0%{opacity:0}7%{opacity:var(--o,.5)}100%{opacity:0}}',
    '.kp-ring{position:absolute;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;border:3px solid var(--c,#fff);box-shadow:0 0 24px var(--c,#fff),inset 0 0 18px var(--c,#fff);opacity:0;animation:kp-ring var(--d,1.1s) cubic-bezier(.12,.7,.3,1) both}',
    '@keyframes kp-ring{0%{opacity:.95;transform:scale(.2)}100%{opacity:0;transform:scale(var(--k,14))}}',
    '.kp-beam{position:absolute;top:-10%;bottom:-10%;width:var(--w,80px);margin-left:calc(var(--w,80px) / -2);background:linear-gradient(90deg,transparent,var(--c,#fff),transparent);opacity:0;mix-blend-mode:screen;animation:kp-beam 1.6s ease-out both}',
    '@keyframes kp-beam{0%{opacity:0;transform:scaleX(0)}16%{opacity:.9;transform:scaleX(1)}100%{opacity:0;transform:scaleX(.15)}}',
    '.kp-aur{position:absolute;left:var(--x,50%);top:var(--y,8%);width:80%;height:55%;margin-left:-40%;border-radius:50%;background:radial-gradient(ellipse,var(--c,#6ff2e0),transparent 68%);filter:blur(34px);opacity:0;animation:kp-aur 3.2s ease-in-out both}',
    '@keyframes kp-aur{0%{opacity:0;transform:translate(-10%,8%) scale(.8)}35%{opacity:.75}100%{opacity:0;transform:translate(12%,-10%) scale(1.25)}}',
    '.kp-glowb{position:absolute;left:0;right:0;bottom:0;height:75%;background:linear-gradient(0deg,var(--c,#ff6a1f),transparent);opacity:0;animation:kp-glowb 2.6s ease-out both}',
    '@keyframes kp-glowb{0%{opacity:0;transform:translateY(45%)}28%{opacity:.8;transform:none}100%{opacity:0}}',
    '.kp-sweep{position:absolute;top:-20%;bottom:-20%;left:-40%;width:30%;background:linear-gradient(100deg,transparent,var(--c,#fff),transparent);opacity:.85;animation:kp-sweep 1.1s ease-out both}',
    '@keyframes kp-sweep{from{transform:translateX(0) skewX(-18deg)}to{transform:translateX(var(--tx,900px)) skewX(-18deg)}}',
    '.kp-rays{position:absolute;left:var(--x,50%);top:var(--y,50%);width:240vmax;height:240vmax;margin:-120vmax 0 0 -120vmax;opacity:0;',
    'background:repeating-conic-gradient(from 0deg,var(--c,#ffd35f) 0 7deg,transparent 7deg 20deg);-webkit-mask-image:radial-gradient(circle,#000 0,transparent 36%);mask-image:radial-gradient(circle,#000 0,transparent 36%);animation:kp-rays 2.6s ease-out both}',
    '@keyframes kp-rays{0%{opacity:0;transform:rotate(0) scale(.4)}22%{opacity:.5}100%{opacity:0;transform:rotate(70deg) scale(1)}}',
    '.kp-spot{position:absolute;left:var(--x,50%);top:0;width:76%;height:100%;margin-left:-38%;background:linear-gradient(180deg,rgba(255,255,255,.75),rgba(255,255,255,0) 88%);clip-path:polygon(42% 0,58% 0,100% 100%,0 100%);opacity:0;animation:kp-spot 2.4s ease-out both}',
    '@keyframes kp-spot{0%{opacity:0}25%{opacity:1}75%{opacity:.85}100%{opacity:0}}',
    '.kp-dropc{position:absolute;left:var(--x,50%);top:0;margin-left:-38px;font-size:76px;line-height:1;filter:drop-shadow(0 6px 16px rgba(255,190,40,.9));animation:kp-dropc 2.4s cubic-bezier(.3,1.5,.5,1) both}',
    '@keyframes kp-dropc{0%{opacity:0;transform:translateY(-160px) rotate(-24deg) scale(1.4)}26%{opacity:1;transform:translateY(var(--ty,40px)) rotate(8deg) scale(1)}38%{transform:translateY(calc(var(--ty,40px) - 18px)) rotate(-4deg)}50%{transform:translateY(var(--ty,40px)) rotate(0)}82%{opacity:1}100%{opacity:0;transform:translateY(var(--ty,40px)) scale(1.5)}}',
    '.kp-cap{position:absolute;left:0;right:0;top:12%;text-align:center;font:900 26px/1.2 system-ui,sans-serif;letter-spacing:.32em;color:var(--c,#fff);text-shadow:0 0 22px var(--c,#fff),0 2px 8px rgba(0,0,0,.6);opacity:0;animation:kp-cap 2.4s ease both}',
    '@keyframes kp-cap{0%{opacity:0;transform:scale(1.8);letter-spacing:.9em}25%{opacity:1;transform:none;letter-spacing:.32em}75%{opacity:1}100%{opacity:0}}',
    '.kp-cglow{position:absolute;border-radius:26px;opacity:0;animation:kp-cglow 1.4s ease-out both}',
    '@keyframes kp-cglow{0%{opacity:1;box-shadow:0 0 0 0 var(--c),0 0 36px 4px var(--c)}100%{opacity:0;box-shadow:0 0 0 54px transparent,0 0 110px 36px transparent}}',
    '.kp-card.kp-in-zoom{animation:kp-c-zoom .9s cubic-bezier(.2,.9,.25,1.15) both}',
    '.kp-card.kp-in-drop{animation:kp-c-drop .95s cubic-bezier(.3,1.35,.5,1) both}',
    '.kp-card.kp-in-implode{animation:kp-c-imp 1.1s cubic-bezier(.2,.9,.3,1.1) both}',
    '.kp-card.kp-in-glitch{animation:kp-c-gl 1s steps(1,end) both}',
    '.kp-card.kp-in-slide{animation:kp-c-slide .7s cubic-bezier(.1,.9,.2,1) both}',
    '.kp-card.kp-in-rise{animation:kp-c-rise 1.1s cubic-bezier(.2,.8,.3,1) both}',
    '.kp-card.kp-in-shake{animation:kp-c-shake 1s ease-out both}',
    '.kp-card.kp-in-slam{animation:kp-c-slam 1s cubic-bezier(.2,.8,.3,1) both}',
    '.kp-card.kp-in-flip{animation:kp-c-flip 1.1s cubic-bezier(.2,.9,.3,1.1) both}',
    '.kp-card.kp-in-warp{animation:kp-c-warp 1.1s cubic-bezier(.15,.8,.3,1) both}',
    '@keyframes kp-c-zoom{0%{opacity:0;transform:scale(.5);filter:blur(12px) brightness(2.4)}55%{opacity:1;transform:scale(1.06);filter:none}100%{transform:none}}',
    '@keyframes kp-c-drop{0%{opacity:0;transform:translateY(-140px) scale(.9)}58%{opacity:1;transform:translateY(10px)}78%{transform:translateY(-5px)}100%{transform:none}}',
    '@keyframes kp-c-imp{0%{opacity:0;transform:scale(.05) rotate(-240deg);filter:brightness(3.5)}68%{opacity:1;transform:scale(1.07) rotate(7deg);filter:none}100%{transform:none}}',
    '@keyframes kp-c-gl{0%{opacity:0}10%{opacity:1;transform:translate(-16px,0) skewX(9deg);filter:hue-rotate(90deg)}20%{transform:translate(14px,-4px);filter:hue-rotate(-60deg)}30%{transform:translate(-7px,6px) skewX(-7deg);opacity:.5}40%{transform:translate(9px,0);opacity:1;filter:none}55%{transform:translate(-3px,0);filter:hue-rotate(40deg)}70%{transform:none;filter:none}100%{transform:none}}',
    '@keyframes kp-c-slide{0%{opacity:0;transform:translateX(-90vw) skewX(-16deg)}70%{opacity:1;transform:translateX(12px) skewX(3deg)}100%{transform:none}}',
    '@keyframes kp-c-rise{0%{opacity:0;transform:translateY(110px) scale(.9);filter:blur(8px)}100%{opacity:1;transform:none;filter:none}}',
    '@keyframes kp-c-shake{0%{opacity:0;transform:scale(1.25)}12%{opacity:1;transform:translate(-10px,5px)}24%{transform:translate(10px,-5px)}36%{transform:translate(-6px,4px)}48%{transform:translate(5px,-3px)}60%{transform:translate(-3px,2px)}100%{transform:none}}',
    '@keyframes kp-c-slam{0%{opacity:0;transform:scale(2.8) rotate(-5deg);filter:blur(16px) brightness(2.4)}42%{opacity:1;transform:scale(.93);filter:none}56%{transform:scale(1.03) translate(6px,-4px)}70%{transform:translate(-5px,3px)}84%{transform:translate(2px,-1px)}100%{transform:none}}',
    '@keyframes kp-c-flip{0%{opacity:0;transform:perspective(900px) rotateY(-110deg) scale(.8)}60%{opacity:1;transform:perspective(900px) rotateY(9deg) scale(1.02)}100%{transform:perspective(900px) rotateY(0)}}',
    '@keyframes kp-c-warp{0%{opacity:0;transform:perspective(700px) translateZ(-900px) rotateX(40deg);filter:blur(14px)}60%{opacity:1;transform:perspective(700px) translateZ(30px) rotateX(-3deg);filter:none}100%{transform:perspective(700px) translateZ(0)}}',
    '@media (prefers-reduced-motion:reduce){.kp-fx{display:none}.kp-card[class*=kp-in-]{animation:none}}'
  ].join('');

  var RAINBOW = ['#ff6b9d', '#ffd35f', '#5fffb0', '#5fd0ff', '#b48bff'];
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* 연출 정의: card=카드 등장 방식, dur=최대 길이(ms), build(f)=연출 예약.
     f.burst/over/vortex/bolt/ring/flash/beam/aurora/glowb/rays/spot/sweep/cap/crown/cglow/glitch/matrix/firework */
  var INTROS = {
    'i-spark': { card: 'slam', dur: 3200, build: function (f) {
      f.flash(0, '#ff9a4a', .4); f.ring(0, '#ff9a4a'); f.ring(140, '#ffd9a8', 10); f.cglow(420, '#ff9a4a');
      f.burst(0, f.cx, f.cy, 110, { v: [300, 1000], g: 900, drag: .97, l: [700, 1500], s: [1.4, 3.2], c: ['#ffb066', '#ff8a3d', '#ffd9a8'], shape: 'spark' });
      f.burst(220, f.cx, f.cy, 60, { v: [120, 520], g: 650, l: [900, 1700], s: [2, 4.5], c: ['#ffd35f', '#ff8a3d'] });
      f.over(300, 1700, 70, function () { return f.up(['#ffb066', '#ff6a1f', '#ffd35f']); });
    } },
    'i-sweep': { card: 'slide', dur: 3000, build: function (f) {
      f.sweep(0, '#e6f0ff'); f.sweep(260, '#9fb4c6'); f.sweep(520, '#fff'); f.ring(500, '#cfe0f5', 12); f.cglow(560, '#cfe0f5');
      f.over(300, 1800, 46, function () { return { x: rnd(f.cx - 230 * f.S, f.cx + 230 * f.S), y: rnd(f.cy - 300 * f.S, f.cy + 300 * f.S), max: rnd(.7, 1.3), size: rnd(8, 18) * f.S, c: pick(['#fff', '#cfe0f5', '#9fb4c6']), shape: 'star', rot: rnd(0, 1), vr: rnd(-1, 1) }; });
    } },
    'i-gold': { card: 'drop', dur: 3400, build: function (f) {
      f.flash(0, '#ffd35f', .3); f.cglow(650, '#ffd35f'); f.ring(650, '#ffd35f', 12);
      f.over(0, 1700, 150, function () { return f.fall(['#ffd35f', '#ffb81f', '#fff0a8', '#ffe38a'], 'rect', 6); });
      f.burst(650, f.cx, f.cy, 36, { v: [150, 600], g: 500, l: [900, 1600], s: [8, 15], c: ['#fff6c8', '#ffd35f'], shape: 'star' });
      f.over(500, 1800, 30, function () { return { x: rnd(0, f.W), y: rnd(0, f.H), max: rnd(.6, 1.2), size: rnd(8, 16) * f.S, c: '#fff6c8', shape: 'star', rot: rnd(0, 1) }; });
    } },
    'i-frost': { card: 'zoom', dur: 3400, build: function (f) {
      f.flash(0, '#bff3ff', .45); f.ring(0, '#8ce8ff'); f.ring(160, '#d8fbff', 12); f.cglow(450, '#8ce8ff');
      f.burst(0, f.cx, f.cy, 80, { v: [200, 900], drag: .95, g: 60, l: [900, 1700], s: [1.6, 3], c: ['#d8fbff', '#8ce8ff', '#fff'], shape: 'spark' });
      f.burst(100, f.cx, f.cy, 46, { v: [60, 340], drag: .96, g: 40, l: [1400, 2400], s: [8, 18], c: ['#d8fbff', '#8ce8ff', '#fff'], shape: 'star' });
      f.over(200, 1800, 80, function () { return f.fall(['#fff', '#d8fbff', '#8ce8ff'], 'dot', 3, 110); });
    } },
    'i-leaf': { card: 'rise', dur: 3300, build: function (f) {
      f.flash(0, '#3fd98f', .22); f.aurora(0, ['#3fd98f', '#7dffb5']);
      f.vortex(0, f.cx, f.cy, 90, { r: [260, 520], vr: [-260, -150], w: [3.2, 5.2], c: ['#7dffb5', '#3fd98f', '#c9ffe0'], shape: 'petal', s: [6, 12], max: [1.2, 1.7] });
      f.ring(1100, '#7dffb5', 12); f.cglow(1100, '#3fd98f');
      f.burst(1100, f.cx, f.cy, 70, { v: [120, 600], drag: .95, g: 80, l: [900, 1600], s: [2, 4], c: ['#7dffb5', '#c9ffe0'] });
    } },
    'i-prism': { card: 'flip', dur: 3300, build: function (f) {
      RAINBOW.forEach(function (c, i) { f.beam(i * 110, c, (12 + i * 19) / 100, 90 * f.S); f.ring(i * 130 + 200, c, 11 + i); });
      f.sweep(100, '#fff'); f.cglow(600, '#fff');
      f.burst(300, f.cx, f.cy, 140, { v: [250, 1000], drag: .96, g: 120, l: [900, 1800], s: [1.6, 3.4], c: RAINBOW, shape: 'spark' });
      f.burst(600, f.cx, f.cy, 40, { v: [100, 460], drag: .96, l: [1200, 2000], s: [8, 16], c: RAINBOW, shape: 'star' });
    } },
    'i-nebula': { card: 'implode', dur: 3400, build: function (f) {
      f.aurora(0, ['#9b5cff', '#ff7ac6']); f.flash(900, '#c89bff', .45);
      f.vortex(0, f.cx, f.cy, 120, { r: [300, 620], vr: [-300, -180], w: [3, 6], c: ['#c89bff', '#ff7ac6', '#8fd0ff', '#fff'], shape: 'star', s: [5, 12], max: [1.2, 1.8] });
      f.ring(950, '#c89bff', 13); f.ring(1100, '#ff7ac6', 9); f.cglow(1000, '#9b5cff');
      f.burst(950, f.cx, f.cy, 90, { v: [150, 800], drag: .95, l: [900, 1800], s: [1.6, 3.6], c: ['#c89bff', '#ff7ac6', '#fff'] });
    } },
    'i-flame': { card: 'slam', dur: 3400, build: function (f) {
      f.glowb(0, '#ff6a1f'); f.flash(0, '#ff6a1f', .4); f.ring(120, '#ff3d2e'); f.cglow(420, '#ff6a1f');
      f.over(0, 1900, 220, function () { return f.up(['#ffd35f', '#ff8a3d', '#ff3d2e', '#fff0a8'], 1.4); });
      f.burst(120, f.cx, f.cy, 70, { v: [200, 800], g: -120, drag: .96, l: [800, 1500], s: [3, 7], c: ['#ffd35f', '#ff6a1f', '#ff3d2e'] });
    } },
    'i-bolt': { card: 'shake', dur: 3000, build: function (f) {
      [0, 260, 540].forEach(function (t, i) {
        f.bolt(t, f.W * (.28 + i * .22), '#bfe6ff'); f.flash(t, '#cfefff', .7, .5);
        f.burst(t + 90, f.W * (.28 + i * .22), f.cy, 55, { v: [200, 800], g: 500, drag: .95, l: [500, 1100], s: [1.4, 3], c: ['#fff', '#9be8ff', '#fff36b'], shape: 'spark' });
        f.ring(t + 90, '#9be8ff', 9, f.W * (.28 + i * .22), f.cy);
      });
      f.cglow(560, '#9be8ff');
    } },
    'i-galaxy': { card: 'implode', dur: 3600, build: function (f) {
      f.aurora(0, ['#6a5cff', '#c026ff']); f.rays(700, '#c026ff');
      f.vortex(0, f.cx, f.cy, 190, { r: [320, 700], vr: [-340, -200], w: [3.5, 7], c: ['#7df9ff', '#c026ff', '#ff4fd8', '#fff'], shape: 'star', s: [4, 11], max: [1.2, 1.9], flat: .55 });
      f.flash(1000, '#c026ff', .5); f.ring(1000, '#7df9ff', 14); f.ring(1150, '#ff4fd8', 10); f.ring(1300, '#c026ff', 7); f.cglow(1050, '#c026ff');
      f.burst(1000, f.cx, f.cy, 140, { v: [200, 1000], drag: .95, l: [900, 2000], s: [1.6, 3.6], c: ['#7df9ff', '#ff4fd8', '#fff'] });
    } },
    'i-legend': { card: 'drop', dur: 3800, build: function (f) {
      f.aurora(0, ['#ffe38a', '#ff9bd0']); f.aurora(300, ['#9bffd8', '#9bc8ff']); f.rays(200, '#ffe38a');
      [.2, .5, .8].forEach(function (x, i) { f.beam(i * 140, '#ffe38a', x, 100 * f.S); });
      f.flash(300, '#ffe38a', .4); f.ring(650, '#ffe38a', 13); f.ring(800, '#ff9bd0', 9); f.cglow(700, '#ffe38a'); f.cap(350, '✦ LEGEND ✦', '#ffe38a');
      f.over(300, 2000, 130, function () { return f.fall(['#ffe38a', '#ff9bd0', '#9bffd8', '#9bc8ff'], 'star', 10, 140); });
      f.burst(650, f.cx, f.cy, 90, { v: [200, 900], drag: .95, g: 160, l: [900, 1800], s: [1.8, 3.6], c: ['#ffe38a', '#fff'], shape: 'spark' });
    } },
    'i-owl': { card: 'rise', dur: 3400, build: function (f) {
      f.flash(0, '#050a28', .5, 1.4);
      f.over(150, 1800, 16, function () { var s = f.W * rnd(.4, 1), dx = -rnd(500, 800) * f.S, dy = rnd(280, 440) * f.S; return { x: s, y: rnd(-30, f.H * .3), vx: dx, vy: dy, max: rnd(.8, 1.3), size: rnd(2, 3.4), c: pick(['#fff', '#bfe3ff']), shape: 'spark', drag: 1 }; });
      f.over(0, 2200, 70, function () { return { x: rnd(0, f.W), y: rnd(0, f.H), max: rnd(.8, 1.6), size: rnd(5, 12) * f.S, c: pick(['#fff', '#cfe0ff']), shape: 'star', rot: rnd(0, 1) }; });
      f.cglow(700, '#bfe3ff');
    } },
    'i-sakura': { card: 'rise', dur: 3600, build: function (f) {
      f.flash(0, '#ffb7d5', .22); f.cglow(600, '#ff8fbd');
      f.over(0, 2200, 140, function () { var p = f.fall(['#ffb7d5', '#ff8fbd', '#ffe0ee'], 'petal', 8, 60); p.vx = rnd(60, 220) * f.S; p.x = rnd(-f.W * .3, f.W); p.g = 30; return p; });
    } },
    'i-glitch': { card: 'glitch', dur: 2600, build: function (f) {
      f.glitch(0, 900); f.flash(0, '#ff2fd0', .35, .6); f.flash(180, '#2ff3ff', .3, .6); f.cglow(900, '#2ff3ff');
      f.burst(900, f.cx, f.cy, 50, { v: [200, 700], drag: .94, l: [400, 900], s: [2, 4], c: ['#ff2fd0', '#2ff3ff', '#fff'], shape: 'bar' });
    } },
    'i-matrix': { card: 'warp', dur: 3400, build: function (f) {
      f.flash(0, '#00ff66', .15); f.matrix(0); f.cglow(900, '#00ff66');
    } },
    'i-void': { card: 'implode', dur: 3400, build: function (f) {
      f.flash(0, '#000', .7, 1.6); f.ring(0, '#7a2cff', 3); 
      f.vortex(0, f.cx, f.cy, 150, { r: [320, 700], vr: [-340, -200], w: [3, 6], c: ['#7a2cff', '#b48bff', '#2a0a55', '#fff'], shape: 'dot', s: [2, 6], max: [1.2, 1.8] });
      f.flash(1050, '#b48bff', .5); f.ring(1050, '#b48bff', 14); f.ring(1200, '#7a2cff', 10); f.cglow(1100, '#7a2cff');
      f.burst(1050, f.cx, f.cy, 120, { v: [250, 1000], drag: .95, l: [900, 1800], s: [1.6, 3.4], c: ['#b48bff', '#7a2cff', '#fff'], shape: 'spark' });
    } },
    'i-rainbow': { card: 'zoom', dur: 3400, build: function (f) {
      RAINBOW.forEach(function (c, i) { f.ring(i * 120, c, 10 + i * 2); });
      f.rays(0, '#ff9bd0'); f.cglow(500, '#fff');
      f.burst(100, f.cx, f.cy, 150, { v: [200, 1000], drag: .96, g: 140, l: [900, 1900], s: [2, 5], c: RAINBOW });
      f.burst(400, f.cx, f.cy, 36, { v: [100, 520], drag: .96, l: [1200, 2000], s: [8, 16], c: RAINBOW, shape: 'star' });
    } },
    'i-speed': { card: 'slide', dur: 2800, build: function (f) {
      f.flash(0, '#fff', .3, .5);
      f.over(0, 900, 90, function () { var y = rnd(0, f.H); return { x: -80, y: y, vx: rnd(1800, 3400) * f.S, vy: 0, max: rnd(.5, .9), size: rnd(1.4, 3), c: pick(['#fff', '#6ff2e0', '#8fd0ff']), shape: 'spark', drag: 1 }; });
      f.ring(300, '#6ff2e0', 11); f.cglow(420, '#6ff2e0');
    } },
    'i-ocean': { card: 'rise', dur: 3600, build: function (f) {
      f.glowb(0, '#0a6aa8'); f.flash(0, '#0a4a7a', .3);
      f.over(0, 2400, 110, function () { var p = f.up(['#8ce8ff', '#d8fbff', '#58a8ff'], 1.6); p.shape = 'bubble'; p.size = rnd(4, 16) * f.S; p.vx = rnd(-20, 20); return p; });
      f.cglow(700, '#58a8ff');
    } },
    'i-pioneer': { card: 'zoom', dur: 3400, build: function (f) {
      [0, 260, 520].forEach(function (t) {
        f.burst(t, f.cx, f.cy, 46, { v: [200, 900], drag: .95, g: 120, l: [900, 1700], s: [10, 20], c: ['#ffd35f', '#ff5fd2', '#5ff0ff'], shape: 'star' });
        f.ring(t, ['#ffd35f', '#ff5fd2', '#5ff0ff'][t / 260], 12);
      });
      f.cglow(560, '#ffd35f');
    } },
    'i-top10': { card: 'zoom', dur: 3600, build: function (f) {
      f.flash(0, '#fff', .25);
      [[.22, .3], [.78, .32], [.5, .2], [.3, .62], [.7, .6]].forEach(function (p, i) { f.firework(i * 260, f.W * p[0], f.H * p[1], [['#ffd35f', '#fff'], ['#ff9bd0', '#fff'], ['#9bffd8', '#fff'], ['#9bc8ff', '#fff'], ['#ffd35f', '#ff9bd0']][i]); });
      f.cglow(500, '#ffd35f');
    } },
    'i-podium': { card: 'drop', dur: 3600, build: function (f) {
      f.spot(0); f.ring(500, '#fff', 12); f.cglow(550, '#fff');
      f.over(300, 1800, 60, function () { return { x: rnd(0, f.W), y: rnd(0, f.H), max: rnd(.7, 1.4), size: rnd(8, 18) * f.S, c: pick(['#fff', '#ffe9a8']), shape: 'star', rot: rnd(0, 1) }; });
      f.over(500, 1800, 90, function () { return f.fall(['#ffd35f', '#fff', '#c0c8d8', '#d68a4a'], 'rect', 6); });
    } },
    'i-crown': { card: 'slam', dur: 4000, build: function (f) {
      f.rays(0, '#ffd35f'); f.flash(0, '#ffd35f', .4); f.crown(0); f.cap(500, '👑 1위의 입장', '#ffd35f');
      f.ring(600, '#ffd35f', 13); f.ring(760, '#fff', 9); f.cglow(650, '#ffd35f');
      [[.2, .28], [.8, .3], [.5, .18], [.28, .65], [.74, .62]].forEach(function (p, i) { f.firework(500 + i * 240, f.W * p[0], f.H * p[1], ['#ffd35f', '#fff']); });
      f.over(500, 2200, 150, function () { return f.fall(['#ffd35f', '#ff4d6d', '#5fd0ff', '#5fffb0', '#fff'], 'rect', 7); });
    } },
    'x-aura': { card: 'warp', dur: 4000, build: function (f) {
      f.aurora(0, ['#6ff2e0', '#ff5fd2']); f.aurora(300, ['#b48bff', '#6ff2e0']); f.rays(500, '#6ff2e0');
      f.flash(0, '#fff', .8, .5); f.flash(260, '#fff', .6, .5);
      f.vortex(0, f.cx, f.cy, 170, { r: [320, 700], vr: [-340, -200], w: [3.5, 7], c: ['#6ff2e0', '#ff5fd2', '#b48bff', '#fff'], shape: 'star', s: [4, 11], max: [1.2, 1.9] });
      f.ring(1000, '#6ff2e0', 14); f.ring(1150, '#ff5fd2', 10); f.ring(1300, '#b48bff', 7); f.cglow(1050, '#6ff2e0'); f.cap(900, 'A U R A', '#6ff2e0');
      f.burst(1000, f.cx, f.cy, 150, { v: [200, 1000], drag: .95, l: [900, 2000], s: [1.6, 3.6], c: ['#6ff2e0', '#ff5fd2', '#fff'], shape: 'spark' });
      f.over(900, 2200, 16, function () { var p = f.up(['#e8fffb'], 3); p.shape = 'char'; p.ch = '☠'; p.size = rnd(14, 26) * f.S; p.vy = -rnd(60, 140); return p; });
    } }
  };
  var INTRO_IDS = Object.keys(INTROS);

  function stopFx(host) {
    var old = host.querySelector(':scope > .kp-fx');
    if (old) { if (old._stop) old._stop(); if (old.parentNode) old.parentNode.removeChild(old); }
  }

  /* host: 효과를 깔 요소(position 이 잡혀 있어야 함), card: 등장할 카드, id: 입장 효과 id */
  function playIntro(host, card, id) {
    ensureModalCss();
    stopFx(host);
    if (card) { for (var c = card.classList.length - 1; c >= 0; c--) if (card.classList[c].indexOf('kp-in-') === 0) card.classList.remove(card.classList[c]); }
    var spec = INTROS[id];
    if (!spec || REDUCED) return;

    var hr = host.getBoundingClientRect(), W = host.clientWidth || 400, H = host.clientHeight || 600;
    var cr = card ? card.getBoundingClientRect() : null;
    var cx = cr ? cr.left - hr.left + cr.width / 2 : W / 2, cy = cr ? cr.top - hr.top + Math.min(cr.height, H) / 2 : H / 2;
    var layer = el('div', 'kp-fx'), cv = el('canvas');
    var dpr = Math.min(2, global.devicePixelRatio || 1); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    layer.appendChild(cv); host.appendChild(layer);
    var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);

    var S = Math.max(.6, Math.min(1.4, Math.min(W, H) / 640));
    var parts = [], bolts = [], tl = [], raf = 0, dead = false;
    function at(t, fn) { tl.push({ t: t, fn: fn }); }
    function add(o) {
      o.age = 0; o.max = o.max || 1; o.drag = o.drag == null ? 1 : o.drag; o.g = o.g || 0; o.vx = o.vx || 0; o.vy = o.vy || 0;
      o.size = o.size || 3; o.shape = o.shape || 'dot'; o.rot = o.rot || 0; o.vr = o.vr == null ? rnd(-4, 4) : o.vr; o.fp = rnd(0, 6.28); o.fv = rnd(4, 9); parts.push(o);
    }
    function dom(t, node) { at(t, function () { layer.appendChild(node); }); }
    function nodeWith(cls, vars, text) { var n = el('div', cls, text); Object.keys(vars || {}).forEach(function (k) { n.style.setProperty(k, vars[k]); }); return n; }

    var f = { W: W, H: H, cx: cx, cy: cy, S: S };
    f.burst = function (t, x, y, n, o) {
      at(t, function () {
        for (var i = 0; i < n; i++) {
          var a = rnd(o.a0 || 0, o.a1 == null ? 6.283 : o.a1), s = rnd(o.v[0], o.v[1]) * S;
          add({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: (o.g || 0) * S, drag: o.drag, max: rnd(o.l[0], o.l[1]) / 1000, size: rnd(o.s[0], o.s[1]) * (o.shape === 'star' ? S : 1), c: pick(o.c), shape: o.shape, rot: rnd(0, 6.28) });
        }
      });
    };
    f.over = function (t, dur, n, gen) { for (var i = 0; i < n; i++) at(t + Math.random() * dur, function () { add(gen()); }); };
    f.up = function (cols, k) { k = k || 1; return { x: rnd(0, W), y: H + 12, vx: rnd(-30, 30), vy: -rnd(120, 420) * S * k, g: -30, max: rnd(1, 2) , size: rnd(2, 6) * S, c: pick(cols), shape: 'dot' }; };
    f.fall = function (cols, shape, size, vyMax) { return { x: rnd(0, W), y: -20, vx: rnd(-50, 50), vy: rnd(100, vyMax || 260) * S, g: 160, max: rnd(1.8, 2.8), size: rnd(size * .7, size * 1.3) * S, c: pick(cols), shape: shape, drag: .995 }; };
    f.vortex = function (t, x, y, n, o) {
      at(t, function () {
        for (var i = 0; i < n; i++) add({ orb: true, ox: x, oy: y, ang: rnd(0, 6.283), rad: rnd(o.r[0], o.r[1]) * S, vrad: rnd(o.vr[0], o.vr[1]) * S, wa: rnd(o.w[0], o.w[1]) * (Math.random() < .5 ? 1 : 1), flat: o.flat || 1, max: rnd(o.max[0], o.max[1]), size: rnd(o.s[0], o.s[1]) * (o.shape === 'dot' ? 1 : S), c: pick(o.c), shape: o.shape, rot: rnd(0, 6.28), x: x, y: y });
      });
    };
    f.firework = function (t, x, y, cols) {
      f.burst(t, x, y, 80, { v: [120, 460], g: 240, drag: .95, l: [900, 1600], s: [1.5, 3], c: cols, shape: 'spark' });
      f.burst(t, x, y, 14, { v: [60, 260], g: 160, drag: .95, l: [1000, 1700], s: [8, 15], c: cols, shape: 'star' });
      f.ring(t, cols[0], 5, x, y);
    };
    f.bolt = function (t, x1, color) {
      at(t, function () {
        var pts = [], x = x1 + rnd(-40, 40), y = -10, ty = cy, n = 14;
        pts.push([x, y]);
        for (var i = 1; i <= n; i++) { x += rnd(-48, 48) * S + (x1 - x) * .08; y = -10 + (ty + 10) * i / n; pts.push([x, y]); }
        bolts.push({ pts: pts, age: 0, max: .42, c: color });
        var bp = pts[6]; var br = [bp]; var bx = bp[0], by = bp[1];
        for (var j = 0; j < 6; j++) { bx += rnd(10, 50) * S * (Math.random() < .5 ? -1 : 1); by += rnd(14, 44) * S; br.push([bx, by]); }
        bolts.push({ pts: br, age: 0, max: .3, c: color, thin: true });
      });
    };
    f.glitch = function (t, dur) {
      for (var i = 0; i < dur / 70; i++) at(t + i * 70, function () {
        var n = Math.floor(rnd(2, 6));
        for (var k = 0; k < n; k++) add({ shape: 'barrect', x: rnd(-20, W * .6), y: rnd(0, H), w: rnd(80, 360), h: rnd(3, 24), c: pick(['#ff2fd0', '#2ff3ff', '#ffffff']), max: .13, alpha: rnd(.35, .8) });
      });
    };
    f.matrix = function (t) {
      var step = 20, cols = Math.ceil(W / step);
      for (var k = 0; k < cols; k++) {
        if (Math.random() < .35) continue;
        var t0 = t + rnd(0, 1300), sp = rnd(520, 980) * S, cnt = Math.floor(rnd(10, 26)), x = k * step + 8;
        for (var i = 0; i < cnt; i++) (function (i, x, t0, sp) {
          at(t0 + i * (step * S / sp) * 1000, function () { add({ shape: 'char', ch: '01ｱｲｳｴｵｶｷｸｹｺ'.charAt(Math.floor(Math.random() * 12)), x: x, y: -10 + i * step * S, max: .75, size: 15 * S, c: i === cnt - 1 ? '#eafff0' : '#00ff66' }); });
        })(i, x, t0, sp);
      }
    };
    f.flash = function (t, c, o, d) { dom(t, nodeWith('kp-flash', { '--c': c, '--o': String(o), '--d': (d || .9) + 's' })); };
    f.ring = function (t, c, k, x, y) { var n = nodeWith('kp-ring', { '--c': c, '--k': String(k || 14), '--d': '1.2s' }); n.style.left = (x == null ? cx : x) + 'px'; n.style.top = (y == null ? cy : y) + 'px'; dom(t, n); };
    f.beam = function (t, c, xf, w) { var n = nodeWith('kp-beam', { '--c': c, '--w': Math.round(w) + 'px' }); n.style.left = (xf * 100) + '%'; dom(t, n); };
    f.aurora = function (t, cols) { cols.forEach(function (c, i) { dom(t + i * 200, nodeWith('kp-aur', { '--c': c, '--x': (30 + i * 40) + '%', '--y': (4 + i * 8) + '%' })); }); };
    f.glowb = function (t, c) { dom(t, nodeWith('kp-glowb', { '--c': c })); };
    f.rays = function (t, c) { dom(t, nodeWith('kp-rays', { '--c': c, '--x': cx + 'px', '--y': cy + 'px' })); };
    f.spot = function (t) { dom(t, nodeWith('kp-spot', { '--x': cx + 'px' })); };
    f.sweep = function (t, c) { dom(t, nodeWith('kp-sweep', { '--c': c, '--tx': Math.round(W * 4.2) + 'px' })); };
    f.cap = function (t, txt, c) { dom(t, nodeWith('kp-cap', { '--c': c }, txt)); };
    f.crown = function (t) { dom(t, nodeWith('kp-dropc', { '--x': cx + 'px', '--ty': Math.max(8, Math.round((cr ? cr.top - hr.top : H * .1) - 34)) + 'px' }, '👑')); };
    f.cglow = function (t, c) {
      if (!cr) return; var n = nodeWith('kp-cglow', { '--c': c });
      n.style.left = (cr.left - hr.left) + 'px'; n.style.top = (cr.top - hr.top) + 'px'; n.style.width = cr.width + 'px'; n.style.height = Math.min(cr.height, H - 20) + 'px'; dom(t, n);
    };

    spec.build(f);
    tl.sort(function (a, b) { return a.t - b.t; });

    function drawPart(p, a) {
      ctx.globalAlpha = a; ctx.fillStyle = p.c; ctx.strokeStyle = p.c;
      var sh = p.shape;
      if (sh === 'dot') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill();
        ctx.globalAlpha = a * .22; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.8, 0, 6.283); ctx.fill();
      } else if (sh === 'star') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        for (var k = 0; k < 8; k++) { var r = k % 2 ? p.size * .26 : p.size, an = p.rot + k * Math.PI / 4; ctx[k ? 'lineTo' : 'moveTo'](p.x + Math.cos(an) * r, p.y + Math.sin(an) * r); }
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = a * .25; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * .9, 0, 6.283); ctx.fill();
      } else if (sh === 'spark') {
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, p.size);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .05, p.y - p.vy * .05); ctx.stroke();
      } else if (sh === 'rect') {
        ctx.globalCompositeOperation = 'source-over'; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.fp + p.age * p.fv));
        ctx.fillRect(-p.size, -p.size * .55, p.size * 2, p.size * 1.1); ctx.restore();
      } else if (sh === 'petal') {
        ctx.globalCompositeOperation = 'source-over'; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size, p.size * (.35 + .3 * Math.abs(Math.cos(p.fp + p.age * p.fv))), p.rot, 0, 6.283); ctx.fill();
      } else if (sh === 'bubble') {
        ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.stroke();
        ctx.globalAlpha = a * .12; ctx.fill();
      } else if (sh === 'char') {
        ctx.globalCompositeOperation = 'lighter'; ctx.font = Math.round(p.size) + 'px monospace'; ctx.textAlign = 'center'; ctx.fillText(p.ch || '✦', p.x, p.y);
      } else if (sh === 'bar') {
        ctx.globalCompositeOperation = 'lighter'; ctx.fillRect(p.x - p.size * 3, p.y - p.size * .5, p.size * 6, p.size);
      } else if (sh === 'barrect') {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.alpha * (1 - p.age / p.max); ctx.fillRect(p.x, p.y, p.w, p.h);
      }
    }

    function finish() {
      if (dead) return; dead = true; cancelAnimationFrame(raf);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      if (card) card.classList.remove('kp-in-' + spec.card);
    }
    layer._stop = function () { dead = true; cancelAnimationFrame(raf); if (card) card.classList.remove('kp-in-' + spec.card); };

    var start = 0, last = 0;
    function frame(now) {
      if (dead) return;
      if (!start) { start = last = now; }
      var dt = Math.min(.05, (now - last) / 1000); last = now; var elapsed = now - start;
      while (tl.length && tl[0].t <= elapsed) tl.shift().fn();

      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i]; p.age += dt;
        if (p.age >= p.max) { parts.splice(i, 1); continue; }
        if (p.orb) {
          p.rad += p.vrad * dt; p.ang += p.wa * dt; if (p.rad <= 4) { parts.splice(i, 1); continue; }
          p.x = p.ox + Math.cos(p.ang) * p.rad; p.y = p.oy + Math.sin(p.ang) * p.rad * p.flat;
        } else {
          var dg = Math.pow(p.drag, dt * 60); p.vx *= dg; p.vy = p.vy * dg + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        }
        var a = Math.min(1, p.age / .12) * Math.min(1, (p.max - p.age) / (p.max * .45));
        if (p.shape === 'barrect') { drawPart(p, 1); continue; }
        drawPart(p, Math.max(0, a));
      }
      for (var b = bolts.length - 1; b >= 0; b--) {
        var bo = bolts[b]; bo.age += dt; if (bo.age >= bo.max) { bolts.splice(b, 1); continue; }
        var ba = 1 - bo.age / bo.max; ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
        [[bo.thin ? 6 : 14, .22, bo.c], [bo.thin ? 1.5 : 3.5, 1, '#fff']].forEach(function (L) {
          ctx.globalAlpha = ba * L[1]; ctx.strokeStyle = L[2]; ctx.lineWidth = L[0] * S; ctx.beginPath();
          bo.pts.forEach(function (q, k) { ctx[k ? 'lineTo' : 'moveTo'](q[0], q[1]); }); ctx.stroke();
        });
      }
      if (elapsed >= spec.dur || (elapsed > 800 && !tl.length && !parts.length && !bolts.length && elapsed > spec.dur - 1200)) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }

    if (card && spec.card) { void card.offsetWidth; card.classList.add('kp-in-' + spec.card); }
    raf = requestAnimationFrame(frame);
  }

  function fill(card, placeholder, p, fxHost) {
    var banner = card.querySelector('.kp-banner'); applyBg(banner, p.bg);
    if (p.frame && p.frame.indexOf('crown') === 0 && !REDUCED) {
      for (var k = 0; k < 14; k++) {
        var sp = el('i', 'kp-spark'); sp.style.left = (6 + Math.random() * 88) + '%'; sp.style.top = (30 + Math.random() * 60) + '%';
        sp.style.animationDelay = (Math.random() * 2.4).toFixed(2) + 's'; sp.style.transform = 'scale(' + (0.5 + Math.random()).toFixed(2) + ')';
        banner.appendChild(sp);
      }
    }

    var wrap = el('div');
    var head = el('div', 'kp-head');
    head.appendChild(framed(avatar(p.username, p.avatar, 84), 84, p.frame, p.tier && p.tier.level));
    wrap.appendChild(head);

    var body = el('div', 'kp-body'); var n = 0;
    var nm = el('div', 'kp-name');
    if (global.KihoBadge) global.KihoBadge.render(nm, p.username, { tags: p.tags }); else nm.textContent = p.username;
    body.appendChild(rise(nm, n++));

    var s = p.stats || {};
    if (p.tier) {
      var tb = el('div', 'kp-tierbox'); var tl = el('div', 'kp-tierline');
      var left = el('span'); left.appendChild(el('b', '', p.tier.name)); left.appendChild(document.createTextNode(' 등급')); tl.appendChild(left);
      var pct = 100;
      if (p.next_tier) {
        var span = p.next_tier.min - p.tier.min; pct = Math.max(0, Math.min(100, Math.round(((s.stages || 0) - p.tier.min) / span * 100)));
        tl.appendChild(el('span', '', p.next_tier.name + '까지 ' + fmt(Math.max(0, p.next_tier.min - (s.stages || 0))) + ' 스테이지'));
      } else tl.appendChild(el('span', '', '최고 등급 달성 ✦'));
      tb.appendChild(tl);
      var bar = el('div', 'kp-bar'); var fillEl = el('i'); bar.appendChild(fillEl); tb.appendChild(bar);
      body.appendChild(rise(tb, n++));
      setTimeout(function () { fillEl.style.width = pct + '%'; }, 30);
    }

    var chips = el('div', 'kp-chips');
    if (p.frame === 'crown-gold') chips.appendChild(el('span', 'kp-chip kp-chip--gold', '👑 현재 1위'));
    else if (p.frame === 'crown-silver') chips.appendChild(el('span', 'kp-chip', '🥈 현재 2위'));
    else if (p.frame === 'crown-bronze') chips.appendChild(el('span', 'kp-chip', '🥉 현재 3위'));
    else if (p.frame === 'star') chips.appendChild(el('span', 'kp-chip', '★ TOP 10'));
    if (s.perfect > 0) chips.appendChild(el('span', 'kp-chip', '✨ 퍼펙트 ' + fmt(s.perfect) + '회'));
    if (p.fastest_ms != null) chips.appendChild(el('span', 'kp-chip', '⚡ 최단 ' + fmtTime(p.fastest_ms)));
    if (chips.childNodes.length) body.appendChild(rise(chips, n++));

    body.appendChild(rise(p.bio ? el('p', 'kp-bio', p.bio) : el('p', 'kp-bio kp-bio--empty', '아직 한마디를 남기지 않았어요.'), n++));

    var grid = el('div', 'kp-stats');
    [['클리어 스테이지', s.stages, fmt], ['플레이 횟수', s.played, fmt], ['5스테이지 완주', s.cleared, fmt],
     ['퍼펙트 완주', s.perfect, fmt], ['최고 콤보', s.combo, function (v) { return '×' + fmt(v); }], ['최고 순위', (s.best_place || (p.places && p.places[0] && p.places[0].place) || 0), function (v) { return v ? fmt(v) + '위' : '-'; }]].forEach(function (it, i) {
      var c = el('div', 'kp-stat'); var b = el('b', '', ''); countUp(b, it[1], it[2], 450 + i * 70); c.appendChild(b); c.appendChild(el('span', '', it[0])); grid.appendChild(c);
    });
    body.appendChild(rise(grid, n++));

    if (p.diffs && p.diffs.length) {
      var max = Math.max.apply(null, p.diffs.map(function (d) { return d.stages; }).concat([1]));
      body.appendChild(rise(el('div', 'kp-h', '난이도별 클리어 스테이지'), n++));
      var dl = el('div', 'kp-diffs');
      p.diffs.forEach(function (d) {
        var row = el('div', 'kp-diff'); row.appendChild(el('span', '', DIFF_NAMES[d.difficulty] || d.difficulty));
        var bar2 = el('div', 'kp-bar kp-bar--d'); bar2.style.setProperty('--c', DIFF_COLOR[d.difficulty] || '#6FF2E0');
        var f2 = el('i'); bar2.appendChild(f2); row.appendChild(bar2); row.appendChild(el('em', '', fmt(d.stages)));
        dl.appendChild(row); setTimeout(function () { f2.style.width = Math.round(d.stages / max * 100) + '%'; }, 30);
      });
      body.appendChild(rise(dl, n++));
    }

    if (p.tag_total) {
      body.appendChild(rise(el('div', 'kp-h', '수집 현황'), n++));
      var coll = el('div', 'kp-coll');
      [['태그', p.tag_count, p.tag_total], ['배경', p.bg_count, p.bg_total], ['테두리', p.frame_count, p.frame_total], ['입장 효과', p.intro_count, p.intro_total]].forEach(function (c) {
        if (!c[2]) return;
        var box = el('div', 'kp-collc'); var d1 = el('div'); d1.appendChild(el('span', '', c[0])); d1.appendChild(el('b', '', fmt(c[1]) + ' / ' + fmt(c[2]))); box.appendChild(d1);
        var br = el('div', 'kp-bar'); br.style.marginTop = '8px'; var f3 = el('i'); br.appendChild(f3); box.appendChild(br);
        setTimeout(function () { f3.style.width = Math.round((c[1] || 0) / c[2] * 100) + '%'; }, 30); coll.appendChild(box);
      });
      body.appendChild(rise(coll, n++));
    }

    if (p.places && p.places.length) {
      body.appendChild(rise(el('div', 'kp-h', '현재 순위'), n++));
      var ul = el('ul', 'kp-places');
      p.places.slice(0, 5).forEach(function (pl) {
        var li = el('li'); li.appendChild(el('b', '', fmt(pl.place) + '위'));
        li.appendChild(el('span', '', (GAME_NAMES[pl.game] || pl.game) + ' · ' + (DIFF_NAMES[pl.difficulty] || pl.difficulty)));
        li.appendChild(el('em', '', fmt(pl.score) + '점')); ul.appendChild(li);
      });
      body.appendChild(rise(ul, n++));
    }

    var foot = el('div', 'kp-foot');
    foot.appendChild(el('span', '', p.joined ? fmtJoined(p.joined) + ' 가입' : ''));
    if (p.is_me) { var a = el('a', 'kp-link', '프로필 편집'); a.href = 'profile.html'; foot.appendChild(a); }
    body.appendChild(rise(foot, n++));

    wrap.appendChild(body);
    if (placeholder.parentNode) placeholder.parentNode.replaceChild(wrap, placeholder);
    if (fxHost && p.intro) playIntro(fxHost, card, p.intro);
  }

  /* 프로필 카드를 페이지 안에 직접 그립니다(내 프로필 화면용). */
  function mount(container, p, noAnim) {
    ensureModalCss();
    container.textContent = '';
    container.classList.toggle('kp-noanim', !!noAnim);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    var card = el('div', 'kp-card kp-card--inline'); card.appendChild(el('div', 'kp-banner'));
    var ph = el('div'); card.appendChild(ph); container.appendChild(card);
    fill(card, ph, p, null);
    return card;
  }

  injectStyle();

  global.KihoProfile = {
    API_BASE: API_BASE, BG_IDS: Object.keys(BG), GAME_NAMES: GAME_NAMES, DIFF_NAMES: DIFF_NAMES,
    open: open, close: close, mount: mount, playIntro: playIntro, INTRO_IDS: INTRO_IDS, avatar: avatar, framed: framed, rankFrame: rankFrame, bgClass: bgClass, applyBg: applyBg, bgTile: bgTile, api: api, token: token
  };
})(window);
