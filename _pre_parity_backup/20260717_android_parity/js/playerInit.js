/* =========================================================
   VYPA — PLAYER BOOTSTRAP  (shared: Tizen / webOS / VIDAA)
   =========================================================
   The single authoritative initializePlayer() / fetchPlayerData()
   for the player. Wires every feature the Android players have:
     • offline-first cached playlist
     • private user channel (playlist_updated, new-content, PoP arm)
     • public screen channel (screen-deleted, push-button update,
       capture-screenshot)
     • 20 s heartbeat with identity verification
     • 15 s hardware telemetry heartbeat
     • 30 s proof-of-play polling fallback
     • one-shot IP geolocation
     • 60 s screen-existence watchdog
   ========================================================= */

/* =========================================
   BUFFER OVERLAY HELPERS
========================================= */

function showBuffer(message) {
  var overlay = document.getElementById("bufferOverlay");
  var text    = document.getElementById("bufferText");
  if (!overlay || !text) return;
  text.textContent      = message || "Downloading playlist…";
  overlay.style.display = "flex";
}

function updateBuffer(message) {
  var text = document.getElementById("bufferText");
  if (!text) return;
  text.textContent = message || "Downloading playlist…";
}

function hideBuffer() {
  var overlay = document.getElementById("bufferOverlay");
  if (!overlay) return;
  overlay.style.display = "none";
}

/* =========================================
   INITIALIZE PLAYER
========================================= */

let screenCheckInterval = null;
let hourlyResyncInterval = null;
let locationInterval = null;
let _networkListenersBound = false;
let _prevItemIds = [];   // snapshot for jump-to-newest

function initializePlayer() {
  var pairedDevice = getPairedDevice();

  // Guard: no paired device → go to pairing flow immediately
  if (!pairedDevice) {
    startPairingFlow();
    return;  // ← nothing below this runs when unpaired
  }

  console.log("✅ initializePlayer() called");

  // 1️⃣ Load cached playlist first (offline-first)
  var cached = getCachedPlaylist();
  if (cached && cached.length > 0) {
    console.log("📦 Cached playlist found:", cached.length);
    window.currentPlaylist = cached;
    hideBuffer();
    setState("player");
    startPlayback(cached);
  } else {
    setState("loading");
    showBuffer("Downloading playlist…");
  }

  // 2️⃣ Power management — keep the panel on (the platform adapter handles the
  //    screensaver / keep-awake mechanism internally).
  preventSleep();

  // 3️⃣ Connect to PRIVATE user channel (JWT auth)
  //    Handles: playlist_updated, new-content, and wires up PoP listener.
  connectToUserChannel(
    pairedDevice.userId,
    pairedDevice.jwt,
    function () {
      console.log("📡 User channel → playlist update — fetching fresh data");
      reloadPlaylist(true);
    }
  );

  // 4️⃣ Connect to PUBLIC screen channel
  //    Handles: screen-deleted, playlist push-button update,
  //             and capture-screenshot PoP events from the dashboard.
  connectToScreenChannel(
    pairedDevice.screenId,

    // onDeleted
    function () {
      console.warn("❌ Screen removed — resetting player");
      clearPairedDevice();
      stopHeartbeat();
      if (typeof stopTelemetryHeartbeat === "function") stopTelemetryHeartbeat();
      if (typeof stopPopPolling === "function") stopPopPolling();
      disconnectPusher();
      if (screenCheckInterval) clearInterval(screenCheckInterval);
      startPairingFlow();
    },

    // onPlaylistUpdated — fired when dashboard push-button is pressed
    function () {
      console.log("📡 Screen channel → playlist update — fetching fresh data");
      reloadPlaylist(true);
    },

    // onCaptureScreenshot — PoP request from screen channel
    function (requestId, targetMedia, campaignId) {
      console.log("📸 Screen channel PoP request: ID=" + requestId +
                  ", Target=" + targetMedia + ", Campaign=" + campaignId);
      if (typeof notifyMediaChanged === "function") {
        _pendingPopRequest = {
          requestId:        requestId,
          targetIdentifier: targetMedia || "IMMEDIATE",
          campaignId:       String(campaignId || "")
        };
        _popCaptureInFlight = false;

        var nowPlaying = (typeof playlistItems !== "undefined" &&
                          typeof currentIndex  !== "undefined")
                         ? playlistItems[currentIndex]
                         : null;
        if (nowPlaying) notifyMediaChanged(nowPlaying);
      }
    }
  );

  // 5️⃣ Fetch fresh playlist from server
  fetchPlayerData();

  // 6️⃣ Start plain heartbeat (20 s — includes identity verification)
  startHeartbeat(pairedDevice.screenId, pairedDevice.jwt);

  // 7️⃣ Start 15-second telemetry heartbeat (Wi-Fi RSSI, storage)
  if (typeof startTelemetryHeartbeat === "function") {
    startTelemetryHeartbeat(pairedDevice.screenId, pairedDevice.jwt);
  }

  // 8️⃣ Start PoP polling fallback (30 s — skipped when Pusher is live)
  if (typeof startPopPolling === "function") {
    startPopPolling(isPusherConnected);
  }

  // 9️⃣ Resolve IP-based geolocation — on boot AND every 30 min, so a screen
  //    that physically moves (new IP) re-reports its location. TVs have no GPS,
  //    so the server-side IP resolve is the right mechanism (Android TVs do the
  //    same; api_update_location with lat/long is the mobile/GPS path).
  reportLocation(pairedDevice.jwt);
  if (locationInterval) clearInterval(locationInterval);
  locationInterval = setInterval(function () {
    reportLocation(pairedDevice.jwt);
  }, 30 * 60 * 1000);

  // 🔁 Hourly safety re-sync — full playlist pull, a backstop for any missed
  //    real-time event (mirrors Android startHourlySyncTask).
  if (hourlyResyncInterval) clearInterval(hourlyResyncInterval);
  hourlyResyncInterval = setInterval(function () {
    console.log("🔁 Hourly safety re-sync");
    reloadPlaylist(false);
  }, 60 * 60 * 1000);

  // 🌐 Network-restoration auto-resync — when the connection drops then returns,
  //    force a reload to catch anything missed during the outage (mirrors
  //    Android setupNetworkRestorationListener).
  bindNetworkRestoration();

  // 🔟 Periodic screen existence check (every 60 s)
  if (screenCheckInterval) clearInterval(screenCheckInterval);

  screenCheckInterval = setInterval(function () {
    checkScreenExists(pairedDevice.screenId, pairedDevice.jwt)
      .then(function (res) {
        if (!res.exists) {
          console.warn("❌ Screen no longer exists on server — resetting");
          clearPairedDevice();
          stopHeartbeat();
          if (typeof stopTelemetryHeartbeat === "function") stopTelemetryHeartbeat();
          if (typeof stopPopPolling === "function") stopPopPolling();
          disconnectPusher();
          clearInterval(screenCheckInterval);
          startPairingFlow();
        }
      })
      .catch(function (err) { console.warn("Screen check failed:", err); });
  }, 60000);
}

/* =========================================
   HELPERS: location, network, reload-tracking
========================================= */

function reportLocation(jwt) {
  if (typeof resolveIpLocation !== "function") return;
  resolveIpLocation(jwt)
    .then(function (res) { console.log("📍 IP location resolved:", res); })
    .catch(function (err) { console.warn("IP location resolve failed:", err); });
}

function bindNetworkRestoration() {
  if (_networkListenersBound) return;
  _networkListenersBound = true;

  window.addEventListener("offline", function () {
    console.warn("🌐 Network lost — playing from cache");
  });

  window.addEventListener("online", function () {
    console.log("🌐 Network restored — re-syncing in 2s");
    setTimeout(function () { reloadPlaylist(false); }, 2000);
  });
}

function _itemIds(items) {
  return (items || []).map(function (it) {
    return String(it.id || it.media_id || it.url || "");
  });
}

/* Reload the playlist. When trackNew is true, snapshot the current item ids so
   fetchPlayerData can stash the first newly-added item for jump-to-newest. */
function reloadPlaylist(trackNew) {
  _prevItemIds = trackNew ? _itemIds(window.currentPlaylist || getCachedPlaylist()) : [];
  fetchPlayerData(trackNew);
}

/* =========================================
   FETCH PLAYER DATA
========================================= */

function fetchPlayerData(trackNew) {
  var pairedDevice = getPairedDevice();
  if (!pairedDevice) return;

  showBuffer("Fetching playlist…");
  console.log("Calling player endpoint…");

  getPlayer(pairedDevice.screenId)
    .then(function (data) {
      console.log("Player response:", data);

      var items =
        (data && data.playlist && Array.isArray(data.playlist.items) && data.playlist.items) ||
        (data && Array.isArray(data.items) && data.items) ||
        (data && Array.isArray(data.playlist_items) && data.playlist_items) ||
        (data && data.playlist && Array.isArray(data.playlist) && data.playlist) ||
        [];

      console.log("🔎 Items sample:", items && items[0]);

      if (!items || items.length === 0) {
        console.log("⚠️ No playlist assigned");
        stopSchedulingTicker();
        setState("no-playlist");
        showBuffer("No playlist assigned");
        return;
      }

      // Jump-to-newest: first item whose id wasn't in the previous snapshot.
      if (trackNew && _prevItemIds.length) {
        var prev = _prevItemIds;
        for (var i = 0; i < items.length; i++) {
          var id = String(items[i].id || items[i].media_id || items[i].url || "");
          if (id && prev.indexOf(id) === -1) {
            window._pendingJumpId = String(items[i].id || items[i].media_id || "");
            console.log("✨ New content detected — will jump to:", window._pendingJumpId);
            break;
          }
        }
      }
      _prevItemIds = [];

      console.log("✅ Playlist found:", items.length, "items");
      updateBuffer("Downloading playlist…");
      setState("loading");

      cachePlaylistMedia(items, function (cachedItems) {
        console.log("✅ Cache complete:", cachedItems.length, "items");
        saveCachedPlaylist(cachedItems);
        window.currentPlaylist = cachedItems;
        hideBuffer();
        setState("player");
        startPlayback(cachedItems);

        // (Re)start the date-range scheduling ticker against the full list.
        if (typeof startSchedulingTicker === "function") {
          startSchedulingTicker(
            function () { return window._fullPlaylist || window.currentPlaylist || []; },
            function () { if (typeof rebuildActivePlaylist === "function") rebuildActivePlaylist(); }
          );
        }
      });
    })
    .catch(function (err) {
      console.log("Player fetch failed:", err);
      // Don't blank a working screen on a transient fetch error — only show the
      // error state if we have nothing cached to keep playing.
      var cached = getCachedPlaylist();
      if (!cached || !cached.length) {
        setState("error");
        showBuffer("Error downloading playlist");
      } else {
        console.warn("Keeping cached playback after fetch error");
      }
    });
}
