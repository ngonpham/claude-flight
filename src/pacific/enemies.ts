/**
 * The enemy catalogue: every Japanese aircraft, ship and gun site the waves are built from, with
 * its hit points, hit circle, score, gun and the facts shown in the game's field guide.
 * Hit points are for Normal difficulty at level 1; the simulation scales them per level.
 */
import type { EnemyKind, GunDef } from './types';

export type EnemyRole = 'fighter' | 'bomber' | 'diver' | 'suicide' | 'ship' | 'ground';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  /** Allied reporting name (aircraft) or class. */
  nick: string;
  role: EnemyRole;
  hp: number;
  radius: number;
  score: number;
  /** Surface units move with the sea, are not rammed and sink rather than fall. */
  surface: boolean;
  /** Base speed for the wave builders, u/s. */
  speed: number;
  gun: GunDef | null;
  /** Chance (0–1) to drop a pick-up when killed outside a formation bonus. */
  dropChance: number;
  /** Renderer scale of the model. */
  size: number;
  /** Long hulls: hit circles along the heading (dy forward from the centre), replacing `radius`. */
  hull?: { dy: number; r: number }[];
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  zero: {
    kind: 'zero', name: 'Mitsubishi A6M Zero', nick: 'Zeke', role: 'fighter', hp: 2, radius: 1.65, score: 100, surface: false,
    speed: 17, gun: { type: 'aimed', interval: 2.6, delay: 0.8 }, dropChance: 0, size: 1,
  },
  oscar: {
    kind: 'oscar', name: 'Nakajima Ki-43 Hayabusa', nick: 'Oscar', role: 'fighter', hp: 2, radius: 1.6, score: 120, surface: false,
    speed: 18, gun: { type: 'burst', interval: 3.2, count: 2, gap: 0.18, delay: 1 }, dropChance: 0, size: 0.95,
  },
  val: {
    kind: 'val', name: 'Aichi D3A', nick: 'Val', role: 'diver', hp: 4, radius: 1.85, score: 200, surface: false,
    speed: 15, gun: { type: 'spread', interval: 2.4, count: 3, arc: 0.5, delay: 0.6 }, dropChance: 0.04, size: 1.05,
  },
  kate: {
    kind: 'kate', name: 'Nakajima B5N', nick: 'Kate', role: 'bomber', hp: 6, radius: 2, score: 250, surface: false,
    speed: 11, gun: { type: 'down', interval: 1.8, count: 2, arc: 0.35, delay: 0.5 }, dropChance: 0.06, size: 1.15,
  },
  betty: {
    kind: 'betty', name: 'Mitsubishi G4M', nick: 'Betty', role: 'bomber', hp: 26, radius: 3.4, score: 1000, surface: false,
    speed: 8, gun: { type: 'spread', interval: 1.6, count: 5, arc: 0.9, delay: 1 }, dropChance: 0.35, size: 1.9,
  },
  frank: {
    kind: 'frank', name: 'Nakajima Ki-84 Hayate', nick: 'Frank', role: 'fighter', hp: 4, radius: 1.65, score: 300, surface: false,
    speed: 22, gun: { type: 'burst', interval: 2.4, count: 3, gap: 0.12, delay: 0.6 }, dropChance: 0.02, size: 1.05,
  },
  george: {
    kind: 'george', name: 'Kawanishi N1K2-J Shiden-Kai', nick: 'George', role: 'fighter', hp: 5, radius: 1.7, score: 350, surface: false,
    speed: 21, gun: { type: 'spread', interval: 2.2, count: 3, arc: 0.3, delay: 0.6 }, dropChance: 0.03, size: 1.08,
  },
  kamikaze: {
    kind: 'kamikaze', name: 'A6M5 Zero (Tokkōtai)', nick: 'Kamikaze', role: 'suicide', hp: 3, radius: 1.65, score: 300, surface: false,
    speed: 20, gun: null, dropChance: 0.03, size: 1,
  },
  ohka: {
    kind: 'ohka', name: 'Yokosuka MXY-7 Ōka', nick: 'Baka', role: 'suicide', hp: 2, radius: 1.2, score: 500, surface: false,
    speed: 34, gun: null, dropChance: 0.05, size: 0.8,
  },
  destroyer: {
    kind: 'destroyer', name: 'Khu trục hạm lớp Fubuki', nick: 'Fubuki', role: 'ship', hp: 34, radius: 1.6, score: 1500, surface: true,
    speed: 2.5, gun: { type: 'burst', interval: 2, count: 3, gap: 0.15, delay: 0.8 }, dropChance: 0.5, size: 1,
    hull: [{ dy: -4.2, r: 1 }, { dy: -2.1, r: 1.2 }, { dy: 0, r: 1.25 }, { dy: 2.1, r: 1.2 }, { dy: 4.2, r: 0.9 }],
  },
  cruiser: {
    kind: 'cruiser', name: 'Tuần dương hạm lớp Mogami', nick: 'Mogami', role: 'ship', hp: 70, radius: 2.1, score: 3000, surface: true,
    speed: 2, gun: { type: 'spread', interval: 1.8, count: 5, arc: 0.8, delay: 0.8, style: 1 }, dropChance: 0.8, size: 1,
    hull: [{ dy: -6, r: 1.2 }, { dy: -3.4, r: 1.6 }, { dy: -0.8, r: 1.7 }, { dy: 1.8, r: 1.7 }, { dy: 4.4, r: 1.5 }, { dy: 6.6, r: 1.1 }],
  },
  barge: {
    kind: 'barge', name: 'Xuồng đổ bộ Daihatsu', nick: 'Daihatsu', role: 'ship', hp: 8, radius: 1.2, score: 300, surface: true,
    speed: 3, gun: { type: 'aimed', interval: 3, delay: 1 }, dropChance: 0.05, size: 1,
    hull: [{ dy: -0.6, r: 0.75 }, { dy: 0.6, r: 0.75 }],
  },
  aaGun: {
    kind: 'aaGun', name: 'Ụ pháo phòng không Kiểu 96', nick: 'Type 96', role: 'ground', hp: 10, radius: 1.2, score: 400, surface: true,
    speed: 0, gun: { type: 'burst', interval: 2.3, count: 3, gap: 0.14, delay: 0.5 }, dropChance: 0.08, size: 1,
  },
};

export const ENEMY_KINDS = Object.keys(ENEMIES) as EnemyKind[];
