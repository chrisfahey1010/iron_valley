// Shell simulation: gravity, segmented collision, trail, impact FX.
import * as THREE from 'three';
import { terrainHeight, treeColliders, treesNear, farmhouseColliders, deadTankColliders, WORLD_SIZE } from './world.js';

const _mgTmp = new THREE.Vector3();

function logImpact(o){ if (typeof window!=='undefined' && window.__iv) { if (!Array.isArray(window.__iv.impacts)) window.__iv.impacts=[]; window.__iv.impacts.push(o); } }

export const SHELL_SPEED = 500; // m/s — real-world shell speed
export const GRAVITY = 9.81; // m/s² — real-world gravity

function boxHit(q, b) {
  const dx = q.x - b.x, dz = q.z - b.z;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (Math.abs(lx) > b.halfW || Math.abs(lz) > b.halfD) return false;
  const base = terrainHeight(b.x, b.z);
  return q.y >= base - 0.5 && q.y <= base + 8;
}


function trunkHit(q) {
  const near = treesNear(q.x, q.z, 0.15);
  for (const t of near) {
    const base = t.base ?? terrainHeight(t.x, t.z);
    if (Math.abs(q.y - base) < 12 && (q.x - t.x) ** 2 + (q.z - t.z) ** 2 < (t.r + 0.15) ** 2) return t;
  }
  return null;
}

// Predict a trajectory from a muzzle pose; returns { point, hitTank, hitObstacle } or null.
export function predictPath({ muzzle, dir, tanks, maxTime = 4.0 }) {
  const dt = 1 / 120;
  let p = muzzle.clone();
  let v = dir.clone().multiplyScalar(SHELL_SPEED);
  const aliveTanks = tanks.filter(t => t.alive && t.pos);
  for (let t = 0; t < maxTime; t += dt) {
    const next = p.clone().addScaledVector(v, dt);
    const segLen = next.distanceTo(p);
    const steps = Math.max(1, Math.ceil(segLen / 0.5));
    for (let i = 1; i <= steps; i++) {
      const q = p.clone().lerp(next, i / steps);
      // terrain
      if (q.y <= terrainHeight(q.x, q.z) + 0.1) {
        return { point: q, hitTank: null, hitObstacle: 'terrain' };
      }
      // farmhouses (rock-impact style hit)
      for (const b of farmhouseColliders) {
        if (boxHit(q, b)) return { point: q, hitTank: null, hitObstacle: 'rock' };
      }
      // tree trunks (leaves pass through)
      if (trunkHit(q)) return { point: q, hitTank: null, hitObstacle: 'rock' };
      // dead tank wrecks
      for (const w of deadTankColliders) {
        const base = terrainHeight(w.x, w.z);
        const c = new THREE.Vector3(w.x, base + 1.2, w.z);
        if (q.distanceTo(c) < w.r + 0.5) {
          return { point: q, hitTank: { wreck: true, pos: { x: w.x, y: base, z: w.z } }, hitObstacle: null };
        }
      }
      // tanks
      for (const tank of aliveTanks) {
        const tc = new THREE.Vector3(tank.pos.x, tank.pos.y + 1.2, tank.pos.z);
        if (q.distanceTo(tc) < 1.9) {
          return { point: q, hitTank: tank, hitObstacle: null };
        }
      }
      // world bounds
      if (Math.abs(q.x) > WORLD_SIZE / 2 || Math.abs(q.z) > WORLD_SIZE / 2) {
        return null;
      }
    }
    p = next;
    v.y -= GRAVITY * dt;
  }
  return null;
}

export class Shell {
  constructor(scene, origin, vel, owner, opts = {}) {
    this.scene = scene;
    this.owner = owner;
    this.bullet = opts.bullet ?? false;
    this.gravity = opts.gravity ?? GRAVITY;
    this.pos = origin.clone();
    this.vel = vel.clone();
    this.life = opts.life ?? 5.0;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(opts.radius ?? 0.22, 6, 5),
      new THREE.MeshBasicMaterial({ color: opts.color ?? 0xffe27a })
    );
    scene.add(this.mesh);
    // trail
    this.trailMax = opts.trailPoints ?? 24;
    this.trailPositions = new Float32Array(this.trailMax * 3);
    this.trailCount = 0;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: opts.trailColor ?? 0xffc94d, transparent: true, opacity: opts.trailOpacity ?? 0.7 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
  }

  step(dt, tanks, mgas) {
    this.life -= dt;
    if (this.life <= 0) { this.dispose(); return { consumed: true, reason: 'expired' }; }
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    this.vel.y -= this.gravity * dt;
    const segLen = next.distanceTo(this.pos);
    const steps = Math.max(1, Math.ceil(segLen / 0.5));
    for (let i = 1; i <= steps; i++) {
      const q = this.pos.clone().lerp(next, i / steps);
      // terrain
      if (q.y <= terrainHeight(q.x, q.z) + 0.05) {
        this.impact(q);
        logImpact({reason:'terrain',x:q.x,y:q.y,z:q.z});
        return { consumed: true, reason: 'terrain', impactPoint: q };
      }
      // farmhouses (rock-impact style hit)
      for (const b of farmhouseColliders) {
        if (boxHit(q, b)) {
          this.impact(q);
          logImpact({reason:'farmhouse',x:q.x,y:q.y,z:q.z});
          return { consumed: true, reason: 'farmhouse', impactPoint: q };
        }
      }
      // tree trunks (leaves pass through)
      if (trunkHit(q)) {
        this.impact(q);
        logImpact({reason:'tree',x:q.x,y:q.y,z:q.z});
        return { consumed: true, reason: 'tree', impactPoint: q };
      }
      // dead tank wrecks (no damage, tank-style impact)
      for (const w of deadTankColliders) {
        const base = terrainHeight(w.x, w.z);
        const c = new THREE.Vector3(w.x, base + 1.2, w.z);
        if (q.distanceTo(c) < w.r + 0.5) {
          this.impact(q);
          logImpact({reason:'wreck',x:q.x,y:q.y,z:q.z});
          return { consumed: true, reason: 'wreck', target: { wreck: true, pos: new THREE.Vector3(w.x, base, w.z) }, impactPoint: q };
        }
      }
      // tanks (exclude owner; wrecks handled above)
      for (const tank of tanks) {
        if (tank === this.owner || !tank.alive) continue;
        const tc = new THREE.Vector3(tank.pos.x, tank.pos.y + 1.2, tank.pos.z);
        if (q.distanceTo(tc) < 1.9) {
          this.impact(q);
          logImpact({reason:'tank',x:q.x,y:q.y,z:q.z});
          return { consumed: true, reason: 'tank', target: tank, impactPoint: q };
        }
      }
      // MG emplacements: tank-fired shells only (bullets never trigger this)
      if (mgas && !this.bullet) {
        for (const mg of mgas) {
          if (!mg || !mg.turret) continue;
          // turret hit — even with sandbags up (barrel pokes above them)
          if (mg.armed) {
            const c = mg.turretCenterWorld(_mgTmp);
            if (q.distanceTo(c) < 0.8 * mg.worldScale) {
              this.impact(q);
              logImpact({reason:'turret',x:q.x,y:q.y,z:q.z});
              return { consumed: true, reason: 'turret', target: mg, impactPoint: q };
            }
          }
          // sandbag hit — any shell within the footprint band
          if (mg.sandbagsUp) {
            const dx = q.x - mg.group.position.x, dz = q.z - mg.group.position.z;
            if (Math.hypot(dx, dz) < mg.footprintR
              && q.y < mg.group.position.y + 0.85 * mg.worldScale + 0.2) {
              this.impact(q);
              logImpact({reason:'sandbag',x:q.x,y:q.y,z:q.z});
              return { consumed: true, reason: 'sandbag', target: mg, impactPoint: q };
            }
          }
        }
      }
      if (Math.abs(q.x) > WORLD_SIZE / 2 || Math.abs(q.z) > WORLD_SIZE / 2) {
        this.impact(q);
        logImpact({reason:'bounds',x:q.x,y:q.y,z:q.z});
        return { consumed: true, reason: 'bounds', impactPoint: q };
      }
    }
    this.pos.copy(next);
    this.mesh.position.copy(this.pos);
    // trail
    if (this.trailCount < this.trailMax) {
      this.trailPositions[this.trailCount * 3] = this.pos.x;
      this.trailPositions[this.trailCount * 3 + 1] = this.pos.y;
      this.trailPositions[this.trailCount * 3 + 2] = this.pos.z;
      this.trailCount++;
    } else {
      for (let i = 0; i < this.trailMax - 1; i++) {
        this.trailPositions[i * 3] = this.trailPositions[(i + 1) * 3];
        this.trailPositions[i * 3 + 1] = this.trailPositions[(i + 1) * 3 + 1];
        this.trailPositions[i * 3 + 2] = this.trailPositions[(i + 1) * 3 + 2];
      }
      const last = (this.trailMax - 1) * 3;
      this.trailPositions[last] = this.pos.x;
      this.trailPositions[last + 1] = this.pos.y;
      this.trailPositions[last + 2] = this.pos.z;
    }
    this.trail.geometry.setDrawRange(0, this.trailCount);
    this.trail.geometry.attributes.position.needsUpdate = true;
    return { consumed: false };
  }

  impact(point) {
    // small flash sprite
    const fx = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 })
    );
    fx.position.copy(point);
    this.scene.add(fx);
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 420;
      if (t >= 1) { this.scene.remove(fx); fx.geometry.dispose(); fx.material.dispose(); return; }
      fx.scale.setScalar(1 + t * 2.4);
      fx.material.opacity = 0.9 * (1 - t);
      requestAnimationFrame(tick);
    };
    tick();
  }

  dispose() {
    this.scene.remove(this.mesh); this.scene.remove(this.trail);
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.trail.geometry.dispose(); this.trail.material.dispose();
  }
}
