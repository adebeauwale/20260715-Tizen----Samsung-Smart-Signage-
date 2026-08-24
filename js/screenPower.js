/* =========================================================
   VYPA — SCREEN ON/OFF SCHEDULE
   =========================================================
   Companion to scheduling.js. That file decides which PLAYLIST
   ITEMS are in season; this one decides whether the SCREEN
   should be showing anything at all — the "TV off at 22:00,
   back on at 07:00" rule the dashboard now writes.

   Three things matter here:

   1. It is evaluated locally, every 30 s, against wall-clock
      time. A screen that loses its connection at 6pm must
      still switch itself off at 10pm, so the rules are cached
      in localStorage and never need the server again.

   2. A shutdown always paints a black overlay and pauses
      playback — that part works on every panel. Asking the
      panel itself to power down is best-effort on top, via
      platformScreenOff() where the platform exposes it.

   3. A window that ends before it starts (22:00 → 07:00)
      crosses midnight. The evening half belongs to the listed
      day; the small hours belong to the day AFTER it, so a
      Friday-night rule still covers early Saturday. This
      mirrors ScreenSchedule::isOffNow() on the server exactly.

   Platform-agnostic — identical file on webOS, Tizen, VIDAA.
   ========================================================= */

var SCREEN_SCHEDULE_KEY = "vypa_screen_schedule";

var _vypaPowerTicker  = null;
var _vypaScreenIsOff  = false;
var _vypaOffOverlay   = null;

/* ---------------------------------------------------------
   PERSISTENCE
   --------------------------------------------------------- */

function saveScreenSchedule(schedule) {
  try {
    if (schedule) {
      localStorage.setItem(SCREEN_SCHEDULE_KEY, JSON.stringify(schedule));
    } else {
      // An unassigned screen must forget its old hours, or it keeps
      // switching itself off after the schedule was removed.
      localStorage.removeItem(SCREEN_SCHEDULE_KEY);
    }
  } catch (e) {
    console.warn("Could not persist screen schedule:", e);
  }
}

function getScreenSchedule() {
  try {
    var raw = localStorage.getItem(SCREEN_SCHEDULE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/* ---------------------------------------------------------
   EVALUATION
   --------------------------------------------------------- */

/* Wall-clock reading of "now" in the schedule's zone.
   Returns { minutes, day (1=Mon..7=Sun), date "YYYY-MM-DD" }.

   An empty timezone means "use this device's own clock", which is the
   default and the right answer for a screen shipped to another region. */
function _vypaLocalParts(timezone, nowDate) {
  var d = nowDate || new Date();

  if (timezone) {
    try {
      var fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", weekday: "short"
      });

      var parts = {};
      fmt.formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });

      var names = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
      var day = names[parts.weekday];

      // 24-hour formatters render midnight as "24" on some engines.
      var hour = parseInt(parts.hour, 10) % 24;

      if (day) {
        return {
          minutes: hour * 60 + parseInt(parts.minute, 10),
          day: day,
          date: parts.year + "-" + parts.month + "-" + parts.day
        };
      }
    } catch (e) {
      // No Intl timeZone support on this firmware — fall through to device local.
    }
  }

  var jsDay = d.getDay();                    // 0 = Sunday
  return {
    minutes: d.getHours() * 60 + d.getMinutes(),
    day: jsDay === 0 ? 7 : jsDay,            // → ISO 1..7
    date: d.getFullYear() + "-" +
          ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
          ("0" + d.getDate()).slice(-2)
  };
}

function _vypaToMinutes(hhmm) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || "").trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/* Does `event` cover the moment described by `parts`? */
function _vypaEventCovers(event, parts) {
  var days = event.days || [];
  if (!days.length) return false;

  if (event.start_date && parts.date < event.start_date) return false;
  if (event.end_date   && parts.date > event.end_date)   return false;

  var start = _vypaToMinutes(event.start);
  var end   = _vypaToMinutes(event.end);
  if (start === null || end === null || start === end) return false;

  if (start < end) {
    // Ordinary same-day window: 13:00 → 14:00.
    return days.indexOf(parts.day) !== -1 && parts.minutes >= start && parts.minutes < end;
  }

  // Crosses midnight: 22:00 → 07:00.
  if (days.indexOf(parts.day) !== -1 && parts.minutes >= start) return true;
  var prevDay = parts.day === 1 ? 7 : parts.day - 1;
  return days.indexOf(prevDay) !== -1 && parts.minutes < end;
}

/* Should the screen be dark right now? */
function isScreenOffNow(schedule, nowDate) {
  schedule = schedule || getScreenSchedule();
  if (!schedule || !schedule.events || !schedule.events.length) return false;

  var parts = _vypaLocalParts(schedule.timezone || "", nowDate);

  for (var i = 0; i < schedule.events.length; i++) {
    var e = schedule.events[i];
    if (e.type !== "screen_off") continue;
    if (_vypaEventCovers(e, parts)) return true;
  }
  return false;
}

/* The playlist a "content" event wants on screen right now, or null when
   the ordinary assigned playlist should play. */
function scheduledPlaylistId(schedule, nowDate) {
  schedule = schedule || getScreenSchedule();
  if (!schedule || !schedule.events || !schedule.events.length) return null;

  var parts = _vypaLocalParts(schedule.timezone || "", nowDate);

  for (var i = 0; i < schedule.events.length; i++) {
    var e = schedule.events[i];
    if (e.type !== "content" || !e.playlist_id) continue;
    if (_vypaEventCovers(e, parts)) return e.playlist_id;
  }
  return null;
}

/* When does the current off-window end? Used only for the on-screen note. */
function _vypaOffUntil(schedule, nowDate) {
  var parts = _vypaLocalParts((schedule && schedule.timezone) || "", nowDate);
  for (var i = 0; i < (schedule.events || []).length; i++) {
    var e = schedule.events[i];
    if (e.type === "screen_off" && _vypaEventCovers(e, parts)) return e.end;
  }
  return null;
}

/* ---------------------------------------------------------
   ENFORCEMENT
   --------------------------------------------------------- */

function _vypaBuildOverlay() {
  var el = document.createElement("div");
  el.id = "vypaScreenOff";
  el.style.cssText = [
    "position:fixed", "inset:0", "top:0", "left:0", "right:0", "bottom:0",
    "width:100%", "height:100%",
    "background:#000",
    "z-index:99999",
    "display:flex", "align-items:center", "justify-content:center"
  ].join(";");

  // A faint note, not a bright one: this is meant to look like an off screen,
  // but a technician standing in front of it should still be able to tell the
  // player is alive and merely out of hours.
  var note = document.createElement("div");
  note.id = "vypaScreenOffNote";
  note.style.cssText = "color:#111;font-family:sans-serif;font-size:14px;letter-spacing:1px;";
  el.appendChild(note);

  return el;
}

function _vypaPauseMedia() {
  try {
    var media = document.querySelectorAll("video, audio");
    for (var i = 0; i < media.length; i++) {
      try { media[i].pause(); } catch (e) {}
    }
  } catch (e) {}
}

function _vypaEnterOff(schedule) {
  if (_vypaScreenIsOff) return;
  _vypaScreenIsOff = true;

  console.log("🌙 Screen schedule → OFF");

  if (!_vypaOffOverlay) _vypaOffOverlay = _vypaBuildOverlay();
  if (!_vypaOffOverlay.parentNode) document.body.appendChild(_vypaOffOverlay);

  var until = _vypaOffUntil(schedule, null);
  var note = document.getElementById("vypaScreenOffNote");
  if (note) note.textContent = until ? "Scheduled off until " + until : "";

  _vypaPauseMedia();

  // Stop fighting the panel's own sleep — during a scheduled shutdown the
  // keep-awake nudge is exactly the wrong thing to be doing.
  if (typeof stopPreventSleep === "function") {
    try { stopPreventSleep(); } catch (e) {}
  }

  if (typeof platformScreenOff === "function") {
    try { platformScreenOff(); } catch (e) {}
  }

  if (typeof onScreenPowerChange === "function") {
    try { onScreenPowerChange(false); } catch (e) {}
  }
}

function _vypaExitOff() {
  if (!_vypaScreenIsOff) return;
  _vypaScreenIsOff = false;

  console.log("☀️ Screen schedule → ON");

  if (_vypaOffOverlay && _vypaOffOverlay.parentNode) {
    _vypaOffOverlay.parentNode.removeChild(_vypaOffOverlay);
  }

  if (typeof platformScreenOn === "function") {
    try { platformScreenOn(); } catch (e) {}
  }

  // Put the screensaver blocker back before playback resumes.
  if (typeof preventSleep === "function") {
    try { preventSleep(); } catch (e) {}
  }

  if (typeof onScreenPowerChange === "function") {
    try { onScreenPowerChange(true); } catch (e) {}
  }
}

/* Evaluate once and act on any transition. Safe to call at any time. */
function evaluateScreenPower() {
  var schedule = getScreenSchedule();

  if (!schedule || !schedule.events || !schedule.events.length) {
    _vypaExitOff();
    return false;
  }

  if (isScreenOffNow(schedule)) {
    _vypaEnterOff(schedule);
    return true;
  }

  _vypaExitOff();
  return false;
}

/* ---------------------------------------------------------
   TICKER
   ─────────────────────────────────────────────────────────
   30 s rather than 60 s so a shutdown lands within half a
   minute of its stated time — close enough that a shop owner
   watching the clock sees it happen "at 22:00".
   --------------------------------------------------------- */

function startScreenPowerTicker() {
  stopScreenPowerTicker();
  evaluateScreenPower();
  _vypaPowerTicker = setInterval(evaluateScreenPower, 30000);
  console.log("🔌 Screen power ticker started");
}

function stopScreenPowerTicker() {
  if (_vypaPowerTicker) {
    clearInterval(_vypaPowerTicker);
    _vypaPowerTicker = null;
  }
}

/* Apply a schedule that just arrived from the server (or null to clear it)
   and re-evaluate immediately, so a change made in the dashboard takes
   effect now rather than at the next tick. */
function applyScreenSchedule(schedule) {
  saveScreenSchedule(schedule || null);
  evaluateScreenPower();
}

/* Is the screen currently dark because of its schedule? Playback code asks
   this before starting anything. */
function screenIsScheduledOff() {
  return _vypaScreenIsOff;
}
