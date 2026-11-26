// Ground-zone classifier for grass scatter. Pure functions over world.js data.
import {
  WORLD_SIZE, HALF, PLAY_BOUND, SPAWN, RIVER_HALF_WIDTH, BRIDGE,
  riverDist, riverCenterX, terrainHeight, treeColliders, farmhouseColliders, objectColliders,
} from './world.js';
import { regionAt, roadAt } from './level.js';

export const BANK_BAND = 6;          // river bank band (m)
export const SPAWN_CLEAR = 0;        // spawn has grass; kept tiny to avoid wheel under-shell clutter
export const RIM_HEIGHT = 9;         // above this → rim (no grass)

export function inBridgeSpan(x, z, pad = 0) {
  return Math.abs(z - BRIDGE.z) < BRIDGE.halfWidth + pad &&
         Math.abs(x - BRIDGE.x) < BRIDGE.halfSpan + pad;
}

export function isObstacleAt(x, z, extra = 1.5) {
  for (const o of treeColliders) {
    if (Math.hypot(x - o.x, z - o.z) < o.r + extra) return true;
  }
  for (const o of farmhouseColliders) {
    if (Math.hypot(x - o.x, z - o.z) < o.r + extra) return true;
  }
  for (const o of objectColliders) {
    if (Math.hypot(x - o.x, z - o.z) < o.r + extra) return true;
  }
  return false;
}

export function groundZone(x, z, level = null) {
  if (Math.abs(x) > PLAY_BOUND || Math.abs(z) > PLAY_BOUND) return 'rim';
  const rd = riverDist(x, z);
  if (rd < RIVER_HALF_WIDTH + 2) return 'water';
  if (rd < RIVER_HALF_WIDTH + BANK_BAND) return 'riverbank';
  // (no spawn clearing — grass everywhere)

  if (terrainHeight(x, z) > RIM_HEIGHT) return 'rim';
  if (inBridgeSpan(x, z, 3)) return 'clearing';
  if (isObstacleAt(x, z, 1.5)) return 'clearing';
  if (level) {
    const region = regionAt(level, x, z);
    if (region !== 'grasslands' && region !== 'forest') return 'clearing';
    if (roadAt(level, x, z)) return 'clearing';
  }
  return 'grass';
}
