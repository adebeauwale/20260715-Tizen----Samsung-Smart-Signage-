/* =========================================
   APP STATE MANAGER
========================================= */

let appState = "boot"; 
// boot | loading | pairing | error | paired

function setState(newState) {
    appState = newState;
    console.log("🧠 App state →", newState);
    renderUI();
}

function getState() {
    return appState;
}
