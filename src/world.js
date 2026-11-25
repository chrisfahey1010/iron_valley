// World: 1km x 1km low-poly valley terrain, winding river + placeholder bridge,
// obstacles (rocks/ruins), scenery.
//
// Key design points (extensible for town/farmhouses later):
//  - seeded RNG for deterministic obstacle scatter
//  - river centerline is a pure function of z (riverCenterX) so scenery,
//    water, terrain carve and collision all agree
//  - terrainHeight() includes the bridge deck override, so tanks, shells and
//    camera all ground correctly with zero extra call-site changes
import * as THREE from 'three';
import { regionAt, REGION_COLORS } from './level.js';

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

// ---- Deterministic RNG ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rng = mulberry32(1337);

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

// ---- Obstacles (circles + meshes) ----
function placeObstacles() {
  const list = [];
  let guard = 0;
  while (list.length < 16 && guard++ < 400) {
    const x = (rng() * 2 - 1) * (HALF - 60);
    const z = (rng() * 2 - 1) * (HALF - 60);
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 45) continue;
    if (riverDist(x, z) < 30) continue;
    if (Math.abs(z - BRIDGE.z) < 26 && Math.abs(x - BRIDGE.x) < BRIDGE.halfSpan + 12) continue;
    if (list.some(o => Math.hypot(o.x - x, o.z - z) < 38)) continue;
    list.push({ x, z, r: 2.6 + rng() * 1.6, kind: rng() < 0.65 ? 'rock' : 'ruin', seed: rng() * 100 });
  }
  return list;
}
export const obstacles = placeObstacles();

// Collision circles — registered by src/objects.js during placement.
export const treeColliders = [];
export const farmhouseColliders = [];
export const objectColliders = [];

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

  // Obstacles
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const ruinMat = new THREE.MeshLambertMaterial({ color: 0x6b6257, flatShading: true });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x6e6257, flatShading: true });
  for (const o of obstacles) {
    const base = terrainHeight(o.x, o.z);
    const r = mulberry32(Math.floor(o.seed * 1e6));
    if (o.kind === 'rock') {
      const m = new THREE.Mesh(rockGeo, rockMat);
      m.position.set(o.x, base + o.r * 0.55, o.z);
      m.scale.set(o.r, o.r * 0.85, o.r * 0.9);
      m.rotation.set(r() * 0.6, r() * Math.PI, r() * 0.4);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    } else {
      for (let i = 0; i < 3; i++) {
        const hgt = 1.6 + r() * 1.6;
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, hgt, 1.8), ruinMat);
        const ang = (i / 3) * Math.PI * 2 + r() * 0.5;
        w.position.set(o.x + Math.cos(ang) * o.r * 0.5, base + hgt / 2, o.z + Math.sin(ang) * o.r * 0.5);
        w.rotation.y = ang;
        w.castShadow = true; w.receiveShadow = true;
        scene.add(w);
      }
    }
  }
}

export function isOnBridge(x, z) {
  return inBridgeSpan(x, z);
}

// Tank collision: push circle out of obstacles, tree colliders, river bank, and border.
export function resolveObstacles(pos, radius) {
  for (const list of [obstacles, treeColliders, farmhouseColliders, objectColliders]) {
    for (const o of list) {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + radius;
      if (d < min && d > 0.001) {
        const push = min - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      }
    }
  }
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
