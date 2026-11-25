// Road ribbons — extrude road polylines into flat terrain-conforming strips.
// Dirt roads render tan, gravel roads grey. widthM is per-road (3 m dirt / 4 m gravel).
import * as THREE from 'three';
import { terrainHeight } from './world.js';

export const ROAD_COLORS = {
  dirt: 0xbfa06f,   // tan
  gravel: 0x8d8d88, // grey
};
const LIFT = 0.09;        // meters above terrain
const SAMPLE_STEP = 3;    // meters between centerline samples

function sampleRoad(pts) {
  const samples = []; // { x, z, dx, dz } unit direction
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const ux = dx / len, uz = dz / len;
    const n = Math.max(1, Math.ceil(len / SAMPLE_STEP));
    for (let k = (i === 0 ? 0 : 1); k <= n; k++) {
      const t = k / n;
      samples.push({ x: ax + ux * len * t, z: az + uz * len * t, ux, uz });
    }
  }
  return samples;
}

function buildRoadMesh(road) {
  const half = road.widthM / 2;
  const samples = sampleRoad(road.points);
  if (samples.length < 2) return null;

  const positions = [];
  const uvs = [];
  let dist = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (i > 0) {
      const p = samples[i - 1];
      dist += Math.hypot(s.x - p.x, s.z - p.z);
    }
    // perpendicular in XZ plane
    const px = -s.uz, pz = s.ux;
    const lx = s.x + px * half, lz = s.z + pz * half;
    const rx = s.x - px * half, rz = s.z - pz * half;
    positions.push(lx, terrainHeight(lx, lz) + LIFT, lz);
    positions.push(rx, terrainHeight(rx, rz) + LIFT, rz);
    uvs.push(0, dist, 1, dist);
  }

  const idx = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({
    color: ROAD_COLORS[road.type] ?? 0x9a8460,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export function buildRoads(scene, level) {
  if (!level?.terrain?.roads?.length) return;
  const group = new THREE.Group();
  group.name = 'roads';
  for (const road of level.terrain.roads) {
    const mesh = buildRoadMesh(road);
    if (mesh) group.add(mesh);
  }
  scene.add(group);
}
