/**
 * A small modelling kit for the game's low-poly, flat-shaded models: add primitives (boxes,
 * cylinders, spheres, lathed bodies, extruded planforms) with a transform and a paint colour —
 * or a paint function of each face's normal and centre (two-tone camouflage, insignia) — then
 * merge them into one vertex-coloured BufferGeometry: one draw call per model.
 *
 * Model frame: −Z forward (nose / bow), +Y up, +X right; units are field units.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type V3 = [number, number, number];
/** A colour, or a function choosing it per face from the face normal and centre (model frame). */
export type Paint = number | ((n: THREE.Vector3, c: THREE.Vector3) => number);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _n = new THREE.Vector3();
const _ctr = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Kit {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a geometry: transformed (position, Euler XYZ rotation, scale) and painted. */
  add(g: THREE.BufferGeometry, paint: Paint, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
    geo.applyMatrix4(_m);
    const P = geo.attributes.position as THREE.BufferAttribute;
    const n = P.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i + 2 < n; i += 3) {
      let hex: number;
      if (typeof paint === 'number') hex = paint;
      else {
        _a.fromBufferAttribute(P, i);
        _b.fromBufferAttribute(P, i + 1);
        _d.fromBufferAttribute(P, i + 2);
        _ctr.copy(_a).add(_b).add(_d).multiplyScalar(1 / 3);
        // (c − b) × (a − b) = the counter-clockwise face normal.
        _n.subVectors(_d, _b).cross(_a.sub(_b));
        if (_n.lengthSq() > 1e-20) _n.normalize();
        hex = paint(_n, _ctr);
      }
      _c.set(hex);
      for (let k = 0; k < 3; k++) {
        col[(i + k) * 3] = _c.r;
        col[(i + k) * 3 + 1] = _c.g;
        col[(i + k) * 3 + 2] = _c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(geo);
    return this;
  }

  /** Add an already painted geometry (e.g. another kit's build) with a transform; keeps its colours. */
  merge(g: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'color') geo.deleteAttribute(k);
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
    geo.applyMatrix4(_m);
    this.parts.push(geo);
    return this;
  }

  box(w: number, h: number, d: number, paint: Paint, pos?: V3, rot?: V3): this {
    return this.add(new THREE.BoxGeometry(w, h, d), paint, pos, rot);
  }

  /** A cylinder / cone along Y (rTop at +Y). */
  cyl(rTop: number, rBot: number, h: number, seg: number, paint: Paint, pos?: V3, rot?: V3): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), paint, pos, rot);
  }

  /** A cylinder along the forward axis: `rFront` at −Z. */
  tube(rFront: number, rBack: number, len: number, seg: number, paint: Paint, pos?: V3): this {
    return this.add(new THREE.CylinderGeometry(rFront, rBack, len, seg, 1), paint, pos, [-Math.PI / 2, 0, 0]);
  }

  sphere(r: number, paint: Paint, pos?: V3, scale: V3 = [1, 1, 1], wSeg = 10, hSeg = 6): this {
    return this.add(new THREE.SphereGeometry(r, wSeg, hSeg), paint, pos, [0, 0, 0], scale);
  }

  /** A thin disc lying flat (normal +Y), e.g. an insignia. */
  disc(r: number, paint: Paint, pos: V3, rot: V3 = [0, 0, 0], seg = 14): this {
    return this.add(new THREE.CylinderGeometry(r, r, 0.02, seg, 1), paint, pos, rot);
  }

  /**
   * A body of revolution along the forward axis. `profile` is [s, r] pairs, s measured forward
   * from the body's centre (s > 0 towards −Z). `squash` scales the cross-section (y, x).
   */
  lathe(profile: [number, number][], paint: Paint, seg = 10, pos: V3 = [0, 0, 0], squash: [number, number] = [1, 1]): this {
    const pts = profile.map(([s, r]) => new THREE.Vector2(Math.max(1e-3, r), s));
    // Lathe revolves about +Y; −90° about X puts +Y on −Z (forward).
    return this.add(new THREE.LatheGeometry(pts, seg), paint, pos, [-Math.PI / 2, 0, 0], [squash[1], 1, squash[0]]);
  }

  /**
   * A flat plate from a planform polygon in the XZ plane ([x, z] points, z < 0 forward), `t` thick,
   * centred on `pos`, then rotated by `rot`.
   */
  plate(points: [number, number][], t: number, paint: Paint, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): this {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 4 });
    // Shape y (forward) → −Z, extrusion → +Y; then centre the thickness.
    g.rotateX(-Math.PI / 2);
    g.translate(0, -t / 2, 0);
    return this.add(g, paint, pos, rot);
  }

  get count(): number {
    return this.parts.length;
  }

  /** Merge everything into one flat-shaded, vertex-coloured geometry. */
  build(): THREE.BufferGeometry {
    const g = this.parts.length ? mergeGeometries(this.parts, false) : new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!g) throw new Error('Kit.build: geometries could not be merged');
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** A five-pointed star polygon (point towards −Z), radius R, inner radius r. */
export function starPoints(R: number, r = R * 0.4): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r : R;
    out.push([Math.sin(a) * rr, -Math.cos(a) * rr]);
  }
  return out;
}

/** A circle polygon. */
export function circlePoints(r: number, n = 16, squash = 1): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r * squash] as [number, number];
  });
}
