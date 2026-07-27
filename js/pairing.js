/* =========================================
   PAIRING ENGINE
========================================= */

console.log("✅ pairing.js loaded");

let pairingCountdownInterval = null;
let pollingInterval = null;

let currentPairCode = null;
let isPairingInProgress = false;
let isPaired = false;

/* =========================================
   START PAIRING FLOW
========================================= */

async function startPairingFlow() {

    if (isPairingInProgress) {
        console.log("⏳ Pairing already in progress — skipping");
        return;
    }

    isPairingInProgress = true;
    isPaired = false;

    setState("loading");

    try {
    	const playerId = getOrCreatePlayerId();
    	const data = await createPair(playerId);

        console.log("📡 Pair API response:", data);

        if (!data || !data.pairing_code) {
            throw new Error("Invalid pairing response");
        }

        currentPairCode = data.pairing_code;

        setState("pairing");

        updatePairingUI(data.pairing_code, data.expires_in);

        startCountdown(data.expires_in);

        // 🔵 Real-time Pusher listener
        connectToPairingChannel(currentPairCode, handlePairedEvent);

        // 🟡 Polling fallback
        startPolling(currentPairCode);

    } catch (err) {
        console.error("❌ Pairing failed:", err);
        showError("Unable to generate pairing code");
        isPairingInProgress = false;
    }
}

/* =========================================
   COUNTDOWN HANDLER
========================================= */

function startCountdown(seconds) {

    clearInterval(pairingCountdownInterval);

    let remaining = seconds;
    updateCountdown(remaining);

    pairingCountdownInterval = setInterval(() => {

        if (isPaired) {
            clearInterval(pairingCountdownInterval);
            return;
        }

        remaining--;
        updateCountdown(remaining);

        if (remaining <= 0) {
            clearInterval(pairingCountdownInterval);
            restartPairing();
        }

    }, 1000);
    
    console.log("⏱ Countdown seconds received:", seconds);
}



/* =========================================
   POLLING FALLBACK
========================================= */

function startPolling(code) {

    clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {

        if (isPaired) return;

        try {
            const response = await checkPairingStatus(code);

            if (response && response.status === "paired") {
                console.log("✅ [Polling] Pairing confirmed");
                handlePairedEvent(response);
            } else {
                console.log("⏳ [Polling] Pending...");
            }

        } catch (err) {
            console.error("❌ Polling error:", err);
        }

    }, 3000);
}


/* =========================================
HANDLE SUCCESSFUL PAIR (FINAL VERSION)
========================================= */

async function handlePairedEvent(data) {

 if (isPaired) return;

 console.log("✅ Pairing confirmed:", data);

 const screenId = data.screen_id;
 const userId = data.user_id;
 const category = data.category;

 if (!screenId || !userId) {
     console.error("Invalid pairing payload");
     return;
 }

 isPaired = true;
 isPairingInProgress = false;

 clearInterval(pairingCountdownInterval);
 clearInterval(pollingInterval);

 try {
	 cleanupPairingChannel();
 } catch (e) {
     console.warn("Pusher disconnect warning:", e);
 }

 if (category) {
     useCategory(category);
 }

 setState("loading");

 try {
	  // 🔥 Fetch player to get JWT
	  const playerData = await getPlayer(screenId);
	  console.log("🎬 Player init response:", playerData);

	  const jwt = playerData?.jwt;
	  if (!jwt) throw new Error("Missing JWT in player response");

	  // Per-screen Pusher credentials (optional) — apply BEFORE any channel is
	  // subscribed so the very first connection uses them (mirrors Android).
	  const pusherCfg = playerData?.pusher || {};
	  if (typeof configurePusher === "function") {
	    configurePusher(pusherCfg.key, pusherCfg.cluster);
	  }

	  // Save device with JWT (+ any per-screen Pusher creds for next boot)
	  savePairedDevice({
	    screenId,
	    userId,
	    category,
	    jwt,
	    pusherKey:     pusherCfg.key     || null,
	    pusherCluster: pusherCfg.cluster || null
	  });
	  console.log("💾 Device saved with JWT");

	  // 🔐 Connect private channel
	  connectToUserChannel(userId, jwt, function () {
	    console.log("🎧 Playlist update received");
	    fetchPlayerData();
	  });
	  
	// ✅ ADD THIS — connect screen channel after pairing too
	  connectToScreenChannel(
	    screenId,
	    function () {
	      console.warn("❌ Screen removed — resetting player");
	      clearPairedDevice();
	      stopHeartbeat();
	      disconnectPusher();
	      startPairingFlow();
	    },
	    function () {
	      console.log("📡 Screen channel → playlist update");
	      fetchPlayerData();
	    },
	    function (requestId, targetMedia, campaignId) {
	      if (typeof notifyMediaChanged === "function") {
	        _pendingPopRequest = {
	          requestId:        requestId,
	          targetIdentifier: targetMedia || "IMMEDIATE",
	          campaignId:       String(campaignId || "")
	        };
	        _popCaptureInFlight = false;
	        var nowPlaying = (typeof playlistItems !== "undefined" &&
	                          typeof currentIndex  !== "undefined")
	                         ? playlistItems[currentIndex] : null;
	        if (nowPlaying) notifyMediaChanged(nowPlaying);
	      }
	    }
	  );
	  
	// ✅ ADD THIS LINE
	  fetchPlayerData();
	  	  
	  setState("paired");
	  console.log("🚀 Device fully initialized");

	  // ✅ Start heartbeat AFTER saving + category set
	  const d = getPairedDevice();
	  if (d) {
	    useCategory(d.category);
	    startHeartbeat(d.screenId, d.jwt);
	    sendHeartbeat(d.screenId, d.jwt).catch(() => {});
	  } else {
	    console.warn("⚠️ pairedDevice not found after saving");
	  }

	} catch (err) {
	  console.error("❌ Player initialization failed:", err);
	  showError("Failed to initialize player");
	}
}


/* =========================================
RESTART PAIRING
========================================= */


	function restartPairing() {
		  if (isPaired) return;

		  console.log("🔁 Pairing expired — restarting");

		  try { disconnectPusher(); } catch (e) { console.warn("disconnectPusher failed", e); }

		  try { clearInterval(pollingInterval); } catch (e) {}
		  try { clearInterval(pairingCountdownInterval); } catch (e) {}

		  isPairingInProgress = false;
		  isPaired = false;
		  currentPairCode = null;

		  try {
		    startPairingFlow();
		  	} catch (e) {
		    console.error("❌ restartPairing could not startPairingFlow()", e);
		    showError("Failed to restart pairing");
		    }
		  }
