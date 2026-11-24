// Tree model loading + placement. One GLB source; per-instance clones.
// Deterministic-ish placement, avoid spawn/river/bridge/obstacles.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, measureRootBbox } from './scale.js';
import { terrainHeight, obstacles, SPAWN, treeColliders, HALF, riverDist, BRIDGE, rng } from './world.js';

const loader = new GLTFLoader();

export async function loadTreeModel() {
  const asset = ASSETS.tree;
  const gltf = await new Promise((res, rej) => loader.load(asset.url, res, undefined, rej));
  const source = new THREE.Group();
  source.add(gltf.scene);
  const s = asset.heightM / measureRootBbox(source).getSize(new THREE.Vector3()).y;
  source.scale.setScalar(s);
  source.updateMatrixWorld(true);
  return source;
}

function rootedBase(x, z, baseRadius = 0.9) {
  let h = terrainHeight(x, z);
  for (const dx of [-baseRadius, baseRadius]) for (const dz of [-baseRadius, baseRadius]) {
    h = Math.max(h, terrainHeight(x + dx, z + dz));
  }
  return h;
}

function tooCloseToSpawn(x, z) {
  return Math.hypot(x - SPAWN.x, z - SPAWN.z) < 20;
}

function tooCloseToObstacle(x, z, extra = 1.2) {
  for (const o of obstacles) {
    if (Math.hypot(x - o.x, z - o.z) < o.r + extra) return true;
  }
  return false;
}

function tooCloseToRiver(x, z) {
  return riverDist(x, z) < 22;
}

function tooCloseToBridge(x, z) {
  return Math.abs(z - BRIDGE.z) < BRIDGE.halfWidth + 8 &&
         Math.abs(x - BRIDGE.x) < BRIDGE.halfSpan + 10;
}

function makeTreeInstance(source, x, z, heightVariance = 1) {
  const inst = source.clone(true);
  const base = rootedBase(x, z);
  inst.position.set(x, base - 0.35, z);
  inst.rotation.set(0, rng() * Math.PI * 2, 0);
  inst.scale.multiplyScalar(heightVariance);
  inst.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return inst;
}

// Scatter trees: valley-edge clusters + random singles. ~130 total by default.
export function placeTrees(scene, source, { count = 130 } = {}) {
  treeColliders.length = 0;
  const groupCount = Math.floor(count * 0.45);
  const singles = count - groupCount;
  const trees = [];

  const addTree = (x, z, collideR) => {
    if (Math.abs(x) > HALF - 30 || Math.abs(z) > HALF - 30) return false;
    if (tooCloseToSpawn(x, z)) return false;
    if (tooCloseToObstacle(x, z)) return false;
    if (tooCloseToRiver(x, z)) return false;
    if (tooCloseToBridge(x, z)) return false;
    for (const t of trees) {
      if (Math.hypot(t.x - x, t.z - z) < 3.5) return false;
    }
    trees.push({ x, z });
    treeColliders.push({ x, z, r: collideR });
    return true;
  };

  // Clusters near valley rim / edges
  const clusterCenters = [];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const rad = 300 + rng() * 180;
    clusterCenters.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad });
  }
  let clusterPlaced = 0, guard = 0;
  while (clusterPlaced < groupCount && guard++ < groupCount * 6) {
    const c = clusterCenters[Math.floor(rng() * clusterCenters.length)];
    const a = rng() * Math.PI * 2;
    const r = rng() * 6.5;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (addTree(x, z, 0.95)) clusterPlaced++;
  }

  // Singles scattered everywhere (spawn-clear)
  let guard2 = 0;
  while (trees.length < count && guard2++ < count * 4) {
    const x = (rng() * 2 - 1) * (HALF - 40);
    const z = (rng() * 2 - 1) * (HALF - 40);
    if (!addTree(x, z, 0.95)) continue;
  }

  for (const t of trees) {
    const heightVar = 0.85 + rng() * 0.3;
    scene.add(makeTreeInstance(source, t.x, t.z, heightVar));
  }
  return trees.length;
}
