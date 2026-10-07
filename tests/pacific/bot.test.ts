/**
 * The autopilot: always a valid input (finite, stick within ±1), it fires, it moves out of the way
 * of a bullet about to hit, it rolls only when a hit is otherwise unavoidable, and it takes a
 * pick-up within reach — over random game states too (fuzz).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PACIFIC } from '../../src/pacific/config';
import { botInput } from '../../src/pacific/sim/bot';
import { createGame, stepGame } from '../../src/pacific/sim/game';
import type { GameState } from '../../src/pacific/types';
import { fcParams } from '../support/fc';

function ready(): GameState {
  const s = createGame({ level: 0, difficulty: 'normal', plane: 'f6f' });
  s.schedule = [];
  for (let i = 0; i < 400; i++) stepGame(s, { x: 0, y: 0, target: null, fire: false, roll: false }, PACIFIC.sim.dt);
  s.events.length = 0;
  return s;
}

describe('botInput', () => {
  it('fires, and steps aside from a bullet heading straight at the player', () => {
    const s = ready();
    s.eBullets.push({ x: s.player.x, y: s.player.y + 6, vx: 0, vy: -20, r: 0.4, dmg: 1, style: 0, alive: true });
    const i = botInput(s);
    expect(i.fire).toBe(true);
    expect(Math.abs(i.x)).toBeGreaterThan(0.3);
  });

  it('dodges a stream of bullets for two seconds without being hit (no rolls)', () => {
    const s = ready();
    s.player.rolls = 0;
    for (let k = 0; k < 240; k++) {
      if (k % 12 === 0) s.eBullets.push({ x: s.player.x, y: s.player.y + 12, vx: 0, vy: -18, r: 0.4, dmg: 1, style: 0, alive: true });
      stepGame(s, botInput(s), PACIFIC.sim.dt);
    }
    expect(s.stats.damageTaken).toBe(0);
  });

  it('rolls only when a bullet is about to hit, and only with rolls left', () => {
    const s = ready();
    expect(botInput(s).roll).toBe(false);
    s.eBullets.push({ x: s.player.x, y: s.player.y + 0.8, vx: 0, vy: -20, r: 0.4, dmg: 1, style: 0, alive: true });
    expect(botInput(s).roll).toBe(true);
    s.player.rolls = 0;
    expect(botInput(s).roll).toBe(false);
  });

  it('goes for a pick-up', () => {
    const s = ready();
    s.pickups.push({ id: 1, kind: 'pow', x: s.player.x + 10, y: s.player.y + 2, x0: s.player.x + 10, age: 0, alive: true });
    expect(botInput(s).x).toBeGreaterThan(0.5);
  });

  it('always returns a valid input, from any moment of any level (fuzz)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 0, max: 6000 }), (lv, seed, steps) => {
      const s = createGame({ level: lv, difficulty: 'hard', plane: 'p38', seed });
      for (let i = 0; i < steps; i++) {
        stepGame(s, botInput(s), PACIFIC.sim.dt);
        s.events.length = 0;
      }
      const i = botInput(s);
      for (const v of [i.x, i.y]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9);
      }
      expect(typeof i.fire).toBe('boolean');
    }), fcParams(15));
  });
});
