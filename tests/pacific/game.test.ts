/**
 * The game simulation's rules: set-up and carry-over, determinism, the player's movement, guns,
 * roll, damage, lives and respawn, enemy movement and despawn, formation bonuses, pick-ups,
 * scoring and extra lives, the boss (entry, phases, parts, kill, escape) and the level flow —
 * plus fuzz properties over random inputs.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOSSES } from '../../src/pacific/bosses';
import { PACIFIC, clonePacific } from '../../src/pacific/config';
import { LEVELS } from '../../src/pacific/levels';
import {
  NO_INPUT, PART_TO_CORE, bossOffset, carryOf, createGame, freshCarry, headingOf, hitsEnemy, hurtPlayer, maxHpOf, spawnBoss, spawnEnemy,
  startCarry, stepGame,
} from '../../src/pacific/sim/game';
import { patternPos } from '../../src/pacific/sim/patterns';
import type { GameState, Input, Pattern } from '../../src/pacific/types';
import { fcParams } from '../support/fc';

const DT = PACIFIC.sim.dt;
const F = PACIFIC.field;
const input = (o: Partial<Input> = {}): Input => ({ ...NO_INPUT, ...o });

function run(s: GameState, seconds: number, inp: Input | ((s: GameState) => Input) = NO_INPUT): GameState {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    stepGame(s, typeof inp === 'function' ? inp(s) : inp, DT);
    if (s.events.length > 500) s.events.length = 0;
  }
  return s;
}

/** A level with the intro done and no scheduled waves (an empty sky to test in). */
function quiet(level = 0, o: Partial<Parameters<typeof createGame>[0]> = {}): GameState {
  const s = createGame({ level, difficulty: 'normal', plane: 'f6f', ...o });
  s.schedule = [];
  run(s, PACIFIC.player.introTime + 0.1);
  expect(s.phase).toBe('waves');
  s.events.length = 0;
  return s;
}

describe('set-up', () => {
  it('a fresh game: intro phase, the player below the screen, full hull, three lives, guns at level 1', () => {
    const s = createGame({ level: 0, difficulty: 'normal', plane: 'p38' });
    expect(s.phase).toBe('intro');
    expect(s.player.y).toBeLessThan(-F.halfH);
    expect(s.player.hp).toBe(PACIFIC.planes.p38.hp);
    expect(s.player.lives).toBe(PACIFIC.player.lives);
    expect(s.player.weapon).toBe(1);
    expect(s.schedule.length).toBeGreaterThan(10);
  });

  it('difficulty changes the hull: easy +2, hard −1 (never below 1)', () => {
    expect(maxHpOf('f6f', 'easy')).toBe(PACIFIC.planes.f6f.hp + 2);
    expect(maxHpOf('f6f', 'hard')).toBe(PACIFIC.planes.f6f.hp - 1);
    const cfg = clonePacific();
    cfg.planes.p38.hp = 1;
    expect(maxHpOf('p38', 'hard', cfg)).toBe(1);
  });

  it('the intro flies the player up to the start line, then the waves begin', () => {
    const s = createGame({ level: 0, difficulty: 'normal', plane: 'f4u' });
    run(s, PACIFIC.player.introTime + 0.05);
    expect(s.phase).toBe('waves');
    expect(s.player.y).toBeCloseTo(PACIFIC.player.startY, 0);
  });

  it('carries score, lives, guns, escorts and rolls into the next level', () => {
    const s = quiet();
    s.score = 12345;
    s.player.weapon = 4;
    s.player.wingmen = 2;
    s.player.rolls = 1;
    s.player.lives = 2;
    s.player.hp = 2;
    const c = carryOf(s);
    const n = createGame({ level: 1, difficulty: 'normal', plane: 'f6f', carry: c });
    expect(n.score).toBe(12345);
    expect(n.player.weapon).toBe(4);
    expect(n.player.wingmen).toBe(2);
    expect(n.player.rolls).toBe(1);
    expect(n.player.lives).toBe(2);
    expect(n.player.hp).toBe(2);
  });

  it('a pilot starting later in the war gets better guns (level select)', () => {
    expect(startCarry('p38', 'normal', 0).weapon).toBe(1);
    expect(startCarry('p38', 'normal', 9).weapon).toBeGreaterThanOrEqual(3);
    for (let l = 1; l < 10; l++) expect(startCarry('p38', 'normal', l).weapon).toBeGreaterThanOrEqual(startCarry('p38', 'normal', l - 1).weapon);
    expect(startCarry('p38', 'normal', 9).weapon).toBeLessThan(PACIFIC.player.maxWeapon);
  });
});

describe('determinism', () => {
  it('the same seed and inputs give exactly the same game', () => {
    const play = () => {
      const s = createGame({ level: 3, difficulty: 'hard', plane: 'p38', seed: 99 });
      run(s, 25, (st) => input({ x: Math.sin(st.clock), y: Math.cos(st.clock * 0.7) * 0.5, fire: true, roll: Math.floor(st.clock * 2) % 17 === 0 }));
      s.events.length = 0;
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });

  it('structuredClone copies a state; stepping the copy leaves the original alone', () => {
    const s = createGame({ level: 0, difficulty: 'normal', plane: 'p38' });
    run(s, 8, input({ fire: true }));
    const before = JSON.stringify(s);
    const c = structuredClone(s);
    run(c, 3, input({ x: 1, fire: true }));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('the player', () => {
  it('flies at the aircraft\'s speed and is held inside the playfield', () => {
    const s = quiet(0, { plane: 'f4u' });
    const x0 = s.player.x;
    run(s, 0.5, input({ x: 1 }));
    expect(s.player.x - x0).toBeCloseTo(PACIFIC.planes.f4u.speed * 0.5, 0);
    run(s, 5, input({ x: 1, y: 1 }));
    expect(s.player.x).toBeLessThanOrEqual(F.halfW);
    expect(s.player.y).toBeLessThanOrEqual(F.halfH);
    run(s, 8, input({ x: -1, y: -1 }));
    expect(s.player.x).toBeGreaterThanOrEqual(-F.halfW);
    expect(s.player.y).toBeGreaterThanOrEqual(-F.halfH);
  });

  it('a diagonal stick is no faster than a straight one', () => {
    const s = quiet();
    s.player.x = 0;
    s.player.y = -10;
    run(s, 0.2, input({ x: 1, y: 1 }));
    expect(Math.hypot(s.player.vx, s.player.vy)).toBeCloseTo(PACIFIC.planes.f6f.speed, 5);
  });

  it('a drag target pulls the aircraft towards it', () => {
    const s = quiet();
    run(s, 2, input({ target: { x: 10, y: -5 } }));
    expect(s.player.x).toBeCloseTo(10, 0);
    expect(s.player.y).toBeCloseTo(-5, 0);
  });

  it('each gun level fires its streams; the P-38\'s are tighter than the Hellcat\'s', () => {
    for (let w = 1; w <= 5; w++) {
      const s = quiet();
      s.player.weapon = w;
      stepGame(s, input({ fire: true }), DT);
      expect(s.pBullets.length).toBe(PACIFIC.weapon.streams[w - 1].length);
    }
    const spread = (plane: 'p38' | 'f6f') => {
      const s = quiet(0, { plane });
      s.player.weapon = 5;
      stepGame(s, input({ fire: true }), DT);
      return Math.max(...s.pBullets.map((b) => Math.abs(Math.atan2(b.vx, b.vy))));
    };
    expect(spread('p38')).toBeLessThan(spread('f6f'));
  });

  it('fires at the aircraft\'s rate while the trigger is held', () => {
    const s = quiet(0, { plane: 'f4u' });
    run(s, 1, input({ fire: true }));
    const volleys = s.stats.shots / PACIFIC.weapon.streams[0].length;
    expect(volleys).toBeGreaterThan(1 / PACIFIC.planes.f4u.fireInterval - 2);
    expect(volleys).toBeLessThan(1 / PACIFIC.planes.f4u.fireInterval + 2);
  });

  it('the roll uses one roll, protects from bullets and cannot fire', () => {
    const s = quiet();
    const rolls = s.player.rolls;
    stepGame(s, input({ roll: true }), DT);
    expect(s.player.rolls).toBe(rolls - 1);
    expect(s.player.roll).toBeGreaterThan(0);
    s.eBullets.push({ x: s.player.x, y: s.player.y, vx: 0, vy: 0, r: 0.4, dmg: 1, style: 0, alive: true });
    stepGame(s, input({ fire: true }), DT);
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(s.pBullets.length).toBe(0);
    // Holding the button does not chain rolls: it needs a fresh press after the cooldown.
    run(s, PACIFIC.player.rollTime + PACIFIC.player.rollCooldown + 0.05);
    expect(s.player.roll).toBe(0);
  });

  it('no rolls left, no roll', () => {
    const s = quiet();
    s.player.rolls = 0;
    stepGame(s, input({ roll: true }), DT);
    expect(s.player.roll).toBe(0);
  });

  it('a hit costs one hull point and gives brief invulnerability', () => {
    const s = quiet();
    s.eBullets.push({ x: s.player.x, y: s.player.y, vx: 0, vy: 0, r: 0.4, dmg: 1, style: 0, alive: true });
    s.eBullets.push({ x: s.player.x, y: s.player.y, vx: 0, vy: 0, r: 0.4, dmg: 1, style: 0, alive: true });
    stepGame(s, NO_INPUT, DT);
    expect(s.player.hp).toBe(s.player.maxHp - 1);
    expect(s.player.invuln).toBeGreaterThan(1);
    expect(s.events.some((e) => e.type === 'playerHit')).toBe(true);
  });

  it('losing the last hull point loses a life, a gun level and the escorts; the player respawns', () => {
    const s = quiet();
    s.player.weapon = 3;
    s.player.wingmen = 2;
    s.player.hp = 1;
    expect(hurtPlayer(s, 1)).toBe(true);
    expect(s.player.alive).toBe(false);
    expect(s.player.lives).toBe(PACIFIC.player.lives - 1);
    expect(s.player.weapon).toBe(2);
    expect(s.player.wingmen).toBe(0);
    run(s, PACIFIC.player.respawnDelay + 0.05);
    expect(s.player.alive).toBe(true);
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(s.player.invuln).toBeGreaterThan(0);
  });

  it('the last life lost is game over', () => {
    const s = quiet();
    s.player.lives = 1;
    s.player.hp = 1;
    hurtPlayer(s, 1);
    expect(s.phase).toBe('gameover');
    run(s, 5);
    expect(s.player.alive).toBe(false);
    expect(s.done).toBe(false);
  });

  it('god mode and the intro / clear phases never hurt the player', () => {
    const s = quiet(0, { god: true });
    expect(hurtPlayer(s, 5)).toBe(false);
    const t = createGame({ level: 0, difficulty: 'normal', plane: 'p38' });
    expect(hurtPlayer(t, 5)).toBe(false);
  });

  it('escorts fire too, and a bullet that hits one kills only that escort', () => {
    const s = quiet();
    s.player.wingmen = 2;
    stepGame(s, input({ fire: true }), DT);
    expect(s.pBullets.length).toBe(PACIFIC.weapon.streams[0].length + 2);
    const w = { x: s.player.x - PACIFIC.wingman.dx, y: s.player.y + PACIFIC.wingman.dy };
    s.eBullets.push({ x: w.x, y: w.y, vx: 0, vy: 0, r: 0.4, dmg: 1, style: 0, alive: true });
    stepGame(s, NO_INPUT, DT);
    expect(s.player.wingmen).toBe(1);
    expect(s.player.hp).toBe(s.player.maxHp);
  });
});

describe('enemies', () => {
  it('spawn, move along their pattern, and leave without a kill once off-screen', () => {
    const s = quiet();
    // Off to the side, so it does not ram the player on its way down.
    const e = spawnEnemy(s, { t: 0, kind: 'zero', group: 0, drop: null, pattern: { type: 'line', x0: 18, y0: F.halfH + 6, vx: 0, vy: -20 } })!;
    run(s, 1);
    expect(e.y).toBeCloseTo(F.halfH + 6 - 20, 0);
    expect(e.heading).toBeCloseTo(Math.PI, 1);
    run(s, 6);
    expect(s.enemies).toHaveLength(0);
    expect(s.stats.kills).toBe(0);
  });

  it('bullets kill them: score, kill event with the id, chain', () => {
    const s = quiet();
    const e = spawnEnemy(s, { t: 0, kind: 'zero', group: 0, drop: null, pattern: { type: 'line', x0: s.player.x, y0: 10, vx: 0, vy: 0 } })!;
    run(s, 1.5, input({ fire: true }));
    expect(e.alive).toBe(false);
    expect(s.stats.kills).toBe(1);
    expect(s.score).toBeGreaterThanOrEqual(100);
    expect(s.events.some((ev) => ev.type === 'kill' && ev.id === e.id)).toBe(true);
  });

  it('long hulls are hit along their length (hull circles follow the heading)', () => {
    const s = quiet();
    const d = spawnEnemy(s, { t: 0, kind: 'destroyer', group: 0, drop: null, pattern: { type: 'ground', x0: 0, y0: 10, vx: 0, vy: -1 } })!;
    expect(hitsEnemy(d, 0, 10 - 4, 0.3)).toBe(true);
    expect(hitsEnemy(d, 0, 10 + 4, 0.3)).toBe(true);
    expect(hitsEnemy(d, 3, 10, 0.3)).toBe(false);
  });

  it('wiping out a whole formation drops its pick-up; one escaping member forfeits it', () => {
    for (const escape of [false, true]) {
      const s = quiet();
      const g = 7;
      for (let i = 0; i < 3; i++) {
        spawnEnemy(s, { t: 0, kind: 'zero', group: g, drop: 'pow', pattern: { type: 'line', x0: -3 + i * 3, y0: 12, vx: 0, vy: 0 } });
      }
      if (escape) s.enemies[2].x = 1000;
      const kill = (i: number) => {
        const e = s.enemies.find((x, j) => j === i && x.alive);
        if (e) {
          e.hp = 0.1;
          s.pBullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, r: 0.5, dmg: 1, style: 0, alive: true });
          stepGame(s, NO_INPUT, DT);
        }
      };
      kill(0);
      kill(0);
      run(s, 2);
      if (!escape) kill(0);
      expect(s.pickups.length, `escape=${escape}`).toBe(escape ? 0 : 1);
    }
  });

  it('enemy guns fire at the player, but not from point-blank range', () => {
    const s = quiet();
    spawnEnemy(s, { t: 0, kind: 'zero', group: 0, drop: null, pattern: { type: 'line', x0: 0, y0: 15, vx: 0, vy: 0 } });
    run(s, 6);
    expect(s.events.filter((e) => e.type === 'enemyShot').length).toBeGreaterThan(1);
    const t = quiet();
    spawnEnemy(t, { t: 0, kind: 'zero', group: 0, drop: null, pattern: { type: 'line', x0: t.player.x, y0: t.player.y + 2, vx: 0, vy: 0 } });
    t.player.invuln = 99;
    run(t, 4, (st) => input({ target: { x: st.enemies[0]?.x ?? 0, y: (st.enemies[0]?.y ?? 0) - 2 } }));
    expect(t.events.filter((e) => e.type === 'enemyShot').length).toBe(0);
  });

  it('a kamikaze steers at the player, then commits', () => {
    const s = quiet();
    s.player.invuln = 99;
    const k = spawnEnemy(s, { t: 0, kind: 'kamikaze', group: 0, drop: null, pattern: { type: 'home', x0: 20, y0: F.halfH + 4, speed: 18, turn: 1.5, commit: 2.4, heading: Math.PI } })!;
    run(s, 1.5);
    const want = headingOf(s.player.x - k.x, s.player.y - k.y);
    expect(Math.abs(Math.atan2(Math.sin(want - k.heading), Math.cos(want - k.heading)))).toBeLessThan(0.6);
  });

  it('ramming costs the player a hull point and hurts the enemy', () => {
    const s = quiet();
    const e = spawnEnemy(s, { t: 0, kind: 'betty', group: 0, drop: null, pattern: { type: 'line', x0: s.player.x, y0: s.player.y, vx: 0, vy: 0 } })!;
    stepGame(s, NO_INPUT, DT);
    expect(s.player.hp).toBe(s.player.maxHp - PACIFIC.player.rammed);
    expect(e.hp).toBeLessThan(e.maxHp);
  });
});

describe('pick-ups and score', () => {
  const pick = (kind: Parameters<typeof spawnEnemy>[1]['drop'] & string, prep: (s: GameState) => void = () => {}) => {
    const s = quiet();
    prep(s);
    s.pickups.push({ id: 999, kind, x: s.player.x, y: s.player.y, x0: s.player.x, age: 0, alive: true });
    stepGame(s, NO_INPUT, DT);
    return s;
  };

  it('P upgrades the guns (max 5, then points); W brings two escorts; R adds a roll; + repairs; ★ scores', () => {
    expect(pick('pow').player.weapon).toBe(2);
    const maxed = pick('pow', (s) => { s.player.weapon = 5; });
    expect(maxed.player.weapon).toBe(5);
    expect(maxed.score).toBe(PACIFIC.score.maxPowerBonus);
    expect(pick('wing').player.wingmen).toBe(2);
    expect(pick('roll').player.rolls).toBe(PACIFIC.player.startRolls + 1);
    expect(pick('repair', (s) => { s.player.hp = 1; }).player.hp).toBe(2);
    expect(pick('medal').score).toBe(PACIFIC.pickup.medalBase);
  });

  it('pick-ups drift down and expire', () => {
    const s = quiet();
    s.pickups.push({ id: 5, kind: 'medal', x: 20, y: 30, x0: 20, age: 0, alive: true });
    run(s, PACIFIC.pickup.life + 0.5);
    expect(s.pickups).toHaveLength(0);
  });

  it('an extra life every extraLifeEvery points', () => {
    const s = quiet();
    const lives = s.player.lives;
    s.pickups.push({ id: 5, kind: 'medal', x: s.player.x, y: s.player.y, x0: s.player.x, age: 0, alive: true });
    s.score = PACIFIC.score.extraLifeEvery - 10;
    stepGame(s, NO_INPUT, DT);
    expect(s.player.lives).toBe(lives + 1);
    expect(s.nextExtraLife).toBe(PACIFIC.score.extraLifeEvery * 2);
  });

  it('a chain of quick kills raises the multiplier; a hit resets it', () => {
    const s = quiet();
    for (let i = 0; i < 8; i++) {
      const e = spawnEnemy(s, { t: 0, kind: 'zero', group: 0, drop: null, pattern: { type: 'line', x0: -10 + i * 2.5, y0: 10, vx: 0, vy: 0 } })!;
      e.hp = 0.1;
      s.pBullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, r: 0.5, dmg: 1, style: 0, alive: true });
      stepGame(s, NO_INPUT, DT);
    }
    expect(s.chain).toBe(8);
    hurtPlayer(s, 1);
    expect(s.chain).toBe(0);
  });
});

describe('the boss', () => {
  function bossFight(level: number): GameState {
    const s = quiet(level);
    s.phase = 'boss';
    spawnBoss(s);
    run(s, 12);
    expect(s.boss!.stage).toBe('fight');
    return s;
  }

  it('enters from above the screen and settles at its hold line', () => {
    const s = quiet(3);
    s.phase = 'boss';
    const b = spawnBoss(s);
    expect(b.y).toBeGreaterThan(F.halfH);
    run(s, 15);
    expect(b.stage).toBe('fight');
    expect(Math.abs(b.y - b.def.holdY)).toBeLessThan(b.def.swayY + 0.01);
  });

  it('a ship boss slows the scroll; it picks up again after', () => {
    const s = bossFight(3);
    expect(s.scrollSpeed).toBeLessThan(PACIFIC.scroll.speed * 0.6);
    const air = bossFight(5);
    expect(air.scrollSpeed).toBeCloseTo(PACIFIC.scroll.speed, 1);
  });

  it('changes phase at two-thirds and one-third of its hit points', () => {
    const s = bossFight(0);
    const b = s.boss!;
    b.hp = b.maxHp * 0.6;
    stepGame(s, NO_INPUT, DT);
    expect(b.phase).toBe(1);
    expect(b.timers).toHaveLength(b.def.guns[1].length);
    b.hp = b.maxHp * 0.2;
    stepGame(s, NO_INPUT, DT);
    expect(b.phase).toBe(2);
  });

  it('bullets hit parts before the hull; a destroyed part also takes a share off the boss', () => {
    const s = bossFight(1);
    const b = s.boss!;
    const part = b.parts[0];
    part.hp = 0.5;
    const hp0 = b.hp;
    s.pBullets.push({ x: part.x, y: part.y, vx: 0, vy: 0, r: 0.5, dmg: 1, style: 0, alive: true });
    stepGame(s, NO_INPUT, DT);
    expect(part.alive).toBe(false);
    expect(hp0 - b.hp).toBeCloseTo(part.def.hp * PART_TO_CORE, 1);
    expect(s.events.some((e) => e.type === 'partKill')).toBe(true);
  });

  it('killing it: score, all parts down, bullets fizzle, then the level clears with a bonus and the player flies off', () => {
    const s = bossFight(2);
    const b = s.boss!;
    run(s, 0.5);
    b.hp = 0.5;
    const off = bossOffset(b.def.heading, b.def.hull[0].dx, b.def.hull[0].dy, { x: 0, y: 0 });
    s.pBullets.push({ x: b.x + off.x, y: b.y + off.y, vx: 0, vy: 0, r: 0.5, dmg: 1, style: 0, alive: true });
    stepGame(s, NO_INPUT, DT);
    expect(b.stage).toBe('dying');
    expect(s.stats.bossKilled).toBe(true);
    expect(b.parts.every((p) => !p.alive)).toBe(true);
    expect(s.eBullets.every((e) => !e.alive) || s.eBullets.length === 0).toBe(true);
    run(s, PACIFIC.boss.dyingTime + 0.5);
    expect(s.phase).toBe('clear');
    expect(s.bonus.length).toBeGreaterThan(0);
    run(s, PACIFIC.boss.clearDelay + 4);
    expect(s.done).toBe(true);
  });

  it('a boss left alive too long escapes; the level still ends, without the kill bonus', () => {
    const s = bossFight(4);
    s.god = true;
    run(s, PACIFIC.boss.escapeAfter + 25);
    expect(s.stats.bossKilled).toBe(false);
    expect(['clear'].includes(s.phase)).toBe(true);
    expect(s.bonus.some((b) => b.label.startsWith('Hạ boss'))).toBe(false);
  });

  it('carriers launch aircraft from their decks', () => {
    const s = bossFight(3);
    s.god = true;
    run(s, 8);
    expect(s.events.some((e) => e.type === 'launch') || s.stats.spawned > 0).toBe(true);
  });

  it('every boss can be spawned on its level', () => {
    for (const l of LEVELS) {
      const s = quiet(l.index);
      const b = spawnBoss(s);
      expect(b.def).toBe(BOSSES[l.boss]);
      expect(b.parts).toHaveLength(b.def.parts.length);
    }
  });
});

describe('level flow', () => {
  it('waves → warning → boss once the schedule is spent and the sky is clear', () => {
    const s = createGame({ level: 0, difficulty: 'normal', plane: 'p38', god: true });
    run(s, PACIFIC.player.introTime + LEVELS[0].duration + 15, input({ fire: true }));
    expect(['warning', 'boss']).toContain(s.phase);
    run(s, PACIFIC.boss.warning + 1);
    expect(s.phase).toBe('boss');
    expect(s.boss).not.toBeNull();
  });
});

describe('properties (fuzz)', () => {
  const inputArb = fc.record({
    x: fc.oneof(fc.double({ min: -3, max: 3, noNaN: true }), fc.constantFrom(Number.NaN, Infinity)),
    y: fc.double({ min: -3, max: 3, noNaN: true }),
    fire: fc.boolean(),
    roll: fc.boolean(),
    target: fc.option(fc.record({ x: fc.double({ min: -80, max: 80, noNaN: true }), y: fc.double({ min: -80, max: 80, noNaN: true }) }), { nil: null }),
  });

  it('any input sequence keeps the player in the playfield, everything finite, and the lists within their caps', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 9 }), fc.array(inputArb, { minLength: 1, maxLength: 30 }), fc.integer({ min: 1, max: 1e6 }), (lv, inputs, seed) => {
      const s = createGame({ level: lv, difficulty: 'hard', plane: 'f4u', seed });
      for (let i = 0; i < 1200; i++) {
        stepGame(s, inputs[i % inputs.length], DT);
        s.events.length = 0;
      }
      const p = s.player;
      if (s.phase === 'waves' && p.alive) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(F.halfW);
        expect(p.y).toBeLessThanOrEqual(F.halfH);
        expect(p.y).toBeGreaterThanOrEqual(-F.halfH);
      }
      for (const v of [p.x, p.y, p.vx, p.vy, s.score, s.scroll]) expect(Number.isFinite(v)).toBe(true);
      for (const e of s.enemies) expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.heading)).toBe(true);
      expect(s.enemies.length).toBeLessThanOrEqual(PACIFIC.caps.enemies);
      expect(s.eBullets.length).toBeLessThanOrEqual(PACIFIC.caps.enemyBullets);
      expect(s.pBullets.length).toBeLessThanOrEqual(PACIFIC.caps.playerBullets);
      expect(s.score).toBeGreaterThanOrEqual(0);
    }), fcParams(25));
  });

  it('the score never goes down while playing', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 1, max: 1e6 }), (lv, seed) => {
      const s = createGame({ level: lv, difficulty: 'normal', plane: 'p38', seed, god: true });
      let last = s.score;
      for (let i = 0; i < 2400; i++) {
        stepGame(s, input({ fire: true, x: Math.sin(i / 60) }), DT);
        s.events.length = 0;
        expect(s.score).toBeGreaterThanOrEqual(last);
        last = s.score;
      }
    }), fcParams(10));
  });

  it('every closed-form pattern moves continuously (no jumps between its segments)', () => {
    const pat = fc.oneof(
      fc.record({ type: fc.constant('line' as const), x0: fc.double({ min: -30, max: 30, noNaN: true }), y0: fc.double({ min: -40, max: 40, noNaN: true }), vx: fc.double({ min: -25, max: 25, noNaN: true }), vy: fc.double({ min: -25, max: 25, noNaN: true }), wobA: fc.double({ min: 0, max: 3, noNaN: true }), wobF: fc.double({ min: 0, max: 3, noNaN: true }), accel: fc.double({ min: 0, max: 10, noNaN: true }) }),
      fc.record({ type: fc.constant('loop' as const), x0: fc.double({ min: -20, max: 20, noNaN: true }), y0: fc.double({ min: 30, max: 45, noNaN: true }), speed: fc.double({ min: 5, max: 25, noNaN: true }), yLoop: fc.double({ min: 0, max: 20, noNaN: true }), r: fc.double({ min: 3, max: 9, noNaN: true }), dir: fc.constantFrom(1 as const, -1 as const) }),
      fc.record({ type: fc.constant('hover' as const), x0: fc.double({ min: -20, max: 20, noNaN: true }), y0: fc.double({ min: 30, max: 45, noNaN: true }), yStop: fc.double({ min: 10, max: 25, noNaN: true }), inT: fc.double({ min: 1, max: 4, noNaN: true }), hold: fc.double({ min: 0, max: 8, noNaN: true }), swayA: fc.double({ min: 0, max: 6, noNaN: true }), swayF: fc.double({ min: 0.2, max: 2, noNaN: true }), exitVy: fc.double({ min: -20, max: -2, noNaN: true }) }),
      fc.tuple(fc.array(fc.tuple(fc.double({ min: -40, max: 40, noNaN: true }), fc.double({ min: -40, max: 40, noNaN: true })), { minLength: 4, maxLength: 4 }), fc.double({ min: 2, max: 8, noNaN: true }))
        .map(([p, dur]) => ({ type: 'bezier' as const, p: p as [number, number][], dur })),
    );
    fc.assert(fc.property(pat, (p: Pattern) => {
      const a = { x: 0, y: 0 }, b = { x: 0, y: 0 };
      const h = 0.01;
      let maxStep = 0;
      for (let t = 0; t < 12; t += h) {
        patternPos(p, t, 0, a);
        patternPos(p, t + h, 0, b);
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
        maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.y - a.y));
      }
      // No teleport: one 10 ms step never covers more than a fast aircraft would (generous bound).
      expect(maxStep).toBeLessThan(2.5);
    }), fcParams(150));
  });
});

describe('freshCarry', () => {
  it('starts with the configured lives, rolls and the aircraft\'s hull', () => {
    const c = freshCarry('f6f', 'easy');
    expect(c.lives).toBe(PACIFIC.player.lives);
    expect(c.rolls).toBe(PACIFIC.player.startRolls);
    expect(c.hp).toBe(maxHpOf('f6f', 'easy'));
    expect(c.score).toBe(0);
  });
});
