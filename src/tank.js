// Tank rig + behavior. Convention: hull local forward = +Z, up = +Y.
// Hull yaw θ → world forward (sinθ, 0, cosθ); mesh.rotation.y = θ.
import * as THREE from 'three';
import { terrainHeight, resolveObstacles } from './world.js';

export const TANK_RADIUS = 1.7;

export class Tank {
  constructor({ color = 0x4a6b3a, x, z, heading, isPlayer = false, scene }) {
    this.isPlayer = isPlayer;
    this.maxHp = 100;
    this.hp = this.maxHp;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;           // hull yaw
    this.speed = 0;
    this.turretLocalYaw = 0;          // relative to hull
    this.barrelPitch = 0.12;          // radians up
    this.alive = true;
    this.reload = 0;
    this.reloadTime = isPlayer ? 0.9 : 1.8;
    this.fireCooldown = 0;
    this.muzzleFlash = 0;
    this.aiState = { moveDir: 1, repickTimer: 0 };
    this.wreckTilt = 0;

    const body = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2c2f26, flatShading: true });
    const accent = new THREE.MeshLambertMaterial({ color: isPlayer ? 0x2e6e4e : 0x7a3324, flatShading: true });

    // treads
    const treadGeo = new THREE.BoxGeometry(0.62, 0.62, 2.9);
    for (const side of [-1, 1]) {
      const t = new THREE.Mesh(treadGeo, dark);
      t.position.set(side * 0.95, 0.32, 0);
      t.castShadow = true;
      body.add(t);
    }
    // hull (front distinct: sloped nose toward +Z)
    const hullGeo = new THREE.BoxGeometry(1.7, 0.62, 2.7);
    const hull = new THREE.Mesh(hullGeo, mat);
    hull.position.y = 0.86;
    hull.castShadow = true;
    body.add(hull);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.05, 0.7, 4, 1), mat);
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.scale.set(1, 1, 0.45);
    nose.position.set(0, 0.86, 1.55);
    nose.castShadow = true;
    body.add(nose);

    // turret pivot
    this.turret = new THREE.Group();
    this.turret.position.set(0, 1.32, -0.15);
    body.add(this.turret);
    const turretMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.5, 8), accent);
    turretMesh.castShadow = true;
    this.turret.add(turretMesh);

    // barrel pitch pivot
    this.barrelPivot = new THREE.Group();
    this.barrelPivot.position.set(0, 0.18, 0);
    this.turret.add(this.barrelPivot);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.9, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, 1.15);
    barrel.castShadow = true;
    this.barrelPivot.add(barrel);
    const muzzleTip = new THREE.Object3D();
    muzzleTip.position.set(0, 0, 2.15);
    this.barrelPivot.add(muzzleTip);
    this.muzzle = muzzleTip;

    // muzzle flash (hidden)
    const flash = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 1.0, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.95 })
    );
    flash.rotation.x = Math.PI / 2;
    flash.position.set(0, 0, 2.5);
    flash.visible = false;
    this.barrelPivot.add(flash);
    this.flashMesh = flash;

    this.group = body;
    this.body = body;
    this.accentMat = accent;
    this.bodyMat = mat;
    this.darkMat = dark;
    scene.add(this.group);
  }

  setPose() {
    const gy = terrainHeight(this.pos.x, this.pos.z);
    this.pos.y = gy;
    this.group.position.set(this.pos.x, gy, this.pos.z);
    this.group.rotation.y = this.heading;
    // pitch/roll from terrain gradient
    const e = 1.4;
    const hF = terrainHeight(this.pos.x + Math.sin(this.heading) * e, this.pos.z + Math.cos(this.heading) * e);
    const hB = terrainHeight(this.pos.x - Math.sin(this.heading) * e, this.pos.z - Math.cos(this.heading) * e);
    const hL = terrainHeight(this.pos.x + Math.cos(this.heading) * e, this.pos.z - Math.sin(this.heading) * e);
    const hR = terrainHeight(this.pos.x - Math.cos(this.heading) * e, this.pos.z + Math.sin(this.heading) * e);
    this.group.rotation.x = Math.atan2(hF - hB, 2 * e) * 0.8;
    this.group.rotation.z = Math.atan2(hR - hL, 2 * e) * 0.8 + this.wreckTilt;
    this.turret.rotation.y = this.turretLocalYaw;
    this.barrelPivot.rotation.x = -this.barrelPitch;
    // front-distinct: keep nose blue-ish marker on front? (nose mesh already front)
  }

  worldForward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  barrelWorldDir() {
    const v = new THREE.Vector3(Math.sin(this.heading + this.turretLocalYaw) * Math.cos(this.barrelPitch),
                                Math.sin(this.barrelPitch),
                                Math.cos(this.heading + this.turretLocalYaw) * Math.cos(this.barrelPitch));
    return v.normalize();
  }

  muzzleWorldPos(out) {
    return this.muzzle.getWorldPosition(out);
  }

  damage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false;
      this.speed = 0;
      this.accentMat.color.set(0x1c1c1c);
      this.bodyMat.color.set(0x22201c);
      this.wreckTilt = 0.22; // wreck tilt
    }
  }
}

