/**
 * The wave and scenery builders: deterministic per seed, sorted, inside the level's time, only the
 * enemy kinds a level allows, spawning off-screen, a bonus formation at least every DROP_EVERY
 * seconds — for the real levels and (fuzz) for random seeds.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PACIFIC } from '../../src/pacific/config';
import { ENEMIES } from '../../src/pacific/enemies';
import { LEVELS, type LevelDef } from '../../src/pacific/levels';
import { patternPos } from '../../src/pacific/sim/patterns';
import { DROP_EVERY, FIRST_WAVE, buildDecor, buildSchedule } from '../../src/pacific/sim/waves';
import type { EnemyKind, SpawnEvent } from '../../src/pacific/types';
import { fcParams } from '../support/fc';

const F = PACIFIC.field;

/** Kinds a level may spawn: its roster plus what its formations and set pieces bring along. */
function allowed(l: LevelDef): Set<EnemyKind> {
  const s = new Set<EnemyKind>([...l.roster.fighter, ...l.roster.bomber, ...l.roster.diver, ...l.roster.suicide]);
  const f = new Set([...Object.keys(l.formations).filter((k) => (l.formations[k as keyof typeof l.formations] ?? 0) > 0), ...l.setPieces.map((p) => p.formation)]);
  if (f.has('convoy')) s.add('destroyer');
  if (f.has('cruiser')) s.add('cruiser');
  if (f.has('barges')) s.add('barge');
  if (f.has('aaSite')) s.add('aaGun');
  if (f.has('ohka')) {
    s.add('ohka');
    s.add('betty');
  }
  for (const p of l.setPieces) if (p.kind) s.add(p.kind);
  return s;
}

function checkSchedule(l: LevelDef, sched: SpawnEvent[]): void {
  expect(sched.length).toBeGreaterThan(20);
  const ok = allowed(l);
  let lastT = -Infinity;
  for (const e of sched) {
    expect(e.t).toBeGreaterThanOrEqual(lastT);
    lastT = e.t;
    expect(e.t).toBeGreaterThanOrEqual(FIRST_WAVE - 1e-9);
    expect(e.t).toBeLessThan(l.duration + 12);
    expect(ok.has(e.kind), `${l.key}: ${e.kind}`).toBe(true);
    // Every spawn starts outside the visible playfield (from above, below or a side).
    const p = patternPos(e.pattern, 0, 0, { x: 0, y: 0 });
    const outside = p.y > F.halfH || p.y < -F.halfH || Math.abs(p.x) > F.halfW;
    expect(outside, `${l.key}: ${e.kind} spawns at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`).toBe(true);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  }
  // A bonus formation (all members of a group carry the same drop) comes at least every DROP_EVERY s.
  const groupStarts = new Map<number, number>();
  for (const e of sched) if (e.group && e.drop && !groupStarts.has(e.group)) groupStarts.set(e.group, e.t);
  const times = [...groupStarts.values()].sort((a, b) => a - b);
  expect(times.length).toBeGreaterThan(3);
  let prev = 0;
  for (const t of times) {
    expect(t - prev, `${l.key}: gap before ${t.toFixed(1)}`).toBeLessThan(DROP_EVERY + l.gap * 2.2 + 2);
    prev = t;
  }
  for (const e of sched) {
    if (!e.group) continue;
    const first = sched.find((o) => o.group === e.group)!;
    expect(e.drop).toBe(first.drop);
  }
}

describe('buildSchedule', () => {
  it('is deterministic per seed and differs between seeds', () => {
    for (const l of LEVELS) {
      expect(buildSchedule(l)).toEqual(buildSchedule(l));
      expect(JSON.stringify(buildSchedule(l, 1))).not.toBe(JSON.stringify(buildSchedule(l, 2)));
    }
  });

  it('every real level: sorted, in time, allowed kinds, off-screen spawns, regular bonus formations', () => {
    for (const l of LEVELS) checkSchedule(l, buildSchedule(l));
  });

  it('includes every set piece at its time', () => {
    for (const l of LEVELS) {
      const sched = buildSchedule(l);
      for (const p of l.setPieces) expect(sched.some((e) => Math.abs(e.t - p.t) < 3.5), `${l.key} @${p.t}`).toBe(true);
    }
  });

  it('later levels are busier: more enemies per second than Pearl Harbor', () => {
    const rate = (l: LevelDef) => buildSchedule(l).length / l.duration;
    expect(rate(LEVELS[9])).toBeGreaterThan(rate(LEVELS[0]));
    expect(rate(LEVELS[6])).toBeGreaterThan(rate(LEVELS[0]));
  });

  it('gun-site islands arrive with their island (Iwo Jima)', () => {
    const sched = buildSchedule(LEVELS[8]);
    const guns = sched.filter((e) => e.kind === 'aaGun');
    expect(guns.length).toBeGreaterThan(5);
    expect(guns.filter((e) => e.decor?.kind === 'island').length).toBeGreaterThanOrEqual(2);
  });

  it('holds its invariants for any seed (fuzz)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: LEVELS.length - 1 }), fc.integer({ min: 0, max: 0x7fffffff }), (li, seed) => {
      checkSchedule(LEVELS[li], buildSchedule(LEVELS[li], seed));
    }), fcParams(60));
  });
});

describe('buildDecor', () => {
  it('places the level specials and fills the scroll with scenery, sorted, deterministic', () => {
    for (const l of LEVELS) {
      const d = buildDecor(l);
      expect(d).toEqual(buildDecor(l));
      for (let i = 1; i < d.length; i++) expect(d[i].at).toBeGreaterThanOrEqual(d[i - 1].at);
      for (const s of l.scenery.specials) expect(d.some((e) => e.kind === s.kind && e.at === s.at)).toBe(true);
      const end = (l.duration + 60) * PACIFIC.scroll.speed;
      expect(d.filter((e) => e.at > 0 && e.at < end).length).toBeGreaterThan(end / l.scenery.every / 2);
      for (const e of d) expect(Number.isInteger(e.seed) && e.scale > 0).toBe(true);
    }
  });
});

describe('enemy kinds used by the schedules are all in the catalogue', () => {
  it('no unknown kinds', () => {
    for (const l of LEVELS) for (const e of buildSchedule(l)) expect(ENEMIES[e.kind]).toBeDefined();
  });
});
