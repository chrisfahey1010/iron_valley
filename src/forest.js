// Seeded forest tree scatter — pure level logic, shared by editor and game.
// Generated trees are written into level.objects (ids `<regionId>-tree-N`)
// so no randomness happens at runtime. Regenerate by deleting those objects
// and calling generateForestTrees again.
import { riverDist, RIVER_HALF_WIDTH } from './world.js';

export const DEFAULT_FOREST_DENSITY = 50; // trees per 100m x 100m tile
export const MIN_TREE_SPACING = 3;        // m between tree trunks

export function forestTreeIdPrefix(regionId) {
  return `${regionId}-tree-`;
}

export function regionArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(a / 2);
}

export function polygonBBox(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1];
    const xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function isClearOfRoads(level, x, z) {
  for (const r of level.terrain.roads) {
    const half = r.widthM / 2 + 2;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (distToSegment(x, z, r.points[i][0], r.points[i][1], r.points[i + 1][0], r.points[i + 1][1]) < half) return false;
    }
  }
  return true;
}

function isClearOfSpawns(level, x, z) {
  const p = level.spawns?.player;
  if (p && Math.hypot(x - p.x, z - p.z) < 15) return false;
  for (const e of level.spawns?.enemies || []) {
    if (Math.hypot(x - e.x, z - e.z) < 15) return false;
  }
  return true;
}

// Trees are placed in a seeded pattern so regeneration is reproducible.
// Returns { trees, target, placed, failed } — `failed` trees could not be
// placed after the attempt budget (dense density in a thin polygon).
export function generateForestTrees(level, region, { density = null, excludeIds = null } = {}) {
  const pts = region.points;
  const area = regionArea(pts);
  const d = density ?? (region.density > 0 ? region.density : DEFAULT_FOREST_DENSITY);
  const target = Math.round(d * area / 10000);
  const trees = [];
  if (target <= 0 || area < 100) return { trees, target: 0, placed: 0, failed: 0 };

  const seed = hashSeed(`${region.id}:${region.seed ?? 1}`);
  const rand = mulberry32(seed);
  const { minX, maxX, minZ, maxZ } = polygonBBox(pts);

  // Existing objects (other trees, farmhouses, etc.) to avoid.
  const others = (level.objects || []).filter(o => !excludeIds || !excludeIds.has(o.id));
  const placements = [];

  const maxAttempts = target * 40;
  for (let i = 0; i < maxAttempts && trees.length < target; i++) {
    const x = minX + rand() * (maxX - minX);
    const z = minZ + rand() * (maxZ - minZ);
    if (!pointInPolygon(x, z, pts)) continue;
    if (riverDist(x, z) < RIVER_HALF_WIDTH + 4) continue;
    if (!isClearOfRoads(level, x, z)) continue;
    if (!isClearOfSpawns(level, x, z)) continue;
    let blocked = false;
    for (const o of others) {
      const clearance = o.type === 'tree' ? MIN_TREE_SPACING : 3; // tree↔tree no-overlap; other props get clearance
      if (Math.hypot(x - o.x, z - o.z) < clearance) { blocked = true; break; }
    }
    if (blocked) continue;
    for (const p of placements) {
      if (Math.hypot(x - p.x, z - p.z) < MIN_TREE_SPACING) { blocked = true; break; }
    }
    if (blocked) continue;
    const tree = {
      id: `${forestTreeIdPrefix(region.id)}${trees.length + 1}`,
      type: 'tree',
      x: Math.round(x * 10) / 10,
      z: Math.round(z * 10) / 10,
      rotation: Math.round(rand() * Math.PI * 2 * 100) / 100,
      scale: Math.round((0.85 + rand() * 0.35) * 100) / 100,
    };
    placements.push(tree);
    trees.push(tree);
  }
  return { trees, target, placed: trees.length, failed: target - trees.length };
}
