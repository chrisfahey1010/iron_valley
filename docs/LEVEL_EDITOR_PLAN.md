# Iron Valley — Level Editor MVP Implementation Plan

Audience: the agent implementing this. Read this whole file before writing code.
This plan describes the target end state. When in doubt, implement the plan, not
the minimal thing that compiles.

## Goal

A 2D top-down level editor for the Iron Valley scene, served as a separate page
in the same Vite app. Humans place and edit terrain zones, roads, spawn points
and world objects; LLM agents edit the same on-disk level file directly. The
game loads the level file at startup instead of running procedural scatter.

Key requirements (from the user):
- 2D top-down view of the map with spawn points for player AND enemies (draggable, editable).
- Terrain regions: painting a region to e.g. "pasture" or "crops" changes the
  ground texture and region-dependent ground sprites (grass etc.) for that area.
  Regions affect GROUND TEXTURE and GROUND-BASED SPRITES ONLY — not object scatter,
  collision, or elevation.
- Roads: polyline strokes with width (gravel/dirt). Roads render as strokes.
- Objects (trees, farmhouses, etc.): place/move/rotate/delete in the editor.
- I want a Save button that overwrites the level file — simple, works well, done.
- Remove existing procedural scatter (trees/farmhouses/rocks/ruins become level
  objects). Grass stays but is regional (see below).
- New assets added later should show up in the editor palette automatically
  (manifest-driven).
- Export the current procedural world into the first level.json (best effort —
  if full export balloons scope, fall back to a hand-exported-ish initial level).

Non-goals (explicit):
- Ground elevation / heightmaps.
- 3D preview in the editor.
- Texture authoring for region types beyond flat tints (MVP uses flat-color
  region tint + road stroke texture; richer textures later).
- Raster painting of regions. Regions are polygons; roads are polylines.

## Decisions (locked)

1. Same Vite app, separate page: `index.html` = game, `editor.html` = editor.
   Editor imports ONLY world/asset metadata from `src/` (scale.js, world.js
   constants, terrain height function, asset manifest) — no tanks/AI/HUD code.
2. Single JSON file, human- and agent-readable: `public/level.json`.
   The agent's interface is this file. No live API bridge for MVP.
3. Terrain: vector polygon regions + vector polyline roads. Painting =
   click-point-append / close polygon.
4. 2D view only; no 3D preview for MVP.
5. Save = editor "Save" button writes `public/level.json`. In dev mode this
   needs a tiny Vite middleware (see below); in a static build, the button
   downloads the file (manual commit). A plain `<input type=file>` load-back is
   acceptable for MVP if the middleware proves flaky — but the POST-to-file
   endpoint is preferred so "Save" just overwrites the saved level.

## Level file format — `public/level.json`

```jsonc
{
  "version": 1,
  "name": "Iron Valley",
  "terrain": {
    "regions": [
      { "id": "pasture-1", "type": "pasture", "points": [[x, z], [x, z], ...] }
    ],
    "roads": [
      { "id": "road-gravel-1", "type": "gravel", "widthM": 4,
        "points": [[x, z], [x, z], ...] }
    ]
  },
  "spawns": {
    "player":  { "x": -60, "z": -350, "heading": 0 },
    "enemies": [ { "x": -120, "z": -260, "heading": 3.1416 } ]
  },
  "objects": [
    { "id": "tree-17", "type": "tree",      "x": 12.3,  "z": -88.1,
      "rotation": 1.05, "scale": 1.1 }
  ]
}
```

- Coordinates are world meters, same origin/axes as the game (x east, z south,
  origin at world center; 1 unit = 1 m). Document this in AGENTS.md.
- `scale` on objects is a multiplier on the asset's manifest default size.
- `objects[].id` is stable and unique; agents must preserve ids when editing.
- `regions[].type` and `roads[].type` must be in the REGION/ROAD type tables
  (see below). Keep the enum small for MVP: regions `grasslands` (default/empty),
  `pasture`, `crops`, `clearing`; roads `gravel`, `dirt`.
- A point is `[x, z]` in meters.

## Editor page: `editor.html` (Vite multi-page)

Vite config currently is a single page. Add a build entry for `editor.html`
(`build.rollupOptions.input`) so `npm run build` produces both pages.

### Layout
```
┌────────────────────────────────────────────────────────┐
│  Iron Valley · Level Editor    [Save] [Reset] [Load]   │
├──────────┬──────────────────────────────┬──────────────┤
│ Palette  │  2D viewport (Canvas)        │ Properties   │
│ - regions│  (pan/zoom, grid, cursor     │ - selected   │
│ - roads  │   coords, hit-testing)       │   object/region│
│ - objects│                              │   Editable     │
│ - spawns │                              │ - spawns       │
└──────────┴──────────────────────────────┴──────────────┘
```

### Viewport (Canvas 2D)
- World-to-screen transform with pan (drag empty space / middle-mouse) and
  zoom (wheel, clamp ~[2, 120] px/m-ish range; make it comfortable for a 1 km map).
- Grid lines every 100 m (major) / 25 m (minor), world-origin crosshair.
- Draw order: region fills (flat color per type) → road strokes (line +
  subtle darker edge) → water/river/bridge overlays (read riverCenterX + current
  BRIDGE from world.js so the editor matches the game) → object footprints
  (type-tinted rect/circle + id label) → spawn markers (player = green chevron
  oriented by heading, enemies = red chevrons) → selection highlight +
  drag-move handles.
- Hit-testing: objects (radius from manifest footprint), roads (distance to
  polyline < width/2 + slack), regions (point-in-polygon), spawns (circle).
- Click-to-place: with a palette tool active, click places the item (object or
  spawn) or adds a point to the active region/road; second click starts region
  drawing, right-click / Enter closes it; road closes with Enter (or keeps
  being painted with Esc/Enter to stop).
- Drag-to-move: select an object/spawn and drag it; drag a region/road vertex
  to edit points.
- Keyboard: Delete (selected object), R (rotate selected object 15°), Ctrl+Z
  (undo, in-memory snapshot stack — keep it simple: 20-deep snapshot stack of
  the whole level), Escape (cancel in-progress draw), arrows nudge (1 m, 10 m
  with shift).
- Selection panel: form for position/rotation/scale of objects; player/enemy
  spawn x/z/heading editing; region/road id/type/width.
- Palette:
  - Objects: one button per entry in the asset manifest (extensible — see below).
  - Terrain: region types (pasture, crops, clearing) — click a type, drag a
    polygon. The "grasslands" default region is implicit (no explicit polygon).
  - Roads: gravel and dirt — click to start, keep clicking to append, Enter to finish.
  - Spawns: Place Player Spawn, Place Enemy Spawn, Select Spawn mode.

### Auto-discovery (the "new assets show up automatically" requirement)
Extend `src/scale.js`:
```js
export const ASSETS = {
  tree:       { url, kind:'tree', heightM:10,
                editor: { category:'object', footprintR:0.9, collidable:true, color:'#3a6b3f' } },
  farmhouse:  { ..., editor: { category:'object', footprintR:7,  collidable:true, color:'#8a5a3b' } },
  tank_6:     { ..., editor: { category:'vehicle', footprintR:2.4, collidable:true, color:'#4a6b4a' } },
  ...
};
```
The editor's object palette renders from `Object.entries(ASSETS).filter(e => e.editor?.category === 'object')`.
To add a new asset to the game (game code) you add an entry to ASSETS with an
`editor` block — the editor picks it up with zero editor-code changes. Tanks
(vehicles) are NOT placed via the editor (they're game state); add
`category: 'vehicle'` to exclude them.

### Save mechanism (dev)
Vite `vite.config.js` middleware plugin: POST to `/__level-save` with the full
level JSON → middleware overwrites `public/level.json` → return 200. Static
builds: the Save button falls back to `download level.json` (manual commit).
No backend, no server-side state.

## Game integration — consume the level file

`src/level.js` (new, shared):
- `loadLevel()` → Promise<level> — fetches `/level.json`, validates lightly
  (version, spawn presence, object types known). Returns a safe default
  (procedural-ish: plain grasslands + spawn + no objects) on load failure so
  the game never hard-fails on a missing file.
- `regionAt(x, z)` — returns region type at a point (default `grasslands`);
  point-in-polygon for regions. Roads are separate: `roadAt(x, z)` via distance
  to any road polyline < width/2.
- Validation: reject unknown region/road/object types and unknown object
  fields with console warnings but keep the level usable.

`src/world.js` changes:
- `buildWorld(scene, level)` — terrain geometry unchanged (still height-based),
  but ground texture/vertex colors driven by region at each vertex. Base color
  = flat-color tint per region (grasslands = current green-ish, pasture = tan/
  olive, crops = rich brown-green, clearing = dusty tan). River channel carve
  unchanged. Keep riverbed/bank overrides regardless of region painting.
- `obstacles` and scatter arrays (trees/farmhouses) — REMOVED as module-level
  data. Collisions come from level.json objects. `resolveObstacles` reads
  objects from the loaded level (with each object's collider radius from the
  manifest).
- Trees/farmhouses/obstacles: `src/tree.js` and `src/farmhouse.js` become
  thin loaders + instance factories; `placeTrees`/`placeFarmhouses` are removed.
  New `src/objects.js` (new) renders level objects from manifest + level.json,
  registering colliders in the same shape ({ x, z, r }).
- `src/ground.js` — `groundZone` becomes region-aware: pasture/crops/clearing
  → 'clearing' zone (no grass); grasslands → 'grass'. Grass renders only in
  grasslands regions. (Keep 'water'/'riverbank'/'rim' overrides regardless.)
- `src/main.js` — spawns loaded from level.json. `SPAWN`/`SPAWN_HEADING` become
  defaults for the pre-load state; `createPlayer()`/`makeEnemies()` read
  level.spawns. Grass created AFTER level load, passing the level + region fn.

Grass (`src/grass.js`):
- Read the region at each candidate scatter point; cull non-grasslands points.
- Region sprites are future work (MVP: flat tints + no grass in pasture/crops;
  'crops' gets a subtle ground tint; richer per-region sprites are a later pass).
- No changes to grass fragment shader or lighting.

River/bridge/obstacles that are NOT level objects (none for MVP — rocks/ruins
are rocks/ruins, keep as ambient scatter? NO — see below):
- Rocks/ruins: they are world objects. MVP: EXCLUDE rocks/ruins from level.json
  for now (keep buildWorld's obstacle rendering as the static ambient decoration
  that it is today). Level objects start with tree/farmhouse. Add rock/ruin
  support in the editor in a follow-up if desired. This keeps the MVP small.

## First level.json — export of the current procedural world

Script `scripts/export_level.mjs` (plain Node, no deps; reads only world.js/
scale.js constants + a few math helpers replicated inline):
- Re-runs the current deterministic scatter (same mulberry32(1337) + seed
  sequence) for trees/farmhouses/obstacles to produce the initial object list.
  It does not import the built game; it reproduces the same seed and loop
  structure, or imports world.js via a small vite-node/esm loader if that is
  easy. If that proves too coupled, hand-author the first level.json with a
  small sample + a few trees/farmhouses placed sensibly (spawn-clear), and mark
  the full export as a follow-up.
- Also produces: spawns.player (current -60,-350), spawns.enemies (current 4
  hardcoded spots), one starter region (`grasslands` — default, no polygon),
  no roads yet, no regions beyond that.
- Validate by loading the game + editor in the browser and comparing.

## Testing & verification

- `npm run build` passes (both pages build).
- Editor opens (`/editor.html`), can place/move/select objects & spawns, paints
  a region and a road, and Save overwrites public/level.json.
- `npm run dev` game loads the saved level.json; player spawns at player spawn,
  enemies at enemy spawns; grass does NOT spawn in pasture/crops; region tints
  visible; objects visible and collidable.
- Full-cycle check: edit level.json in editor → Save → hard-reload game → see
  the same layout.

## Implementation sequence (small verifiable passes)

1. Level format + `src/level.js` (load/validate/regionAt/roadAt) + minimal editor
   shell (page renders, pan/zoom canvas works, nothing else).
2. Editor: spawn markers (player + enemies) — place, drag, edit heading.
   Game: load spawns from level.json.
3. Editor: object palette (tree, farmhouse) — place, drag, rotate, delete,
   save. Game: load objects, render, register colliders; remove procedural
   scatter.
4. Editor: terrain regions (paint polygon, assign type) + roads (polyline) —
   save. Game: region-aware ground coloring + grass culling.
5. `scripts/export_level.mjs` + initial `public/level.json` (or hand-authored
   fallback). `AGENTS.md`/`README.md` sync. `npm run build`.

## Pitfalls / constraints

- Keep it single-page Vite + three.js; no backend, no bundling of new deps.
- Do NOT commit secrets/keys into level.json. Do NOT hand-edit `dist/`.
- Region painting must not silently bake in height data; terrainHeight stays
  fixed. Level objects sit on existing terrainHeight.
- Object ids: keep stable; agents must not regenerate ids on save.
- Grass: do NOT remove the fragment-shader world-up normal fix.
- Editor must NOT import game gameplay code (tanks/AI/HUD).
- Level file is the source of truth: when the game loads, scatter loops and
  hardcoded SPAWN/enemy spots must be REMOVED, not run conditionally.
