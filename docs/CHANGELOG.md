# Changelog

## 2026-11-23 — tank visibility & aiming fixes

- **src/tank.js** — Fixed invisible tanks: `Box3.setFromObject(wrapper, false)` returned a garbage bounding box (min.y ≈ -22.89) for the cloned/skinned rig, inflating `wrapper.position.y`. Grounding now derives from the manually measured geometry bounding box (scaled by the normalization factor). Tank now visibly grounds at sane scale (~0.15–0.18) for player and enemies.
- **src/tank.js** — Wreck tint now walks the whole `group` (not just `model`) after turret reparenting, so turret/gun materials darken to `#1c1c1c` on death; the muzzle-flash cone is excluded.
- **src/main.js** — Predicted-impact yellow crosshair now ignores the player in trajectory prediction (matching shell behavior, which skips the owner). Previously the prediction spawned inside the player's own hit sphere and was suppressed by the `hitTank !== player` filter, making the marker almost always hidden.
