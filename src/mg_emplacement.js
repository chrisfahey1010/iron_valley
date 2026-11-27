// Machinegun emplacement model loading + in-game turret behavior.
// Instances are created by src/objects.js from level.json. The turret rotates
// ±45° from the placement heading (a 90° firing arc), pitches −10°/+20°, and
// fires 30-bullet 3 s bursts at the player (10 shots/s) when it has
// line-of-sight and range, then sits in a 2 s cooldown before re-engaging.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, measureRootBbox } from './scale.js';

export const MG_TUNING = {
  range: 150,            // m — engagement range
  arcDeg: 45,            // yaw ± deg from center (90° firing arc overall)
  pitchUpDeg: 20,        // barrel can rise this many degrees above horizontal
  pitchDownDeg: 10,      // barrel can depress this many degrees below horizontal
  speed: 600,            // m/s bullet speed
  gravity: 30,           // small gravity drop
  burstTime: 3.0,        // s of firing per burst
  cooldown: 2.0,         // s between bursts
  interval: 0.1,         // s between bullets (10 rps → 30 bullets per 3 s burst)
  aimTolerance: 0.10,    // rad — turret must be within this of target to fire
  panRate: 6.0,          // exp damp rate (1/s) — turret pan
  pitchRate: 6.0,        // exp damp rate (1/s) — barrel pitch
  inaccuracy: 0.02,      // rad — small burst spread
};

const loader = new GLTFLoader();
const DEG = Math.PI / 180;
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pivotWorld = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);

export async function loadMgEmplacementModel() {
  const asset = ASSETS.mg_emplacement;
  const gltf = await new Promise((res, rej) => loader.load(asset.url, res, undefined, rej));
  const source = new THREE.Group();
  source.add(gltf.scene);
  source.updateWorldMatrix(true, true);
  const bb = measureRootBbox(source);
  const size = bb.getSize(new THREE.Vector3());
  const s = asset.lengthM / Math.max(size.x, size.z);
  source.scale.setScalar(s);
  source.updateMatrixWorld(true);
  return source;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class MgEmplacement {
  constructor(scene, def, instance, onFire) {
    this.def = def;
    this.group = instance;
    this.onFire = onFire;
    this.turret = instance.getObjectByName('Mg_Turret');
    this.gun = instance.getObjectByName('Mg_GunPivot');
    this.muzzle = instance.getObjectByName('MG_MuzzleBrake');
    this.enabled = !!(this.turret && this.gun && this.muzzle);
    if (!this.enabled) console.warn('[mg] missing rig nodes — firing disabled');

    this.localYaw = 0;
    this.pitch = 0;
    this.burstTimer = 0;
    this.cooldown = 0;
    this.bulletTimer = 0;
    this.flashTime = 0;

    // static warm-up flash at the barrel tip, parented to the gun
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 })
    );
    this.flash.position.set(0, 0, 1.95); // local to the gun pivot (muzzle tip)
    this.flash.visible = false;
    if (this.gun) this.gun.add(this.flash);
  }

  reset() {
    this.localYaw = 0;
    this.pitch = 0;
    this.burstTimer = 0;
    this.cooldown = 0;
    this.bulletTimer = 0;
    this.flashTime = 0;
    if (this.turret) this.turret.rotation.y = 0;
    if (this.gun) this.gun.rotation.x = 0;
    if (this.flash) this.flash.visible = false;
  }

  muzzleWorldPos(out) {
    if (!this.muzzle) return out.set(this.group.position.x, this.group.position.y, this.group.position.z);
    return this.muzzle.getWorldPosition(out);
  }

  bulletDir(out) {
    out.set(0, 0, 1);
    out.applyQuaternion(this.gun.getWorldQuaternion(new THREE.Quaternion()));
    const j = MG_TUNING.inaccuracy;
    if (j) out.applyAxisAngle(_upAxis, (Math.random() * 2 - 1) * j);
    // converge toward the player slightly (visual burst tightening)
    return out.normalize();
  }

  aimAt(player) {
    const dx = player.pos.x - this.group.position.x;
    const dz = player.pos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    const localTarget = wrapAngle(toPlayer - this.group.rotation.y);
    const clamped = THREE.MathUtils.clamp(localTarget, -MG_TUNING.arcDeg * DEG, MG_TUNING.arcDeg * DEG);
    const pivotWorld = this.turret ? this.turret.getWorldPosition(_pivotWorld) : null;
    const dy = pivotWorld ? (player.pos.y + 1.4) - pivotWorld.y : 0;
    const drop = 0.5 * MG_TUNING.gravity * (dist / MG_TUNING.speed) * (dist / MG_TUNING.speed);
    const desiredPitch = Math.atan2(dy + drop, Math.max(0.001, dist));
    const clampedPitch = THREE.MathUtils.clamp(desiredPitch, -MG_TUNING.pitchDownDeg * DEG, MG_TUNING.pitchUpDeg * DEG);
    return { dist, toPlayer, localTarget, clamped, clampedPitch, desiredPitch };
  }

  update(dt, player, hasClearShot) {
    if (!this.enabled) return;
    // muzzle flash fade (static core, ~70 ms per bullet)
    if (this.flash.visible) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.visible = false;
    }
    if (!player || !player.alive) return;

    const aim = this.aimAt(player);
    const k = 1 - Math.exp(-MG_TUNING.panRate * dt);
    const kp = 1 - Math.exp(-MG_TUNING.pitchRate * dt);
    this.localYaw += (aim.clamped - this.localYaw) * k;
    this.pitch += (aim.clampedPitch - this.pitch) * kp;
    this.turret.rotation.y = this.localYaw;
    // glTF barrel points +Z; positive rotation.x dips the barrel down
    this.gun.rotation.x = -this.pitch;

    if (this.burstTimer > 0) {
      this.burstTimer -= dt;
      this.bulletTimer -= dt;
      if (this.bulletTimer <= 0) {
        this.onFire && this.onFire(this, this.muzzleWorldPos(_muzzle), this.bulletDir(_dir));
        this.flash.visible = true;
        this.flashTime = 0.07;
        this.bulletTimer = MG_TUNING.interval;
      }
      if (this.burstTimer <= 0) {
        this.burstTimer = 0;
        this.cooldown = MG_TUNING.cooldown;
      }
      return;
    }
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    const aimed = Math.abs(aim.clamped - this.localYaw) < MG_TUNING.aimTolerance
      && Math.abs(aim.clampedPitch - this.pitch) < MG_TUNING.aimTolerance;
    if (aim.dist <= MG_TUNING.range && aimed && hasClearShot(player.pos)) {
      this.burstTimer = MG_TUNING.burstTime;
      this.bulletTimer = 0;
    }
  }
}
