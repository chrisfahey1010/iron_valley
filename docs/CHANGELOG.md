# Changelog

## 2026-11-23 — pause-menu volume controls (master/effects/music)

- **src/audio.js** — New `setMasterVolume`/`getMasterVolume` and `setEffectsVolume`/`getEffectsVolume`; a lazy master gain node routes all SFX through the master level; SFX gain is now `baseVolume × effectsVolume × attenuation`; both persist to localStorage (`iv-master-volume`, `iv-effects-volume`).
- **src/main.js** — Pause menu gains MASTER and EFFECTS sliders alongside MUSIC; music volume is now `master × musicBase` (localStorage `iv-music-volume`), initialized into the sliders at startup; `openPause()` refreshes all three sliders from stored values.
- **index.html / README.md** — Two new pause-menu rows; controls table updated.

## 2026-11-23 — restart-crash hardening

- **src/main.js** — `resetMatch()` is now failure-tolerant: shells, tanks, and player/enemy creation are each guarded so a failed reset degrades to a visible menu state instead of a frozen half-reset game; `camYaw` is reset on restart (previously stale).
- **src/main.js** — `loop()` is guarded: a throwing frame logs to the console and the loop continues, and a slow frame (>250 ms) logs a `Iron Valley slow frame` stack trace for diagnosis. Removed the duplicated per-frame `window.__iv` assignment (single module-scope install now).
- **src/tank.js** — `dispose()` now stops the animation mixer and disposes the muzzle-flash cone geometry (the only per-tank-owned geometry; shared geometries are never disposed) — prevents animation/resource leaks across restarts.
- **README.md** — restart-resilience section added.

## 2026-11-23 — positional impact SFX (Stable Audio 3)

- **public/audio/impact-{tank,terrain,rock}-{a,b}.mp3** (new) — 2 variants each, ~2s One-shot clips: tank hits (metallic clang/thud), terrain (dirt rumble/boom), rock (shell blast off rock).
- **src/audio.js** — Refactored into shared `ensureBuffer`/`scheduleAt`; added `playImpactAt(kind, worldPos, listenerPos)`. `unlockAudio()` preloads shell-fire + all impact clips.
- **src/main.js** — On shell impact, plays the matching sound at the impact point: `tank` → tank, `obstacle` → rock, `terrain`/`bounds` → terrain. Random variant per impact.
- **README.md** — Audio assets and module map updated.
## 2026-11-23 — tank visibility & aiming fixes

- **src/tank.js** — Fixed invisible tanks: `Box3.setFromObject(wrapper, false)` returned a garbage bounding box (min.y ≈ -22.89) for the cloned/skinned rig, inflating `wrapper.position.y`. Grounding now derives from the manually measured geometry bounding box (scaled by the normalization factor). Tank now visibly grounds at sane scale (~0.15–0.18) for player and enemies.
- **src/tank.js** — Wreck tint now walks the whole `group` (not just `model`) after turret reparenting, so turret/gun materials darken to `#1c1c1c` on death; the muzzle-flash cone is excluded.
- **src/main.js** — Predicted-impact yellow crosshair now ignores the player in trajectory prediction (matching shell behavior, which skips the owner). Previously the prediction spawned inside the player's own hit sphere and was suppressed by the `hitTank !== player` filter, making the marker almost always hidden.
## 2026-11-23 — positional shell-fire SFX

- **src/audio.js** — New module: plays the Stable Audio 3 shell-fire blast (`public/audio/shell-fire.mp3`) scheduled at `now + distance/343 m/s` from the camera, with distance-based volume attenuation. Best-effort; never crashes the game.
- **src/main.js** — Calls `unlockAudio()` on start/restart and `playShellFireAt(muzzle, camera.position)` in `tryFire`.
- **README.md** — Audio assets and module map updated.
## 2026-11-23 — world-scale manifest (meters)

- **src/scale.js** (new) — `ASSETS` manifest with real-world sizes in meters (1 game unit = 1 m): tanks `lengthM: 6`, trees `heightM: 10`. Helpers: `measureRootBbox()`, `scaleToHorizontalFit()`, `tankRadius(lengthM)` (≈0.30× length).
- **src/tank.js** — Tanks now scale so the footprint long axis equals the manifest `lengthM` (6 m default) instead of an arbitrary 2.6-unit footprint. Per-instance override: `{ lengthM }`. Stores `this.collisionRadius`. Clear error when a model key is missing.
- **src/world.js** — Trees are now real ~10 m trees (trunk 30% + cone 70%) with per-instance height variance.
- **src/main.js** — Collision uses `tank.collisionRadius` (not hardcoded 1.7); camera bumped to CAM_DIST 13 / CAM_HEIGHT 7.0 for 6 m tanks; `resetMatch()` moved into the init try/catch so startup failures surface a visible message instead of hanging on "LOADING…".
- **README.md / AGENTS.md** — World-scale workflow documented: add GLB → manifest entry → reference in loader.
