# CLAUDE.md - VYPA Tizen Player (Samsung Smart Signage)

Project memory. How to plan/code/test is in `AGENTS.md`.

---

## What this is

The Samsung Smart Signage player, migrated onto the **Tizen Enterprise Platform (TEP)** API surface. Forked from `C:\tizen-workspace\VYPA2` (v1.0.5) on 2026-07-15 as a **separate build target, not a replacement**.

Plain HTML/CSS/JS. **No framework, no build step, no bundler.** Packaged for
Samsung SSSP / Tizen as .wgt.

Currently v1.2.0, explicitly tracking **feature parity with the Android CUSTOMIZABLE player**. Parity work is additive and degrades gracefully: a panel or playlist that does not use a new feature plays exactly as before.

It stays a Tizen **Web** app (HTML/CSS/JS) rather than Tizen .NET/NUI - a rewrite would fork the surface it shares with webOS and VIDAA for no functional gain.

## Documents

| File | When |
|---|---|
| `ARCHITECTURE.essential.md` | **First.** Shape, adapter seam, divergence |
| `ARCHITECTURE.md` | Module-by-module detail |
| `DATA-MODEL.md` | Stored keys, cache, API surface |
| `PRD.md` | What this player is for |
| `AGENTS.md` | How to work here |
| `../vypa-docs/PLAYERS.md` | Rules shared by all nine players |
| `../vypa-player - raspberry Pi/docs/API-CONTRACT.md` | **The cloud API** |

## The adapter seam

**`js/tep.js` is where every vendor API call belongs, and the only place.**
The other modules stay platform-neutral so they can be shared with the sibling
players. A vendor call that leaks into `playerEngine.js` or `apiService.js` will
be copied into webOS/VIDAA/Tizen and break them.

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


## Non-negotiables

1. **Offline-first.** Play from cache. Network loss must never blank a screen.
2. **No login on the device.** Pairing is the only enrolment path.
3. **Unknown item types are skipped, never fatal.**
4. **Fail soft** - broken media is skipped, the loop continues.
5. No dialogs, no cursor, no console. It is a shopfront.
6. Conservative JS - TV firmware engines vary and there is no transpiler.

## The JWT has no refresh endpoint

It comes back from `GET /player/{id}` and is short-lived. On `401`, re-fetch the
player document. Do not build a refresh call - there is nothing to call.

## Testing means a panel

No build step means no lint and no compile error to catch you. Run
`node --check js/<file>.js` on everything you touch, then load it on real
hardware. A syntax error the firmware dislikes shows up as a black screen in
somebody's venue, not as a stack trace.

The **offline test** (kill the network, must keep playing) is mandatory for any
change to caching or playback.

## Security note

**`author.p12` is a signing certificate committed to the repo.** Anyone with the file can sign a package as you. Treat it as a secret and plan to rotate it.
