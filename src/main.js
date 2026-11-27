// Iron Valley — startup, match state, input, camera, AI, HUD, game loop.
import * as THREE from 'three';
import { buildWorld, terrainHeight, resolveObstacles, SPAWN, SPAWN_HEADING, deadTankColliders } from './world.js';
import { loadLevel, validateLevel } from './level.js';
import { buildRoads } from './roads.js';
import { loadObjectSources, placeObjects, occluderMeshes } from './objects.js';
import { Tank, loadTankModels } from './tank.js';
import { createGrass } from './grass.js';
import { Shell, predictPath, SHELL_SPEED, GRAVITY } from './shells.js';
import { playShellFireAt, playImpactAt, unlockAudio, getMasterVolume, setMasterVolume, getEffectsVolume, setEffectsVolume } from './audio.js';

// ---------- tunables ----------
const TUNING = {
  player: { accel: 14, maxSpeed: 5.5, reverseSpeed: 3, brake: 22 },
  enemy:  { speed: 2.75, fireRange: 150, fireTimerMin: 1.6, fireTimerMax: 3.0, damage: 12 },
  enemyCount: 4,
  shellPlayerDamage: 26,
  playerReload: 0.9,
  enemyReload: 1.9,
};
const CAM_DIST = 13;
const CAM_HEIGHT = 7.0;

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const canvas = $('game-canvas');
const menuOverlay = $('menu-overlay');
const endOverlay = $('end-overlay');
const aimIndicator = $('aim-indicator');
const intentIndicator = $('intent-indicator');
const impactMarker = $('impact-marker');
const pauseOverlay = $('pause-overlay');

// ---------- music / pause ----------
const music = new Audio('/audio/combat-theme.mp3');
music.loop = true;
function clamp01(v) { return Math.min(1, Math.max(0, v)); }
const savedMaster = parseFloat(localStorage.getItem('iv-master-volume') ?? '1') || 0;
const savedMusic = parseFloat(localStorage.getItem('iv-music-volume') ?? '0.7') || 0;
const savedEffects = parseFloat(localStorage.getItem('iv-effects-volume') ?? '0.9') || 0;
setMasterVolume(savedMaster);
setEffectsVolume(savedEffects);
let musicBase = clamp01(savedMusic);
function applyMusicVolume() { music.volume = clamp01(masterForMusic() * musicBase); }
function masterForMusic() { return getMasterVolume(); }
let paused = false;

function setVolume(v01) {
  musicBase = clamp01(v01);
  localStorage.setItem('iv-music-volume', String(musicBase));
  applyMusicVolume();
  const pct = Math.round(musicBase * 100);
  $('volume-slider').value = String(pct);
  $('volume-value').textContent = pct + '%';
}
function setMaster(v01) {
  setMasterVolume(clamp01(v01));
  applyMusicVolume();
  const pct = Math.round(getMasterVolume() * 100);
  $('master-slider').value = String(pct);
  $('master-value').textContent = pct + '%';
}
function setEffects(v01) {
  setEffectsVolume(clamp01(v01));
  const pct = Math.round(getEffectsVolume() * 100);
  $('effects-slider').value = String(pct);
  $('effects-value').textContent = pct + '%';
}
function openPause() {
  if (state !== 'playing' || paused) return;
  paused = true;
  pauseOverlay.classList.remove('hidden');
  setMaster(getMasterVolume());
  setVolume(musicBase);
  setEffects(getEffectsVolume());
  if (document.pointerLockElement) document.exitPointerLock();
}
function closePause() {
  paused = false;
  pauseOverlay.classList.add('hidden');
}
$('volume-slider').addEventListener('input', e => setVolume(e.target.value / 100));
$('master-slider').addEventListener('input', e => setMaster(e.target.value / 100));
$('effects-slider').addEventListener('input', e => setEffects(e.target.value / 100));
setMaster(getMasterVolume());
setEffects(getEffectsVolume());
setVolume(musicBase);
$('resume-btn').addEventListener('click', () => {
  closePause();
  safeRequestPointerLock();
});
window.addEventListener('keydown', e => {
  if (e.code === 'Escape') {
    if (paused) { closePause(); safeRequestPointerLock(); }
    else openPause();
  }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing' && !paused) openPause();
});

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a7bd);
scene.fog = new THREE.Fog(0x87a7bd, 180, 520);

const CAM_FOV_DEFAULT = 55;
const CAM_FOV_ZOOM = 22;
let zoomMode = false;
const camera = new THREE.PerspectiveCamera(CAM_FOV_DEFAULT, 1, 0.1, 1200);

const hemi = new THREE.HemisphereLight(0xbfd6e6, 0x3d4a30, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(35, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
sun.shadow.camera.far = 400;
scene.add(sun);

// NOTE: buildWorld/grass/objects are built inside init() after level load.

// ---------- state ----------
let models = null;            // {tank_6: gltf, tank_5: gltf, ...} loaded before match start
let level = null;              // validated level.json (see src/level.js)
let grass = null;              // instanced grass tufts (see grass.js)
let state = 'menu';           // menu | loading | playing | victory | defeat
let player = null, enemies = [], shells = [], effects = [];
let aimYaw = SPAWN_HEADING, aimPitch = -0.03;
const AIM_DIST = 100;        // max distance used when aim ray misses terrain (sky aim)
const AIM_MAX = 1500;        // max march distance for terrain intersection
const CAM_PITCH_MIN = -0.45, CAM_PITCH_MAX = 0.55; // camera (white intent) pitch range
const _aimPoint = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _rayDir = new THREE.Vector3();
let camYaw = SPAWN_HEADING;
let camPitch = -0.03;
let startTime = 0, frameId = null, lastTime = 0;
const keys = new Set();
const clockStart = performance.now();

function playerSpawn() {
  return level?.spawns?.player ?? { x: SPAWN.x, z: SPAWN.z, heading: SPAWN_HEADING };
}

function makePlayer() {
  const sp = playerSpawn();
  return new Tank({ modelKey: 'tank_6', x: sp.x, z: sp.z, heading: sp.heading, isPlayer: true, scene, models });
}

function makeEnemies() {
  const spots = level?.spawns?.enemies?.length
    ? level.spawns.enemies
    : [
      { x: -120, z: -260, heading: Math.PI },
      { x: -20,  z: -230, heading: Math.PI },
      { x: -110, z: -180, heading: Math.PI / 2 },
      { x: -30,  z: -160, heading: -Math.PI / 2 },
    ];
  const enemyModel = 'tank_5'; // all enemies are Panzer IVs for now
  return spots.slice(0, TUNING.enemyCount).map((s) =>
    new Tank({ modelKey: enemyModel, x: s.x, z: s.z, heading: s.heading, isPlayer: false, scene, models })
  );
}

function resetMatch() {
  zoomMode = false;
  window.__iv && (window.__iv.impacts = []);
  deadTankColliders.length = 0;
  // Clear shells and old tanks even if something below throws.
  try {
    for (const s of shells) s.dispose();
    shells = [];
  } catch (err) {
    console.error('shell cleanup failed', err);
    shells = [];
  }
  try {
    if (player) player.dispose();
    for (const e of enemies) e.dispose();
  } catch (err) {
    console.error('tank cleanup failed', err);
  }
  try {
    player = makePlayer();
    enemies = makeEnemies();
    const sp0 = playerSpawn();
    aimYaw = sp0.heading;
    // spawn aim: green indicator points at the ground ~100 m ahead of the player
    const f = new THREE.Vector3(Math.sin(sp0.heading), 0, Math.cos(sp0.heading));
    const aimDist = 100;
    const ax = player.pos.x + f.x * aimDist, az = player.pos.z + f.z * aimDist;
    const groundY = terrainHeight(ax, az);
    const eyeY = player.pos.y + 1.5;
    aimPitch = Math.atan2(groundY - eyeY, aimDist);
    aimPitch = THREE.MathUtils.clamp(aimPitch, player.stats.pitchMin, player.stats.pitchMax);
    camYaw = aimYaw; camPitch = aimPitch;
    player.barrelPitch = aimPitch;
    player.turretLocalYaw = aimYaw - player.heading;
    for (const e of enemies) {
      e.turretLocalYaw = Math.PI - e.heading; // roughly face player
      // aim at the player immediately (gravity-corrected like AI)
      const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      const t = Math.hypot(dx, dz);
      const dy = (player.pos.y + 1.4) - (e.pos.y + 1.5);
      const drop = 0.5 * GRAVITY * (t / SHELL_SPEED) * (t / SHELL_SPEED);
      e.barrelPitch = THREE.MathUtils.clamp(Math.atan2(dy + drop, t), e.stats.pitchMin, e.stats.pitchMax);
      e.aiState = { moveDir: Math.random() < 0.5 ? -1 : 1, repickTimer: Math.random() * 2 };
    }
    player.alive = true;
    camYaw = sp0.heading;
    camPitch = aimPitch;
  } catch (err) {
    // A reset failure must not leave the game in a frozen/half-reset state.
    console.error('resetMatch failed, recovering', err);
    player = null;
    enemies = [];
    state = 'menu';
    if (menuOverlay) {
      menuOverlay.classList.remove('hidden');
      const title = menuOverlay.querySelector('h1, .title');
      if (title) title.textContent = 'RESTART FAILED — click START MISSION';
    }
    endOverlay.classList.add('hidden');
    lastTime = 0;
    try { updateHUD(); } catch {}
    return;
  }
  state = 'playing';
  closePause();
  endOverlay.classList.add('hidden');
  menuOverlay.classList.add('hidden');
  startTime = performance.now();
  lastTime = 0;
  try { updateHUD(); } catch (err) { console.error('updateHUD failed', err); }
}

// ---------- input ----------
function safeRequestPointerLock() {
  try {
    const p = canvas.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => { /* pointer lock unavailable */ });
  } catch { /* pointer lock unavailable */ }
}

function toggleZoom() {
  if (state !== 'playing') return;
  zoomMode = !zoomMode;
}
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyR') { resetMatch(); safeRequestPointerLock(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') toggleZoom();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

canvas.addEventListener('mousedown', e => {
  if (state !== 'playing') return;
  if (document.pointerLockElement !== canvas) {
    safeRequestPointerLock();
    return;
  }
  if (e.button === 0) tryFire(player);
  if (e.button === 2) toggleZoom();
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || state !== 'playing') return;
  const sens = 0.0022 * (camera.fov / CAM_FOV_DEFAULT);
  aimYaw -= e.movementX * sens;
  aimPitch = THREE.MathUtils.clamp(aimPitch + e.movementY * sens * -1, CAM_PITCH_MIN, CAM_PITCH_MAX);
});

$('start-btn').addEventListener('click', () => {
  resetMatch();
  safeRequestPointerLock();
  unlockAudio();
  music.play().catch(() => { /* autoplay blocked */ });
});
$('restart-btn').addEventListener('click', () => {
  resetMatch();
  safeRequestPointerLock();
  unlockAudio();
  music.play().catch(() => {});
});

// ---------- firing ----------
function tickMuzzleFlash(tank, dt) {
  if (tank.muzzleFlash > 0) {
    tank.muzzleFlash -= dt;
    if (tank.muzzleFlash <= 0) tank.flashMesh.visible = false;
  }
}

const _muzzle = new THREE.Vector3();
const _fwd = new THREE.Vector3();

function tryFire(tank) {
  if (!tank.alive || tank.reload > 0) return;
  tank.reload = tank.isPlayer ? TUNING.playerReload : TUNING.enemyReload;
  tank.flashMesh.visible = true;
  tank.muzzleFlash = 0.09;
  tank.muzzleWorldPos(_muzzle);
  tank.barrelWorldDir();
  const dir = tank.barrelWorldDir();
  const vel = dir.clone().multiplyScalar(SHELL_SPEED);
  const shell = new Shell(scene, _muzzle, vel, tank);
  shells.push(shell);
  playShellFireAt(_muzzle.clone(), camera.position);
}

// Raycast first hit: terrain (2 m march) + solid occluders (alive/dead enemies,
// farmhouses) via THREE.Raycaster. Trees are passable (trunks are visual only).
// Returns a world-space point on the first hit, or a fixed AIM_DIST out when
// the ray misses everything (sky aim).
function raycastHit(origin, dir) {
  let bestDist = Infinity;
  let bestPoint = null;
  for (let d = 2; d <= AIM_MAX; d += 4) {
    const x = origin.x + dir.x * d;
    const y = origin.y + dir.y * d;
    const z = origin.z + dir.z * d;
    if (y <= terrainHeight(x, z)) { bestDist = d; bestPoint = new THREE.Vector3(x, terrainHeight(x, z), z); break; }
  }
  const targets = [];
  for (const e of enemies) { if (e && e.group) targets.push(e.group); }
  for (const m of occluderMeshes) targets.push(m);
  if (targets.length) {
    _raycaster.set(origin, dir);
    _raycaster.far = AIM_MAX;
    const hits = _raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      if (h.distance < bestDist) { bestDist = h.distance; bestPoint = h.point.clone(); }
    }
  }
  if (bestPoint) return bestPoint;
  return _aimPoint.copy(origin).addScaledVector(dir, AIM_DIST);
}

// White ring: camera-ray first hit (the point the tank should aim at).
function getWhiteAimPoint() {
  _rayDir.set(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch)
  );
  return raycastHit(camera.position, _rayDir);
}

// Green ring: barrel-ray first hit (where the barrel actually points).
function getGreenAimPoint() {
  player.muzzleWorldPos(_muzzle);
  const dir = player.barrelWorldDir();
  return raycastHit(_muzzle, dir);
}

// ---------- HUD ----------
function updateHUD() {
  $('enemies-left-count').textContent = String(enemies.filter(e => e.alive).length);
  $('health-bar').style.width = `${player ? (player.hp / player.maxHp) * 100 : 0}%`;
  const r = player && player.alive ? (1 - Math.min(1, player.reload / TUNING.playerReload)) * 100 : 0;
  $('reload-bar').style.width = `${r}%`;
}

function projectToScreen(worldPos) {
  const v = worldPos.clone().project(camera);
  if (v.z > 1 || v.z < -1) return null;
  const x = (v.x * 0.5 + 0.5) * innerWidth;
  const y = (-v.y * 0.5 + 0.5) * innerHeight;
  if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) return null;
  return { x, y };
}

function updateCues() {
  if (!player || !player.alive) { intentIndicator.style.display = 'none'; aimIndicator.style.display = 'none'; impactMarker.style.display = 'none'; return; }
  // white ring: aim intent (camera ray first hit) — camera follows this
  const wp = projectToScreen(getWhiteAimPoint());
  if (wp) { intentIndicator.style.display = 'block'; intentIndicator.style.left = wp.x + 'px'; intentIndicator.style.top = wp.y + 'px'; }
  else intentIndicator.style.display = 'none';
  // green ring: actual barrel ray first hit
  const ap = projectToScreen(getGreenAimPoint());
  if (ap) { aimIndicator.style.display = 'block'; aimIndicator.style.left = ap.x + 'px'; aimIndicator.style.top = ap.y + 'px'; }
  else aimIndicator.style.display = 'none';

  // yellow ring: predicted first-impact point from the actual barrel
  player.muzzleWorldPos(_muzzle);
  const dir = player.barrelWorldDir();
  const pred = predictPath({ muzzle: _muzzle, dir, tanks: enemies.filter(e => e.alive) });
  // ensure owner (player) not counted as hit for the player's own aim — filter
  if (pred && pred.hitTank !== player) {
    const ip = projectToScreen(pred.point);
    if (ip) { impactMarker.style.display = 'block'; impactMarker.style.left = ip.x + 'px'; impactMarker.style.top = ip.y + 'px'; }
    else impactMarker.style.display = 'none';
  } else {
    impactMarker.style.display = 'none';
  }
}


// Line-of-sight check: muzzle -> player position. Trees are passable; terrain
// and farmhouses (solid occluders) block. Returns true if the shot is clear.
const _losDir = new THREE.Vector3();
const _losTarget = new THREE.Vector3();
function hasClearShot(e, targetPos) {
  const from = new THREE.Vector3();
  e.muzzleWorldPos(from);
  _losTarget.copy(targetPos); _losTarget.y += 1.4;
  _losDir.copy(_losTarget).sub(from);
  const dist = _losDir.length();
  if (dist < 0.001) return true;
  _losDir.divideScalar(dist);
  // terrain march (same granularity as aim predictor)
  for (let d = 2; d < dist; d += 3) {
    const x = from.x + _losDir.x * d;
    const y = from.y + _losDir.y * d;
    const z = from.z + _losDir.z * d;
    if (y <= terrainHeight(x, z)) return false;
  }
  // farmhouse occluders
  if (occluderMeshes.length) {
    _raycaster.set(from, _losDir);
    _raycaster.far = dist - 1;
    const hits = _raycaster.intersectObjects(occluderMeshes, true);
    if (hits.length) return false;
  }
  return true;
}

// ---------- enemy AI ----------
function updateEnemy(e, dt) {
  if (!e.alive) return;
  const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
  const dist = Math.hypot(dx, dz);
  const toPlayer = Math.atan2(dx, dz);
  e.aiState.repickTimer -= dt;
  if (e.aiState.repickTimer <= 0) {
    e.aiState.repickTimer = 2 + Math.random() * 3;
    e.aiState.moveDir = Math.random() < 0.5 ? -1 : 1;
    e.aiState.shouldApproach = dist > 22;
  }
  // steering: hull toward player, slight strafe
  let desired = toPlayer;
  if (e.aiState.shouldApproach === false) desired = toPlayer + e.aiState.moveDir * 0.9;
  let diff = desired - e.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const maxTurn = e.stats.hullTurnRate * dt;
  const applied = THREE.MathUtils.clamp(diff, -maxTurn, maxTurn);
  e.headingDelta = Math.abs(applied) > 0.001 ? Math.sign(applied) : 0;
  e.heading += applied;
  const wantSpeed = e.aiState.shouldApproach ? TUNING.enemy.speed : TUNING.enemy.speed * 0.6;
  const aligned = Math.abs(diff) < 0.9;
  e.speed += ((aligned ? wantSpeed : 0.5) - e.speed) * Math.min(1, dt * 3);
  const f = new THREE.Vector3(Math.sin(e.heading), 0, Math.cos(e.heading));
  e.pos.x += f.x * e.speed * dt;
  e.pos.z += f.z * e.speed * dt;
  resolveObstacles(e.pos, e.collisionRadius);

  // turret/barrel track the player at limited rate (same model as player)
  const tYaw = toPlayer; // world heading toward player
  const t = Math.hypot(dx, dz);
  const dy = (player.pos.y + 1.4) - (e.pos.y + 1.5);
  // gravity correction: aim slightly above the line to the target
  const drop = 0.5 * GRAVITY * (t / SHELL_SPEED) * (t / SHELL_SPEED);
  const ang = Math.atan2(dy + drop, t);
  e.trackAim(tYaw, ang, dt);
  const tDiff = (() => { let d = tYaw - (e.heading + e.turretLocalYaw); while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; })();

  // fire when roughly aimed and in range
  e.reload = Math.max(0, e.reload - dt);
  if (e.reload <= 0 && dist < TUNING.enemy.fireRange && Math.abs(tDiff) < 0.25 && hasClearShot(e, player.pos)) {
    tryFire(e);
  }
}

function motionFor(speed, headingDelta) {
  const steer = headingDelta !== undefined ? headingDelta : 0;
  if (Math.abs(speed) > 0.3 && Math.abs(steer) > 0.01) return steer > 0 ? 'left' : 'right';
  if (speed > 0.3) return 'forward';
  if (speed < -0.3) return 'backwards';
  return null;
}

// ---------- main loop ----------
function update(dt) {
  if (state !== 'playing') return;

  // player physics
  if (player.alive) {
    const steer = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
    // A = left = increasing heading (verified). D = right.
    player.headingDelta = steer;
    player.heading += steer * player.stats.hullTurnRate * dt;

    const forward = keys.has('KeyW') ? 1 : 0;
    const back = keys.has('KeyS') ? 1 : 0;
    let accel = 0;
    if (forward) accel = TUNING.player.accel;
    else if (back) accel = -TUNING.player.accel * 0.8;
    else accel = 0; // coast

    if (forward || back) {
      player.speed += accel * dt;
      const cap = forward ? TUNING.player.maxSpeed : -TUNING.player.reverseSpeed;
      if (accel > 0) player.speed = Math.min(player.speed, cap);
      else player.speed = Math.max(player.speed, cap);
    } else {
      // brake toward 0
      const b = TUNING.player.brake * dt;
      if (Math.abs(player.speed) <= b) player.speed = 0;
      else player.speed -= Math.sign(player.speed) * b;
    }
    // reverse cap: when pressing S, speed negative; clamp above
    player.speed = THREE.MathUtils.clamp(player.speed, -TUNING.player.reverseSpeed, TUNING.player.maxSpeed);

    const f = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
    player.pos.x += f.x * player.speed * dt;
    player.pos.z += f.z * player.speed * dt;
    resolveObstacles(player.pos, player.collisionRadius);

    // turret/barrel track the white intent point (camera ray first hit)
    const aimPoint = getWhiteAimPoint();
    const dx = aimPoint.x - player.pos.x, dz = aimPoint.z - player.pos.z;
    const dy = aimPoint.y - (player.pos.y + 1.5);
    const targetYaw = Math.atan2(dx, dz);
    const targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
    player.trackAim(targetYaw, targetPitch, dt);
    player.reload = Math.max(0, player.reload - dt);
    tickMuzzleFlash(player, dt);
  }

  // enemies
  for (const e of enemies) { updateEnemy(e, dt); tickMuzzleFlash(e, dt); }

  // shells
  for (let i = shells.length - 1; i >= 0; i--) {
    const r = shells[i].step(dt, [player, ...enemies]);
    if (r.consumed) {
      if (r.reason === 'tank' && r.target) {
        const dmg = shells[i].owner.isPlayer ? TUNING.shellPlayerDamage : TUNING.enemy.damage;
        r.target.damage(dmg);
      }
      const kind = r.reason === 'tank' || r.reason === 'wreck' ? 'tank'
        : r.reason === 'farmhouse' || r.reason === 'tree' ? 'rock'
        : 'terrain';
      if (r.impactPoint) playImpactAt(kind, r.impactPoint, camera.position);
      shells[i].dispose();
      shells.splice(i, 1);
    }
  }

  // register newly-dead tanks as wreck colliders (permanent for the match)
  for (const tank of [player, ...enemies]) {
    if (tank && !tank.alive && !tank._wreckRegistered) {
      tank._wreckRegistered = true;
      deadTankColliders.push({ x: tank.pos.x, z: tank.pos.z, r: tank.collisionRadius });
    }
  }

  // tank poses
  player.setPose(dt, motionFor(player.speed, player.headingDelta || 0));
  for (const e of enemies) e.setPose(dt, motionFor(e.speed, e.headingDelta || 0));

  // camera
  updateCamera(dt);

  // win/lose
  if (player.alive === false) {
    endMatch(false);
  } else if (enemies.every(e => !e.alive)) {
    endMatch(true);
  }

  updateHUD();
  updateCues();
}

function updateCamera(dt) {
  // zoom: ease FOV toward target (~150 ms)
  const targetFov = zoomMode ? CAM_FOV_ZOOM : CAM_FOV_DEFAULT;
  const kFov = 1 - Math.exp(-10 * (dt ?? 0.016));
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * kFov;
    camera.updateProjectionMatrix();
  } else if (camera.fov !== targetFov) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
  // camera is damped toward the mouse-controlled aim direction (white ring).
  // Damping (not 1:1) is what keeps the white ring/camera from twitching.
  const k = 1 - Math.exp(-10 * (dt ?? 0.016));
  let dy = aimYaw - camYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  camYaw += dy * k;
  camPitch += (aimPitch - camPitch) * k;
  const back = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw)).multiplyScalar(-CAM_DIST);
  const desired = new THREE.Vector3(player.pos.x, 0, player.pos.z).add(back);
  desired.y = terrainHeight(desired.x, desired.z) + CAM_HEIGHT;
  camera.position.lerp(desired, Math.min(1, dt * 8));
  const cp = Math.cos(camPitch);
  const look = camera.position.clone().add(new THREE.Vector3(Math.sin(camYaw) * cp, Math.sin(camPitch), Math.cos(camYaw) * cp).multiplyScalar(60));
  camera.lookAt(look);
  // keep above terrain
  const minY = terrainHeight(camera.position.x, camera.position.z) + 1.6;
  if (camera.position.y < minY) camera.position.y = minY;
}

function updateMenuCamera() {
  const mc = level?.menuCamera;
  if (!mc) return;
  const y = terrainHeight(mc.x, mc.z) + mc.altitude;
  camera.position.set(mc.x, y, mc.z);
  const cp = Math.cos(mc.pitch);
  const look = new THREE.Vector3(
    mc.x + Math.sin(mc.yaw) * cp,
    y + Math.sin(mc.pitch),
    mc.z + Math.cos(mc.yaw) * cp
  );
  camera.lookAt(look);
}

function endMatch(victory) {
  if (state !== 'playing') return;
  state = victory ? 'victory' : 'defeat';
  $('end-title').textContent = victory ? 'VICTORY' : 'DEFEAT';
  $('end-subtitle').textContent = victory ? 'All enemy armor destroyed.' : 'Your tank was destroyed.';
  endOverlay.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function loop(t) {
  frameId = requestAnimationFrame(loop);
  // window.__iv is installed once at module scope (not per frame)
  if (!lastTime) lastTime = t;
  const dt = Math.min(0.05, (t - lastTime) / 1000);
  lastTime = t;
  const frameStart = performance.now();
  try {
    if (state === 'playing' && !paused) {
      update(dt);
    } else if (state === 'menu') {
      updateMenuCamera();
    }
    if (grass) grass.update(t / 1000);
    renderer.render(scene, camera);
  } catch (err) {
    // A bad frame should never permanently wedge the game; log and keep the loop alive.
    console.error('Iron Valley frame error:', err);
  }
  // Stuck-frame watchdog: if a single frame blows the budget, log the stack so
  // the culprit can be pinpointed in the console without freezing the page.
  const elapsed = performance.now() - frameStart;
  if (elapsed > 250) {
    try {
      console.error(`Iron Valley slow frame: ${elapsed.toFixed(0)}ms`, new Error('slow frame stack').stack);
    } catch {}
  }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// initial state: loading models then menu
const menuTitle = document.querySelector('#menu-overlay h1, #menu-overlay .title');
if (menuTitle) menuTitle.textContent = 'LOADING…';
async function init() {
  try {
    level = await loadLevel('/level.json');
    models = await loadTankModels();
    buildWorld(scene, level);
    buildRoads(scene, level);
    const objectSources = await loadObjectSources(level);
    placeObjects(scene, level, objectSources);
    grass = createGrass(scene, level);
    resetMatch();
  } catch (err) {
    console.error('Failed to load tank models', err);
    if (menuTitle) menuTitle.textContent = 'STARTUP FAILED — see console';
    return;
  }
  state = 'menu';
  if (menuTitle) menuTitle.textContent = 'IRON VALLEY';
  menuOverlay.classList.remove('hidden');
  endOverlay.classList.add('hidden');
  frameId = requestAnimationFrame(loop);
}
init();

window.__iv = { get camera(){return camera}, get scene(){return scene}, get camYaw(){return camYaw}, get camPitch(){return camPitch}, get state(){return state}, get player(){return player}, get enemies(){return enemies}, get aimYaw(){return aimYaw}, get aimPitch(){return aimPitch}, get shells(){return shells}, reset: resetMatch, forceAim:(y,p)=>{aimYaw=y;aimPitch=p}, fire:()=>tryFire(player), impacts: [], step:(n=1,dt=1/60)=>{ for(let i=0;i<n;i++) update(dt); renderer.render(scene,camera); } };
