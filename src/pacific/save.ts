/**
 * What the arcade game remembers between visits (in localStorage): the high score, the furthest
 * level reached, the best score of each level, and the player's choices (aircraft, difficulty,
 * sound, auto-fire). Every value read back is validated, so a corrupt or hand-edited save can only
 * fall back to defaults, never break the game; storage that throws (private mode) is ignored.
 */
import { LEVEL_COUNT } from './levels';
import type { Difficulty, PlaneId } from './types';

export const SAVE_KEY = 'pacific1942.save.v1';

export interface SaveData {
  hiScore: number;
  /** Highest level index the player may start from (0-based). */
  unlocked: number;
  best: number[];
  plane: PlaneId;
  difficulty: Difficulty;
  muted: boolean;
  music: boolean;
  autoFire: boolean;
  victories: number;
}

export function defaultSave(): SaveData {
  return {
    hiScore: 0, unlocked: 0, best: Array(LEVEL_COUNT).fill(0), plane: 'p38', difficulty: 'normal', muted: false, music: true, autoFire: false, victories: 0,
  };
}

const PLANES: PlaneId[] = ['p38', 'f6f', 'f4u'];
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d);

/** Validate anything into a SaveData. */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const best = Array.isArray(r.best) ? r.best : [];
  return {
    hiScore: num(r.hiScore, 0, 1e10, 0),
    unlocked: num(r.unlocked, 0, LEVEL_COUNT - 1, 0),
    best: d.best.map((_, i) => num(best[i], 0, 1e10, 0)),
    plane: PLANES.includes(r.plane as PlaneId) ? (r.plane as PlaneId) : d.plane,
    difficulty: DIFFS.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : d.difficulty,
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    music: typeof r.music === 'boolean' ? r.music : d.music,
    autoFire: typeof r.autoFire === 'boolean' ? r.autoFire : d.autoFire,
    victories: num(r.victories, 0, 1e6, 0),
  };
}

export function loadSave(storage: Pick<Storage, 'getItem'> | null): SaveData {
  try {
    const s = storage?.getItem(SAVE_KEY);
    return sanitize(s ? JSON.parse(s) : null);
  } catch {
    return defaultSave();
  }
}

export function writeSave(storage: Pick<Storage, 'setItem'> | null, data: SaveData): boolean {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(sanitize(data)));
    return !!storage;
  } catch {
    return false;
  }
}

/** Record a finished level: best score, high score, and unlock the next one. */
export function recordLevel(data: SaveData, level: number, score: number, levelScore: number): SaveData {
  const out = sanitize(data);
  out.best[level] = Math.max(out.best[level] ?? 0, Math.floor(levelScore));
  out.hiScore = Math.max(out.hiScore, Math.floor(score));
  out.unlocked = Math.max(out.unlocked, Math.min(LEVEL_COUNT - 1, level + 1));
  return out;
}
