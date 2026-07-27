/* =========================================
   DEVICE HELPERS
========================================= */

var _keepAwakeInterval = null;

function _requestScreenOn() {
  try {
    if (typeof tizen !== "undefined" && tizen.power) {
      tizen.power.request("SCREEN", "SCREEN_NORMAL");
    }
  } catch (e) {
    console.warn("Power API unavailable", e);
  }
}

/* Keep the panel awake. tizen.power.request can be reset by the platform (screen
   saver / power policy), so — like the webOS build — we re-assert it every 60 s
   rather than relying on a single call at boot. Idempotent. */
function preventSleep() {
  _requestScreenOn();
  if (!_keepAwakeInterval) {
    _keepAwakeInterval = setInterval(_requestScreenOn, 60000);
  }
}

function disableBackButton() {
    console.log("disableBackButton() bypassed");
}
