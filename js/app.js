
function isPortrait() {
  return window.innerHeight > window.innerWidth;
}

function applyOrientationClass() {
  const root = document.documentElement; // or document.body
  if (isPortrait()) {
    root.classList.add("portrait");
    root.classList.remove("landscape");
  } else {
    root.classList.add("landscape");
    root.classList.remove("portrait");
  }
}

window.addEventListener("load", applyOrientationClass);
window.addEventListener("resize", applyOrientationClass);
window.addEventListener("orientationchange", applyOrientationClass);

document.addEventListener("DOMContentLoaded", function () {	
//	 localStorage.clear();   // 🔥 TEMPORARY RESET

    preventSleep();
 // disableBackButton(); // Removed to comply with Samsung Return/Exit policy

    playIntro(function () {

        const pairedDevice = getPairedDevice();

        if (!pairedDevice) {
            startPairingFlow();
        } else {
            useCategory(pairedDevice.category);
            setState("paired");
            console.log("✅ BOOT: pairedDevice found -> initializing player", pairedDevice);
            initializePlayer();
        }

    });

});

let exitPopupVisible = false;
let exitPopupSelected = "no";

function showExitPopup() {
  const popup = document.getElementById("exitPopup");
  const yesBtn = document.getElementById("exitYesBtn");
  const noBtn = document.getElementById("exitNoBtn");

  if (!popup || !yesBtn || !noBtn) {
    console.warn("Exit popup elements not found");
    return;
  }

  exitPopupVisible = true;
  exitPopupSelected = "no";
  popup.style.display = "flex";
  updateExitPopupFocus();
}

function hideExitPopup() {
  const popup = document.getElementById("exitPopup");
  if (!popup) return;

  exitPopupVisible = false;
  popup.style.display = "none";
}

function updateExitPopupFocus() {
  const yesBtn = document.getElementById("exitYesBtn");
  const noBtn = document.getElementById("exitNoBtn");
  if (!yesBtn || !noBtn) return;

  if (exitPopupSelected === "yes") {
    yesBtn.focus();
  } else {
    noBtn.focus();
  }
}

function confirmExitSelection() {
  if (exitPopupSelected === "yes") {
    tizen.application.getCurrentApplication().exit();
  } else {
    hideExitPopup();
  }
}

function handleBackKey() {
  if (exitPopupVisible) {
    hideExitPopup();
    return;
  }

  // VYPA is effectively a home-screen style signage player with no page stack.
  showExitPopup();
}

function handleKeyDown(e) {
  switch (e.keyCode) {
    case 37: // LEFT
      if (exitPopupVisible) {
        exitPopupSelected = "yes";
        updateExitPopupFocus();
        e.preventDefault();
      }
      break;

    case 39: // RIGHT
      if (exitPopupVisible) {
        exitPopupSelected = "no";
        updateExitPopupFocus();
        e.preventDefault();
      }
      break;

    case 13: // OK / ENTER
      if (exitPopupVisible) {
        confirmExitSelection();
        e.preventDefault();
      }
      break;

    case 10009: // RETURN / BACK
      handleBackKey();
      e.preventDefault();
      break;

    default:
      console.log("Key code:", e.keyCode);
      break;
  }
}

function bindExitPopupButtons() {
  const yesBtn = document.getElementById("exitYesBtn");
  const noBtn = document.getElementById("exitNoBtn");

  if (yesBtn) {
    yesBtn.addEventListener("click", function () {
      tizen.application.getCurrentApplication().exit();
    });
  }

  if (noBtn) {
    noBtn.addEventListener("click", function () {
      hideExitPopup();
    });
  }
}

var init = function () {
  console.log("init() called");

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;

    const d = getPairedDevice && getPairedDevice();
    if (!d) return;

    if (typeof useCategory === "function") useCategory(d.category);

    startHeartbeat(d.screenId, d.jwt);

    sendHeartbeat(d.screenId, d.jwt)
      .then(() => console.log("💓 Heartbeat immediate success (resume)"))
      .catch((e) => console.warn("💔 Heartbeat immediate failed (resume):", e));
  });

  bindExitPopupButtons();
  document.addEventListener("keydown", handleKeyDown);
};

window.addEventListener("load", init);
