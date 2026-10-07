/**
 * The game simulation: `createGame()` sets up a level, `stepGame(state, input, dt)` advances it by
 * one fixed step. Deterministic (all randomness comes from the seed kept in the state), and free of
 * three.js, the DOM and the clock, so whole levels can be played in a unit test.
 *
 * Unlike the flight model's `step()`, this one updates the state it is given in place: a level has
 * hundreds of bullets, and copying them 120 times a second would be waste. The state is still plain
 * data — `structuredClone` copies it — and nothing else writes to it.
 *
 * A level runs: intro (the player flies in) → waves (the schedule) → warning → boss → clear (bonus,
 * the player flies off; `done` turns true). Losing the last life ends in 'gameover'. What happened
 * is pushed to `state.events` (shots, hits, kills, pick-ups…) for the renderer, the sound and the
 * HUD to drain.
 */
import { BOSSES } from '../bosses';
import { PACIFIC, type PacificConfig } from '../config';
import { ENEMIES } from '../enemies';
import { LEVELS } from '../levels';
import type {
  Boss, BossPart, Bullet, Carry, Difficulty, Enemy, EnemyKind, GameEvent, GameState, GunDef, GunTimer, Input, Pattern,
  PickupKind, PlaneId, SpawnEvent,
} from '../types';
import { patternPos, type Pos } from './patterns';
import { mulberry } from './rng';
import { buildDecor, buildSchedule } from './waves';

export interface NewGame {
  level: number;
  difficulty: Difficulty;
  plane: PlaneId;
  seed?: number;
  carry?: Carry;
  god?: boolean;
}

export const NO_INPUT: Input = { x: 0, y: 0, target: null, fire: false, roll: false };

const MAX_EVENTS = 4000;
/** Fraction of a destroyed boss part's hit points that also comes off the boss itself. */
export const PART_TO_CORE = 0.3;

/** A uniform random number from the state's generator. */
export function rand(s: GameState): number {
  const [v, n] = mulberry(s.rng);
  s.rng = n;
  return v;
}

function emit(s: GameState, e: GameEvent): void {
  if (s.events.length >= MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS + 1);
  s.events.push(e);
}

/** The starting carry: a fresh pilot. */
export function freshCarry(plane: PlaneId, difficulty: Difficulty, cfg: PacificConfig = PACIFIC): Carry {
  return {
    score: 0, lives: cfg.player.lives, hp: maxHpOf(plane, difficulty, cfg), weapon: 1, wingmen: 0, rolls: cfg.player.startRolls,
    nextExtraLife: cfg.score.extraLifeEvery,
  };
}

/** A pilot joining the campaign at `level` (level select, or a retry): guns upgraded to suit it. */
export function startCarry(plane: PlaneId, difficulty: Difficulty, level: number, cfg: PacificConfig = PACIFIC): Carry {
  const c = freshCarry(plane, difficulty, cfg);
  c.weapon = Math.min(cfg.player.maxWeapon - 1, 1 + Math.floor(Math.max(0, level) / 2.5));
  return c;
}

export function maxHpOf(plane: PlaneId, difficulty: Difficulty, cfg: PacificConfig = PACIFIC): number {
  return Math.max(1, cfg.planes[plane].hp + cfg.difficulty[difficulty].playerHp);
}

/** What carries into the next level from a finished one. */
export function carryOf(s: GameState): Carry {
  const p = s.player;
  return {
    score: s.score, lives: p.lives, hp: p.alive ? p.hp : p.maxHp, weapon: p.weapon, wingmen: p.wingmen, rolls: p.rolls, nextExtraLife: s.nextExtraLife,
  };
}

export function createGame(o: NewGame, cfg: PacificConfig = PACIFIC): GameState {
  const level = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, o.level))];
  const seed = (o.seed ?? level.seed) >>> 0;
  const carry = o.carry ?? freshCarry(o.plane, o.difficulty, cfg);
  const maxHp = maxHpOf(o.plane, o.difficulty, cfg);
  const s: GameState = {
    level: level.index, difficulty: o.difficulty, seed, rng: (seed * 2654435761) >>> 0,
    phase: 'intro', phaseT: 0, t: 0, clock: 0, scroll: 0, scrollSpeed: cfg.scroll.speed,
    player: {
      plane: o.plane, x: 0, y: -cfg.field.halfH - 6, vx: 0, vy: 0, hp: Math.min(maxHp, Math.max(1, carry.hp)), maxHp,
      lives: carry.lives, rolls: carry.rolls, roll: 0, rollCd: 0, invuln: 0, weapon: carry.weapon, wingmen: carry.wingmen,
      fireT: 0, wingFireT: 0, alive: true, respawnT: 0, bank: 0, flash: 0,
    },
    pBullets: [], eBullets: [], enemies: [], pickups: [], decor: [], boss: null,
    schedule: buildSchedule(level, seed, cfg), nextSpawn: 0, decorSchedule: buildDecor(level, seed, cfg), nextDecor: 0,
    groups: {}, score: carry.score, nextExtraLife: carry.nextExtraLife, chain: 0, chainT: 0,
    stats: { shots: 0, hits: 0, kills: 0, spawned: 0, damageTaken: 0, rollsUsed: 0, bossTime: 0, bossKilled: false },
    bonus: [], events: [], nextId: 1, god: !!o.god, done: false,
  };
  spawnDecor(s, cfg);
  return s;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

const diffOf = (s: GameState, cfg: PacificConfig) => cfg.difficulty[s.difficulty];

/** Heading (0 = up the screen, clockwise positive) from a direction. */
export function headingOf(dx: number, dy: number): number {
  return Math.atan2(dx, dy);
}

function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/** Boss frame offset → playfield. */
export function bossOffset(heading: number, dx: number, dy: number, out: Pos): Pos {
  const fx = Math.sin(heading), fy = Math.cos(heading);
  // Right of the heading: (cos h, −sin h).
  out.x = dx * Math.cos(heading) + dy * fx;
  out.y = -dx * Math.sin(heading) + dy * fy;
  return out;
}

/** How far a boss reaches from its centre (for its entry point). */
export function bossExtent(kind: keyof typeof BOSSES): number {
  const d = BOSSES[kind];
  let e = 0;
  for (const h of d.hull) e = Math.max(e, Math.hypot(h.dx, h.dy) + h.r);
  for (const p of d.parts) e = Math.max(e, p.orbit ? p.orbit.r + p.r : Math.hypot(p.dx, p.dy) + p.r);
  return e;
}

function newTimer(delay: number): GunTimer {
  return { fireT: delay, burstLeft: 0, burstT: 0, spiral: 0 };
}

function onScreen(cfg: PacificConfig, x: number, y: number, margin = 0): boolean {
  return Math.abs(x) < cfg.field.halfW + margin && y > -cfg.field.halfH - margin && y < cfg.field.halfH + margin;
}

function chainMult(s: GameState, cfg: PacificConfig): number {
  return Math.min(cfg.score.chainMax, 1 + Math.floor(s.chain / cfg.score.chainStep) * cfg.score.chainGain);
}

function addScore(s: GameState, pts: number, cfg: PacificConfig): number {
  const p = Math.round(pts);
  s.score += p;
  while (s.score >= s.nextExtraLife) {
    s.nextExtraLife += cfg.score.extraLifeEvery;
    if (s.player.lives < cfg.player.maxLives) {
      s.player.lives++;
      emit(s, { type: 'extraLife', x: s.player.x, y: s.player.y });
    }
  }
  return p;
}

// ── spawning ─────────────────────────────────────────────────────────────────────────────────────

function spawnDecor(s: GameState, cfg: PacificConfig): void {
  const top = cfg.field.halfH + 25;
  while (s.nextDecor < s.decorSchedule.length) {
    const d = s.decorSchedule[s.nextDecor];
    const y = d.at + top - s.scroll;
    if (y > cfg.field.halfH + 70) break;
    s.nextDecor++;
    if (s.decor.length >= cfg.caps.decor) continue;
    s.decor.push({ id: s.nextId++, kind: d.kind, x: d.x, y, scale: d.scale, rot: d.rot, seed: d.seed });
  }
}

function clonePattern(p: Pattern): Pattern {
  return p.type === 'bezier' ? { ...p, p: p.p.map((q) => [q[0], q[1]] as [number, number]) } : { ...p };
}

/** Put one enemy in the air (or on the sea). Returns null when the cap is reached. */
export function spawnEnemy(s: GameState, e: SpawnEvent, cfg: PacificConfig = PACIFIC): Enemy | null {
  const def = ENEMIES[e.kind];
  if (s.enemies.length >= cfg.caps.enemies) {
    if (e.group) {
      const g = s.groups[e.group];
      if (g) g.left--;
    }
    return null;
  }
  const pattern = clonePattern(e.pattern);
  if (e.aim && pattern.type === 'line') {
    const speed = Math.hypot(pattern.vx, pattern.vy);
    const dx = s.player.x - pattern.x0, dy = s.player.y - pattern.y0;
    const d = Math.hypot(dx, dy) || 1;
    pattern.vx = (dx / d) * speed;
    pattern.vy = (dy / d) * speed;
  }
  const p0 = patternPos(pattern, 0, 0, { x: 0, y: 0 });
  const p1 = patternPos(pattern, 0.05, 0.05 * s.scrollSpeed, { x: 0, y: 0 });
  let heading = pattern.type === 'home' ? pattern.heading : headingOf(p1.x - p0.x, p1.y - p0.y);
  if (pattern.type === 'ground') heading = e.kind === 'aaGun' ? 0 : headingOf(pattern.vx, pattern.vy || -1);
  const hp = def.hp * diffOf(s, cfg).enemyHp * (1 + s.level * cfg.enemy.hpGrowth);
  const en: Enemy = {
    id: s.nextId++, kind: e.kind, x: p0.x, y: p0.y, vx: 0, vy: 0, heading, turnRate: 0, age: 0, hp, maxHp: hp, pattern, scroll0: s.scroll,
    fireT: (def.gun?.delay ?? 0.5) + rand(s) * (def.gun?.interval ?? 1) * 0.6, burstLeft: 0, burstT: 0, spiral: rand(s) * 6.28,
    group: e.group, drop: e.drop, flash: 0, entered: false, alive: true,
  };
  if (e.group) {
    const g = (s.groups[e.group] ??= { total: 0, left: 0, killed: 0, drop: e.drop });
    g.total++;
    g.left++;
  }
  if (e.decor && s.decor.length < cfg.caps.decor) {
    s.decor.push({ id: s.nextId++, kind: e.decor.kind, x: p0.x + e.decor.dx, y: p0.y + e.decor.dy, scale: e.decor.scale, rot: rand(s) * 6.28, seed: (rand(s) * 1e9) | 0 });
  }
  s.enemies.push(en);
  s.stats.spawned++;
  return en;
}

export function spawnBoss(s: GameState, cfg: PacificConfig = PACIFIC): Boss {
  const def = BOSSES[LEVELS[s.level].boss];
  const hp = def.hp * diffOf(s, cfg).enemyHp;
  const parts: BossPart[] = def.parts.map((p) => ({
    def: p, hp: p.hp * diffOf(s, cfg).enemyHp, alive: true, timers: p.guns[0].map((g) => newTimer(g.delay ?? 1 + rand(s))), flash: 0, x: 0, y: 0, aim: 0,
  }));
  const b: Boss = {
    def, x: 0, y: cfg.field.halfH + bossExtent(def.kind) + 2, hp, maxHp: hp, t: 0, stage: 'enter', stageT: 0, phase: 0, parts,
    timers: def.guns[0].map((g) => newTimer(g.delay ?? 1.5)), flash: 0, fightT: 0,
  };
  s.boss = b;
  placeParts(s, b);
  emit(s, { type: 'bossIn', x: b.x, y: b.y, kind: def.kind });
  return b;
}

// ── guns ─────────────────────────────────────────────────────────────────────────────────────────

function enemyBullet(s: GameState, x: number, y: number, ang: number, speed: number, style: number, cfg: PacificConfig): void {
  if (s.eBullets.length >= cfg.caps.enemyBullets) return;
  s.eBullets.push({
    x, y, vx: Math.sin(ang) * speed, vy: Math.cos(ang) * speed, r: style ? cfg.enemy.bulletRadius * 1.6 : cfg.enemy.bulletRadius, dmg: 1, style, alive: true,
  });
}

/**
 * Run one gun for one step: count down, fire its pattern from (x, y). `facing` is the shooter's
 * heading (for 'down' guns). Returns true if it fired.
 */
function runGun(s: GameState, g: GunDef, tm: GunTimer, x: number, y: number, facing: number, dt: number, cfg: PacificConfig): boolean {
  const d = diffOf(s, cfg);
  const rate = d.fireRate * (1 + s.level * cfg.enemy.fireGrowth);
  const speed = cfg.enemy.bulletSpeed * (g.speed ?? 1) * d.bulletSpeed * (1 + s.level * 0.02);
  const style = g.style ?? 0;
  const p = s.player;
  const aim = headingOf(p.x - x, p.y - y);
  let fired = false;
  if (tm.burstLeft > 0) {
    tm.burstT -= dt;
    if (tm.burstT <= 0) {
      enemyBullet(s, x, y, aim, speed, style, cfg);
      tm.burstLeft--;
      tm.burstT = g.gap ?? 0.13;
      fired = true;
    }
  }
  tm.fireT -= dt * rate;
  if (tm.fireT > 0) return fired;
  tm.fireT = Math.max(tm.fireT + g.interval, g.interval * 0.25);
  const n = Math.max(1, g.count ?? 1);
  switch (g.type) {
    case 'aimed':
      enemyBullet(s, x, y, aim, speed, style, cfg);
      break;
    case 'spread':
    case 'down': {
      const c = g.type === 'down' ? facing : aim;
      const arc = g.arc ?? 0.5;
      for (let i = 0; i < n; i++) enemyBullet(s, x, y, c + (n === 1 ? 0 : -arc / 2 + (arc * i) / (n - 1)), speed, style, cfg);
      break;
    }
    case 'ring':
      for (let i = 0; i < n; i++) enemyBullet(s, x, y, tm.spiral + (i / n) * Math.PI * 2, speed * 0.85, style, cfg);
      tm.spiral += 0.19;
      break;
    case 'spiral':
      for (let i = 0; i < n; i++) enemyBullet(s, x, y, tm.spiral + (i / n) * Math.PI * 2, speed * 0.8, style, cfg);
      tm.spiral += g.twist ?? 0.3;
      break;
    case 'burst':
      enemyBullet(s, x, y, aim, speed, style, cfg);
      tm.burstLeft = n - 1;
      tm.burstT = g.gap ?? 0.13;
      break;
    case 'spawn': {
      const kind: EnemyKind = g.spawn ?? 'zero';
      const v = ENEMIES[kind].speed * (1 + s.level * cfg.enemy.speedGrowth);
      const vx = (rand(s) - 0.5) * 6;
      spawnEnemy(s, { t: s.t, kind, group: 0, drop: null, pattern: { type: 'line', x0: x, y0: y, vx, vy: -v * 0.9, wobA: 1.5, wobF: 1.6 } }, cfg);
      emit(s, { type: 'launch', x, y, kind });
      return true;
    }
  }
  emit(s, { type: 'enemyShot', x, y, n: style });
  return true;
}

// ── the player ───────────────────────────────────────────────────────────────────────────────────

function firePlayer(s: GameState, cfg: PacificConfig): void {
  const p = s.player;
  const plane = cfg.planes[p.plane];
  const streams = cfg.weapon.streams[Math.max(0, Math.min(cfg.weapon.streams.length - 1, p.weapon - 1))];
  for (const [ox, a0] of streams) {
    if (s.pBullets.length >= cfg.caps.playerBullets) break;
    const a = a0 * plane.spread;
    s.pBullets.push({ x: p.x + ox, y: p.y + 1.6, vx: Math.sin(a) * cfg.weapon.bulletSpeed, vy: Math.cos(a) * cfg.weapon.bulletSpeed, r: cfg.weapon.radius, dmg: plane.damage, style: 0, alive: true });
    s.stats.shots++;
  }
  emit(s, { type: 'shot', x: p.x, y: p.y, n: streams.length });
}

function fireWingmen(s: GameState, cfg: PacificConfig): void {
  const p = s.player;
  for (let i = 0; i < p.wingmen; i++) {
    if (s.pBullets.length >= cfg.caps.playerBullets) break;
    const side = i === 0 ? -1 : 1;
    s.pBullets.push({ x: p.x + side * cfg.wingman.dx, y: p.y + cfg.wingman.dy + 1, vx: 0, vy: cfg.weapon.bulletSpeed, r: cfg.weapon.radius, dmg: cfg.planes[p.plane].damage * 0.8, style: 1, alive: true });
  }
}

/** Wingman positions (for drawing and hits). */
export function wingmanPos(s: GameState, i: number, cfg: PacificConfig = PACIFIC): Pos {
  const side = i === 0 ? -1 : 1;
  return { x: s.player.x + side * cfg.wingman.dx, y: s.player.y + cfg.wingman.dy };
}

function updatePlayer(s: GameState, input: Input, dt: number, cfg: PacificConfig): void {
  const p = s.player;
  const f = cfg.field;
  p.flash = Math.max(0, p.flash - dt);
  if (!p.alive) {
    if (p.lives > 0 && s.phase !== 'gameover') {
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        p.alive = true;
        p.hp = p.maxHp;
        p.x = 0;
        p.y = cfg.player.startY;
        p.vx = p.vy = 0;
        p.invuln = cfg.player.invulnRespawn;
        p.rolls = Math.max(p.rolls, cfg.player.startRolls);
        emit(s, { type: 'respawn', x: p.x, y: p.y });
      }
    }
    return;
  }
  p.invuln = Math.max(0, p.invuln - dt);
  p.rollCd = Math.max(0, p.rollCd - dt);
  if (p.roll > 0) {
    p.roll = Math.max(0, p.roll - dt);
    if (p.roll === 0) p.rollCd = cfg.player.rollCooldown;
  }

  const speed = cfg.planes[p.plane].speed;
  let vx = 0, vy = 0;
  if (s.phase === 'intro') {
    vy = Math.min(speed, (cfg.player.startY - p.y) * 2.5);
  } else if (s.phase === 'clear' && s.phaseT > cfg.boss.clearDelay) {
    vy = Math.min(40, (s.phaseT - cfg.boss.clearDelay) * 30);
    vx = -p.x * 0.8;
  } else if (input.target) {
    const dx = input.target.x - p.x, dy = input.target.y - p.y;
    const d = Math.hypot(dx, dy);
    const v = Math.min(speed, d * 12);
    if (d > 1e-6) {
      vx = (dx / d) * v;
      vy = (dy / d) * v;
    }
  } else {
    let ix = Number.isFinite(input.x) ? input.x : 0, iy = Number.isFinite(input.y) ? input.y : 0;
    const m = Math.hypot(ix, iy);
    if (m > 1) {
      ix /= m;
      iy /= m;
    }
    vx = ix * speed;
    vy = iy * speed;
  }
  p.vx = vx;
  p.vy = vy;
  p.x += vx * dt;
  p.y += vy * dt;
  const freeFlight = s.phase === 'intro' || (s.phase === 'clear' && s.phaseT > cfg.boss.clearDelay);
  if (!freeFlight) {
    p.x = Math.max(-f.halfW + 1.5, Math.min(f.halfW - 1.5, p.x));
    p.y = Math.max(-f.halfH + 2.5, Math.min(f.halfH - 5, p.y));
  }
  const bankTarget = Math.max(-1, Math.min(1, vx / speed));
  p.bank += (bankTarget - p.bank) * Math.min(1, dt * 8);

  const canAct = s.phase === 'waves' || s.phase === 'warning' || s.phase === 'boss';
  if (canAct && input.roll && p.rolls > 0 && p.roll === 0 && p.rollCd === 0) {
    p.roll = cfg.player.rollTime;
    p.rolls--;
    s.stats.rollsUsed++;
    emit(s, { type: 'roll', x: p.x, y: p.y });
  }
  p.fireT = Math.max(0, p.fireT - dt);
  p.wingFireT = Math.max(0, p.wingFireT - dt);
  if (canAct && input.fire && p.roll === 0) {
    if (p.fireT === 0) {
      firePlayer(s, cfg);
      p.fireT = cfg.planes[p.plane].fireInterval;
    }
    if (p.wingmen > 0 && p.wingFireT === 0) {
      fireWingmen(s, cfg);
      p.wingFireT = cfg.wingman.fireInterval;
    }
  }
}

/** The player takes `dmg` hits (ignored while invulnerable, rolling, or in god mode). */
export function hurtPlayer(s: GameState, dmg: number, cfg: PacificConfig = PACIFIC): boolean {
  const p = s.player;
  if (!p.alive || p.invuln > 0 || p.roll > 0 || s.god || s.phase === 'clear' || s.phase === 'intro') return false;
  p.hp -= dmg;
  p.flash = 0.25;
  s.stats.damageTaken += dmg;
  s.chain = 0;
  if (p.hp > 0) {
    p.invuln = cfg.player.invulnAfterHit;
    emit(s, { type: 'playerHit', x: p.x, y: p.y, n: p.hp });
    return true;
  }
  p.alive = false;
  p.lives--;
  p.respawnT = cfg.player.respawnDelay;
  p.weapon = Math.max(1, p.weapon - 1);
  p.wingmen = 0;
  p.roll = 0;
  emit(s, { type: 'playerDown', x: p.x, y: p.y });
  if (p.lives <= 0) {
    s.phase = 'gameover';
    s.phaseT = 0;
    emit(s, { type: 'gameover', x: p.x, y: p.y });
  }
  return true;
}

// ── enemies ──────────────────────────────────────────────────────────────────────────────────────

const pos: Pos = { x: 0, y: 0 };

function updateEnemies(s: GameState, dt: number, cfg: PacificConfig): void {
  const f = cfg.field;
  const p = s.player;
  const firing = p.alive && (s.phase === 'waves' || s.phase === 'warning' || s.phase === 'boss');
  for (const e of s.enemies) {
    if (!e.alive) continue;
    const def = ENEMIES[e.kind];
    e.age += dt;
    e.flash = Math.max(0, e.flash - dt);
    const px = e.x, py = e.y;
    const pt = e.pattern;
    if (pt.type === 'home') {
      if (e.age < pt.commit && p.alive) {
        const want = headingOf(p.x - e.x, p.y - e.y);
        const diff = wrapAngle(want - e.heading);
        const turn = Math.max(-pt.turn * dt, Math.min(pt.turn * dt, diff));
        e.heading = wrapAngle(e.heading + turn);
        e.turnRate = turn / dt;
      } else e.turnRate *= 0.9;
      const v = pt.speed * (e.age < pt.commit ? 1 : 1.5);
      e.x += Math.sin(e.heading) * v * dt;
      e.y += Math.cos(e.heading) * v * dt;
    } else {
      patternPos(pt, e.age, s.scroll - e.scroll0, pos);
      e.x = pos.x;
      e.y = pos.y;
    }
    e.vx = (e.x - px) / dt;
    e.vy = (e.y - py) / dt;
    if (!def.surface && pt.type !== 'home') {
      const sp2 = e.vx * e.vx + e.vy * e.vy;
      if (sp2 > 0.25) {
        const want = headingOf(e.vx, e.vy);
        const diff = wrapAngle(want - e.heading);
        e.turnRate += (diff / dt - e.turnRate) * Math.min(1, dt * 6);
        e.heading = want;
      }
    }
    if (!e.entered && onScreen(cfg, e.x, e.y, -1)) e.entered = true;
    const m = f.despawnMargin;
    const gone = Math.abs(e.x) > f.halfW + m || e.y < -f.halfH - m || e.y > f.halfH + m + 14;
    if ((gone && e.age > 1 && (e.entered || e.age > 14)) || e.age > cfg.enemy.maxAge) {
      e.alive = false;
      if (e.group && s.groups[e.group]) s.groups[e.group].left--;
      continue;
    }
    if (firing && def.gun && onScreen(cfg, e.x, e.y, -1) && Math.hypot(p.x - e.x, p.y - e.y) > cfg.enemy.minShotRange) {
      runGun(s, def.gun, e, e.x, e.y, e.heading, dt, cfg);
    }
  }
}

/** Does a circle at (x, y) radius r touch enemy e? Long hulls test each hull circle. */
export function hitsEnemy(e: Enemy, x: number, y: number, r: number): boolean {
  const def = ENEMIES[e.kind];
  if (!def.hull) {
    const rr = def.radius + r;
    const dx = x - e.x, dy = y - e.y;
    return dx * dx + dy * dy < rr * rr;
  }
  const fx = Math.sin(e.heading), fy = Math.cos(e.heading);
  for (const h of def.hull) {
    const cx = e.x + fx * h.dy, cy = e.y + fy * h.dy;
    const rr = h.r + r;
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

function rollDrop(s: GameState): PickupKind {
  const p = s.player;
  const r = rand(s);
  if (p.weapon < 5 && r < 0.45) return 'pow';
  if (p.wingmen < 2 && r < 0.6) return 'wing';
  if (p.hp < p.maxHp && r < 0.75) return 'repair';
  if (r < 0.88) return 'roll';
  return 'medal';
}

function dropPickup(s: GameState, kind: PickupKind, x: number, y: number, cfg: PacificConfig): void {
  if (s.pickups.length >= cfg.caps.pickups) return;
  const cx = Math.max(-cfg.field.halfW + 4, Math.min(cfg.field.halfW - 4, x));
  const cy = Math.min(cfg.field.halfH - 2, y);
  s.pickups.push({ id: s.nextId++, kind, x: cx, y: cy, x0: cx, age: 0, alive: true });
  emit(s, { type: 'drop', x: cx, y: cy, kind });
}

function killEnemy(s: GameState, e: Enemy, cfg: PacificConfig): void {
  const def = ENEMIES[e.kind];
  e.alive = false;
  s.chain++;
  s.chainT = cfg.score.chainWindow;
  const pts = addScore(s, def.score * diffOf(s, cfg).score * chainMult(s, cfg), cfg);
  s.stats.kills++;
  emit(s, { type: 'kill', x: e.x, y: e.y, kind: e.kind, id: e.id, n: pts, heading: e.heading, surface: def.surface });
  if (s.chain > 0 && s.chain % cfg.score.chainStep === 0) emit(s, { type: 'chain', x: e.x, y: e.y, n: s.chain });
  if (e.group && s.groups[e.group]) {
    const g = s.groups[e.group];
    g.left--;
    g.killed++;
    if (g.left <= 0 && g.killed === g.total && g.drop) dropPickup(s, g.drop, e.x, e.y, cfg);
  } else if (e.drop) dropPickup(s, e.drop, e.x, e.y, cfg);
  else if (def.dropChance > 0 && rand(s) < def.dropChance) dropPickup(s, rollDrop(s), e.x, e.y, cfg);
}

// ── the boss ─────────────────────────────────────────────────────────────────────────────────────

function placeParts(s: GameState, b: Boss): void {
  const h = b.def.heading;
  for (const pt of b.parts) {
    if (pt.def.orbit) {
      const a = Math.atan2(pt.def.dy, pt.def.dx) + pt.def.orbit.w * b.t;
      pt.x = b.x + Math.cos(a) * pt.def.orbit.r;
      pt.y = b.y + Math.sin(a) * pt.def.orbit.r;
    } else {
      bossOffset(h, pt.def.dx, pt.def.dy, pos);
      pt.x = b.x + pos.x;
      pt.y = b.y + pos.y;
    }
    pt.aim = headingOf(s.player.x - pt.x, s.player.y - pt.y);
  }
}

function setBossPhase(s: GameState, b: Boss, phase: 0 | 1 | 2): void {
  b.phase = phase;
  b.timers = b.def.guns[phase].map((g) => newTimer(g.delay ?? 0.8 + rand(s) * 0.6));
  for (const pt of b.parts) pt.timers = pt.def.guns[phase].map((g) => newTimer(g.delay ?? 0.6 + rand(s) * 1.2));
}

function updateBoss(s: GameState, dt: number, cfg: PacificConfig): void {
  const b = s.boss;
  if (!b) return;
  const d = b.def;
  b.stageT += dt;
  b.flash = Math.max(0, b.flash - dt);
  for (const pt of b.parts) pt.flash = Math.max(0, pt.flash - dt);
  switch (b.stage) {
    case 'enter': {
      const gap = b.y - d.holdY;
      b.y -= Math.max(5, gap * 0.9) * dt;
      if (b.y <= d.holdY) {
        b.y = d.holdY;
        b.stage = 'fight';
        b.stageT = 0;
      }
      break;
    }
    case 'fight': {
      b.t += dt;
      b.fightT += dt;
      s.stats.bossTime = b.fightT;
      const ramp = Math.min(1, b.t / 3);
      b.x = d.swayX * Math.sin(d.swayW * b.t) * ramp;
      b.y = d.holdY + d.swayY * Math.sin(2 * d.swayW * b.t) * ramp;
      const frac = b.hp / b.maxHp;
      const phase: 0 | 1 | 2 = frac > 2 / 3 ? 0 : frac > 1 / 3 ? 1 : 2;
      if (phase !== b.phase) setBossPhase(s, b, phase);
      if (b.fightT > cfg.boss.escapeAfter) {
        b.stage = 'escape';
        b.stageT = 0;
        emit(s, { type: 'bossEscape', x: b.x, y: b.y, kind: d.kind });
      }
      break;
    }
    case 'escape':
      b.y += (d.surface ? 6 : 14) * dt;
      if (b.y > cfg.field.halfH + bossExtent(d.kind) + 4) b.stage = 'gone';
      break;
    case 'dying':
      if (d.surface) b.y -= s.scrollSpeed * dt * 0.3;
      else {
        b.y -= 5 * dt;
        b.x += Math.sin(b.stageT * 2) * 3 * dt;
      }
      if (b.stageT > cfg.boss.dyingTime) b.stage = 'gone';
      break;
    case 'gone':
      break;
  }
  placeParts(s, b);
  const p = s.player;
  if ((b.stage === 'fight' || b.stage === 'enter') && p.alive && s.phase === 'boss') {
    const active = b.stage === 'fight';
    if (active) {
      d.guns[b.phase].forEach((g, i) => {
        const tm = b.timers[i];
        if (tm) runGun(s, g, tm, b.x, b.y, d.heading, dt, cfg);
      });
    }
    for (const pt of b.parts) {
      if (!pt.alive || !onScreen(cfg, pt.x, pt.y, -1)) continue;
      if (!active && !pt.def.orbit) continue;
      pt.def.guns[b.phase].forEach((g, i) => {
        const tm = pt.timers[i];
        if (tm) runGun(s, g, tm, pt.x, pt.y, pt.aim, dt, cfg);
      });
    }
  }
}

function killBoss(s: GameState, b: Boss, cfg: PacificConfig): void {
  b.stage = 'dying';
  b.stageT = 0;
  s.stats.bossKilled = true;
  const pts = addScore(s, b.def.score * diffOf(s, cfg).score, cfg);
  emit(s, { type: 'bossDown', x: b.x, y: b.y, kind: b.def.kind, n: pts, surface: b.def.surface });
  for (const pt of b.parts) {
    if (pt.alive) {
      pt.alive = false;
      emit(s, { type: 'partKill', x: pt.x, y: pt.y, kind: pt.def.look, n: 0, surface: b.def.surface && pt.def.look !== 'escort' });
    }
  }
  // Every enemy bullet on screen fizzles out: the classic reward for the kill.
  for (const eb of s.eBullets) eb.alive = false;
}

/** Bullet vs boss: parts first, then the hull. Returns true when it struck something. */
function hitBoss(s: GameState, b: Boss, bl: Bullet, cfg: PacificConfig): boolean {
  if (b.stage !== 'fight' && b.stage !== 'enter') return false;
  for (const pt of b.parts) {
    if (!pt.alive) continue;
    const rr = pt.def.r + bl.r;
    const dx = bl.x - pt.x, dy = bl.y - pt.y;
    if (dx * dx + dy * dy < rr * rr) {
      pt.hp -= bl.dmg;
      pt.flash = cfg.enemy.flashTime;
      if (pt.hp <= 0) {
        pt.alive = false;
        s.chain++;
        s.chainT = cfg.score.chainWindow;
        const pts = addScore(s, pt.def.score * diffOf(s, cfg).score * chainMult(s, cfg), cfg);
        emit(s, { type: 'partKill', x: pt.x, y: pt.y, kind: pt.def.look, n: pts, surface: b.def.surface && pt.def.look !== 'escort' });
        // A destroyed mount shakes the whole ship: part of its strength comes off the core.
        if (b.stage === 'fight') {
          b.hp -= pt.def.hp * diffOf(s, cfg).enemyHp * PART_TO_CORE;
          b.flash = cfg.enemy.flashTime;
          if (b.hp <= 0) killBoss(s, b, cfg);
        }
        if (pt.def.look !== 'escort' || rand(s) < 0.35) dropPickup(s, pt.def.look === 'escort' ? rollDrop(s) : 'medal', pt.x, pt.y, cfg);
      }
      return true;
    }
  }
  for (const h of b.def.hull) {
    bossOffset(b.def.heading, h.dx, h.dy, pos);
    const cx = b.x + pos.x, cy = b.y + pos.y;
    const rr = h.r + bl.r;
    const dx = bl.x - cx, dy = bl.y - cy;
    if (dx * dx + dy * dy < rr * rr) {
      if (b.stage === 'fight') {
        b.hp -= bl.dmg;
        b.flash = cfg.enemy.flashTime;
        if (b.hp <= 0) killBoss(s, b, cfg);
      }
      return true;
    }
  }
  return false;
}

/** Does a circle touch the boss hull (aircraft bosses ram the player)? */
function touchesBoss(b: Boss, x: number, y: number, r: number): boolean {
  for (const h of b.def.hull) {
    bossOffset(b.def.heading, h.dx, h.dy, pos);
    const rr = h.r * 0.8 + r;
    const dx = x - (b.x + pos.x), dy = y - (b.y + pos.y);
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

// ── collisions, pick-ups, bookkeeping ────────────────────────────────────────────────────────────

function moveBullets(list: Bullet[], dt: number, cfg: PacificConfig): void {
  const f = cfg.field;
  for (const b of list) {
    if (!b.alive) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (Math.abs(b.x) > f.halfW + 6 || b.y > f.halfH + 6 || b.y < -f.halfH - 6) b.alive = false;
  }
}

function collide(s: GameState, cfg: PacificConfig): void {
  const p = s.player;
  for (const bl of s.pBullets) {
    if (!bl.alive) continue;
    for (const e of s.enemies) {
      if (!e.alive || !hitsEnemy(e, bl.x, bl.y, bl.r)) continue;
      bl.alive = false;
      s.stats.hits++;
      e.hp -= bl.dmg;
      e.flash = cfg.enemy.flashTime;
      emit(s, { type: 'hit', x: bl.x, y: bl.y, kind: e.kind, surface: ENEMIES[e.kind].surface });
      if (e.hp <= 0) killEnemy(s, e, cfg);
      break;
    }
    if (bl.alive && s.boss && hitBoss(s, s.boss, bl, cfg)) {
      bl.alive = false;
      s.stats.hits++;
      emit(s, { type: 'hit', x: bl.x, y: bl.y, kind: 'boss', surface: s.boss.def.surface });
    }
  }
  if (!p.alive) return;
  const pr = cfg.player.radius;
  const shielded = p.invuln > 0 || p.roll > 0;
  for (const bl of s.eBullets) {
    if (!bl.alive) continue;
    const dx = bl.x - p.x, dy = bl.y - p.y;
    const rr = bl.r + pr;
    if (dx * dx + dy * dy < rr * rr && !shielded && !s.god) {
      bl.alive = false;
      hurtPlayer(s, bl.dmg, cfg);
      if (!p.alive) return;
      continue;
    }
    if (!shielded) {
      for (let i = 0; i < p.wingmen; i++) {
        const w = wingmanPos(s, i, cfg);
        const wr = bl.r + cfg.wingman.radius;
        if ((bl.x - w.x) ** 2 + (bl.y - w.y) ** 2 < wr * wr) {
          bl.alive = false;
          p.wingmen--;
          emit(s, { type: 'wingmanDown', x: w.x, y: w.y });
          break;
        }
      }
    }
  }
  if (p.roll > 0) return;
  for (const e of s.enemies) {
    if (!e.alive || ENEMIES[e.kind].surface) continue;
    if (!hitsEnemy(e, p.x, p.y, pr * 0.9)) continue;
    if (p.invuln > 0 || s.god) continue;
    e.hp -= cfg.player.ramDamage;
    e.flash = cfg.enemy.flashTime;
    if (e.hp <= 0 || e.kind === 'kamikaze' || e.kind === 'ohka') killEnemy(s, e, cfg);
    hurtPlayer(s, cfg.player.rammed, cfg);
    if (!p.alive) return;
  }
  const b = s.boss;
  if (b && !b.def.surface && (b.stage === 'fight' || b.stage === 'enter') && !s.god && p.invuln === 0 && touchesBoss(b, p.x, p.y, pr)) {
    hurtPlayer(s, cfg.player.rammed, cfg);
  }
}

function applyPickup(s: GameState, kind: PickupKind, cfg: PacificConfig): number {
  const p = s.player;
  const d = diffOf(s, cfg);
  switch (kind) {
    case 'pow':
      if (p.weapon < cfg.player.maxWeapon) {
        p.weapon++;
        return 0;
      }
      return addScore(s, cfg.score.maxPowerBonus * d.score, cfg);
    case 'wing':
      if (p.wingmen < cfg.wingman.max) {
        p.wingmen = cfg.wingman.max;
        return 0;
      }
      return addScore(s, 1000 * d.score, cfg);
    case 'roll':
      if (p.rolls < cfg.player.maxRolls) {
        p.rolls++;
        return 0;
      }
      return addScore(s, 1000 * d.score, cfg);
    case 'repair':
      if (p.hp < p.maxHp) {
        p.hp++;
        return 0;
      }
      return addScore(s, 1000 * d.score, cfg);
    case 'medal':
      return addScore(s, cfg.pickup.medalBase * (s.level + 1) * d.score, cfg);
  }
}

function updatePickups(s: GameState, dt: number, cfg: PacificConfig): void {
  const p = s.player;
  for (const k of s.pickups) {
    if (!k.alive) continue;
    k.age += dt;
    k.y -= cfg.pickup.fallSpeed * dt;
    k.x = k.x0 + Math.sin(k.age * 1.3) * cfg.pickup.sway * Math.min(1, k.age);
    if (k.age > cfg.pickup.life || k.y < -cfg.field.halfH - 4) {
      k.alive = false;
      continue;
    }
    if (p.alive && (k.x - p.x) ** 2 + (k.y - p.y) ** 2 < (cfg.pickup.radius + cfg.player.radius) ** 2) {
      k.alive = false;
      const pts = applyPickup(s, k.kind, cfg);
      emit(s, { type: 'pickup', x: k.x, y: k.y, kind: k.kind, n: pts });
    }
  }
}

function compact<T extends { alive: boolean }>(list: T[]): void {
  let j = 0;
  for (let i = 0; i < list.length; i++) if (list[i].alive) list[j++] = list[i];
  list.length = j;
}

function tallyBonus(s: GameState, cfg: PacificConfig): void {
  const d = diffOf(s, cfg);
  const st = s.stats;
  const add = (label: string, pts: number) => {
    const v = Math.round(pts * d.score);
    if (v > 0) {
      s.bonus.push({ label, points: v });
      addScore(s, v, cfg);
    }
  };
  if (st.bossKilled) add('Hạ boss nhanh', cfg.score.bossTimeBonus * Math.max(0, cfg.boss.escapeAfter - st.bossTime));
  if (st.damageTaken === 0) add('Không trúng đạn', cfg.score.noDamageBonus);
  const acc = st.shots ? st.hits / st.shots : 0;
  add(`Độ chính xác ${Math.round(acc * 100)}%`, cfg.score.accuracyBonus * acc * acc);
  add('Vòng lộn còn lại', cfg.score.rollBonus * s.player.rolls);
}

/** Advance the game by `dt` seconds (use the fixed `PACIFIC.sim.dt`). */
export function stepGame(s: GameState, input: Input, dt: number, cfg: PacificConfig = PACIFIC): GameState {
  if (s.done) return s;
  const level = LEVELS[s.level];
  s.clock += dt;
  s.phaseT += dt;

  const bossStop = s.boss && s.boss.def.surface && (s.boss.stage === 'fight' || s.boss.stage === 'enter' || s.boss.stage === 'dying');
  const target = cfg.scroll.speed * (bossStop ? cfg.scroll.bossFactor : 1);
  s.scrollSpeed += (target - s.scrollSpeed) * Math.min(1, dt * cfg.scroll.ease);
  const ds = s.scrollSpeed * dt;
  s.scroll += ds;
  for (const d of s.decor) d.y -= ds;
  s.decor = s.decor.filter((d) => d.y > -cfg.field.halfH - 70);
  spawnDecor(s, cfg);

  switch (s.phase) {
    case 'intro':
      if (s.phaseT >= cfg.player.introTime) {
        s.phase = 'waves';
        s.phaseT = 0;
      }
      break;
    case 'waves': {
      s.t += dt;
      while (s.nextSpawn < s.schedule.length && s.schedule[s.nextSpawn].t <= s.t) spawnEnemy(s, s.schedule[s.nextSpawn++], cfg);
      const airLeft = s.enemies.some((e) => e.alive && !ENEMIES[e.kind].surface);
      if (s.nextSpawn >= s.schedule.length && s.t > level.duration && (!airLeft || s.t > level.duration + 10)) {
        s.phase = 'warning';
        s.phaseT = 0;
        emit(s, { type: 'warning', x: 0, y: 0, kind: level.boss });
      }
      break;
    }
    case 'warning':
      s.t += dt;
      if (s.phaseT >= cfg.boss.warning) {
        s.phase = 'boss';
        s.phaseT = 0;
        spawnBoss(s, cfg);
      }
      break;
    case 'boss':
      s.t += dt;
      if (s.boss && s.boss.stage === 'gone') {
        s.phase = 'clear';
        s.phaseT = 0;
        for (const eb of s.eBullets) eb.alive = false;
        tallyBonus(s, cfg);
        emit(s, { type: 'clear', x: 0, y: 0, n: s.stats.bossKilled ? 1 : 0 });
      }
      break;
    case 'clear':
      if (s.phaseT > cfg.boss.clearDelay && s.player.alive && s.player.y > cfg.field.halfH + 8) s.done = true;
      if (!s.player.alive && s.player.lives > 0 && s.phaseT > cfg.boss.clearDelay + 4) s.done = true;
      break;
    case 'gameover':
      break;
  }

  updatePlayer(s, input, dt, cfg);
  moveBullets(s.pBullets, dt, cfg);
  moveBullets(s.eBullets, dt, cfg);
  updateEnemies(s, dt, cfg);
  updateBoss(s, dt, cfg);
  // Bullets still land while the level winds down; hurtPlayer() keeps the player safe then.
  collide(s, cfg);
  updatePickups(s, dt, cfg);
  if (s.chainT > 0) {
    s.chainT -= dt;
    if (s.chainT <= 0) s.chain = 0;
  }
  compact(s.pBullets);
  compact(s.eBullets);
  compact(s.enemies);
  compact(s.pickups);
  return s;
}

/** Score multiplier shown on the HUD. */
export function scoreMultiplier(s: GameState, cfg: PacificConfig = PACIFIC): number {
  return chainMult(s, cfg);
}
