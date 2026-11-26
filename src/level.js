// Level file loading + validation + queries. Pure JS — no three.js — so the
// editor and the game share it. Level file: public/level.json (see docs/LEVEL_EDITOR_PLAN.md).

export const REGION_TYPES = ['grasslands', 'pasture', 'crops', 'clearing', 'forest'];
export const ROAD_TYPES = ['gravel', 'dirt'];

export const REGION_COLORS = {
  grasslands: 0x49683a,
  pasture: 0x8a8452,
  crops: 0x6b7a3a,
  clearing: 0x9a8460,
  forest: 0x49683a, // same base as grasslands (forest keeps the grass texture base)
};

export function defaultLevel() {
  return {
    version: 1,
    name: 'Iron Valley',
    terrain: { regions: [], roads: [] },
    spawns: { player: { x: -60, z: -350, heading: 0 }, enemies: [] },
    objects: [],
  };
}

function warn(msg) { console.warn('[level]', msg); }

function dedupeIds(items, label) {
  const seen = new Map();
  for (const it of items) {
    let id = String(it.id || label);
    if (!seen.has(id)) { seen.set(id, 1); it.id = id; continue; }
    let n = seen.get(id) + 1;
    while (seen.has(`${id}-${n}`)) n++;
    it.id = `${id}-${n}`;
    seen.set(id, n); seen.set(it.id, 1);
    warn('duplicate id renamed:', it.id);
  }
}

export function validateLevel(raw) {
  const level = raw && typeof raw === 'object' ? raw : defaultLevel();
  const out = defaultLevel();
  out.version = 1;
  out.name = typeof level.name === 'string' ? level.name : 'Iron Valley';
  out.terrain = { regions: [], roads: [] };
  if (Array.isArray(level.terrain?.regions)) {
    for (const r of level.terrain.regions) {
      if (!r || !Array.isArray(r.points) || r.points.length < 3) { warn('dropping bad region', r?.id); continue; }
      const type = REGION_TYPES.includes(r.type) ? r.type : null;
      if (!type) { warn('unknown region type, dropping', r.id, r.type); continue; }
      const region = { id: String(r.id || 'region'), type, points: r.points.map(p => [Number(p[0]), Number(p[1])]) };
      if (type === 'forest') region.density = Number(r.density) > 0 ? Number(r.density) : 50;
      out.terrain.regions.push(region);
    }
  }
  if (Array.isArray(level.terrain?.roads)) {
    for (const r of level.terrain.roads) {
      if (!r || !Array.isArray(r.points) || r.points.length < 2) { warn('dropping bad road', r?.id); continue; }
      const type = ROAD_TYPES.includes(r.type) ? r.type : null;
      if (!type) { warn('unknown road type, dropping', r.id, r.type); continue; }
      out.terrain.roads.push({ id: String(r.id || 'road'), type, widthM: Number(r.widthM) > 0 ? Number(r.widthM) : 4, points: r.points.map(p => [Number(p[0]), Number(p[1])]) });
    }
  }
  if (level.spawns?.player && Number.isFinite(level.spawns.player.x) && Number.isFinite(level.spawns.player.z)) {
    out.spawns.player = { x: level.spawns.player.x, z: level.spawns.player.z, heading: Number(level.spawns.player.heading) || 0 };
  }
  if (Array.isArray(level.spawns?.enemies)) {
    for (const e of level.spawns.enemies) {
      if (e && Number.isFinite(e.x) && Number.isFinite(e.z)) {
        out.spawns.enemies.push({ x: e.x, z: e.z, heading: Number(e.heading) || 0 });
      }
    }
  }
  if (Array.isArray(level.objects)) {
    for (const o of level.objects) {
      if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.z)) { warn('dropping bad object', o?.id); continue; }
      out.objects.push({
        id: String(o.id || ('obj-' + Math.floor(Math.random() * 1e6))),
        type: String(o.type || ''),
        x: o.x, z: o.z,
        rotation: Number(o.rotation) || 0,
        scale: Number(o.scale) > 0 ? Number(o.scale) : 1,
      });
    }
  }
  dedupeIds(out.terrain.regions, 'region');
  dedupeIds(out.terrain.roads, 'road');
  dedupeIds(out.objects, 'obj');
  return out;
}

export async function loadLevel(url = '/level.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    return validateLevel(raw);
  } catch (err) {
    console.warn('[level] failed to load, using default', err);
    return defaultLevel();
  }
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

export function regionAt(level, x, z) {
  for (const r of level.terrain.regions) {
    if (pointInPolygon(x, z, r.points)) return r.type;
  }
  return 'grasslands';
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

export function roadAt(level, x, z) {
  for (const r of level.terrain.roads) {
    const half = r.widthM / 2;
    for (let i = 0; i < r.points.length - 1; i++) {
      const d = distToSegment(x, z, r.points[i][0], r.points[i][1], r.points[i + 1][0], r.points[i + 1][1]);
      if (d < half) return r.type;
    }
  }
  return null;
}
