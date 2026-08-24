/* =========================================
   VYPA API SERVICE (PRODUCTION)
   =========================================
   SHARED across all web players (Tizen / webOS / VIDAA) — byte
   identical. The API surface, Pusher channels, heartbeat and
   identity verification are platform-neutral (the backend is
   shared). The player bootstrap (initializePlayer / fetchPlayerData
   / buffer helpers) lives in playerInit.js as the single
   authoritative copy.

     • Pusher reconnection guard: 20 s (matches Android)
     • userChannel exposed globally so proofOfPlay.js can bind to it
     • connectToUserChannel wires bindProofOfPlayListener() on
       subscription_succeeded so PoP is always armed
     • connectToScreenChannel handles push-button playlist updates
       and capture_screenshot events from the public screen channel
========================================= */

const PAIRING_BASE = "https://app.vypa.co";
const SIGNAGE_BASE = "https://app.vypa.co";
const HOST_BASE    = "https://host.vypa.co";
const API_PREFIX   = "/screens";

const APP_KEY = "577574aa6d10359e9341";
const CLUSTER  = "mt1";

// Active Pusher credentials. Default to the hardcoded app, but the backend may
// return a per-screen `pusher: { key, cluster }` in the getPlayer response
// (mirrors Android PusherManager) — configurePusher() applies it so a key
// rotation on the server doesn't require a client rebuild.
let _pusherKey     = APP_KEY;
let _pusherCluster = CLUSTER;

function configurePusher(key, cluster) {
  var changed = false;
  if (key && String(key) !== _pusherKey)         { _pusherKey = String(key); changed = true; }
  if (cluster && String(cluster) !== _pusherCluster) { _pusherCluster = String(cluster); changed = true; }
  if (changed) {
    console.log("🔧 Pusher credentials updated → key:", _pusherKey, "cluster:", _pusherCluster);
  }
  return changed;
}

let activeBaseUrl = SIGNAGE_BASE;

/* =========================================
   PLATFORM PERSISTENCE

   activeBaseUrl used to live only in memory. useCategory() set it correctly
   after pairing, so a freshly paired screen worked -- but the value did not
   survive a reload. On every restart (a power cut, a TV firmware update, the
   app being relaunched by the watchdog) it reset to the signage platform.

   A HOST screen then asked app.vypa.co for a playlist that only exists on
   host.vypa.co, got nothing back, and the player showed its empty-playlist
   screen -- which reads as "no campaigns" when the real cause was asking the
   wrong server. Two FireOS host screens never played a single frame between
   May and August 2026 for exactly this reason.

   The choice is now written down when it is learned and read back at load,
   before anything requests a playlist. Storage is wrapped because some TV
   browsers throw on localStorage in private/kiosk contexts -- a failure to
   remember must never stop the player from running.
========================================= */

const PLATFORM_KEY = "vypa_selected_platform";

function savePlatform(category) {
  try { localStorage.setItem(PLATFORM_KEY, String(category || "")); }
  catch (e) { console.warn("Platform not persisted:", e); }
}

function loadPlatform() {
  try { return localStorage.getItem(PLATFORM_KEY); }
  catch (e) { return null; }
}

(function restorePlatformOnLoad() {
  const saved = loadPlatform();
  if (saved) {
    activeBaseUrl = saved.toLowerCase() === "host" ? HOST_BASE : SIGNAGE_BASE;
    console.log("♻️ Restored platform:", saved, "->", activeBaseUrl);
  }
})();


function joinUrl(base, path) {
  const b = (base || "").replace(/\/+$/, "");
  const p = (path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

/* =========================================
   BASE URL CONTROL
========================================= */

function useCategory(category) {
  activeBaseUrl =
    category?.toLowerCase() === "host"
      ? HOST_BASE
      : SIGNAGE_BASE;


  // Write it down, or the switch is lost on the next reload and a host
  // screen silently reverts to asking the signage platform.
  savePlatform(category);
  console.log("🔀 Active Base URL:", activeBaseUrl);
}

/* =========================================
   SAFE FETCH (Retry Logic for TV Stability)
========================================= */

async function safeFetch(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn(`⚠️ Fetch failed (attempt ${attempt})`, err);
      if (attempt === retries) throw err;
      await new Promise(res => setTimeout(res, 2000));
    }
  }
}

/* =========================================
   PAIRING APIs
========================================= */

async function createPair(playerId) {
  const url = joinUrl(PAIRING_BASE, `${API_PREFIX}/api_create_pair`);
  return await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_id: playerId })
  });
}

async function checkPairingStatus(code) {
  const url = joinUrl(SIGNAGE_BASE, `${API_PREFIX}/api_check_pairing_status?code=${code}`);
  return await safeFetch(url);
}

/* =========================================
   PLAYER APIs
========================================= */

async function getPlayer(screenId) {
  const url = joinUrl(activeBaseUrl, `${API_PREFIX}/player/${screenId}?format=json`);
  return await safeFetch(url);
}

async function sendHeartbeat(screenId, jwt) {
  const url = joinUrl(activeBaseUrl, `${API_PREFIX}/heartbeat/${screenId}`);
  const response = await fetch(url, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "Content-Type":  "application/json"
    }
  });
  if (!response.ok) throw new Error(`Heartbeat failed HTTP ${response.status}`);
  return await response.json();
}

/* =========================================
   PUSHER MANAGEMENT
   ─────────────────────────────────────────
   Reconnection guard: 20 seconds on both
   public and private connections.
========================================= */

let publicPusher  = null;
let privatePusher = null;

let pairingChannel     = null;
let pairingChannelName = null;
let screenChannel      = null;
let userChannel        = null;  // global — proofOfPlay.js reads this

/* ---- Public Pusher (pairing + screen channel) ---- */

function initPublicPusher() {
  if (!publicPusher) {
    publicPusher = new Pusher(_pusherKey, { cluster: _pusherCluster });

    publicPusher.connection.bind("state_change", function (states) {
      console.log("📡 Public Pusher:", states.previous, "→", states.current);

      if (states.current === "disconnected" || states.current === "failed") {
        setTimeout(function () {
          if (publicPusher) {
            console.log("🔁 Reconnecting public Pusher (20 s guard)…");
            publicPusher.connect();
          }
        }, 20000);
      }
    });
  }
}

/* ---- Pairing channel ---- */

function onScreenPaired(data, onPaired) {
  console.log("🎯 Screen paired:", data);
  onPaired(data);
}

function connectToPairingChannel(code, onPaired) {
  initPublicPusher();

  if (pairingChannel && pairingChannelName) {
    try { pairingChannel.unbind("screen-paired"); } catch (e) {}
    try { publicPusher.unsubscribe(pairingChannelName); } catch (e) {}
  }

  pairingChannelName = `pairing-${code}`;
  pairingChannel     = publicPusher.subscribe(pairingChannelName);

  pairingChannel.bind("screen-paired", function (data) {
    console.log("🎯 Screen paired:", data);
    onScreenPaired(data, onPaired);
  });
}

function cleanupPairingChannel() {
	try {
		if (pairingChannel && publicPusher) {
		 pairingChannel.unbind_all();
		 publicPusher.unsubscribe(pairingChannelName);
			}
		} catch (e) {
		console.warn("Pairing channel cleanup warning:", e);
			}
	pairingChannel     = null;
	pairingChannelName = null;
	//✅ publicPusher stays alive — screen channel needs it
}


/* ---- Screen channel (public) ----
   Handles: screen-deleted, playlist-updated / playlist_updated,
            capture-screenshot (PoP trigger from dashboard push button).
   Mirrors Android's connectToScreenChannel() in PusherManager.kt.
*/

function connectToScreenChannel(screenId, onDeleted, onPlaylistUpdated, onCaptureScreenshot) {
	  initPublicPusher();

	  if (screenChannel) {
	    try { publicPusher.unsubscribe(screenChannel.name); } catch (e) {}
	    screenChannel = null;
	  }

	  const channelName = "screen-" + screenId;

	  function doSubscribe() {
	    console.log("📺 Subscribing to screen channel:", channelName);
	    screenChannel = publicPusher.subscribe(channelName);

	    screenChannel.bind("pusher:subscription_succeeded", function () {
	      console.log("✅ Subscribed to screen channel:", channelName);
	    });

	    screenChannel.bind("pusher:subscription_error", function (err) {
	      console.error("❌ Screen channel subscription error:", err);
	    });

	    screenChannel.bind("screen-deleted", function (data) {
	      console.log("🗑 Screen deleted:", data);
	      if (onDeleted) onDeleted(data);
	    });

	    const playlistListener = function (data) {
	      console.log("🔔 Playlist update received via screen channel");
	      if (onPlaylistUpdated) onPlaylistUpdated(data);
	    };
	    screenChannel.bind("playlist-updated", playlistListener);
	    screenChannel.bind("playlist_updated", playlistListener);

	    screenChannel.bind("capture-screenshot", function (data) {
	      console.log("📸 Capture screenshot event:", data);
	      if (onCaptureScreenshot) {
	        const requestId   = data.id             || null;
	        const campaignId  = data.campaign_id    || "";
	        const targetMedia = data.media_id       ||
	                            data.media_filename ||
	                            null;
	        onCaptureScreenshot(requestId, targetMedia, campaignId);
	      }
	    });

	    // ---- reboot (app.vypa.co Screens::reboot → "reboot") ----
	    // Remote restart command. Mirrors Android onReboot → restartApp().
	    // A full document reload re-runs the whole boot sequence.
	    screenChannel.bind("reboot", function (data) {
	      console.warn("♻️ Reboot command received — restarting player", data);
	      try { if (typeof stopHeartbeat === "function") stopHeartbeat(); } catch (e) {}
	      setTimeout(function () {
	        try { window.location.reload(); } catch (e) {}
	      }, 1500);
	    });

	    // ---- take-screenshot (app.vypa.co dashboard button → "take-screenshot") ----
	    // Distinct from advertise.vypa.co's "capture-screenshot" PoP flow. This is
	    // the manual dashboard button; treat it as an IMMEDIATE capture against
	    // whatever is on screen, reusing the same PoP pipeline.
	    screenChannel.bind("take-screenshot", function (data) {
	      console.log("📸 take-screenshot (dashboard) received:", data);
	      if (onCaptureScreenshot) {
	        var requestId = (data && (data.id || data.request_id)) || 0;
	        onCaptureScreenshot(requestId, "IMMEDIATE", "");
	      }
	    });

	    // ---- collect-logs / stop-logs (TEP SystemDebug) ----
	    // Remote ep_control log capture for field support. The device uploads
	    // straight to server_url — nothing comes back through JS, so the payload
	    // MUST carry where to send them; we never guess a destination.
	    // No-ops on non-TEP panels (TEP.systemdebug.start reports unsupported).
	    //
	    // BACKEND: app.vypa.co does not emit these events yet — the binding is
	    // inert until it does. See README → "Remote log capture".
	    screenChannel.bind("collect-logs", function (data) {
	      console.log("🩺 collect-logs received:", data);
	      if (typeof TEP === "undefined") return;

	      var serverUrl = data && (data.server_url || data.serverUrl);
	      if (!serverUrl) {
	        console.warn("🩺 collect-logs ignored — no server_url in payload");
	        return;
	      }

	      TEP.systemdebug.start({
	        serverUrl:      serverUrl,
	        scriptUrl:      (data && (data.script_url || data.scriptUrl)) || serverUrl,
	        downloadScript: !(data && data.download_script === false),
	        logDuration:    (data && (data.log_duration || data.logDuration)) || 1
	      }, function (err) {
	        if (err) console.warn("🩺 log capture failed to start:", err.message);
	      });
	    });

	    screenChannel.bind("stop-logs", function (data) {
	      console.log("🩺 stop-logs received:", data);
	      if (typeof TEP === "undefined") return;
	      TEP.systemdebug.stop(function (err) {
	        if (err) console.warn("🩺 log capture failed to stop:", err.message);
	      });
	    });
	  }

	  // ✅ Wait for publicPusher to be connected before subscribing
	  if (publicPusher.connection.state === "connected") {
	    doSubscribe();
	  } else {
	    console.log("⏳ Waiting for public Pusher to connect…");
	    publicPusher.connection.bind("connected", function onConnected() {
	      publicPusher.connection.unbind("connected", onConnected);
	      doSubscribe();
	    });
	  }
	}

/* ---- Private user channel (JWT auth) ---- */

function connectToUserChannel(userId, jwt, onPlaylistUpdated) {
  console.log("Connecting to private-user-" + userId);

  if (!privatePusher) {
    privatePusher = new Pusher(_pusherKey, {
      cluster:       _pusherCluster,
      forceTLS:      true,
      authEndpoint:  "https://app.vypa.co/PusherAuth/auth",
      authTransport: "ajax",
      auth: {
        headers: {
          "Authorization": "Bearer " + jwt,
          "Content-Type":  "application/x-www-form-urlencoded"
        }
      }
    });

    privatePusher.connection.bind("state_change", function (states) {
      console.log("🔐 Private Pusher:", states.previous, "→", states.current);

      if (states.current === "disconnected" || states.current === "failed") {
        setTimeout(function () {
          if (privatePusher) {
            console.log("🔁 Reconnecting private Pusher (20 s guard)…");
            privatePusher.connect();
          }
        }, 20000);
      }
    });
  }

  if (userChannel) {
    try { privatePusher.unsubscribe(userChannel.name); } catch (e) {}
    userChannel = null;
  }

  userChannel = privatePusher.subscribe("private-user-" + userId);

  userChannel.bind("pusher:subscription_succeeded", function () {
    console.log("✅ Subscribed to private-user-" + userId);

    // Wire up PoP listener the moment the channel is confirmed live
    if (typeof bindProofOfPlayListener === "function") {
      bindProofOfPlayListener(userChannel);
    }

    fetchPlayerData();
  });

  userChannel.bind("pusher:subscription_error", function (err) {
    console.error("❌ Subscription error:", err);
  });

  userChannel.bind("playlist_updated", function (data) {
    console.log("🎧 Playlist updated (private channel)");
    if (onPlaylistUpdated) onPlaylistUpdated(data);
  });

  userChannel.bind("new-content", function (data) {
    console.log("🆕 New content (private channel)");
    if (onPlaylistUpdated) onPlaylistUpdated(data);
  });
}

/* =========================================
   DISCONNECT ALL PUSHER CHANNELS
========================================= */

function disconnectPusher() {
  try {
    if (pairingChannel && publicPusher) publicPusher.unsubscribe(pairingChannel.name);
    if (screenChannel  && publicPusher) publicPusher.unsubscribe(screenChannel.name);
    if (userChannel    && privatePusher) privatePusher.unsubscribe(userChannel.name);

    if (privatePusher) privatePusher.disconnect();
    if (publicPusher)  publicPusher.disconnect();

    pairingChannel     = null;
    pairingChannelName = null;
    screenChannel      = null;
    userChannel        = null;
    privatePusher      = null;
    publicPusher       = null;

    console.log("🛑 All Pusher connections closed");
  } catch (err) {
    console.error("Error disconnecting Pusher:", err);
  }
}

/* =========================================
   PUSHER CONNECTIVITY CHECK
   Used by startPopPolling() to decide whether
   to skip polling when Pusher is live.
========================================= */

function isPusherConnected() {
  try {
    return (
      privatePusher !== null &&
      privatePusher.connection.state === "connected" &&
      userChannel !== null
    );
  } catch (e) {
    return false;
  }
}

/* =========================================
   HEARTBEAT LOOP CONTROLLER
========================================= */

let heartbeatInterval = null;

function startHeartbeat(screenId, jwt) {
  stopHeartbeat();

  console.log("💓 Starting heartbeat…", { screenId });

  (async function () {
    try {
      await sendHeartbeat(screenId, jwt);
      console.log("💓 Heartbeat immediate success");
      await verifyPlayerIdentity(screenId, jwt);
    } catch (err) {
      console.warn("💔 Heartbeat immediate failed:", err);
    }
  })();

  heartbeatInterval = setInterval(async function () {
    try {
      await sendHeartbeat(screenId, jwt);
      console.log("💓 Heartbeat success");
      await verifyPlayerIdentity(screenId, jwt);
    } catch (err) {
      console.warn("💔 Heartbeat failed:", err);
    }
  }, 20000);
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

async function verifyPlayerIdentity(screenId, jwt) {
  try {
    const response       = await checkScreenExists(screenId, jwt);
    const exists         = response?.exists ?? true;
    const serverPlayerId = response?.player_id ?? null;
    const localPlayerId  = getOrCreatePlayerId();

    console.log("🧠 Server Player:", serverPlayerId);
    console.log("🧠 Local Player:",  localPlayerId);

    if (!exists) {
      console.warn("🚫 Screen removed from server — resetting");
      clearPairedDevice();
      clearPlayerId();
      restartPairing();
      return false;
    }

    if (serverPlayerId && serverPlayerId !== localPlayerId) {
      console.warn("🚫 Player mismatch — forcing re-pair");
      clearPairedDevice();
      clearPlayerId();
      restartPairing();
      return false;
    }

    console.log("✅ Player verified");
    return true;

  } catch (err) {
    console.warn("⚠️ Player verification failed:", err);
    return true; // non-fatal — keep running
  }
}

async function checkScreenExists(screenId, jwt) {
  const url = joinUrl(activeBaseUrl, `${API_PREFIX}/api_check_screen_exists?id=${screenId}`);
  const response = await fetch(url, {
    method:  "GET",
    headers: { "Authorization": `Bearer ${jwt}` }
  });
  if (!response.ok) throw new Error("Screen check failed");
  const data = await response.json();
  console.log("🔎 Screen existence check:", data);
  return data;
}

/* =========================================
   IP LOCATION RESOLVE (SERVER-SIDE)
========================================= */

async function resolveIpLocation(jwt) {
  console.log("🌍 Resolving IP-based location…");
  return await safeFetch(
    `${activeBaseUrl}${API_PREFIX}/api_resolve_ip_location`,
    {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${jwt}`,
        "Content-Type":  "application/json"
      }
    }
  );
}
