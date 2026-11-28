// Flagpole: model loading + flag animation behavior.
// Instances are created by src/objects.js from level.json. The pole itself is
// static geometry (Blender asset, 10 m tall). The flag is a runtime plane
// (width 2.8 m) driven here: enemy flag raised at start; when the player's
// tank is within 10 m of the pole, the enemy flag lowers to the ground over
// 10 s, swaps texture to USA, and is raised back up over another 10 s.
// State is latched: once triggered it never reverts within a match.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS } from './scale.js';

const flagTexLoader = new THREE.TextureLoader();

export const FLAGPOLE_TUNING = {
  width: 2.8,        // flag width in meters (both flags same width)
  enemyAspect: 1.6666666666666667, // enemy_flag.png 500x300
  usaAspect: 1.9011406844106464,   // usa_flag.png 500x263
  triggerRadius: 15, // m — player must be within this of the pole
  lowerTime: 10.0,   // s to lower the enemy flag
  raiseTime: 10.0,   // s to raise the USA flag
  flagTopY: 10.35,   // flag top hangs just under the gold finial (local)
  minBottomY: 0.25,  // flag bottom must stay above this height above the ground
  groundOffset: 0.0, // pole base is at terrain; flag slides along it
};

export async function loadFlagpoleModel() {
  const asset = ASSETS.flagpole;
  const gltf = await new Promise((res, rej) => new GLTFLoader().load(asset.url, res, undefined, rej));
  const source = new THREE.Group();
  source.add(gltf.scene);
  return source; // authored at real scale (10 m) — no footprint scaling
}

const FLAG_ASPECT = { enemy: FLAGPOLE_TUNING.enemyAspect, usa: FLAGPOLE_TUNING.usaAspect };
const FLAG_URL = { enemy: '/textures/enemy_flag.png', usa: '/textures/usa_flag.png' };

export class Flagpole {
  constructor(scene, def, instance) {
    this.def = def;
    this.group = instance;
    this.worldScale = this.group.scale.x;

    this.textures = {};
    this.textures.enemy = flagTexLoader.load(FLAG_URL.enemy);
    this.textures.usa = flagTexLoader.load(FLAG_URL.usa);
    for (const k of ['enemy', 'usa']) {
      this.textures[k].colorSpace = THREE.SRGBColorSpace;
      this.textures[k].anisotropy = 4;
    }

    // Flag: plane with pivot at top-center, so we can slide it down the pole.
    this.makeFlag('enemy');

    // Current state
    this.state = 'idle'; // idle | lowering | swapping | raising | done
    this.timer = 0;
    this.flagHeight = this._flagHeight('enemy');

    // Top-of-pole anchor: parented to the instance so it inherits placement.
    this.anchor = new THREE.Group();
    this.anchor.position.set(0, FLAGPOLE_TUNING.flagTopY, 0);
    this.group.add(this.anchor);
    // Re-parent the flag plane under the anchor
    this.anchor.add(this._flagMesh);
    this._flagMesh.position.set(0, 0, 0); // local: already top-center pivot
    this._flagMesh.rotation.y = 0;
  }

  _flagHeight(kind) {
    return FLAGPOLE_TUNING.width / FLAG_ASPECT[kind];
  }

  _flagGeometry(kind) {
    const w = FLAGPOLE_TUNING.width;
    const h = this._flagHeight(kind);
    // PlaneGeometry(w, h) has pivot at center — translate so the hoist edge is
    // on the pole (x=0): the flag extends in +X with its top edge at y=0.
    const geo = new THREE.PlaneGeometry(w, h, 16, 8);
    geo.translate(w / 2, -h / 2, 0);
    return geo;
  }

  _flagMaterial(kind) {
    return new THREE.MeshStandardMaterial({
      map: this.textures[kind],
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.0,
      transparent: false,
      shadowSide: THREE.DoubleSide,
    });
  }

  makeFlag(kind) {
    // Dispose of the old flag if any
    if (this._flagMesh) {
      this._flagMesh.parent?.remove(this._flagMesh);
      this._flagMesh.geometry.dispose();
      this._flagMesh.material.dispose();
    }
    const mesh = new THREE.Mesh(this._flagGeometry(kind), this._flagMaterial(kind));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.name = 'Flag_' + kind;
    if (this.anchor) {
      this.anchor.add(mesh);
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
    }
    this._flagMesh = mesh;
    this._flagKind = kind;
  }

  setFlagTexture(kind) {
    this.makeFlag(kind);
    this.flagHeight = this._flagHeight(kind);
  }

  // Slide the flag down the pole (or back up) for the current animation phase.
  // t in [0,1]: 0 = fully raised (top), 1 = lowered to the ground.
  // Local Y of the anchor (top of pole) is fixed; instead we drive the flag
  // plane's own y offset so it slides from top (0) to bottom of pole (-move).
  _setProgress(t) {
    // t in [0,1]: 0 = fully raised (flag top at pole top), 1 = lowered to the ground.
    // groundBottomY is the flag bottom's lowest reachable local height (~0.25 m).
    const h = this.flagHeight;
    const maxSlide = FLAGPOLE_TUNING.flagTopY - FLAGPOLE_TUNING.minBottomY - h;
    this._flagMesh.position.y = -maxSlide * t;
  }

  reset() {
    this.state = 'idle';
    this.timer = 0;
    this.setFlagTexture('enemy');
    this._setProgress(0);
  }

  update(dt, worldPos) {
    if (this.state === 'done') return;
    if (this.state === 'idle') {
      if (!worldPos) return;
      // distance from player to pole (horizontal)
      const dx = worldPos.x - this.group.position.x;
      const dz = worldPos.z - this.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < FLAGPOLE_TUNING.triggerRadius) {
        this.state = 'lowering';
        this.timer = 0;
      }
      return;
    }
    // Paused while the player is outside the radius — progress only advances inside.
    if (!worldPos) return;
    const dxP = worldPos.x - this.group.position.x;
    const dzP = worldPos.z - this.group.position.z;
    if (Math.hypot(dxP, dzP) >= FLAGPOLE_TUNING.triggerRadius) return;
    this.timer += dt;
    if (this.state === 'lowering') {
      const t = Math.min(1, this.timer / FLAGPOLE_TUNING.lowerTime);
      this._setProgress(t);
      if (t >= 1) {
        this.state = 'swapping';
        this.timer = 0;
        this.setFlagTexture('usa');
        this._setProgress(1);
      }
      return;
    }
    if (this.state === 'swapping') {
      // One frame of swap-time, then start raising
      this.state = 'raising';
      this.timer = 0;
      return;
    }
    if (this.state === 'raising') {
      const t = Math.min(1, this.timer / FLAGPOLE_TUNING.raiseTime);
      // t=0 is still at ground (t=1 of lowering), slide back up
      this._setProgress(1 - t);
      if (t >= 1) {
        this.state = 'done';
        this._setProgress(0);
      }
      return;
    }
  }
}
