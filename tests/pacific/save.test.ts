/**
 * Saved progress: defaults, validation of anything read back (fuzz), storage that throws, and the
 * level-finish bookkeeping (best score, high score, unlocking the next battle).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LEVEL_COUNT } from '../../src/pacific/levels';
import { SAVE_KEY, defaultSave, loadSave, recordLevel, sanitize, writeSave } from '../../src/pacific/save';
import { fcParams } from '../support/fc';

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('save', () => {
  it('starts at level 1 with the P-38 on Normal', () => {
    const d = defaultSave();
    expect(d.unlocked).toBe(0);
    expect(d.plane).toBe('p38');
    expect(d.difficulty).toBe('normal');
    expect(d.best).toHaveLength(LEVEL_COUNT);
  });

  it('round-trips through storage', () => {
    const st = memory();
    const d = { ...defaultSave(), hiScore: 4242, unlocked: 3, plane: 'f4u' as const, muted: true };
    expect(writeSave(st, d)).toBe(true);
    expect(loadSave(st)).toEqual(sanitize(d));
    expect(st.getItem(SAVE_KEY)).toContain('4242');
  });

  it('no storage, throwing storage or corrupt JSON fall back to defaults', () => {
    expect(loadSave(null)).toEqual(defaultSave());
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadSave(bad)).toEqual(defaultSave());
    expect(writeSave(bad, defaultSave())).toBe(false);
    const st = memory();
    st.setItem(SAVE_KEY, '{not json');
    expect(loadSave(st)).toEqual(defaultSave());
  });

  it('finishing a level records its best, the high score, and unlocks the next one (never past the last)', () => {
    let d = defaultSave();
    d = recordLevel(d, 0, 5000, 5000);
    expect(d.unlocked).toBe(1);
    expect(d.best[0]).toBe(5000);
    expect(d.hiScore).toBe(5000);
    d = recordLevel(d, 0, 4000, 3000);
    expect(d.best[0]).toBe(5000);
    d = recordLevel(d, LEVEL_COUNT - 1, 99999, 20000);
    expect(d.unlocked).toBe(LEVEL_COUNT - 1);
  });

  it('anything at all sanitises into a valid save (fuzz)', () => {
    fc.assert(fc.property(fc.anything(), (raw) => {
      const s = sanitize(raw);
      expect(s.unlocked >= 0 && s.unlocked < LEVEL_COUNT).toBe(true);
      expect(s.best).toHaveLength(LEVEL_COUNT);
      for (const b of s.best) expect(Number.isFinite(b) && b >= 0).toBe(true);
      expect(['p38', 'f6f', 'f4u']).toContain(s.plane);
      expect(['easy', 'normal', 'hard']).toContain(s.difficulty);
      expect(Number.isFinite(s.hiScore) && s.hiScore >= 0).toBe(true);
    }), fcParams(300));
  });
});
