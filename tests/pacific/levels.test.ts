/**
 * The ten levels and their data: the Pacific War in order, every level complete (briefing,
 * objective, fact, look, roster, formations, scenery, boss), and the enemy and boss catalogues
 * consistent with them.
 */
import { describe, expect, it } from 'vitest';
import { BOSSES, BOSS_KINDS } from '../../src/pacific/bosses';
import { ENEMIES, ENEMY_KINDS } from '../../src/pacific/enemies';
import { EPILOGUE, LEVELS, LEVEL_COUNT } from '../../src/pacific/levels';
import { bossExtent } from '../../src/pacific/sim/game';
import { PACIFIC } from '../../src/pacific/config';

describe('the campaign', () => {
  it('has ten levels, indexed in order, each with its own key, seed and boss', () => {
    expect(LEVEL_COUNT).toBe(10);
    LEVELS.forEach((l, i) => expect(l.index).toBe(i));
    expect(new Set(LEVELS.map((l) => l.key)).size).toBe(10);
    expect(new Set(LEVELS.map((l) => l.seed)).size).toBe(10);
    expect(new Set(LEVELS.map((l) => l.boss)).size).toBe(10);
    expect([...LEVELS.map((l) => l.boss)].sort()).toEqual([...BOSS_KINDS].sort());
  });

  it('follows the war in chronological order, Pearl Harbor (Dec 1941) to Okinawa (Apr 1945)', () => {
    const when = LEVELS.map((l) => l.year * 12 + l.month);
    for (let i = 1; i < when.length; i++) expect(when[i]).toBeGreaterThanOrEqual(when[i - 1]);
    expect(LEVELS[0].key).toBe('pearl');
    expect(LEVELS[0].date).toBe('7/12/1941');
    expect(LEVELS[9].boss).toBe('yamato');
    expect(LEVELS[9].date).toBe('7/4/1945');
    // The date string agrees with year and month.
    for (const l of LEVELS) {
      const [, m, y] = l.date.split('/').map(Number);
      expect(y, l.key).toBe(l.year);
      expect(m, l.key).toBe(l.month);
    }
  });

  it('every level has a Vietnamese briefing, objective, fact and boss intel', () => {
    for (const l of LEVELS) {
      for (const text of [l.title, l.place, l.brief, l.objective, l.fact, l.bossIntel]) {
        expect(text.trim().length, l.key).toBeGreaterThan(3);
      }
      expect(l.brief.length, l.key).toBeGreaterThan(120);
      // Vietnamese: carries its diacritics.
      expect(l.brief, l.key).toMatch(/[ạảãàáâầấậẩẫăằắặẳẵêềếệểễôồốộổỗơờớợởỡưừứựửữđ]/i);
    }
    expect(EPILOGUE).toMatch(/2\/9\/1945/);
    expect(EPILOGUE).toMatch(/Missouri/);
  });

  it('every level looks plausible: colours are 24-bit, the sun is above the horizon, fog and exposure are sane', () => {
    for (const l of LEVELS) {
      const e = l.env;
      for (const c of [e.sunColor, e.skyColor, e.groundColor, e.fogColor, e.seaDeep, e.seaShallow, e.cloudColor]) {
        expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff, l.key).toBe(true);
      }
      expect(e.sun[1], l.key).toBeGreaterThan(0.2);
      expect(e.fog).toBeGreaterThan(0);
      expect(e.fog).toBeLessThan(0.02);
      expect(e.exposure).toBeGreaterThan(0.5);
      expect(e.exposure).toBeLessThan(2);
      for (const v of [e.cloudsLow, e.cloudsHigh, e.rain]) expect(v >= 0 && v <= 1, l.key).toBe(true);
    }
    // Guadalcanal is the night battle, Leyte the squall.
    expect(LEVELS[4].env.sunIntensity).toBeLessThan(1.5);
    expect(LEVELS[7].env.rain).toBeGreaterThan(0);
  });

  it('rosters name real enemy kinds of the right role; difficulty rises through the war', () => {
    for (const l of LEVELS) {
      expect(l.roster.fighter.length, l.key).toBeGreaterThan(0);
      for (const k of l.roster.fighter) expect(ENEMIES[k].role).toBe('fighter');
      for (const k of l.roster.bomber) expect(ENEMIES[k].role).toBe('bomber');
      for (const k of l.roster.diver) expect(ENEMIES[k].role).toBe('diver');
      for (const k of l.roster.suicide) expect(ENEMIES[k].role).toBe('suicide');
      for (const p of l.setPieces) {
        expect(p.t).toBeGreaterThan(0);
        expect(p.t).toBeLessThan(l.duration);
      }
      expect(Object.values(l.formations).some((w) => (w ?? 0) > 0)).toBe(true);
    }
    // Kamikaze only from Leyte (Oct 1944), the first organised attacks.
    for (const l of LEVELS) expect(l.roster.suicide.length > 0, l.key).toBe(l.year * 12 + l.month >= 1944 * 12 + 10);
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i].gap).toBeLessThanOrEqual(LEVELS[i - 1].gap + 1e-9);
    expect(LEVELS[9].duration).toBeGreaterThan(LEVELS[0].duration);
  });

  it('scenery specials use known decor kinds and stay near the playfield', () => {
    for (const l of LEVELS) {
      expect(l.scenery.every).toBeGreaterThan(20);
      for (const s of l.scenery.specials) expect(Math.abs(s.x), `${l.key} ${s.kind}`).toBeLessThan(PACIFIC.field.halfW + 10);
    }
  });
});

describe('enemy and boss catalogues', () => {
  it('every enemy has positive hit points, a hit circle and a score; ships have hull circles', () => {
    for (const k of ENEMY_KINDS) {
      const d = ENEMIES[k];
      expect(d.kind).toBe(k);
      expect(d.hp).toBeGreaterThan(0);
      expect(d.radius).toBeGreaterThan(0.5);
      expect(d.score).toBeGreaterThan(0);
      if (d.role === 'ship') expect(d.hull?.length, k).toBeGreaterThan(1);
      if (d.gun) expect(d.gun.interval).toBeGreaterThan(0.3);
    }
  });

  it('every boss has three phases of guns, parts with guns for each phase, and fits in the playfield', () => {
    for (const k of BOSS_KINDS) {
      const b = BOSSES[k];
      expect(b.kind).toBe(k);
      expect(b.guns).toHaveLength(3);
      expect(b.hull.length).toBeGreaterThan(0);
      expect(b.parts.length).toBeGreaterThan(3);
      expect(new Set(b.parts.map((p) => p.id)).size).toBe(b.parts.length);
      for (const p of b.parts) {
        expect(p.guns, `${k}.${p.id}`).toHaveLength(3);
        expect(p.hp).toBeGreaterThan(0);
        for (const g of p.guns.flat()) expect(g.interval).toBeGreaterThan(0.05);
      }
      // Settled, it leaves the player the bottom of the screen.
      const reach = bossExtent(k);
      expect(b.holdY - reach, k).toBeGreaterThan(-PACIFIC.field.halfH + 12);
      expect(b.holdY, k).toBeLessThan(PACIFIC.field.halfH - 10);
      expect(b.hp).toBeGreaterThan(300);
    }
    // Bosses get tougher through the war.
    expect(BOSSES.yamato.hp).toBeGreaterThan(BOSSES.fuchida.hp * 3);
  });

  it('carrier bosses launch aircraft from their flight decks; air bosses fly with escorts or turrets', () => {
    for (const k of ['shoho', 'akagi'] as const) expect(BOSSES[k].parts.some((p) => p.look === 'deck' && p.guns.flat().some((g) => g.type === 'spawn'))).toBe(true);
    for (const k of ['fuchida', 'yamamoto'] as const) expect(BOSSES[k].parts.filter((p) => p.look === 'escort').length).toBeGreaterThanOrEqual(4);
    // Yamamoto's G4M was escorted by six Zeros.
    expect(BOSSES.yamamoto.parts.filter((p) => p.look === 'escort')).toHaveLength(6);
    expect(BOSSES.emily.parts.filter((p) => p.look === 'engine')).toHaveLength(4);
  });
});
