# VYPA Tizen Player — TEP Build (Samsung Smart Signage)

Samsung SSSP / Tizen player for VYPA, migrated onto the **Tizen Enterprise
Platform (TEP)** API surface.

Forked from `C:\tizen-workspace\VYPA2` (v1.0.5, built 2026-06-26) on 2026-07-15.
This is a **separate build target**, not a replacement — see *Which panels* below.

---

## 🚨 Signing key exposure (found 2026-07-15 — needs action)

**The published VYPA Tizen package contains the code-signing private key.**

`SSSP/VYPA.wgt` — the package `sssp_config.xml` points URL Launcher at, served
from `https://packages.vypa.co/downloads/tizen/SSSP/VYPA.wgt` — contains:

| Entry | Size | What it is |
|---|---|---|
| `author.p12` | 4,305 B | PKCS#12 **private signing key** (verified: real DER keystore) |
| `author.pwd` | 234 B | its password |
| `SSSP/VYPA.wgt` | 19.8 MB | a nested copy of the package inside itself |

That URL returns **HTTP 200 with no authentication** (verified 2026-07-15).
URL Launcher fetches it unauthenticated by design, so it cannot be ACL'd.
The same two files are also inside `VYPA2.wgt`.

**Impact:** anyone who fetched that URL has VYPA's Tizen author certificate and
its password, and can sign packages as "VYPA Technologies Inc.".

**Suggested remediation** (not done here — needs your decision):
1. Treat the current author certificate as compromised. Revoke and reissue via
   the Samsung Developer account.
2. Rebuild every published package with `tools/build.bat` (excludes key material
   and fails the build if it reappears).
3. Replace the package on packages.vypa.co and update `<size>` in
   `sssp_config.xml`.
4. Audit anything else served from that host for the same pattern.

This fork does **not** contain `author.p12`/`author.pwd` — signing reads from the
Tizen Studio profile at `C:\Users\adebo\SamsungCertificate\VYPA2-CERT\`, so the
copies in the project directory were never needed for signing, only ballast in
the package. They are `.gitignore`d and excluded from the build.

Side benefit of dropping the nested `.wgt` and the backup folder: **28.4 MB → 4.7 MB**.

---

## Why this fork exists

Per *Tizen Partner Summit 2025 — "Why TEP"*: **B2B API support is not guaranteed
in upcoming Tizen OS versions.** TEP is the supported successor, and it is first
to receive bug fixes, performance improvements, and new features.

VYPA2 targets `required_version="2.3"` and declares only the legacy B2B
privileges — i.e. the deprecated path. This build moves to the TEP surface.

## What changed vs. VYPA2

| File | Change |
|---|---|
| `config.xml` | `required_version` **2.3 → 6.5**; added `systemcontrol` privilege; version 1.0.5 → 1.1.0 |
| `index.html` | Loads `$WEBAPIS/webapis/webapis.js`; loads `js/tep.js`; adds `VYPA_TEP_*` build flags |
| `js/tep.js` | **New.** Capability probe + Unipicture + SystemDebug adapters |
| `js/playerEngine.js` | `playImage()` tries Unipicture first, falls back to `<img>`; `_hideAllLayers()` releases the handle |
| `js/apiService.js` | `collect-logs` / `stop-logs` Pusher bindings on the screen channel |
| `css/style.css` | `.tep-uni-active` transparency rule |
| `.project` | Workspace name `VYPA2` → `VYPA_TEP` (avoids a Tizen Studio collision) |
| `.gitignore` | **New.** Blocks key material and build output |
| `tools/build.bat` | **New.** CLI build+sign+audit, no IDE needed |
| `tools/verify_wgt.py` | **New.** Fails a package that contains key material |
| `tools/test_tep.js` | **New.** Off-device test harness (57 checks) |

Everything else — pairing, scheduling, proof-of-play, telemetry, caching — is
byte-identical to VYPA2. **The 15-second media duration policy is untouched.**

### Side effect: telemetry CPU temperature now works

`js/telemetry.js:101` already called `webapis.systeminfo.getCpuTemperature()`,
but `webapis.js` was never loaded in VYPA2, so `typeof webapis` was always
`undefined` and the branch was dead code that silently fell through. Loading the
library activates it. Worth confirming the values that now arrive server-side.

## Which panels

`required_version="6.5"` means this package **will not install on SSSP 6–9
(Tizen 4.0–6.0)** panels. Keep VYPA2 deployed for those; ship this to SSSP 10 /
Tizen 6.5+ only.

The app ID is deliberately unchanged (`bxyoUHWibT.VYPA2`), so on a 6.5 panel this
**upgrades in place** rather than installing alongside. If you want both on one
panel for A/B testing, change the ID first.

| SSSP | Tizen | This build |
|---|---|---|
| 6–9 | 4.0–6.0 | ✗ won't install — use VYPA2 |
| 10 | 6.5 | ✓ |

## Prerequisites (blocking)

1. **Samsung Partner-level certificate.** Only verified developers with a Samsung
   account can obtain one. Every API call is tied to the signed application, and
   a package *without* the partner certificate **cannot execute TEP functions** —
   platform-enforced. The bundled `author.p12` is **not** sufficient.
2. **Firmware** ≥ `S-PTMLWWC-1060.9` (Aug 1 2024) for Unipicture.
   (`S-PTMLWWC-1080.7`, Jan 7 2025, gates Node.js / SystemDebug / 4FHD /
   transparency — not used here yet.)

Until (1) is in place this build runs correctly but takes the fallback path on
every image, behaving exactly like VYPA2.

## Build flags (`index.html`)

```js
window.VYPA_TEP_ROTATION  = 0;      // 0 landscape | 270 portrait
window.VYPA_TEP_UNIPICTURE = true;  // NOT SET BY DEFAULT — see below
```

`VYPA_TEP_UNIPICTURE` is **absent (off) by default**, so out of the box this
build renders images exactly as VYPA2 does. Enable it only on a test panel, for
the reason below.

## ⚠️ Must verify on hardware before enabling Unipicture

**The scaler plane may composite *behind* the web layer.** Unipicture renders
through the SoC scaler, as AVPlay video does. `html, body` and `#playerScreen`
are opaque black. If the plane is underneath, the image is **invisible while
`show()` still reports success** — a silent black screen that no error path
catches.

`js/tep.js` hedges by adding `body.tep-uni-active` (background → transparent)
while an image is up, which is harmless if the plane composites above. **This is
untested against real hardware.** Verify on one panel before any fleet rollout:

1. Sign with the Partner cert, install on a 6.5 panel.
2. Set `window.VYPA_TEP_UNIPICTURE = true`.
3. Play an image playlist. **Look at the screen** — `show()` returning true is
   not evidence the image is visible.
4. Check the Remote Web Inspector console for the `📌 TEP unipicture.load()
   accepted the '<form>' path form` line (see next section).

If images are black, the plane is behind the web layer and the transparency rule
needs more than a background swap — do not ship until resolved.

### Open question: `load()` path form

The 2025 deck documents the call as `load(filePath)` but tables it as *"Load
Content URL"*. Those disagree, and it can't be settled without a device.
`cacheService.js` produces `file:///…` URIs via `File.toURI()`.

`tep.js` therefore tries the URI as-is, then retries with `file://` stripped to a
raw path, and logs which form won — once. After the first on-device run, pin the
winner in `_toRawPath()` and drop the retry.

## Remote log capture (TEP SystemDebug)

Unlike Unipicture, SystemDebug needs only a **Public-level certificate** and
`http://tizen.org/privilege/filesystem.read` (already declared) — so it is *not*
blocked on the Partner cert. It does still need `required_version` 6.5 and
firmware ≥ `S-PTMLWWC-1080.7` (Jan 7 2025).

The panel collects ep_control logs and uploads them straight to `server_url`;
nothing returns through JS, so "success" only means *capture started*.

Triggered by a Pusher event on the existing `screen-<id>` channel, alongside
`reboot` / `take-screenshot`:

```jsonc
// event: "collect-logs"
{
  "server_url":  "http://logs.vypa.co:8080/",  // REQUIRED — never guessed
  "script_url":  "http://logs.vypa.co:8081/",  // optional, defaults to server_url
  "log_duration": 1,                            // optional, default 1
  "download_script": true                       // optional, default true
}
// event: "stop-logs"  — no payload
```

**Backend work still required.** `app.vypa.co` does not emit `collect-logs` /
`stop-logs` yet, so the bindings are inert until it does. You also need
something listening on `server_url` to receive uploads. Both live in
`vypasignage-backend`, untouched by this fork.

**Unconfirmed:** `logDuration`'s unit. The deck shows the literal `1` with no
unit — minutes vs hours is a guess. Confirm on hardware before exposing it to
operators.

## Development workflow — VS Code *and* Tizen Studio

**All source editing happens in VS Code.** The project is plain HTML/CSS/JS with
no IDE-specific source format; `.project`/`.tproject`/`.settings` are only
Eclipse metadata so Tizen Studio *can* open it.

Tizen Studio is still needed for things VS Code can't do — but mostly via its
CLI, which `tools/build.bat` drives for you:

| Task | Tool |
|---|---|
| Edit source | **VS Code** |
| Run adapter tests | **VS Code** — `node tools/test_tep.js` |
| Build + sign `.wgt` | `tools/build.bat` (Tizen CLI, no IDE window) |
| Audit a package | `python tools/verify_wgt.py <file>.wgt` |
| Create/renew certificates | **Tizen Studio** → Certificate Manager (GUI only) |
| Install to a panel | `sdb install` (`C:\tizen-studio\tools\sdb.exe`) |
| Live debugging | **Tizen Studio** → Remote Web Inspector |

So: write code in VS Code, build from the terminal, and open Tizen Studio only
for certificates and on-device debugging.

### Building

```bat
tools\build.bat                REM signs with VYPA2-CERT (default)
tools\build.bat BeauldComm-QM75B
```

Verified working: Tizen CLI 2.5.25, output `.buildResult\VYPA Digital Signage
Player.wgt` (4.7 MB). The build **fails closed** if key material reaches the
package.

Signing profiles live in `C:\tizen-studio-data\profile\profiles.xml`; the certs
themselves in `C:\Users\adebo\SamsungCertificate\<profile>\`. List them with:

```bat
C:\tizen-studio\tools\ide\bin\tizen.bat security-profiles list
```

## Testing

```bash
node tools/test_tep.js   # 57 checks, no hardware needed
```

Covers capability gating, the documented Unipicture call sequence, the path-form
retry, portrait rotation, handle teardown on failure, refusal on partial API
surfaces, and SystemDebug's async success/error/throw paths, guards and flag
handling. It mocks `webapis`, so it proves the **decision logic**, not that the
scaler or the log upload work — only a panel can prove that.

The emulator won't help: per the SSSP WebAssembly deck, anything beyond trivial
apps needs a real device. Use Tizen Studio's Remote Web Inspector.

## Deployment note carried over from VYPA2

`SSSP/sssp_config.xml` is the URL Launcher manifest. In VYPA2 it points at
`VYPA.wgt` with `<size>24799573</size>` — the **April 20** build, not the June 26
`VYPA2.wgt` (29,788,964 bytes). URL Launcher uses `<size>` to detect updates.
Confirm which build should actually be served before reusing this manifest; the
copy here still carries the inherited values.

`SSSP/` is excluded from the package by `tools/build.bat` — the manifest belongs
next to the `.wgt` on the server, never inside it. (Shipping it inside is how
VYPA2 ended up nesting a 19.8 MB copy of itself.)

## Not implemented (deliberate)

- **4FHD / transparency** — needs firmware `S-PTMLWWC-1080.7`; only useful for
  multi-zone layouts. Transparent video must be VP8 FHD@30fps over a ~60fps
  background.
- **Node.js, CustomAppInfo, USB Serial** — no current VYPA use case.
- **WebAssembly** — per its own deck, the wins are C++ integration, ultra-low-
  latency game streaming, and OpenGL. VYPA is a JS playlist engine; the toolchain
  cost buys nothing. (If revisited: needs Samsung's Emscripten bundle and
  `emsdk activate latest-fastcomp` — *not* the official `emsdk install latest`,
  which doesn't support Tizen.)
