// Tank rig + behavior. Convention: hull local forward = +Z, up = +Y.
// Hull yaw θ → world forward (sinθ, 0, cosθ); mesh.rotation.y = θ.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight } from './world.js';
import { ASSETS, tankRadius } from './scale.js';

export const TANK_MODELS = Object.fromEntries(
  Object.entries(ASSETS).filter(([, a]) => a.kind === 'tank').map(([k, a]) => [k, a.url])
);
export const TANK_RADIUS = tankRadius(6); // default footprint; per-tank radius = tankRadius(lengthM)

const loader = new GLTFLoader();

const _tmpV = new THREE.Vector3();

export async function loadTankModels() {
  const entries = await Promise.all(Object.entries(ASSETS).filter(([, a]) => a.kind === 'tank').map(async ([key, asset]) => {
    const gltf = await new Promise((res, rej) => loader.load(asset.url, res, undefined, rej));
    return [key, gltf];
  }));
  return Object.fromEntries(entries); // {tank_1: gltf, ...}
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
  constructor({ modelKey = 'tank_2', x, z, heading, isPlayer = false, scene, models, lengthM }) {
    this.lengthM = lengthM ?? ASSETS[modelKey]?.lengthM ?? 6;
    this.collisionRadius = tankRadius(this.lengthM);
    this.isPlayer = isPlayer;
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
    } else {
      this.turretGroup = null;
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

    // muzzle flash (hidden) as child of muzzle — scale it so it renders ~0.5 units regardless of model scale
    // note: gBbox/gSize were computed BEFORE this block; guard for the no-gun fallback where gunNode is null
    const flash = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 1.0, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.95 })
    );
    // compute the world scale of the muzzle so the cone renders the right size in world units
    this.muzzle.updateWorldMatrix(true, false);
    const flashWorldScale = this.muzzle.getWorldScale(new THREE.Vector3()).x || 1;
    flash.scale.setScalar(1 / Math.max(flashWorldScale, 1e-6));
    flash.rotation.x = Math.PI / 2;
    flash.visible = false;
    this.muzzle.add(flash);
    this.flashMesh = flash;

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

  setPose(dt, motion) {
    const gy = terrainHeight(this.pos.x, this.pos.z);
    this.pos.y = gy;
    this.group.position.set(this.pos.x, gy, this.pos.z);
    this.group.rotation.y = this.heading;
    const e = 1.4;
    const hF = terrainHeight(this.pos.x + Math.sin(this.heading) * e, this.pos.z + Math.cos(this.heading) * e);
    const hB = terrainHeight(this.pos.x - Math.sin(this.heading) * e, this.pos.z - Math.cos(this.heading) * e);
    const hL = terrainHeight(this.pos.x + Math.cos(this.heading) * e, this.pos.z - Math.sin(this.heading) * e);
    const hR = terrainHeight(this.pos.x - Math.cos(this.heading) * e, this.pos.z + Math.sin(this.heading) * e);
    this.group.rotation.x = Math.atan2(hF - hB, 2 * e) * 0.8;
    this.group.rotation.z = Math.atan2(hR - hL, 2 * e) * 0.8 + this.wreckTilt;
    if (this.turretGroup) {
      this.turretGroup.rotation.y = this.turretLocalYaw;
      this.turretGroup.rotation.x = -this.barrelPitch; // subtle pitch roll on turret
    }
    // drive clip + mixer
    this.setMotion(motion);
    if (dt !== undefined) this.mixer.update(dt);
  }

  worldForward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  barrelWorldDir() {
    const v = new THREE.Vector3(Math.sin(this.heading + this.turretLocalYaw) * Math.cos(this.barrelPitch),
                               Math.sin(this.barrelPitch),
                               Math.cos(this.heading + this.turretLocalYaw) * Math.cos(this.barrelPitch));
    return v.normalize();
  }

  muzzleWorldPos(out) { return this.muzzle.getWorldPosition(out); }

  dispose() {
    this.group.traverse(o => {
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
    });
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
