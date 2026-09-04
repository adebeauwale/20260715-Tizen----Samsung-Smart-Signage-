# VYPA Tizen Player (Samsung Smart Signage) - Product Requirements

> *How* it is built: `ARCHITECTURE.md`. Fleet rules: `../vypa-docs/PLAYERS.md`.

Last verified: 2026-09-04.

---

## 1. Product

The VYPA signage player for **Samsung Smart Signage (SSSP / Tizen)** panels. The TV *is* the player: install
the app on the panel, pair it, and the screen plays.

This build targets the **Tizen Enterprise Platform (TEP)** surface and tracks feature parity with the Android Customizable player.

## 2. Why this player exists

Samsung Smart Signage panels are what venues buy when they buy a commercial screen. The panel is the player - no stick, no box, no extra power socket, nothing for a customer to unplug by accident.

## 3. Users

| User | What they need |
|---|---|
| Venue | A screen that plays and recovers on its own, with no extra hardware |
| Installer | Install, pair from the code on screen, walk away |
| VYPA ops | Heartbeat, remote screenshot, playlist push, proof of play |

## 4. Goals

1. **A dark screen is the only real failure.**
2. **Offline-first** - the venue's network is not VYPA's to trust.
3. **No extra hardware** - nothing to unplug, steal or trip over.
4. **Behave like every other VYPA player** to the backend.

### Non-goals
- Not a content authoring tool.
- Not a TV app in the ordinary sense - it owns the screen.

## 5. Requirements

### Functional
- **R1** Show a pairing code until an operator claims it, then persist the screen.
- **R2** Cache all media locally and **play from cache**.
- **R3** **Playback must continue with the network down.**
- **R4** Play video, image, audio and web items; skip any item that fails.
- **R5** Honour scheduling - which item is active now.
- **R6** Heartbeat and report device health.
- **R7** Report proof-of-play and answer screenshot requests.
- **R8** Route to `host.vypa.co` when `screen.category == "host"`, else
  `app.vypa.co`.
- **R9** Re-pair automatically if the screen is deleted or reassigned.
- **R10** Survive an app restart without re-pairing.

### Non-functional
- **R11** Conservative JavaScript - TV firmware engines vary and there is no
  transpiler between the source and the panel.
- **R12** Keep vendor APIs behind the platform adapter so the code stays
  shareable with the sibling players.
- **R13** Respect panel storage quotas; cache eviction must not wedge playback.
- **R14** `player_id` must be stable across re-pairings.

### Constraints
- No build step, no framework, no bundler.
- Speaks the **shared VYPA device API**; nine other players depend on the same
  contract.

## 6. Open questions

- **The three web-TV players have diverged.** The Tizen README still claims the
  code is shared "byte-for-byte" with webOS and VIDAA; measurement on 2026-09-04
  says otherwise. See the divergence table in `ARCHITECTURE.md`. Whether these
  should converge on a genuinely shared core, or be accepted as three forks, is
  an open decision - and it is the single biggest maintenance question in the
  player estate.
- There is no automated check that a fix in one player reaches the other two.
