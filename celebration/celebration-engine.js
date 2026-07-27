/* ============================================================================
   VYPA — shared celebration particle engine (Baller Alert / Birthday money rain).
   Single source of truth used by BOTH the layout editor (editor.view.php) and
   the live player preview (preview.view.php → Android WebView).

     var stop = VypaCeleb.startParticles(canvasEl, rootEl, opts);
     // ... later: stop();

   PERFORMANCE NOTES (why this version is fast on weak WebView GPUs):
   1. Motion is DELTA-TIME scaled (factor f = dt/16.67). The old engine moved a
      fixed amount per FRAME, so at 30fps it ran at half speed (slow-motion). Now
      it plays at correct real-time speed at ANY framerate.
   2. Bills & coins are pre-rendered ONCE to offscreen sprite canvases and blitted
      with drawImage. The old engine rebuilt a gradient AND rendered custom-font
      text (fillText) for every bill/coin EVERY frame — hundreds of the most
      expensive canvas ops per frame. That was the cause of the stutter.
============================================================================ */
(function () {
  "use strict";

  function startParticles(canvas, root, opts) {
    opts = opts || {};
    if (opts.showBills === false) return function () {};
    var ctx = canvas.getContext('2d');
    if (!ctx) return function () {};
    var intensity   = (opts.intensity != null) ? opts.intensity : ((opts.billCount || 32) / 32);
    var density     = intensity;
    var pscale      = opts.billScale || 1;
    var showBottles = opts.showBottles !== false;
    var wantBills   = opts.bills    !== false;  // green money bills
    var wantCoins   = opts.coins    !== false;  // gold coins
    var wantConf    = opts.confetti !== false;  // confetti
    var confHeavy   = opts.confettiHeavy === true; // heavier + multicolor (birthday)
    var wantExtras  = opts.extras   !== false;  // stars + dust
    var CONF_COLORS = confHeavy
      ? ['#ff5fa2','#ffd166','#5fd0ff','#7cf08a','#c08bff','#ff8c42','#fff1a8','#ff5252']
      : ['#FFD972','#F6ECCF','#E7A93B'];
    var W = 1920, H = 1080;
    function resize() { W = canvas.clientWidth || 1920; H = canvas.clientHeight || 1080; canvas.width = W; canvas.height = H; }
    resize();

    function _rr(c, x, y, w, h, r) {
      if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
      c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    }

    /* ── Pre-rendered sprites (built once, blitted every frame) ────────────── */
    var SS = 2; // supersample for crisp downscaling
    function makeCoinSprite() {
      var R = 22, pad = 4, S = (R + pad) * 2;
      var c = document.createElement('canvas'); c.width = c.height = S * SS;
      var g = c.getContext('2d'); g.scale(SS, SS); g.translate(S / 2, S / 2);
      g.beginPath(); g.ellipse(0, 0, R, R, 0, 0, 6.28);
      var cg = g.createLinearGradient(-R, -R, R, R);
      cg.addColorStop(0, '#FFF1C4'); cg.addColorStop(0.5, '#F0BE54'); cg.addColorStop(1, '#B5851F');
      g.fillStyle = cg; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(120,86,24,0.7)'; g.stroke();
      g.fillStyle = 'rgba(120,86,24,0.55)'; g.font = 'bold ' + Math.round(R * 0.9) + 'px Cinzel,serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, 1);
      return { c: c, R: R, S: S };
    }
    function makeBillSprite() {
      var w = 58, h = 28, pad = 4, SW = w + pad * 2, SH = h + pad * 2;
      var c = document.createElement('canvas'); c.width = SW * SS; c.height = SH * SS;
      var g = c.getContext('2d'); g.scale(SS, SS); g.translate(SW / 2, SH / 2);
      var bg = g.createLinearGradient(-w / 2, 0, w / 2, 0);
      bg.addColorStop(0, '#2f7a52'); bg.addColorStop(0.5, '#46996a'); bg.addColorStop(1, '#2c6e4a');
      g.fillStyle = bg; g.beginPath(); _rr(g, -w / 2, -h / 2, w, h, 3); g.fill();
      g.lineWidth = 1.4; g.strokeStyle = 'rgba(18,54,36,0.85)'; g.stroke();
      g.lineWidth = 1; g.strokeStyle = 'rgba(212,240,222,0.45)'; g.beginPath(); _rr(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 2); g.stroke();
      g.fillStyle = 'rgba(225,245,232,0.32)'; g.beginPath(); g.ellipse(0, 0, 9, h / 2 - 4, 0, 0, 6.28); g.fill();
      g.fillStyle = '#E8C66A'; g.font = 'bold 9px Cinzel,serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('100', -w / 2 + 10, 0); g.fillText('100', w / 2 - 10, 0);
      g.fillStyle = 'rgba(16,52,34,0.9)'; g.font = 'bold 12px Cinzel,serif'; g.fillText('$', 0, 0);
      return { c: c, w: w, h: h, SW: SW, SH: SH };
    }
    var coinSprite = makeCoinSprite();
    var billSprite = makeBillSprite();
    // Re-bake once web fonts settle so the baked $/100 glyphs use Cinzel.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { coinSprite = makeCoinSprite(); billSprite = makeBillSprite(); });
    }

    var parts = [];
    var RND = function (a, b) { return a + Math.random() * (b - a); };
    var emittersCache = [];
    function computeEmitters() {
      var es = [];
      if (!showBottles) return es;
      var cr = canvas.getBoundingClientRect();
      if (!cr.width || !cr.height) return es;
      var bs = root.querySelectorAll('.ba-bottle');
      for (var i = 0; i < bs.length; i++) {
        var r = bs[i].getBoundingClientRect();
        if (!r.width) continue;
        es.push({ x: (r.left + r.width / 2 - cr.left) / cr.width * W, y: (r.top - cr.top) / cr.height * H + 8 });
      }
      return es;
    }

    var spawnCoin  = function (x, y) { parts.push({k:'coin',x:x,y:y,vx:RND(-2.4,2.4),vy:RND(1.5,3.5),r:RND(13,22)*pscale,rot:RND(0,6.28),vr:RND(-0.18,0.18)}); };
    var spawnConf  = function (x, y) { parts.push({k:'conf',x:x,y:y,vx:RND(-3,3),vy:RND(-2,2),w:RND(7,15),h:RND(3,6),rot:RND(0,6.28),vr:RND(-0.3,0.3),col:CONF_COLORS[(Math.random()*CONF_COLORS.length)|0],g:0.2}); };
    var spawnStar  = function () { parts.push({k:'star',x:RND(W*0.26,W*0.74),y:RND(H*0.14,H*0.64),life:0,max:RND(40,70),sm:RND(10,20)}); };
    var spawnBill  = function (x, y) { parts.push({k:'bill',x:x,y:y,vx:RND(-2,2),vy:RND(1,2.6),rot:RND(0,6.28),vr:RND(-0.11,0.11),ph:RND(0,6.28),w:RND(48,58)*pscale,h:RND(24,28)*pscale}); };
    var spawnDust  = function () { parts.push({k:'dust',x:RND(0,W),y:H+20,vy:RND(-0.5,-1.4),drift:RND(-0.4,0.4),r:RND(1,2.6),a:RND(0.15,0.55),p:RND(0,6.28)}); };
    var spawnSpark = function (e) { var ang=RND(-Math.PI*0.85,-Math.PI*0.15), sp=RND(2,6.5); parts.push({k:'spark',x:e.x,y:e.y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,life:0,max:RND(18,34)}); };

    // Pre-fill so the screen is already alive on the first frame
    var pf;
    if (wantBills) for (pf = 0; pf < Math.round(14 * density); pf++) spawnBill(RND(0, W), RND(-H, H * 0.5));
    if (wantCoins) for (pf = 0; pf < Math.round(9 * density); pf++) spawnCoin(RND(0, W), RND(-H, H * 0.5));
    if (wantConf)  for (pf = 0; pf < Math.round((confHeavy ? 28 : 14) * density); pf++) spawnConf(RND(0, W), RND(-H, H * 0.5));

    var raf = 0, last = performance.now();
    var aBill = 0, aCoin = 0, aConf = 0, aDust = 0, aStar = 0, aSpark = 0;

    function loop(now) {
      // Cap the particle canvas to ~30fps. The expensive part of a celebration with a
      // video in the frame is the canvas + the video decoder fighting for the GPU. Halving
      // the canvas frame rate frees the decoder so the video plays smoothly; delta-time
      // motion below keeps the confetti speed correct regardless of frame rate.
      var dt = now - last;
      if (dt < 32) { raf = requestAnimationFrame(loop); return; }
      if (dt > 80) dt = 80; last = now;
      var f = dt / 16.6667;            // frame-equivalent factor → real-time motion at any fps
      ctx.clearRect(0, 0, W, H);
      if (parts.length > 1600) parts.splice(0, parts.length - 1600);

      if (wantBills) { aBill += dt * density * 0.008; while (aBill >= 1) { aBill--; spawnBill(RND(0, W), RND(-180, -30)); } }
      if (wantCoins) { aCoin += dt * density * 0.004; while (aCoin >= 1) { aCoin--; spawnCoin(RND(0, W), RND(-180, -20)); } }
      if (wantConf)  { aConf += dt * density * (confHeavy ? 0.02 : 0.006); while (aConf >= 1) { aConf--; spawnConf(RND(0, W), RND(-60, -10)); } }
      if (wantExtras) {
        aDust += dt * 0.012;  while (aDust >= 1) { aDust--; spawnDust(); }
        aStar += dt * 0.0026; while (aStar >= 1) { aStar--; spawnStar(); }
      }
      if (emittersCache.length) { aSpark += dt * density * 0.05; while (aSpark >= 1) { aSpark--; spawnSpark(emittersCache[(Math.random() * emittersCache.length) | 0]); } }

      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        if (p.k === 'dust') {
          p.y += p.vy * f; p.x += p.drift * f; p.p += 0.05 * f;
          var da = p.a * (0.6 + 0.4 * Math.sin(p.p));
          ctx.beginPath(); ctx.fillStyle = 'rgba(255,224,150,' + da.toFixed(3) + ')'; ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
          if (p.y < -20) parts.splice(i, 1);
        } else if (p.k === 'coin') {
          p.vy += 0.14 * f; p.x += p.vx * f; p.y += p.vy * f; p.rot += p.vr * f;
          var sx = Math.abs(Math.cos(p.rot));
          var cs = p.r / coinSprite.R;
          ctx.save(); ctx.translate(p.x, p.y); ctx.scale(cs * Math.max(0.08, sx), cs);
          ctx.drawImage(coinSprite.c, -coinSprite.S / 2, -coinSprite.S / 2, coinSprite.S, coinSprite.S);
          ctx.restore();
          if (p.y > H + 40) parts.splice(i, 1);
        } else if (p.k === 'conf') {
          p.vy += p.g * f; p.vx *= Math.pow(0.99, f); p.x += p.vx * f; p.y += p.vy * f; p.rot += p.vr * f;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.col; ctx.globalAlpha = 0.95; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore(); ctx.globalAlpha = 1;
          if (p.y > H + 40) parts.splice(i, 1);
        } else if (p.k === 'bill') {
          p.vy += 0.05 * f; if (p.vy > 3.1) p.vy = 3.1; p.ph += 0.07 * f;
          p.x += (p.vx + Math.sin(p.ph) * 1.5) * f; p.y += p.vy * f; p.rot += p.vr * f;
          var fl = Math.cos(p.ph);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.scale(p.w / billSprite.w, (p.h / billSprite.h) * Math.max(0.18, Math.abs(fl)));
          ctx.drawImage(billSprite.c, -billSprite.SW / 2, -billSprite.SH / 2, billSprite.SW, billSprite.SH);
          ctx.restore();
          if (p.y > H + 60) parts.splice(i, 1);
        } else if (p.k === 'spark') {
          p.life += f; p.vy += 0.12 * f; p.x += p.vx * f; p.y += p.vy * f;
          var sa = 1 - p.life / p.max;
          if (sa <= 0) { parts.splice(i, 1); continue; }
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(255,' + Math.round(210 + 40 * sa) + ',150,' + sa.toFixed(3) + ')';
          ctx.lineWidth = 2.2; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 1.6, p.y - p.vy * 1.6); ctx.stroke();
          ctx.restore();
        } else if (p.k === 'star') {
          p.life += f;
          var kk = p.life / p.max;
          if (kk >= 1) { parts.splice(i, 1); continue; }
          var s = Math.sin(kk * Math.PI) * p.sm, aa = Math.sin(kk * Math.PI);
          ctx.save(); ctx.translate(p.x, p.y); ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,238,180,' + (aa * 0.9).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(0, -s * 2); ctx.lineTo(s * 0.32, -s * 0.32); ctx.lineTo(s * 2, 0); ctx.lineTo(s * 0.32, s * 0.32);
          ctx.lineTo(0, s * 2); ctx.lineTo(-s * 0.32, s * 0.32); ctx.lineTo(-s * 2, 0); ctx.lineTo(-s * 0.32, -s * 0.32); ctx.closePath();
          ctx.fill(); ctx.restore();
        }
      }
      raf = requestAnimationFrame(loop);
    }

    var onResize = function () { resize(); emittersCache = computeEmitters(); };
    window.addEventListener('resize', onResize);
    requestAnimationFrame(function () { emittersCache = computeEmitters(); });
    raf = requestAnimationFrame(loop);
    return function () { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }

  window.VypaCeleb = { startParticles: startParticles };
})();
