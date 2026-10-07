/**
 * Every tunable number of "Pacific 1942" — the Bắn Máy Bay arcade shooter (pacific.html). One
 * object, grouped by the module that owns each section, like src/config.ts is for the simulator.
 * The game is a separate page with its own config so neither can disturb the other.
 *
 * Units: the playfield is a flat rectangle in "field units" (u) seen from above, x right and y up
 * the screen (the direction of flight). Speeds are u/s, times seconds, angles radians.
 */
import type { Difficulty, PlaneId } from './types';

export interface PlaneStats {
  /** Display name and a one-line Vietnamese description for the hangar screen. */
  name: string;
  nick: string;
  blurb: string;
  /** Movement speed, u/s. */
  speed: number;
  /** Hull points at Normal difficulty. */
  hp: number;
  /** Damage of one bullet. */
  damage: number;
  /** Seconds between volleys. */
  fireInterval: number;
  /** Spread multiplier for the angled streams (< 1 = concentrated nose guns). */
  spread: number;
}

export interface DifficultyStats {
  label: string;
  /** Multiplies enemy bullet speed. */
  bulletSpeed: number;
  /** Multiplies enemy rate of fire. */
  fireRate: number;
  /** Multiplies enemy and boss hit points. */
  enemyHp: number;
  /** Added to the aircraft's hull points. */
  playerHp: number;
  /** Multiplies the score. */
  score: number;
}

export const PACIFIC = {
  /** The simulation runs at a fixed step (src/pacific/main.ts accumulates real time). */
  sim: { dt: 1 / 120, maxStepsPerFrame: 12 },

  /** The playfield the player may fly in; enemies spawn just outside it. */
  field: { halfW: 26, halfH: 34, spawnMargin: 6, despawnMargin: 12 },

  /** Ground speed of the sea under the aircraft, u/s (scenery, ships and gun sites move with it). */
  scroll: { speed: 8, bossFactor: 0.3, ease: 0.6 },

  player: {
    radius: 0.75,
    /** A collision with an aircraft: damage to the player and to the enemy. */
    rammed: 1,
    ramDamage: 8,
    startY: -22,
    lives: 3,
    maxLives: 9,
    invulnAfterHit: 1.4,
    invulnRespawn: 3,
    respawnDelay: 2,
    rollTime: 1.1,
    rollCooldown: 0.35,
    startRolls: 3,
    maxRolls: 5,
    maxWeapon: 5,
    /** Bank angle at full sideways speed (visual only). */
    maxBank: 0.6,
    introTime: 2.5,
  },

  planes: {
    p38: {
      name: 'P-38 Lightning', nick: 'Tia chớp', speed: 27, hp: 3, damage: 1.25, fireInterval: 0.095, spread: 0.65,
      blurb: 'Hai động cơ, bốn súng máy và pháo 20 mm tập trung ở mũi: hỏa lực dồn một luồng, bay ổn định.',
    },
    f6f: {
      name: 'F6F Hellcat', nick: 'Mèo địa ngục', speed: 25, hp: 4, damage: 1, fireInterval: 0.1, spread: 1,
      blurb: 'Bọc giáp dày, sáu khẩu .50 trên cánh: chịu đòn tốt nhất, luồng đạn tỏa rộng.',
    },
    f4u: {
      name: 'F4U Corsair', nick: 'Cướp biển', speed: 31, hp: 3, damage: 1, fireInterval: 0.085, spread: 0.9,
      blurb: 'Cánh mòng biển gập, nhanh nhất mặt trận: né đạn dễ, bắn liên thanh nhanh.',
    },
  } satisfies Record<PlaneId, PlaneStats>,

  difficulty: {
    easy: { label: 'Dễ', bulletSpeed: 0.8, fireRate: 0.65, enemyHp: 0.8, playerHp: 2, score: 0.5 },
    normal: { label: 'Thường', bulletSpeed: 1, fireRate: 1, enemyHp: 1, playerHp: 0, score: 1 },
    hard: { label: 'Khó', bulletSpeed: 1.2, fireRate: 1.4, enemyHp: 1.25, playerHp: -1, score: 2 },
  } satisfies Record<Difficulty, DifficultyStats>,

  /**
   * Player weapon levels 1–5: each stream is [x offset u, angle rad]. The angle is scaled by the
   * aircraft's spread.
   */
  weapon: {
    bulletSpeed: 95,
    radius: 0.5,
    streams: [
      [[-0.45, 0], [0.45, 0]],
      [[-0.45, 0], [0.45, 0], [-0.9, -0.07], [0.9, 0.07]],
      [[-0.5, 0], [0, 0], [0.5, 0], [-0.9, -0.1], [0.9, 0.1]],
      [[-0.75, 0], [-0.25, 0], [0.25, 0], [0.75, 0], [-1, -0.11], [1, 0.11], [-1.1, -0.22], [1.1, 0.22]],
      [[-0.9, 0], [-0.45, 0], [0, 0], [0.45, 0], [0.9, 0], [-1, -0.12], [1, 0.12], [-1.1, -0.24], [1.1, 0.24], [-1.2, -0.36], [1.2, 0.36]],
    ] as [number, number][][],
  },

  /** Escort fighters ("W" pick-up): fly off the wings, fire straight ahead, absorb one hit each. */
  wingman: { dx: 5.6, dy: -2.6, radius: 0.8, fireInterval: 0.14, max: 2 },

  enemy: {
    bulletSpeed: 19,
    bulletRadius: 0.38,
    /** Per level (0-based): enemy rate of fire × (1 + level × fireGrowth). */
    fireGrowth: 0.05,
    speedGrowth: 0.025,
    hpGrowth: 0.06,
    /** No shot is fired closer than this to the player (no point-blank cheap shots). */
    minShotRange: 5,
    flashTime: 0.08,
    maxAge: 45,
  },

  pickup: { radius: 1.8, fallSpeed: 3.2, sway: 4, life: 14, medalBase: 1000 },

  score: {
    chainWindow: 1.3,
    /** Multiplier = 1 + floor(chain / chainStep) × chainGain, capped. */
    chainStep: 4,
    chainGain: 0.5,
    chainMax: 4,
    noDamageBonus: 20000,
    rollBonus: 2000,
    accuracyBonus: 30000,
    bossTimeBonus: 300,
    maxPowerBonus: 2000,
    extraLifeEvery: 80000,
  },

  boss: { warning: 3, escapeAfter: 110, dyingTime: 3.2, clearDelay: 3.5 },

  caps: { playerBullets: 220, enemyBullets: 450, enemies: 90, pickups: 12, decor: 40 },
};

export type PacificConfig = typeof PACIFIC;

/** A deep copy for tests that tweak values without touching the real config. */
export function clonePacific(): PacificConfig {
  return structuredClone(PACIFIC);
}
