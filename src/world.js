// World: low-poly valley terrain, obstacles (rocks, ruins), scenery.
import * as THREE from 'three';
import { ASSETS } from './scale.js';

export const WORLD_SIZE = 120;          // terrain plane size
export const ARENA_RADIUS = 52;         // drivable boundary
export const SPAWN = { x: 0, z: -40 };
export const SPAWN_HEADING = 0;         // forward = +Z

// Deterministic terrain height. Flat near spawn.
export function terrainHeight(x, z) {
  let h = 1.1 * Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.6)
        + 2.2 * Math.sin(x * 0.045 + 1.7) * Math.sin(z * 0.055 + 0.5)
        + 0.5 * Math.sin(x * 0.23) * Math.sin(z * 0.19 + 2.0);
  // ridge along left edge
  h += 3.2 * Math.max(0, 1 - Math.abs(x + 34) / 14);
  // flatten near spawn
  const d = Math.hypot(x - SPAWN.x, z - SPAWN.z);
  const flat = THREE.MathUtils.clamp((d - 8) / 16, 0, 1);
  return h * flat;
}

// Obstacles as circles (for tank/shell collision) plus meshes.
export const obstacles = [
  { x: -14, z: -10, r: 3.4, kind: 'rock' },
  { x: 16,  z: -4,  r: 3.0, kind: 'rock' },
  { x: 2,   z: 6,   r: 2.6, kind: 'ruin' },
  { x: -20, z: 18,  r: 3.6, kind: 'rock' },
  { x: 20,  z: 22,  r: 3.2, kind: 'ruin' },
  { x: -4,  z: 30,  r: 2.8, kind: 'rock' },
  { x: 30,  z: -16, r: 2.6, kind: 'rock' },
  { x: -28, z: 2,   r: 2.4, kind: 'ruin' },
];

export function buildWorld(scene) {
  // Terrain mesh
  const seg = 96;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x4a6b35);
  const cHigh = new THREE.Color(0x8a7a55);
  const cRock = new THREE.Color(0x5d564c);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const t = THREE.MathUtils.clamp((h + 2) / 8, 0, 1);
    const c = cLow.clone().lerp(cHigh, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Obstacles
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const ruinMat = new THREE.MeshLambertMaterial({ color: 0x6b6257, flatShading: true });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x6e6257, flatShading: true });
  for (const o of obstacles) {
    const base = terrainHeight(o.x, o.z);
    if (o.kind === 'rock') {
      const m = new THREE.Mesh(rockGeo, rockMat);
      m.position.set(o.x, base + o.r * 0.55, o.z);
      m.scale.set(o.r, o.r * 0.85, o.r * 0.9);
      m.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.4);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    } else {
      // ruin: a couple of broken walls
      for (let i = 0; i < 3; i++) {
        const hgt = 1.6 + Math.random() * 1.6;
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, hgt, 1.8), ruinMat);
        const ang = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
        w.position.set(o.x + Math.cos(ang) * o.r * 0.5, base + hgt / 2, o.z + Math.sin(ang) * o.r * 0.5);
        w.rotation.y = ang;
        w.castShadow = true; w.receiveShadow = true;
        scene.add(w);
      }
    }
  }

  // Scattered low-poly trees outside the arena (world-scale: total height ~10m)
  const TREE_HEIGHT = ASSETS.tree.heightM; // meters
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4230, flatShading: true });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f5230, flatShading: true });
  for (let i = 0; i < 42; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = ARENA_RADIUS + 6 + Math.random() * 14;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const base = terrainHeight(x, z);
    const h = TREE_HEIGHT * (0.85 + Math.random() * 0.3); // variance in real meters
    const trunkH = h * 0.30;
    const topH = h * 0.70;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.4, trunkH, 5), trunkMat
    );
    trunk.position.set(x, base + trunkH / 2, z);
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(h * 0.17, topH, 6), leafMat
    );
    top.position.set(x, base + trunkH + topH / 2, z);
    top.castShadow = true;
    trunk.castShadow = true;
    scene.add(trunk, top);
  }

  // Boundary ring (subtle)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ARENA_RADIUS, ARENA_RADIUS + 1.6, 64),
    new THREE.MeshBasicMaterial({ color: 0xe0a13c, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  scene.add(ring);
}

// Tank collision: push circle out of obstacles and world bounds.
export function resolveObstacles(pos, radius) {
  for (const o of obstacles) {
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + radius;
    if (d < min && d > 0.001) {
      const push = (min - d);
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }
  const dist = Math.hypot(pos.x - 0, pos.z - 0);
  const maxR = ARENA_RADIUS - radius;
  if (dist > maxR) {
    pos.x *= maxR / dist; pos.z *= maxR / dist;
  }
}
