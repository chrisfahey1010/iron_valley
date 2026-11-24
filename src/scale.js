// World-scale manifest. Every asset declares its real-world size in meters;
// loaders scale imported geometry so it matches. 1 game unit = 1 meter.
//
// Usage:
//   - New imported asset: add an entry here with its real-world size.
//   - Per-instance override: pass { lengthM: ... } / { heightM: ... } to the
//     loader/constructor to place a custom-sized instance.
//
// Kinds: 'tank' (scale so its footprint long axis == lengthM),
//        'tree' (scale so total height == heightM), 'props' (manual targetMeters).

import * as THREE from 'three';

export const ASSETS = {
  tank_1:             { url: 'models/tank_1.glb',          kind: 'tank', lengthM: 6 },
  tank_2:             { url: 'models/tank_2_sherman.glb',  kind: 'tank', lengthM: 6 },
  tank_3:             { url: 'models/tank_3.glb',          kind: 'tank', lengthM: 6 },
  tank_4:             { url: 'models/tank_4.glb',          kind: 'tank', lengthM: 6 },
  tank_5:             { url: 'models/tank_5_panzer_iv.glb', kind: 'tank', lengthM: 6 },
  tree:               { url: 'models/tree_conifer.glb', kind: 'tree', heightM: 10 },
  farmhouse:          { url: 'models/farmhouse.glb', kind: 'props', lengthM: 14 },
};

export const DEFAULT_TANK_LENGTH = 6; // meters

// Collision radius for a tank at `lengthM` (approx half-width + a little slop).
export function tankRadius(lengthM = DEFAULT_TANK_LENGTH) {
  return lengthM * 0.30;
}

// Measure a subtree's bounding box in world space (post-rotation/scale).
export function measureRootBbox(root) {
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (o.isMesh && o.geometry && !o.geometry.boundingBox) o.geometry.computeBoundingBox();
  });
  const bb = new THREE.Box3();
  const tmp = new THREE.Vector3();
  root.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.boundingBox) {
      const g = o.geometry.boundingBox;
      for (const x of [g.min.x, g.max.x]) for (const y of [g.min.y, g.max.y]) for (const z of [g.min.z, g.max.z]) {
        tmp.set(x, y, z).applyMatrix4(o.matrixWorld);
        bb.expandByPoint(tmp);
      }
    }
  });
  return bb;
}

// Scale a wrapper so the larger of its horizontal footprint dimensions (x/z,
// world axes) equals targetMeters. Returns the scale factor.
export function scaleToHorizontalFit(wrapper, targetMeters) {
  wrapper.updateWorldMatrix(true, true);
  const bb = measureRootBbox(wrapper);
  const size = bb.getSize(new THREE.Vector3());
  const s = targetMeters / Math.max(size.x, size.z);
  return { scale: s, bbox: bb, size };
}
