// Volumetric clouds + gradient sky on an inward-facing dome.
// Raymarches a 3D value-noise slab (cloudBase..cloudTop) along the view ray.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uFogColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), u.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
    u.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.08 + vec3(11.3, 7.1, 5.7);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldPos - uCamPos);
  float y = clamp(dir.y, -1.0, 1.0);
  // Gradient sky (horizon -> zenith)
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.5));
  // Sun glow
  float sunDot = clamp(dot(dir, uSunDir), 0.0, 1.0);
  sky += vec3(1.0, 0.9, 0.7) * pow(sunDot, 350.0) * 1.4;  // disc halo
  sky += vec3(1.0, 0.85, 0.6) * pow(sunDot, 6.0) * 0.22;  // broad haze

  // Volumetric clouds along the ray
  if (dir.y > 0.015) {
    float base = 120.0;
    float top = 300.0;
    float t0 = (base - uCamPos.y) / dir.y;
    float t1 = (top - uCamPos.y) / dir.y;
    if (t1 > t0 && t1 > 0.0) {
      t0 = max(t0, 0.0);
      const int STEPS = 48;
      float d = (t1 - t0) / float(STEPS);
      vec3 accum = vec3(0.0);
      float alpha = 0.0;
      vec3 p;
      for (int i = 1; i <= STEPS; i++) {
        float t = t0 + d * float(i);
        p = uCamPos + dir * t;
        // World-space cloud field, slow drift, anisotropic-ish (flattened vertically)
        vec3 q = vec3(p.x * 0.0062, p.y * 0.011, p.z * 0.0062);
        q.x += uTime * 0.006;
        q.z += uTime * 0.0026;
        // Domain warp for wispy edges
        vec2 warp = vec2(
          fbm(q * 1.35 + vec3(0.0, uTime * 0.008, 2.1)),
          fbm(q * 1.35 + vec3(7.3, 5.1, 0.7))
        ) - 0.5;
        q += vec3(warp.x, 0.0, warp.y) * 0.9;
        float n = fbm(q);

        // Density: fade near slab edges, threshold below full coverage
        float h = (p.y - base) / (top - base);
        float profile = smoothstep(0.0, 0.22, h) * smoothstep(1.0, 0.55, h);
        // Pocket-shaped: sharper edges on the high side
        float density = smoothstep(0.54, 0.82, n) * profile;
        float stepAlpha = density * 0.42;

        // Lighting: bright on tops, darker belly, warmed toward the sun side
        float sunFace = 0.5 + 0.5 * dot(normalize(vec3(dir.xz, 0.0)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z)));
        float topLit = smoothstep(0.15, 0.85, h);
        float lit = mix(0.18, 1.0, topLit * (0.55 + 0.45 * sunFace));
        vec3 cCol = mix(vec3(0.52, 0.56, 0.66), vec3(1.05, 1.02, 0.97), lit);
        // Sun-facing edge glow
        cCol += vec3(1.0, 0.9, 0.65) * pow(sunDot, 3.0) * 0.18 * lit;
        accum += cCol * stepAlpha * (1.0 - alpha);
        alpha += stepAlpha * (1.0 - alpha);
        if (alpha > 0.94) break;
      }
      vec3 cloudCol = accum / max(alpha, 1e-3);
      sky = mix(sky, cloudCol, alpha);
    }
  }

  // Blend the very-low-angle sky into fog color to match the scene fog
  sky = mix(uFogColor, sky, smoothstep(-0.03, 0.12, dir.y));
  gl_FragColor = vec4(sky, 1.0);
}`;

export function createSky(scene) {
  const uniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0.45, 0.68, 0.28).normalize() },
    uTime: { value: 0 },
    uHorizon: { value: new THREE.Color(0xc4d6e6) },
    uZenith: { value: new THREE.Color(0x3a6e9e) },
    uFogColor: { value: new THREE.Color(0x87a7bd) },
  };
  const geo = new THREE.SphereGeometry(900, 64, 32);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  scene.add(mesh);

  // Keep the dome centered on the camera (no parallax, no clipping at edges)
  function update(t, camera) {
    uniforms.uTime.value = t;
    uniforms.uCamPos.value.copy(camera.position);
    mesh.position.copy(camera.position);
  }
  return { mesh, uniforms, update };
}
