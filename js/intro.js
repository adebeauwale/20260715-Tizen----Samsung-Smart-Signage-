/* =========================================
   INTRO VIDEO CONTROLLER (Tizen Safe + Orientation Aware)
========================================= */

function isPortrait() {
    return window.innerHeight > window.innerWidth;
}

function getIntroSrc() {
    return isPortrait()
        ? "./assets/boot_portrait.mp4"
        : "./assets/boot_landscape.mp4";
}

function playIntro(onFinished) {

    var video = document.getElementById("introVideo");

    if (!video) {
        console.log("Intro element missing");
        if (onFinished) onFinished();
        return;
    }

    console.log("Loading intro video...");

    var src = getIntroSrc();
    console.log("Intro selected:", src);

    // Make video fill screen nicely
    video.style.width = "100vw";
    video.style.height = "100vh";
    video.style.objectFit = "cover"; // use "contain" if you prefer no cropping
    video.style.display = "block";

    video.src = src;

    setState("intro");

    var finished = false;

    function doneOnce(reason) {
        if (finished) return;
        finished = true;
        
        console.log("Intro finishing because:", reason);

        try {
            video.pause();
        } catch (e) {}

        video.onended = null;
        video.onerror = null;
        video.onloadeddata = null;

        if (onFinished) onFinished();
    }

    video.onended = function () {
        console.log("Intro ended events fired");
        
        setTimeout(function () {
        doneOnce("ended");
        }, 2000);
    };

    video.onerror = function (e) {
        console.log("Intro error — skipping", e);
        console.log("Video currentSrc:", video.currentSrc);
        doneOnce("error");
    };

    video.onloadeddata = function () {
        console.log("Intro loaded, starting playback...");
        console.log("Intro duration:", video.duration);
        
        var timeoutMs = 30000; // fallback timeout
        
        
        if (!isNaN(video.duration) && video.duration > 0) {
            timeoutMs = Math.ceil(video.duration * 1000) + 2000;
            console.log("Adjusted timeout:", timeoutMs);
        }
              
        var p = video.play();
        
        if (p && p.catch) {
            p.catch(function (err) {
                console.log("Intro play() failed — skipping", err);
                doneOnce("play-failed");
            });
        }
    };
    
    video.load();
}