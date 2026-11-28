// Tank rig + behavior. Convention: hull local forward = +Z, up = +Y.
// Hull yaw θ → world forward (sinθ, 0, cosθ); mesh.rotation.y = θ.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight } from './world.js';
import { ASSETS, tankRadius } from './scale.js';
import { tankStats } from './tank_stats.js';

export const TANK_MODELS = Object.fromEntries(
  Object.entries(ASSETS).filter(([, a]) => a.kind === 'tank').map(([k, a]) => [k, a.url])
);
export const TANK_RADIUS = tankRadius(6); // default footprint; per-tank radius = tankRadius(lengthM)

const loader = new GLTFLoader();

const _tmpV = new THREE.Vector3();

function makeFlashSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.42, 'rgba(255,170,70,0.45)');
  g.addColorStop(0.75, 'rgba(255,110,25,0.12)');
  g.addColorStop(1.0, 'rgba(255,90,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function loadTankModels() {
  const entries = await Promise.all(Object.entries(ASSETS).filter(([, a]) => a.kind === 'tank').map(async ([key, asset]) => {
    const gltf = await new Promise((res, rej) => loader.load(asset.url, res, undefined, rej));
    return [key, gltf];
  }));
  return Object.fromEntries(entries); // {tank_6: gltf, tank_5: gltf, ...}
}

function fixSkeletons(clone, source) {
  clone.traverse(o => {
    if (o.isSkinnedMesh) {
      const src = source && source.getObjectByName && source.getObjectByName(o.name);
      if (!src || !src.skeleton) return;
      const bones = src.skeleton.bones.map(b => clone.getObjectByName(b.name));
      if (bones.some(b => !b)) return;
      o.skeleton = new THREE.Skeleton(bones, src.skeleton.boneInverses.slice());
    }
  });
}

function cloneMaterials(root) {
  root.traverse(o => {
    if (o.isMesh && o.material) {
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

export class Tank {
  constructor({ modelKey = 'tank_6', x, z, heading, isPlayer = false, scene, models, lengthM }) {
    this.lengthM = lengthM ?? ASSETS[modelKey]?.lengthM ?? 6;
    this.collisionRadius = tankRadius(this.lengthM);
    this.isPlayer = isPlayer;
    this.stats = tankStats(modelKey);
    this.maxHp = 100;
    this.hp = this.maxHp;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.turretLocalYaw = 0;
    this.barrelPitch = 0.12;
    this.alive = true;
    this.reload = 0;
    this.reloadTime = isPlayer ? 0.9 : 1.8;
    this.fireCooldown = 0;
    this.muzzleFlash = 0;
    this.aiState = { moveDir: 1, repickTimer: 0 };
    this.wreckTilt = 0;

    const gltf = models && models[modelKey];
    if (!gltf) throw new Error(`tank model '${modelKey}' not loaded`);
    this.modelKey = modelKey;
    // Strip the existing root transform baseline: clone + clone materials
    this.model = cloneMaterials(gltf.scene.clone(true));
    fixSkeletons(this.model, gltf.scene);

    // wrapper inside hullGroup (outer, positioned/rotated by setPose)
    this.group = new THREE.Group();            // outer hullGroup
    const wrapper = new THREE.Group();          // scaled + grounded
    wrapper.rotation.y = Math.PI / 2;            // model forward (-X) -> +Z
    this.group.add(wrapper);
    wrapper.add(this.model);

    // find nodes
    const findByName = (name) => {
      let found = null;
      this.model.traverse(o => { if (!found && o.name === name) found = o; });
      return found;
    };
    const turretNode = findByName('Tank_Turret');
    const gunNode = findByName('Tank_Gun');
    this.gunNode = gunNode;

    // normalize size/grounding
    wrapper.scale.setScalar(1);
    wrapper.updateWorldMatrix(true, true);
    // measure using only geometry bounding boxes (stable, no skeleton/now matrixWorld bugs)
    // force-compute bounding boxes first (fresh clones may not have them yet)
    wrapper.traverse(o => {
      if (o.isMesh && o.geometry) o.geometry.computeBoundingBox();
    });
    const _tmp = new THREE.Vector3();
    const rawBbox = new THREE.Box3();
    wrapper.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.boundingBox) {
        const bb = o.geometry.boundingBox;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          _tmp.set(x, y, z).applyMatrix4(o.matrixWorld);
          rawBbox.expandByPoint(_tmp);
        }
      }
    });
    const size = rawBbox.getSize(new THREE.Vector3());
    const s = this.lengthM / Math.max(size.x, size.z); // meters, not arbitrary units
    wrapper.scale.setScalar(s);
    // grounding from the manually measured bbox (scaled) — avoid Box3.setFromObject,
    // which returns wrong min.y for cloned/skinned rigs
    wrapper.position.y = -rawBbox.min.y * s;
    wrapper.updateWorldMatrix(true, true);

    // turret rig: reparent turret+gun under a turretGroup at turret pivot
    this.turretGroup = new THREE.Group();
    wrapper.add(this.turretGroup);
    if (turretNode && gunNode) {
      // pivot = turret node world position (wrapper-local at this moment)
      const pivot = new THREE.Vector3();
      turretNode.getWorldPosition(pivot);
      // convert to wrapper-local coordinates
      wrapper.worldToLocal(pivot);
      this.turretGroup.position.copy(pivot);
      this.turretGroup.attach(turretNode);
      this.turretGroup.attach(gunNode);
      // dedicated barrel pivot: pitch only the gun, not the turret shell
      this.barrelPivot = new THREE.Group();
      this.barrelPivot.position.copy(gunNode.position); // wrapper-scaled local coords inside turretGroup
      this.turretGroup.add(this.barrelPivot);
      this.barrelPivot.attach(gunNode);
      this.gunNode = gunNode;
    } else {
      this.turretGroup = null;
      this.barrelPivot = null;
    }

    // muzzle tip: far end of gun's long axis, farthest from turret pivot
    this.muzzle = new THREE.Object3D();
    if (gunNode) {
      const gBbox = new THREE.Box3().setFromObject(gunNode);
      const gSize = gBbox.getSize(new THREE.Vector3());
      // choose long axis in gun local space
      const axes = [['x', gSize.x], ['y', gSize.y], ['z', gSize.z]].sort((a, b) => b[1] - a[1]);
      const longAxis = axes[0][0];
      const pivotLocal = gunNode.worldToLocal(this.turretGroup ? this.turretGroup.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3());
      // tip = end of long axis farther from pivot
      const lo = gBbox.min[longAxis], hi = gBbox.max[longAxis];
      const pivotCoord = longAxis === 'x' ? pivotLocal.x : longAxis === 'y' ? pivotLocal.y : pivotLocal.z;
      const tipWorld = new THREE.Vector3();
      tipWorld.set(gBbox.min.x, gBbox.min.y, gBbox.min.z);
      // set long-axis coord to the far end
      const end = Math.abs(hi - pivotCoord) > Math.abs(lo - pivotCoord) ? hi : lo;
      // other coords: center of the bbox
      tipWorld.x = longAxis === 'x' ? end : (gBbox.min.x + gBbox.max.x) / 2;
      tipWorld.y = longAxis === 'y' ? end : (gBbox.min.y + gBbox.max.y) / 2;
      tipWorld.z = longAxis === 'z' ? end : (gBbox.min.z + gBbox.max.z) / 2;
      gunNode.updateWorldMatrix(true, false);
      gunNode.add(this.muzzle);
      this.muzzle.position.copy(gunNode.worldToLocal(tipWorld.clone()));
    }
    // fallback: if gun not found, attach to group
    if (!gunNode) {
      this.muzzle.position.set(0, 1.4, 2.0);
      this.group.add(this.muzzle);
    }

    // compute the true lateral pitch axis (in turret-local space) from the
    // actual muzzle direction — the gun node has non-identity rotation/scale,
    // so turret-local X is NOT the correct pivot axis.
    if (gunNode) {
      this.turretGroup.updateWorldMatrix(true, true);
      const turretQ = new THREE.Quaternion();
      this.turretGroup.getWorldQuaternion(turretQ);
      const turretPos = new THREE.Vector3();
      this.turretGroup.getWorldPosition(turretPos);
      const muzzlePos = new THREE.Vector3();
      this.muzzle.getWorldPosition(muzzlePos);
      const D = muzzlePos.sub(turretPos).applyQuaternion(turretQ.invert()).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      this.barrelAxis = new THREE.Vector3().crossVectors(D, up);
      if (this.barrelAxis.lengthSq() < 1e-6) this.barrelAxis.set(1, 0, 0);
      else this.barrelAxis.normalize();
    } else {
      this.barrelAxis = null;
    }
    // muzzle flash rig (hidden) as child of the muzzle — barrel-aligned, world-scale-normalized.
    // Built from additive billboard sprites + a short core cone + a point light; animated per shot.
    this.muzzle.updateWorldMatrix(true, false);
    const flashWorldScale = this.muzzle.getWorldScale(new THREE.Vector3()).x || 1;
    this.flashGroup = new THREE.Group();
    this.flashGroup.scale.setScalar(1 / Math.max(flashWorldScale, 1e-6));
    this.flashGroup.visible = false;

    const tex = makeFlashSpriteTexture();
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffdf7e, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.05, 8, 1, true), coreMat);
    core.rotation.x = Math.PI / 2;
    core.position.z = 0.55;
    this.flashGroup.add(core);

    const mkSprite = (color, scale, opacity) => {
      const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
      const sp = new THREE.Sprite(m);
      sp.scale.set(scale, scale, 1);
      sp.position.z = 0.35;
      this.flashGroup.add(sp);
      return sp;
    };
    this.flashCoreSprite = mkSprite(0xfff6c8, 0.85, 0.95);
    this.flashHaloSprite = mkSprite(0xff9330, 2.3, 0.55);
    this.flashStreakSprite = mkSprite(0xffc23d, 1.5, 0.7);

    this.flashLight = new THREE.PointLight(0xffa640, 0, 14, 2);
    this.flashLight.position.set(0, 0, 0.6);
    this.flashGroup.add(this.flashLight);

    // flash objects must never be hit by the game's aim/shell raycasters
    this.flashGroup.traverse(o => { o.raycast = () => {}; });
    this.muzzle.add(this.flashGroup);
    this._flashWorldScale = flashWorldScale;
    this.flashMesh = this.flashGroup; // kept as the visibility toggle used by main.js
    this.flashTex = tex;
    this.flashParts = { core, coreMat };
    this.flashCore = core;
    this.flashT = 0;
    this.flashDuration = 0.10;
    this.flashRotation = 0;

    // animation mixer (tracks/body only)
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = {};
    for (const clip of gltf.animations || []) {
      const suffix = clip.name.split('|').pop();
      if (/^Tank_(Forward|Backwards|TurningLeft|TurningRight)$/.test(suffix)) {
        this.clips[suffix] = this.mixer.clipAction(clip);
        this.clips[suffix].enabled = true;
        this.clips[suffix].setEffectiveTimeScale(1);
      }
    }
    this.activeClip = null;

    // materials (for wreck tint)
    this.materials = [];
    this.group.traverse(o => {
      if (o.isMesh && o.material && o !== this.flashMesh) {
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!this.materials.includes(m)) this.materials.push(m);
        }
      }
    });
    this.baseColors = this.materials.map(m => m.color ? m.color.clone() : null);

    this.animatedNodes = [];
    this.model.traverse(o => { if (o.isMesh) o.userData._animated = true; });

    scene.add(this.group);
  }

  setMotion(target) {
    const map = { forward: 'Tank_Forward', backwards: 'Tank_Backwards', left: 'Tank_TurningLeft', right: 'Tank_TurningRight' };
    const name = map[target] || null;
    const next = name ? this.clips[name] : null;
    if (this.activeClip === next) return;
    if (this.activeClip) this.activeClip.fadeOut(0.18);
    if (next) { next.reset().play(); next.fadeIn(0.18); }
    this.activeClip = next;
  }

  // Limited-rate aiming: turret/barrel converge toward a desired world yaw
  // and elevation. Rate-limited per TANK_STATS; pitch clamped to limits.
  trackAim(targetYawWorld, targetPitch, dt) {
    const s = this.stats;
    targetPitch = THREE.MathUtils.clamp(targetPitch, s.pitchMin, s.pitchMax);
    const targetLocal = targetYawWorld - this.heading;
    let diff = targetLocal - this.turretLocalYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = s.turretRate * dt;
    this.turretLocalYaw += THREE.MathUtils.clamp(diff, -maxTurn, maxTurn);
    const maxPitch = s.barrelRate * dt;
    this.barrelPitch += THREE.MathUtils.clamp(targetPitch - this.barrelPitch, -maxPitch, maxPitch);
    this.barrelPitch = THREE.MathUtils.clamp(this.barrelPitch, s.pitchMin, s.pitchMax);
  }

  setPose(dt, motion) {
    const gy = terrainHeight(this.pos.x, this.pos.z);
    this.pos.y = gy;
    this.group.rotation.order = 'YXZ'; // yaw -> pitch -> roll
    this.group.position.set(this.pos.x, gy, this.pos.z);
    this.group.rotation.y = this.heading;
    const e = 1.4;
    const hF = terrainHeight(this.pos.x + Math.sin(this.heading) * e, this.pos.z + Math.cos(this.heading) * e);
    const hB = terrainHeight(this.pos.x - Math.sin(this.heading) * e, this.pos.z - Math.cos(this.heading) * e);
    const hL = terrainHeight(this.pos.x + Math.cos(this.heading) * e, this.pos.z - Math.sin(this.heading) * e);
    const hR = terrainHeight(this.pos.x - Math.cos(this.heading) * e, this.pos.z + Math.sin(this.heading) * e);
    this.group.rotation.x = Math.atan2(hB - hF, 2 * e) * 0.8;
    this.group.rotation.z = Math.atan2(hL - hR, 2 * e) * 0.8 + this.wreckTilt;
    if (this.turretGroup) this.turretGroup.rotation.y = this.turretLocalYaw;
    if (this.barrelPivot && this.barrelAxis) {
      this.barrelPivot.quaternion.setFromAxisAngle(this.barrelAxis, this.barrelPitch);
    }
    // drive clip + mixer
    this.setMotion(motion);
    if (dt !== undefined) this.mixer.update(dt);
  }

  worldForward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  // Barrel direction with a per-shell random offset (uniform, ±inaccuracy)
  // applied to both yaw and pitch axes — this is the real fire direction.
  sampleFireDir() {
    const inacc = this.stats.inaccuracy || 0;
    const yaw = this.heading + this.turretLocalYaw + (Math.random() * 2 - 1) * inacc;
    const pitch = this.barrelPitch + (Math.random() * 2 - 1) * inacc;
    return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch),
                             Math.sin(pitch),
                             Math.cos(yaw) * Math.cos(pitch)).normalize();
  }

  barrelWorldDir() {
    const v = new THREE.Vector3(Math.sin(this.heading + this.turretLocalYaw) * Math.cos(this.barrelPitch),
                               Math.sin(this.barrelPitch),
                               Math.cos(this.heading + this.turretLocalYaw) * Math.cos(this.barrelPitch));
    return v.normalize();
  }

  muzzleWorldPos(out) { return this.muzzle.getWorldPosition(out); }

  fireFlash() {
    this.flashRotation = Math.random() * Math.PI * 2;
    this.flashDuration = 0.08 + Math.random() * 0.04;
    this.flashT = 0;
    this.flashGroup.visible = true;
    this.muzzleFlash = this.flashDuration;
  }

  updateFlash(dt) {
    if (!this.flashGroup || !this.flashGroup.visible) return;
    this.flashT += dt;
    const t = Math.min(this.flashT / this.flashDuration, 1);
    const inv = 1 - t;
    const pulse = 0.75 + inv * 0.55 + Math.random() * 0.08;
    this.flashGroup.scale.setScalar((1 / Math.max(this._flashWorldScale || 1, 1e-6)) * pulse);
    this.flashCoreSprite.material.opacity = 0.95 * Math.pow(inv, 1.3);
    this.flashHaloSprite.material.opacity = 0.55 * Math.pow(inv, 1.6);
    this.flashStreakSprite.material.opacity = 0.7 * Math.pow(inv, 1.8);
    this.flashCoreSprite.scale.set(0.85 * pulse, 0.85 * pulse, 1);
    this.flashHaloSprite.scale.set(2.3 * (0.7 + t * 0.8), 2.3 * (0.7 + t * 0.8), 1);
    this.flashStreakSprite.scale.set(1.5 * pulse, 1.5 * pulse, 1);
    this.flashStreakSprite.material.rotation = this.flashRotation + t * 1.2;
    this.flashCore.material.opacity = 0.95 * inv;
    this.flashLight.intensity = 9 * inv * inv;
    if (t >= 1) this.flashGroup.visible = false;
  }

  dispose() {
    this.group.traverse(o => {
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
    });
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    // flash rig is unique to this tank — dispose its geometries/materials/texture
    if (this.flashGroup) {
      this.flashGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      if (this.flashTex) this.flashTex.dispose();
      this.flashGroup = null;
    }
    this.flashMesh = null;
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  damage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false;
      this.speed = 0;
      for (const m of this.materials) { if (m.color) m.color.set(0x1c1c1c); }
      this.wreckTilt = 0.22;
    }
  }
}
