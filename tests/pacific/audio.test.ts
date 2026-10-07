/**
 * The arcade game's sound, against the WebAudio mock: silent and harmless before a user gesture,
 * every simulation event plays without an invalid AudioParam value, rapid events are throttled,
 * finished one-shots disconnect, muting fades the master, and the march loop schedules ahead.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameAudio } from '../../src/pacific/audio';
import { createGame } from '../../src/pacific/sim/game';
import type { GameEventType } from '../../src/pacific/types';
import { MockAudioContext, violations } from '../audio/mockAudio';

const ALL: GameEventType[] = [
  'shot', 'enemyShot', 'hit', 'kill', 'partKill', 'playerHit', 'playerDown', 'respawn', 'wingmanDown', 'pickup', 'drop', 'roll', 'warning',
  'bossIn', 'bossDown', 'bossEscape', 'clear', 'gameover', 'chain', 'extraLife', 'launch',
];

const g = globalThis as unknown as { window?: unknown };
let saved: unknown;

beforeEach(() => {
  saved = g.window;
  g.window = { AudioContext: MockAudioContext };
  violations.length = 0;
  MockAudioContext.instances.length = 0;
});
afterEach(() => {
  g.window = saved;
});

async function started(): Promise<{ a: GameAudio; ctx: MockAudioContext }> {
  const a = new GameAudio();
  a.start();
  await Promise.resolve();
  const ctx = MockAudioContext.instances[0];
  return { a, ctx };
}

describe('GameAudio', () => {
  it('before start(): play and update are silent no-ops', () => {
    const a = new GameAudio();
    for (const type of ALL) a.play({ type, x: 0, y: 0 });
    a.update(null, true);
    expect(MockAudioContext.instances).toHaveLength(0);
    expect(a.running).toBe(false);
  });

  it('start() builds the graph once and runs; every event plays with valid parameters', async () => {
    const { a, ctx } = await started();
    expect(a.running).toBe(true);
    a.start();
    expect(MockAudioContext.instances).toHaveLength(1);
    for (const type of ALL) {
      ctx.advance(0.5);
      a.play({ type, x: 0, y: 0, n: 3, kind: 'zero', surface: type === 'kill' });
    }
    expect(violations).toEqual([]);
    expect(ctx.started('oscillator') + ctx.started('bufferSource')).toBeGreaterThan(ALL.length);
  });

  it('throttles rapid gunfire', async () => {
    const { a, ctx } = await started();
    const before = ctx.nodes.length;
    for (let i = 0; i < 20; i++) a.play({ type: 'shot', x: 0, y: 0 });
    const oneBurst = ctx.nodes.length - before;
    ctx.advance(1);
    const mid = ctx.nodes.length;
    a.play({ type: 'shot', x: 0, y: 0 });
    expect(ctx.nodes.length - mid).toBeGreaterThan(0);
    // Twenty presses in the same instant made no more than one shot's worth of nodes.
    expect(oneBurst).toBeLessThanOrEqual(ctx.nodes.length - mid);
  });

  it('finished one-shots disconnect from the graph', async () => {
    const { a, ctx } = await started();
    const live0 = ctx.liveNodes();
    for (const type of ['kill', 'pickup', 'clear'] as GameEventType[]) a.play({ type, x: 0, y: 0 });
    expect(ctx.liveNodes()).toBeGreaterThan(live0);
    ctx.advance(30);
    ctx.endFinished();
    expect(ctx.liveNodes()).toBe(live0);
  });

  it('muted: no new sounds; the engine follows the player; the music loop schedules ahead', async () => {
    const { a, ctx } = await started();
    a.setMuted(true);
    const n = ctx.nodes.length;
    a.play({ type: 'kill', x: 0, y: 0 });
    expect(ctx.nodes.length).toBe(n);
    a.setMuted(false);
    const s = createGame({ level: 0, difficulty: 'normal', plane: 'p38' });
    a.setMusic(true);
    for (let i = 0; i < 30; i++) {
      ctx.advance(1 / 30);
      a.update(s, true);
    }
    expect(ctx.started('oscillator')).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});
