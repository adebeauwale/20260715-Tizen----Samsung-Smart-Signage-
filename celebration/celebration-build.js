/* ============================================================================
   VYPA — shared celebration BUILDER (Baller Alert / Birthday VIP frame).
   Single source of truth for the celebration HTML. Used by the web preview
   (preview.view.php) AND the in-app local asset (celebration.html) bundled in
   the custom player, so the design stays identical everywhere.
   Depends on celebration-engine.js (window.VypaCeleb) for the particle canvas.

     VypaCelebration.renderCelebration(rootEl, elementData)
     VypaCelebration.renderMoneyRain(rootEl, elementData)
   `elementData` is the layout element's saved config (content/celebColor1/src/…).
============================================================================ */
(function () {
  "use strict";

  function _ballerInnerHTML(d) {
    var theme  = d.theme || 'baller';
    var DEF    = theme === 'birthday'
      ? { venue:'VIP CLUB LOUNGE', tag:'BIRTHDAY STAR', moment:'MAKE SOME NOISE!', banner:'HAPPY BIRTHDAY' }
      : theme === 'special_guest'
      ? { venue:'VIP CLUB LOUNGE', tag:'HONORED GUEST', moment:'PLEASE WELCOME', banner:'SPECIAL GUEST' }
      : theme === 'award_winner'
      ? { venue:'AWARD CEREMONY', tag:'CHAMPION', moment:'CONGRATULATIONS', banner:'WINNER' }
      : theme === 'award_nominees'
      ? { venue:'AWARD CEREMONY', tag:'', moment:'', banner:'NOMINEES' }
      : { venue:'VIP CLUB LOUNGE', tag:'VIP • BIG SPENDER', moment:'JUST POPPED A BOTTLE', banner:'BALLER ALERT' };
    var fs     = d.fs || 100;
    // Award layouts stack more content (banner + big frame + name + tag) than the club themes,
    // so the whole composition is scaled down a touch — keeps it off the top/bottom edges.
    if (theme === 'award_winner' || theme === 'award_nominees') fs = fs * 0.85;
    // ── Responsive fit (landscape ⇄ portrait) ──────────────────────────────
    // Scale the whole composition to the ACTUAL container, measured in pixels
    // (never %, which collapsed the frame before). Landscape 1920×1080 is untouched;
    // portrait re-shapes the hero frame to portrait and re-fits everything.
    var cw = d.cw || 1920, ch = d.ch || 1080;
    var portrait = ch > cw;
    var hasFlankers = (theme === 'baller' || theme === 'birthday');
    // Hero frame size: landscape 16:9, portrait ~4:5 (taller than wide, suits a person photo).
    var frameWUnits = portrait ? (theme === 'award_nominees' ? 6.6 : 9.6)
                               : (theme === 'award_nominees' ? 7.4 : 11.2);
    var frameAR     = portrait ? 0.80 : (11.2 / 6.3);                         // width ÷ height
    var widthUnits  = frameWUnits + (hasFlankers ? 2 * 1.45 : 0);            // frame + flankers
    var heightUnits = portrait ? ((theme === 'award_nominees' ? 13.5 : 16.8) + (d.logo ? 3.0 : 0))  // taller stack in portrait; +crest
                               : 10.2;
    fs = Math.min(fs, (cw * 0.94) / widthUnits, (ch * 0.96) / heightUnits);
    var name   = d.name   || 'NGOZI';
    var c1     = d.c1     || '#FFD972';
    var c2     = d.c2     || '#E8C66A';
    var venue  = (d.venue  != null) ? d.venue  : DEF.venue;
    var tag    = (d.tag    != null) ? d.tag    : DEF.tag;
    var moment = (d.moment != null) ? d.moment : DEF.moment;
    var photo  = d.photo || '';
    var photoType = d.photoType || '';
    var logo   = d.logo  || '';
    var showBills = d.showBills !== false;
    var mrScale = d.billScale || 1;
    var mrCount = d.billCount || 32;
    var anchor  = d.anchor || 'mc';
    var R = Math.round;

    var GOLD  = 'linear-gradient(178deg,#FFF6D6 0%,#FFDD7C 28%,#EBAE42 50%,#C98A28 58%,#FFE292 80%,#FFF6D6 100%)';
    var FRAME = 'linear-gradient(140deg,#FFE9A8 0%,#D7A53A 26%,#8C6A22 50%,#C99632 70%,#FFDD7C 100%)';
    var goldText = 'background:' + GOLD + ';background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;';

    var canvasHTML = showBills
      ? '<canvas class="ba-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></canvas>'
      : '';

    var frameW = R(fs * frameWUnits), frameH = R(frameW / frameAR);  // 16:9 landscape, ~4:5 portrait
    var mediaStyle = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 32%;';
    var isVideo = (photoType === 'video') || /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(photo);
    var inner = photo
      ? (isVideo
          ? '<video src="' + photo + '" autoplay muted loop playsinline style="' + mediaStyle + '"></video>'
          : '<img src="' + photo + '" style="' + mediaStyle + 'animation:vypa-baller-zoom 13s ease-in-out infinite alternate;"/>')
      : '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:radial-gradient(80% 80% at 50% 38%,#241a0b,#0a0806);">'
          + '<div style="font-size:' + R(fs * 1.0) + 'px;filter:drop-shadow(0 0 16px ' + c1 + ');">' + (theme === 'birthday' ? '🎂' : theme === 'special_guest' ? '⭐' : (theme === 'award_winner' || theme === 'award_nominees') ? '🏆' : '👑') + '</div>'
          + '<div style="font-family:\'Bebas Neue\',sans-serif;letter-spacing:8px;font-size:' + R(fs * 0.5) + 'px;' + goldText + '">' + (theme === 'birthday' ? 'PARTY' : theme === 'special_guest' ? 'GUEST' : theme === 'award_winner' ? 'WINNER' : theme === 'award_nominees' ? 'NOMINEE' : 'VIP') + '</div>'
        + '</div>';

    var crown = '<svg viewBox="0 0 132 92" width="' + R(fs * 1.2) + '" height="' + R(fs * 0.84) + '" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><linearGradient id="bacg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0C2"/><stop offset="0.5" stop-color="#FFCF5E"/><stop offset="1" stop-color="#C2882A"/></linearGradient></defs>'
      + '<path d="M10 78 L4 22 L42 50 L66 8 L90 50 L128 22 L122 78 Z" fill="url(#bacg)" stroke="#8A641F" stroke-width="1.5"/>'
      + '<rect x="8" y="76" width="116" height="13" rx="4" fill="url(#bacg)" stroke="#8A641F" stroke-width="1.5"/>'
      + '<circle cx="4" cy="20" r="6" fill="#FFE7A0"/><circle cx="66" cy="7" r="7" fill="#FFE7A0"/><circle cx="128" cy="20" r="6" fill="#FFE7A0"/></svg>';

    function bottle(side) {
      var gid = 'baglass' + side, fid = 'bafoil' + side;
      var glass = side === 'L'
        ? '<linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a431a"/><stop offset="0.35" stop-color="#7c5d22"/><stop offset="0.55" stop-color="#2c2009"/><stop offset="1" stop-color="#1a1206"/></linearGradient>'
        : '<linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1a1206"/><stop offset="0.45" stop-color="#2c2009"/><stop offset="0.65" stop-color="#7c5d22"/><stop offset="1" stop-color="#5a431a"/></linearGradient>';
      var bH = R(fs * 2.6), bW = R(bH * 0.268);
      return '<svg viewBox="0 0 60 224" width="' + bW + '" height="' + bH + '" xmlns="http://www.w3.org/2000/svg">'
        + '<defs>' + glass + '<linearGradient id="' + fid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0C2"/><stop offset="1" stop-color="#C2882A"/></linearGradient></defs>'
        + '<rect x="22" y="4" width="16" height="15" rx="3" fill="url(#' + fid + ')"/>'
        + '<rect x="24" y="17" width="12" height="40" fill="url(#' + gid + ')"/>'
        + '<path d="M24 54 C24 76 14 84 14 118 L14 200 Q14 216 30 216 Q46 216 46 200 L46 118 C46 84 36 76 36 54 Z" fill="url(#' + gid + ')" stroke="#8A641F" stroke-width="1"/>'
        + '<rect x="14" y="120" width="32" height="46" fill="url(#' + fid + ')"/>'
        + '<rect x="14" y="120" width="32" height="3" fill="#7a591d"/><rect x="14" y="163" width="32" height="3" fill="#7a591d"/>'
        + '<rect x="' + (side === 'L' ? 19 : 37) + '" y="64" width="4" height="120" rx="2" fill="rgba(255,255,255,0.16)"/></svg>';
    }

    var dia = 'position:absolute;width:' + R(fs * 0.2) + 'px;height:' + R(fs * 0.2) + 'px;background:linear-gradient(135deg,#FFE9A8,#B98A2C);transform:rotate(45deg);box-shadow:0 0 10px rgba(255,200,90,0.6);';
    var corners = '<span style="' + dia + 'top:-7px;left:-7px;"></span><span style="' + dia + 'top:-7px;right:-7px;"></span>'
                + '<span style="' + dia + 'bottom:-7px;left:-7px;"></span><span style="' + dia + 'bottom:-7px;right:-7px;"></span>';

    // Birthday cake topper — gold tiers with flickering candle flames
    var cake = '<svg viewBox="0 0 150 120" width="' + R(fs * 1.5) + '" height="' + R(fs * 1.2) + '" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><linearGradient id="bcake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0C2"/><stop offset="0.5" stop-color="#FFCF5E"/><stop offset="1" stop-color="#C2882A"/></linearGradient>'
      + '<linearGradient id="bcream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF7E2"/><stop offset="1" stop-color="#F2D79A"/></linearGradient></defs>'
      + '<rect x="44" y="22" width="6" height="26" rx="2" fill="url(#bcream)"/><rect x="72" y="16" width="6" height="32" rx="2" fill="url(#bcream)"/><rect x="100" y="22" width="6" height="26" rx="2" fill="url(#bcream)"/>'
      + '<g style="transform-origin:center bottom;animation:vypa-flame 1.3s ease-in-out infinite;">'
      + '<ellipse cx="47" cy="15" rx="4" ry="8" fill="#FFD166"/><ellipse cx="47" cy="16" rx="2" ry="4.5" fill="#FFF6D6"/>'
      + '<ellipse cx="75" cy="9" rx="4.5" ry="9" fill="#FFD166"/><ellipse cx="75" cy="10" rx="2.2" ry="5" fill="#FFF6D6"/>'
      + '<ellipse cx="103" cy="15" rx="4" ry="8" fill="#FFD166"/><ellipse cx="103" cy="16" rx="2" ry="4.5" fill="#FFF6D6"/>'
      + '</g>'
      + '<path d="M28 60 q0 -16 47 -16 q47 0 47 16 v8 q-47 11 -94 0 z" fill="url(#bcake)" stroke="#8A641F" stroke-width="1"/>'
      + '<path d="M30 60 q9 9 0 17 M52 63 q8 10 0 18 M75 64 q8 10 0 18 M98 63 q8 10 0 18 M120 60 q-9 9 0 17" fill="none" stroke="#FFF7E2" stroke-width="6" stroke-linecap="round"/>'
      + '<rect x="22" y="76" width="106" height="34" rx="9" fill="url(#bcake)" stroke="#8A641F" stroke-width="1"/>'
      + '<rect x="22" y="89" width="106" height="6" fill="#E7A93B" opacity="0.45"/>'
      + '<ellipse cx="75" cy="112" rx="66" ry="7" fill="url(#bcake)"/></svg>';

    // Gold foil balloon flanker
    function balloon(side) {
      var gid = 'baboon' + side;
      var bH = R(fs * 2.7), bW = R(bH * 0.52);
      return '<svg viewBox="0 0 90 170" width="' + bW + '" height="' + bH + '" xmlns="http://www.w3.org/2000/svg">'
        + '<defs><radialGradient id="' + gid + '" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#FFF6D6"/><stop offset="0.45" stop-color="#FFCF5E"/><stop offset="1" stop-color="#B5851F"/></radialGradient></defs>'
        + '<path d="M45 102 Q58 134 45 168" fill="none" stroke="#C9A24A" stroke-width="2"/>'
        + '<path d="M45 100 L38 112 L52 112 Z" fill="#C2882A"/>'
        + '<ellipse cx="45" cy="52" rx="40" ry="50" fill="url(#' + gid + ')" stroke="#8A641F" stroke-width="1"/>'
        + '<ellipse cx="32" cy="36" rx="9" ry="15" fill="rgba(255,255,255,0.38)"/></svg>';
    }

    // Special Guest topper — an elegant gold star (no bottles/balloons; classy VIP welcome)
    var star = '<svg viewBox="0 0 120 120" width="' + R(fs * 1.15) + '" height="' + R(fs * 1.15) + '" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><linearGradient id="bastar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0C2"/><stop offset="0.5" stop-color="#FFCF5E"/><stop offset="1" stop-color="#C2882A"/></linearGradient></defs>'
      + '<path d="M60 6 L73 44 L113 44 L81 68 L93 108 L60 84 L27 108 L39 68 L7 44 L47 44 Z" fill="url(#bastar)" stroke="#8A641F" stroke-width="1.5"/></svg>';
    // Award Ceremony topper — gold trophy
    var trophy = '<svg viewBox="0 0 120 130" width="' + R(fs * 1.05) + '" height="' + R(fs * 1.14) + '" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><linearGradient id="batro" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0C2"/><stop offset="0.5" stop-color="#FFCF5E"/><stop offset="1" stop-color="#C2882A"/></linearGradient></defs>'
      + '<path d="M30 18 H90 V40 Q90 70 60 74 Q30 70 30 40 Z" fill="url(#batro)" stroke="#8A641F" stroke-width="1.5"/>'
      + '<path d="M30 26 H16 Q8 26 8 38 Q10 54 30 56" fill="none" stroke="#C2882A" stroke-width="5"/>'
      + '<path d="M90 26 H104 Q112 26 112 38 Q110 54 90 56" fill="none" stroke="#C2882A" stroke-width="5"/>'
      + '<rect x="54" y="73" width="12" height="20" fill="url(#batro)"/>'
      + '<rect x="38" y="93" width="44" height="10" rx="3" fill="url(#batro)" stroke="#8A641F" stroke-width="1"/>'
      + '<rect x="44" y="103" width="32" height="15" rx="3" fill="url(#batro)" stroke="#8A641F" stroke-width="1"/>'
      + '<path d="M50 30 L57 30 L53 48 Z" fill="rgba(255,255,255,0.45)"/></svg>';
    var isBday      = theme === 'birthday';
    var isGuest     = theme === 'special_guest';
    var isWinner    = theme === 'award_winner';
    var isNominees  = theme === 'award_nominees';
    var isAward     = isWinner || isNominees;
    // Award display font: a heavy, WIDE sans (Archivo Black) — far more legible at distance / small
    // sizes than the tall-narrow Bebas Neue used by the club themes. Falls back to Arial Black.
    var dispFont    = isAward ? "'Archivo Black','Arial Black',sans-serif" : "'Bebas Neue',sans-serif";
    var topperSVG   = isAward ? trophy : (isGuest ? star : (isBday ? cake : crown));
    var topperAnim  = (isGuest || isAward) ? 'vypa-pulse-crown 3s ease-in-out infinite' : (isBday ? 'vypa-baller-float 4s ease-in-out infinite' : 'vypa-pulse-crown 2.4s ease-in-out infinite');
    var flankCls    = isBday ? 'ba-flank' : 'ba-bottle';
    var flankL      = (isGuest || isAward) ? '' : (isBday ? balloon('L') : bottle('L'));
    var flankR      = (isGuest || isAward) ? '' : (isBday ? balloon('R') : bottle('R'));

    // Nominees list — the "name" field holds newline-separated nominee names.
    var nomineesHTML = '';
    if (isNominees) {
      var noms = String(name || '').split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
      if (!noms.length) noms = ['Nominee One', 'Nominee Two', 'Nominee Three'];
      // Compact picture frame for the nominees layout (smaller than the winner's hero frame),
      // so the photo / VIP-crest slot works here too. Name list sits beneath it.
      // Landscape 16:9; portrait ≈ square so it leaves room for the name list below.
      var nomFW = R(fs * frameWUnits), nomFH = R(nomFW / (portrait ? 1.0 : (7.4 / 4.16)));
      var nomFrame = '<div style="position:relative;width:' + nomFW + 'px;height:' + nomFH + 'px;border-radius:12px;padding:8px;background:' + FRAME + ';box-shadow:0 26px 64px rgba(0,0,0,.7),0 0 44px ' + c1 + '55,0 0 0 1px rgba(0,0,0,.4);">'
        + '<div style="position:relative;width:100%;height:100%;border-radius:5px;overflow:hidden;background:#0a0806;box-shadow:inset 0 0 0 2px rgba(0,0,0,.6),inset 0 0 60px rgba(0,0,0,.55);">'
          + inner
          + '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,0) 60%,rgba(10,7,4,.55) 100%);"></div>'
          + '<div style="position:absolute;top:-20%;left:0;width:55%;height:140%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,248,220,.55),rgba(255,255,255,0));animation:vypa-baller-glare 6s ease-in-out infinite;"></div>'
        + '</div>'
        + corners
      + '</div>';
      nomineesHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:' + R(fs * 0.22) + 'px;margin-top:' + R(fs * 0.2) + 'px;width:100%;">'
        + nomFrame
        + '<div style="display:flex;flex-direction:column;align-items:center;gap:' + R(fs * 0.1) + 'px;width:92%;">'
        + noms.map(function (n) {
            return '<div style="display:flex;align-items:center;justify-content:center;gap:' + R(fs * 0.18) + 'px;">'
              + '<span style="color:' + c1 + ';font-size:' + R(fs * 0.36) + 'px;filter:drop-shadow(0 0 10px ' + c1 + ');">★</span>'
              + '<span style="font-family:\'Cinzel\',serif;font-weight:700;font-size:' + R(fs * 0.46) + 'px;letter-spacing:2px;' + goldText + 'filter:drop-shadow(0 2px 1px rgba(0,0,0,.5)) drop-shadow(0 0 16px ' + c1 + ');white-space:nowrap;">' + n + '</span>'
              + '<span style="color:' + c1 + ';font-size:' + R(fs * 0.36) + 'px;filter:drop-shadow(0 0 10px ' + c1 + ');">★</span>'
            + '</div>';
          }).join('')
        + '</div>'
        + '</div>';
    }

    var aV = anchor.charAt(0) === 't' ? 'flex-start' : anchor.charAt(0) === 'b' ? 'flex-end' : 'center';
    var aH = anchor.charAt(1) === 'l' ? 'flex-start' : anchor.charAt(1) === 'r' ? 'flex-end' : 'center';

    // Landscape: small logo badge in the top-left corner (a landscape convention).
    var logoHTML = (logo && !portrait)
      ? '<img src="' + logo + '" alt="" style="position:absolute;top:' + R(fs * 0.3) + 'px;left:' + R(fs * 0.44) + 'px;height:' + R(fs * 1.7) + 'px;width:auto;z-index:5;filter:drop-shadow(0 0 22px rgba(255,210,120,0.55)) drop-shadow(0 6px 18px rgba(0,0,0,0.6));animation:vypa-baller-float 3.6s ease-in-out infinite;"/>'
      : '';
    // Portrait: a larger, centered crest at the very top of the stack.
    var logoFlow = (logo && portrait)
      ? '<img src="' + logo + '" alt="" style="height:' + R(fs * 2.7) + 'px;width:auto;filter:drop-shadow(0 0 22px rgba(255,210,120,0.55)) drop-shadow(0 6px 18px rgba(0,0,0,0.6));animation:vypa-baller-float 3.6s ease-in-out infinite;"/>'
      : '';

    return ''
      + '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;">'
        + '<div style="position:absolute;inset:0;background:radial-gradient(125% 95% at 50% 36%,#1d1509 0%,#120d07 40%,#070506 72%,#030203 100%);"></div>'
        + '<div style="position:absolute;inset:0;background:radial-gradient(60% 55% at 50% 44%,rgba(120,84,24,0.30),rgba(0,0,0,0) 70%);"></div>'
        + '<div style="position:absolute;top:0;left:50%;width:46%;height:80%;margin-left:-23%;background:linear-gradient(180deg,rgba(255,216,128,0.28),rgba(255,216,128,0) 80%);clip-path:polygon(47% 0,53% 0,88% 100%,12% 100%);transform-origin:50% 5%;filter:blur(1px);animation:vypa-baller-beam1 7s ease-in-out infinite alternate;"></div>'
        + '<div style="position:absolute;top:0;left:50%;width:46%;height:80%;margin-left:-23%;background:linear-gradient(180deg,rgba(255,196,96,0.20),rgba(255,196,96,0) 80%);clip-path:polygon(47% 0,53% 0,88% 100%,12% 100%);transform-origin:50% 5%;filter:blur(2px);animation:vypa-baller-beam2 8.2s ease-in-out infinite alternate;"></div>'
        // Sweeping searchlights (pure transform/opacity → GPU-cheap, no blend-mode)
        + '<div style="position:absolute;top:-4%;left:50%;width:30%;height:98%;margin-left:-15%;background:linear-gradient(180deg,rgba(255,236,180,0.30),rgba(255,236,180,0) 78%);clip-path:polygon(46% 0,54% 0,82% 100%,18% 100%);transform-origin:50% 0;animation:vypa-spot-a 5s ease-in-out infinite alternate;"></div>'
        + '<div style="position:absolute;top:-4%;left:50%;width:26%;height:98%;margin-left:-13%;background:linear-gradient(180deg,rgba(255,255,255,0.20),rgba(255,255,255,0) 74%);clip-path:polygon(45% 0,55% 0,86% 100%,14% 100%);transform-origin:50% 0;animation:vypa-spot-b 6.6s ease-in-out infinite alternate;"></div>'
        // Corner sparkles (twinkle)
        + '<div style="position:absolute;top:8%;left:7%;width:' + R(fs*0.14) + 'px;height:' + R(fs*0.14) + 'px;background:radial-gradient(circle,#fff,rgba(255,221,128,0) 70%);border-radius:50%;animation:vypa-spark 2.4s ease-in-out infinite;"></div>'
        + '<div style="position:absolute;top:11%;right:8%;width:' + R(fs*0.11) + 'px;height:' + R(fs*0.11) + 'px;background:radial-gradient(circle,#fff,rgba(255,221,128,0) 70%);border-radius:50%;animation:vypa-spark 3.1s ease-in-out infinite .6s;"></div>'
        + '<div style="position:absolute;bottom:12%;left:10%;width:' + R(fs*0.1) + 'px;height:' + R(fs*0.1) + 'px;background:radial-gradient(circle,#fff,rgba(255,221,128,0) 70%);border-radius:50%;animation:vypa-spark 2.8s ease-in-out infinite 1.1s;"></div>'
        + '<div style="position:absolute;bottom:9%;right:11%;width:' + R(fs*0.13) + 'px;height:' + R(fs*0.13) + 'px;background:radial-gradient(circle,#fff,rgba(255,221,128,0) 70%);border-radius:50%;animation:vypa-spark 3.4s ease-in-out infinite .3s;"></div>'
        + canvasHTML
        + logoHTML
        + '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:' + aH + ';justify-content:' + (portrait ? 'center' : aV) + ';gap:' + R(fs * (portrait ? 0.32 : 0.12)) + 'px;padding:' + R(fs * 0.28) + 'px ' + R(fs * 0.6) + 'px;text-align:center;">'
          + logoFlow
          + (venue ? '<div style="display:flex;align-items:center;gap:18px;">'
              + '<span style="display:block;width:' + R(fs * 0.6) + 'px;height:1px;background:linear-gradient(90deg,rgba(232,198,106,0),' + c2 + ');"></span>'
              + '<span style="font-family:\'Cinzel\',serif;font-weight:600;font-size:' + R(fs * (isAward ? (portrait ? 0.46 : 0.40) : (portrait ? 0.42 : 0.25))) + 'px;letter-spacing:' + R(fs * 0.11) + 'px;text-transform:uppercase;color:' + c2 + ';white-space:nowrap;text-shadow:0 0 18px rgba(232,198,106,0.4);">' + venue + '</span>'
              + '<span style="display:block;width:' + R(fs * 0.6) + 'px;height:1px;background:linear-gradient(90deg,' + c2 + ',rgba(232,198,106,0));"></span>'
            + '</div>' : '')
          + '<div style="display:flex;align-items:center;justify-content:center;gap:' + R(fs * 0.4) + 'px;max-width:100%;">'
            + '<div style="flex-shrink:0;transform:scale(' + (isBday ? 0.6 : isGuest ? 0.78 : isAward ? 0.66 : 0.85) + ');"><div style="filter:drop-shadow(0 0 14px ' + c1 + ');animation:' + topperAnim + ';">' + topperSVG + '</div></div>'
            + '<div style="font-family:' + dispFont + ';font-size:' + R(fs * (isAward ? 0.9 : 1.05)) + 'px;line-height:.92;letter-spacing:' + (isAward ? 2 : 5) + 'px;text-transform:uppercase;white-space:nowrap;' + goldText
              + 'filter:drop-shadow(0 2px 1px rgba(0,0,0,.55)) drop-shadow(0 0 22px ' + c1 + ');animation:vypa-baller-shine 5s linear infinite;">' + DEF.banner + '</div>'
            + '<div style="flex-shrink:0;transform:scale(' + (isBday ? 0.6 : isGuest ? 0.78 : isAward ? 0.66 : 0.85) + ');"><div style="filter:drop-shadow(0 0 14px ' + c1 + ');animation:' + topperAnim + ';">' + topperSVG + '</div></div>'
          + '</div>'
          + (isNominees ? nomineesHTML : ('<div style="position:relative;margin-top:' + R(fs * 0.28) + 'px;animation:vypa-baller-float 4.5s ease-in-out infinite;">'
            + '<div style="position:relative;width:' + frameW + 'px;height:' + frameH + 'px;border-radius:12px;padding:10px;background:' + FRAME + ';box-shadow:0 34px 90px rgba(0,0,0,.72),0 0 56px ' + c1 + '55,0 0 0 1px rgba(0,0,0,.4);">'
              + '<div style="position:relative;width:100%;height:100%;border-radius:5px;overflow:hidden;background:#0a0806;box-shadow:inset 0 0 0 2px rgba(0,0,0,.6),inset 0 0 60px rgba(0,0,0,.55);">'
                + inner
                + '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,0) 60%,rgba(10,7,4,.55) 100%);"></div>'
                + '<div style="position:absolute;top:-20%;left:0;width:55%;height:140%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,248,220,.55),rgba(255,255,255,0));animation:vypa-baller-glare 6s ease-in-out infinite;"></div>'
              + '</div>'
              + corners
            + '</div>'
            + '<div class="' + flankCls + '" style="position:absolute;left:' + (-R(fs * 1.45)) + 'px;bottom:' + (-R(fs * 0.05)) + 'px;transform:rotate(-7deg);transform-origin:50% 100%;">' + flankL + '</div>'
            + '<div class="' + flankCls + '" style="position:absolute;right:' + (-R(fs * 1.45)) + 'px;bottom:' + (-R(fs * 0.05)) + 'px;transform:rotate(7deg);transform-origin:50% 100%;">' + flankR + '</div>'
          + '</div>'
          + '<div style="font-family:\'Cinzel\',serif;font-weight:900;font-size:' + R(fs * 0.82) + 'px;line-height:1;letter-spacing:6px;text-transform:uppercase;' + goldText
            + 'filter:drop-shadow(0 2px 1px rgba(0,0,0,.5)) drop-shadow(0 0 22px ' + c1 + ');animation:vypa-baller-shine 4.5s linear infinite;margin-top:' + R(fs * 0.15) + 'px;">' + name + '</div>'
          + ((tag || moment) ? '<div style="display:flex;align-items:center;justify-content:center;gap:' + R(fs * 0.3) + 'px;flex-wrap:' + (portrait ? 'wrap' : 'nowrap') + ';margin-top:' + R(fs * 0.12) + 'px;">'
              + (tag ? '<span style="display:inline-flex;align-items:center;padding:' + R(fs * 0.1) + 'px ' + R(fs * 0.34) + 'px;border:1.5px solid ' + c2 + 'd9;border-radius:999px;background:rgba(232,198,106,0.08);box-shadow:0 0 26px rgba(232,198,106,0.28),inset 0 0 18px rgba(232,198,106,0.12);font-family:' + dispFont + ';font-size:' + R(fs * 0.36) + 'px;letter-spacing:' + (isAward ? 3 : 6) + 'px;color:' + c2 + ';text-shadow:0 0 14px rgba(255,210,120,0.5);white-space:nowrap;">' + tag + '</span>' : '')
              + (moment ? '<span style="font-family:' + dispFont + ';font-size:' + R(fs * 0.42) + 'px;letter-spacing:' + (isAward ? 2 : 4) + 'px;color:#F6ECCF;text-shadow:0 0 16px rgba(255,210,120,0.3);white-space:nowrap;">' + moment + '</span>' : '')
              + '</div>' : '')))
        + '</div>'
      + '</div>';
  }

  function renderCelebration(rootEl, d) {
    if (!rootEl) return function () {};
    d = d || {};
    var theme = ['birthday','special_guest','award_winner','award_nominees'].indexOf(d.celebrationStyle) >= 0 ? d.celebrationStyle : 'baller';

    var lastW = 0, lastH = 0;
    function build() {
      // Measure the live container in CSS px. A CSS transform (editor zoom) does NOT
      // affect clientWidth/Height, so this is the true layout size. Fall back to any
      // explicit canvas size, then Full-HD landscape.
      var cw = rootEl.clientWidth  || d.canvasW || 1920;
      var ch = rootEl.clientHeight || d.canvasH || 1080;
      lastW = cw; lastH = ch;  // remember what we built against, so the observer can correct a 0-width first paint
      rootEl.innerHTML = _ballerInnerHTML({
        theme: theme,
        fs: d.fontSize || 100,
        cw: cw, ch: ch,
        name: d.content || 'NGOZI',
        c1: d.celebColor1 || '#FFD972',
        c2: d.celebColor2 || '#E8C66A',
        venue:  d.ballerVenue,
        tag:    d.ballerTag,
        moment: d.ballerMoment,
        photo:  d.src,
        photoType: d.srcType,
        logo:   d.ballerLogo,
        showBills: d.showBills !== false,
        billScale: d.billScale || 1,
        anchor:    d.textAnchor || 'mc'
      });
      var baCanvas = rootEl.querySelector('canvas.ba-canvas');
      if (baCanvas && window.VypaCeleb) {
        var intensity = d.ballerIntensity != null ? d.ballerIntensity : 0.5;
        var opts;
        if (theme === 'birthday') {
          opts = { showBills:d.showBills !== false, intensity:intensity, billScale:d.billScale||1, showBottles:false, bills:false, coins:false, confetti:true, confettiHeavy:true, extras:true };
        } else if (theme === 'special_guest') {
          // Elegant: gold confetti + sparkle stars, no money/bottles
          opts = { showBills:d.showBills !== false, intensity:intensity, billScale:d.billScale||1, showBottles:false, bills:false, coins:false, confetti:true, confettiHeavy:false, extras:true };
        } else if (theme === 'award_winner' || theme === 'award_nominees') {
          // Award ceremony: rich gold confetti + sparkle stars, no money/bottles
          opts = { showBills:d.showBills !== false, intensity:intensity, billScale:d.billScale||1, showBottles:false, bills:false, coins:false, confetti:true, confettiHeavy:true, extras:true };
        } else {
          opts = { showBills:d.showBills !== false, intensity:intensity, billScale:d.billScale||1, showBottles:true, bills:true, coins:true, confetti:true, extras:true };
        }
        return window.VypaCeleb.startParticles(baCanvas, rootEl, opts) || function () {};
      }
      return function () {};
    }

    var stop = build();

    // Re-fit when the container is resized (portrait⇄landscape toggle, canvas-size
    // change). ResizeObserver watches the layout box — unaffected by editor zoom — so
    // it fires only on genuine dimension changes. The initial fire is a no-op.
    var ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function () {
        var w = rootEl.clientWidth, h = rootEl.clientHeight;
        if (!w || !h) return;
        if (Math.abs(w - lastW) < 4 && Math.abs(h - lastH) < 4) return;
        try { stop && stop(); } catch (e) {}
        stop = build();
      });
      try { ro.observe(rootEl); } catch (e) {}
    }

    return function () {
      if (ro) { try { ro.disconnect(); } catch (e) {} }
      try { stop && stop(); } catch (e) {}
    };
  }

  function renderMoneyRain(rootEl, d) {
    if (!rootEl) return function () {};
    d = d || {};
    rootEl.innerHTML = '<canvas class="ba-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></canvas>';
    var cv = rootEl.querySelector('canvas.ba-canvas');
    if (cv && window.VypaCeleb) return window.VypaCeleb.startParticles(cv, rootEl, {
      showBills: true,
      intensity: d.intensity != null ? d.intensity : 0.6,
      billScale: d.billScale || 1,
      showBottles: false,
      coins:    d.showCoins !== false,
      confetti: d.showConfetti === true,
      extras:   false
    }) || function () {};
    return function () {};
  }

  window.VypaCelebration = {
    renderCelebration: renderCelebration,
    renderMoneyRain:   renderMoneyRain,
    ballerInnerHTML:   _ballerInnerHTML
  };
})();