/* =========================================================
   VYPA — CONTENT SCHEDULING (date-range dayparting)
   =========================================================
   Mirrors Android ScreenViewModel.isItemActive() + the 60s
   _minuteTicker: each playlist item may carry a start/end date;
   items outside their window are filtered out of playback. The
   end date is INCLUSIVE (Android adds a day), and the whole set
   is re-evaluated once a minute so a window that opens/closes
   mid-day flips WITHOUT needing a server round-trip (works fully
   offline).

   Platform-agnostic — identical file on webOS, Tizen, VIDAA.
   ========================================================= */

/* Parse a date-ish value into epoch ms, or null if absent/unparseable.
   Accepts "YYYY-MM-DD", "YYYY-MM-DD HH:MM:SS", ISO, or epoch numbers.

   A campaign day belongs to the SCREEN, not to UTC. A host who books the 13th
   is buying the 13th where their screen stands, midnight to midnight on that
   wall clock — so a bare date must be read as LOCAL midnight.

   That is not what Date.parse does. ECMAScript says a date-ONLY string
   ("2026-08-13") is UTC, while a date-TIME string with no zone
   ("2026-08-13T00:00:00") is local. The two differ by the device's offset, and
   the old code fell into the first case: `s.replace(" ", "T")` finds no space
   in a bare date, so it stayed date-only and parsed as UTC midnight.

   On a Toronto screen (UTC-4 in summer) that ran every window four hours early:
   an ad booked for the 13th started at 8pm on the 12th and stopped at 8pm on
   the 13th, cutting four hours off the last day the advertiser paid for. In
   Lagos (UTC+1) it ran an hour late at both ends instead.

   Android has always been right — SimpleDateFormat parses in device local time
   — so this is what puts the JS players back in step with it. */
function _vypaParseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  var s = String(v).trim();
  if (!s || s === "0000-00-00" || s === "0000-00-00 00:00:00") return null;

  // A bare "YYYY-MM-DD" gets an explicit midnight so it parses as LOCAL.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var d = new Date(
      parseInt(s.slice(0, 4), 10),
      parseInt(s.slice(5, 7), 10) - 1,   // JS months are 0-based
      parseInt(s.slice(8, 10), 10)
    );
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  // Normalise "YYYY-MM-DD HH:MM:SS" → ISO so Safari/WebKit parses it. With a
  // time component and no zone, Date.parse is already local.
  var iso = s.indexOf("T") === -1 ? s.replace(" ", "T") : s;
  var t = Date.parse(iso);
  if (isNaN(t)) {
    t = Date.parse(s);
    if (isNaN(t)) return null;
  }
  return t;
}

/* Read the start/end window off an item, tolerating many key spellings
   (the backend passes item columns straight through). */
function _vypaItemWindow(item) {
  var start =
    _vypaParseDate(item.start_date) ??
    _vypaParseDate(item.startDate)  ??
    _vypaParseDate(item.start)      ??
    _vypaParseDate(item.available_from);
  var end =
    _vypaParseDate(item.end_date) ??
    _vypaParseDate(item.endDate)  ??
    _vypaParseDate(item.end)      ??
    _vypaParseDate(item.available_to);
  return { start: start, end: end };
}

/* Is this item active right now? No window → always active. */
function isItemActive(item, nowMs) {
  if (!item) return false;
  var now = (typeof nowMs === "number") ? nowMs : Date.now();
  var w = _vypaItemWindow(item);

  if (w.start !== null && now < w.start) return false;

  if (w.end !== null) {
    // Inclusive end-of-day: add 24h so "ends 2026-07-01" plays through that day.
    var endInclusive = w.end + 24 * 60 * 60 * 1000;
    if (now >= endInclusive) return false;
  }
  return true;
}

/* Filter a playlist down to the items active right now. If the filter
   would empty the list (e.g. every item is future-dated) we fall back to
   the full list so the screen never goes blank — matches Android. */
function filterActiveItems(items) {
  if (!items || !items.length) return items || [];
  var now = Date.now();
  var active = items.filter(function (it) { return isItemActive(it, now); });
  return active.length > 0 ? active : items;
}

/* Whether a list contains any item whose active-state depends on a date
   window (i.e. is the minute-ticker worth running for this playlist?). */
function playlistHasScheduling(items) {
  if (!items || !items.length) return false;
  for (var i = 0; i < items.length; i++) {
    var w = _vypaItemWindow(items[i]);
    if (w.start !== null || w.end !== null) return true;
  }
  return false;
}

/* =========================================================
   MINUTE TICKER
   ─────────────────────────────────────────────────────────
   Re-evaluates the active set every 60s. When the active set
   actually CHANGES (an item entered or left its window) it calls
   onChange(newActiveItems) so the engine can rebuild playback.
   ========================================================= */

var _vypaSchedTicker = null;
var _vypaSchedSignature = "";

function _vypaActiveSignature(items) {
  // Cheap order-sensitive signature of the active id list.
  var ids = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    ids.push(String(it.id || it.media_id || it.url || i));
  }
  return ids.join("|");
}

function startSchedulingTicker(getFullPlaylist, onChange) {
  stopSchedulingTicker();

  // Seed the signature with the current active set so the first tick only
  // fires onChange if something genuinely flipped.
  try {
    _vypaSchedSignature = _vypaActiveSignature(filterActiveItems(getFullPlaylist() || []));
  } catch (e) { _vypaSchedSignature = ""; }

  _vypaSchedTicker = setInterval(function () {
    var full = getFullPlaylist() || [];
    var active = filterActiveItems(full);
    var sig = _vypaActiveSignature(active);
    if (sig !== _vypaSchedSignature) {
      console.log("🗓 Scheduling: active set changed — rebuilding playback");
      _vypaSchedSignature = sig;
      if (typeof onChange === "function") onChange(active);
    }
  }, 60000);

  console.log("🗓 Scheduling minute-ticker started");
}

function stopSchedulingTicker() {
  if (_vypaSchedTicker) {
    clearInterval(_vypaSchedTicker);
    _vypaSchedTicker = null;
  }
}
