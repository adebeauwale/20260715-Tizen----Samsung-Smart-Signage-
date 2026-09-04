# VYPA Tizen Player (Samsung Smart Signage) - Layout & Data Model

Last verified: 2026-09-04.

---

## 1. Layout

```
index.html                <- entry point
js/
  app.js  pairing.js  apiService.js  cacheService.js  storage.js
  playerInit.js  playerEngine.js  scheduling.js  proofOfPlay.js
  telemetry.js  screenPower.js  device.js  ui.js  intro.js  state.js
  tep.js              <- PLATFORM ADAPTER (this player only)
css/  assets/  images/
```

Other files: `config.xml` (Tizen app manifest), `author.p12` (signing certificate), `SSSP/`, `tools/`, `celebration/`, `_pre_parity_backup/`

**Where new code goes**

| Adding | Put it in |
|---|---|
| A cloud call | `js/apiService.js` - nothing else talks HTTP to VYPA |
| A vendor API call | `js/tep.js` - and **nowhere else** |
| Playback behaviour | `js/playerEngine.js` |
| Caching behaviour | `js/cacheService.js` |
| Persistence | `js/storage.js` |
| Scheduling rules | `js/scheduling.js` |

Anything outside the adapter is shared lineage with the sibling players -
decide whether they need it too.

---

## 2. On-device state

Persistence goes through `js/storage.js`, which wraps the platform's storage
behind a single interface (the underlying mechanism differs per vendor, which is
one reason `storage.js` has drifted between the three players).

What is stored:

| Key | Meaning |
|---|---|
| `player_id` | **Device identity across pairings.** Generated once, must persist |
| screen / `screen_id` | The claimed screen. Changes on re-pair; `player_id` does not |
| playlist | The last known playlist, so playback survives a restart offline |
| cached media | Downloaded assets, managed by `cacheService.js` |

Media is cached locally and playback reads the cache, never a remote URL. That
is what offline-first means here.

> Panel storage quotas are small and vendor-specific. `cacheService.js` is the
> module most likely to behave differently across Tizen, webOS and VIDAA - Tizen
> has effectively rewritten it (502 lines vs 279).

---

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


---

## 3. Conventions

- `player_id` survives re-pairing; `screen_id` does not.
- Timestamps from the cloud are UTC; scheduling decisions happen on-device.
- Unknown item types are skipped, never fatal.
- Vendor APIs live behind `tep.js`.
- Conservative JS syntax - there is no transpiler between you and the panel.
