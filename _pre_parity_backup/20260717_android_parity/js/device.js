/* =========================================
   DEVICE HELPERS
========================================= */

function preventSleep() {
  try {
    if (typeof tizen !== "undefined" && tizen.power) {
      tizen.power.request("SCREEN", "SCREEN_NORMAL");
    }
  } catch (e) {
    console.warn("Power API unavailable", e);
  }
}

function disableBackButton() {
    console.log("disableBackButton() bypassed");
}
