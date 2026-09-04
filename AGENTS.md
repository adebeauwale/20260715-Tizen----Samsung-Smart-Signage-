# AGENTS.md - VYPA Tizen Player (Samsung Smart Signage)

Instructions for AI coding agents working in this repository.
Read `ARCHITECTURE.essential.md` first.

---

## 1. Orientation (every session)

1. Read `ARCHITECTURE.essential.md`.
2. **Know that two sibling players share most of this code** - see the
   divergence table below. Decide up front whether your change belongs in all
   three.
3. `git status && git branch --show-current`.
4. For anything touching the cloud, read
   `../vypa-player - raspberry Pi/docs/API-CONTRACT.md`.

## 2. How to plan

- Restate the task in one sentence.
- Name the module. If it is `tep.js`, the change is **this player only**.
  If it is anything else, ask whether webOS, VIDAA and Tizen need it too.
- If it touches playback or caching, state how it behaves **with the network
  down**.
- If it touches the cloud API, say so - nine player clients share that contract.

## 3. How to code

### Always
- Plain JS. No framework, no bundler, no npm runtime dependency. TV firmware JS
  engines vary; keep the syntax conservative.
- **All cloud HTTP goes through `apiService.js`.**
- **All vendor API calls go in `tep.js`.** Nowhere else.
- Play from cache, never straight from a URL.
- Skip a failed item and continue the loop.
- On `401`, re-fetch the player document to rotate the JWT. There is **no
  refresh endpoint**.

### Never
- **Never leak a vendor API outside `tep.js`.** It breaks the sibling
  players when the file is copied across.
- **Never assume a fix propagates to the other players.** It does not. Port it
  by hand and say that you did.
- Never add a build step or a framework.
- Never put a login on the device. Pairing is the only enrolment path.
- Never let an unknown item type be fatal - skip it.
- Never show a dialog, cursor or console. It is a shopfront.

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


## 4. How to test

There is no test suite and no build step, so **the panel is the test**.

1. **Syntax check before anything else.** `node --check js/<file>.js` on every
   file you touched. Without a build step, a syntax error reaches the panel as a
   black screen.
2. **Load it on the real panel.** Emulators do not reproduce firmware quirks,
   storage limits or codec support.
3. **The offline test** - mandatory for changes to caching or playback. Pair,
   let it cache, **kill the network**, confirm it keeps playing.
4. **The reload test** - restart the app and confirm it returns to playback
   without re-pairing.
5. **Both categories** - a `host` screen and a non-host screen, exercising both
   base URLs.
6. **Re-pair** - delete the screen server-side; the player must recover itself.
7. **If you changed shared code, test the siblings too**, or say plainly that
   you did not.

## 5. How to modify safely

| Change | Extra step |
|---|---|
| `tep.js` | This player only. Safe to change alone |
| Any other `js/` file | Decide and state whether webOS / VIDAA / Tizen need the same change |
| `apiService.js` | Coordinate with `vypasignage-backend`/`VypaHostApp`; nine other clients share the contract |
| `cacheService.js` / `storage.js` | Tizen has diverged heavily here. Do not copy blindly between players |
| Packaging / manifest | Rebuild the package and install it on a panel |

## 6. Keeping these documents current

| If you change... | Update |
|---|---|
| Module roles or the adapter seam | `ARCHITECTURE.md`, and `ARCHITECTURE.essential.md` if the shape changed |
| A rule or trap | `AGENTS.md` and `CLAUDE.md` |
| Product behaviour | `PRD.md` |
| Stored keys, cache, API surface | `DATA-MODEL.md` |
| Divergence between the three players | **Re-measure and update the table in all three repos** |
| Anything true of every player | `../vypa-docs/PLAYERS.md` |

Never document an intention as a fact. The "byte-for-byte" line in the README is
exactly how that goes wrong - it was true once, and nobody re-checked it.

## 7. Reporting back

State what you changed, whether you ran it **on a real panel**, and - if you
touched shared code - **which sibling players you ported it to**.
