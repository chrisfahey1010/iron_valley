// Audio: positional shell-fire and impact SFX with simulated speed of sound.
// Schedules each event's blast to start at `now + distance/c` from the camera,
// and scales volume by distance so distant events are quieter.

const SOUND_SPEED = 343; // m/s (game units ~ meters)
const SFX_VOLUME = 0.9;

const MG_BURST_URL = '/audio/mg-burst.mp3';

const IMPACT_FILES = {
  tank: ['/audio/impact-tank-a.mp3', '/audio/impact-tank-b.mp3'],
  terrain: ['/audio/impact-terrain-a.mp3', '/audio/impact-terrain-b.mp3'],
  rock: ['/audio/impact-rock-a.mp3', '/audio/impact-rock-b.mp3'],
};

let ctx = null;
let masterGain = null;
let masterVolume = 1;
let effectsVolume = SFX_VOLUME;
const buffers = new Map(); // url -> Promise<AudioBuffer>

function ensureMasterGain() {
  if (ctx && !masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(ctx.destination);
  }
}

export function getMasterVolume() { return masterVolume; }
export function setMasterVolume(v01) {
  masterVolume = Math.min(1, Math.max(0, v01));
  ensureMasterGain();
  if (masterGain) masterGain.gain.value = masterVolume;
  localStorage.setItem('iv-master-volume', String(masterVolume));
}

export function getEffectsVolume() { return effectsVolume; }
export function setEffectsVolume(v01) {
  effectsVolume = Math.min(1, Math.max(0, v01));
  localStorage.setItem('iv-effects-volume', String(effectsVolume));
}

async function ensureBuffer(url) {
  if (!buffers.has(url)) {
    buffers.set(url, (async () => {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
      ensureMasterGain();
      const res = await fetch(url);
      if (!res.ok) throw new Error(url + ' missing');
      const bytes = await res.arrayBuffer();
      return await ctx.decodeAudioData(bytes.slice(0));
    })());
  }
  return buffers.get(url);
}

// Resume the context from a user gesture (e.g. Start Mission).
export function unlockAudio() {
  ensureBuffer('/audio/shell-fire.mp3').catch(() => {});
  for (const urls of Object.values(IMPACT_FILES)) for (const url of urls) ensureBuffer(url).catch(() => {});
  ensureBuffer(MG_BURST_URL).catch(() => {});
}

function scheduleAt(buffer, worldPos, listenerPos, volume = SFX_VOLUME) {
  const dist = Math.max(0, worldPos.distanceTo(listenerPos));
  const delaySec = Math.max(0, dist / SOUND_SPEED);
  // inverse-square-ish falloff, clamped so distant events stay audible
  const attenuation = 1 / (1 + dist * 0.045);
  const gain = ctx.createGain();
  gain.gain.value = volume * effectsVolume * attenuation;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain).connect(masterGain || ctx.destination);
  src.start(ctx.currentTime + delaySec);
}

export async function playShellFireAt(worldPos, listenerPos) {
  try {
    const buffer = await ensureBuffer('/audio/shell-fire.mp3');
    if (!buffer) return;
    scheduleAt(buffer, worldPos, listenerPos);
  } catch (err) {
    console.warn('shell-fire sfx failed', err);
  }
}

export async function playMgBurstAt(worldPos, listenerPos) {
  try {
    const buffer = await ensureBuffer(MG_BURST_URL);
    if (!buffer) return;
    scheduleAt(buffer, worldPos, listenerPos);
  } catch (err) {
    console.warn('mg-burst sfx failed', err);
  }
}

export async function playImpactAt(kind, worldPos, listenerPos) {
  const urls = IMPACT_FILES[kind];
  if (!urls) return;
  const url = urls[Math.floor(Math.random() * urls.length)];
  try {
    const buffer = await ensureBuffer(url);
    if (!buffer) return;
    scheduleAt(buffer, worldPos, listenerPos);
  } catch (err) {
    console.warn('impact sfx failed', err);
  }
}
