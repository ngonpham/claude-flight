/**
 * The sea: one large plane with a shader that scrolls with the level. Gerstner-like sums of
 * directional waves plus two octaves of value noise give the normal; the colour mixes the deep and
 * shallow tints of the level by a fresnel term, reflects the fog/sky colour at grazing angles, adds a
 * sun glint and sparse whitecaps, then the scene fog. All terms are clamped so a bad uniform can
 * never produce NaN (which bloom-free tone mapping would still show as black blocks).
 */
import * as THREE from 'three';

const vert = /* glsl */ `
uniform float uScroll;
varying vec2 vSea;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  // Sea coordinates: x across, y along the scroll (fixed to the water).
  vSea = vec2(position.x, uScroll - position.z);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uGlint;
varying vec2 vSea;
varying vec3 vWorld;
#include <fog_pars_fragment>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Height field gradient of a sum of travelling waves.
vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d1 = normalize(vec2(0.3, 1.0)), d2 = normalize(vec2(-0.8, 0.6)), d3 = normalize(vec2(0.9, -0.2)), d4 = normalize(vec2(-0.2, -1.0));
  // Long swell (regular) under choppy noise (irregular), so the glints do not line up in stripes.
  g += d1 * cos(dot(d1, p) * 0.55 + t * 1.1) * 0.55 * 0.13;
  g += d2 * cos(dot(d2, p) * 0.9 + t * 1.5) * 0.9 * 0.07;
  g += d3 * cos(dot(d3, p) * 1.7 + t * 2.1) * 1.7 * 0.03;
  g += d4 * cos(dot(d4, p) * 2.9 + t * 2.7) * 2.9 * 0.015;
  float e = 0.15;
  vec2 q = p * 1.3 + t * 0.4;
  float n0 = noise(q);
  g += vec2(noise(q + vec2(e, 0.0)) - n0, noise(q + vec2(0.0, e)) - n0) / e * 0.09;
  vec2 r = p * 3.1 - t * vec2(0.3, 0.7);
  float n1 = noise(r);
  g += vec2(noise(r + vec2(e, 0.0)) - n1, noise(r + vec2(0.0, e)) - n1) / e * 0.045;
  return g;
}
void main() {
  vec2 g = waveGrad(vSea, uTime);
  // World normal: sea x → world x, sea y → world −z.
  vec3 n = normalize(vec3(-g.x, 1.0, g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 4.0) * 0.6 + 0.04;
  float shade = clamp(0.5 + 0.5 * noise(vSea * 0.05 + uTime * 0.02), 0.0, 1.0);
  vec3 water = mix(uDeep, uShallow, 0.25 + 0.35 * shade * ndv);
  vec3 col = mix(water, uSky, clamp(fres, 0.0, 1.0));
  vec3 l = normalize(uSunDir);
  float diff = clamp(dot(n, l), 0.0, 1.0);
  col *= 0.75 + 0.35 * diff;
  vec3 h = normalize(l + v);
  float spec = pow(clamp(dot(n, h), 0.0, 1.0), 220.0) * 2.5 + pow(clamp(dot(n, h), 0.0, 1.0), 30.0) * 0.12;
  col += uSunColor * spec * uGlint;
  // Whitecaps: sparse, where the noise peaks on wave crests.
  float caps = smoothstep(0.82, 0.95, noise(vSea * 0.7 + vec2(uTime * 0.3, 0.0)) * (0.6 + 0.4 * noise(vSea * 0.11)));
  col = mix(col, vec3(0.92, 0.95, 0.97), caps * 0.45);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface OceanLook {
  deep: number;
  shallow: number;
  sky: number;
  sunDir: [number, number, number];
  sunColor: number;
  glint: number;
}

export function createOcean(size = 900): { mesh: THREE.Mesh; material: THREE.ShaderMaterial; setLook(l: OceanLook): void; update(time: number, scroll: number): void } {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uDeep: { value: new THREE.Color() },
        uShallow: { value: new THREE.Color() },
        uSky: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uGlint: { value: 1 },
      },
    ]),
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return {
    mesh,
    material,
    setLook(l) {
      const u = material.uniforms;
      (u.uDeep.value as THREE.Color).set(l.deep);
      (u.uShallow.value as THREE.Color).set(l.shallow);
      (u.uSky.value as THREE.Color).set(l.sky);
      (u.uSunDir.value as THREE.Vector3).set(...l.sunDir).normalize();
      (u.uSunColor.value as THREE.Color).set(l.sunColor);
      u.uGlint.value = l.glint;
    },
    update(time, scroll) {
      material.uniforms.uTime.value = time % 1000;
      // Keep the scroll in a range where float precision stays fine (the pattern repeats anyway).
      material.uniforms.uScroll.value = scroll % 4096;
    },
  };
}
