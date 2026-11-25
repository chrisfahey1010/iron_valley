# Iron Valley

Low-poly 3D tank valley (Three.js + Vite, no backend, no external assets). A 1 km x 1 km world — terrain, winding river with placeholder bridge, rocks/ruins, trees, German Fachwerk farmhouses. Take the valley, destroy all enemy armor.

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
- `tank_stats.js` — per-vehicle stats (turret/barrel rate, hull steering rate, pitch min/max), keyed by modelKey; consumed by tank.js `trackAim` and by the player/AI aim code in main.js. Add new vehicles here.
- `world.js` — 1 km terrain height fn, river centerline + bridge, obstacles (rocks/ruins), scenery, obstacle/river/border collision
- `ground.js` — ground-zone classifier over world.js data (water/riverbank/spawn/rim/clearing/grass); consumed by grass scatter
- `farmhouse.js` — Fachwerk farmhouse loading + scatter (~12, a few near spawn), collidable; farmhouses registered in world.js (colliders) and excluded from grass/trees
- `grass.js` — instanced tuft renderer (crossed quads, wind sway, distance fade, per-instance tint); built in `main.js` init after trees. Lighting: forces a world-up normal in the fragment shader so both crossed-quad sides light identically (hemisphere + sun); do not remove, or back-facing sides go dark again. Grass neither casts nor receives shadows
- `scale.js` — world-scale manifest (`ASSETS`): real-world sizes in meters per asset; `tankRadius()` derives collision radius
- `tank.js` — tank rig (hull → turret yaw → barrel pitch → muzzle), grounding, damage
- `docs/TANK_RIG_REFERENCE.md` — full rig/animation contract for future Blender-built tanks
- `shells.js` — gravity projectiles (500 m/s, 9.81 m/s²), segmented collision, trail, impact FX, trajectory prediction
- `styles.css` — HUD, cues, overlays

## Conventions

- Hull local forward = +Z, up = +Y. Hull yaw θ → world forward `(sinθ, 0, cosθ)`.
- `A` increases hull yaw (nose left viewed from behind); `D` decreases it.
- Barrel pitch stored in world space; turret's loaded rotation is relative to the hull, so aim stays fixed in world space while the hull turns.
- Hull steering, turret and barrel all rate-limit per vehicle (tank_stats.js: hullTurnRateDeg): M24 Chaffee 24°/s, Panzer IV 20°/s. Aiming: the mouse controls a world-space aim point placed where the aim ray intersects the terrain (fixed ~100 m point on sky aim), rendered as the green ring; the camera follows it. Turret and barrel track the indicator at per-vehicle limited rates (src/tank_stats.js), with per-tank pitch limits. The yellow dashed ring is the predicted first-impact point from the actual barrel (recomputed per frame; 500 m/s, 9.81 m/s²). Enemy AI uses the same limited-rate tracking. Spawn: indicator at ground ~100 m ahead, barrel/turret initialized to match.
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
