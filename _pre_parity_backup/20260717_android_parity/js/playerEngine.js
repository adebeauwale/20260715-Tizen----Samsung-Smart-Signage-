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
   ITEM ROUTER
   --------------------------------------------------------- */

function playCurrentItem() {
  clearTimeout(imageTimer);

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
    case "url":
    case "web":
    case "webpage":
    case "html":
    case "dashboard":
    case "app":        // server-rendered app preview (youtube / google_slides / webpage)
      // Layouts/apps render server-side (the preview URL includes the celebration
      // engine) inside the same iframe used for web dashboards.
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

  video.onloadeddata = null;
  video.onended      = null;
  video.onerror      = null;

//🔄 KEY FIX: unconditional blank-then-reassign forces Tizen WebKit to
  // fully tear down the media pipeline on every call — including same-src
  // loops. Mirrors Android key(currentIndex, playCount) recomposition.
  video.src = "";
  video.src = src;
  video.load();;

  // 1 s breathing delay — prevents black-screen flash on older Samsung TVs
  setTimeout(function () {
    video.onloadeddata = function () {
      video.style.display = "block";
      var p = video.play();
      if (p && p.catch) p.catch(function (err) {
        console.warn("video.play() failed:", err);
        nextItem();
      });
    };

    video.onerror = function (e) {
      console.warn("❌ Video error:", src, e);
      nextItem();
    };

    video.onended = function () {
      nextItem();
    };
  }, 1000);
}

/* ---------------------------------------------------------
   IMAGE
   --------------------------------------------------------- */

function playImage(src, duration) {
  var image = document.getElementById("imagePlayer");
  if (!image) return nextItem();

  _hideAllLayers();

  // TEP fast path: render locally-cached stills through the SoC scaler
  // (seamless 4K, no browser decode). Returns false on older panels, on
  // remote URLs, or if any step of the documented sequence fails — in which
  // case we fall straight through to the <img> path below, unchanged.
  if (typeof TEP !== "undefined" &&
      TEP.unipicture.show(src, { width: window.innerWidth, height: window.innerHeight })) {
    // show() is synchronous — there is no onload to wait for, so the dwell
    // timer starts here. Duration semantics deliberately identical to the
    // <img> path below.
    var uniTime = ((duration || 10)) * 1000;
    imageTimer = setTimeout(nextItem, uniTime);
    console.log("🖼 Unipicture:", src, "| dwell:", uniTime / 1000, "s");
    return;
  }

  image.onload  = null;
  image.onerror = null;

  image.onload = function () {
    image.style.display = "block";
    var displayTime = ((duration || 10)) * 1000;
    imageTimer = setTimeout(nextItem, displayTime);
  };

  image.onerror = function (e) {
    console.warn("❌ Image error:", src, e);
    nextItem();
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

  audio.onended = null;
  audio.onerror = null;
  
  audio.src = "";
  audio.src = src;
  audio.load();

  var p = audio.play();
  if (p && p.catch) p.catch(function (err) {
    console.warn("audio.play() failed:", err);
    nextItem();
  });

  audio.onerror = function (e) {
    console.warn("❌ Audio error:", src, e);
    nextItem();
  };

  // Duration fallback for streams
  if (duration) {
    audio.onended = null;
    imageTimer = setTimeout(nextItem, duration * 1000);
  } else {
    audio.onended = function () { nextItem(); };
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