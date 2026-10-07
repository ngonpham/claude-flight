/**
 * Cumulus puffs in two layers — below the aircraft (the sea shows between them) and a sparse,
 * thinner layer above (the player flies under it) — plus their shadows on the sea, and rain streaks
 * for the squall level. Clouds are fixed to the world: they slide down the screen with the scroll,
 * the higher layer faster (parallax), and wrap around when they leave the view.
 *
 * The puff texture is computed (a sum of soft blobs with a lit top), so it builds in Node too.
 */
import * as THREE from 'three';

export interface ViewRect {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

function cloudTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const blobs = Array.from({ length: 14 }, () => {
    const a = rnd() * Math.PI * 2, d = rnd() * 0.28;
    return { x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d * 0.8, r: 0.1 + rnd() * 0.14 };
  });
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size, v = (j + 0.5) / size;
      let a = 0, lit = 0;
      for (const b of blobs) {
        const d2 = ((u - b.x) ** 2 + (v - b.y) ** 2) / (b.r * b.r);
        const w = Math.exp(-d2 * 1.6);
        a += w;
        // Lit from the upper left: brighter where the blob's lit side is.
        lit += w * (0.5 + 0.5 * Math.max(-1, Math.min(1, ((b.x - u) + (b.y - v)) / b.r)));
      }
      const alpha = Math.min(1, a * 0.9) * Math.max(0, 1 - ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 3.2);
      const shade = 0.72 + 0.28 * Math.min(1, lit / Math.max(1e-3, a));
      const k = (j * size + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(255 * shade);
      data[k + 3] = Math.round(255 * Math.max(0, Math.min(1, alpha)));
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
}

class Layer {
  readonly mesh: THREE.InstancedMesh;
  readonly shadow: THREE.InstancedMesh;
  readonly puffs: Puff[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(readonly cap: number, readonly yMin: number, readonly yMax: number, tex: THREE.Texture, readonly sizeMin: number, readonly sizeMax: number, opacity: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity, fog: true }), cap);
    this.shadow = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.13, fog: false }), cap);
    this.mesh.frustumCulled = this.shadow.frustumCulled = false;
    this.mesh.count = this.shadow.count = 0;
    this.mesh.renderOrder = 30;
    this.shadow.renderOrder = -5;
  }

  setCount(n: number, rect: ViewRect, rnd: () => number): void {
    this.puffs.length = 0;
    for (let i = 0; i < Math.min(n, this.cap); i++) {
      this.puffs.push({
        x: rect.xMin + (rect.xMax - rect.xMin) * rnd(), y: this.yMin + (this.yMax - this.yMin) * rnd(), z: rect.zMin + (rect.zMax - rect.zMin) * rnd(),
        s: this.sizeMin + (this.sizeMax - this.sizeMin) * rnd(), rot: rnd() * Math.PI * 2,
      });
    }
    this.mesh.count = this.shadow.count = this.puffs.length;
  }

  update(dt: number, speed: number, rect: (y: number) => ViewRect, sun: THREE.Vector3, rnd: () => number): void {
    const sy = Math.max(0.15, sun.y);
    this.puffs.forEach((c, i) => {
      c.z += speed * dt;
      const r = rect(c.y);
      if (c.z - c.s * 0.6 > r.zMax) {
        c.z = r.zMin - c.s * 0.6 - rnd() * 10;
        c.x = r.xMin + (r.xMax - r.xMin) * rnd();
      }
      this.q.setFromAxisAngle(this.up, c.rot);
      this.m.compose(this.p.set(c.x, c.y, c.z), this.q, this.sc.set(c.s, 1, c.s * 0.75));
      this.mesh.setMatrixAt(i, this.m);
      this.m.compose(this.p.set(c.x - (sun.x / sy) * c.y, 0.15, c.z - (sun.z / sy) * c.y), this.q, this.sc.set(c.s * 0.9, 1, c.s * 0.7));
      this.shadow.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
  }
}

export class Clouds {
  readonly group = new THREE.Group();
  private readonly tex = cloudTexture();
  private readonly low: Layer;
  private readonly high: Layer;
  private readonly rain: THREE.LineSegments;
  private readonly rainPos: Float32Array;
  private rainOn = 0;
  private seed = 3;

  constructor(private readonly airY: number) {
    this.low = new Layer(40, airY * 0.25, airY * 0.65, this.tex, 14, 30, 0.92);
    this.high = new Layer(16, airY * 1.45, airY * 1.75, this.tex, 18, 34, 0.45);
    const N = 700;
    this.rainPos = new Float32Array(N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc8d4e0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.low.shadow, this.high.shadow, this.low.mesh, this.high.mesh, this.rain);
  }

  private rnd = (): number => {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  };

  /** Cloud cover 0–1 per layer, tint, rain 0–1; scatter the puffs over the current view. */
  setLook(low: number, high: number, color: number, rain: number, rect: (y: number) => ViewRect): void {
    this.low.setCount(Math.round(36 * low), rect(this.airY * 0.45), this.rnd);
    this.high.setCount(Math.round(14 * high), rect(this.airY * 1.6), this.rnd);
    (this.low.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    (this.high.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    this.rainOn = rain;
    this.rain.visible = rain > 0;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.15 + 0.3 * rain;
    if (rain > 0) {
      const r = rect(this.airY);
      for (let i = 0; i < this.rainPos.length; i += 6) this.placeDrop(i, r, this.rnd() * this.airY * 2.2);
    }
    this.update(0, 0, rect, new THREE.Vector3(0, 1, 0));
  }

  private placeDrop(i: number, r: ViewRect, y: number): void {
    const x = r.xMin - 10 + (r.xMax - r.xMin + 20) * this.rnd();
    const z = r.zMin - 10 + (r.zMax - r.zMin + 20) * this.rnd();
    this.rainPos[i] = x; this.rainPos[i + 1] = y; this.rainPos[i + 2] = z;
    this.rainPos[i + 3] = x + 0.4; this.rainPos[i + 4] = y - 2.6; this.rainPos[i + 5] = z + 0.6;
  }

  /** `speed` = how fast the world slides past (world units / s, towards +z). */
  update(dt: number, speed: number, rect: (y: number) => ViewRect, sun: THREE.Vector3): void {
    this.low.update(dt, speed, rect, sun, this.rnd);
    this.high.update(dt, speed * 1.1, rect, sun, this.rnd);
    if (this.rainOn > 0 && dt > 0) {
      const r = rect(this.airY);
      const fall = 70 * dt;
      for (let i = 0; i < this.rainPos.length; i += 6) {
        this.rainPos[i + 1] -= fall;
        this.rainPos[i + 4] -= fall;
        this.rainPos[i] += 10 * dt;
        this.rainPos[i + 3] += 10 * dt;
        this.rainPos[i + 2] += (15 + speed) * dt;
        this.rainPos[i + 5] += (15 + speed) * dt;
        if (this.rainPos[i + 4] < 0) this.placeDrop(i, r, this.airY * 2.2);
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
