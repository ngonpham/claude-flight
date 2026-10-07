/**
 * The scenery the sea carries past: coral reefs and atolls, palm islands, jungle islands, long
 * coastlines, and the set pieces of each battle — Ford Island and Battleship Row burning at Pearl
 * Harbor, the V of Wake atoll with its airstrip, Midway's reef ring with Sand and Eastern Islands,
 * Savo Island, the north end of Iwo Jima with its airfields, US carriers, burning Japanese
 * carriers, landing craft, wrecks. Plus ship wakes.
 *
 * Each builder returns an opaque vertex-coloured geometry, an optional translucent "shallows"
 * geometry (reef water, lagoons, oil slicks — drawn with alpha), and the points that burn and
 * smoke. All in field units around the decor's centre; sea level is y = 0.
 */
import * as THREE from 'three';
import type { DecorKind } from '../types';
import { makeRand, type Rand } from '../sim/rng';
import { Kit, type Paint, type V3 } from './kit';
import { turretInto } from './ships';

export interface DecorModel {
  geo: THREE.BufferGeometry;
  /** Translucent water colours (RGBA vertex colours). */
  shallow: THREE.BufferGeometry | null;
  smoke: V3[];
  fire: V3[];
}

const SAND = 0xdccb9c;
const BLACK_SAND = 0x45403a;
const GRASS = 0x638c3e;
const JUNGLE = 0x2f5b2b;
const JUNGLE_DARK = 0x234a22;
const ROCK = 0x7d7768;
const PALM = 0x3f7a30;
const TRUNK = 0x6d5a3e;
const NAVY = 0x34404f;
const IJN = 0x6f7471;

// ── translucent water patches ───────────────────────────────────────────────────────────────────

/** A flat polygon fan with a colour and alpha at the centre and at the rim. */
class Shallows {
  pos: number[] = [];
  col: number[] = [];

  fan(points: [number, number][], y: number, inner: number, innerA: number, rim: number, rimA: number, cx = 0, cz = 0): this {
    const ci = new THREE.Color(inner), cr = new THREE.Color(rim);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      this.pos.push(cx, y, cz, b[0], y, b[1], a[0], y, a[1]);
      this.col.push(ci.r, ci.g, ci.b, innerA, cr.r, cr.g, cr.b, rimA, cr.r, cr.g, cr.b, rimA);
    }
    return this;
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.computeBoundingSphere();
    return g;
  }
}

/** A noisy closed outline of radius r (x, z), squashed by `sq` along z. */
function blob(r: Rand, radius: number, n = 22, rough = 0.18, sq = 1): [number, number][] {
  const ph1 = r.range(0, 6.28), ph2 = r.range(0, 6.28);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + rough * (Math.sin(a * 3 + ph1) * 0.6 + Math.sin(a * 5 + ph2) * 0.4) + r.range(-rough, rough) * 0.4;
    return [Math.cos(a) * radius * k, Math.sin(a) * radius * k * sq] as [number, number];
  });
}

/**
 * A hill over an outline: rings shrinking to the summit, height H at the top (shape exponent p),
 * painted by height and slope.
 */
function mound(k: Kit, outline: [number, number][], H: number, r: Rand, paint: Paint, base = 0.15, p = 1.4, ox = 0, oz = 0): void {
  const rings = [1, 0.88, 0.7, 0.5, 0.3, 0.12];
  const n = outline.length;
  const cx = outline.reduce((a, q) => a + q[0], 0) / n, cz = outline.reduce((a, q) => a + q[1], 0) / n;
  const P: number[][][] = rings.map((f) => outline.map(([x, z]) => {
    const j = 1 + r.range(-0.06, 0.06);
    const h = base + H * Math.pow(1 - f, p) * (f < 1 ? 1 + r.range(-0.18, 0.18) : 0);
    return [cx + (x - cx) * f * j + ox, h, cz + (z - cz) * f * j + oz];
  }));
  const top = [cx + ox, base + H * (1 + r.range(-0.05, 0.1)), cz + oz];
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = P[j][i], b = P[j][(i + 1) % n], c = P[j + 1][(i + 1) % n], d = P[j + 1][i];
      tri(a, c, b);
      tri(a, d, c);
    }
  }
  const last = P[rings.length - 1];
  for (let i = 0; i < n; i++) tri(last[i], top, last[(i + 1) % n]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  k.add(g, paint);
}

const landPaint = (H: number, low: number, high: number, rock = ROCK): Paint => (n, c) => {
  if (n.y < 0.42) return rock;
  const f = c.y / Math.max(0.1, H);
  return f > 0.62 ? high : low;
};

function palms(k: Kit, r: Rand, outline: [number, number][], count: number, yAt: (x: number, z: number) => number, shrink = 0.75): void {
  const n = outline.length;
  for (let i = 0; i < count; i++) {
    const q = outline[r.int(0, n - 1)];
    const f = r.range(0.2, shrink);
    const x = q[0] * f, z = q[1] * f;
    const y = yAt(x, z);
    k.cyl(0.04, 0.06, 0.7, 4, TRUNK, [x, y + 0.35, z]);
    const a0 = r.range(0, 6.28);
    for (let j = 0; j < 5; j++) {
      const a = a0 + (j / 5) * Math.PI * 2;
      k.box(0.12, 0.03, 0.7, PALM, [x + Math.sin(a) * 0.3, y + 0.68, z + Math.cos(a) * 0.3], [0.25 * Math.cos(a), a, 0]);
    }
  }
}

function canopy(k: Kit, r: Rand, outline: [number, number][], count: number, yAt: (x: number, z: number) => number, shrink = 0.8): void {
  const n = outline.length;
  for (let i = 0; i < count; i++) {
    const q = outline[r.int(0, n - 1)];
    const f = r.range(0.15, shrink);
    const x = q[0] * f + r.range(-0.5, 0.5), z = q[1] * f + r.range(-0.5, 0.5);
    const s = r.range(0.5, 1.1);
    k.sphere(s, r() < 0.5 ? JUNGLE : JUNGLE_DARK, [x, yAt(x, z) + s * 0.3, z], [1, 0.6, 1], 6, 4);
  }
}

// ── builders ─────────────────────────────────────────────────────────────────────────────────────

function island(r: Rand, scale: number, jungle: boolean, black = false): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  const R = (jungle ? 7 : 5) * scale;
  const out = blob(r, R, 22, 0.2, r.range(0.7, 1.1));
  sh.fan(out.map(([x, z]) => [x * 1.6, z * 1.6] as [number, number]), 0.02, 0x47c6c0, 0.75, 0x2a8fb0, 0);
  k.plate(out.map(([x, z]) => [x * 1.08, z * 1.08] as [number, number]), 0.14, black ? BLACK_SAND : SAND, [0, 0.07, 0]);
  const H = (jungle ? 3.2 : 1.4) * scale;
  mound(k, out.map(([x, z]) => [x * 0.95, z * 0.95] as [number, number]), H, r, landPaint(H, jungle ? JUNGLE : GRASS, jungle ? JUNGLE_DARK : 0x557d36), 0.15, jungle ? 1.2 : 1.8);
  const yAt = (x: number, z: number) => 0.15 + H * Math.pow(Math.max(0, 1 - Math.hypot(x, z) / R), jungle ? 1.2 : 1.8);
  if (jungle) canopy(k, r, out, Math.round(14 * scale), yAt);
  else palms(k, r, out, Math.round(9 * scale), yAt);
  return { geo: k.build(), shallow: sh.build(), smoke: [], fire: [] };
}

function atoll(r: Rand, scale: number): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  const R = 8 * scale;
  const ring = blob(r, R, 26, 0.12, r.range(0.7, 1));
  sh.fan(ring.map(([x, z]) => [x * 1.25, z * 1.25] as [number, number]), 0.02, 0x7fe6d6, 0.85, 0x2a8fb0, 0);
  // Islets along the ring.
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    if (r() < 0.45) continue;
    const [x, z] = ring[i];
    const a = Math.atan2(z, x);
    const len = r.range(1.4, 3.2);
    k.plate([[-len / 2, -0.5], [len / 2, -0.5], [len / 2, 0.5], [-len / 2, 0.5]].map(([u, v]) => [x + u * -Math.sin(a) + v * Math.cos(a), z + u * Math.cos(a) + v * Math.sin(a)] as [number, number]), 0.2, SAND, [0, 0.1, 0]);
    if (r() < 0.7) palms(k, r, [[x, z]], 2, () => 0.2, 1);
  }
  return { geo: k.build(), shallow: sh.build(), smoke: [], fire: [] };
}

function reef(r: Rand, scale: number): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  const out = blob(r, 3.2 * scale, 16, 0.3, r.range(0.5, 1));
  sh.fan(out, 0.02, 0x5fd2c4, 0.7, 0x2a8fb0, 0);
  for (let i = 0; i < 4; i++) k.box(r.range(0.2, 0.6), 0.15, r.range(0.2, 0.6), ROCK, [r.range(-1.5, 1.5) * scale, 0.05, r.range(-1.5, 1.5) * scale], [0, r.range(0, 3), 0]);
  return { geo: k.build(), shallow: sh.build(), smoke: [], fire: [] };
}

/** A simple warship for the scenery (battleships at Pearl, carriers, hulks). */
function battleship(k: Kit, x: number, z: number, len: number, beam: number, color: number, yaw = 0, list = 0): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (dx: number, dz: number): [number, number] => [x + dx * c + dz * s, z - dx * s + dz * c];
  const hull: [number, number][] = [[0, -len / 2], [beam / 2, -len / 2 + len * 0.2], [beam / 2, len / 2 - len * 0.1], [beam * 0.3, len / 2], [-beam * 0.3, len / 2], [-beam / 2, len / 2 - len * 0.1], [-beam / 2, -len / 2 + len * 0.2]];
  k.plate(hull.map(([u, v]) => at(u, v)), 0.6, (n) => (n.y > 0.5 ? 0x8f7a5a : color), [0, 0.3 - list * 0.4, 0], [0, 0, list]);
  for (const t of [-0.33, -0.2, 0.22, 0.35]) {
    const p = at(0, t * len);
    turretInto(k, beam * 0.45, 3, [p[0], 0.6, p[1]], yaw + (t > 0 ? Math.PI : 0));
  }
  const m = at(0, -0.05 * len);
  k.box(beam * 0.55, 1, len * 0.12, color, [m[0], 1.1, m[1]], [0, yaw, 0]);
  const f = at(0, 0.06 * len);
  k.cyl(beam * 0.15, beam * 0.17, 0.8, 7, color, [f[0], 1.3, f[1]]);
}

function fordIsland(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  // Ford Island: long north–south, its runway along it, hangars on the west side.
  const out = blob(r, 5, 22, 0.06, 2.1);
  sh.fan(out.map(([x, z]) => [x * 1.25, z * 1.15] as [number, number]), 0.02, 0x3fa0a0, 0.6, 0x2a8fb0, 0);
  k.plate(out, 0.3, (n) => (n.y > 0.5 ? 0x6f8f48 : SAND), [0, 0.15, 0]);
  k.box(0.9, 0.04, 17, 0x8c8a86, [0.4, 0.32, 0], [0, 0.12, 0]);
  k.box(0.7, 0.04, 6, 0x8c8a86, [0.2, 0.32, 1], [0, -0.9, 0]);
  for (let i = 0; i < 4; i++) k.box(0.8, 0.5, 1, 0xb8b2a0, [-2.6, 0.55, -5 + i * 1.6]);
  return { geo: k.build(), shallow: sh.build(), smoke: [], fire: [] };
}

function battleshipRow(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  const smoke: V3[] = [];
  const fire: V3[] = [];
  // Seven battleships moored along Ford Island, some in pairs; burning oil on the water.
  const ships = [[0, -14], [1.8, -14], [0, -4.5], [1.8, -4.5], [0, 5], [1.8, 5], [0, 14.5]] as const;
  ships.forEach(([x, z], i) => {
    const sunk = i === 2 || i === 4;
    battleship(k, x, z, 8.5, 1.5, 0x777c80, 0, sunk ? 0.18 : 0);
    if (i % 2 === 0 || sunk) {
      smoke.push([x, 1.4, z + r.range(-2, 2)]);
      fire.push([x, 0.9, z + r.range(-1.5, 1.5)]);
    }
    if (sunk) sh.fan(blob(r, 3.2, 12, 0.35, 1.5).map(([u, v]) => [u + x - 1.5, v + z] as [number, number]), 0.03, 0x111112, 0.7, 0x1a1a1a, 0, x - 1.5, z);
  });
  return { geo: k.build(), shallow: sh.build(), smoke, fire };
}

function wakeAtoll(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  // A V open to the north-west: Wilkes, Wake (the angle, with the airstrip) and Peale islets.
  const lagoon: [number, number][] = [[-10, -9], [-4, -2], [2, 4], [9, -6], [12, -12], [6, -8], [0, -6], [-5, -10]];
  sh.fan(lagoon, 0.03, 0x86ead8, 0.85, 0x5ecfc6, 0.7, 2, -6);
  sh.fan(blob(r, 16, 20, 0.05, 0.8).map(([x, z]) => [x + 1, z - 4] as [number, number]), 0.01, 0x46bfc0, 0.5, 0x2a8fb0, 0, 1, -4);
  const arm = (pts: [number, number][], w: number) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
      const nx = (-dz / l) * w, nz = (dx / l) * w;
      k.plate([[x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz]], 0.3, (n) => (n.y > 0.5 ? 0x9fae72 : SAND), [0, 0.15, 0]);
    }
  };
  arm([[-11, -10], [-5, -1], [1, 4.5]], 1.2); // Wilkes + Wake south arm
  arm([[1, 4.5], [8, -2], [12, -11]], 1.3); // Wake north-east arm
  arm([[12.5, -12], [7, -13.5]], 0.9); // Peale
  // The airstrip on Wake's south arm.
  k.box(9, 0.04, 0.9, 0xa8a49a, [-2, 0.32, 1.2], [0, -0.98, 0]);
  palms(k, r, [[-6, -2], [6, -1], [10, -8], [-9, -8]], 10, () => 0.3, 1);
  return { geo: k.build(), shallow: sh.build(), smoke: [[-3, 0.5, 0]], fire: [] };
}

function midwayAtoll(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  const ring = blob(r, 14, 28, 0.05, 0.85);
  sh.fan(ring, 0.03, 0x86ead8, 0.85, 0x56c8c4, 0.75);
  sh.fan(ring.map(([x, z]) => [x * 1.15, z * 1.15] as [number, number]), 0.01, 0x46bfc0, 0.45, 0x2a8fb0, 0);
  // Sand Island (west, larger) and Eastern Island (the airfield's three runways in a triangle).
  const sand = blob(r, 3.2, 14, 0.15, 0.7).map(([x, z]) => [x - 5, z + 6] as [number, number]);
  k.plate(sand, 0.3, (n) => (n.y > 0.5 ? 0xb9b27e : SAND), [0, 0.15, 0]);
  const east: [number, number][] = [[2, 4], [7, 2.5], [5.5, 7.5]];
  k.plate(east.map(([x, z]) => [x * 1.05, z * 1.05] as [number, number]), 0.3, (n) => (n.y > 0.5 ? 0xb8b088 : SAND), [0, 0.15, 0]);
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
    const [x0, z0] = east[a], [x1, z1] = east[b];
    k.box(Math.hypot(x1 - x0, z1 - z0) * 0.85, 0.04, 0.35, 0x8f8b84, [(x0 + x1) / 2 * 1.05, 0.32, (z0 + z1) / 2 * 1.05], [0, -Math.atan2(z1 - z0, x1 - x0), 0]);
  }
  palms(k, r, sand.slice(0, 6).map(([x, z]) => [x * 0.9 + 0.5, z * 0.9] as [number, number]), 6, () => 0.3, 1);
  return { geo: k.build(), shallow: sh.build(), smoke: [[5, 0.6, 5]], fire: [[5, 0.4, 5]] };
}

function savo(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  const out = blob(r, 7.5, 22, 0.08);
  sh.fan(out.map(([x, z]) => [x * 1.3, z * 1.3] as [number, number]), 0.02, 0x22566a, 0.6, 0x0c2a3a, 0);
  k.plate(out.map(([x, z]) => [x * 1.05, z * 1.05] as [number, number]), 0.12, BLACK_SAND, [0, 0.06, 0]);
  mound(k, out, 5, r, landPaint(5, JUNGLE, JUNGLE_DARK, 0x4d4a40), 0.15, 0.9);
  canopy(k, r, out, 16, (x, z) => 0.15 + 5 * Math.pow(Math.max(0, 1 - Math.hypot(x, z) / 7.5), 0.9), 0.75);
  return { geo: k.build(), shallow: sh.build(), smoke: [], fire: [] };
}

function iwoNorth(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  // The wide northern plateau of the pear; the narrow south end and Suribachi come as the boss.
  const out = blob(r, 13, 26, 0.08, 0.75).map(([x, z]) => [x, z * 1.2] as [number, number]);
  sh.fan(out.map(([x, z]) => [x * 1.15, z * 1.15] as [number, number]), 0.02, 0x4f8a8c, 0.6, 0x2a6a80, 0);
  k.plate(out.map(([x, z]) => [x * 1.06, z * 1.06] as [number, number]), 0.12, BLACK_SAND, [0, 0.06, 0]);
  mound(k, out, 1.6, r, landPaint(1.6, 0x8a8068, 0x777050, 0x5a554c), 0.15, 2.4);
  // Airfields No. 1 and No. 2: crossed runways.
  k.box(14, 0.05, 0.9, 0x5c5954, [-1, 0.5, 4], [0, 0.5, 0]);
  k.box(11, 0.05, 0.9, 0x5c5954, [1, 0.5, 4], [0, -0.7, 0]);
  k.box(12, 0.05, 0.9, 0x5c5954, [0, 0.5, -6], [0, 0.15, 0]);
  const fire: V3[] = [], smoke: V3[] = [];
  for (let i = 0; i < 4; i++) {
    const p: V3 = [r.range(-8, 8), 0.8, r.range(-10, 10)];
    smoke.push(p);
    if (i % 2) fire.push(p);
  }
  return { geo: k.build(), shallow: sh.build(), smoke, fire };
}

function coast(r: Rand, scale: number): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  // Land from x = 0 outwards to −x along 150 u (a coast on the left; rot π puts it on the right).
  const n = 26, len = 150 * scale;
  const shore: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const z = -len / 2 + (len * i) / n;
    shore.push([-(r.range(-3, 3) + Math.sin(i * 0.7) * 3), z]);
  }
  const back: [number, number][] = shore.slice().reverse().map(([, z]) => [-40, z]);
  const outline = [...shore, ...back];
  sh.fan(shore.map(([x, z]) => [x + 5, z] as [number, number]).concat(shore.slice().reverse().map(([x, z]) => [x - 1, z] as [number, number])), 0.02, 0x4fc6c0, 0.55, 0x2a8fb0, 0, 2, 0);
  k.plate(outline.map(([x, z]) => [x + 0.8, z] as [number, number]), 0.12, SAND, [0, 0.06, 0]);
  // Hills: a few mounds behind the beach.
  k.plate(outline, 0.3, (nn) => (nn.y > 0.5 ? JUNGLE : SAND), [0, 0.15, 0]);
  for (let i = 0; i < 6; i++) {
    const z = -len / 2 + (len * (i + 0.5)) / 6 + r.range(-6, 6);
    const hx = -r.range(14, 22);
    const hill = blob(r, r.range(6, 11), 16, 0.25).map(([x, zz]) => [x + hx, zz + z] as [number, number]);
    const H = r.range(2.5, 5);
    mound(k, hill, H, r, landPaint(H, JUNGLE, JUNGLE_DARK, 0x4f5a38), 0.3, 1.3);
  }
  canopy(k, r, outline.map(([x, z]) => [Math.min(-4, x) * 0.9, z] as [number, number]), Math.round(40 * scale), () => 0.4, 1);
  palms(k, r, shore.map(([x, z]) => [x - 2.5, z] as [number, number]), 14, () => 0.3, 1);
  return { geo: k.build(), shallow: sh.build(), smoke: [], fire: [] };
}

/** An Essex-class carrier with aircraft spotted on deck (friendly scenery). */
function usCarrier(): DecorModel {
  const k = new Kit();
  const len = 26, beam = 3.2;
  k.plate([[0, -len / 2], [beam / 2, -len / 2 + 4], [beam / 2, len / 2 - 2], [beam * 0.35, len / 2], [-beam * 0.35, len / 2], [-beam / 2, len / 2 - 2], [-beam / 2, -len / 2 + 4]], 1, NAVY, [0, 0.5, 0]);
  k.plate([[-1.9, -len / 2 + 0.5], [1.9, -len / 2 + 0.5], [2.1, len / 2 - 0.3], [-2.1, len / 2 - 0.3]], 0.12, (n) => (n.y > 0.5 ? 0x45484c : NAVY), [0, 1.6, 0]);
  k.box(0.7, 1.5, 3, NAVY, [2.1, 2.3, -1]);
  k.cyl(0.3, 0.35, 0.8, 6, 0x2c3440, [2.1, 3.3, -0.4]);
  for (let i = 0; i < 10; i++) {
    const z = 4 + (i >> 1) * 1.6, x = (i % 2 ? 0.8 : -0.8);
    k.box(1.2, 0.08, 0.3, 0x2a3a58, [x, 1.75, z]);
    k.box(0.22, 0.12, 0.9, 0x2a3a58, [x, 1.78, z + 0.1]);
  }
  return { geo: k.build(), shallow: wakeShallow(len, beam, 18), smoke: [], fire: [] };
}

function burningCarrier(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  const len = 22, beam = 3;
  k.plate([[0, -len / 2], [beam / 2, -len / 2 + 3], [beam / 2, len / 2 - 2], [-beam / 2, len / 2 - 2], [-beam / 2, -len / 2 + 3]], 0.9, IJN, [0, 0.35, 0], [0, 0, 0.08]);
  k.plate([[-1.9, -len / 2 + 1], [1.9, -len / 2 + 1], [1.9, len / 2 - 1], [-1.9, len / 2 - 1]], 0.12, (n, c) => (n.y > 0.5 ? (Math.sin(c.z * 1.3) > 0.4 ? 0x2a2420 : 0xa08050) : IJN), [0, 1.2, 0], [0, 0, 0.08]);
  sh.fan(blob(r, 6, 14, 0.4, 1.6).map(([x, z]) => [x - 4, z] as [number, number]), 0.03, 0x121214, 0.75, 0x151515, 0, -4, 0);
  const smoke: V3[] = [[0, 1.6, -5], [0.3, 1.6, 2], [-0.4, 1.6, 7]];
  return { geo: k.build(), shallow: sh.build(), smoke, fire: smoke.map(([x, y, z]) => [x, y - 0.2, z] as V3) };
}

function landingCraft(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  for (let i = 0; i < 9; i++) {
    const x = (i % 3 - 1) * 4 + r.range(-0.6, 0.6), z = Math.floor(i / 3) * 4.5 + r.range(-0.6, 0.6);
    k.plate([[-0.45, -0.9], [0.45, -0.9], [0.45, 0.9], [-0.45, 0.9]], 0.4, (n) => (n.y > 0.5 ? 0x4e5a3c : 0x3e4832), [x, 0.2, z]);
    k.box(0.5, 0.15, 0.3, 0x2c3226, [x, 0.45, z + 0.6]);
    const w = wakeShallow(1.8, 0.9, 5);
    if (w) {
      const P = w.attributes.position as THREE.BufferAttribute;
      const C = w.attributes.color as THREE.BufferAttribute;
      for (let j = 0; j < P.count; j++) {
        sh.pos.push(P.getX(j) + x, P.getY(j), P.getZ(j) + z);
        sh.col.push(C.getX(j), C.getY(j), C.getZ(j), C.getW(j));
      }
      w.dispose();
    }
  }
  return { geo: k.build(), shallow: sh.build(), smoke: [], fire: [] };
}

function hulk(r: Rand): DecorModel {
  const k = new Kit();
  const sh = new Shallows();
  // Capsized: the red bottom up, half awash, in an oil slick.
  k.plate([[0, -5], [0.9, -3], [0.9, 4], [0, 5], [-0.9, 4], [-0.9, -3]], 0.5, (n) => (n.y > 0.5 ? 0x7a2a22 : 0x4a1c18), [0, 0.1, 0], [0, 0, 0.12]);
  sh.fan(blob(r, 4.5, 14, 0.4, 1.8), 0.03, 0x111112, 0.7, 0x151515, 0);
  return { geo: k.build(), shallow: sh.build(), smoke: [[0, 0.5, 1]], fire: [] };
}

/** A ship's wake as RGBA water: two bright Kelvin arms and a fading centre trail behind the stern. */
export function wakeShallow(len: number, beam: number, trail: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const col: number[] = [];
  const N = 8;
  const z0 = len / 2 - 0.2;
  for (let i = 0; i < N; i++) {
    const f0 = i / N, f1 = (i + 1) / N;
    const za = z0 + f0 * trail, zb = z0 + f1 * trail;
    const wa = beam * (0.45 + f0 * 1.4), wb = beam * (0.45 + f1 * 1.4);
    const aa = 0.75 * (1 - f0), ab = 0.75 * (1 - f1);
    // Columns: left edge, left-mid, centre, right-mid, right edge.
    const xs = (w: number) => [-w, -w * 0.5, 0, w * 0.5, w];
    const as = (a: number) => [a, a * 0.25, a * 0.55, a * 0.25, a];
    const xa = xs(wa), xb = xs(wb), aaa = as(aa), abb = as(ab);
    for (let c = 0; c < 4; c++) {
      const quad = [[xa[c], za, aaa[c]], [xb[c], zb, abb[c]], [xb[c + 1], zb, abb[c + 1]], [xa[c], za, aaa[c]], [xb[c + 1], zb, abb[c + 1]], [xa[c + 1], za, aaa[c + 1]]];
      for (const [x, z, a] of quad) {
        pos.push(x, 0.04, z);
        col.push(0.95, 0.97, 1, a);
      }
    }
  }
  // Bow wave.
  const bz = -len / 2;
  for (const s of [-1, 1]) {
    const q = [[0, bz - 0.3, 0.8], [s * beam * 0.9, bz + len * 0.25, 0], [s * beam * 0.55, bz + len * 0.1, 0.7]];
    for (const [x, z, a] of q) {
      pos.push(x, 0.05, z);
      col.push(0.95, 0.97, 1, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  return g;
}

/** Build the model of one piece of scenery. */
export function decorModel(kind: DecorKind, seed: number, scale: number): DecorModel {
  const r = makeRand(seed);
  switch (kind) {
    case 'island': return island(r, scale, false);
    case 'jungle': return island(r, scale, true);
    case 'atoll': return atoll(r, scale);
    case 'reef': return reef(r, scale);
    case 'fordIsland': return fordIsland(r);
    case 'battleshipRow': return battleshipRow(r);
    case 'wakeAtoll': return wakeAtoll(r);
    case 'midwayAtoll': return midwayAtoll(r);
    case 'savo': return savo(r);
    case 'iwoJima': return iwoNorth(r);
    case 'coast': return coast(r, scale);
    case 'usCarrier': return usCarrier();
    case 'burningCarrier': return burningCarrier(r);
    case 'landingCraft': return landingCraft(r);
    case 'wreck': return hulk(r);
  }
}

export const DECOR_KINDS: DecorKind[] = [
  'island', 'atoll', 'reef', 'jungle', 'fordIsland', 'battleshipRow', 'wakeAtoll', 'midwayAtoll', 'savo', 'iwoJima', 'coast', 'usCarrier', 'burningCarrier', 'landingCraft', 'wreck',
];

