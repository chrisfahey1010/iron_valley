# Tank Rig & Animation — Reference for Future Asset Creation

How the game drives the CC0 tanks (`tank_1/2/3/4`) and the contract any future
Blender-authored tank must satisfy. Source of truth: `src/tank.js`, `src/scale.js`,
`src/main.js`; assets under `public/models/`.

## Runtime rig stack (what the game builds per tank)

```
scene
└─ group (hullGroup, rotation.order = 'YXZ': yaw -> pitch -> roll)
   └─ wrapper (rotation.y = PI/2; scale = lengthM / max(x,z); position.y = -minY*s)
      └─ model (cloned GLB scene, materials cloned, fixSkeletons())
         └─ turretGroup (at turret node pivot, reparented via attach())
            └─ turret node (Tank_Turret)
            └─ barrelPivot (group at gun node local pos, attach(gunNode))
               └─ gun node (Tank_Gun)
                  └─ muzzle (Object3D at far end of gun's long axis)
                     └─ flash cone (hidden; scaled 1/worldScale)
```

Key points:

- **Wrapper** exists to fix size + grounding. `wrapper.rotation.y = PI/2` converts
  the GLB's forward (local **-X**) to world **+Z** (game convention: hull forward = +Z).
- **Turret yaw**: the turret/gun are reparented under `turretGroup` at the turret
  pivot; `turretGroup.rotation.y = turretLocalYaw` (world-stored yaw relative to hull).
  The turret node itself only ever carries yaw — never pitch.
- **Barrel pitch**: applied to `barrelPivot` via `quaternion.setFromAxisAngle(barrelAxis, pitch)`.
  `barrelAxis` is derived at load time from the actual muzzle direction
  (`cross(muzzleDir, up)` in turret-local space) — **never pitch the gun about turret-local X**.
  Positive pitch raises the tip. Turret pitch is intentionally absent.
- **Muzzle**: Object3D placed at the far end of the gun's longest axis (farther from the
  turret pivot), by bbox comparison. Spawns flash cone + is the aim/muzzle world-pos anchor.
- **Grounding**: hull pose reads terrain heights at nose/tail/left/right (e=1.4m) and applies
  `rotation.x = atan2(hB - hF, 2e) * 0.8`, `rotation.z = atan2(hL - hR, 2e) * 0.8 + wreckTilt`.

## Animations

GLB ships an armature (`TankArmature`) driving the tread track meshes only.
Clips (4, looping): `Tank_Forward`, `Tank_Backwards`, `Tank_TurningLeft`, `Tank_TurningRight`
(stored as `TankArmature|Tank_Forward` — code splits on `|`).

Each clip animates Track nodes (`TankTrackN.L/R`) with translations (tread roll) plus
rotations on a few nodes (track-wheel spin, e.g. `TankTrack8.L`, `TankTrack6.L/R`, `TankTrack7`,
`TankTrack18`, `TankTrack19`). The turret is **not** animated — it is driven purely by code.

`Tank.setMotion(target)` maps input to clips (`forward`/`backwards`/`left`/`right`), fades the
old clip out over 0.18s and fades the new one in. `mixer.update(dt)` runs every frame in
`setPose`. Track clips only touch tread nodes; you can safe-add clips but the game only picks
up clips matching `/^Tank_(Forward|Backwards|TurningLeft|TurningRight)$/`.

Materials are cloned per instance; skinned meshes get their skeleton remapped in `fixSkeletons`.

## Contract for a Blender-built tank

Export a GLB that satisfies:

1. **Orientation**: hull forward = -X (the runtime rotates wrapper by +90° about Y). Up = +Y.
2. **Named nodes** (exact strings):
   - `Tank_Turret` — turret root, pivot at the turret's rotation axis (bottom center).
   - `Tank_Gun` — gun root, hinged at the gun pivot point. The gun must be positioned so its
     pivot is where it attaches to the turret; the runtime reparents it under `barrelPivot`.
   - `Tank_body` — hull body (only used as a mesh/parent aid; not required).
   - Optional but expected: tread track node names `TankTrack1.L/R … TankTrackN.L/R` — every
     tread segment is an armature joint/mesh animated by the four clips.
3. **Armature**: bone names must match the tread joint names above; root bone `Root`.
   Animation clips must contain translations (+ some rotations) for the track nodes so treads
   visibly roll. Forward/Backwards should mirror travel direction; TurningLeft/Right mirror the
   left/right differential. Same clip length for all four, looped, fps-independent.
4. **Animations**: all 4 clips named exactly `Tank_Forward`, `Tank_Backwards`, `Tank_TurningLeft`,
   `Tank_TurningRight`, on the armature (they'll export as `TankArmature|Tank_*`).
5. **Static turret/gun not animated** — yaw and pitch are code-driven. Don't bake turret motion
   into clips; it would conflict with `turretGroup`/`barrelPivot`.
6. **Scale**: author at real-world meters or export 1 unit = 1 m; the loader scales so footprint
   long axis == `lengthM` (6 m by default). Origin should be at the ground/contact point of the hull
   (the loader grounds via measured bbox min.y, but origin at ground makes authoring cleaner).
7. **No materials/textures needed by the game** — materials are cloned at runtime; keep PBR or
   basic materials with clean names. Shadows enabled by loader.
8. Add to `src/scale.js` (`ASSETS`, kind `tank`, `lengthM`) and drop the GLB under `public/models/`.

## Pitfalls observed in current assets

- GLB long axis is not axis-aligned — do not assume X/Z orientation from the bbox; the loader
  re-bases grounding from geometry bboxes, not bbox of the whole scene.
- `Box3.setFromObject` gives wrong min.y for cloned/skinned rigs — loader uses geometry bboxes.
- Skeleton must be remapped after clone (`fixSkeletons`) or animations don't play.
- Clip name prefix `TankArmature|` is expected — split on `|`, not on `.`.
- Treads animated via translation (+rotation) — do NOT animate spin via bone roll quaternion
  around the wrong local axis or treads will wobble.

## Worked examples: tank_5 (Panzer IV) & tank_6 (M24 Chaffee)

`tank_6` (`public/models/tank_6_m24_chaffee.glb`, player) — built by `assets_src/m24_chaffee/build_m24_chaffee.py`; same contract (armature root `Root`, tread bones `TankTrack{1,2}.{L,R}`, 1 s looped clips, `export_yup=True`), authored at 1 unit = 1 m with ~5 m footprint.

## Worked example: tank_5 (Panzer IV)

`public/models/tank_5_panzer_iv.glb` — stylized low-poly Panzer IV, 4th enemy slot
(`assets_src/panzer_iv/build_panzer_iv.py`). Authored in Blender (Z-up, X=length, Y=width,
Z=up) and exported with `export_yup=True` (maps Blender (X,Y,Z) → glTF (X,Z,−Y)); 1 unit = 1 m.
All track meshes are baked to actual size and parented to their bones
(`TankTrack1/2.L/R`) via computed `matrix_parent_inverse` — Blender does not auto-compute it.
Idle treads are static in the GLB; `setMotion()` drives the four clips. Turret and gun are
code-driven (never baked into clips). Original build pitfalls discovered (kept here so they don't
get re-triremeed): bone-parenting without `matrix_parent_inverse`, and exporting a Y-up-authored
build as if Blender were Y-up.
