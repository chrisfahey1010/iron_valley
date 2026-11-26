# Grass — Implementation Plan

> **Status: implemented** (2026-11-24). Deviations from the original spec:
> - ~60k tufts (not ~80k) — `FADE_END = 200 m`, fog-managed, tunable at the top of `src/grass.js`.
> - Grass everywhere in playable bounds, including the spawn area (no spawn clearing).
> - Tufts built with `MeshLambertMaterial` + `onBeforeCompile` (not a raw `ShaderMaterial`) with fake up-facing normals so blades self-light; `alphaTest: 0.45`, per-instance tint/scale/phase, wind sway, distance fade + discard.
> - Blade sprite and ground texture already existed in `public/textures/` (already transparent); not regenerated.
>
Goal: believable grass over the 1 km valley, fully self-contained (no external assets), lean enough for 60+ FPS on an everyday laptop, 3rd-person tank camera looking mostly downrange.

Scope discipline: ONE aim — make the terrain look alive with grass. This is not a road/pasture/farmhouse pass. Those are future phases built on the ground-zone classifier.

## Deferred / out of scope (future passes)
- Dirt / cobblestone roads, pasture zones, farmhouses, dirt clearings
- Blender-modelled grass blades (billboards instead)
- Many tuft variants / far-LOD system — one good look now
- Grass interactions (trample/push-through under tanks)

## Pieces

### 1. Ground-zone classifier — `src/ground.js` (new, ~60-80 lines)
Pure function `groundZone(x, z)` in `src/ground.js`, reading world.js data (riverDist, BRIDGE, SPAWN):

- `'water'` — inside river channel (riverDist < RIVER_HALF_WIDTH + small band)
- `'riverbank'` — within RIVER_HALF_WIDTH + bank band (~6 m)
- `'spawn'` — flattened spawn disc (no grass needed, keep clean/readable)
- `'rim'` — steep valley rim (height above threshold or near border)
- `'clearing'` — object footprints (trees, farmhouses, level objects) — excluded from scatter
- `'grass'` — everything else (default)

Also `isObstacleAt(x, z, extra)` via exported treeColliders/farmhouseColliders/objectColliders.

### 2. Terrain material upgrade — `src/world.js` (edit in place)
Replace flat vertex-color `MeshLambertMaterial` with a `MeshLambertMaterial`/`MeshStandardMaterial` that keeps vertex colors AND multiplies a tiled grass texture (`map`). Keep vertex colors for elevation/riverbed darkening as a secondary tint, river carve and bridge override unchanged. River water and bridge unchanged.

### 3. Instanced grass tufts — `src/grass.js` (new, ~150-200 lines)

- Seeded scatter: reuse world.js `rng` pattern (import or small local mulberry32 variant with its own seed). ~80k tufts across playable bounds. Reject by `groundZone(...)` != 'grass'. Reject too close to spawn/objects/river/bridge/trees (reuse treeColliders).
- Each tuft = 2 crossed quads (geometry of 2 quads crossed at 90°, each quad ~1.2 m tall × 1.2 m wide). Instanced via `InstancedMesh` with a per-instance color/scale/phase attribute.
- Material: `ShaderMaterial` (or `MeshLambertMaterial` with `onBeforeCompile` injection) supporting:
  - runtime-generated / repo-committed blade sprite texture, `alphaTest: 0.5` (sharp up close, no depth-sort issues)
  - wind sway: tip vertices displaced by `sin(time * frequency + phase) * swayStrength * heightFactor`
  - distance fade: alpha/scale fades with distance from camera (or frustum-aware cull + fade)
  - per-instance tint variation (light green → yellow-green)
- Runtime texture? NO — bake the blade sprite + tiled ground texture as repo assets generated once via Qwen Image 2.1 (see below), then committed under `public/textures/`.

### 4. Wiring
- One call from the world-build path to add the grass group; add the tuft object to scene and update its time uniform in the render loop (cheap).
- Tuning constants live at the top of `src/grass.js` (density, wind, heights, fade distance, colors).

### 5. Generated assets (Qwen Image 2.1, local)
Generated once, reviewed, committed to `public/textures/`:
- `grass_blade.png` — transparent PNG, a clump of blades, sharp alpha edges (for tuft quads)
- `grass_ground.png` — seamless-ish tiled grass ground texture (for terrain `map`)

## Verification
`npm run build` + play in browser — start of match, mid-map near tank, river valley, rim. Check FPS on everyday hardware; adjust density/fade if needed.

## Assets / files summary
- New: `src/ground.js`, `src/grass.js`, `public/textures/grass_blade.png`, `public/textures/grass_ground.png`
- Edited: `src/world.js` (terrain material only), `src/main.js` (grass add/update hook), `README.md`, `AGENTS.md`
