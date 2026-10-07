/**
 * Functional: the autopilot plays whole levels through the real `stepGame`, the way a person would
 * (only `Input`). Every level can be finished and every boss shot down before it escapes, starting
 * from the level select's pilot; the whole campaign chains from Pearl Harbor to Okinawa carrying
 * the score; and Pearl Harbor on Easy is survivable without god mode.
 */
import { describe, expect, it } from 'vitest';
import { PACIFIC } from '../../src/pacific/config';
import { LEVELS } from '../../src/pacific/levels';
import { botInput } from '../../src/pacific/sim/bot';
import { carryOf, createGame, startCarry, stepGame } from '../../src/pacific/sim/game';
import type { Carry, Difficulty, GameState } from '../../src/pacific/types';

const DT = PACIFIC.sim.dt;

function play(level: number, o: { god: boolean; difficulty: Difficulty; carry?: Carry; seed?: number }): GameState {
  const s = createGame({ level, plane: 'f6f', difficulty: o.difficulty, god: o.god, carry: o.carry ?? startCarry('f6f', o.difficulty, level), seed: o.seed });
  // Ten minutes of game time at most.
  for (let i = 0; i < 120 * 600 && !s.done && s.phase !== 'gameover'; i++) {
    stepGame(s, botInput(s), DT);
    s.events.length = 0;
  }
  return s;
}

describe('the autopilot plays the campaign', () => {
  it('every level is finished and its boss shot down before it escapes (Normal, from the level select)', () => {
    for (const l of LEVELS) {
      const s = play(l.index, { god: true, difficulty: 'normal' });
      expect(s.done, l.key).toBe(true);
      expect(s.stats.bossKilled, `${l.key}: boss killed`).toBe(true);
      expect(s.stats.bossTime, l.key).toBeLessThan(PACIFIC.boss.escapeAfter);
      expect(s.stats.kills, l.key).toBeGreaterThan(s.stats.spawned * 0.5);
      // A level lasts a couple of minutes, not ten.
      expect(s.clock, l.key).toBeLessThan(300);
      expect(s.clock, l.key).toBeGreaterThan(l.duration);
    }
  }, 240_000);

  it('the whole war in one sitting: the carry chains ten levels and the score only grows', () => {
    let carry: Carry | undefined;
    let last = 0;
    for (const l of LEVELS) {
      const s = play(l.index, { god: true, difficulty: 'easy', carry });
      expect(s.done, l.key).toBe(true);
      expect(s.score).toBeGreaterThan(last);
      last = s.score;
      carry = carryOf(s);
    }
    expect(carry!.weapon).toBeGreaterThanOrEqual(3);
  }, 240_000);

  it('Pearl Harbor on Easy is survivable without god mode', () => {
    const s = play(0, { god: false, difficulty: 'easy' });
    expect(s.phase).not.toBe('gameover');
    expect(s.done).toBe(true);
    expect(s.player.lives).toBeGreaterThan(0);
  }, 120_000);

  it('the same seed replays the same level exactly', () => {
    const a = play(2, { god: true, difficulty: 'normal', seed: 4242 });
    const b = play(2, { god: true, difficulty: 'normal', seed: 4242 });
    expect(a.score).toBe(b.score);
    expect(a.clock).toBe(b.clock);
    expect(a.stats).toEqual(b.stats);
  }, 120_000);
});
