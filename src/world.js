// World: 1km x 1km low-poly valley terrain, winding river + placeholder bridge.
//
// Key design points (extensible for town/farmhouses later):
//  - river centerline is a pure function of z (riverCenterX) so scenery,
//    water, terrain carve and collision all agree
//  - terrainHeight() includes the bridge deck override, so tanks, shells and
//    camera all ground correctly with zero extra call-site changes
import * as THREE from 'three';
import { regionAt, pointInPolygon, REGION_COLORS } from './level.js';

export const WORLD_SIZE = 1000;           // terrain plane size (m)
export const HALF = WORLD_SIZE / 2;
export const PLAY_BOUND = 490;            // soft playable border (m from origin)
export const SPAWN = { x: -60, z: -350 };
export const SPAWN_HEADING = 0;           // forward = +Z (toward the river)

// ---- River ----
export const RIVER_HALF_WIDTH = 11;       // water/channel half-width
export const RIVER_EDGE_FALLOFF = 16;     // carve falloff beyond half-width
export function riverCenterX(z) {
  return 120 * Math.sin(z * 0.003 + 0.9) + 40 * Math.sin(z * 0.008 + 2.0);
}
export function riverDist(x, z) {
  return Math.abs(x - riverCenterX(z));
}

// ---- Bridge (placeholder) ----
export const BRIDGE = {
  z: -120,                                 // crossing line
  get x() { return riverCenterX(this.z); },
  halfSpan: 34,                            // long axis (x) half-length
  halfWidth: 5.5,                          // short axis (z) half-length
  deckH: 2.4,
};

function inBridgeSpan(x, z, pad = 0) {
  return Math.abs(z - BRIDGE.z) < BRIDGE.halfWidth + pad &&
         Math.abs(x - BRIDGE.x) < BRIDGE.halfSpan + pad;
}

// ---- Terrain ----
function baseTerrain(x, z) {
  return 3.0 * Math.sin(x * 0.008 + 1.3) * Math.cos(z * 0.006 - 0.6)
       + 5.5 * Math.sin(x * 0.0025 + 0.7) * Math.sin(z * 0.0031 + 0.3)
       + 0.6 * Math.sin(x * 0.045) * Math.sin(z * 0.038 + 2.0);
}

export function terrainHeight(x, z) {
  let h = baseTerrain(x, z);
  // valley rim rise near map edges
  const m = Math.max(Math.abs(x), Math.abs(z));
  h += 16 * THREE.MathUtils.smoothstep(m, 360, HALF - 10);
  // carve river channel
  const d = riverDist(x, z);
  const carveT = 1 - THREE.MathUtils.smoothstep(d, RIVER_HALF_WIDTH - 1, RIVER_HALF_WIDTH + RIVER_EDGE_FALLOFF);
  h = THREE.MathUtils.lerp(h, -2.2, carveT);
  // flatten near spawn
  const sd = Math.hypot(x - SPAWN.x, z - SPAWN.z);
  h *= THREE.MathUtils.clamp((sd - 16) / 34, 0, 1);
  // bridge deck override (smooth edge band)
  const inSpan = Math.abs(x - BRIDGE.x) < BRIDGE.halfSpan + 2 && Math.abs(z - BRIDGE.z) < BRIDGE.halfWidth + 1.5;
  if (inSpan) {
    const ex = THREE.MathUtils.smoothstep(Math.abs(x - BRIDGE.x), BRIDGE.halfSpan - 1.5, BRIDGE.halfSpan + 2);
    const ez = THREE.MathUtils.smoothstep(Math.abs(z - BRIDGE.z), BRIDGE.halfWidth - 1.0, BRIDGE.halfWidth + 1.5);
    const t = Math.max(ex, ez); // 0 fully inside, 1 at/beyond edge
    h = THREE.MathUtils.lerp(BRIDGE.deckH, h, t);
  }
  return h;
}

// Collision circles — registered by src/objects.js during placement.
export const treeColliders = [];      // small trunk circles (leaves are passable)
export const farmhouseColliders = []; // oriented boxes {x,z,rot,halfW,halfD,r}
export const objectColliders = [];
export const deadTankColliders = [];  // wrecks: {x,z,r}

// ---- Spatial index for tree trunks ----
// Trees are the one collider array with thousands of entries; linear scans
// in the per-frame aim predictor and per-shell stepping are the main cost.
// A uniform grid keeps near-queries O(small). Built by placeObjects().
const TREE_GRID_CELL = 24;
let treeGrid = null;

export function rebuildTreeGrid() {
  treeGrid = new Map();
  for (const t of treeColliders) {
    const key = Math.floor(t.x / TREE_GRID_CELL) + ',' + Math.floor(t.z / TREE_GRID_CELL);
    let arr = treeGrid.get(key);
    if (!arr) { arr = []; treeGrid.set(key, arr); }
    arr.push(t);
  }
}

// Return trunk colliders whose circle may reach (x, z) — i.e. within
// radius + t.r of the point (plus small margin). Used hot; do not pass huge radius.
export function treesNear(x, z, radius) {
  if (!treeGrid) return treeColliders; // grid not built yet — fall back to linear
  const reach = radius + 0.2 + 3.0; // max trunk radius (incl. scaled forest rows) + margin
  const minCx = Math.floor((x - reach) / TREE_GRID_CELL), maxCx = Math.floor((x + reach) / TREE_GRID_CELL);
  const minCz = Math.floor((z - reach) / TREE_GRID_CELL), maxCz = Math.floor((z + reach) / TREE_GRID_CELL);
  const out = [];
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const arr = treeGrid.get(cx + ',' + cz);
      if (!arr) continue;
      for (const t of arr) {
        const dx = t.x - x, dz = t.z - z;
        if (dx * dx + dz * dz <= (reach + t.r) * (reach + t.r)) out.push(t);
      }
    }
  }
  return out;
}

// ---- World build ----
export function buildWorld(scene, level = null) {
  // Terrain mesh
  const seg = 220;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cHigh = new THREE.Color(0x8a7a55);  // dry high ground
  const cBed = new THREE.Color(0x3f4a35);   // riverbed
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const regionType = level ? regionAt(level, x, z) : 'grasslands';
    const cBase = new THREE.Color(REGION_COLORS[regionType] ?? REGION_COLORS.grasslands);
    const t = THREE.MathUtils.clamp((h + 2) / 10, 0, 1);
    let c = regionType === 'grasslands'
      ? cBase.clone().lerp(cHigh, t)
      : cBase.clone().lerp(cHigh, t * 0.35);
    const rd = riverDist(x, z);
    if (rd < RIVER_HALF_WIDTH + 4) c = c.clone().lerp(cBed, 0.75 * (1 - THREE.MathUtils.smoothstep(rd, RIVER_HALF_WIDTH - 1, RIVER_HALF_WIDTH + 4)));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const groundTex = new THREE.TextureLoader().load('/textures/grass_ground.png');
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(110, 110);
  groundTex.anisotropy = 4;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: groundTex }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Crops overlay: tilled-soil texture on each crops region, raised just above terrain.
  if (level) {
    const cropsRegions = (level.terrain?.regions || []).filter(r => r.type === 'crops');
    if (cropsRegions.length) {
      const cropsTex = new THREE.TextureLoader().load('/textures/crops_ground.png');
      cropsTex.wrapS = cropsTex.wrapT = THREE.RepeatWrapping;
      cropsTex.anisotropy = 4;
      cropsTex.colorSpace = THREE.SRGBColorSpace;
      const tileMeters = 7; // one soil-texture repeat per N meters
      const cropsMat = new THREE.MeshLambertMaterial({
        map: cropsTex,
        flatShading: true,
      });
      for (const region of cropsRegions) {
        // Grid-sampled overlay: keeps triangles fully inside the region so
        // vertices follow the real terrain height instead of a flat shape.
        const pts = region.points;
        const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        const step = 4;
        const nx = Math.max(2, Math.round((maxX - minX) / step));
        const nz = Math.max(2, Math.round((maxZ - minZ) / step));
        const grid = [];
        const idxArr = [];
        for (let j = 0; j <= nz; j++) {
          for (let i = 0; i <= nx; i++) {
            const x = minX + (maxX - minX) * (i / nx);
            const z = minZ + (maxZ - minZ) * (j / nz);
            grid.push(pointInPolygon(x, z, pts));
          }
        }
        const vidx = (i, j) => (j * (nx + 1) + i);
        // Build index map only for inside vertices
        const indexMap = new Map();
        let w = 0;
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
          if (grid[vidx(i, j)]) indexMap.set(vidx(i, j), w++);
        }
        const verts = [];
        // rebuild verts only for inside vertices
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
          if (!grid[vidx(i, j)]) continue;
          const x = minX + (maxX - minX) * (i / nx);
          const z = minZ + (maxZ - minZ) * (j / nz);
          verts.push(x, terrainHeight(x, z) + 0.09, z);
        }
        for (let j = 0; j < nz; j++) {
          for (let i = 0; i < nx; i++) {
            const a = vidx(i, j), b = vidx(i + 1, j), c = vidx(i + 1, j + 1), d = vidx(i, j + 1);
            if (grid[a] && grid[b] && grid[c] && grid[d]) {
              const ia = indexMap.get(a), ib = indexMap.get(b), ic = indexMap.get(c), id = indexMap.get(d);
              idxArr.push(ia, ic, ib, ia, id, ic);
            }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
        g.setIndex(idxArr);
        const uvs = new Float32Array((verts.length / 3) * 2);
        for (let i = 0; i < verts.length / 3; i++) {
          uvs[i * 2] = verts[i * 3] / tileMeters;
          uvs[i * 2 + 1] = verts[i * 3 + 2] / tileMeters;
        }
        g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, cropsMat);
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }
  }

  // River water ribbon
  const waterPts = [];
  for (let z = -HALF; z <= HALF; z += 12) waterPts.push(z);
  const wVerts = [];
  for (const z of waterPts) {
    const cx = riverCenterX(z);
    wVerts.push(cx - RIVER_HALF_WIDTH, -1.15, z, cx + RIVER_HALF_WIDTH, -1.15, z);
  }
  const wIdx = [];
  for (let i = 0; i < waterPts.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    wIdx.push(a, c, b, b, c, d);
  }
  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wVerts), 3));
  wGeo.setIndex(wIdx);
  wGeo.computeVertexNormals();
  const water = new THREE.Mesh(wGeo, new THREE.MeshLambertMaterial({ color: 0x2e5d74, transparent: true, opacity: 0.86, flatShading: true }));
  water.receiveShadow = true;
  scene.add(water);

  // Bridge: simple placeholder deck + supports
  const bridgeGroup = new THREE.Group();
  const deckGeo = new THREE.BoxGeometry(BRIDGE.halfSpan * 2 + 4, 0.6, BRIDGE.halfWidth * 2 + 2);
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x7a6a4f, flatShading: true });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(BRIDGE.x, BRIDGE.deckH - 0.3, BRIDGE.z);
  deck.castShadow = true; deck.receiveShadow = true;
  bridgeGroup.add(deck);
  const railGeo = new THREE.BoxGeometry(BRIDGE.halfSpan * 2 + 4, 0.9, 0.35);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, new THREE.MeshLambertMaterial({ color: 0x5d5140, flatShading: true }));
    rail.position.set(BRIDGE.x, BRIDGE.deckH + 0.45, BRIDGE.z + side * (BRIDGE.halfWidth + 0.9));
    rail.castShadow = true;
    bridgeGroup.add(rail);
  }
  const supportGeo = new THREE.BoxGeometry(3.2, 4.2, 7.5);
  for (const off of [-14, 0, 14]) {
    const s = new THREE.Mesh(supportGeo, new THREE.MeshLambertMaterial({ color: 0x4c4438, flatShading: true }));
    s.position.set(BRIDGE.x + off, BRIDGE.deckH - 2.4, BRIDGE.z);
    s.castShadow = true; s.receiveShadow = true;
    bridgeGroup.add(s);
  }
  scene.add(bridgeGroup);

}

export function isOnBridge(x, z) {
  return inBridgeSpan(x, z);
}

// Push a circle out of an oriented box. Returns true if pushed.
export function pushOutOfBox(pos, radius, box) {
  const dx = pos.x - box.x, dz = pos.z - box.z;
  const c = Math.cos(box.rot), s = Math.sin(box.rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const qx = Math.max(-box.halfW, Math.min(box.halfW, lx));
  const qz = Math.max(-box.halfD, Math.min(box.halfD, lz));
  const ddx = lx - qx, ddz = lz - qz;
  const d2 = ddx * ddx + ddz * ddz;
  if (d2 > radius * radius) return false;
  let push;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    push = radius - d;
    const ws = Math.sin(box.rot), wc = Math.cos(box.rot);
    // local push vector rotated back to world (three.js Y rotation)
    pos.x += (ddx / d * push * wc + ddz / d * push * ws);
    pos.z += (ddx / d * push * -ws + ddz / d * push * wc);
  } else {
    // inside the box: push out along the smallest penetration axis
    const penX = box.halfW + radius - Math.abs(lx);
    const penZ = box.halfD + radius - Math.abs(lz);
    let localPush = { x: 0, z: 0 };
    if (penX < penZ) localPush = { x: Math.sign(lx || 1) * penX, z: 0 };
    else localPush = { x: 0, z: Math.sign(lz || 1) * penZ };
    const ws = Math.sin(box.rot), wc = Math.cos(box.rot);
    pos.x += localPush.x * wc + localPush.z * ws;
    pos.z += localPush.x * -ws + localPush.z * wc;
  }
  return true;
}

// Tank collision: push circle out of objects, tree trunks, farmhouse boxes, wrecks, river bank, border.
export function resolveObstacles(pos, radius) {
  const nearTrees = treesNear(pos.x, pos.z, radius);
  for (const o of [objectColliders, deadTankColliders]) {
    for (const c of o) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d < min) {
        const push = min - d;
        const nx = d > 0.001 ? dx / d : 1;
        const nz = d > 0.001 ? dz / d : 0;
        pos.x += nx * push;
        pos.z += nz * push;
      }
    }
  }
  for (const t of nearTrees) {
    const dx = pos.x - t.x, dz = pos.z - t.z;
    const d = Math.hypot(dx, dz);
    const min = t.r + radius;
    if (d < min) {
      const push = min - d;
      const nx = d > 0.001 ? dx / d : 1;
      const nz = d > 0.001 ? dz / d : 0;
      pos.x += nx * push;
      pos.z += nz * push;
    }
  }
  for (const b of farmhouseColliders) pushOutOfBox(pos, radius, b);
  // river bank: push out unless on bridge
  if (!inBridgeSpan(pos.x, pos.z)) {
    const rd = riverDist(pos.x, pos.z);
    const min = RIVER_HALF_WIDTH + radius + 0.5;
    if (rd < min) {
      const side = (pos.x - riverCenterX(pos.z)) >= 0 ? 1 : -1;
      pos.x = riverCenterX(pos.z) + side * min;
    }
  }
  // square border
  const max = PLAY_BOUND - radius;
  pos.x = THREE.MathUtils.clamp(pos.x, -max, max);
  pos.z = THREE.MathUtils.clamp(pos.z, -max, max);
}
