// Farmhouse model loading + placement. One GLB source; per-instance clones.
// Collidable obstacles with simple circle footprints.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, measureRootBbox } from './scale.js';
import {
  terrainHeight, obstacles, SPAWN, farmhouseColliders, HALF,
  riverDist, BRIDGE, rng,
} from './world.js';

const loader = new GLTFLoader();

export async function loadFarmhouseModel() {
  const asset = ASSETS.farmhouse;
  const gltf = await new Promise((res, rej) => loader.load(asset.url, res, undefined, rej));
  const source = new THREE.Group();
  source.add(gltf.scene);
  // scale so the larger horizontal footprint dimension == lengthM (real-world m)
  source.updateWorldMatrix(true, true);
  const bb = measureRootBbox(source);
  const size = bb.getSize(new THREE.Vector3());
  const s = asset.lengthM / Math.max(size.x, size.z);
  source.scale.setScalar(s);
  source.updateMatrixWorld(true);
  return source;
}

function rootedBase(x, z, baseRadius = 1.5) {
  let h = terrainHeight(x, z);
  for (const dx of [-baseRadius, baseRadius]) for (const dz of [-baseRadius, baseRadius]) {
    h = Math.max(h, terrainHeight(x + dx, z + dz));
  }
  return h;
}

function tooCloseToObstacle(x, z, extra = 2) {
  for (const o of obstacles) {
    if (Math.hypot(x - o.x, z - o.z) < o.r + extra) return true;
  }
  return false;
}

function tooCloseToRiver(x, z) {
  // farmhouses sit on dry land; keep well clear of the channel
  return riverDist(x, z) < 40;
}

function tooCloseToBridge(x, z) {
  return Math.abs(z - BRIDGE.z) < BRIDGE.halfWidth + 10 &&
         Math.abs(x - BRIDGE.x) < BRIDGE.halfSpan + 14;
}

function makeFarmhouseInstance(source, x, z, heightVariance = 1) {
  const inst = source.clone(true);
  const base = rootedBase(x, z);
  inst.position.set(x, base - 0.15, z);
  inst.rotation.y = rng() * Math.PI * 2;
  inst.scale.multiplyScalar(heightVariance);
  inst.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return inst;
}

// Scatter farmhouses: a few near the player spawn (~55–120m), the rest across
// the valley. ~12 total. Colliders registered for obstacle resolution.
export function placeFarmhouses(scene, source, { count = 12, nearCount = 4 } = {}) {
  farmhouseColliders.length = 0;
  const placed = []; // {x, z, r}

  const farFromEverything = (x, z, minFromPlaced, minFromSpawn) => {
    if (Math.abs(x) > HALF - 40 || Math.abs(z) > HALF - 40) return false;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < minFromSpawn) return false;
    if (tooCloseToObstacle(x, z, 2)) return false;
    if (tooCloseToRiver(x, z)) return false;
    if (tooCloseToBridge(x, z)) return false;
    for (const t of placed) {
      if (Math.hypot(t.x - x, t.z - z) < minFromPlaced) return false;
    }
    return true;
  };

  const addFarmhouse = (x, z) => {
    placed.push({ x, z });
    farmhouseColliders.push({ x, z, r: 8.5 });
    return true;
  };

  // Near group: ring 55–120m around spawn
  let guard = 0;
  let near = 0;
  while (near < nearCount && guard++ < 200) {
    const ang = rng() * Math.PI * 2;
    const rad = 55 + rng() * 65;
    const x = SPAWN.x + Math.cos(ang) * rad;
    const z = SPAWN.z + Math.sin(ang) * rad;
    if (!farFromEverything(x, z, 45, 50)) continue;
    addFarmhouse(x, z);
    near++;
  }

  // Far group: spread across the valley
  guard = 0;
  while (placed.length < count && guard++ < 600) {
    const x = (rng() * 2 - 1) * (HALF - 60);
    const z = (rng() * 2 - 1) * (HALF - 60);
    if (!farFromEverything(x, z, 55, 70)) continue;
    addFarmhouse(x, z);
  }

  for (const t of placed) {
    const scaleVariance = 0.9 + rng() * 0.2;
    scene.add(makeFarmhouseInstance(source, t.x, t.z, scaleVariance));
  }
  return placed.length;
}
