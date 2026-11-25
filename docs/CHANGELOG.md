# Changelog

## 2026-11-24 — per-vehicle aiming stats + War Thunder-style aiming indicator

- **src/tank_stats.js** (new) — per-vehicle stats keyed by modelKey (M24 Chaffee: 24°/s traverse, 15°/s barrel, pitch −10°…+15°; Panzer IV: 16°/s traverse, 15°/s barrel, pitch −10°…+20°). Exposes `tankStats(modelKey)` for runtime (radians, frozen).
- **src/tank.js** — new `trackAim(targetYawWorld, targetPitch, dt)`: limited-rate turret/barrel convergence + pitch clamping.
- **src/main.js** — War Thunder-style aiming: mouse controls a world-space aim point placed where the aim ray hits the terrain (falls back to a fixed ~100 m point on sky aim); the green ring is the indicator (bore ring removed), the yellow ring is the predicted impact from the actual barrel. Camera looks at the indicator. Player and enemy AI both use `trackAim` at the limited rates. Spawn aim: indicator at ground ~100 m ahead (terrain-derived pitch), barrel/turret initialized to match; enemies initialized with a gravity-corrected aim at the player (previously barrels spawned pointing above the horizon with 0.12 rad pitch).
- **index.html / src/styles.css** — `#bore-reticle` renamed to `#aim-indicator` (green = indicator, yellow = predicted impact).
- **README.md / AGENTS.md / docs/CHANGELOG.md** — docs updated.

## 2026-11-24 — real-world shell speed (500 m/s) + gravity (9.81 m/s²)

- **src/shells.js** — `SHELL_SPEED` 46 → **500 m/s** (real-world shell); `GRAVITY` 16 → **9.81 m/s²**. Shell trail shortened 60 → 24 points so the streak doesn't span hundreds of meters.
- **src/main.js** — Green bore reticle now marches along the barrel axis until it intersects terrain (previously fixed 30 m ahead, misleading vs. the predicted landing point). Enemy aim no longer applies a +0.12 rad upward bias (tuned for slow shells); it now computes a gravity-corrected elevation (`atan2(dy + drop, dist)`, `drop = 0.5·9.81·(d/500)²`).
- **README.md / AGENTS.md** — Aim-cue and shell-kinematics docs updated.

## 2026-11-24 — enemy tanks: Panzer IV only

- **src/scale.js** — Removed `tank_1`, `tank_3`, `tank_4` entries (placeholder CC0 assets).
- **public/models/** — Deleted `tank_1.glb`, `tank_3.glb`, `tank_4.glb`, and unreferenced `tank_2_sherman.glb`.
- **src/main.js** — `makeEnemies()` spawns all enemies as `tank_5` (Panzer IV).
- **README.md / docs/TANK_RIG_REFERENCE.md** — Asset sections updated.

## 2026-11-24 — player tank: M24 Chaffee (tank_6)

- **assets_src/m24_chaffee/build_m24_chaffee.py** (new) — Blender build of a stylized low-poly M24 Chaffee (~5 m length, olive drab, low rounded turret, long slim barrel with muzzle brake, 5 road wheels per side + drive sprocket). Armature root `Root`, tread bones `TankTrack1/2.{L,R}` with explicit `matrix_parent_inverse`, clips `Tank_Forward/Backwards/TurningLeft/Right` (1 s looped). Exports `public/models/tank_6_m24_chaffee.glb` with `export_yup=True`.
- **src/scale.js** — `tank_6` added (kind `tank`, lengthM **5**); legacy CC0 Sherman `tank_2` retired (entry removed).
- **src/main.js / src/tank.js** — player spawn now uses `tank_6`; default model key updated.
- **README.md** — tank asset section updated (M24 player, Panzer IV worked example, retired tank_2).

## 2026-11-23 — 1 km map: river, placeholder bridge, no arena

- **src/world.js** (rewritten) — `WORLD_SIZE` 120 → 1000 m; `PLAY_BOUND = 490` soft square clamp replaces the circular arena (ring mesh removed, arena-ring code gone). Terrain is now a rolling valley 1 km plane (rim rise near edges, spawn flatten). New pure `riverCenterX(z)` centerline with a carved channel (clamped flat bed at -2.2 m), a transparent water ribbon following the same centerline, and a tint pass on the channel color. Placeholder bridge at z = -120 (deck + rails + 3 supports, deck height 2.4 m); `terrainHeight()` includes a smooth bridge-deck override so tanks/shells/camera ground correctly. Seeded RNG (`mulberry32`) + deterministic scatter of 16 rocks/ruins (spawn/river/bridge/spacing clearances). `resolveObstacles()` now clamps to the square border and pushes out of the river band except on the bridge span.
- **src/tree.js** — Scatter reworked for the big map: ~130 trees (~45% valley-rim clusters + random singles), spawn/river/bridge/obstacle/spacing clearances; rooted same as before; colliders registered the same way.
- **src/main.js** — Fog/camera range (180–520 / 1200 m), shadow frustum widened (±90 m), enemy spots relocated to the south bank near the river/spawn; `ARENA_RADIUS` import/usage removed.
- **README.md / AGENTS.md** — World description, module map, and tree-scatter docs updated.

## 2026-11-23 — Blender-built conifer trees (replacing placeholders)

- **assets_src/tree/build.py** (new) — Headless Blender build: low-poly 10m conifer (tapered trunk + 3 stacked jittered-cone foliage layers, flat shading, Iron Valley palette). Outputs `assets_src/tree/tree.blend` (editable source) and `public/models/tree_conifer.glb` (game asset, origin at ground, Y-up).
- **src/scale.js** — Tree entry now declares its GLB url (`models/tree_conifer.glb`) and height target (10 m); kind comment updated.
- **src/tree.js** (new) — `loadTreeModel()` loads the GLB and scales it to `heightM`; `placeTrees()` scatters 69 trees (~45% forest clusters + random singles up to 20 inside the arena), rooted at the highest terrain sample under the trunk base, sunk slightly into the ground, standing straight up (rotation.y only), height variance 8.5–11.5 m. Trunks register collidable circles for tanks/enemies (`world.treeColliders`, enforced in `resolveObstacles`).
- **src/world.js** — Placeholder cone/cylinder tree block removed; obstacles/terrain/ring unchanged.
- **src/main.js** — Initialization now loads tanks + tree model and places trees before `resetMatch()`.

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
