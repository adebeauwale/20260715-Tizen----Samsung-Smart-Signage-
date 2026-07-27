/* =========================================================
   VYPA TIZEN — TELEMETRY SERVICE
   =========================================================
   Collects and reports hardware health metrics every 15 s:
     • Wi-Fi Signal Strength (RSSI dBm)
     • Available Internal Storage (MB)
     • CPU Temperature (°C)

   Also provides a visibility-aware heartbeat guard so the
   dashboard never shows a false-positive "Online" status
   when the app is in the background.

   Requires: apiService.js (sendHeartbeat, activeBaseUrl,
             joinUrl, API_PREFIX)
             storage.js  (getPairedDevice)
   ========================================================= */

/* ---------------------------------------------------------
   TELEMETRY COLLECTION (Tizen System Info APIs)
   --------------------------------------------------------- */

/**
 * Returns Wi-Fi RSSI in dBm, or null if unavailable.
 * Tizen exposes this via tizen.systeminfo.getPropertyValue("WIFI_NETWORK")
 */
function getTizenWifiRssi(callback) {
  try {
    if (typeof tizen === "undefined" || !tizen.systeminfo) {
      return callback(null);
    }
    tizen.systeminfo.getPropertyValue(
      "WIFI_NETWORK",
      function (wifi) {
        // signalStrength is 0–1 on some platforms; convert to approximate dBm
        // On Tizen TV it may expose rssi directly as a negative integer.
        var rssi = null;
        if (typeof wifi.rssi === "number") {
          rssi = wifi.rssi;
        } else if (typeof wifi.signalStrength === "number") {
          // Map 0..1 → -90..-30 dBm (rough approximation)
          rssi = Math.round(-90 + wifi.signalStrength * 60);
        }
        callback(rssi);
      },
      function () {
        callback(null);
      }
    );
  } catch (e) {
    console.warn("getTizenWifiRssi error:", e);
    callback(null);
  }
}

/**
 * Returns available internal storage in MB, or null if unavailable.
 */
function getTizenAvailableStorageMB(callback) {
  try {
    if (typeof tizen === "undefined" || !tizen.systeminfo) {
      return callback(null);
    }
    tizen.systeminfo.getPropertyValue(
      "STORAGE",
      function (storage) {
        var internalUnit = null;
        if (storage && storage.units) {
          for (var i = 0; i < storage.units.length; i++) {
            var u = storage.units[i];
            if (u.type === "INTERNAL") {
              internalUnit = u;
              break;
            }
          }
        }
        if (internalUnit && typeof internalUnit.availableCapacity === "number") {
          // availableCapacity is in bytes
          callback(Math.round(internalUnit.availableCapacity / (1024 * 1024)));
        } else {
          callback(null);
        }
      },
      function () {
        callback(null);
      }
    );
  } catch (e) {
    console.warn("getTizenAvailableStorageMB error:", e);
    callback(null);
  }
}

/**
 * Returns CPU temperature in °C, or null if unavailable.
 * Note: Tizen TV does not always expose CPU temp via a standard API.
 * We attempt the webapis.systeminfo path first, then fall back gracefully.
 */
function getTizenCpuTemp(callback) {
  try {
    // Samsung Tizen (webapis) path
    if (typeof webapis !== "undefined" &&
        webapis.systeminfo &&
        typeof webapis.systeminfo.getCpuTemperature === "function") {
      var temp = webapis.systeminfo.getCpuTemperature();
      return callback(typeof temp === "number" ? temp : null);
    }
    // Standard Tizen path (may not exist on TV)
    if (typeof tizen !== "undefined" && tizen.systeminfo) {
      tizen.systeminfo.getPropertyValue(
        "CPU",
        function (cpu) {
          // cpu.load is 0..1 utilisation; temperature is not in spec but some firmwares expose it
          var temp = (typeof cpu.temperature === "number") ? cpu.temperature : null;
          callback(temp);
        },
        function () { callback(null); }
      );
    } else {
      callback(null);
    }
  } catch (e) {
    console.warn("getTizenCpuTemp error:", e);
    callback(null);
  }
}

/**
 * Collects all three metrics asynchronously and calls back with
 * { rssi, storage_mb, cpu_temp } — any value may be null.
 */
function collectTelemetry(callback) {
  getTizenWifiRssi(function (rssi) {
    getTizenAvailableStorageMB(function (storageMb) {
      getTizenCpuTemp(function (cpuTemp) {
        callback({
          rssi:       rssi,
          storage_mb: storageMb,
          cpu_temp:   cpuTemp
        });
      });
    });
  });
}

/* ---------------------------------------------------------
   ENRICHED HEARTBEAT  (replaces plain sendHeartbeat for the loop)
   --------------------------------------------------------- */

/**
 * Sends a heartbeat that also carries hardware telemetry.
 * Falls back to the plain heartbeat if telemetry collection fails.
 */
async function sendTelemetryHeartbeat(screenId, jwt) {
  return new Promise(function (resolve, reject) {
    collectTelemetry(async function (metrics) {
      try {
        var url = joinUrl(activeBaseUrl, API_PREFIX + "/heartbeat/" + screenId);
        var body = {
          rssi:       metrics.rssi,
          storage_mb: metrics.storage_mb,
          cpu_temp:   metrics.cpu_temp
        };

        console.log("💓 Telemetry heartbeat →", body);

        var response = await fetch(url, {
          method:  "POST",
          headers: {
            "Authorization": "Bearer " + jwt,
            "Content-Type":  "application/json"
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error("Heartbeat HTTP " + response.status);

        var data = await response.json();
        resolve(data);
      } catch (err) {
        // Hard fallback: plain heartbeat (no telemetry body)
        try {
          var data2 = await sendHeartbeat(screenId, jwt);
          resolve(data2);
        } catch (err2) {
          reject(err2);
        }
      }
    });
  });
}

/* ---------------------------------------------------------
   TELEMETRY HEARTBEAT LOOP  (15-second interval)
   Visibility-aware: pauses when the app is backgrounded.
   --------------------------------------------------------- */

var _telemetryInterval   = null;
var _telemetryScreenId   = null;
var _telemetryJwt        = null;
var _telemetryRunning    = false;
var _appVisible          = true;

/**
 * Start the 15-second telemetry heartbeat loop.
 * Calling this again stops any existing loop first (idempotent).
 */
function startTelemetryHeartbeat(screenId, jwt) {
  stopTelemetryHeartbeat();

  _telemetryScreenId = screenId;
  _telemetryJwt      = jwt;
  _telemetryRunning  = true;

  console.log("🌡 Telemetry heartbeat started for screen:", screenId);

  // Immediate beat
  _fireTelemetryBeat();

  // Recurring every 15 s
  _telemetryInterval = setInterval(function () {
    if (_appVisible && _telemetryRunning) {
      _fireTelemetryBeat();
    }
  }, 15000);

  // Visibility guard — pause when minimised
  document.addEventListener("visibilitychange", _onVisibilityChange);
}

function stopTelemetryHeartbeat() {
  if (_telemetryInterval) {
    clearInterval(_telemetryInterval);
    _telemetryInterval = null;
  }
  _telemetryRunning = false;
  document.removeEventListener("visibilitychange", _onVisibilityChange);
  console.log("🌡 Telemetry heartbeat stopped");
}

function _onVisibilityChange() {
  _appVisible = !document.hidden;
  if (_appVisible && _telemetryRunning) {
    console.log("🌡 App resumed — firing immediate telemetry beat");
    _fireTelemetryBeat();
  } else {
    console.log("🌡 App hidden — telemetry paused");
  }
}

function _fireTelemetryBeat() {
  if (!_telemetryScreenId || !_telemetryJwt) return;
  sendTelemetryHeartbeat(_telemetryScreenId, _telemetryJwt)
    .then(function () { console.log("🌡 Telemetry beat OK"); })
    .catch(function (e) { console.warn("🌡 Telemetry beat failed:", e); });
}