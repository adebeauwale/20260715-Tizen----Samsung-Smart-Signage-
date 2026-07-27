/* Harness for js/tep.js — verifies capability gating, call sequence,
   path-form retry, and teardown-on-failure without hardware. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TEP_SRC = fs.readFileSync(
  "E:/2026/vypa players/20260715 Tizen - (Samsung Smart Signage)/js/tep.js", "utf8");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else      { fail++; console.log("  FAIL  " + name); }
}

// Build a sandbox with an optional fake webapis; records the call sequence.
function makeCtx(webapis, flags) {
  const calls = [];
  const bodyClasses = new Set();
  const ctx = {
    console: { log(){}, warn(){} },
    document: { body: { classList: {
      add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c) } } },
    calls, bodyClasses,
  };
  ctx.window = ctx;
  Object.assign(ctx, flags || {});
  if (webapis) ctx.webapis = webapis(calls);
  vm.createContext(ctx);
  vm.runInContext(TEP_SRC, ctx);
  return ctx;
}

// A fully working unipicture stub.
const goodUni = (calls) => ({
  unipicture: {
    setScalerType: t => calls.push("setScalerType:" + t),
    create:        () => calls.push("create"),
    load:          p => calls.push("load:" + p),
    setDisplayRect:(x,y,w,h) => calls.push(`setDisplayRect:${x},${y},${w},${h}`),
    setCropRect:   () => calls.push("setCropRect"),
    rotate:        r => calls.push("rotate:" + r),
    show:          () => calls.push("show"),
    close:         () => calls.push("close"),
    destroy:       () => calls.push("destroy"),
    getState:      () => "SHOWN",
  }
});

console.log("\n1. No webapis at all (old panel / desktop browser)");
{
  const c = makeCtx(null, { VYPA_TEP_UNIPICTURE: true, innerWidth:1920, innerHeight:1080 });
  check("hasWebapis() false", c.TEP.hasWebapis() === false);
  check("unipicture.supported() false", c.TEP.unipicture.supported() === false);
  check("show() returns false -> caller falls back to <img>",
        c.TEP.unipicture.show("file:///a/b.jpg") === false);
  check("hide() does not throw", (() => { try { c.TEP.unipicture.hide(); return true; } catch(e){ return false; } })());
}

console.log("\n2. webapis present but opt-in flag OFF (production default)");
{
  const c = makeCtx(goodUni, { VYPA_TEP_UNIPICTURE: false, innerWidth:1920, innerHeight:1080 });
  check("supported() true (API is there)", c.TEP.unipicture.supported() === true);
  check("show() still false — flag gates it", c.TEP.unipicture.show("file:///a/b.jpg") === false);
  check("no scaler calls were made", c.calls.length === 0);
}

console.log("\n3. Flag ON, local file -> full documented sequence");
{
  const c = makeCtx(goodUni, { VYPA_TEP_UNIPICTURE: true, innerWidth:1920, innerHeight:1080 });
  const ok = c.TEP.unipicture.show("file:///opt/usr/home/owner/media/Documents/vypa_cache/image_1.jpg");
  check("show() returns true", ok === true);
  // First image must not emit a destroy() for a handle that never existed.
  check("sequence: setScalerType -> create -> load -> setDisplayRect -> show",
    c.calls.join("|") === [
      "setScalerType:MAIN", "create",
      "load:file:///opt/usr/home/owner/media/Documents/vypa_cache/image_1.jpg",
      "setDisplayRect:0,0,1920,1080", "show"
    ].join("|"));
  check("no rotate when rotation = 0", !c.calls.some(x => x.startsWith("rotate")));
  check("isActive() true", c.TEP.unipicture.isActive() === true);
  check("page made transparent", c.bodyClasses.has("tep-uni-active"));
  c.calls.length = 0;
  c.TEP.unipicture.hide();
  check("hide() closes AND destroys", c.calls.join("|") === "close|destroy");
  check("transparency reverted", !c.bodyClasses.has("tep-uni-active"));
  check("isActive() false after hide", c.TEP.unipicture.isActive() === false);
}

console.log("\n4. Remote https URL -> refused (no local file for the scaler)");
{
  const c = makeCtx(goodUni, { VYPA_TEP_UNIPICTURE: true, innerWidth:1920, innerHeight:1080 });
  check("show() false for https://", c.TEP.unipicture.show("https://cdn.vypa.co/x.jpg") === false);
  check("no scaler calls made", c.calls.length === 0);
}

console.log("\n5. Portrait rotation honoured");
{
  const c = makeCtx(goodUni, { VYPA_TEP_UNIPICTURE: true, VYPA_TEP_ROTATION: 270, innerWidth:1080, innerHeight:1920 });
  c.TEP.unipicture.show("file:///a/b.jpg");
  check("rotate:270 issued before show", c.calls.indexOf("rotate:270") >= 0 &&
        c.calls.indexOf("rotate:270") < c.calls.indexOf("show"));
  check("displayRect uses portrait dims", c.calls.includes("setDisplayRect:0,0,1080,1920"));
}

console.log("\n6. load() rejects file:// URI -> retries raw path");
{
  const uriHostile = (calls) => {
    const u = goodUni(calls);
    u.unipicture.load = (p) => {
      calls.push("load:" + p);
      if (/^file:\/\//.test(p)) { const e = new Error("bad path"); e.code = 1; e.name = "InvalidValuesError"; throw e; }
    };
    return u;
  };
  const c = makeCtx(uriHostile, { VYPA_TEP_UNIPICTURE: true, innerWidth:1920, innerHeight:1080 });
  const ok = c.TEP.unipicture.show("file:///opt/usr/x.jpg");
  check("show() still succeeds via raw-path retry", ok === true);
  check("tried URI form first", c.calls.includes("load:file:///opt/usr/x.jpg"));
  check("then retried raw form", c.calls.includes("load:/opt/usr/x.jpg"));
}

console.log("\n7. show() throws midway -> teardown, no handle leak, returns false");
{
  const showHostile = (calls) => {
    const u = goodUni(calls);
    u.unipicture.show = () => { calls.push("show"); const e = new Error("scaler busy"); e.code = 2; e.name = "UnknownError"; throw e; };
    return u;
  };
  const c = makeCtx(showHostile, { VYPA_TEP_UNIPICTURE: true, innerWidth:1920, innerHeight:1080 });
  const ok = c.TEP.unipicture.show("file:///a/b.jpg");
  check("show() returns false -> <img> fallback", ok === false);
  check("destroy() called to release the created handle", c.calls.includes("destroy"));
  check("page not left transparent", !c.bodyClasses.has("tep-uni-active"));
  check("isActive() false", c.TEP.unipicture.isActive() === false);
}

console.log("\n8. Partial API surface (older firmware) -> refused");
{
  const partial = () => ({ unipicture: { create: ()=>{}, show: ()=>{} } }); // missing load/setScalerType/etc
  const c = makeCtx(partial, { VYPA_TEP_UNIPICTURE: true, innerWidth:1920, innerHeight:1080 });
  check("supported() false on incomplete surface", c.TEP.unipicture.supported() === false);
  check("show() false", c.TEP.unipicture.show("file:///a/b.jpg") === false);
}

/* ---------------- SystemDebug ---------------- */

// Working systemdebug stub. `mode` drives the failure injection.
const sysDebug = (mode) => (calls) => ({
  systemdebug: {
    getVersion: () => { calls.push("getVersion"); if (mode === "verThrow") { const e=new Error("x"); e.code=9; throw e; } return "1.2.3"; },
    startDebugLogs: (cfg, ok, err) => {
      calls.push("start:" + JSON.stringify(cfg));
      if (mode === "startErr")   return err({ message: "server unreachable" });
      if (mode === "startThrow") { const e = new Error("boom"); e.code = 7; throw e; }
      ok();
    },
    stopDebugLogs: (ok, err) => {
      calls.push("stop");
      if (mode === "stopErr") return err({ message: "not running" });
      ok();
    },
  }
});

console.log("\n9. SystemDebug unavailable (old panel)");
{
  const c = makeCtx(null, {});
  check("supported() false", c.TEP.systemdebug.supported() === false);
  check("getVersion() null", c.TEP.systemdebug.getVersion() === null);
  let e1; c.TEP.systemdebug.start({ serverUrl: "http://s/" }, e => e1 = e);
  check("start() reports unsupported", !!e1 && /unavailable/.test(e1.message));
  let e2; c.TEP.systemdebug.stop(e => e2 = e);
  check("stop() reports unsupported", !!e2 && /unavailable/.test(e2.message));
}

console.log("\n10. SystemDebug happy path");
{
  const c = makeCtx(sysDebug("ok"), {});
  check("supported() true", c.TEP.systemdebug.supported() === true);
  check("getVersion() passes through", c.TEP.systemdebug.getVersion() === "1.2.3");
  check("isRunning() false before start", c.TEP.systemdebug.isRunning() === false);

  let err = "unset";
  c.TEP.systemdebug.start({ serverUrl: "http://logs.vypa.co:8080/", logDuration: "5" }, e => err = e);
  check("start() succeeds (err null)", err === null);
  check("isRunning() true after start", c.TEP.systemdebug.isRunning() === true);

  const cfg = JSON.parse(c.calls.find(x => x.startsWith("start:")).slice(6));
  check("serverUrl passed through", cfg.serverUrl === "http://logs.vypa.co:8080/");
  check("logDuration coerced to Number", cfg.logDuration === 5);
  check("downloadScript defaults true", cfg.downloadScript === true);
  check("scriptUrl defaults to serverUrl", cfg.scriptUrl === "http://logs.vypa.co:8080/");

  let err2 = "unset";
  c.TEP.systemdebug.stop(e => err2 = e);
  check("stop() succeeds", err2 === null);
  check("isRunning() false after stop", c.TEP.systemdebug.isRunning() === false);
}

console.log("\n11. SystemDebug guards");
{
  const c = makeCtx(sysDebug("ok"), {});
  let e; c.TEP.systemdebug.start({}, x => e = x);
  check("start() without serverUrl refused", !!e && /serverUrl is required/.test(e.message));
  check("no API call made", !c.calls.some(x => x.startsWith("start:")));

  c.TEP.systemdebug.start({ serverUrl: "http://s/" }, () => {});
  let e2; c.TEP.systemdebug.start({ serverUrl: "http://s/" }, x => e2 = x);
  check("second concurrent start refused", !!e2 && /already running/.test(e2.message));
  check("downloadScript:false honoured", (() => {
    const c2 = makeCtx(sysDebug("ok"), {});
    c2.TEP.systemdebug.start({ serverUrl: "http://s/", downloadScript: false }, () => {});
    return JSON.parse(c2.calls.find(x => x.startsWith("start:")).slice(6)).downloadScript === false;
  })());
}

console.log("\n12. SystemDebug failure paths");
{
  const c = makeCtx(sysDebug("startErr"), {});
  let e; c.TEP.systemdebug.start({ serverUrl: "http://s/" }, x => e = x);
  check("start() error callback surfaces err", !!e);
  check("isRunning() false after failed start", c.TEP.systemdebug.isRunning() === false);

  const c2 = makeCtx(sysDebug("startThrow"), {});
  let e2; c2.TEP.systemdebug.start({ serverUrl: "http://s/" }, x => e2 = x);
  check("start() synchronous throw is caught, not propagated", !!e2);
  check("isRunning() false after throw", c2.TEP.systemdebug.isRunning() === false);

  // A failed stop must NOT clear the flag: the capture may still be live, and
  // clearing it would let a second start() stack on top.
  const c3 = makeCtx(sysDebug("ok"), {});
  c3.TEP.systemdebug.start({ serverUrl: "http://s/" }, () => {});
  c3.webapis.systemdebug.stopDebugLogs = (ok, err) => err({ message: "nope" });
  let e3; c3.TEP.systemdebug.stop(x => e3 = x);
  check("stop() error surfaces", !!e3);
  check("isRunning() stays true after failed stop", c3.TEP.systemdebug.isRunning() === true);

  const c4 = makeCtx(sysDebug("verThrow"), {});
  check("getVersion() throw returns null", c4.TEP.systemdebug.getVersion() === null);
}

console.log("\n13. Unipicture and SystemDebug probe independently");
{
  // A panel with systemdebug but no unipicture (or vice versa) must not have
  // one capability's absence disable the other.
  const mixed = (calls) => Object.assign({}, sysDebug("ok")(calls));  // no unipicture key
  const c = makeCtx(mixed, { VYPA_TEP_UNIPICTURE: true, innerWidth: 1920, innerHeight: 1080 });
  check("unipicture unsupported", c.TEP.unipicture.supported() === false);
  check("systemdebug still supported", c.TEP.systemdebug.supported() === true);
  check("unipicture.show() false, no throw", c.TEP.unipicture.show("file:///a.jpg") === false);
}

console.log("\n===== " + pass + " passed, " + fail + " failed =====");
process.exit(fail ? 1 : 0);
