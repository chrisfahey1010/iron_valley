# Iron Valley

Low-poly 3D tank arena in the browser. Take the valley, destroy all enemy armor.

## Setup & run

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run preview  # serve the production build
```

Open http://localhost:4173/ (or the URL printed by `npm run dev`). The game is fully self-contained (Three.js, no external assets).

## Controls

| Input | Action |
| --- | --- |
| W / S | Drive forward / reverse |
| A / D | Steer hull left / right (relative to the hull; works reversed) |
| Mouse | Aim turret & camera (pointer lock) |
| Left click | Fire |
| R | Restart match |
| Esc | Release pointer lock; click canvas to re-capture |

Start screen: click **START MISSION**. The start click captures the mouse and does not fire.

Two distinct aim cues: a small **green ring** is where the barrel actually points (bore), a **yellow dashed ring** is the predicted first-impact point (recomputed every frame, lead moving targets).

## Module map

- `src/main.js` — game state, match loop, input, camera rig, enemy AI, HUD wiring
- `src/world.js` — terrain height function, obstacles (rocks/ruins), scenery, obstacle collision
- `src/tank.js` — tank rig (hull → turret yaw pivot → barrel pitch pivot → muzzle), grounding, damage
- `src/shells.js` — gravity projectiles, segmented collision, trail, impact FX, trajectory prediction
- `src/styles.css` — HUD, cues, overlays

Tuning values (player/enemy speed, damage, reloads, counts) live in the `TUNING` block at the top of `src/main.js`.

## Conventions

- Hull local forward = +Z, up = +Y. Hull yaw θ → world forward `(sinθ, 0, cosθ)`.
- `A` increases hull yaw (nose to player's left when viewed from behind); `D` decreases it.
- Barrel pitch is stored as a world-space angle; the turret's loaded rotation is relative to the hull, so aim stays fixed in world space while the hull turns.
