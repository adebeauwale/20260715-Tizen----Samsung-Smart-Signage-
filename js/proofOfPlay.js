/* =========================================================
   VYPA TIZEN — PROOF-OF-PLAY (PoP) ENGINE  v2
   =========================================================

   Mirrors the Android PoP flow exactly:

   1.  Pusher fires "capture_screenshot" on the private
       user channel with { request_id, target_identifier,
       campaign_id }.

   2.  The engine stores the pending request in
       _pendingPopRequest.

   3.  On every media item change (call notifyMediaChanged)
       it checks whether the NOW-PLAYING item matches the
       target (by mediaId, title, or "IMMEDIATE").

   4.  On match: wait a randomised 1–15 s delay, then:
         a) Capture the active player element via Canvas
            (equivalent to Android PixelCopy).
         b) Upload the JPEG file via multipart POST
            → https://advertise.vypa.co/proof_of_play/uploadScreenshot
         c) Report metadata via JSON POST
            → https://advertise.vypa.co/proof_of_play
         d) Mark the request complete via POST
            → https://advertise.vypa.co/proof_of_play/markScreenshotComplete

   5.  Polling fallback (every 30 s) queries
       /proof_of_play/getPendingScreenshot when Pusher is
       not connected — mirrors Android's pollingJob.

   Requires (globals):
     getPairedDevice()          — storage.js
     userChannel                — apiService.js (Pusher ch)
     playlistItems, currentIndex — playerEngine.js
   ========================================================= */

/* ---------------------------------------------------------
   CONSTANTS
   --------------------------------------------------------- */

var POP_BASE          = "https://advertise.vypa.co";
var POP_UPLOAD_URL    = POP_BASE + "/proof_of_play/uploadScreenshot";
var POP_REPORT_URL    = POP_BASE + "/proof_of_play";
var POP_MARK_DONE_URL = POP_BASE + "/proof_of_play/markScreenshotComplete";
var POP_POLL_URL      = POP_BASE + "/proof_of_play/getPendingScreenshot";

// Per-play analytics beat (separate controller). Backend:
//   Proofofplay::report() → UPDATE campaigns SET plays+1, impressions+1,
//   screen_time += duration/60. Fires on EVERY campaign-item playout.
var POP_PLAY_REPORT_URL = POP_BASE + "/proofofplay/report";

/* ---------------------------------------------------------
   PER-PLAY REPORT  (drives advertiser plays / impressions /
   screen_time). Mirrors Android's per-item reportProofOfPlay()
   in PlayerContainer.kt — fired each time an item starts.

   Only campaign items report (the endpoint requires campaign_id).
   Regular playlist media with no campaign is skipped server-side
   anyway, so we short-circuit here to avoid useless 400s.
   --------------------------------------------------------- */

function reportPlay(item, durationSec) {
  if (!item) return;

  var campaignId = item.campaign_id || item.campaignId || item.campaign || "";
  if (!campaignId) return;  // not a campaign item — nothing to bill

  var pairedDevice = (typeof getPairedDevice === "function") ? getPairedDevice() : null;
  var screenId = (pairedDevice && pairedDevice.screenId) || item.screen_id || "";
  if (!screenId) return;

  var mediaId = String(item.mediaId || item.media_id || item.id || "");
  var userId  = (pairedDevice && pairedDevice.userId) || "";

  var now = new Date();
  var pad = function (n) { return n < 10 ? "0" + n : n; };
  var capturedAt =
    now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " +
    pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());

  var body = {
    screen_id:   screenId,
    campaign_id: String(campaignId),
    media_id:    mediaId,
    user_id:     String(userId),
    captured_at: capturedAt,
    duration:    Math.max(0, Number(durationSec) || 0)
  };

  fetch(POP_PLAY_REPORT_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body:    JSON.stringify(body)
  })
  .then(function (r) { console.log("📊 Play reported:", campaignId, "HTTP", r.status); })
  .catch(function (e) { console.warn("📊 reportPlay failed (non-fatal):", e); });
}

/* ---------------------------------------------------------
   STATE
   --------------------------------------------------------- */

/**
 * _pendingPopRequest mirrors Android's _pusherScreenshotRequest StateFlow.
 * Shape: { requestId, targetIdentifier, campaignId } | null
 */
var _pendingPopRequest  = null;
var _popPollInterval    = null;
var _popCaptureInFlight = false;   // guard against double-capture

/* ---------------------------------------------------------
   PUBLIC: notifyMediaChanged
   ─────────────────────────────────────────────────────────
   Call this from playerEngine.js every time a new item
   starts playing.  Mirrors the Android LaunchedEffect
   (currentIndex, pusherRequest) block.

   @param {object} item   The now-playing playlist item.
                          Must have: mediaId (or id), title,
                          type, url / localPath.
   --------------------------------------------------------- */

function notifyMediaChanged(item) {
  if (!_pendingPopRequest || _popCaptureInFlight) return;
  if (!item) return;

  var req    = _pendingPopRequest;
  var target = req.targetIdentifier || "IMMEDIATE";

  var mediaId = String(item.mediaId || item.media_id || item.id || "");
  var title   = String(item.title   || "");

  var isMatch =
    target === "IMMEDIATE" ||
    (mediaId && target.toLowerCase() === mediaId.toLowerCase()) ||
    (title   && target.toLowerCase() === title.toLowerCase());

  if (!isMatch) {
    console.log("📸 PoP: waiting for target=\"" + target +
                "\", now playing mediaId=\"" + mediaId + "\" — not yet");
    return;
  }

  console.log("📸 PoP: match! target=\"" + target + "\" — scheduling capture");
  _executePop(req, item);
}

/* ---------------------------------------------------------
   INTERNAL: _executePop
   ─────────────────────────────────────────────────────────
   Waits a randomised delay then runs the full
   capture → upload → report → mark-done pipeline.
   --------------------------------------------------------- */

function _executePop(req, item) {
  if (_popCaptureInFlight) return;
  _popCaptureInFlight = true;

  // Randomised delay 1 000–15 000 ms (mirrors Android Random.nextLong)
  var delayMs = Math.floor(Math.random() * 14000) + 1000;
  console.log("📸 PoP: waiting " + Math.round(delayMs / 1000) +
              "s before capture (request " + req.requestId + ")");

  setTimeout(function () {
    _captureFrame(function (blob) {
      if (!blob) {
        console.warn("📸 PoP: capture returned null — aborting");
        _clearPendingRequest();
        return;
      }

      var pairedDevice = getPairedDevice();
      if (!pairedDevice) {
        console.warn("📸 PoP: no paired device — aborting");
        _clearPendingRequest();
        return;
      }

      var jwt        = pairedDevice.jwt        || "";
      var screenId   = pairedDevice.screenId   || "";
      var mediaId    = String(item.mediaId || item.media_id || item.id || "");
      var campaignId = String(req.campaignId   || "");
      var requestId  = req.requestId;

      // a) Upload screenshot file (multipart)
      _uploadScreenshot(blob, screenId, mediaId, requestId, campaignId, jwt)
        .then(function (ok) {
          console.log("📸 PoP: upload " + (ok ? "OK" : "FAILED") +
                      " (request " + requestId + ")");

          // b) Report metadata (JSON)
          return _reportProofOfPlay(screenId, jwt, mediaId,
                                    campaignId, pairedDevice.userId || "");
        })
        .then(function () {
          console.log("📸 PoP: metadata reported");

          // c) Mark request complete
          return _markScreenshotComplete(requestId, jwt);
        })
        .then(function () {
          console.log("📸 PoP: request " + requestId + " marked complete");
        })
        .catch(function (err) {
          console.warn("📸 PoP: pipeline error:", err);
        })
        .finally(function () {
          _clearPendingRequest();
        });
    });
  }, delayMs);
}

/* ---------------------------------------------------------
   CANVAS FRAME CAPTURE
   ─────────────────────────────────────────────────────────
   Equivalent to Android PixelCopy / Canvas.draw fallback.
   Returns a JPEG Blob via callback, or null on failure.
   --------------------------------------------------------- */

function _captureFrame(cb) {
  try {
    var canvas = document.createElement("canvas");
    canvas.width  = 1280;
    canvas.height = 720;
    var ctx = canvas.getContext("2d");

    var video    = document.getElementById("videoPlayer");
    var image    = document.getElementById("imagePlayer");
    var drawn    = false;

    // Video — equivalent to PixelCopy on hardware-accelerated surface
    if (video && !video.paused && video.readyState >= 2 &&
        video.style.display !== "none") {
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawn = true;
        console.log("📸 PoP: captured from <video>");
      } catch (e) {
        console.warn("📸 PoP: video drawImage failed:", e);
      }
    }

    // Image
    if (!drawn && image && image.complete && image.naturalWidth > 0 &&
        image.style.display !== "none") {
      try {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        drawn = true;
        console.log("📸 PoP: captured from <img>");
      } catch (e) {
        console.warn("📸 PoP: img drawImage failed:", e);
      }
    }

    // Iframe / web URL — cross-origin taints canvas; use branded fallback
    if (!drawn) {
      _drawBrandedFallback(ctx, canvas.width, canvas.height);
      console.log("📸 PoP: using branded fallback");
    }

    canvas.toBlob(function (blob) {
      cb(blob || null);
    }, "image/jpeg", 0.80);

  } catch (e) {
    console.warn("📸 PoP: _captureFrame exception:", e);
    cb(null);
  }
}

function _drawBrandedFallback(ctx, W, H) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#0047FF";
  ctx.font      = "bold 80px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VYPΛ", W / 2, H / 2 - 20);
  ctx.fillStyle = "#ffffff";
  ctx.font      = "28px Arial";
  ctx.fillText("Proof of Play", W / 2, H / 2 + 60);
}

/* ---------------------------------------------------------
   API CALLS  (mirrors ApiService.kt)
   --------------------------------------------------------- */

/**
 * Multipart upload of the JPEG blob.
 * Mirrors ApiService.uploadScreenshot()
 */
async function _uploadScreenshot(blob, screenId, mediaId,
                                  requestId, campaignId, jwt) {
  try {
    var formData = new FormData();
    formData.append("screenshot", blob, "pop_" + Date.now() + ".jpg");
    formData.append("screen_id",   String(screenId   || ""));
    formData.append("media_id",    String(mediaId    || ""));
    formData.append("request_id",  String(requestId  || ""));
    formData.append("campaign_id", String(campaignId || ""));

    var headers = { "Accept": "application/json" };
    if (jwt) headers["Authorization"] = "Bearer " + jwt;

    var response = await fetch(POP_UPLOAD_URL, {
      method:  "POST",
      headers: headers,
      body:    formData
    });

    console.log("📤 PoP upload HTTP:", response.status);
    return response.ok;

  } catch (e) {
    console.warn("📸 PoP: _uploadScreenshot exception:", e);
    return false;
  }
}

/**
 * JSON metadata report.
 * Mirrors ApiService.reportProofOfPlay()
 */
async function _reportProofOfPlay(screenId, jwt, mediaId,
                                   campaignId, userId) {
  var now = new Date();
  var pad = function (n) { return n < 10 ? "0" + n : n; };
  var capturedAt =
    now.getFullYear() + "-" +
    pad(now.getMonth() + 1) + "-" +
    pad(now.getDate())      + " " +
    pad(now.getHours())     + ":" +
    pad(now.getMinutes())   + ":" +
    pad(now.getSeconds());

  var body = {
    screen_id:   screenId,
    media_id:    mediaId    || "",
    campaign_id: campaignId || 0,
    user_id:     userId     || "",
    captured_at: capturedAt
  };

  var response = await fetch(POP_REPORT_URL, {
    method:  "POST",
    headers: {
      "Authorization": "Bearer " + jwt,
      "Content-Type":  "application/json",
      "Accept":        "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error("reportProofOfPlay HTTP " + response.status);
  }
  return await response.json();
}

/**
 * Mark the screenshot request as complete on the backend.
 * Mirrors ApiService.markScreenshotComplete()
 */
async function _markScreenshotComplete(requestId, jwt) {
  var headers = {
    "Accept":       "application/json",
    "Content-Type": "application/x-www-form-urlencoded"
  };
  if (jwt) headers["Authorization"] = "Bearer " + jwt;

  var response = await fetch(POP_MARK_DONE_URL, {
    method:  "POST",
    headers: headers,
    body:    "request_id=" + encodeURIComponent(requestId)
  });

  if (!response.ok) {
    throw new Error("markScreenshotComplete HTTP " + response.status);
  }
  return await response.json();
}

/* ---------------------------------------------------------
   STATE HELPERS
   --------------------------------------------------------- */

function _clearPendingRequest() {
  _pendingPopRequest  = null;
  _popCaptureInFlight = false;
}

/* ---------------------------------------------------------
   PUSHER LISTENER BINDING
   ─────────────────────────────────────────────────────────
   Call after connectToUserChannel() succeeds.
   Mirrors Android's connectToScreenChannel onCaptureScreenshot.

   Expected Pusher event payload:
     {
       request_id:         <int>,
       target_identifier:  <string | null>,
       campaign_id:        <string | int>
     }
   --------------------------------------------------------- */

function bindProofOfPlayListener(channel) {
  var ch = channel ||
    (typeof userChannel !== "undefined" ? userChannel : null);

  if (!ch) {
    console.warn("📸 PoP: no Pusher channel — listener not bound");
    return;
  }

  try { ch.unbind("capture_screenshot"); } catch (e) {}

  ch.bind("capture_screenshot", function (data) {
    console.log("📸 PoP Pusher event:", data);

    var requestId        = data.request_id        || data.id       || null;
    var targetIdentifier = data.target_identifier || data.media_id || "IMMEDIATE";
    var campaignId       = data.campaign_id       || "";

    if (!requestId) {
      console.warn("📸 PoP: event missing request_id — ignoring");
      return;
    }

    // Store pending request (mirrors _pusherScreenshotRequest StateFlow)
    _pendingPopRequest = {
      requestId:        requestId,
      targetIdentifier: String(targetIdentifier),
      campaignId:       String(campaignId)
    };
    _popCaptureInFlight = false;

    console.log("📸 PoP: pending request set →", JSON.stringify(_pendingPopRequest));

    // If IMMEDIATE, fire right now against whatever is playing
    if (String(targetIdentifier) === "IMMEDIATE" || !targetIdentifier) {
      var nowPlaying = (typeof playlistItems !== "undefined" &&
                        typeof currentIndex  !== "undefined")
                       ? playlistItems[currentIndex]
                       : null;
      if (nowPlaying) notifyMediaChanged(nowPlaying);
    }
  });

  console.log("📸 PoP listener bound on:", ch.name);
}

/* ---------------------------------------------------------
   POLLING FALLBACK
   ─────────────────────────────────────────────────────────
   Polls every 30 s when Pusher is not connected.
   Mirrors Android's startPollingFallback() / pollingJob.

   @param {function} [isPusherConnectedFn]
     Optional function returning true when Pusher is live.
     When true the poll is skipped (Pusher handles it).
   --------------------------------------------------------- */

function startPopPolling(isPusherConnectedFn) {
  stopPopPolling();

  _popPollInterval = setInterval(async function () {

    // Skip when Pusher is up
    if (typeof isPusherConnectedFn === "function" &&
        isPusherConnectedFn()) {
      return;
    }

    var pairedDevice = getPairedDevice();
    if (!pairedDevice) return;

    try {
      var url = POP_POLL_URL +
                "?screen_id=" + encodeURIComponent(pairedDevice.screenId);

      var response = await fetch(url, {
        method:  "GET",
        headers: { "Accept": "application/json" }
      });

      // Guard against auth redirects (mirrors Android 302 check)
      if (response.status === 301 || response.status === 302) {
        console.warn("📸 PoP poll: auth redirect — skipping");
        return;
      }
      if (!response.ok) return;

      var contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        console.warn("📸 PoP poll: non-JSON response — skipping");
        return;
      }

      var data = await response.json();
      if (!data.has_request) return;

      var req        = data.request || {};
      var requestId  = req.id || req.request_id || -1;
      var mediaId    = req.media_id    || "IMMEDIATE";
      var campaignId = req.campaign_id || "";

      if (requestId === -1) return;

      console.log("📋 PoP poll: pending request ID=" + requestId +
                  ", Campaign=" + campaignId);

      // Only store if nothing already in-flight
      if (!_pendingPopRequest && !_popCaptureInFlight) {
        _pendingPopRequest = {
          requestId:        requestId,
          targetIdentifier: String(mediaId),
          campaignId:       String(campaignId)
        };

        var nowPlaying = (typeof playlistItems !== "undefined" &&
                          typeof currentIndex  !== "undefined")
                         ? playlistItems[currentIndex]
                         : null;
        if (nowPlaying) notifyMediaChanged(nowPlaying);
      }

    } catch (e) {
      console.warn("📸 PoP poll error:", e);
    }

  }, 30000);

  console.log("📸 PoP polling fallback started (30 s)");
}

function stopPopPolling() {
  if (_popPollInterval) {
    clearInterval(_popPollInterval);
    _popPollInterval = null;
  }
}