# Iron Valley

Low-poly 3D tank valley in the browser — a 1 km x 1 km world with a winding river and a placeholder bridge. Take the valley, destroy all enemy armor.

## Setup & run

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run preview  # serve the production build
```

Open http://localhost:4173/ (or the URL printed by `npm run dev`). The game is fully self-contained (Three.js, no external assets). Grass is instanced tufts (`src/grass.js`, ~60k, crossed quads with per-instance tint + wind sway) over the terrain's tiled grass ground texture; tunables at the top of `src/grass.js`. Combat theme: `public/audio/combat-theme.mp3` (60s loop, Stable Audio 3). Shell-fire SFX: `public/audio/shell-fire.mp3` (Stable Audio 3, One-shot). Impact SFX: `public/audio/impact-{tank,terrain,rock}-{a,b}.mp3` (Stable Audio 3, One-shot, randomized per impact).

## Controls

| Input | Action |
| --- | --- |
| W / S | Drive forward / reverse |
| A / D | Steer hull left / right (relative to the hull; works reversed) |
| Mouse | Aim turret & camera (pointer lock) |
| Left click | Fire |
| R | Restart match |
| Esc | Pause menu — master/effects/music volume sliders, resume, restart |

Start screen: click **START MISSION**. The start click captures the mouse and does not fire.

## Restart resilience

`resetMatch()` (R key / restart button / end-of-match restart) is failure-tolerant: shell and tank cleanup, then player/enemy creation, each run in their own guarded block, and a reset that fails surfaces a 'RESTART FAILED' menu instead of a half-reset game. The render loop is also guarded — a throwing frame logs to the console and the loop continues, and a slow frame (>250 ms) logs a `Iron Valley slow frame` stack trace to the console for diagnosis.

Two distinct aim cues: a small **green ring** is where the barrel actually points (bore), a **yellow dashed ring** is the predicted first-impact point (recomputed every frame, lead moving targets).

## Module map

- `src/main.js` — game state, match loop, input, camera rig, enemy AI, HUD wiring
- `src/world.js` — 1 km terrain height function, winding river + placeholder bridge, obstacles (rocks/ruins), scenery, obstacle/river/border collision
- `src/farmhouse.js` — Fachwerk farmhouse loading + scatter (~12, a few near spawn), collidable
- `src/scale.js` — world-scale manifest (ASSETS) + scale/measure helpers
- `src/tank.js` — tank rig (hull → turret yaw pivot → barrel pitch pivot → muzzle), grounding, damage
- `src/shells.js` — gravity projectiles, segmented collision, trail, impact FX, trajectory prediction
- `src/ground.js` — ground-zone classifier (`groundZone`): water / riverbank / spawn / rim / clearing / grass; used by grass scatter
- `src/grass.js` — instanced crossed-quad grass tufts with wind sway + distance fade; seeded deterministic scatter over the playable bounds. Lighting is faked via a constant world-up normal forced in the fragment shader (after `normal_fragment_maps`), so both sides of the crossed quads share hemisphere + sun light — do not remove this or grass will flip dark on one side again. No shadows from/onto grass
- `src/audio.js` — positional shell-fire and impact SFX (speed-of-sound delay + distance attenuation); impact kind derived from shell-impact reason (tank / rock / terrain), variant picked randomly per impact
- `src/styles.css` — HUD, cues, overlays

Tuning values (player/enemy speed, damage, reloads, counts) live in the `TUNING` block at the top of `src/main.js`.

## World scale (meters)

1 game unit = 1 meter. Every asset declares its real-world size in `src/scale.js` (`ASSETS` manifest); loaders scale imported geometry so it matches — e.g. a tank GLB is scaled so its footprint long axis equals 6 m, trees are 10 m tall. To add a new asset:

1. Drop the file under `public/models/`. Blender-built sources live under `assets_src/<asset>/` (build script + editable `.blend`).
2. Add an entry to `ASSETS` in `src/scale.js` with kind (`tank` / `tree` / `props`) and its real-world size (`lengthM` / `heightM` / `targetMeters`).
3. Reference it in the loader. Per-instance overrides: pass `{ lengthM: ... }` / `{ heightM: ... }` to the constructor/loader.

Tank assets are built with Blender (headless, see `assets_src/panzer_iv/build_panzer_iv.py` and `assets_src/m24_chaffee/build_m24_chaffee.py`) and loaded via `src/tank.js`. `tank_6` (`public/models/tank_6_m24_chaffee.glb`) is the player's tank (M24 Chaffee, ~5 m footprint); `tank_5` (`public/models/tank_5_panzer_iv.glb`) is the worked example of the enemy-side Blender build. Both are authored at 1 unit = 1 m (X=length −X forward, Y=width, Z=up) and exported with `export_yup=True` — see `docs/TANK_RIG_REFERENCE.md` for the full rig/animation contract. The CC0 tanks (`tank_1/3/4`) are enemy models; `tank_5` (Panzer IV) slots into the 4th enemy slot. The legacy CC0 Sherman (`tank_2`) was retired — the player slot now uses the M24; the unused `tank_2_sherman.glb` file is kept on disk but unreferenced.

Tree assets are built with Blender (headless, see `assets_src/tree/build.py`) and loaded via `src/tree.js`. The tree GLB is authored with its origin at ground level and exported with 1 game unit = 1 meter; `loadTreeModel()` scales the mesh to `heightM`, and `placeTrees()` roots instances at `terrainHeight(x, z)` with rotation around Y only (trees stand straight up; no tilt). ~130 trees total: valley-edge clusters plus random singles (spawn clear, kept off the river and bridge), rooted on slope-safe terrain samples and sunk slightly into the ground; tree trunks are collidable.

Farmhouse assets are built with Blender (headless, see `assets_src/farmhouse/build.py`) and loaded via `src/farmhouse.js`. The GLB is authored with its origin at ground level and exported with 1 game unit = 1 meter (14 m footprint, ~10.5 m with chimney); `loadFarmhouseModel()` scales the mesh so the footprint's long axis equals `lengthM` (14 m), and `placeFarmhouses()` roots instances at `terrainHeight(x, z)` with a random Y rotation and slight scale variance (0.9–1.1). ~12 farmhouses total: ~4 near the player spawn (~55–115 m ring) and the rest spread across the valley — spawn clear, kept off the river, bridge, obstacles and trees, and sunk slightly into the ground; a circle collider (r = 8.5 m) per instance. The game renders them flat-shaded alongside the other low-poly assets.

Collision radius is derived per-tank via `tankRadius(lengthM)` (player M24 at 5 m, enemies at 6 m). Camera distances are tuned for 6 m tanks (CAM_DIST 13, CAM_HEIGHT 7.0).

## Conventions

- Hull local forward = +Z, up = +Y. Hull yaw θ → world forward `(sinθ, 0, cosθ)`.
- `A` increases hull yaw (nose to player's left when viewed from behind); `D` decreases it.
- Barrel pitch is stored as a world-space angle; the turret's loaded rotation is relative to the hull, so aim stays fixed in world space while the hull turns.

## Tank rig orientation

See `docs/TANK_RIG_REFERENCE.md` for the full rig/animation contract for future Blender-built tanks.

- Hull pose uses `rotation.order = 'YXZ'` (yaw → pitch → roll). Pitch/roll come from terrain height samples (nose/tail, left/right) along the heading, with the forward/up signs chosen so the nose rises up a slope; side slopes roll the tank toward the lower side.
- Turret carries only yaw (`turretLocalYaw`); it does NOT pitch.
- Barrel pitch is applied on a dedicated `barrelPivot` group hinged at the gun node's pivot. The pivot axis is derived at load time from the actual muzzle direction (`cross(muzzleDir, up)`) because the GLB's long axis is not axis-aligned — never pitch the gun about the turret's local X. Positive `barrelPitch` raises the tip.
- Aim/world-space direction stays fixed while the hull turns because turret yaw is stored relative to the hull.
