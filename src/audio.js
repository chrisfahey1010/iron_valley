// Audio: positional shell-fire SFX with simulated speed of sound.
// Schedules each shot's blast to start at `now + distance/c` from the camera,
// and scales volume by distance so distant shots are quieter.

const SOUND_SPEED = 343; // m/s (game units ~ meters)
const SFX_VOLUME = 0.9;

let ctx = null;
let shellBuffer = null;
let loadPromise = null;

async function ensureBuffer() {
  if (shellBuffer) return shellBuffer;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
    const res = await fetch('/audio/shell-fire.mp3');
    if (!res.ok) throw new Error('shell-fire.mp3 missing');
    const bytes = await res.arrayBuffer();
    shellBuffer = await ctx.decodeAudioData(bytes.slice(0));
    return shellBuffer;
  })();
  return loadPromise;
}

// Resume the context from a user gesture (e.g. Start Mission).
export function unlockAudio() {
  ensureBuffer().catch(() => {});
}

export async function playShellFireAt(worldPos, listenerPos) {
  try {
    const buffer = await ensureBuffer();
    if (!buffer) return;
    const dist = Math.max(0, worldPos.distanceTo(listenerPos));
    const delaySec = Math.max(0, dist / SOUND_SPEED);
    // inverse-square-ish falloff, clamped so distant shots stay audible
    const attenuation = 1 / (1 + dist * 0.045);
    const gain = ctx.createGain();
    gain.gain.value = SFX_VOLUME * attenuation;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain).connect(ctx.destination);
    const startAt = ctx.currentTime + delaySec;
    src.start(startAt);
  } catch (err) {
    // audio is best-effort; never crash the game on a hiccup
    console.warn('shell-fire sfx failed', err);
  }
}
