/**
 * Procedural ships and ground targets, in field units, bow towards −Z: the destroyer (Fubuki
 * class), heavy cruiser (Mogami class), Daihatsu landing barge, Type 96 AA gun pit, the boss hulls
 * — light cruiser Yūbari, the flush-decked light carrier Shōhō, Akagi with her port-side island
 * and down-curved starboard funnel, the battleship Hiei with her pagoda mast, the Yamato-class
 * Musashi and Yamato — the Suribachi fortress, friendly ships for the scenery (an Essex-class
 * carrier, landing craft) and the separate turret / mount meshes boss parts are drawn with.
 *
 * Every hull floats with its waterline at y = 0. Turret meshes aim along −Z.
 */
import * as THREE from 'three';
import type { BossKind, BossPartDef, EnemyKind } from '../types';
import { Kit, circlePoints, type Paint, type V3 } from './kit';

const IJN_GREY = 0x6f7471;
const IJN_DARK = 0x575c5a;
const LINO = 0x6e4c38;
const TEAK = 0x86684a;
const DECK_WOOD = 0x6e5236;
const BLACK = 0x1f2124;
const RED = 0xb3121c;
const WHITE = 0xe6e3da;

export interface ShipModel {
  geo: THREE.BufferGeometry;
  /** Points that smoke (funnels), model frame. */
  funnels: V3[];
  len: number;
  beam: number;
}

interface Super {
  s: number;
  len: number;
  w: number;
  h: number;
  x?: number;
  color?: number;
}

interface ShipSpec {
  len: number;
  beam: number;
  free: number;
  hull?: number;
  deck?: number;
  /** Deck colour forward of this s (fore deck linoleum / teak) — otherwise `deck`. */
  foreDeck?: { from: number; color: number };
  supers?: Super[];
  funnels?: { s: number; r: number; h: number; rake?: number; x?: number; side?: number }[];
  turrets?: { s: number; size: number; barrels: number; aft?: boolean; x?: number }[];
  masts?: { s: number; h: number }[];
  /** A flight deck: length, width, centre s, island. */
  flight?: { len: number; w: number; s: number; h: number; island?: { x: number; s: number; len: number; h: number }; meatball?: boolean; color?: number };
  /** Pagoda mast (a tall stepped tower) at s. */
  pagoda?: { s: number; h: number };
}

/** The hull planform: pointed bow, parallel middle body, rounded transom. */
function hullPoints(len: number, beam: number): [number, number][] {
  const h = len / 2, b = beam / 2;
  return [
    [0, -h], [b * 0.55, -h + len * 0.1], [b * 0.92, -h + len * 0.24], [b, -h + len * 0.38], [b, h - len * 0.18], [b * 0.85, h - len * 0.06], [b * 0.55, h],
    [-b * 0.55, h], [-b * 0.85, h - len * 0.06], [-b, h - len * 0.18], [-b, -h + len * 0.38], [-b * 0.92, -h + len * 0.24], [-b * 0.55, -h + len * 0.1],
  ];
}

/** A gun turret (centre at the origin, barrels along −Z). */
function turretKit(size: number, barrels: number, color = IJN_GREY): Kit {
  const k = new Kit();
  k.cyl(size * 0.5, size * 0.55, size * 0.18, 10, IJN_DARK, [0, size * 0.09, 0]);
  k.box(size * 0.9, size * 0.32, size * 1.05, color, [0, size * 0.32, 0]);
  k.box(size * 0.7, size * 0.1, size * 0.3, color, [0, size * 0.32, size * 0.62]);
  const gap = barrels > 1 ? (size * 0.55) / (barrels - 1) : 0;
  for (let i = 0; i < barrels; i++) {
    const dx = barrels === 1 ? 0 : -size * 0.275 + i * gap;
    k.tube(size * 0.06, size * 0.07, size * 1.1, 6, BLACK, [dx, size * 0.34, -size * 1.05]);
  }
  return k;
}

/** Put a turret into `k` at `pos`, turned by `yaw` (π = facing aft). */
export function turretInto(k: Kit, size: number, barrels: number, pos: V3, yaw = 0): Kit {
  const g = turretKit(size, barrels).build();
  k.merge(g, pos, [0, yaw, 0]);
  g.dispose();
  return k;
}

function ship(sp: ShipSpec): ShipModel {
  const k = new Kit();
  const L = sp.len, B = sp.beam;
  const hullC = sp.hull ?? IJN_GREY;
  const deckC = sp.deck ?? LINO;
  // Hull: freeboard above water, a little below; red boot-topping shows at the waterline.
  k.plate(hullPoints(L, B), sp.free + 0.25, (n, c) => (c.y < 0.02 && n.y < 0.5 ? 0x5a2a24 : hullC), [0, (sp.free - 0.25) / 2, 0]);
  const deckPaint: Paint = (n, c) => {
    if (n.y < 0.5) return hullC;
    if (sp.foreDeck && c.z < -sp.foreDeck.from) return sp.foreDeck.color;
    return deckC;
  };
  k.plate(hullPoints(L * 0.97, B * 0.9), 0.04, deckPaint, [0, sp.free + 0.02, 0]);
  for (const su of sp.supers ?? []) k.box(su.w, su.h, su.len, su.color ?? hullC, [su.x ?? 0, sp.free + su.h / 2, -su.s]);
  for (const f of sp.funnels ?? []) {
    const rake = f.rake ?? 0.2;
    if (f.side) {
      // Akagi: a big funnel curving out and down over the starboard side.
      k.add(new THREE.CylinderGeometry(f.r, f.r * 1.1, f.h, 8), hullC, [(f.x ?? 0) + f.side * f.h * 0.3, sp.free + f.r * 0.6, -f.s], [0, 0, f.side * 1.9]);
      k.cyl(f.r * 0.9, f.r * 0.9, 0.08, 8, BLACK, [(f.x ?? 0) + f.side * f.h * 0.62, sp.free + f.r * 0.1, -f.s], [0, 0, f.side * 1.9]);
    } else {
      k.add(new THREE.CylinderGeometry(f.r, f.r * 1.15, f.h, 8), hullC, [f.x ?? 0, sp.free + f.h / 2, -f.s], [-rake, 0, 0]);
      k.cyl(f.r * 0.85, f.r * 0.85, 0.06, 8, BLACK, [f.x ?? 0, sp.free + f.h, -f.s + Math.sin(rake) * f.h * 0.5]);
    }
  }
  for (const t of sp.turrets ?? []) turretInto(k, t.size, t.barrels, [t.x ?? 0, sp.free, -t.s], t.aft ? Math.PI : 0);
  for (const m of sp.masts ?? []) {
    k.cyl(0.05, 0.07, m.h, 5, IJN_DARK, [0, sp.free + m.h / 2, -m.s]);
    k.box(0.9, 0.04, 0.04, IJN_DARK, [0, sp.free + m.h * 0.8, -m.s]);
  }
  if (sp.pagoda) {
    const { s, h } = sp.pagoda;
    for (let i = 0; i < 6; i++) {
      const f = i / 6;
      k.box(1.2 * (1 - f * 0.6), h / 6, 1.4 * (1 - f * 0.55), hullC, [0, sp.free + (i + 0.5) * (h / 6), -s + f * 0.3]);
    }
    k.box(0.9, 0.08, 0.3, BLACK, [0, sp.free + h + 0.05, -s + 0.2]);
  }
  if (sp.flight) {
    const f = sp.flight;
    const fc = f.color ?? DECK_WOOD;
    const hl = f.len / 2, hw = f.w / 2;
    // Supports, then the deck with its markings.
    k.box(B * 0.8, f.h - sp.free, f.len * 0.85, hullC, [0, (f.h + sp.free) / 2, -f.s]);
    k.plate([[-hw * 0.8, -hl], [hw * 0.8, -hl], [hw, -hl + 1], [hw, hl - 0.6], [hw * 0.7, hl], [-hw * 0.7, hl], [-hw, hl - 0.6], [-hw, -hl + 1]], 0.12,
      (n, c) => {
        if (n.y < 0.5) return hullC;
        const lz = c.z + f.s;
        if (Math.abs(c.x) < 0.06 && Math.abs(lz) < hl - 1) return WHITE;
        if (Math.abs(Math.abs(c.x) - (hw - 0.18)) < 0.05) return WHITE;
        return fc;
      }, [0, f.h, -f.s]);
    if (f.meatball) {
      k.box(1.4, 0.02, 1.4, WHITE, [0, f.h + 0.07, -f.s - hl + 1.6]);
      k.disc(0.55, RED, [0, f.h + 0.085, -f.s - hl + 1.6]);
    }
    if (f.island) {
      const is = f.island;
      k.box(0.7, is.h, is.len, hullC, [is.x, f.h + is.h / 2, -is.s]);
      k.box(0.8, 0.3, 0.6, IJN_DARK, [is.x, f.h + is.h + 0.15, -is.s - 0.2]);
      k.cyl(0.04, 0.05, 1.2, 5, IJN_DARK, [is.x, f.h + is.h + 0.6, -is.s + 0.2]);
    }
  }
  const funnels: V3[] = (sp.funnels ?? []).map((f) => [f.x ?? 0, sp.free + f.h, -f.s] as V3);
  return { geo: k.build(), funnels, len: L, beam: B };
}

// ── enemy ships and ground targets ───────────────────────────────────────────────────────────────

const SPECS: Partial<Record<EnemyKind, ShipSpec>> = {
  destroyer: {
    len: 10.6, beam: 1.6, free: 0.45, foreDeck: { from: 1.2, color: LINO }, deck: 0x5f5d58,
    supers: [{ s: 2.4, len: 1.1, w: 0.95, h: 0.75 }, { s: 0.2, len: 2.6, w: 0.7, h: 0.3 }],
    funnels: [{ s: 1, r: 0.22, h: 0.75 }, { s: -0.5, r: 0.2, h: 0.65 }],
    turrets: [{ s: 3.6, size: 0.6, barrels: 2 }, { s: -2.6, size: 0.6, barrels: 2, aft: true }, { s: -3.8, size: 0.6, barrels: 2, aft: true }],
    masts: [{ s: 1.9, h: 1.3 }],
  },
  cruiser: {
    len: 14.4, beam: 2.3, free: 0.55, foreDeck: { from: 2.5, color: LINO }, deck: 0x5f5d58,
    supers: [{ s: 1.4, len: 1.6, w: 1.3, h: 1.2 }, { s: -1.2, len: 2.4, w: 1.1, h: 0.4 }],
    funnels: [{ s: -0.2, r: 0.38, h: 1, rake: 0.35 }],
    turrets: [
      { s: 5.2, size: 0.72, barrels: 3 }, { s: 4.1, size: 0.72, barrels: 3 }, { s: 3, size: 0.72, barrels: 3 },
      { s: -3.8, size: 0.72, barrels: 3, aft: true }, { s: -4.9, size: 0.72, barrels: 3, aft: true },
    ],
    masts: [{ s: 0.9, h: 1.8 }, { s: -2.4, h: 1.2 }],
  },
  barge: { len: 2.3, beam: 0.85, free: 0.25, hull: 0x5d6a58, deck: 0x4a5547, supers: [{ s: -0.7, len: 0.5, w: 0.5, h: 0.25, color: 0x3e463b }] },
};

/** The AA gun pit: a sandbag ring with a twin-barrelled Type 96 mount (the barrels are the part). */
function aaPit(): ShipModel {
  const k = new Kit();
  k.add(new THREE.CylinderGeometry(1, 1.15, 0.35, 12, 1, true), 0x8a7b5c, [0, 0.17, 0]);
  k.cyl(0.95, 0.95, 0.06, 12, 0x5b5345, [0, 0.03, 0]);
  return { geo: k.build(), funnels: [], len: 2, beam: 2 };
}

/** A twin / triple AA mount mesh (aims along −Z). */
export function aaMountGeo(scale = 1): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(0.3 * scale, 0.36 * scale, 0.22 * scale, 8, IJN_DARK, [0, 0.11 * scale, 0]);
  for (const x of [-0.13, 0, 0.13]) k.tube(0.035 * scale, 0.045 * scale, 0.9 * scale, 5, BLACK, [x * scale, 0.3 * scale, -0.45 * scale]);
  k.box(0.18 * scale, 0.18 * scale, 0.25 * scale, 0x4a4f4c, [0.3 * scale, 0.25 * scale, 0]);
  return k.build();
}

/** A main-gun turret mesh for a boss part. */
export function turretGeo(size: number, barrels: number): THREE.BufferGeometry {
  return turretKit(size, barrels).build();
}

const cache = new Map<string, ShipModel>();

export function enemyShipModel(kind: EnemyKind): ShipModel {
  const hit = cache.get(kind);
  if (hit) return hit;
  const m = kind === 'aaGun' ? aaPit() : ship(SPECS[kind] ?? SPECS.barge!);
  cache.set(kind, m);
  return m;
}

// ── bosses ───────────────────────────────────────────────────────────────────────────────────────

const BOSS_SPECS: Partial<Record<BossKind, ShipSpec>> = {
  yubari: {
    len: 22, beam: 3, free: 0.6, foreDeck: { from: 3, color: LINO }, deck: 0x5f5d58,
    supers: [{ s: 3, len: 2, w: 1.6, h: 1.6 }, { s: -1, len: 3.4, w: 1.2, h: 0.5 }],
    funnels: [{ s: 0.6, r: 0.55, h: 1.6, rake: 0.4 }],
    masts: [{ s: 2.2, h: 2.4 }, { s: -3, h: 1.6 }],
  },
  shoho: {
    len: 26, beam: 3.6, free: 0.7, deck: 0x5f5d58,
    flight: { len: 24, w: 3.8, s: 0.2, h: 1.6, meatball: true },
    funnels: [{ s: -2, r: 0.3, h: 0.9, x: 1.9 }],
  },
  akagi: {
    len: 32, beam: 4.2, free: 0.8, deck: 0x5f5d58,
    flight: { len: 30, w: 4.6, s: 0.4, h: 1.9, island: { x: -2.2, s: 2.5, len: 1.8, h: 1.3 }, meatball: true },
    funnels: [{ s: 0, r: 0.6, h: 2.2, x: 2.2, side: 1 }],
  },
  hiei: {
    len: 30, beam: 4, free: 0.75, foreDeck: { from: -100, color: TEAK }, deck: TEAK,
    supers: [{ s: 1, len: 6, w: 2.2, h: 0.7 }, { s: -3.5, len: 2.4, w: 1.6, h: 0.6 }],
    funnels: [{ s: 0.9, r: 0.55, h: 1.6 }, { s: -2.3, r: 0.5, h: 1.4 }],
    pagoda: { s: 3.6, h: 3.4 },
    masts: [{ s: -4.2, h: 2.2 }],
  },
  musashi: {
    len: 38, beam: 5.2, free: 0.9, foreDeck: { from: -100, color: TEAK }, deck: TEAK,
    supers: [{ s: 1.5, len: 7, w: 3, h: 0.8 }, { s: -4, len: 3, w: 2, h: 0.6 }],
    funnels: [{ s: -0.8, r: 0.9, h: 2.4, rake: 0.45 }],
    turrets: [{ s: 6.2, size: 0.8, barrels: 3, x: -2.4 }, { s: 6.2, size: 0.8, barrels: 3, x: 2.4 }, { s: -6.5, size: 0.9, barrels: 3, aft: true }],
    masts: [{ s: -3.4, h: 3 }],
  },
  yamato: {
    len: 42, beam: 5.6, free: 0.95, foreDeck: { from: -100, color: TEAK }, deck: TEAK,
    supers: [{ s: 1.6, len: 7.5, w: 3.2, h: 0.8 }, { s: -4.2, len: 3.4, w: 2.2, h: 0.6 }],
    funnels: [{ s: -0.9, r: 1, h: 2.6, rake: 0.45 }],
    turrets: [{ s: -7.2, size: 0.95, barrels: 3, aft: true }],
    masts: [{ s: -3.6, h: 3.2 }],
  },
};

/** The Suribachi fortress: the volcano cone with its crater, black sand beach and scrub. */
function suribachi(): ShipModel {
  const k = new Kit();
  const outline = circlePoints(1, 24).map(([x, z], i) => {
    const r = 9 + Math.sin(i * 1.7) * 0.8 + Math.cos(i * 2.9) * 0.6;
    return [x * r, z * r * 0.9 + 1] as [number, number];
  });
  k.plate(outline.map(([x, z]) => [x * 1.12, z * 1.12] as [number, number]), 0.1, 0x3c3935, [0, 0.03, 0]);
  k.plate(outline, 0.5, (n) => (n.y > 0.5 ? 0x4b4640 : 0x3c3935), [0, 0.25, 0]);
  // The cone, faceted, with a dark crater.
  k.add(new THREE.CylinderGeometry(1.8, 6.4, 5.2, 14, 3), (n, c) => (c.y > 4.6 ? 0x3a332d : n.y > 0.75 ? 0x6b6457 : (Math.sin(c.x * 3) + Math.cos(c.z * 2.4) > 1.2 ? 0x55603f : 0x5d564c)), [0, 2.9, 0]);
  k.cyl(1.5, 1.5, 0.1, 12, 0x221d19, [0, 5.48, 0]);
  return { geo: k.build(), funnels: [[0, 5.5, 0]], len: 18, beam: 18 };
}

/** Heights (y) at which a boss's parts sit: on the main deck, on the flight deck, on the beach. */
export function bossPartY(kind: BossKind, look: BossPartDef['look']): number {
  if (kind === 'suribachi') return 0.5;
  const sp = BOSS_SPECS[kind];
  if (!sp) return 0.4;
  if (sp.flight && (look === 'deck' || look === 'bridge')) return sp.flight.h + 0.08;
  return sp.free;
}

export function bossHullModel(kind: BossKind): ShipModel | null {
  const key = `boss:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let m: ShipModel | null = null;
  if (kind === 'suribachi') m = suribachi();
  else {
    const sp = BOSS_SPECS[kind];
    if (sp) m = ship(sp);
  }
  if (m) cache.set(key, m);
  return m;
}

/** The mesh a boss part is drawn with (escorts and engines are drawn by the plane renderer). */
export function partGeo(look: BossPartDef['look'], r: number): THREE.BufferGeometry | null {
  const key = `part:${look}:${r.toFixed(2)}`;
  const hit = partCache.get(key);
  if (hit) return hit;
  let g: THREE.BufferGeometry | null = null;
  switch (look) {
    case 'turret':
      g = turretGeo(r * 0.9, 2);
      break;
    case 'turretBig':
      g = turretGeo(r * 0.95, 3);
      break;
    case 'aa':
      g = aaMountGeo(r * 1.1);
      break;
    case 'bunker': {
      const k = new Kit();
      k.box(r * 1.7, r * 0.6, r * 1.5, 0x8d8576, [0, r * 0.3, 0]);
      k.box(r * 1.2, r * 0.18, r * 0.4, 0x2a2622, [0, r * 0.35, -r * 0.7]);
      k.tube(r * 0.13, r * 0.16, r * 1.6, 6, BLACK, [0, r * 0.38, -r * 1.3]);
      g = k.build();
      break;
    }
    case 'deck': {
      const k = new Kit();
      k.box(r * 1.6, 0.06, r * 1.2, 0x8a6a46, [0, 0.03, 0]);
      k.box(r * 0.2, 0.08, r * 1.2, WHITE, [0, 0.05, 0]);
      // A parked Zero, wings spread, ready to launch.
      k.box(r * 1.4, 0.06, 0.35, 0xb8b39a, [0, 0.2, 0.1]);
      k.tube(0.16, 0.06, 1.1, 6, 0xb8b39a, [0, 0.22, 0.1]);
      k.disc(0.12, RED, [r * 0.45, 0.24, 0.1]);
      k.disc(0.12, RED, [-r * 0.45, 0.24, 0.1]);
      g = k.build();
      break;
    }
    case 'bridge': {
      const k = new Kit();
      for (let i = 0; i < 4; i++) k.box(r * (1.2 - i * 0.2), r * 0.55, r * (1.1 - i * 0.18), IJN_GREY, [0, r * (0.28 + i * 0.55), 0]);
      k.box(r * 0.9, r * 0.12, r * 0.35, BLACK, [0, r * 2.4, -r * 0.15]);
      k.cyl(0.05, 0.07, r * 1.4, 5, IJN_DARK, [0, r * 3, r * 0.2]);
      g = k.build();
      break;
    }
    default:
      g = null;
  }
  if (g) partCache.set(key, g);
  return g;
}

const partCache = new Map<string, THREE.BufferGeometry>();
