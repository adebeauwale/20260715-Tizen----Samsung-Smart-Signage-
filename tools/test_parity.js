/* ==========================================================================
   VYPA Tizen — Android-parity off-device tests
   ==========================================================================
   Exercises the pure decision logic added for Android feature parity:

     • celebration media extraction / cache-filename / payload localisation
       (cacheService.js)   — mirrors Android celebrationMediaUrls +
       localizeCelebrationMedia
     • celebration URL building + app embed building (playerEngine.js)
       — mirrors Android AppPlayer / YouTubePlayer + the baked celebration
       asset path

   It loads the ACTUAL project files in a jsdom-free sandbox (Node `vm`), so it
   tests the shipped functions, not re-implementations. No hardware or browser
   needed:  node tools/test_parity.js
   ========================================================================== */

const fs   = require("fs");
const path = require("path");
const vm   = require("vm");

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else      { failed++; console.log("  FAIL  " + name); }
}
function eq(name, got, want) {
  const c = JSON.stringify(got) === JSON.stringify(want);
  if (!c) console.log("        got=" + JSON.stringify(got) + " want=" + JSON.stringify(want));
  ok(name, c);
}

// ---- Sandbox: load the real files with browser globals stubbed out ----------
const root = path.join(__dirname, "..");
const sandbox = {
  console,
  JSON, Math, String, Number, Array, Object, Date,
  encodeURIComponent, decodeURIComponent,
  window: {},           // referenced only inside runtime play* fns, never here
  document: {},         // idem
  setTimeout: () => 0,
  clearTimeout: () => {}
};
vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.join(root, rel), "utf8");
  vm.runInContext(code, sandbox, { filename: rel });
}
load("js/cacheService.js");
load("js/playerEngine.js");

const S = sandbox;

console.log("\n1. celebrationMediaUrls — extract remote frame media");
eq("src + ballerLogo (http) collected",
   S.celebrationMediaUrls({ celebration: { data: {
     src: "https://cdn.vypa.co/a/frame.mp4",
     ballerLogo: "https://cdn.vypa.co/a/logo.png" } } }),
   ["https://cdn.vypa.co/a/frame.mp4", "https://cdn.vypa.co/a/logo.png"]);
eq("string payload parsed",
   S.celebrationMediaUrls({ celebration: JSON.stringify({ data: { src: "https://x/y.mp4" } }) }),
   ["https://x/y.mp4"]);
eq("non-http values skipped",
   S.celebrationMediaUrls({ celebration: { data: { src: "file:///local.mp4", ballerLogo: "" } } }),
   []);
eq("no celebration → []", S.celebrationMediaUrls({}), []);
eq("malformed json → []", S.celebrationMediaUrls({ celebration: "{not json" }), []);

console.log("\n2. celebrationCacheFilename — stable, fs-safe");
eq("last segment, celeb_ prefix",
   S.celebrationCacheFilename("https://cdn.vypa.co/a/b/Frame Video.mp4?sig=xyz"),
   "celeb_Frame_Video.mp4");

console.log("\n3. localizeCelebration — rewrite media to cached file URIs");
const item = {
  celebration: { kind: "baller", data: {
    name: "ACE", src: "https://cdn/frame.mp4", ballerLogo: "https://cdn/logo.png" } },
  celebrationMediaMap: {
    "https://cdn/frame.mp4": "file:///opt/media/celeb_frame.mp4",
    "https://cdn/logo.png":  "file:///opt/media/celeb_logo.png"
  }
};
const loc = S.localizeCelebration(item);
eq("src localised",        loc.data.src,        "file:///opt/media/celeb_frame.mp4");
eq("ballerLogo localised", loc.data.ballerLogo, "file:///opt/media/celeb_logo.png");
eq("name preserved",       loc.data.name,       "ACE");
eq("kind preserved",       loc.kind,            "baller");
ok("original item.celebration NOT mutated (deep copy)",
   item.celebration.data.src === "https://cdn/frame.mp4");
eq("uncached url falls back to original",
   S.localizeCelebration({ celebration: { data: { src: "https://cdn/x.mp4" } } }).data.src,
   "https://cdn/x.mp4");
ok("no celebration → null", S.localizeCelebration({}) === null);

console.log("\n4. buildCelebrationUrl — baked asset + hash payload");
const cu = S.buildCelebrationUrl(item);
ok("points at packaged asset", cu.indexOf("celebration/celebration.html#") === 0);
const decoded = JSON.parse(decodeURIComponent(cu.split("#")[1]));
eq("payload carries localised media", decoded.data.src, "file:///opt/media/celeb_frame.mp4");
ok("no celebration → null", S.buildCelebrationUrl({}) === null);

console.log("\n5. _youtubeIdFromUrl — every common form");
eq("watch?v=",  S._youtubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
eq("youtu.be/", S._youtubeIdFromUrl("https://youtu.be/dQw4w9WgXcQ"),                "dQw4w9WgXcQ");
eq("/embed/",   S._youtubeIdFromUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"),   "dQw4w9WgXcQ");
eq("/shorts/",  S._youtubeIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"),  "dQw4w9WgXcQ");
eq("no id → ''", S._youtubeIdFromUrl("https://vypa.co"), "");

console.log("\n6. buildAppEmbedUrl — youtube / slides / webpage");
const yt = S.buildAppEmbedUrl({ app_type: "youtube", config: { video_id: "abc123" } });
ok("youtube embed host",  yt.indexOf("https://www.youtube.com/embed/abc123") === 0);
ok("youtube autoplay",    yt.indexOf("autoplay=1") !== -1);
ok("youtube muted",       yt.indexOf("mute=1") !== -1);
ok("youtube looped",      yt.indexOf("loop=1") !== -1 && yt.indexOf("playlist=abc123") !== -1);
eq("youtube id parsed from config.url",
   S.buildAppEmbedUrl({ app_type: "youtube", config: { url: "https://youtu.be/xy_Z12" } })
     .indexOf("embed/xy_Z12") !== -1, true);
eq("google_slides uses embed_url",
   S.buildAppEmbedUrl({ app_type: "google_slides", config: { embed_url: "https://docs.google.com/x/embed" } }),
   "https://docs.google.com/x/embed");
eq("config as JSON string parsed",
   S.buildAppEmbedUrl({ app_type: "webpage", config: '{"url":"https://vypa.co"}' }),
   "https://vypa.co");
ok("youtube with no id → null",
   S.buildAppEmbedUrl({ app_type: "youtube", config: {} }) === null);

console.log("\n===== " + passed + " passed, " + failed + " failed =====");
process.exit(failed ? 1 : 0);
