/**
 * Enemy movement: where a pattern puts an enemy at a given age. Every pattern is a closed form of
 * the age (so a wave replays exactly and the tests can sample any instant) except 'home', which
 * the step integrates. Ground patterns also take how far the sea has scrolled since the spawn.
 */
import type { Pattern } from '../types';

export interface Pos {
  x: number;
  y: number;
}

/** Cubic Bézier and its derivative at s ∈ [0, 1]. */
function bez(p: [number, number][], s: number, out: Pos, d = false): Pos {
  const u = 1 - s;
  if (!d) {
    const a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, e = s * s * s;
    out.x = a * p[0][0] + b * p[1][0] + c * p[2][0] + e * p[3][0];
    out.y = a * p[0][1] + b * p[1][1] + c * p[2][1] + e * p[3][1];
  } else {
    const a = 3 * u * u, b = 6 * u * s, c = 3 * s * s;
    out.x = a * (p[1][0] - p[0][0]) + b * (p[2][0] - p[1][0]) + c * (p[3][0] - p[2][0]);
    out.y = a * (p[1][1] - p[0][1]) + b * (p[2][1] - p[1][1]) + c * (p[3][1] - p[2][1]);
  }
  return out;
}

const tmp: Pos = { x: 0, y: 0 };

/**
 * Position at `age` seconds. `scrolled` = how far the sea has moved since the spawn (ground
 * patterns ride on it). 'home' returns its start point (the step integrates it).
 */
export function patternPos(p: Pattern, age: number, scrolled: number, out: Pos): Pos {
  switch (p.type) {
    case 'line': {
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const along = p.accel ? 0.5 * p.accel * age * age : 0;
      out.x = p.x0 + p.vx * age + (p.vx / sp) * along;
      out.y = p.y0 + p.vy * age + (p.vy / sp) * along;
      if (p.wobA) {
        const w = p.wobA * Math.sin((p.wobF ?? 1) * age);
        // Perpendicular to the path (to its right).
        out.x += (p.vy / sp) * w;
        out.y += (-p.vx / sp) * w;
      }
      return out;
    }
    case 'bezier': {
      if (age <= p.dur) return bez(p.p, age / p.dur, out);
      const d = bez(p.p, 1, tmp, true);
      const over = age - p.dur;
      out.x = p.p[3][0] + (d.x / p.dur) * over;
      out.y = p.p[3][1] + (d.y / p.dur) * over;
      return out;
    }
    case 'loop': {
      const t1 = Math.max(0, (p.y0 - p.yLoop) / p.speed);
      if (age <= t1) {
        out.x = p.x0;
        out.y = p.y0 - p.speed * age;
        return out;
      }
      const w = p.speed / p.r;
      const tLoop = (2 * Math.PI) / w;
      if (age <= t1 + tLoop) {
        const th0 = p.dir > 0 ? Math.PI : 0;
        const th = th0 + p.dir * w * (age - t1);
        const cx = p.x0 + p.dir * p.r;
        out.x = cx + p.r * Math.cos(th);
        out.y = p.yLoop + p.r * Math.sin(th);
        return out;
      }
      out.x = p.x0;
      out.y = p.yLoop - p.speed * (age - t1 - tLoop);
      return out;
    }
    case 'hover': {
      const sway = (t: number) => p.swayA * Math.sin(p.swayF * t);
      if (age <= p.inT) {
        const s = age / p.inT;
        const e = 1 - (1 - s) ** 3;
        out.x = p.x0;
        out.y = p.y0 + (p.yStop - p.y0) * e;
        return out;
      }
      const h = age - p.inT;
      out.x = p.x0 + sway(h);
      if (h <= p.hold) {
        out.y = p.yStop;
        return out;
      }
      const o = h - p.hold;
      out.y = p.yStop + p.exitVy * o * Math.min(1, o / 1.2 + 0.2);
      return out;
    }
    case 'ground':
      out.x = p.x0 + p.vx * age;
      out.y = p.y0 + p.vy * age - scrolled;
      return out;
    case 'home':
      out.x = p.x0;
      out.y = p.y0;
      return out;
  }
}
