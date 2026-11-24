# Iron Valley

Low-poly 3D tank arena in the browser. Take the valley, destroy all enemy armor.

## Setup & run

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run preview  # serve the production build
```

Open http://localhost:4173/ (or the URL printed by `npm run dev`). The game is fully self-contained (Three.js, no external assets). Combat theme: `public/audio/combat-theme.mp3` (60s loop, Stable Audio 3). Shell-fire SFX: `public/audio/shell-fire.mp3` (Stable Audio 3, One-shot). Impact SFX: `public/audio/impact-{tank,terrain,rock}-{a,b}.mp3` (Stable Audio 3, One-shot, randomized per impact).

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
- `src/world.js` — terrain height function, obstacles (rocks/ruins), scenery, obstacle collision
- `src/scale.js` — world-scale manifest (ASSETS) + scale/measure helpers
- `src/tank.js` — tank rig (hull → turret yaw pivot → barrel pitch pivot → muzzle), grounding, damage
- `src/shells.js` — gravity projectiles, segmented collision, trail, impact FX, trajectory prediction
- `src/audio.js` — positional shell-fire and impact SFX (speed-of-sound delay + distance attenuation); impact kind derived from shell-impact reason (tank / rock / terrain), variant picked randomly per impact
- `src/styles.css` — HUD, cues, overlays

Tuning values (player/enemy speed, damage, reloads, counts) live in the `TUNING` block at the top of `src/main.js`.

## World scale (meters)

1 game unit = 1 meter. Every asset declares its real-world size in `src/scale.js` (`ASSETS` manifest); loaders scale imported geometry so it matches — e.g. a tank GLB is scaled so its footprint long axis equals 6 m, trees are 10 m tall. To add a new asset:

1. Drop the file under `public/models/`.
2. Add an entry to `ASSETS` in `src/scale.js` with kind (`tank` / `tree` / `props`) and its real-world size (`lengthM` / `heightM` / `targetMeters`).
3. Reference it in the loader. Per-instance overrides: pass `{ lengthM: ... }` / `{ heightM: ... }` to the constructor/loader.

Collision radius is derived per-tank via `tankRadius(lengthM)`. Camera distances are tuned for 6 m tanks (CAM_DIST 13, CAM_HEIGHT 7.0).

## Conventions

- Hull local forward = +Z, up = +Y. Hull yaw θ → world forward `(sinθ, 0, cosθ)`.
- `A` increases hull yaw (nose to player's left when viewed from behind); `D` decreases it.
- Barrel pitch is stored as a world-space angle; the turret's loaded rotation is relative to the hull, so aim stays fixed in world space while the hull turns.
