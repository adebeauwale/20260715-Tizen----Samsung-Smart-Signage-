# VYPA Tizen Player (Samsung Smart Signage) - Architecture

> One screen: `ARCHITECTURE.essential.md`. Fleet: `../vypa-docs/PLAYERS.md`.

Last verified: 2026-09-04.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Language | Plain JavaScript (ES5/ES6), HTML, CSS |
| Framework | **None.** No build step, no bundler, no npm runtime deps |
| Platform | Samsung SSSP / Tizen |
| Package | .wgt |
| Adapter | `js/tep.js` |

No framework is the right call for TV panels: firmware JS engines vary wildly,
and a build step is one more thing that can silently produce something the panel
cannot parse.

## 2. What this player is

The Samsung Smart Signage player, migrated onto the **Tizen Enterprise Platform (TEP)** API surface. Forked from `C:\tizen-workspace\VYPA2` (v1.0.5) on 2026-07-15 as a **separate build target, not a replacement**.

Currently v1.2.0, explicitly tracking **feature parity with the Android CUSTOMIZABLE player**. Parity work is additive and degrades gracefully: a panel or playlist that does not use a new feature plays exactly as before.

It stays a Tizen **Web** app (HTML/CSS/JS) rather than Tizen .NET/NUI - a rewrite would fork the surface it shares with webOS and VIDAA for no functional gain.

## 3. Modules (`js/`)

| File | Responsibility |
|---|---|
| `app.js` | Bootstrap and top-level wiring |
| `pairing.js` | Show the pairing code; poll until an operator claims it |
| `apiService.js` | **All** cloud HTTP. Nothing else talks to VYPA |
| `cacheService.js` | Download and cache media locally |
| `storage.js` | Persistence - `player_id`, screen, playlist |
| `playerInit.js` | Startup wiring once paired |
| `playerEngine.js` | The play loop - sequencing, timing, transitions |
| `scheduling.js` | Which playlist item is active now |
| `proofOfPlay.js` | Playout evidence back to `advertise.vypa.co` |
| `telemetry.js` | Heartbeat and device health |
| `screenPower.js` | Panel power control |
| `device.js` | Device identity |
| `ui.js`, `intro.js`, `state.js` | Rendering, splash, shared state |
| **`tep.js`** | **The platform adapter - vendor APIs live here and only here** |

## 4. The adapter seam

`tep.js` exists so the other twelve modules stay platform-neutral. Vendor
storage quotas, power APIs, device identifiers and packaging quirks belong
behind it.

When vendor code leaks out of the adapter it does not just make this player
messier - it makes the *other* players wrong, because these three codebases are
copied between each other by hand.

## The three web-TV players are NOT one codebase

The Tizen README says the code is "shared byte-for-byte with the webOS and VIDAA
players". **That is no longer true** (measured 2026-09-04) and acting on it will
cost you a broken panel.

| `js/` file | Tizen | webOS | VIDAA | Reality |
|---|---|---|---|---|
| `intro.js` `scheduling.js` `screenPower.js` `state.js` `ui.js` | - | - | - | **identical in all three** |
| `app.js` `cacheService.js` `pairing.js` `telemetry.js` | diverged | = | = | webOS and VIDAA identical; **Tizen differs** |
| `apiService.js` `device.js` `playerEngine.js` `playerInit.js` `storage.js` | diff | diff | diff | **all three differ** |
| `proofOfPlay.js` | = webOS | = Tizen | diff | VIDAA differs |
| `tep.js` / `webos.js` / `vidaa.js` | Tizen only | webOS only | VIDAA only | platform adapter |
| `main.js` | Tizen only | - | - | Tizen only |

Rough scale of the drift, in changed lines:

```
                Tizen~webOS   webOS~VIDAA
cacheService.js     782            0      <- Tizen nearly rewrote it (502 vs 279 lines)
storage.js          514           45
telemetry.js        425            0
app.js              361            0
playerEngine.js     156           76
playerInit.js        35          143      <- VIDAA is the odd one here
device.js           101           12
```

**What this means in practice**

- **webOS and VIDAA are near-twins.** A fix in one very likely applies to the
  other, but still has to be copied by hand. Nothing propagates automatically.
- **Tizen is a substantially diverged fork.** The TEP migration rewrote caching,
  storage and telemetry. Do not assume a Tizen fix drops into the others, or
  the reverse.
- **A bug fixed in one player is still broken in the other two** until someone
  ports it. When you fix something in shared-looking code, say explicitly
  whether you ported it, and to which players.


## Cloud API

Authoritative spec: `../vypa-player - raspberry Pi/docs/API-CONTRACT.md`.

| Purpose | Base |
|---|---|
| Pairing | `https://app.vypa.co/screens` |
| Player + heartbeat - signage | `https://app.vypa.co/screens` |
| Player + heartbeat - host | `https://host.vypa.co/screens` |
| Proof-of-play + screenshots | `https://advertise.vypa.co` |

The player/heartbeat base switches to **host** when `screen.category == "host"`.

```
POST /api_create_pair            {player_id} -> {pairing_code, pairing_url, expires_in}
GET  /api_check_pairing_status   ?code=...   -> {status, screen_id, user_id}
GET  /player/{screen_id}?format=json         -> playlist + FRESH JWT + Pusher creds
     heartbeat / proof-of-play               -> Authorization: Bearer <jwt>
```

**The JWT is short-lived and has no refresh endpoint** - on `401`, re-fetch
`/player/{id}`. Nine player clients share this contract and none update on
demand: **add fields, never rename or remove.**


## 5. Known weaknesses

1. **The README's "byte-for-byte" claim is stale** and actively misleading. The
   table above is the measured truth.
2. **Three near-copies, no shared module.** Every fix must be ported by hand, and
   nothing enforces that it was.
3. **No tests.** Verification is on a panel.
4. **No build step** means no lint, no minification, no compatibility check - a
   syntax error a panel's JS engine dislikes surfaces as a black screen in a
   venue.
