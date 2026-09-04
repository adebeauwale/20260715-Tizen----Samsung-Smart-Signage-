# VYPA Tizen Player (Samsung Smart Signage) - Architecture (Essential)

> **Read this first.** Fleet rules: `../vypa-docs/PLAYERS.md`.
> Cloud API: `../vypa-player - raspberry Pi/docs/API-CONTRACT.md`.

A **web app** - plain HTML/CSS/JS, no framework, no build step - packaged for
Samsung SSSP / Tizen as .wgt.

The Samsung Smart Signage player, migrated onto the **Tizen Enterprise Platform (TEP)** API surface. Forked from `C:\tizen-workspace\VYPA2` (v1.0.5) on 2026-07-15 as a **separate build target, not a replacement**.

## Shape

```
index.html
  |- js/app.js          bootstrap
  |- js/pairing.js      show the code, poll until claimed
  |- js/apiService.js   ALL cloud HTTP
  |- js/cacheService.js download + cache media locally
  |- js/storage.js      persistence (player_id, screen, playlist)
  |- js/playerInit.js   wire-up
  |- js/playerEngine.js the play loop
  |- js/scheduling.js   which item is active now
  |- js/proofOfPlay.js  playout evidence
  |- js/telemetry.js    heartbeat + device health
  |- js/screenPower.js  panel power control
  |- js/device.js       device identity
  |- js/tep.js     <- THE PLATFORM ADAPTER. Vendor APIs live here, only here
  |- js/ui.js  js/intro.js  js/state.js
```

Other files: `config.xml` (Tizen app manifest), `author.p12` (signing certificate), `SSSP/`, `tools/`, `celebration/`, `_pre_parity_backup/`

**`tep.js` is the seam.** Everything vendor-specific belongs in it. If a
vendor API call leaks into `playerEngine.js` or `apiService.js`, it will be
copied into the sibling players and break them.

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


## Rules for every player

1. **Offline-first.** Play from local cache. Losing the network must not blank
   a screen.
2. **No login on a device.** Pairing is the only enrolment path.
3. **Unknown item types are skipped, never fatal.** A content type added next
   year must not crash a panel shipped this year.
4. **Re-pair gracefully** if the screen is deleted or reassigned.
5. **Fail soft.** Broken media is skipped; the loop continues.
6. **The screen is someone's shopfront** - no dialogs, no cursor, no console.

