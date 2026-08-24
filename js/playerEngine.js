/* =========================================================
   VYPA TIZEN — PLAYBACK ENGINE  (updated)
   =========================================================
   Changes vs. original playerEngine.js:
     • TEP: still images try the Unipicture SoC scaler first (js/tep.js),
       falling back to <img> on older panels or any failure
     • URL / web dashboard content type → iframe WebView
     • Audio playback now shows a branded canvas visualizer
       (Web Audio API AnalyserNode)
     • Anti-black-screen 1 s "breathing" delay retained
     • All existing video / image logic preserved
   ========================================================= */

let playlistItems = [];
let currentIndex  = 0;
let imageTimer    = null;

// Web Audio visualizer handles
var _audioCtx        = null;
var _analyser        = null;
var _vizAnimFrame    = null;
var _audioSrcNode    = null;
var playCount = 0; // Add at the top with other globals

/* ---------------------------------------------------------
   PLAYBACK RESILIENCE — tunables + per-item state
   Mirrors the native players' retry → min-dwell → single-advance
   contract so one undecodable / half-cached file can never strobe
   the screen, and an all-failing playlist degrades to a holding screen.
   --------------------------------------------------------- */
var MIN_DWELL_MS        = 6000;  // floor between an error and the next item
var MAX_MEDIA_RETRIES   = 2;     // video/audio retries before giving up
var RETRY_DELAY_MS      = 1500;  // wait before reloading a failed element
var FAILURE_THRESHOLD   = 3;     // consecutive error-advances → holding screen
var VIDEO_STALL_MS      = 30000; // no playback progress this long → treat as a failure & recover

var _itemToken           = 0;    // increments each new item; stale events ignored
var _itemStartTime       = 0;    // when the current item began showing
var _advanceCommitted    = false;// single-advance guard for the current item
var _retryCount          = 0;    // retries used for the current item
var _retryPending        = false;// a retry is currently queued
var _consecutiveFailures = 0;    // circuit-breaker counter
var _errorTimer          = null; // deferred min-dwell nextItem() timer
var _retryTimer          = null; // deferred retry timer
var _stallTimer          = null; // frozen-video watchdog timer
var _holdingEl           = null; // holding-screen overlay element

/* ---------------------------------------------------------
   PUBLIC: startPlayback
   --------------------------------------------------------- */

function startPlayback(items) {
  if (!items || items.length === 0) {
    console.warn("No items to play");
    return;
  }

  // Keep the FULL list so the scheduling minute-ticker can re-evaluate it,
  // but only rotate through the items active right now (date-range dayparting).
  window._fullPlaylist = items;
  playlistItems = (typeof filterActiveItems === "function")
    ? filterActiveItems(items)
    : items;
  if (!playlistItems.length) playlistItems = items;

  // Jump-to-newest: when a playlist update added an item, playerInit stashes
  // its id so playback starts ON the new content (mirrors Android's
  // _pendingJumpIndex), instead of waiting for the rotation to reach it.
  var jumpId = window._pendingJumpId || null;
  window._pendingJumpId = null;
  currentIndex = 0;
  if (jumpId) {
    for (var i = 0; i < playlistItems.length; i++) {
      var pid = String(playlistItems[i].id || playlistItems[i].media_id || "");
      if (pid && pid === String(jumpId)) { currentIndex = i; break; }
    }
  }

  setState("player");
  playCurrentItem();
}

/* Re-filter the active set in place (called by the scheduling ticker when a
   date window opens/closes). Clamps currentIndex; the next rotation picks up
   the new set without a jarring restart of the current item. */
function rebuildActivePlaylist() {
  var full = window._fullPlaylist || playlistItems;
  playlistItems = (typeof filterActiveItems === "function")
    ? filterActiveItems(full)
    : full;
  if (!playlistItems.length) playlistItems = full;
  if (currentIndex >= playlistItems.length) currentIndex = 0;
}

/* ---------------------------------------------------------
   SCHEDULED ON/OFF HOOK
   ─────────────────────────────────────────────────────────
   screenPower.js calls this on every transition. Going dark
   only needs the timers stopped — the overlay is already up.
   Coming back needs playback kicked off again, because
   playCurrentItem() returned early for the whole window and
   there is no pending timer to wake it.
   --------------------------------------------------------- */

function onScreenPowerChange(isOn) {
  if (!isOn) {
    clearTimeout(imageTimer);
    return;
  }

  if (!playlistItems || !playlistItems.length) {
    // Nothing cached to resume — pull fresh content instead of idling dark
    // until the next hourly re-sync.
    if (typeof reloadPlaylist === "function") reloadPlaylist(false);
    return;
  }

  // Re-filter first: a date window may have opened or closed while we were off.
  if (typeof rebuildActivePlaylist === "function") rebuildActivePlaylist();
  playCurrentItem();
}

/* ---------------------------------------------------------
   ITEM ROUTER
   --------------------------------------------------------- */

function playCurrentItem() {
  // Out of hours: the overlay already hides the screen, but there is no point
  // decoding video or burning bandwidth behind it — and a scheduled shutdown
  // must not be logged as proof-of-play for content nobody can see. Idle here
  // and let onScreenPowerChange() restart playback when the window ends.
  if (typeof screenIsScheduledOff === "function" && screenIsScheduledOff()) {
    return;
  }

  clearTimeout(imageTimer);
  _resetItemResilience();   // reset per-item guards / retry / dwell timers

  var item = playlistItems[currentIndex];
  if (!item) return;

  var type = (item.type || item.media_type || "").toLowerCase();

  // 📸 PoP: notify the proof-of-play engine that a new item is now playing.
  // Mirrors Android's LaunchedEffect(currentIndex, pusherRequest) block in
  // PlayerContainer.kt — lets the engine check if this item matches a
  // pending screenshot target before the media starts rendering.
  if (typeof notifyMediaChanged === "function") {
    notifyMediaChanged(item);
  }

  // 📊 Per-play analytics beat (campaign items only) — plays/impressions/screen_time.
  if (typeof reportPlay === "function") {
    reportPlay(item, Number(item.duration) || 0);
  }

  // Resolve a playable URL asynchronously: a cached blob (object URL) when one
  // exists for offline playback, otherwise the remote URL. On platforms with
  // no blob cache, getPlayableUrl is absent and we fall back synchronously.
  _resolvePlayableUrl(item, function (mediaPath) {
    if (!mediaPath) {
      console.warn("❌ No mediaPath for item:", item);
      return nextItem();
    }

    console.log("▶ Playing:", mediaPath, "| Type:", type);
    _dispatchByType(type, mediaPath, item);
  });
}

function _resolvePlayableUrl(item, cb) {
  if (typeof getPlayableUrl === "function") {
    try { return getPlayableUrl(item, cb); } catch (e) { /* fall through */ }
  }
  cb(item.localPath || item.playUrl || item.url || item.src ||
     item.file || item.media_url || item.path);
}

function _dispatchByType(type, mediaPath, item) {
  switch (type) {
    case "video":
    case "mp4":
    case "m4v":
    case "mov":
      playVideo(mediaPath);
      break;

    case "image":
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "webp":
      playImage(mediaPath, item.duration);
      break;

    case "audio":
    case "mp3":
    case "wav":
    case "aac":
    case "m4a":
      playAudio(mediaPath, item.duration);
      break;

    case "layout":
      // A layout carrying a `celebration` payload renders the baked-in Baller
      // Alert / Money Rain overlay engine LOCALLY (offline, instant) — mirrors
      // Android PlayerScreen's file:///android_asset/celebration path. Any other
      // layout falls back to the server-rendered preview iframe.
      var celebUrl = buildCelebrationUrl(item);
      if (celebUrl) {
        playWebUrl(celebUrl, item.duration || 15);
      } else {
        playWebUrl(mediaPath, item.duration);
      }
      break;

    case "app":        // youtube / google_slides / webpage
      // http(s) url → server-rendered preview (identical to Android). Otherwise
      // build a native embed from app_type + config (youtube IFrame, slides, …).
      playAppItem(item, mediaPath);
      break;

    case "url":
    case "web":
    case "webpage":
    case "html":
    case "dashboard":
      // Live web dashboards inside the iframe WebView.
      playWebUrl(mediaPath, item.duration);
      break;

    default:
      // Last-resort: if mediaPath starts with http and has no extension clue
      // treat it as a web URL
      if (/^https?:\/\//i.test(mediaPath) &&
          !/\.(mp4|m4v|mov|jpg|jpeg|png|gif|webp|mp3|wav|aac|m4a)(\?|$)/i.test(mediaPath)) {
        playWebUrl(mediaPath, item.duration);
      } else {
        console.warn("Unsupported media type:", type, item);
        nextItem();
      }
  }
}

function nextItem() {
  currentIndex++;
  if (currentIndex >= playlistItems.length) currentIndex = 0;
  playCount++; // 🚀 KEY FIX: increment even when currentIndex wraps back
  // to 0 — mirrors Android's playCount++ in onPlaybackEnded,
  // ensures single-item playlists always trigger a fresh
  // media element teardown and reload.
  playCurrentItem();
}

/* ---------------------------------------------------------
   RESILIENCE HELPERS
   --------------------------------------------------------- */

// Called at the START of every item so no timers/guards leak across items.
function _resetItemResilience() {
  _itemToken++;
  _advanceCommitted = false;
  _retryCount       = 0;
  _retryPending     = false;
  _itemStartTime    = Date.now();
  if (_errorTimer) { clearTimeout(_errorTimer); _errorTimer = null; }
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }
}

// An item reached READY / ended normally → clear the circuit breaker.
function _markPlaybackSuccess() {
  if (_consecutiveFailures !== 0) {
    console.log("✅ Playback recovered — resetting failure counter");
  }
  _consecutiveFailures = 0;
  _hideHoldingScreen();
}

// Normal (successful) advance — guarded so an item advances only once.
function _advanceNormal() {
  if (_advanceCommitted) return;
  _advanceCommitted = true;
  nextItem();
}

// Media error entry point. Retries video/audio (retryFn supplied) up to
// MAX_MEDIA_RETRIES; images pass retryFn=null and fall straight through.
function _handleMediaError(label, token, retryFn) {
  if (token !== _itemToken) return;   // stale event from a previous item
  if (_advanceCommitted)    return;   // already advancing
  if (_retryPending)        return;   // a retry is already queued

  if (retryFn && _retryCount < MAX_MEDIA_RETRIES) {
    _retryCount++;
    _retryPending = true;
    console.warn("🔁 Retry " + _retryCount + "/" + MAX_MEDIA_RETRIES + " — " + label);
    _retryTimer = setTimeout(function () {
      _retryPending = false;
      _retryTimer   = null;
      if (token !== _itemToken) return;   // superseded while waiting
      retryFn();
    }, RETRY_DELAY_MS);
    return;
  }

  _advanceAfterError(label, token);
}

// Error-path advance: single-advance guard + circuit breaker + 6 s min dwell.
function _advanceAfterError(label, token) {
  if (token !== _itemToken) return;
  if (_advanceCommitted)    return;
  _advanceCommitted = true;   // commit now so repeat errors can't double-advance

  _consecutiveFailures++;
  console.warn("⚠️ Error-path advance (" + label +
               ") — consecutive failures: " + _consecutiveFailures);

  if (_consecutiveFailures >= FAILURE_THRESHOLD) {
    _showHoldingScreen("Preparing content…");
  }

  var elapsed   = Date.now() - _itemStartTime;
  var remaining = MIN_DWELL_MS - elapsed;
  if (remaining > 0) {
    console.log("⏳ Honouring " + MIN_DWELL_MS + "ms min dwell — waiting " +
                remaining + "ms before advancing");
    _errorTimer = setTimeout(function () {
      _errorTimer = null;
      nextItem();
    }, remaining);
  } else {
    nextItem();
  }
}

// Full-screen branded "Preparing content…" overlay (created once, toggled).
function _showHoldingScreen(message) {
  if (!_holdingEl) {
    _holdingEl = document.getElementById("holdingScreen");
  }
  if (!_holdingEl) {
    _holdingEl = document.createElement("div");
    _holdingEl.id = "holdingScreen";
    _holdingEl.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "background:#000;color:#fff;font-family:Arial,sans-serif;";
    var logo = document.createElement("div");
    logo.textContent = "VYPΛ";
    logo.style.cssText = "font-size:8vw;font-weight:bold;color:#0047FF;margin-bottom:2vh;";
    var msg = document.createElement("div");
    msg.id = "holdingScreenMsg";
    msg.style.cssText = "font-size:2.5vw;opacity:0.85;";
    _holdingEl.appendChild(logo);
    _holdingEl.appendChild(msg);
    document.body.appendChild(_holdingEl);
  }
  var msgEl = document.getElementById("holdingScreenMsg");
  if (msgEl) msgEl.textContent = message || "Preparing content…";
  _holdingEl.style.display = "flex";
  console.log("🛡 Holding screen shown:", message);
}

function _hideHoldingScreen() {
  if (_holdingEl && _holdingEl.style.display !== "none") {
    _holdingEl.style.display = "none";
    console.log("🛡 Holding screen hidden — playback resumed");
  }
}

/* ---------------------------------------------------------
   HELPERS: hide all player layers
   --------------------------------------------------------- */

function _hideAllLayers() {
  var video    = document.getElementById("videoPlayer");
  var image    = document.getElementById("imagePlayer");
  var audio    = document.getElementById("audioPlayer");
  var webFrame = document.getElementById("webviewFrame");
  var vizCanvas = document.getElementById("audioVisualizer");

  if (video)    { try { video.pause(); video.currentTime = 0; } catch(e){} video.style.display = "none"; }
  if (image)    { image.style.display = "none"; image.src = ""; }
  if (audio)    { try { audio.pause(); audio.currentTime = 0; } catch(e){} audio.style.display = "none"; }
  if (webFrame) { webFrame.style.display = "none"; webFrame.src = "about:blank"; }
  if (vizCanvas){ vizCanvas.style.display = "none"; }

  // Release any SoC scaler handle before the next item takes the plane.
  // No-op when TEP is unavailable or the fast path never engaged.
  if (typeof TEP !== "undefined") { TEP.unipicture.hide(); }

  _stopAudioVisualizer();
}

/* ---------------------------------------------------------
   VIDEO
   --------------------------------------------------------- */

function playVideo(src) {
  var video = document.getElementById("videoPlayer");
  if (!video) return nextItem();

  _hideAllLayers();

  var token = _itemToken;   // single-advance / stale-event guard for this item

  video.onloadeddata = null;
  video.onended      = null;
  video.onerror      = null;

  function _loadVideo() {
//🔄 KEY FIX: unconditional blank-then-reassign forces Tizen WebKit to
    // fully tear down the media pipeline on every call — including same-src
    // loops. Mirrors Android key(currentIndex, playCount) recomposition.
    video.src = "";
    video.src = src;
    video.load();
  }

  function _retryVideo() {
    console.warn("🔁 Reloading video for retry:", src);
    _loadVideo();
    var pr = video.play();
    if (pr && pr.catch) pr.catch(function (err) {
      console.warn("video.play() retry failed:", err);
      _handleMediaError("video", token, _retryVideo);
    });
  }

  _loadVideo();

  // 1 s breathing delay — prevents black-screen flash on older Samsung TVs
  setTimeout(function () {
    if (token !== _itemToken) return;   // a newer item superseded us

    // Frozen-video watchdog: (re)arm a deadline that is pushed out whenever playback makes
    // progress (timeupdate). If the video never starts, or freezes mid-play for VIDEO_STALL_MS
    // with no progress, treat it as a failure and route through the same retry→skip recovery —
    // an infinitely-buffering <video> emits no 'error', so without this it would freeze forever.
    function _armStall() {
      if (_stallTimer) clearTimeout(_stallTimer);
      _stallTimer = setTimeout(function () {
        if (token !== _itemToken) return;
        console.warn("⏱ Video stalled (no progress) — recovering:", src);
        _handleMediaError("video-stall", token, _retryVideo);
      }, VIDEO_STALL_MS);
    }

    video.onloadeddata = function () {
      if (token !== _itemToken) return;
      video.style.display = "block";
      _markPlaybackSuccess();           // reached READY
      _armStall();
      var p = video.play();
      if (p && p.catch) p.catch(function (err) {
        console.warn("video.play() failed:", err);
        _handleMediaError("video", token, _retryVideo);
      });
    };

    video.ontimeupdate = function () {  // playback progressed → push the stall deadline out
      if (token === _itemToken) _armStall();
    };

    video.onerror = function (e) {
      console.warn("❌ Video error:", src, e);
      if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }
      _handleMediaError("video", token, _retryVideo);
    };

    video.onended = function () {
      if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; }
      _advanceNormal();
    };

    _armStall();   // arm immediately: a video that never even loads still trips the watchdog
  }, 1000);
}

/* ---------------------------------------------------------
   IMAGE
   --------------------------------------------------------- */

function playImage(src, duration) {
  var image = document.getElementById("imagePlayer");
  if (!image) return nextItem();

  _hideAllLayers();

  var token = _itemToken;   // single-advance / stale-event guard for this item

  // TEP fast path: render locally-cached stills through the SoC scaler
  // (seamless 4K, no browser decode). Returns false on older panels, on
  // remote URLs, or if any step of the documented sequence fails — in which
  // case we fall straight through to the <img> path below, unchanged.
  if (typeof TEP !== "undefined" &&
      TEP.unipicture.show(src, { width: window.innerWidth, height: window.innerHeight })) {
    // show() is synchronous — there is no onload to wait for, so the dwell
    // timer starts here. Duration semantics deliberately identical to the
    // <img> path below.
    _markPlaybackSuccess();           // rendered → clear the circuit breaker
    var uniTime = ((duration || 15)) * 1000;
    imageTimer = setTimeout(function () { _advanceNormal(); }, uniTime);
    console.log("🖼 Unipicture:", src, "| dwell:", uniTime / 1000, "s");
    return;
  }

  image.onload  = null;
  image.onerror = null;

  image.onload = function () {
    if (token !== _itemToken) return;
    image.style.display = "block";
    _markPlaybackSuccess();           // reached READY
    // Default dwell 15 s — matches the VYPA media-duration policy / Android default.
    var displayTime = ((duration || 15)) * 1000;
    imageTimer = setTimeout(function () { _advanceNormal(); }, displayTime);
  };

  // A load error has no meaningful retry — go straight to the
  // min-dwell-then-advance path (retryFn = null).
  image.onerror = function (e) {
    console.warn("❌ Image error:", src, e);
    _handleMediaError("image", token, null);
  };

  image.src = src;
}

/* ---------------------------------------------------------
   AUDIO  +  Branded Canvas Visualizer
   --------------------------------------------------------- */

function playAudio(src, duration) {
  var audio     = document.getElementById("audioPlayer");
  var vizCanvas = document.getElementById("audioVisualizer");

  if (!audio) return nextItem();

  _hideAllLayers();

  var token = _itemToken;   // single-advance / stale-event guard for this item

  audio.onended = null;
  audio.onerror = null;

  function _loadAudio() {
    audio.src = "";
    audio.src = src;
    audio.load();
  }

  function _retryAudio() {
    console.warn("🔁 Reloading audio for retry:", src);
    _loadAudio();
    var pr = audio.play();
    if (pr && pr.catch) pr.catch(function (err) {
      console.warn("audio.play() retry failed:", err);
      _handleMediaError("audio", token, _retryAudio);
    });
  }

  _loadAudio();

  var p = audio.play();
  if (p && p.catch) p.catch(function (err) {
    console.warn("audio.play() failed:", err);
    _handleMediaError("audio", token, _retryAudio);
  });

  audio.onerror = function (e) {
    console.warn("❌ Audio error:", src, e);
    _handleMediaError("audio", token, _retryAudio);
  };

  // Started playing → reached READY, clear the circuit breaker.
  audio.onplaying = function () {
    if (token !== _itemToken) return;
    _markPlaybackSuccess();
  };

  // Duration fallback for streams
  if (duration) {
    audio.onended = null;
    imageTimer = setTimeout(function () { _advanceNormal(); }, duration * 1000);
  } else {
    audio.onended = function () { _advanceNormal(); };
  }

  // Launch visualizer
  if (vizCanvas) {
    vizCanvas.style.display = "block";
    _startAudioVisualizer(audio, vizCanvas);
  }
}

/* ---------------------------------------------------------
   AUDIO VISUALIZER  (Web Audio API)
   --------------------------------------------------------- */

function _startAudioVisualizer(audioEl, canvas) {
  _stopAudioVisualizer(); // clean up any prior instance

  try {
    _audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    _analyser   = _audioCtx.createAnalyser();
    _analyser.fftSize = 128;

    _audioSrcNode = _audioCtx.createMediaElementSource(audioEl);
    _audioSrcNode.connect(_analyser);
    _analyser.connect(_audioCtx.destination);

    var bufLen   = _analyser.frequencyBinCount;
    var dataArr  = new Uint8Array(bufLen);
    var ctx2d    = canvas.getContext("2d");
    var W        = canvas.width  = window.innerWidth;
    var H        = canvas.height = window.innerHeight;
    var barW     = (W / bufLen) * 2.5;
    var VYPA_BLUE = "#0047FF";

    function draw() {
      _vizAnimFrame = requestAnimationFrame(draw);

      _analyser.getByteFrequencyData(dataArr);

      ctx2d.fillStyle = "rgba(0,0,0,0.25)";
      ctx2d.fillRect(0, 0, W, H);

      // Centered VYPΛ logo text
      ctx2d.save();
      ctx2d.globalAlpha = 0.12;
      ctx2d.fillStyle   = VYPA_BLUE;
      ctx2d.font        = "bold " + Math.round(H * 0.20) + "px Arial";
      ctx2d.textAlign   = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillText("VYPΛ", W / 2, H / 2);
      ctx2d.restore();

      // Frequency bars
      var x = 0;
      for (var i = 0; i < bufLen; i++) {
        var barH = (dataArr[i] / 255) * H * 0.7;

        // Gradient: blue core → white peak
        var grad = ctx2d.createLinearGradient(x, H, x, H - barH);
        grad.addColorStop(0,   "#0047FF");
        grad.addColorStop(0.7, "#66aaff");
        grad.addColorStop(1,   "#ffffff");

        ctx2d.fillStyle = grad;
        ctx2d.fillRect(x, H - barH, barW - 1, barH);

        x += barW + 1;
      }
    }

    draw();

  } catch (e) {
    console.warn("Audio visualizer failed to start:", e);
    // Non-fatal: audio still plays, just no viz
  }
}

function _stopAudioVisualizer() {
  if (_vizAnimFrame) {
    cancelAnimationFrame(_vizAnimFrame);
    _vizAnimFrame = null;
  }
  try { if (_audioSrcNode) _audioSrcNode.disconnect(); } catch(e) {}
  try { if (_analyser)     _analyser.disconnect();     } catch(e) {}
  try { if (_audioCtx)     _audioCtx.close();          } catch(e) {}
  _audioSrcNode = null;
  _analyser     = null;
  _audioCtx     = null;
}

/* ---------------------------------------------------------
   WEB URL / DASHBOARD  (iframe WebView)
   --------------------------------------------------------- */

/**
 * Renders a web URL inside the #webviewFrame <iframe>.
 * Duration is optional; if supplied the next item plays after it.
 * Default dwell time is 30 s (good for dashboards).
 */
function playWebUrl(url, duration) {
  var webFrame = document.getElementById("webviewFrame");
  if (!webFrame) {
    console.warn("❌ #webviewFrame element not found — add it to index.html");
    return nextItem();
  }

  _hideAllLayers();

  // Clear existing page first to avoid flash of stale content
  webFrame.src = "about:blank";

  setTimeout(function () {
    webFrame.src = url;
    webFrame.style.display = "block";

    var displayTime = (duration || 30) * 1000;
    imageTimer = setTimeout(nextItem, displayTime);

    console.log("🌐 Web URL playing:", url, "| dwell:", displayTime / 1000, "s");
  }, 500);
}

/* ---------------------------------------------------------
   CELEBRATION  (Baller Alert / Money Rain overlay engine)
   ─────────────────────────────────────────────────────────
   Loads the baked-in celebration template from the package
   (celebration/celebration.html) with the dynamic payload —
   name / colours / media — injected via the URL hash, exactly
   as Android does with file:///android_asset/celebration. The
   engine runs entirely offline; frame media plays from the
   locally-cached file:// URI when available (cacheService).
   --------------------------------------------------------- */

function buildCelebrationUrl(item) {
  if (!item || !item.celebration) return null;
  try {
    var payload = (typeof localizeCelebration === "function")
      ? localizeCelebration(item)
      : (typeof item.celebration === "string"
          ? JSON.parse(item.celebration)
          : item.celebration);
    if (!payload) return null;
    return "celebration/celebration.html#" +
           encodeURIComponent(JSON.stringify(payload));
  } catch (e) {
    console.warn("buildCelebrationUrl failed:", e);
    return null;
  }
}

/* ---------------------------------------------------------
   APP ITEMS  (youtube / google_slides / webpage)
   ─────────────────────────────────────────────────────────
   Mirrors Android AppPlayer: a real http(s) url renders the
   server-side preview; otherwise a native embed is built from
   app_type + config. Everything renders in the same iframe.
   --------------------------------------------------------- */

function playAppItem(item, mediaPath) {
  var url = item.url || item.src || item.media_url || mediaPath || "";
  if (/^https?:\/\//i.test(url)) {
    // Server-rendered preview URL (celebration engine baked in server-side).
    return playWebUrl(url, item.duration);
  }

  var embedUrl = buildAppEmbedUrl(item);
  if (embedUrl) {
    return playWebUrl(embedUrl, item.duration);
  }

  console.warn("Unsupported app item (no url and no embeddable config):", item);
  return nextItem();
}

function _parseAppConfig(config) {
  if (!config) return {};
  if (typeof config === "object") return config;
  try { return JSON.parse(config); } catch (e) { return {}; }
}

function _youtubeIdFromUrl(url) {
  if (!url) return "";
  var s = String(url);
  var m = s.match(/[?&]v=([^&]+)/);            if (m) return m[1];
  m = s.match(/youtu\.be\/([^?&/]+)/);          if (m) return m[1];
  m = s.match(/\/embed\/([^?&/]+)/);            if (m) return m[1];
  m = s.match(/\/shorts\/([^?&/]+)/);           if (m) return m[1];
  return "";
}

function buildAppEmbedUrl(item) {
  var appType = (item.app_type || item.appType || "").toLowerCase();
  var cfg     = _parseAppConfig(item.config);

  if (appType === "youtube") {
    var vid = cfg.video_id || cfg.videoId ||
              _youtubeIdFromUrl(cfg.url || cfg.embed_url || item.url || "");
    if (!vid) return null;
    // autoplay + muted + looped + chromeless — matches Android YouTubePlayer.
    return "https://www.youtube.com/embed/" + encodeURIComponent(vid) +
           "?autoplay=1&mute=1&controls=0&loop=1&playlist=" + encodeURIComponent(vid) +
           "&modestbranding=1&rel=0&playsinline=1&iv_load_policy=3";
  }

  // google_slides / webpage / anything else with an embeddable url.
  return cfg.embed_url || cfg.url || null;
}