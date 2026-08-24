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

/* ---------------------------------------------------------
   SCHEDULED SCREEN OFF / ON
   ─────────────────────────────────────────────────────────
   screenPower.js always paints a black overlay, which is what
   actually guarantees a dark screen. These go further and ask
   the panel to power down, which saves the backlight and is
   what a shop owner means by "the TV turns off at 10".
   Best-effort by design: a set-top box with no display control
   still gets the overlay.
   --------------------------------------------------------- */

/* Release the keep-awake nudge. Re-asserting SCREEN_NORMAL every 60 s during a
   scheduled shutdown fights the panel we just asked to switch off. */
function stopPreventSleep() {
  if (_keepAwakeInterval) {
    clearInterval(_keepAwakeInterval);
    _keepAwakeInterval = null;
  }
  try {
    if (typeof tizen !== "undefined" && tizen.power) {
      tizen.power.release("SCREEN");
    }
  } catch (e) {}
}

function platformScreenOff() {
  stopPreventSleep();

  // Samsung Signage (SSSP) exposes real panel control; consumer Tizen TVs
  // usually do not, and fall back to the overlay alone.
  try {
    if (typeof b2bapis !== "undefined" && b2bapis.b2bcontrol &&
        typeof b2bapis.b2bcontrol.setPanelStatus === "function") {
      b2bapis.b2bcontrol.setPanelStatus(false,
        function () { console.log("🌙 Panel off"); },
        function (e) { console.warn("Panel off refused:", e); });
      return true;
    }
  } catch (e) {}

  try {
    if (typeof tizen !== "undefined" && tizen.power &&
        typeof tizen.power.setScreenState === "function") {
      tizen.power.setScreenState(false);
      return true;
    }
  } catch (e) {}

  return false;
}

function platformScreenOn() {
  try {
    if (typeof b2bapis !== "undefined" && b2bapis.b2bcontrol &&
        typeof b2bapis.b2bcontrol.setPanelStatus === "function") {
      b2bapis.b2bcontrol.setPanelStatus(true, function () {}, function () {});
    }
  } catch (e) {}

  preventSleep();
  return true;
}
