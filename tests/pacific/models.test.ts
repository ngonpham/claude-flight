/**
 * The procedural models, built in Node and measured: every aircraft, ship, boss hull, boss part and
 * piece of scenery builds finite, vertex-coloured geometry within a triangle budget and about the
 * size the simulation's hit circles expect; the modelling kit paints by face normal correctly.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BOSSES, BOSS_KINDS } from '../../src/pacific/bosses';
import { ENEMIES, ENEMY_KINDS } from '../../src/pacific/enemies';
import { Kit } from '../../src/pacific/render/kit';
import { AIR_MODEL_KINDS, planeModel } from '../../src/pacific/render/planes';
import { DECOR_KINDS, decorModel, wakeShallow } from '../../src/pacific/render/scenery';
import { aaMountGeo, bossHullModel, bossPartY, enemyShipModel, partGeo, turretGeo } from '../../src/pacific/render/ships';
import { AIR_SCALE } from '../../src/pacific/render/view';

function check(g: THREE.BufferGeometry, maxTris: number, what: string): THREE.Box3 {
  const p = g.attributes.position as THREE.BufferAttribute;
  expect(p.count, what).toBeGreaterThan(0);
  expect(p.count / 3, `${what} triangles`).toBeLessThanOrEqual(maxTris);
  for (let i = 0; i < p.array.length; i++) expect(Number.isFinite(p.array[i]), what).toBe(true);
  const c = g.attributes.color as THREE.BufferAttribute;
  expect(c, `${what} colours`).toBeDefined();
  expect(c.count).toBe(p.count);
  if (g.attributes.normal) {
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i++) expect(Number.isFinite(n[i]), `${what} normal`).toBe(true);
  }
  g.computeBoundingBox();
  return g.boundingBox!;
}

describe('the modelling kit', () => {
  it('paints each face by its outward normal (top / underside)', () => {
    const k = new Kit();
    k.box(1, 1, 1, (n) => (n.y > 0.5 ? 0xff0000 : n.y < -0.5 ? 0x0000ff : 0x00ff00));
    const g = k.build();
    const P = g.attributes.position, C = g.attributes.color;
    for (let i = 0; i < P.count; i += 3) {
      const y = (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3;
      if (y > 0.49) expect(C.getX(i)).toBeGreaterThan(0.9);
      if (y < -0.49) expect(C.getZ(i)).toBeGreaterThan(0.9);
    }
  });

  it('lathe bodies point forward (−Z) and plates lie flat with their forward edge at −Z', () => {
    const k = new Kit();
    k.lathe([[-1, 0.2], [0, 0.5], [2, 0.1]], 0xffffff);
    const b = check(k.build(), 400, 'lathe');
    expect(b.min.z).toBeCloseTo(-2, 1);
    expect(b.max.z).toBeCloseTo(1, 1);
    const p = new Kit();
    p.plate([[0, -3], [1, 0], [-1, 0]], 0.1, 0xffffff);
    const pb = check(p.build(), 100, 'plate');
    expect(pb.min.z).toBeCloseTo(-3, 3);
    expect(pb.max.y - pb.min.y).toBeCloseTo(0.1, 3);
  });
});

describe('aircraft', () => {
  it('every aircraft builds within budget, its span near its hit circle, nose towards −Z', () => {
    for (const kind of AIR_MODEL_KINDS) {
      const m = planeModel(kind);
      const b = check(m.geo, 3000, kind);
      const span = b.max.x - b.min.x;
      const len = b.max.z - b.min.z;
      expect(span, kind).toBeGreaterThan(1);
      expect(Math.abs(b.max.x + b.min.x), `${kind} symmetric`).toBeLessThan(0.15 * span);
      expect(m.semi).toBeCloseTo(span / 2, 0);
      if (kind in ENEMIES) {
        const def = ENEMIES[kind as keyof typeof ENEMIES];
        // Hit circle between a third of and the full drawn half-span.
        const drawn = (span / 2) * AIR_SCALE;
        expect(def.radius, kind).toBeGreaterThan(drawn * 0.33);
        expect(def.radius, kind).toBeLessThan(drawn * 1.2);
      }
      for (const p of m.props) {
        // Propellers sit at the front half.
        expect(p.pos[2], kind).toBeLessThan(0.2 * len);
        expect(p.r).toBeGreaterThan(0.1);
      }
      expect(len).toBeLessThan(span * 1.6);
    }
  });

  it('aircraft models are cached (one geometry per kind)', () => {
    expect(planeModel('zero')).toBe(planeModel('zero'));
  });

  it('air bosses: the drawn wingspan matches the boss hull circles at the boss size', () => {
    const pairs = [['fuchida', 'b5nLead'], ['yamamoto', 'bettyLead'], ['emily', 'emily']] as const;
    for (const [boss, model] of pairs) {
      const def = BOSSES[boss];
      const b = planeModel(model).geo.boundingBox ?? (planeModel(model).geo.computeBoundingBox(), planeModel(model).geo.boundingBox!);
      const halfSpan = ((b.max.x - b.min.x) / 2) * def.size;
      const hullReach = Math.max(...def.hull.map((h) => Math.abs(h.dx) + h.r));
      expect(halfSpan, boss).toBeGreaterThan(hullReach * 0.75);
      expect(halfSpan, boss).toBeLessThan(hullReach * 1.6);
    }
  });
});

describe('ships and gun sites', () => {
  it('every surface enemy builds, about as long as its hull circles reach', () => {
    for (const kind of ENEMY_KINDS.filter((k) => ENEMIES[k].surface)) {
      const m = enemyShipModel(kind);
      const b = check(m.geo, 4000, kind);
      const def = ENEMIES[kind];
      if (def.hull) {
        const reach = Math.max(...def.hull.map((h) => Math.abs(h.dy) + h.r));
        expect((b.max.z - b.min.z) / 2, kind).toBeGreaterThan(reach * 0.75);
        expect((b.max.z - b.min.z) / 2, kind).toBeLessThan(reach * 1.4);
      }
      expect(b.min.y, `${kind} draught`).toBeGreaterThan(-1);
    }
  });

  it('every surface boss has a hull model as long as its hit circles, and a mesh for every drawn part', () => {
    for (const kind of BOSS_KINDS.filter((k) => BOSSES[k].surface)) {
      const def = BOSSES[kind];
      const m = bossHullModel(kind);
      expect(m, kind).not.toBeNull();
      const b = check(m!.geo, 12000, kind);
      const reach = Math.max(...def.hull.map((h) => Math.abs(h.dy) + h.r));
      expect((b.max.z - b.min.z) / 2, kind).toBeGreaterThan(reach * 0.7);
      // The fortress is an island: its beach reaches well past the core it is hit on.
      expect((b.max.z - b.min.z) / 2, kind).toBeLessThan(reach * (kind === 'suribachi' ? 1.6 : 1.3));
      for (const p of def.parts) {
        const g = partGeo(p.look, p.r);
        expect(g, `${kind}.${p.id}`).not.toBeNull();
        check(g!, 2000, `${kind}.${p.id}`);
        expect(bossPartY(kind, p.look)).toBeGreaterThan(0);
      }
    }
  });

  it('turrets and mounts aim along −Z', () => {
    for (const g of [turretGeo(1, 3), aaMountGeo(1)]) {
      const b = check(g, 1000, 'turret');
      expect(-b.min.z).toBeGreaterThan(b.max.z);
    }
  });
});

describe('scenery', () => {
  it('every kind of scenery builds for several seeds, finite, within budget, with RGBA shallows', () => {
    for (const kind of DECOR_KINDS) {
      for (const seed of [1, 77, 123456]) {
        const m = decorModel(kind, seed, 1);
        check(m.geo, 20000, `${kind}#${seed}`);
        if (m.shallow) {
          const c = m.shallow.attributes.color as THREE.BufferAttribute;
          expect(c.itemSize).toBe(4);
          for (let i = 0; i < c.array.length; i++) expect(c.array[i] >= 0 && c.array[i] <= 1).toBe(true);
        }
        for (const p of [...m.smoke, ...m.fire]) expect(p.every(Number.isFinite)).toBe(true);
        m.geo.dispose();
        m.shallow?.dispose();
      }
    }
  });

  it('the same seed builds the same island; Pearl Harbor burns', () => {
    const a = decorModel('island', 9, 1), b = decorModel('island', 9, 1);
    expect(Array.from(a.geo.attributes.position.array)).toEqual(Array.from(b.geo.attributes.position.array));
    expect(decorModel('battleshipRow', 1, 1).smoke.length).toBeGreaterThan(2);
  });

  it('a wake trails behind the stern (+Z) and fades out', () => {
    const w = wakeShallow(10, 1.6, 12)!;
    const P = w.attributes.position, C = w.attributes.color as THREE.BufferAttribute;
    let far = 0;
    for (let i = 0; i < P.count; i++) {
      if (P.getZ(i) > 5 + 11) {
        far++;
        expect(C.getW(i)).toBeLessThan(0.15);
      }
    }
    expect(far).toBeGreaterThan(0);
  });
});
