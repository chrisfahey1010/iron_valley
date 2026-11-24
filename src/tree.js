// Tree model loading + placement. One GLB source; per-instance clones.
// Instances are rooted at the highest terrain sample under the trunk base
// (slope-safe), stand straight up (rotation around Y only, no tilt),
// and are sunk slightly into the ground so roots never float.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, measureRootBbox } from './scale.js';
import { terrainHeight, ARENA_RADIUS, obstacles, SPAWN, treeColliders } from './world.js';

const loader = new GLTFLoader();

// Load the tree GLB and scale it so its total height equals ASSETS.tree.heightM.
// Returns a pre-scaled wrapper whose children are the imported meshes.
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

// Highest ground sample under the trunk base, so angled/sloped ground can't leave the trunk floating.
function rootedBase(x, z, baseRadius = 0.9) {
  let h = terrainHeight(x, z);
  for (const dx of [-baseRadius, baseRadius]) for (const dz of [-baseRadius, baseRadius]) {
    h = Math.max(h, terrainHeight(x + dx, z + dz));
  }
  return h;
}

function tooCloseToSpawn(x, z) {
  return Math.hypot(x - SPAWN.x, z - SPAWN.z) < 9;
}

function tooCloseToObstacle(x, z, extra = 1.2) {
  for (const o of obstacles) {
    if (Math.hypot(x - o.x, z - o.z) < o.r + extra) return true;
  }
  return false;
}

function makeTreeInstance(source, x, z, heightVariance = 1) {
  const inst = source.clone(true);
  const base = rootedBase(x, z);
  inst.position.set(x, base - 0.35, z);
  inst.rotation.set(0, Math.random() * Math.PI * 2, 0);
  inst.scale.multiplyScalar(heightVariance);
  inst.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return inst;
}

// Scatter trees: forest clusters + random singles. Clusters stay outside the
// arena; singles may fall anywhere on the map (inside the arena allowed) as long
// as they don't crowd the spawn, obstacles, edges, or other trees.
// 69 total by default.
export function placeTrees(scene, source, { count = 69 } = {}) {
  treeColliders.length = 0;
  const groupCount = Math.floor(count * 0.45);
  const singles = count - groupCount;
  const trees = [];

  const addTree = (x, z, collideR) => {
    if (Math.abs(x) > 57 || Math.abs(z) > 57) return false;
    if (tooCloseToSpawn(x, z)) return false;
    if (tooCloseToObstacle(x, z)) return false;
    for (const t of trees) {
      if (Math.hypot(t.x - x, t.z - z) < 3.5) return false;
    }
    trees.push({ x, z });
    treeColliders.push({ x, z, r: collideR });
    return true;
  };

  // Forest clusters outside the arena
  const clusterCenters = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const rad = ARENA_RADIUS + 9 + Math.random() * 10;
    clusterCenters.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad });
  }
  let clusterPlaced = 0, guard = 0;
  while (clusterPlaced < groupCount && guard++ < groupCount * 5) {
    const c = clusterCenters[Math.floor(Math.random() * clusterCenters.length)];
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 5.5;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    const before = trees.length;
    if (addTree(x, z, 0.95) && trees.length > before) clusterPlaced++;
  }

  // Random singles anywhere on the map (arena allowed, but only ~20 inside)
  let insideArena = 0;
  for (let i = 0; i < singles * 3 && trees.length < count; i++) {
    const x = (Math.random() * 2 - 1) * 55;
    const z = (Math.random() * 2 - 1) * 55;
    const inside = Math.hypot(x, z) < ARENA_RADIUS;
    if (inside && insideArena >= 20) continue;
    const before = trees.length;
    if (!addTree(x, z, 0.95)) continue;
    if (inside) insideArena++;
  }

  for (const t of trees) {
    const heightVar = 0.85 + Math.random() * 0.3;       // 8.5–11.5 m variance
    scene.add(makeTreeInstance(source, t.x, t.z, heightVar));
  }
  return trees.length;
}
