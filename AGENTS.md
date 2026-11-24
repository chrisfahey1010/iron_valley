# Iron Valley

Low-poly 3D tank valley (Three.js + Vite, no backend, no external assets). A 1 km x 1 km world — terrain, winding river with placeholder bridge, rocks/ruins, trees. Take the valley, destroy all enemy armor.

## Dev environment

- Node + npm only; no env vars, no services. `npm install` then `npm run dev`.
- `dist/` is build output — do not hand-edit.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — production build into `dist/`
- `npm run preview` — serve production build (typically http://localhost:4173/)

No test or lint scripts exist; verify changes by `npm run build` and playing in the browser.

## Module map (`src/`)

- `main.js` — game state, match loop, input, camera rig, enemy AI, HUD wiring. `TUNING` block at top holds player/enemy speed, damage, reloads, counts — edit here for gameplay tuning.
- `world.js` — 1 km terrain height fn, river centerline + bridge, obstacles (rocks/ruins), scenery, obstacle/river/border collision
- `scale.js` — world-scale manifest (`ASSETS`): real-world sizes in meters per asset; `tankRadius()` derives collision radius
- `tank.js` — tank rig (hull → turret yaw → barrel pitch → muzzle), grounding, damage
- `docs/TANK_RIG_REFERENCE.md` — full rig/animation contract for future Blender-built tanks
- `shells.js` — gravity projectiles, segmented collision, trail, impact FX, trajectory prediction
- `styles.css` — HUD, cues, overlays

## Conventions

- Hull local forward = +Z, up = +Y. Hull yaw θ → world forward `(sinθ, 0, cosθ)`.
- `A` increases hull yaw (nose left viewed from behind); `D` decreases it.
- Barrel pitch stored in world space; turret's loaded rotation is relative to the hull, so aim stays fixed in world space while the hull turns.
- Two aim cues: green ring = actual barrel bore; yellow dashed ring = predicted first-impact point (recomputed per frame, leads moving targets).
- Fully self-contained: Three.js only, no external assets/network.

## Pitfalls

- Do not add servers/bundling of external assets; keep it a single-page static game.
- Pointer lock: start-screen click captures the mouse and does not fire; Esc releases; click canvas to re-capture.
- `README.md` documents controls; keep it in sync with code changes.

## Long-term goal

Iron Valley is a long-term project: polish into a well-developed game, built **exclusively with local models** (e.g., Hermes local agents) — no external services or paid APIs for development.

How to work here:
- Step by step, small verifiable changes. One gameplay/polish change per pass; verify with `npm run build` and play in the browser before moving on.
- Don't over-extend: check this doc and `README.md` before adding systems; keep the single-page Three.js constraint.
- Tuning lives in the `TUNING` block in `src/main.js`; keep it the single source of gameplay numbers.
- Keep `README.md` controls/module docs in sync with code changes.
