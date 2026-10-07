/**
 * An autopilot that plays the game through the same `Input` a person gives: it keeps the guns on
 * the nearest target, slides away from bullets it is about to fly into, picks up what drops, and
 * rolls when a hit is unavoidable. The tests use it to play whole levels; the title screen uses it
 * for the attract-mode demo. Pure: it only reads the state.
 */
import { PACIFIC, type PacificConfig } from '../config';
import { ENEMIES } from '../enemies';
import type { GameState, Input } from '../types';

export interface BotOpts {
  /** How far ahead (s) it looks for incoming bullets. */
  look?: number;
  /** Seek pick-ups. */
  greedy?: boolean;
}

/** One input for the current state. */
export function botInput(s: GameState, o: BotOpts = {}, cfg: PacificConfig = PACIFIC): Input {
  const p = s.player;
  const f = cfg.field;
  const look = o.look ?? 0.7;
  if (!p.alive) return { x: 0, y: 0, target: null, fire: false, roll: false };

  // 1. Where it wants to be: under the most pressing target, in the lower part of the screen.
  let tx = 0;
  let best = Infinity;
  const homeY = -f.halfH * 0.55;
  for (const e of s.enemies) {
    if (!e.alive || Math.abs(e.x) > f.halfW || e.y > f.halfH || e.y < p.y + 3) continue;
    const def = ENEMIES[e.kind];
    // Prefer low (close) threats and anything about to leave; ships count less (they shoot back).
    const score = (e.y - p.y) * (def.surface ? 1.4 : 1) - (def.role === 'suicide' ? 25 : 0);
    if (score < best) {
      best = score;
      tx = e.x + e.vx * 0.15;
    }
  }
  const b = s.boss;
  if (b && (b.stage === 'fight' || b.stage === 'enter')) {
    const part = b.parts.find((pt) => pt.alive && pt.def.look !== 'escort' && Math.abs(pt.x) < f.halfW && pt.y < f.halfH - 2);
    if (best === Infinity || best > 20) tx = part ? part.x : b.x;
  }
  let ty = homeY;
  if (o.greedy !== false) {
    for (const k of s.pickups) {
      if (k.alive && k.y < f.halfH - 6 && Math.abs(k.x - p.x) < 22) {
        tx = k.x;
        ty = Math.max(homeY - 4, Math.min(k.y, -4));
        break;
      }
    }
  }
  // Keep clear of kamikaze and big aircraft passing close.
  let ax = (tx - p.x) * 0.35;
  let ay = (ty - p.y) * 0.25;

  // 2. Dodge: push away from bullets (and aircraft) that will pass close within `look` s.
  let danger = 0;
  let soonest = Infinity;
  const consider = (x: number, y: number, vx: number, vy: number, r: number) => {
    const rx = x - p.x, ry = y - p.y;
    if (rx * rx + ry * ry > 18 * 18) return;
    const rvx = vx - p.vx * 0.3, rvy = vy - p.vy * 0.3;
    const v2 = rvx * rvx + rvy * rvy;
    let tc = v2 > 1e-6 ? -(rx * rvx + ry * rvy) / v2 : 0;
    if (tc < 0) tc = 0;
    if (tc > look) return;
    const cx = rx + rvx * tc, cy = ry + rvy * tc;
    const miss = Math.hypot(cx, cy);
    const need = r + cfg.player.radius + 1.6;
    if (miss > need) return;
    const w = (need - miss + 0.5) / (tc + 0.15);
    // Slide sideways, away from the closest-approach point (or across the bullet's path).
    let nx = -cx, ny = -cy;
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-3) {
      nx = -rvy;
      ny = rvx;
    }
    const l = Math.hypot(nx, ny) || 1;
    ax += (nx / l) * w * 6;
    ay += (ny / l) * w * 3;
    danger += w;
    if (miss < r + cfg.player.radius) soonest = Math.min(soonest, tc);
  };
  for (const eb of s.eBullets) if (eb.alive) consider(eb.x, eb.y, eb.vx, eb.vy, eb.r);
  for (const e of s.enemies) {
    if (!e.alive || ENEMIES[e.kind].surface) continue;
    consider(e.x, e.y, e.vx, e.vy, ENEMIES[e.kind].radius);
  }
  // Walls: don't get pinned against the edges.
  if (p.x > f.halfW - 5) ax -= 3;
  if (p.x < -f.halfW + 5) ax += 3;
  if (p.y < -f.halfH + 5) ay += 3;

  const m = Math.hypot(ax, ay);
  const x = m > 1 ? ax / m : ax;
  const y = m > 1 ? ay / m : ay;
  const roll = soonest < 0.12 && p.roll === 0 && p.invuln === 0 && p.rolls > 0;
  return { x, y, target: null, fire: true, roll };
}
