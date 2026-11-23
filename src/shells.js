// Shell simulation: gravity, segmented collision, trail, impact FX.
import * as THREE from 'three';
import { terrainHeight, obstacles, WORLD_SIZE } from './world.js';

function logImpact(o){ if (typeof window!=='undefined' && window.__iv) { if (!Array.isArray(window.__iv.impacts)) window.__iv.impacts=[]; window.__iv.impacts.push(o); } }

export const SHELL_SPEED = 46;
export const GRAVITY = 16;

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
      // obstacles (rocks/ruins as spheres)
      for (const o of obstacles) {
        const base = terrainHeight(o.x, o.z);
        const c = new THREE.Vector3(o.x, base + o.r * 0.8, o.z);
        if (q.distanceTo(c) < o.r) {
          return { point: q, hitTank: null, hitObstacle: 'rock' };
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
  constructor(scene, origin, vel, owner) {
    this.scene = scene;
    this.owner = owner;
    this.pos = origin.clone();
    this.vel = vel.clone();
    this.life = 5.0;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffe27a })
    );
    scene.add(this.mesh);
    // trail
    this.trailPositions = new Float32Array(60 * 3);
    this.trailCount = 0;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.7 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
  }

  step(dt, tanks) {
    this.life -= dt;
    if (this.life <= 0) { this.dispose(); return { consumed: true, reason: 'expired' }; }
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    this.vel.y -= GRAVITY * dt;
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
      // obstacles
      for (const o of obstacles) {
        const base = terrainHeight(o.x, o.z);
        const c = new THREE.Vector3(o.x, base + o.r * 0.8, o.z);
        if (q.distanceTo(c) < o.r) {
          this.impact(q);
          logImpact({reason:'obstacle',x:q.x,y:q.y,z:q.z});
          return { consumed: true, reason: 'obstacle', impactPoint: q };
        }
      }
      // tanks (exclude owner)
      for (const tank of tanks) {
        if (tank === this.owner || !tank.alive) continue;
        const tc = new THREE.Vector3(tank.pos.x, tank.pos.y + 1.2, tank.pos.z);
        if (q.distanceTo(tc) < 1.9) {
          this.impact(q);
          logImpact({reason:'tank',x:q.x,y:q.y,z:q.z});
          return { consumed: true, reason: 'tank', target: tank, impactPoint: q };
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
    if (this.trailCount < 60) {
      this.trailPositions[this.trailCount * 3] = this.pos.x;
      this.trailPositions[this.trailCount * 3 + 1] = this.pos.y;
      this.trailPositions[this.trailCount * 3 + 2] = this.pos.z;
      this.trailCount++;
    } else {
      for (let i = 0; i < 59; i++) {
        this.trailPositions[i * 3] = this.trailPositions[(i + 1) * 3];
        this.trailPositions[i * 3 + 1] = this.trailPositions[(i + 1) * 3 + 1];
        this.trailPositions[i * 3 + 2] = this.trailPositions[(i + 1) * 3 + 2];
      }
      this.trailPositions[59 * 3] = this.pos.x;
      this.trailPositions[59 * 3 + 1] = this.pos.y;
      this.trailPositions[59 * 3 + 2] = this.pos.z;
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
