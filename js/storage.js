/* =========================================
   ENVIRONMENT DETECTION
========================================= */

function isEmulator() {

    if (typeof tizen === "undefined") {
        return true;
    }

    try {

        var model = tizen.systeminfo.getCapability(
            "http://tizen.org/system/model_name"
        );

        console.log("Device model:", model);

        // 🔥 Emulator returns false or null
        return !model;

    } catch (e) {
        return true;
    }
}




/* =========================================
   STORAGE & TIZEN FILESYSTEM HANDLER
========================================= */

const STORAGE_KEY = "vypa_paired_device";
const PLAYLIST_CACHE_KEY = "vypa_cached_playlist";
const PLAYER_ID_KEY = "vypa_player_id";

/* =========================================
   PAIRED DEVICE STORAGE
========================================= */

function savePairedDevice(data) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch (e) {
        console.error("savePairedDevice failed:", e);
	}
}

function getPairedDevice() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch (e) {
        console.error("getPairedDevice failed:", e);
        return null;
    }
}

function clearPairedDevice() {
	try{
		localStorage.removeItem(STORAGE_KEY);
	} catch (e) {
        console.error("clearPairedDevice failed:", e);
    }
}


/* =========================================
PLAYER ID STORAGE
- Persistent unique identifier for this Tizen player/device
- Used when creating pairing codes so backend can distinguish devices
========================================= */

function generatePlayerId() {
 return "tizen_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

/* Samsung TV hardware DUID — a stable per-panel identifier. Reachable via the
   `productinfo` privilege already declared in config.xml. Used to SEED the
   player id so a localStorage wipe still resolves to the same physical screen
   (mirrors the webOS build's LGUDID seeding). Best-effort; returns null when
   unavailable (emulator / desktop / older firmware). */
function getTizenDuid() {
 try {
   if (typeof webapis !== "undefined" && webapis.productinfo &&
       typeof webapis.productinfo.getDuid === "function") {
     var duid = webapis.productinfo.getDuid();
     if (duid) return String(duid);
   }
 } catch (e) { /* fall through */ }
 try {
   if (typeof tizen !== "undefined" && tizen.systeminfo) {
     var tid = tizen.systeminfo.getCapability("http://tizen.org/system/tizenid");
     if (tid) return String(tid);
   }
 } catch (e) { /* fall through */ }
 return null;
}

function savePlayerId(playerId) {
 try {
     localStorage.setItem(PLAYER_ID_KEY, playerId);
     console.log("🆔 Player ID saved:", playerId);
 } catch (e) {
     console.error("savePlayerId failed:", e);
 }
}

function getPlayerId() {
 try {
     return localStorage.getItem(PLAYER_ID_KEY);
 } catch (e) {
     console.error("getPlayerId failed:", e);
     return null;
 }
}

function getOrCreatePlayerId() {
 try {
     let id = localStorage.getItem(PLAYER_ID_KEY);

     if (!id) {
         // Prefer the stable hardware DUID so identity survives a storage wipe;
         // fall back to a random id on panels that don't expose one.
         var duid = getTizenDuid();
         id = duid
              ? ("tizen_" + duid.toString().replace(/[^a-zA-Z0-9._-]/g, ""))
              : generatePlayerId();
         localStorage.setItem(PLAYER_ID_KEY, id);
         console.log("🆔 New player ID created:", id, duid ? "(from DUID)" : "(random)");
     } else {
         console.log("🆔 Existing player ID:", id);
     }

     return id;
 } catch (e) {
     console.error("getOrCreatePlayerId failed:", e);

     // fallback in case localStorage has trouble
     const fallbackId = generatePlayerId();
     console.warn("⚠️ Using fallback player ID:", fallbackId);
     return fallbackId;
 }
}

function clearPlayerId() {
 try {
     localStorage.removeItem(PLAYER_ID_KEY);
     console.log("🗑 Player ID cleared");
 } catch (e) {
     console.error("clearPlayerId failed:", e);
 }
}

/* =========================================
OPTIONAL: CLEAR ALL LOCAL PLAYER STATE
- Useful when you intentionally want this device to forget everything
========================================= */

function clearAllPlayerState() {
 try {
     clearPairedDevice();
     clearPlayerId();
     localStorage.removeItem(PLAYLIST_CACHE_KEY);
     console.log("🧹 All local player state cleared");
 } catch (e) {
     console.error("clearAllPlayerState failed:", e);
 }
}




/* =========================================
   PLAYLIST MANIFEST CACHE
========================================= */

function saveCachedPlaylist(items) {
	try {
		localStorage.setItem(PLAYLIST_CACHE_KEY, JSON.stringify(items));
	} catch (e) {
        console.error("saveCachedPlaylist failed:", e);
    }
}


function getCachedPlaylist() {
	try {
		const raw = localStorage.getItem(PLAYLIST_CACHE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch (e) {
        console.error("getCachedPlaylist failed:", e);
        return [];
    }
}

function clearCachedPlaylist() {
    try {
        localStorage.removeItem(PLAYLIST_CACHE_KEY);
    } catch (e) {
        console.error("clearCachedPlaylist failed:", e);
    }
}

/* =========================================
   TIZEN FILESYSTEM HELPERS
========================================= */
function getMediaDirectory(callback) {

    if (typeof tizen === "undefined") {
        console.error("Not running in Tizen environment");
        return;
    }

    var location = isEmulator() ? "documents" : "wgt-private";

    console.log("Using storage location:", location);

    tizen.filesystem.resolve(
        location,
        function (rootDir) {

            try {
                var dir = rootDir.resolve("vypa");
                callback(dir);

            } catch (e) {
                rootDir.createDirectory("vypa");
                var newDir = rootDir.resolve("vypa");
                callback(newDir);
            }

        },
        function (error) {
            console.error("Filesystem error:", error);
        },
        "rw"
    );
}
