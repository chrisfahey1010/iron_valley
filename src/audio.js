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
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} } // fire-and-forget; never block buffer creation
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
  ensureBuffer('/audio/tank-idle.mp3').catch(() => {});
  ensureBuffer('/audio/tank-drive.mp3').catch(() => {});
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

// ── Tank engine SFX ─────────────────────────────────────────────────────────
// Two loop sources per tank (idle + drive), crossfaded by driving state.
// Ghosts of idle stay at low volume under driving for a natural mix; dead
// tanks decay both gains to zero. Uses the same distance falloff as SFX.
const TANK_IDLE_URL = '/audio/tank-idle.mp3';
const TANK_DRIVE_URL = '/audio/tank-drive.mp3';
const TANK_IDLE_GAIN = 0.22;
const TANK_DRIVE_GAIN = 0.85;

const tankSfx = new Map(); // tank -> { idleSrc, driveSrc, idleGain, driveGain, tankGain }
const disposedTanks = new WeakSet(); // tanks whose SFX may be aborted mid-creation

async function ensureTankSfx(tank) {
  if (!tank || tankSfx.has(tank)) return;
  try {
    const [idleBuf, driveBuf] = await Promise.all([ensureBuffer(TANK_IDLE_URL), ensureBuffer(TANK_DRIVE_URL)]);
    if (!idleBuf || !driveBuf) return;
    if (disposedTanks.has(tank)) return; // tank was disposed while buffers loaded
    if (tankSfx.has(tank)) return; // raced
    const tankGain = ctx.createGain();
    tankGain.gain.value = 1; // positional/volume computed on the sub-gains
    tankGain.connect(masterGain || ctx.destination);
    const idleGain = ctx.createGain();
    idleGain.gain.value = 0;
    idleGain.connect(tankGain);
    const driveGain = ctx.createGain();
    driveGain.gain.value = 0;
    driveGain.connect(tankGain);
    const idleSrc = ctx.createBufferSource();
    idleSrc.buffer = idleBuf; idleSrc.loop = true; idleSrc.connect(idleGain); idleSrc.start();
    const driveSrc = ctx.createBufferSource();
    driveSrc.buffer = driveBuf; driveSrc.loop = true; driveSrc.connect(driveGain); driveSrc.start();
    tankSfx.set(tank, { idleSrc, driveSrc, idleGain, driveGain, tankGain });
  } catch (err) {
    console.warn('tank sfx failed', err);
  }
}

export function disposeTankSfx(tank) {
  disposedTanks.add(tank);
  const s = tankSfx.get(tank);
  if (!s) return;
  tankSfx.delete(tank);
  try { s.idleSrc.stop(); } catch {}
  try { s.driveSrc.stop(); } catch {}
  try { s.idleGain.disconnect(); s.driveGain.disconnect(); s.tankGain.disconnect(); } catch {}
}

export function updateTankSfx(tank, listenerPos) {
  const s = tankSfx.get(tank);
  if (!s) return;
  const dist = Math.max(0, tank.pos.distanceTo(listenerPos));
  const atten = 1 / (1 + dist * 0.045);
  const alive = tank.alive;
  const driving = alive && Math.abs(tank.speed) > 0.3;
  const isPlayer = !!tank.isPlayer;
  const speedNorm = Math.min(1, Math.abs(tank.speed) / 5.5);
  // One layer per state — idle plays ONLY when idle, drive plays ONLY when driving.
  // Fast crossfade (~100 ms) where the two meet; quick RPM ramp for realism.
  // Enemies never rev: they always emit the quiet idle (see user preference —
  // a crowd of revving engines sounds like a swarm of bees).
  const idleTarget = alive ? TANK_IDLE_GAIN * atten * effectsVolume : 0;
  const driveTarget = (alive && driving && isPlayer)
    ? TANK_DRIVE_GAIN * (0.6 + 0.4 * speedNorm) * atten * effectsVolume
    : 0;
  const idleRate = 0.92; // quiet idle sits slightly flat
  const driveRate = 0.72 + 0.28 * speedNorm; // rpm climbs with speed
  const t = ctx.currentTime;
  s.idleGain.gain.setTargetAtTime(idleTarget, t, 0.1);
  s.driveGain.gain.setTargetAtTime(driveTarget, t, 0.09);
  s.idleSrc.playbackRate.setTargetAtTime(idleRate, t, 0.25);
  s.driveSrc.playbackRate.setTargetAtTime(driveRate, t, 0.12);
}

export function suspendAudio() { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
export function resumeAudio() { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); }

// Hook: eagerly create tank SFX whenever a tank is created (async, fire-and-forget)
export function ensureTankSfxOnCreate(tank) { ensureTankSfx(tank).catch(() => {}); }

export function tankSfxDebug() {
  return Array.from(tankSfx.entries()).map(([tank, s]) => ({
    isPlayer: tank.isPlayer, alive: tank.alive, speed: tank.speed,
    idleGain: s.idleGain.gain.value, driveGain: s.driveGain.gain.value, tankGain: s.tankGain.gain.value,
  }));
}
