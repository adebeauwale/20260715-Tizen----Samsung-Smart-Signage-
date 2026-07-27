/* =========================================================
   VYPA TIZEN — TEP (Tizen Enterprise Platform) ADAPTER
   =========================================================
   Wraps the Samsung TEP `webapis.*` surface behind capability
   checks so the same codebase runs on:

     • SSSP 10 / Tizen 6.5+ panels with a Partner-level cert
       → TEP fast paths (Unipicture 4K image rendering)
     • Everything older (SSSP 6–9), or any panel where the
       package is not Partner-signed
       → silent fallback to the standard HTML paths

   HARD REQUIREMENTS for any webapis.* call to succeed
   (per Tizen Partner Summit 2025 — "Why TEP" / "TEP New API"):
     1. config.xml  required_version = 6.5
     2. Package signed with a Samsung Partner-level certificate.
        Without it the calls DO NOT execute — this is enforced
        platform-side, not a soft failure.
     3. webapis.js loaded before this file (see index.html).
     4. Firmware >= S-PTMLWWC-1060.9 (Aug 1 2024) for Unipicture.

   Because (2) is invisible at runtime until a call throws, every
   entry point here is defensive and returns a boolean rather than
   raising — callers must treat `false` as "use the old path".
   ========================================================= */

var TEP = (function () {

  var _probed        = false;
  var _hasWebapis    = false;
  var _hasUnipicture = false;
  var _hasSysDebug   = false;
  var _uniHandle     = false;   // create() succeeded, not yet destroyed
  var _uniActive     = false;   // show() succeeded — handle is on screen
  var _logsRunning   = false;   // a debug log capture is in flight

  /* -------------------------------------------------------
     CAPABILITY PROBE  (runs once, cheap, never throws)
     ------------------------------------------------------- */

  function _probe() {
    if (_probed) return;
    _probed = true;

    try {
      _hasWebapis = (typeof webapis !== "undefined") && !!webapis;
    } catch (e) {
      _hasWebapis = false;
    }

    if (!_hasWebapis) {
      console.log("ℹ️ TEP: webapis unavailable — legacy HTML paths only");
      return;
    }

    // Unipicture needs the whole documented call chain present. Probing each
    // function individually avoids a partial API surface (older firmware may
    // ship a subset) sending us down a path that dies halfway through an image.
    try {
      var u = webapis.unipicture;
      _hasUnipicture = !!u &&
        typeof u.setScalerType   === "function" &&
        typeof u.create          === "function" &&
        typeof u.load            === "function" &&
        typeof u.setDisplayRect  === "function" &&
        typeof u.show            === "function" &&
        typeof u.destroy         === "function";
    } catch (e) {
      _hasUnipicture = false;
    }

    try {
      var d = webapis.systemdebug;
      _hasSysDebug = !!d &&
        typeof d.startDebugLogs === "function" &&
        typeof d.stopDebugLogs  === "function";
    } catch (e) {
      _hasSysDebug = false;
    }

    console.log("✅ TEP probe → webapis:", _hasWebapis,
                "| unipicture:", _hasUnipicture,
                "| systemdebug:", _hasSysDebug);
  }

  /* -------------------------------------------------------
     PATH NORMALISATION

     cacheService stores media via tizen.filesystem and hands back
     item.localPath as a "file:///..." URI (File.toURI()).

     The 2025 deck documents the call as load(filePath) but tables it
     as "Load Content URL" — the two disagree, and we cannot resolve
     that without hardware. So: try the value as given, and on failure
     retry with the file:// scheme stripped to a raw absolute path.
     Whichever wins is logged once so this can be pinned down after
     the first on-device run.
     ------------------------------------------------------- */

  function _toRawPath(p) {
    if (!p) return p;
    // file:///opt/usr/home/... -> /opt/usr/home/...
    return String(p).replace(/^file:\/\//i, "");
  }

  function _isLocalFile(p) {
    return !!p && /^(file:\/\/|\/)/i.test(String(p));
  }

  /* -------------------------------------------------------
     UNIPICTURE

     Documented call sequence (TEP New API, slide 7):
       setScalerType('MAIN')
       create()
       load(filePath)
       setDisplayRect(x, y, w, h)
       setCropRect(x, y, w, h)
       rotate(270)
       show()

     setCropRect and rotate are optional in practice — we only call
     rotate when a non-zero rotation is configured, and we skip
     setCropRect entirely (we want the whole image, and cropping to
     full-frame is a no-op that only adds a failure point).
     ------------------------------------------------------- */

  function unipictureSupported() {
    _probe();
    return _hasUnipicture;
  }

  /**
   * showImage(path, opts) -> boolean
   *
   * Renders a local image full-frame via the SoC scaler. Returns true only
   * if the entire documented sequence completed; on ANY failure it tears
   * down cleanly and returns false so the caller can fall back to <img>.
   *
   * opts.rotation — 0 | 90 | 180 | 270. Defaults to VYPA_TEP_ROTATION
   *                 (set in index.html per-build) or 0.
   *                 NOTE: left at 0 by default deliberately — guessing
   *                 rotation from viewport size risks flipping content on
   *                 correctly-configured panels. Set it explicitly for
   *                 portrait builds.
   */
  function unipictureShow(path, opts) {
    _probe();
    if (!_hasUnipicture) return false;

    // OPT-IN, default OFF. Unipicture renders through the SoC scaler; if that
    // plane composites BEHIND the web layer (as AVPlay video planes do), an
    // opaque page background hides the image while show() still reports
    // success — a silent black screen in production. Until that is confirmed
    // on hardware, this path stays off. See README "Must verify on hardware".
    if (window.VYPA_TEP_UNIPICTURE !== true) return false;

    // Unipicture drives the hardware scaler off a decoded file. A remote
    // https:// URL has no local file behind it, so don't even try — let the
    // <img> tag stream it as it does today.
    if (!_isLocalFile(path)) {
      return false;
    }

    opts = opts || {};
    var rotation = (typeof opts.rotation === "number")
      ? opts.rotation
      : (typeof window.VYPA_TEP_ROTATION === "number" ? window.VYPA_TEP_ROTATION : 0);

    var w = opts.width  || window.innerWidth  || 1920;
    var h = opts.height || window.innerHeight || 1080;

    // Any previous handle must go before we create the next one, or handles
    // leak across playlist rotation.
    unipictureHide();

    var loaded = false;

    try {
      webapis.unipicture.setScalerType("MAIN");
      webapis.unipicture.create();
      _uniHandle = true;   // from here on a handle exists and MUST be destroyed

      // Try the path exactly as cacheService produced it, then the raw
      // filesystem path. See _toRawPath() for why this is ambiguous.
      try {
        webapis.unipicture.load(path);
        loaded = true;
        _logLoadForm("uri", path);
      } catch (eUri) {
        var raw = _toRawPath(path);
        if (raw !== path) {
          webapis.unipicture.load(raw);
          loaded = true;
          _logLoadForm("raw", raw);
        } else {
          throw eUri;
        }
      }

      webapis.unipicture.setDisplayRect(0, 0, w, h);

      if (rotation) {
        webapis.unipicture.rotate(rotation);
      }

      webapis.unipicture.show();
      _uniActive = true;
      _setPageTransparent(true);

      return true;

    } catch (e) {
      console.warn("⚠️ TEP unipicture failed (" +
                   (e && e.code) + " / " + (e && e.name) + "): " +
                   (e && e.message) + " — falling back to <img>");
      // Half-built handles must not survive a failure; if load() succeeded but
      // show() threw, a handle exists and would block the next create().
      unipictureHide();
      return false;
    }
  }

  var _loadFormLogged = false;
  function _logLoadForm(form, value) {
    if (_loadFormLogged) return;
    _loadFormLogged = true;
    console.log("📌 TEP unipicture.load() accepted the '" + form +
                "' path form → " + value +
                "  (pin this in _toRawPath once confirmed on hardware)");
  }

  /**
   * hide() — tears down the current handle. Safe to call unconditionally;
   * never throws. Called before every new image and by _hideAllLayers().
   */
  function unipictureHide() {
    if (!_hasUnipicture) return;
    _setPageTransparent(false);

    // Nothing was ever created — don't poke the scaler with a destroy() for a
    // handle that doesn't exist (it would throw on every first image).
    if (!_uniHandle) { _uniActive = false; return; }

    // close() only makes sense for a handle that actually reached show();
    // a create()-then-failed handle just needs destroying.
    if (_uniActive) _quiet(function () { webapis.unipicture.close(); });
    _quiet(function () { webapis.unipicture.destroy(); });

    _uniHandle = false;
    _uniActive = false;
  }

  function _quiet(fn) {
    try { fn(); } catch (e) { /* teardown must never throw */ }
  }

  /* Punches the opaque black page background out while a scaler-rendered
     image is up, so the plane is visible if it composites underneath the web
     layer. Harmless if it composites above. Reverted on every hide() so the
     normal <img>/<video> paths keep their black backdrop. */
  function _setPageTransparent(on) {
    try {
      var b = document.body;
      if (!b) return;
      if (on) b.classList.add("tep-uni-active");
      else    b.classList.remove("tep-uni-active");
    } catch (e) { /* non-fatal */ }
  }

  /* -------------------------------------------------------
     SYSTEMDEBUG  —  remote ep_control log capture

     Unlike Unipicture this needs only a PUBLIC-level certificate and the
     `http://tizen.org/privilege/filesystem.read` privilege (already declared
     in config.xml), so it is usable without the Partner cert. It still needs
     required_version 6.5 and firmware >= S-PTMLWWC-1080.7 (Jan 7 2025).

     The device collects ep_control logs and uploads them to serverUrl, so
     nothing is returned to JS — success only means "capture started".

     Both start and stop are ASYNC (success/error callbacks); getVersion is
     synchronous. The deck's stopDebugLogs sample is malformed JS (declares
     callbacks inside a try with commas); the correct shape is used here.
     ------------------------------------------------------- */

  function systemdebugSupported() {
    _probe();
    return _hasSysDebug;
  }

  function systemdebugGetVersion() {
    _probe();
    if (!_hasSysDebug) return null;
    try {
      if (typeof webapis.systemdebug.getVersion !== "function") return null;
      return webapis.systemdebug.getVersion();
    } catch (e) {
      console.warn("⚠️ TEP systemdebug.getVersion failed: " + (e && e.code));
      return null;
    }
  }

  /**
   * startLogs(opts, cb)
   *
   * opts.serverUrl      REQUIRED — where the device uploads logs to.
   * opts.scriptUrl      where to fetch the ep_control script from.
   * opts.downloadScript default true.
   * opts.logDuration    default 1. NOTE: the deck shows the literal `1` with
   *                     no unit given — minutes vs hours is UNCONFIRMED.
   *                     Verify on hardware before exposing this to operators.
   *
   * cb(err) — err is null on success. Never throws.
   */
  function systemdebugStartLogs(opts, cb) {
    _probe();
    cb = cb || function () {};

    if (!_hasSysDebug) return cb(new Error("systemdebug unavailable"));

    opts = opts || {};
    if (!opts.serverUrl) return cb(new Error("serverUrl is required"));

    // Re-entry would leave the first capture orphaned with no handle to stop
    // it, so refuse rather than stack captures.
    if (_logsRunning) return cb(new Error("log capture already running"));

    var config = {
      serverUrl:      String(opts.serverUrl),
      downloadScript: (opts.downloadScript !== false),
      scriptUrl:      String(opts.scriptUrl || opts.serverUrl),
      logDuration:    Number(opts.logDuration || 1)
    };

    try {
      webapis.systemdebug.startDebugLogs(
        config,
        function () {
          _logsRunning = true;
          console.log("🩺 TEP debug log capture started →", config.serverUrl);
          cb(null);
        },
        function (error) {
          _logsRunning = false;
          console.warn("⚠️ TEP startDebugLogs error:", error && error.message);
          cb(error || new Error("startDebugLogs failed"));
        }
      );
    } catch (e) {
      _logsRunning = false;
      console.warn("⚠️ TEP startDebugLogs threw (" + (e && e.code) + ")");
      cb(e);
    }
  }

  /** stopLogs(cb) — cb(err). Safe to call when not running. */
  function systemdebugStopLogs(cb) {
    _probe();
    cb = cb || function () {};

    if (!_hasSysDebug) return cb(new Error("systemdebug unavailable"));

    try {
      webapis.systemdebug.stopDebugLogs(
        function () {
          _logsRunning = false;
          console.log("🩺 TEP debug log capture stopped");
          cb(null);
        },
        function (error) {
          // Leave _logsRunning alone: if stop failed the capture may well
          // still be running, and clearing the flag would let a second
          // start() stack on top of it.
          console.warn("⚠️ TEP stopDebugLogs error:", error && error.message);
          cb(error || new Error("stopDebugLogs failed"));
        }
      );
    } catch (e) {
      console.warn("⚠️ TEP stopDebugLogs threw (" + (e && e.code) + ")");
      cb(e);
    }
  }

  /* -------------------------------------------------------
     PUBLIC SURFACE
     ------------------------------------------------------- */

  return {
    probe: _probe,
    hasWebapis: function () { _probe(); return _hasWebapis; },
    unipicture: {
      supported: unipictureSupported,
      show:      unipictureShow,
      hide:      unipictureHide,
      isActive:  function () { return _uniActive; }
    },
    systemdebug: {
      supported:  systemdebugSupported,
      getVersion: systemdebugGetVersion,
      start:      systemdebugStartLogs,
      stop:       systemdebugStopLogs,
      isRunning:  function () { return _logsRunning; }
    }
  };

})();
