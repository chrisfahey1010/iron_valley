// Global wind model. Single source of truth for wind — later systems (grass,
// trees, distant haze, ...) should read from this module instead of inventing
// their own gust/direction logic.
//
// Conventions: direction is a world yaw (same convention as tank heading:
// forward = (sinθ, 0, cosθ)). Atmospheric-scale numbers tuned for a 1 km valley.
//
// Current shape: mean speed + one slow gust oscillation + one slow direction
// wander. Extending later: add position-dependent terms (per-region wind,
// river/channel acceleration), per-axis components, or coupling to
// gameplay events (storms, fires). Consumers only ever read the animated
// outputs emitted by speed()/dir().

export const wind = {
  baseDir: 0.7,          // world yaw of mean wind (radians)
  baseSpeed: 5.0,        // m/s — mean wind speed
  gustAmplitude: 0.55,   // 0..1 — extra speed from gusts
  gustFrequency: 0.9,    // rad/s — gust oscillation
  gustEnvelope: 0.23,    // rad/s — slow envelope on the gusts
  dirOscAmp: 0.35,       // world-yaw oscillation amplitude (radians)
  dirOscFrequency: 0.13, // rad/s — slow direction wander
  time: 0,

  update(dt) {
    this.time += dt;
  },

  // Mean speed plus gusts, in m/s.
  speed() {
    const gust = this.gustAmplitude * (0.5 + 0.5 * Math.sin(this.time * this.gustFrequency + 1.7) * Math.sin(this.time * this.gustEnvelope));
    return this.baseSpeed * (1 + gust);
  },

  // Current wind direction as a world yaw, in radians.
  dir() {
    return this.baseDir + this.dirOscAmp * Math.sin(this.time * this.dirOscFrequency + 1.2);
  },

};
