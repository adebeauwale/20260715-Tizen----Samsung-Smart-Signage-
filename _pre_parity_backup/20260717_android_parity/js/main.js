var checkTime;

//Initialize function
var init = function () {
    // TODO:: Do your initialization job
    console.log('init() called');
    
    document.addEventListener("visibilitychange", function () {
    	  if (document.hidden) return;

    	  const d = getPairedDevice && getPairedDevice();
    	  if (!d) return;

    	  // Optional (only if your UI depends on it)
    	  if (typeof useCategory === "function") useCategory(d.category);

    	  // Restart heartbeat on resume
    	  startHeartbeat(d.screenId, d.jwt);

    	  // Also fire one immediate beat so dashboard flips Online fast
    	  sendHeartbeat(d.screenId, d.jwt)
    	    .then(() => console.log("💓 Heartbeat immediate success (resume)"))
    	    .catch((e) => console.warn("💔 Heartbeat immediate failed (resume):", e));
    	});
 
    // add eventListener for keydown
    document.addEventListener('keydown', function(e) {
    	switch(e.keyCode){
    	case 37: //LEFT arrow
    		break;
    	case 38: //UP arrow
    		break;
    	case 39: //RIGHT arrow
    		break;
    	case 40: //DOWN arrow
    		break;
    	case 13: //OK button
    		break;
    	case 10009: //RETURN button
    		
		tizen.application.getCurrentApplication().exit();
    		break;
    	default:
    		console.log('Key code : ' + e.keyCode);
    		break;
    	}
    });
};
// window.onload can work without <body onload="">
window.addEventListener("load", init);

function startTime() {
    var today = new Date();
    var h = today.getHours();
    var m = today.getMinutes();
    var s = today.getSeconds();
    m = checkTime(m);
    s = checkTime(s);
    document.getElementById('divbutton1').innerHTML='Current time: ' + h + ':' + m + ':' + s;
    setTimeout(startTime, 10);
}

function checkTime(i) {
    if (i < 10) {
        i='0' + i;
    }
    return i;
}
