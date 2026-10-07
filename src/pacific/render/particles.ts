/**
 * Particle effects: fireballs, sparks, muzzle flashes and tracer glows (additive), and smoke,
 * water spray and debris (alpha-blended). Two fixed pools of point sprites drawn with a soft
 * round sprite shader; positions are in world space and drift with the scroll (they are fixed to
 * the world, not the screen). Allocation-free after construction.
 */
import * as THREE from 'three';

export type ParticleKind = 'fire' | 'spark' | 'flash' | 'smoke' | 'darkSmoke' | 'spray' | 'debris' | 'glow';

interface Ramp {
  additive: boolean;
  /** Start and end colour (linear, may exceed 1 for HDR). */
  c0: [number, number, number];
  c1: [number, number, number];
  a0: number;
  a1: number;
  /** Size growth over life (× start size). */
  grow: number;
  drag: number;
  gravity: number;
  /** Rise (smoke buoyancy), u/s². */
  lift: number;
}

const RAMPS: Record<ParticleKind, Ramp> = {
  fire: { additive: true, c0: [3.2, 2.2, 0.9], c1: [1.2, 0.25, 0.05], a0: 1, a1: 0, grow: 1.8, drag: 2.5, gravity: 0, lift: 2 },
  spark: { additive: true, c0: [3, 2.4, 1.2], c1: [1.4, 0.4, 0.1], a0: 1, a1: 0, grow: 0.5, drag: 1.2, gravity: 14, lift: 0 },
  flash: { additive: true, c0: [3.5, 3, 2], c1: [2, 1, 0.3], a0: 1, a1: 0, grow: 1.4, drag: 0, gravity: 0, lift: 0 },
  glow: { additive: true, c0: [2.5, 1.4, 0.5], c1: [1.2, 0.3, 0.05], a0: 0.9, a1: 0, grow: 1, drag: 0, gravity: 0, lift: 0 },
  smoke: { additive: false, c0: [0.32, 0.3, 0.28], c1: [0.55, 0.55, 0.55], a0: 0.75, a1: 0, grow: 3.2, drag: 1.4, gravity: 0, lift: 2.2 },
  darkSmoke: { additive: false, c0: [0.07, 0.065, 0.06], c1: [0.2, 0.19, 0.18], a0: 0.85, a1: 0, grow: 3.5, drag: 1, gravity: 0, lift: 3 },
  spray: { additive: false, c0: [0.95, 0.97, 1], c1: [0.85, 0.9, 0.95], a0: 0.9, a1: 0, grow: 2.2, drag: 1.5, gravity: 9, lift: 0 },
  debris: { additive: false, c0: [0.12, 0.11, 0.1], c1: [0.1, 0.09, 0.08], a0: 1, a1: 0.6, grow: 1, drag: 0.4, gravity: 16, lift: 0 },
};

const KINDS = Object.keys(RAMPS) as ParticleKind[];

const vert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mvPosition.z), 0.0, 256.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
varying vec4 vColor;
uniform float uSoft;
#include <fog_pars_fragment>
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, uSoft, r) * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

class Pool {
  readonly points: THREE.Points;
  private n = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly size: Float32Array;
  private readonly kind: Uint8Array;
  private readonly drift: Uint8Array;
  private readonly aPos: THREE.BufferAttribute;
  private readonly aCol: THREE.BufferAttribute;
  private readonly aSize: THREE.BufferAttribute;

  constructor(readonly cap: number, additive: boolean) {
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.drift = new Uint8Array(cap);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      // Fog would add the fog colour to additive sprites (a haze glow); only the blended ones fog.
      fog: !additive,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 }, uSoft: { value: additive ? 0.0 : 0.35 } }]),
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  add(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, drift: boolean): void {
    let i = this.n;
    if (i >= this.cap) {
      // Full: overwrite the oldest-looking slot (the one with the least life left).
      i = 0;
      let best = Infinity;
      for (let j = 0; j < this.cap; j += 7) if (this.life[j] < best) { best = this.life[j]; i = j; }
    } else this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
    this.drift[i] = drift ? 1 : 0;
  }

  update(dt: number, driftZ: number, scale: number): void {
    const P = this.aPos.array as Float32Array, C = this.aCol.array as Float32Array, S = this.aSize.array as Float32Array;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i] - dt;
      if (l <= 0) continue;
      const r = RAMPS[KINDS[this.kind[i]]];
      const k = 1 - l / this.max[i];
      const damp = Math.exp(-r.drag * dt);
      let vx = this.vel[i * 3] * damp, vy = this.vel[i * 3 + 1] * damp, vz = this.vel[i * 3 + 2] * damp;
      vy += (r.lift - r.gravity) * dt;
      const x = this.pos[i * 3] + vx * dt, z = this.pos[i * 3 + 2] + vz * dt + (this.drift[i] ? driftZ * dt : 0);
      let y = this.pos[i * 3 + 1] + vy * dt;
      if (y < 0 && r.gravity > 0) {
        y = 0;
        vy = 0;
      }
      // Compact into slot j.
      this.pos[j * 3] = x; this.pos[j * 3 + 1] = y; this.pos[j * 3 + 2] = z;
      this.vel[j * 3] = vx; this.vel[j * 3 + 1] = vy; this.vel[j * 3 + 2] = vz;
      this.life[j] = l;
      this.max[j] = this.max[i];
      this.size[j] = this.size[i];
      this.kind[j] = this.kind[i];
      this.drift[j] = this.drift[i];
      P[j * 3] = x; P[j * 3 + 1] = y; P[j * 3 + 2] = z;
      C[j * 4] = r.c0[0] + (r.c1[0] - r.c0[0]) * k;
      C[j * 4 + 1] = r.c0[1] + (r.c1[1] - r.c0[1]) * k;
      C[j * 4 + 2] = r.c0[2] + (r.c1[2] - r.c0[2]) * k;
      // Fade in quickly, then out along the ramp.
      C[j * 4 + 3] = (r.a0 + (r.a1 - r.a0) * k) * Math.min(1, (1 - k) * 12 + 0.0001, k * 25 + 0.25);
      S[j] = this.size[j] * (1 + (r.grow - 1) * Math.sqrt(k));
      j++;
    }
    this.n = j;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.points.geometry.setDrawRange(0, j);
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private readonly add: Pool;
  private readonly blend: Pool;
  private rnd = 1;

  constructor(cap = 3000) {
    this.add = new Pool(cap, true);
    this.blend = new Pool(cap, false);
    this.group.add(this.blend.points, this.add.points);
  }

  private r(): number {
    // xorshift — effects only, never the simulation.
    this.rnd ^= this.rnd << 13;
    this.rnd ^= this.rnd >>> 17;
    this.rnd ^= this.rnd << 5;
    return ((this.rnd >>> 0) % 100000) / 100000;
  }

  /** Emit one particle (world position / velocity). `drift` = fixed to the world (scrolls). */
  emit(kind: ParticleKind, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, size = 1, life = 1, drift = true): void {
    const r = RAMPS[kind];
    (r.additive ? this.add : this.blend).add(KINDS.indexOf(kind), x, y, z, vx, vy, vz, size, life, drift);
  }

  /** A burst of `n` particles with random velocities up to `speed`. */
  burst(kind: ParticleKind, x: number, y: number, z: number, n: number, speed: number, size: number, life: number, up = 0): void {
    for (let i = 0; i < n; i++) {
      const a = this.r() * Math.PI * 2, e = (this.r() - 0.3) * Math.PI;
      const s = speed * (0.3 + 0.7 * this.r());
      this.emit(kind, x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up, Math.sin(a) * Math.cos(e) * s, size * (0.6 + 0.8 * this.r()), life * (0.6 + 0.8 * this.r()));
    }
  }

  /** An explosion: fireball, sparks, smoke, debris. `big` scales everything. */
  explode(x: number, y: number, z: number, big = 1): void {
    this.emit('flash', x, y, z, 0, 0, 0, 5 * big, 0.12);
    this.burst('fire', x, y, z, Math.round(10 * big), 6 * Math.sqrt(big), 2.2 * big, 0.55);
    this.burst('spark', x, y, z, Math.round(12 * big), 18 * Math.sqrt(big), 0.35, 0.6, 4);
    this.burst('smoke', x, y, z, Math.round(6 * big), 3, 2.2 * big, 1.6);
    this.burst('debris', x, y, z, Math.round(6 * big), 10 * Math.sqrt(big), 0.35, 1.2, 5);
  }

  /** A splash on the sea surface (world y ≈ 0). */
  splash(x: number, z: number, big = 1): void {
    this.burst('spray', x, 0.2, z, Math.round(14 * big), 5 * Math.sqrt(big), 1.3 * big, 1.1, 8);
    this.emit('spray', x, 0.3, z, 0, 2, 0, 4 * big, 0.8);
  }

  update(dt: number, driftZ: number, scale: number): void {
    this.add.update(dt, driftZ, scale);
    this.blend.update(dt, driftZ, scale);
  }

  get count(): number {
    return this.add.count + this.blend.count;
  }

  clear(): void {
    this.add.clear();
    this.blend.clear();
  }
}
