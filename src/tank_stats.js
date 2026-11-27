// Per-vehicle stats. Keyed by the modelKey used in scale.js ASSETS.
// New vehicles: add an entry here and they automatically get limited-rate
// turret/barrel tracking everywhere (player + enemy AI).
//
// Values in degrees; pitch angles are elevation in radians during use and
// converted from degrees at import time.

export const TANK_STATS = {
  tank_6: {
    name: 'M24 Chaffee',
    turretRateDeg: 24,      // max turret traverse rate (deg/s)
    barrelRateDeg: 15,      // max barrel elevation rate (deg/s)
    hullTurnRateDeg: 24,    // max hull yaw rate while steering (deg/s)
    pitchMinDeg: -10,       // lowest barrel elevation (deg)
    pitchMaxDeg: 15,        // highest barrel elevation (deg)
    inaccuracyDeg: 0.3,     // max per-axis yaw/pitch offset per shell (deg)
  },
  tank_5: {
    name: 'Panzer IV',
    turretRateDeg: 16,
    barrelRateDeg: 15,
    hullTurnRateDeg: 20,
    pitchMinDeg: -10,
    pitchMaxDeg: 20,
    inaccuracyDeg: 2.0,     // literal value, not derived from player
  },
};

const toRad = d => d * Math.PI / 180;

// Normalized per-model stats (radians + Object.freeze) for runtime use.
export const TANK_STATS_R = Object.fromEntries(
  Object.entries(TANK_STATS).map(([k, s]) => [k, Object.freeze({
    name: s.name,
    turretRate: toRad(s.turretRateDeg),
    barrelRate: toRad(s.barrelRateDeg),
    hullTurnRate: toRad(s.hullTurnRateDeg),
    pitchMin: toRad(s.pitchMinDeg),
    pitchMax: toRad(s.pitchMaxDeg),
    inaccuracy: toRad(s.inaccuracyDeg ?? 0),
  })])
);

export function tankStats(modelKey) {
  return TANK_STATS_R[modelKey] || TANK_STATS_R.tank_6;
}
