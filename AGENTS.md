# Iron Valley

Low-poly 3D tank valley (Three.js + Vite, no backend, no external assets). A 1 km x 1 km world — terrain, winding river with placeholder bridge, trees, German Fachwerk farmhouses. Take the valley, destroy all enemy armor.

## Dev environment

- Node + npm only; no env vars, no services. `npm install` then `npm run dev`.
- `dist/` is build output — do not hand-edit.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — production build into `dist/`
- `npm run preview` — serve production build (typically http://localhost:4173/)

No test or lint scripts exist; verify changes by `npm run build` and playing in the browser.

## Module map (`src/`)

- `clouds.js` — sky dome: gradient + raymarched volumetric clouds (3D noise slab, time drift). Dome follows the camera position each frame; world-anchored noise so clouds don't move with the camera. `iv-no-sky=1` localStorage disables the dome. Keep coverage roughly ~25% (density smoothstep thresholds) — don't crank up density without re-checking ~25% coverage.
- `main.js` — game state, match loop, input, camera rig, enemy AI, HUD wiring. `TUNING` block at top holds player/enemy speed, damage, reloads, counts — edit here for gameplay tuning.
- `tank_stats.js` — per-vehicle stats (turret/barrel rate, hull steering rate, pitch min/max, inaccuracyDeg), keyed by modelKey; consumed by tank.js `trackAim`, `sampleFireDir`, and the player/AI aim code in main.js. Add new vehicles here.
- `world.js` — 1 km terrain height fn, river centerline + bridge, scenery, object/river/border collision
- `roads.js` — terrain-conforming road ribbons from level.json polylines (dirt = tan, gravel = grey, per-road widthM); built after `buildWorld`
- `ground.js` — ground-zone classifier over world.js data (water/riverbank/spawn/rim/clearing/grass); consumed by grass scatter; also suppresses grass on road ribbons
- `farmhouse.js` — Fachwerk farmhouse loading + scatter (~12, a few near spawn), collidable; farmhouses registered in world.js (colliders) and excluded from grass/trees
- `barley.js` — instanced barley tufts in crops regions: deterministic rows (even X, 2 m spacing N/S, 1 m along Z, 0.7 m tall), wind sway + distance fade, no generation step; crops regions have no grass scatter and instead render barley.
- `grass.js` — instanced tuft renderer (crossed quads, wind sway, distance fade, per-instance tint); built in `main.js` init after trees. Lighting: forces a world-up normal in the fragment shader so both crossed-quad sides light identically (hemisphere + sun); do not remove, or back-facing sides go dark again. Grass casts no shadows but receives sun shadows (receiveShadow) so tufts darken inside building shadows
- `mg_emplacement.js` — machinegun emplacement loading + `MgEmplacement` behavior (`MG_TUNING`: ±45° yaw arc, −10°/+20° pitch, 150 m range, 3 s × 30 bullet burst at 10 rps, 2 s cooldown, splashRadius 4 m); turret/gun rig driven by the `Mg_Turret`/`Mg_GunPivot` nodes; bullets spawn via `onMgFire` in main.js (no damage, shell-like collision); tank-fired shells can hit the turret (direct, even with sandbags up) or splash-kill it (within splashRadius) and destroy it — darken/slump husk that keeps collision and stops firing; shells hitting the sandbags remove them (terrain SFX); bullets never trigger this
- `scale.js` — world-scale manifest (`ASSETS`): real-world sizes in meters per asset; `tankRadius()` derives collision radius
- `tank.js` — tank rig (hull → turret yaw → barrel pitch → muzzle), grounding, damage
- `docs/TANK_RIG_REFERENCE.md` — full rig/animation contract for future Blender-built tanks
- `shells.js` — gravity projectiles (500 m/s, 9.81 m/s² default; `Shell` accepts `opts` for bullets: smaller radius, orange color, lower gravity, fewer trail points, longer life), segmented collision, trail, impact FX, trajectory prediction
- `styles.css` — HUD, cues, overlays

## Conventions

- Hull local forward = +Z, up = +Y. Hull yaw θ → world forward `(sinθ, 0, cosθ)`.
- `A` increases hull yaw (nose left viewed from behind); `D` decreases it.
- Barrel pitch stored in world space; turret's loaded rotation is relative to the hull, so aim stays fixed in world space while the hull turns.
- Hull steering, turret and barrel all rate-limit per vehicle (tank_stats.js: hullTurnRateDeg): M24 Chaffee 24°/s, Panzer IV 20°/s. Aiming: the mouse drives a damped camera aimed at a world-space **white intent point** placed where the camera ray first hits (terrain march + enemy/farmhouse raycast; trees passable; fixed ~100 m point on sky aim), rendered as the white intent ring. The camera is damped toward that direction. Turret and barrel track the intent point at per-vehicle limited rates (src/tank_stats.js), with per-tank pitch limits. The **green ring** renders where the barrel ray first hits (same occlude-aware raycast, origin = muzzle). The **yellow dashed ring** is the predicted first-impact point from the actual barrel (recomputed per frame; 500 m/s, 9.81 m/s²). Enemy AI uses the same limited-rate tracking. Shells are fired along `tank.sampleFireDir()` (uniform random yaw/pitch offset ±inaccuracyDeg per shell), not the exact barrel axis; the rings remain accurate. Spawn: intent point at ground ~100 m ahead, barrel/turret initialized to match.
- Zoom mode: right-click or Shift toggles FOV 55°→22° (state `zoomMode` in main.js); sensitivity scales with current FOV; cues are fixed-size DOM so they don't scale with FOV. Resets on `resetMatch()`.
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

## Level editor & level file

- `editor.html` = 2D level editor (Vite multi-page). Shares world/asset metadata only (scale.js, world.js constants, level.js, terrain height fn) — no gameplay code.
- `public/level.json` = the level source of truth (world coords: x east, z south, origin at world center, 1 unit = 1 m). Schema: `{ version, name, terrain: { regions: [{id,type,points:[[x,z],...]}], roads: [{id,type,widthM,points:[[x,z],...]}] }, spawns: { player: {x,z,heading}, enemies: [{x,z,heading}] }, objects: [{id,type,x,z,rotation,scale}] }`; optional `menuCamera: { x, z, altitude, yaw, pitch }` (meters/radians; altitude ≥ 1, pitch clamped ±80°).
- `menuCamera` = main-menu preview camera. Rendered by the game in the menu state (not the in-game camera); the editor surfaces it as a teal eye-ring marker (draggable, rotatable +15°) with properties panel (X/Z/altitude/yaw/pitch; degrees in the panel). Missing/invalid → default aerial shot 35 m behind the player spawn (40 m altitude, −30° pitch).
- Regions: polygons; types `grasslands` (implicit default), `pasture`, `crops`, `clearing`, `forest`. `forest` keeps the grassland tint and scatters trees via `src/forest.js` (seeded, deterministic, editor-time generation; density = trees per 100m x 100m tile, default 50; min 3 m spacing) — generated trees are ordinary `tree` objects with `<regionId>-tree-N` ids and must be deleted on region type change/delete. Roads: polylines; types `gravel`, `dirt`. Both rendered flat-color in the editor.
- Objects: `tree`, `farmhouse` (more manifest entries with an `editor` block appear automatically in the editor's object palette — no editor-code changes needed). Objects sit on existing terrain height; `scale` multiplies manifest footprint; rotation in radians; ids are stable — agents must preserve ids when editing this file. The editor displays/edits rotation and spawn headings in degrees (0–360, needle matches the on-canvas heading tick) while storing radians internally.
- Editor save: dev mode POSTs to `/__level-save` (Vite middleware overwrites `public/level.json`); static builds fall back to download.
- Game loads `public/level.json` at startup via `src/level.js` (`loadLevel`); spawns, object placement and ground tinting/grass culling are driven by it. Placeholder rocks/ruins were removed; future rocks/ruins will be level objects.
- To regenerate/replace the initial level, hand-edit `public/level.json` (a full deterministic export of the old procedural scatter is a documented follow-up).
