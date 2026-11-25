// Instanced grass tufts — crossed-quad sprites with wind sway + distance fade.
import * as THREE from 'three';
import { terrainHeight, PLAY_BOUND } from './world.js';
import { groundZone } from './ground.js';

// ---- tunables ----
const TUFT_COUNT = 120000;
const WIND_STRENGTH = 0.28;      // max sideways displacement at tips (m)
const WIND_FREQ = 2.1;
const FADE_START = 120;           // start fading (m)
const FADE_END = 400;            // discarded beyond this (m)
const ALPHA_FADE = 0.12;         // discard threshold
const SEED = 4242;               // deterministic scatter
// brightness/tint multipliers applied on top of the blade texture
const COLOR_LO = new THREE.Color(0.78, 0.9, 0.55);  // darker / greener
const COLOR_HI = new THREE.Color(1.12, 1.08, 0.78);  // brighter / yellower

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTuftGeometry() {
  // Two quads crossed at 90°, origin at base, y: 0..1 (scaled by instance)
  const quads = ['x', 'z'];
  const pos = [], uv = [], idx = [];
  let base = 0;
  for (const axis of quads) {
    // 4 verts: BL, BR, TL, TR
    const verts = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]];
    for (let i = 0; i < 4; i++) {
      const [u, v] = verts[i];
      if (axis === 'x') pos.push(u, v, 0);
      else pos.push(0, v, u);
      uv.push(i % 2 === 0 ? 0 : 1, v);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    base += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // fake up-facing normals so grass self-lights regardless of camera angle
  const norm = [];
  for (let i = 0; i < pos.length / 3; i++) norm.push(0, 1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setIndex(idx);
  return g;
}

export function createGrass(scene) {
  const bladeTex = new THREE.TextureLoader().load('/textures/grass_blade.png');
  bladeTex.anisotropy = 4;
  bladeTex.colorSpace = THREE.SRGBColorSpace;

  const geo = buildTuftGeometry();
  const count = TUFT_COUNT;

  const uniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: WIND_STRENGTH },
    uWindFreq: { value: WIND_FREQ },
    uFadeStart: { value: FADE_START },
    uFadeEnd: { value: FADE_END },
    uAlphaFade: { value: ALPHA_FADE },
  };

  const mat = new THREE.MeshLambertMaterial({
    map: bladeTex,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `
attribute float aPhase;
attribute vec3 aTint;
uniform float uTime;
uniform float uWindStrength;
uniform float uWindFreq;
uniform float uFadeStart;
uniform float uFadeEnd;
varying float vAlpha;
varying vec3 vTint;
` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
{
  float heightFactor = clamp(position.y, 0.0, 1.0);
  float sway = sin(uTime * uWindFreq + aPhase) * uWindStrength * heightFactor * heightFactor;
  transformed.x += sway;
  transformed.z += sway * 0.6;
  #ifdef USE_INSTANCING
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #else
    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
  #endif
  float grassDist = distance(worldPos.xyz, cameraPosition);
  vAlpha = 1.0 - smoothstep(uFadeStart, uFadeEnd, grassDist);
  vTint = aTint;
}`
    );
    shader.fragmentShader = `
varying float vAlpha;
varying vec3 vTint;
` + shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
// Crossed-quad grass must light the same on both sides: force a world-up
// normal in view space so three.js doesn't flip it (front/back, up/down).
vec3 viewUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
normal = viewUp;
nonPerturbedNormal = viewUp;`
    ).replace(
      '#include <map_fragment>',
      `#include <map_fragment>
if (vAlpha < 0.12) discard;
diffuseColor.rgb *= vTint;`
    );
  };

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // Scatter
  const rng = mulberry32(SEED);
  const dummy = new THREE.Object3D();
  const phase = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  let placed = 0, guard = 0;
  const maxAttempts = count * 8;
  while (placed < count && guard++ < maxAttempts) {
    const x = (rng() * 2 - 1) * PLAY_BOUND;
    const z = (rng() * 2 - 1) * PLAY_BOUND;
    if (groundZone(x, z) !== 'grass') continue;
    const y = terrainHeight(x, z);
    const s = 0.5 + rng() * 0.5;  // uniform 0.5–1.0 m
    dummy.position.set(x, y - 0.05, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    phase[placed] = rng() * Math.PI * 2;
    const t = rng();
    const c = COLOR_LO.clone().lerp(COLOR_HI, t);
    // subtle darkening with height (dry high ground)
    const heightFactor = Math.min(1, Math.max(0, (y + 2) / 10));
    c.multiplyScalar(1 - heightFactor * 0.18);
    tint[placed * 3] = c.r; tint[placed * 3 + 1] = c.g; tint[placed * 3 + 2] = c.b;
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase.slice(0, placed), 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint.slice(0, placed * 3), 3));

  scene.add(mesh);
  console.log(`grass: placed ${placed} tufts`);
  return { mesh, update(t) { uniforms.uTime.value = t; } };
}
