// Instanced barley in crops regions — crossed-quad sprites, wind sway, distance fade.
// Unlike grass (random scatter), barley grows in North/South rows:
// rows at even X (2 m spacing), plants 1 m apart along Z, 0.7 m tall, uniform scale.
import * as THREE from 'three';
import { terrainHeight, PLAY_BOUND } from './world.js';
import { regionAt, roadAt } from './level.js';
import { isObstacleAt, inBridgeSpan, RIM_HEIGHT } from './ground.js';

const ROW_SPACING = 2;        // m between rows (X)
const PLANT_SPACING = 1;      // m between plants along Z
const PLANT_HEIGHT = 0.7;     // m (uniform scale — texture aspect preserved)
const WIND_STRENGTH = 0.22;
const WIND_FREQ = 2.1;
const FADE_START = 120;
const FADE_END = 400;
const ALPHA_FADE = 0.12;
const SEED = 9021;
const COLOR_LO = new THREE.Color(0.85, 0.78, 0.45);  // muted gold/straw
const COLOR_HI = new THREE.Color(1.08, 0.95, 0.55);  // brighter straw

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTuftGeometry() {
  const quads = ['x', 'z'];
  const pos = [], uv = [], idx = [];
  let base = 0;
  for (const axis of quads) {
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
  const norm = [];
  for (let i = 0; i < pos.length / 3; i++) norm.push(0, 1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setIndex(idx);
  return g;
}

export function createBarley(scene, level = null) {
  const barleyTex = new THREE.TextureLoader().load('/textures/barley_tuft.png');
  barleyTex.anisotropy = 4;
  barleyTex.colorSpace = THREE.SRGBColorSpace;

  // Collect placements first (deterministic grid anchored to world origin)
  const placements = [];
  const rng = mulberry32(SEED);
  if (level) {
    for (const region of level.terrain.regions) {
      if (region.type !== 'crops') continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of region.points) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      for (let x = Math.ceil(minX / ROW_SPACING) * ROW_SPACING; x <= maxX; x += ROW_SPACING) {
        for (let z = Math.ceil(minZ / PLANT_SPACING) * PLANT_SPACING; z <= maxZ; z += PLANT_SPACING) {
          if (Math.abs(x) > PLAY_BOUND || Math.abs(z) > PLAY_BOUND) continue;
          if (regionAt(level, x, z) !== 'crops') continue;
          if (roadAt(level, x, z)) continue;
          if (isObstacleAt(x, z, 1.5)) continue;
          if (inBridgeSpan(x, z, 3)) continue;
          if (terrainHeight(x, z) > RIM_HEIGHT) continue;
          const y = terrainHeight(x, z);
          placements.push({ x, y, z, rot: rng() * Math.PI * 2, phase: rng() * Math.PI * 2, tint: rng() });
        }
      }
    }
  }

  const count = placements.length;
  if (count === 0) {
    console.log('barley: no crops regions — nothing placed');
    return { mesh: null, update() {} };
  }

  const geo = buildTuftGeometry();
  const uniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: WIND_STRENGTH },
    uWindFreq: { value: WIND_FREQ },
    uFadeStart: { value: FADE_START },
    uFadeEnd: { value: FADE_END },
    uAlphaFade: { value: ALPHA_FADE },
  };

  const mat = new THREE.MeshLambertMaterial({
    map: barleyTex,
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
  float barleyDist = distance(worldPos.xyz, cameraPosition);
  vAlpha = 1.0 - smoothstep(uFadeStart, uFadeEnd, barleyDist);
  vTint = aTint;
}`
    );
    shader.fragmentShader = `
varying float vAlpha;
varying vec3 vTint;
` + shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
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
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const phase = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = placements[i];
    dummy.position.set(p.x, p.y - 0.03, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.set(PLANT_HEIGHT, PLANT_HEIGHT, PLANT_HEIGHT);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    phase[i] = p.phase;
    const c = COLOR_LO.clone().lerp(COLOR_HI, p.tint);
    tint[i * 3] = c.r; tint[i * 3 + 1] = c.g; tint[i * 3 + 2] = c.b;
  }
  mesh.instanceMatrix.needsUpdate = true;
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));

  scene.add(mesh);
  console.log(`barley: placed ${count} plants in crops regions`);
  return { mesh, update(t) { uniforms.uTime.value = t; } };
}
