/**
 * Seeded random numbers for the game simulation: mulberry32 over a single 32-bit state, so the
 * whole game state stays plain serialisable data and a run replays exactly from its seed.
 */

/** Advance `state` and return [uniform in [0, 1), next state]. */
export function mulberry(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** A tiny stateful generator for the pure builders (schedule, scenery, models). */
export interface Rand {
  (): number;
  /** Uniform in [a, b). */
  range(a: number, b: number): number;
  /** Integer in [a, b]. */
  int(a: number, b: number): number;
  pick<T>(list: readonly T[]): T;
  /** Weighted choice over the entries with weight > 0. */
  weighted<K extends string>(w: Partial<Record<K, number>>): K;
  sign(): 1 | -1;
}

export function makeRand(seed: number): Rand {
  let s = seed >>> 0;
  const r = (() => {
    const [v, n] = mulberry(s);
    s = n;
    return v;
  }) as Rand;
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (list) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
  r.weighted = <K extends string>(w: Partial<Record<K, number>>): K => {
    const keys = (Object.keys(w) as K[]).filter((k) => (w[k] ?? 0) > 0);
    const total = keys.reduce((a, k) => a + (w[k] ?? 0), 0);
    let x = r() * total;
    for (const k of keys) {
      x -= w[k] ?? 0;
      if (x < 0) return k;
    }
    return keys[keys.length - 1];
  };
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}
