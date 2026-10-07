/**
 * Builds a level's enemy schedule and scenery from its definition and seed: a list of timed
 * spawns (formations of fighters, bomber stations, dive bombers, kamikaze swarms, ship convoys,
 * island gun sites) and a list of scenery placements along the scroll. Pure and deterministic —
 * the same level and seed always give the same waves, which is what the tests check.
 *
 * Formations whose members are all shot down drop a pick-up (the "red squadron" of the arcade
 * classics); the builder makes sure one comes along at least every `DROP_EVERY` seconds.
 */
import { PACIFIC, type PacificConfig } from '../config';
import { ENEMIES } from '../enemies';
import type { FormationKind, LevelDef } from '../levels';
import type { DecorEvent, EnemyKind, Pattern, PickupKind, SpawnEvent } from '../types';
import { makeRand, type Rand } from './rng';

/** Seconds: the longest stretch without a bonus formation. */
export const DROP_EVERY = 13;
/** Seconds of quiet at the start of the waves. */
export const FIRST_WAVE = 1.5;

interface Ctx {
  r: Rand;
  cfg: PacificConfig;
  level: LevelDef;
  /** Speed multiplier for this level. */
  speed: number;
  nextGroup: number;
}

const DROP_WEIGHTS: Partial<Record<PickupKind, number>> = { pow: 5, wing: 1.6, roll: 1.5, repair: 1.2, medal: 1 };

function top(c: Ctx): number {
  return c.cfg.field.halfH + c.cfg.field.spawnMargin;
}

function sp(c: Ctx, kind: EnemyKind, f = 1): number {
  return ENEMIES[kind].speed * c.speed * f;
}

function ev(t: number, kind: EnemyKind, pattern: Pattern, group = 0, drop: PickupKind | null = null, extra: Partial<SpawnEvent> = {}): SpawnEvent {
  return { t, kind, pattern, group, drop, ...extra };
}

/** Rough length of a cubic Bézier, for its duration at a given speed. */
function bezLength(p: [number, number][]): number {
  let len = 0;
  let px = p[0][0], py = p[0][1];
  for (let i = 1; i <= 16; i++) {
    const s = i / 16, u = 1 - s;
    const x = u * u * u * p[0][0] + 3 * u * u * s * p[1][0] + 3 * u * s * s * p[2][0] + s * s * s * p[3][0];
    const y = u * u * u * p[0][1] + 3 * u * u * s * p[1][1] + 3 * u * s * s * p[2][1] + s * s * s * p[3][1];
    len += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return len;
}

type Builder = (c: Ctx, t: number, kind: EnemyKind, n: number, x: number | undefined, group: number, drop: PickupKind | null) => SpawnEvent[];

const W = (c: Ctx) => c.cfg.field.halfW;
const H = (c: Ctx) => c.cfg.field.halfH;

const BUILDERS: Record<FormationKind, Builder> = {
  /** A V of fighters flying straight down, leader in front. */
  vee(c, t, kind, n, x, g, drop) {
    const cx = x ?? c.r.range(-W(c) + 8, W(c) - 8);
    const v = sp(c, kind, 0.9);
    return Array.from({ length: n }, (_, i) => {
      const k = Math.ceil(i / 2) * (i % 2 ? -1 : 1);
      const off = Math.abs(k);
      return ev(t, kind, { type: 'line', x0: cx + k * 2.8, y0: top(c) + off * 2.4, vx: 0, vy: -v }, g, drop);
    });
  },
  /** A file of fighters snaking along one curved path, one after another. */
  column(c, t, kind, n, x, g, drop) {
    const s = c.r.sign();
    const w = W(c), h = H(c);
    const shapes: [number, number][][] = [
      [[s * 18, h + 6], [s * 18, 0], [-s * 18, 10], [-s * 18, -h - 10]],
      [[s * (w + 6), h - 2], [-s * 10, h + 2], [-s * 18, -8], [s * (w + 8), -10]],
      [[s * 12, h + 6], [s * 12, -h], [-s * 14, -h], [-s * 14, h + 10]],
      [[s * (w + 6), h * 0.6], [s * 4, -h * 0.6], [-s * 4, -h * 0.6], [-s * (w + 6), h * 0.6]],
    ];
    const p = c.r.pick(shapes).map(([a, b]) => [a + (x ?? 0) * 0.3, b] as [number, number]);
    const dur = bezLength(p) / sp(c, kind);
    return Array.from({ length: n }, (_, i) => ev(t + i * 0.34, kind, { type: 'bezier', p, dur }, g, drop));
  },
  /** A line abreast across the whole screen. */
  wall(c, t, kind, n, _x, g, drop) {
    const span = (W(c) - 4) * 2;
    const v = sp(c, kind, 0.75);
    return Array.from({ length: n }, (_, i) => {
      const x0 = -span / 2 + (span * i) / Math.max(1, n - 1);
      return ev(t, kind, { type: 'line', x0, y0: top(c), vx: 0, vy: -v, wobA: 1.2, wobF: 2 }, g, drop);
    });
  },
  /** Fighters crossing the screen from one side to the other. */
  crossing(c, t, kind, n, _x, g, drop) {
    const s = c.r.sign();
    const y0 = c.r.range(4, H(c) - 6);
    const v = sp(c, kind);
    return Array.from({ length: n }, (_, i) =>
      ev(t + i * 0.3, kind, { type: 'line', x0: -s * (W(c) + 6), y0, vx: s * v, vy: -2.2 }, g, drop));
  },
  /** Fighters overtaking from behind the player (watch the bottom of the screen). */
  behind(c, t, kind, n, _x, g, drop) {
    const v = sp(c, kind, 1.3);
    const cx = c.r.range(-W(c) + 8, W(c) - 8);
    return Array.from({ length: n }, (_, i) =>
      ev(t + i * 0.45, kind, { type: 'line', x0: cx + (i - (n - 1) / 2) * 4, y0: -H(c) - 6, vx: 0, vy: v }, g, drop));
  },
  /** Fighters that dive in and pull a tight turning loop before leaving. */
  loops(c, t, kind, n, _x, g, drop) {
    const out: SpawnEvent[] = [];
    for (let i = 0; i < n; i++) {
      const dir = (i % 2 ? -1 : 1) as 1 | -1;
      const x0 = c.r.range(-W(c) + 10, W(c) - 10) - dir * 4;
      out.push(ev(t + i * 0.6, kind, { type: 'loop', x0, y0: top(c), speed: sp(c, kind), yLoop: c.r.range(6, 16), r: c.r.range(5, 7.5), dir }, g, drop));
    }
    return out;
  },
  /** Torpedo / level bombers that slide in, hold station swaying, then leave. */
  bombers(c, t, kind, n, _x, g, drop) {
    return Array.from({ length: n }, (_, i) => {
      const x0 = -W(c) + 8 + ((2 * W(c) - 16) * (i + 0.5)) / n + c.r.range(-2, 2);
      return ev(t + i * 0.4, kind, {
        type: 'hover', x0, y0: top(c), yStop: c.r.range(14, 24), inT: 2.2, hold: 4 + c.r.range(0, 2), swayA: 3, swayF: 0.9 + i * 0.1, exitVy: -sp(c, kind),
      }, g, drop);
    });
  },
  /** Heavy twin-engine bombers (G4M): tough, many guns, often carry a pick-up. */
  heavy(c, t, kind, n, _x, g, drop) {
    return Array.from({ length: n }, (_, i) => {
      const x0 = n === 1 ? c.r.range(-10, 10) : -W(c) + 10 + ((2 * W(c) - 20) * i) / (n - 1);
      return ev(t + i * 0.8, kind, {
        type: 'hover', x0, y0: top(c) + 2, yStop: c.r.range(18, 25), inT: 3, hold: 6, swayA: 5, swayF: 0.5, exitVy: -sp(c, kind),
      }, g, drop);
    });
  },
  /** Dive bombers that aim themselves at the player at spawn and accelerate. */
  divers(c, t, kind, n, _x, g, drop) {
    return Array.from({ length: n }, (_, i) => {
      const x0 = c.r.range(-W(c) + 6, W(c) - 6);
      return ev(t + i * 0.7, kind, { type: 'line', x0, y0: top(c), vx: 0, vy: -sp(c, kind, 1.1), accel: 7 }, g, drop, { aim: true });
    });
  },
  /** Kamikaze swarm: each one steers at the player for a while, then commits. */
  swarm(c, t, kind, n, _x, g, drop) {
    return Array.from({ length: n }, (_, i) => {
      const x0 = c.r.range(-W(c) + 4, W(c) - 4);
      return ev(t + i * 0.45, kind, { type: 'home', x0, y0: top(c), speed: sp(c, kind, 0.8), turn: 1.5, commit: 2.4, heading: Math.PI }, g, drop);
    });
  },
  /** A G4M mother plane, then its Ōka rocket bombs streaking at the player. */
  ohka(c, t, _kind, n, _x, g, drop) {
    const out: SpawnEvent[] = [ev(t, 'betty', { type: 'hover', x0: c.r.range(-8, 8), y0: top(c) + 2, yStop: 24, inT: 2.5, hold: 3 + n * 0.8, swayA: 6, swayF: 0.6, exitVy: -6 }, 0, 'pow')];
    for (let i = 0; i < n; i++) {
      const x0 = c.r.range(-W(c) + 6, W(c) - 6);
      out.push(ev(t + 3 + i * 0.8, 'ohka', { type: 'line', x0, y0: top(c), vx: 0, vy: -sp(c, 'ohka'), accel: 10 }, g, drop, { aim: true }));
    }
    return out;
  },
  /** Destroyers sailing down the screen (they ride the sea). */
  convoy(c, t, kind, n, x, g, drop) {
    const cx = x ?? c.r.range(-W(c) + 8, W(c) - 8);
    return Array.from({ length: n }, (_, i) =>
      ev(t, kind, { type: 'ground', x0: cx + (i % 2 ? 6 : -6) * (n > 1 ? 1 : 0), y0: top(c) + 6 + i * 13, vx: 0, vy: -ENEMIES[kind].speed }, g, drop));
  },
  cruiser(c, t, kind, n, x, g, drop) {
    return BUILDERS.convoy(c, t, kind, n, x, g, drop);
  },
  /** Landing barges heading across to the beach. */
  barges(c, t, _kind, n, _x, g, drop) {
    const s = c.r.sign();
    const y0 = top(c) + 2;
    return Array.from({ length: n }, (_, i) =>
      ev(t, 'barge', { type: 'ground', x0: -s * (W(c) - 4) + s * i * 5, y0: y0 + i * 3, vx: s * 2.5, vy: -1 }, g, drop));
  },
  /** An island gun site: AA mounts dug in on an island that scrolls in with them. */
  aaSite(c, t, _kind, n, x, g, drop) {
    const cx = x ?? c.r.range(-W(c) + 12, W(c) - 12);
    const y0 = top(c) + 8;
    const out: SpawnEvent[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const rr = 4.5 + (i % 2) * 1.5;
      out.push(ev(t, 'aaGun', { type: 'ground', x0: cx + Math.cos(a) * rr, y0: y0 + Math.sin(a) * rr * 0.8, vx: 0, vy: 0 }, g, drop,
        i === 0 ? { decor: { kind: 'island', dx: cx - (cx + Math.cos(a) * rr), dy: y0 - (y0 + Math.sin(a) * rr * 0.8), scale: 1.3 + n * 0.08 } } : {}));
    }
    return out;
  },
};

/** Which kinds a formation may use on this level (null = the formation needs none of them). */
function kindsFor(level: LevelDef, f: FormationKind): EnemyKind[] {
  const r = level.roster;
  switch (f) {
    case 'vee': case 'wall': case 'crossing': case 'behind': case 'loops':
      return r.fighter;
    case 'column':
      return [...r.fighter, ...r.fighter, ...r.diver];
    case 'bombers':
      return r.bomber.filter((k) => k !== 'betty').length ? r.bomber.filter((k) => k !== 'betty') : r.diver;
    case 'heavy':
      return r.bomber.includes('betty') ? ['betty'] : r.bomber;
    case 'divers':
      return r.diver;
    case 'swarm':
      return r.suicide;
    case 'ohka':
      return r.suicide.length ? ['ohka'] : [];
    case 'convoy':
      return ['destroyer'];
    case 'cruiser':
      return ['cruiser'];
    case 'barges':
      return ['barge'];
    case 'aaSite':
      return ['aaGun'];
  }
}

const COUNT: Record<FormationKind, [number, number]> = {
  vee: [3, 5], column: [4, 6], wall: [5, 7], crossing: [3, 5], behind: [2, 3], loops: [2, 3], bombers: [2, 4], heavy: [1, 2],
  divers: [2, 4], swarm: [4, 7], ohka: [2, 4], convoy: [1, 2], cruiser: [1, 1], barges: [3, 5], aaSite: [3, 5],
};

/** How long a formation keeps the player busy, relative to an ordinary wave. */
const WEIGHT: Partial<Record<FormationKind, number>> = { heavy: 1.5, convoy: 1.3, cruiser: 1.6, aaSite: 1.4, wall: 1.2, ohka: 1.6, swarm: 1.3 };

/** Formations that can earn a pick-up when wiped out. */
const BONUS_OK = new Set<FormationKind>(['vee', 'column', 'wall', 'crossing', 'loops', 'bombers', 'divers', 'behind', 'convoy', 'barges', 'aaSite', 'swarm']);

/** The full schedule of a level, sorted by time. */
export function buildSchedule(level: LevelDef, seed = level.seed, cfg: PacificConfig = PACIFIC): SpawnEvent[] {
  const c: Ctx = { r: makeRand(seed ^ 0x5eed), cfg, level, speed: 1 + level.index * cfg.enemy.speedGrowth, nextGroup: 1 };
  const out: SpawnEvent[] = [];
  let lastDrop = 0;

  const add = (t: number, f: FormationKind, kind?: EnemyKind, n?: number, x?: number) => {
    const kinds = kindsFor(level, f);
    if (!kinds.length) return false;
    const k = kind ?? c.r.pick(kinds);
    const [lo, hi] = COUNT[f];
    const count = n ?? c.r.int(lo, hi);
    let drop: PickupKind | null = null;
    let group = 0;
    // Overdue: any formation carries the bonus, even a lone bomber or a cruiser.
    const overdue = t - lastDrop > DROP_EVERY;
    if (overdue || (BONUS_OK.has(f) && count >= 2 && c.r() < 0.3)) {
      drop = c.r.weighted(DROP_WEIGHTS);
      lastDrop = t;
    }
    if (drop) group = c.nextGroup++;
    out.push(...BUILDERS[f](c, t, k, count, x, group, drop));
    return true;
  };

  // Set pieces are merged in time order, so the bonus-formation spacing counts them where they fall.
  const pieces = [...level.setPieces].sort((a, b) => a.t - b.t);
  let next = 0;
  let t = FIRST_WAVE;
  while (t < level.duration) {
    while (next < pieces.length && pieces[next].t <= t) {
      const p = pieces[next++];
      add(p.t, p.formation, p.kind, p.n, p.x);
    }
    const busy = level.setPieces.some((p) => Math.abs(p.t - t) < 2);
    if (!busy) {
      const f = c.r.weighted(level.formations);
      if (add(t, f)) {
        const progress = t / level.duration;
        t += level.gap * (1.15 - 0.4 * progress) * c.r.range(0.8, 1.2) * (WEIGHT[f] ?? 1);
        continue;
      }
    }
    t += 1;
  }
  for (; next < pieces.length; next++) add(pieces[next].t, pieces[next].formation, pieces[next].kind, pieces[next].n, pieces[next].x);
  return out.sort((a, b) => a.t - b.t);
}

/** Scenery along the level: the level's set scenery plus random islands and reefs. */
export function buildDecor(level: LevelDef, seed = level.seed, cfg: PacificConfig = PACIFIC): DecorEvent[] {
  const r = makeRand(seed ^ 0xdec0);
  const out: DecorEvent[] = level.scenery.specials.map((s) => ({ at: s.at, kind: s.kind, x: s.x, scale: s.scale, rot: s.rot ?? 0, seed: r.int(1, 1e9) }));
  const end = (level.duration + 60) * cfg.scroll.speed;
  let at = r.range(-30, level.scenery.every * 0.5);
  while (at < end) {
    const kind = r.pick(level.scenery.kinds);
    const big = kind === 'island' || kind === 'jungle' || kind === 'atoll';
    out.push({
      at, kind, x: r.sign() * r.range(big ? 14 : 6, cfg.field.halfW + 12), scale: r.range(0.7, big ? 1.3 : 1.1), rot: r.range(0, Math.PI * 2), seed: r.int(1, 1e9),
    });
    at += level.scenery.every * r.range(0.6, 1.4);
  }
  return out.sort((a, b) => a.at - b.at);
}
