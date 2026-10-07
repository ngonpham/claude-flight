/**
 * The ten bosses, one per level: what they are, their hull hit circles, their destroyable parts
 * (turrets, AA mounts, flight decks, engines, escorts), and the guns of each of their three
 * phases (phase 1 above two-thirds hit points, phase 2 above one third, phase 3 below).
 *
 * Boss frame: dx to the boss's right, dy forward along its nose / bow, in field units. Ships sail
 * bow-down the screen (heading π) towards the player; aircraft fly at the player too.
 */
import type { BossDef, BossKind, BossPartDef, GunDef } from './types';

const aimed = (interval: number, o: Partial<GunDef> = {}): GunDef => ({ type: 'aimed', interval, ...o });
const spread = (interval: number, count: number, arc: number, o: Partial<GunDef> = {}): GunDef => ({ type: 'spread', interval, count, arc, ...o });
const burst = (interval: number, count: number, gap = 0.13, o: Partial<GunDef> = {}): GunDef => ({ type: 'burst', interval, count, gap, ...o });
const ring = (interval: number, count: number, o: Partial<GunDef> = {}): GunDef => ({ type: 'ring', interval, count, ...o });
const spiral = (interval: number, count: number, twist: number, o: Partial<GunDef> = {}): GunDef => ({ type: 'spiral', interval, count, twist, ...o });
const launch = (interval: number, spawn: GunDef['spawn']): GunDef => ({ type: 'spawn', interval, spawn, delay: 2 });

/** A turret / mount part. */
function part(id: string, dx: number, dy: number, look: BossPartDef['look'], hp: number, guns: GunDef[][], r = 1.3): BossPartDef {
  return { id, dx, dy, r, hp, score: Math.round(hp * 40), guns, look };
}

/** Orbiting escort fighters, evenly spaced. */
function escorts(n: number, r: number, w: number, hp: number, gun: GunDef): BossPartDef[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return {
      id: `escort${i}`, dx: Math.cos(a), dy: Math.sin(a), r: 1.3, hp, score: 500, look: 'escort' as const,
      guns: [[gun], [gun], [aimed(gun.interval * 0.8)]], orbit: { r, w },
    };
  });
}

/** Hull circles along a ship of length `len` and beam `beam`. */
function hullLine(len: number, beam: number, n: number): { dx: number; dy: number; r: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const taper = 1 - Math.abs(f) * 0.9;
    return { dx: 0, dy: f * (len - beam), r: (beam / 2) * (0.75 + 0.35 * taper) };
  });
}

export const BOSSES: Record<BossKind, BossDef> = {
  fuchida: {
    kind: 'fuchida', name: 'Tốp chỉ huy B5N "Kate"', surface: false, hp: 420, score: 20000,
    hull: [{ dx: 0, dy: 0, r: 2.2 }, { dx: -3.2, dy: 0.3, r: 1.3 }, { dx: 3.2, dy: 0.3, r: 1.3 }],
    parts: escorts(4, 6.5, 0.9, 22, aimed(2.4, { delay: 1 })),
    guns: [[spread(1.9, 3, 0.45)], [spread(1.6, 5, 0.8), ring(3.4, 10, { delay: 1.5 })], [spread(1.2, 5, 0.9), spiral(0.16, 2, 0.31)]],
    holdY: 16, swayX: 10, swayY: 2.5, swayW: 0.45, heading: Math.PI, size: 2.4,
  },
  yubari: {
    kind: 'yubari', name: 'Tuần dương hạm Yūbari', surface: true, hp: 600, score: 30000,
    hull: hullLine(22, 3, 7),
    parts: [
      part('t1', 0, 7.5, 'turret', 45, [[spread(2.4, 3, 0.35)], [spread(2, 3, 0.4)], [spread(1.6, 5, 0.6)]]),
      part('t2', 0, 5, 'turret', 45, [[aimed(1.8)], [burst(2, 3)], [burst(1.6, 4)]]),
      part('aaL', -1.1, 0.5, 'aa', 22, [[burst(2.6, 3)], [burst(2.2, 3)], [burst(1.8, 4)]], 1),
      part('aaR', 1.1, 0.5, 'aa', 22, [[burst(2.6, 3, 0.13, { delay: 1.3 })], [burst(2.2, 3)], [burst(1.8, 4)]], 1),
      part('t3', 0, -5.5, 'turret', 45, [[spread(2.6, 3, 0.4, { delay: 1 })], [spread(2.2, 3, 0.4)], [spread(1.8, 5, 0.6)]]),
      part('t4', 0, -8, 'turret', 45, [[], [aimed(1.6)], [burst(1.5, 3)]]),
    ],
    guns: [[], [ring(4, 12)], [ring(2.6, 14), aimed(1.2)]],
    holdY: 12, swayX: 6, swayY: 1, swayW: 0.25, heading: Math.PI, size: 1,
  },
  shoho: {
    kind: 'shoho', name: 'Tàu sân bay Shōhō', surface: true, hp: 760, score: 40000,
    hull: hullLine(26, 3.6, 8),
    parts: [
      part('deck', 0, 4, 'deck', 90, [[launch(5, 'zero')], [launch(4, 'zero')], [launch(3.2, 'val')]], 1.8),
      part('aa1', -1.6, 8, 'aa', 24, [[burst(2.4, 3)], [burst(2, 4)], [burst(1.6, 4)]], 1),
      part('aa2', 1.6, 8, 'aa', 24, [[burst(2.4, 3, 0.13, { delay: 1.2 })], [burst(2, 4)], [burst(1.6, 4)]], 1),
      part('aa3', -1.6, -6, 'aa', 24, [[burst(2.6, 3)], [burst(2.2, 4)], [burst(1.7, 4)]], 1),
      part('aa4', 1.6, -6, 'aa', 24, [[burst(2.6, 3, 0.13, { delay: 1.2 })], [burst(2.2, 4)], [burst(1.7, 4)]], 1),
    ],
    guns: [[spread(3, 5, 0.9)], [spread(2.4, 7, 1.2)], [ring(2.2, 16), spread(2, 5, 0.7)]],
    holdY: 12, swayX: 5, swayY: 1, swayW: 0.22, heading: Math.PI, size: 1,
  },
  akagi: {
    kind: 'akagi', name: 'Tàu sân bay Akagi', surface: true, hp: 1000, score: 50000,
    hull: hullLine(32, 4.2, 9),
    parts: [
      part('deckF', 0, 8, 'deck', 110, [[launch(5, 'zero')], [launch(4, 'zero')], [launch(3.4, 'zero')]], 2),
      part('deckA', 0, -7, 'deck', 110, [[launch(6, 'val')], [launch(5, 'val')], [launch(4, 'kate')]], 2),
      part('bridge', -2.2, 2.5, 'bridge', 90, [[ring(4.2, 10)], [ring(3.2, 14)], [spiral(0.2, 3, 0.27)]], 1.4),
      part('aa1', 2, 11, 'aa', 26, [[burst(2.4, 3)], [burst(2, 4)], [burst(1.6, 4)]], 1),
      part('aa2', 2, 0, 'aa', 26, [[burst(2.4, 3, 0.13, { delay: 0.8 })], [burst(2, 4)], [burst(1.6, 4)]], 1),
      part('aa3', -2, -4, 'aa', 26, [[burst(2.4, 3, 0.13, { delay: 1.6 })], [burst(2, 4)], [burst(1.6, 4)]], 1),
      part('aa4', 2, -12, 'aa', 26, [[burst(2.6, 3)], [burst(2.1, 4)], [burst(1.6, 4)]], 1),
    ],
    guns: [[spread(3.2, 5, 0.8)], [spread(2.6, 7, 1.1)], [spread(2, 9, 1.4)]],
    holdY: 11, swayX: 4, swayY: 1, swayW: 0.2, heading: Math.PI, size: 1,
  },
  hiei: {
    kind: 'hiei', name: 'Thiết giáp hạm Hiei', surface: true, hp: 1150, score: 60000,
    hull: hullLine(30, 4, 9),
    parts: [
      part('A', 0, 10, 'turretBig', 70, [[spread(2.6, 3, 0.3, { style: 1 })], [spread(2.2, 5, 0.5, { style: 1 })], [spread(1.8, 5, 0.6, { style: 1 })]], 1.6),
      part('B', 0, 6.8, 'turretBig', 70, [[aimed(2.2, { style: 1 })], [burst(2.4, 3, 0.16, { style: 1 })], [burst(1.8, 4, 0.14, { style: 1 })]], 1.6),
      part('aaL', -1.7, 2, 'aa', 28, [[burst(2.2, 3)], [burst(1.9, 4)], [burst(1.5, 4)]], 1),
      part('aaR', 1.7, 2, 'aa', 28, [[burst(2.2, 3, 0.13, { delay: 1 })], [burst(1.9, 4)], [burst(1.5, 4)]], 1),
      part('C', 0, -6, 'turretBig', 70, [[spread(2.8, 3, 0.3, { style: 1, delay: 1 })], [spread(2.3, 5, 0.5, { style: 1 })], [spread(1.9, 5, 0.6, { style: 1 })]], 1.6),
      part('D', 0, -9.5, 'turretBig', 70, [[], [aimed(1.8, { style: 1 })], [burst(1.6, 3, 0.15, { style: 1 })]], 1.6),
    ],
    guns: [[ring(4, 12)], [ring(3, 14), aimed(1.5)], [spiral(0.14, 3, 0.23), aimed(1.2, { style: 1 })]],
    holdY: 11, swayX: 5, swayY: 1, swayW: 0.2, heading: Math.PI, size: 1,
  },
  yamamoto: {
    kind: 'yamamoto', name: 'G4M "Betty" số hiệu 323', surface: false, hp: 850, score: 70000,
    hull: [{ dx: 0, dy: 0.5, r: 2.4 }, { dx: 0, dy: -3.2, r: 1.6 }, { dx: -4.4, dy: 0.6, r: 1.6 }, { dx: 4.4, dy: 0.6, r: 1.6 }],
    parts: [
      ...escorts(6, 8, 0.75, 26, burst(2.6, 2, 0.15, { delay: 1 })),
      part('tail', 0, -5.2, 'turret', 50, [[burst(2.2, 3)], [burst(1.8, 4)], [spread(1.4, 5, 0.6)]], 1.1),
      part('dorsal', 0, 1.6, 'turret', 50, [[aimed(1.8)], [spread(1.8, 3, 0.4)], [spiral(0.18, 2, 0.35)]], 1.1),
    ],
    guns: [[spread(2.4, 5, 0.8)], [spread(2, 7, 1), ring(4, 12)], [ring(2.4, 16), spread(1.6, 5, 0.6)]],
    holdY: 16, swayX: 11, swayY: 2.5, swayW: 0.5, heading: Math.PI, size: 2,
  },
  emily: {
    kind: 'emily', name: 'Thủy phi cơ H8K "Emily"', surface: false, hp: 1150, score: 80000,
    hull: [{ dx: 0, dy: 1, r: 2.5 }, { dx: 0, dy: -3, r: 2 }, { dx: 0, dy: -6.5, r: 1.4 }, { dx: -6.4, dy: 0.8, r: 1.5 }, { dx: 6.4, dy: 0.8, r: 1.5 }],
    parts: [
      part('e1', -8.6, 1.2, 'engine', 60, [[], [aimed(2.6)], [burst(2.2, 3)]], 1.2),
      part('e2', -4, 1.2, 'engine', 60, [[aimed(2.8)], [aimed(2.2)], [burst(2, 3)]], 1.2),
      part('e3', 4, 1.2, 'engine', 60, [[aimed(2.8, { delay: 1.4 })], [aimed(2.2)], [burst(2, 3)]], 1.2),
      part('e4', 8.6, 1.2, 'engine', 60, [[], [aimed(2.6)], [burst(2.2, 3)]], 1.2),
      part('nose', 0, 5.6, 'turret', 55, [[spread(2, 3, 0.4)], [spread(1.7, 5, 0.7)], [spread(1.4, 5, 0.8)]], 1.1),
      part('tail', 0, -7.8, 'turret', 55, [[burst(2.4, 3)], [burst(2, 4)], [spiral(0.16, 2, 0.4)]], 1.1),
    ],
    guns: [[ring(3.6, 12)], [ring(2.8, 16)], [spiral(0.12, 3, 0.21), ring(3, 12, { style: 1 })]],
    holdY: 15, swayX: 9, swayY: 2, swayW: 0.4, heading: Math.PI, size: 2.2,
  },
  musashi: {
    kind: 'musashi', name: 'Siêu thiết giáp hạm Musashi', surface: true, hp: 1450, score: 90000,
    hull: hullLine(38, 5.2, 11),
    parts: [
      part('A', 0, 12.5, 'turretBig', 90, [[spread(2.4, 3, 0.3, { style: 1 })], [spread(2, 5, 0.5, { style: 1 })], [spread(1.6, 7, 0.8, { style: 1 })]], 1.9),
      part('B', 0, 8.6, 'turretBig', 90, [[burst(2.6, 3, 0.16, { style: 1 })], [burst(2.2, 4, 0.14, { style: 1 })], [burst(1.8, 5, 0.12, { style: 1 })]], 1.9),
      part('aa1', -2.3, 5, 'aa', 30, [[burst(2.2, 3)], [burst(1.8, 4)], [burst(1.4, 4)]], 1),
      part('aa2', 2.3, 5, 'aa', 30, [[burst(2.2, 3, 0.13, { delay: 1 })], [burst(1.8, 4)], [burst(1.4, 4)]], 1),
      part('aa3', -2.3, -2, 'aa', 30, [[burst(2.4, 3)], [burst(1.9, 4)], [burst(1.5, 4)]], 1),
      part('aa4', 2.3, -2, 'aa', 30, [[burst(2.4, 3, 0.13, { delay: 1 })], [burst(1.9, 4)], [burst(1.5, 4)]], 1),
      part('bridge', 0, 3, 'bridge', 120, [[ring(4, 12)], [ring(3, 16)], [spiral(0.12, 3, 0.25)]], 1.6),
      part('C', 0, -10, 'turretBig', 90, [[spread(2.6, 3, 0.3, { style: 1, delay: 1 })], [spread(2.1, 5, 0.5, { style: 1 })], [spread(1.7, 7, 0.8, { style: 1 })]], 1.9),
    ],
    guns: [[], [aimed(1.4, { style: 1 })], [ring(2.4, 18, { style: 1 }), aimed(1, { style: 1 })]],
    holdY: 9, swayX: 3.5, swayY: 0.8, swayW: 0.18, heading: Math.PI, size: 1,
  },
  suribachi: {
    kind: 'suribachi', name: 'Pháo đài núi Suribachi', surface: true, hp: 1500, score: 100000,
    hull: [{ dx: 0, dy: 0, r: 5.5 }, { dx: -4, dy: -4, r: 3 }, { dx: 4, dy: -4, r: 3 }],
    parts: [
      part('c1', -9, 2, 'bunker', 70, [[spread(2.6, 3, 0.4, { style: 1 })], [spread(2.2, 5, 0.6, { style: 1 })], [spread(1.8, 5, 0.7, { style: 1 })]], 1.6),
      part('c2', 9, 2, 'bunker', 70, [[spread(2.6, 3, 0.4, { style: 1, delay: 1.3 })], [spread(2.2, 5, 0.6, { style: 1 })], [spread(1.8, 5, 0.7, { style: 1 })]], 1.6),
      part('b1', -6.5, -5.5, 'aa', 35, [[burst(2.2, 3)], [burst(1.8, 4)], [burst(1.4, 4)]], 1.1),
      part('b2', 6.5, -5.5, 'aa', 35, [[burst(2.2, 3, 0.13, { delay: 1 })], [burst(1.8, 4)], [burst(1.4, 4)]], 1.1),
      part('b3', -3, 6.5, 'aa', 35, [[aimed(2)], [burst(1.9, 3)], [burst(1.5, 4)]], 1.1),
      part('b4', 3, 6.5, 'aa', 35, [[aimed(2, { delay: 1 })], [burst(1.9, 3)], [burst(1.5, 4)]], 1.1),
    ],
    guns: [[ring(3.6, 12)], [ring(2.8, 16), aimed(1.6, { style: 1 })], [spiral(0.1, 4, 0.19), aimed(1.2, { style: 1 })]],
    holdY: 13, swayX: 0, swayY: 0, swayW: 0, heading: 0, size: 1,
  },
  yamato: {
    kind: 'yamato', name: 'Siêu thiết giáp hạm Yamato', surface: true, hp: 2000, score: 150000,
    hull: hullLine(42, 5.6, 12),
    parts: [
      part('A', 0, 14, 'turretBig', 110, [[spread(2.2, 3, 0.3, { style: 1 })], [spread(1.9, 5, 0.5, { style: 1 })], [spread(1.5, 7, 0.9, { style: 1 })]], 2),
      part('B', 0, 9.8, 'turretBig', 110, [[burst(2.4, 3, 0.16, { style: 1 })], [burst(2, 4, 0.14, { style: 1 })], [burst(1.6, 5, 0.12, { style: 1 })]], 2),
      part('sL', -2.4, 6.2, 'turret', 50, [[aimed(2)], [burst(2, 3)], [burst(1.6, 4)]], 1.2),
      part('sR', 2.4, 6.2, 'turret', 50, [[aimed(2, { delay: 1 })], [burst(2, 3)], [burst(1.6, 4)]], 1.2),
      part('aa1', -2.5, 1, 'aa', 32, [[burst(2.2, 3)], [burst(1.7, 4)], [burst(1.3, 4)]], 1),
      part('aa2', 2.5, 1, 'aa', 32, [[burst(2.2, 3, 0.13, { delay: 1 })], [burst(1.7, 4)], [burst(1.3, 4)]], 1),
      part('aa3', -2.5, -4, 'aa', 32, [[burst(2.4, 3)], [burst(1.8, 4)], [burst(1.4, 4)]], 1),
      part('aa4', 2.5, -4, 'aa', 32, [[burst(2.4, 3, 0.13, { delay: 1 })], [burst(1.8, 4)], [burst(1.4, 4)]], 1),
      part('bridge', 0, 3.6, 'bridge', 140, [[ring(3.6, 14)], [spiral(0.14, 3, 0.25)], [spiral(0.09, 4, 0.21)]], 1.7),
      part('C', 0, -11.5, 'turretBig', 110, [[spread(2.4, 3, 0.3, { style: 1, delay: 1 })], [spread(2, 5, 0.5, { style: 1 })], [spread(1.6, 7, 0.9, { style: 1 })]], 2),
    ],
    guns: [[], [ring(3, 16, { style: 1 })], [ring(2, 20, { style: 1 }), aimed(0.9, { style: 1 })]],
    holdY: 8, swayX: 3, swayY: 0.8, swayW: 0.16, heading: Math.PI, size: 1,
  },
};

export const BOSS_KINDS = Object.keys(BOSSES) as BossKind[];
