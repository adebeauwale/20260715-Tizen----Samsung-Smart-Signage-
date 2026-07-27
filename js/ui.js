/* =========================================
   UI RENDERING
========================================= */

function hideAllScreens() {
    document.querySelectorAll(".screen").forEach(el => {
        el.style.display = "none";
    });
}

function renderUI() {
    hideAllScreens();

    const state = getState();

    switch (state) {

        case "intro":
            document.getElementById("introScreen").style.display = "block";
            break;

        case "loading":
            document.getElementById("loadingScreen").style.display = "flex";
            break;

        case "pairing":
            document.getElementById("pairingScreen").style.display = "block";
            break;

        case "error":
            document.getElementById("errorScreen").style.display = "flex";
            break;

        case "paired":
            document.getElementById("successScreen").style.display = "flex";
            break;

        case "no-playlist":
            document.getElementById("noPlaylistScreen").style.display = "flex";
            break;
            
        case "player":
            document.getElementById("playerScreen").style.display = "block";
            break;

    }
}


function updatePairingUI(code, expiresIn) {
    document.getElementById("pairingCode").innerText = code;
    document.getElementById("countdown").innerText =
        `Expires in: ${expiresIn}s`;
}

function updateCountdown(seconds) {
    document.getElementById("countdown").innerText =
        `Expires in: ${seconds}s`;
}

function showError(message) {
    setState("error");
    document.getElementById("errorMessage").innerText = message;
}
