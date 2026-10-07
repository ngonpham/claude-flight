/**
 * Controls for the arcade game: keyboard (arrows / WASD to fly, Space / J / Z to fire, X / K /
 * Shift for the evasive roll), a gamepad (stick or d-pad, A / RT fire, B / X roll, Start pause),
 * and touch or mouse drag — the aircraft follows the finger's movement, offset so the finger never
 * hides it, and fires on its own while touching. Turns all of them into the simulation's `Input`.
 */
import type { Input } from './types';

export const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  fire: ['Space', 'KeyJ', 'KeyZ'],
  roll: ['KeyX', 'KeyK', 'ShiftLeft', 'ShiftRight'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM'],
  autoFire: ['KeyF'],
  confirm: ['Enter', 'NumpadEnter'],
} as const;

export type KeyAction = keyof typeof KEYS;

export function actionOf(code: string): KeyAction | null {
  for (const [a, codes] of Object.entries(KEYS) as [KeyAction, readonly string[]][]) if (codes.includes(code)) return a;
  return null;
}

/** Field coordinates of a screen point, from the view. */
export type ScreenToField = (px: number, py: number) => { x: number; y: number };

export class Controls {
  private readonly down = new Set<string>();
  private rollQueued = false;
  private drag: { id: number; sx: number; sy: number; fx: number; fy: number; px: number; py: number } | null = null;
  private dragFire = false;
  private padRoll = false;
  private padPause = false;
  /** Sensitivity of drag steering (field units per field unit of finger travel). */
  dragGain = 1.35;
  onAction: ((a: KeyAction) => void) | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly surface: HTMLElement, private readonly win: Window = window) {
    const kd = (e: KeyboardEvent) => {
      const a = actionOf(e.code);
      if (!a) return;
      if (a !== 'confirm' && a !== 'pause') e.preventDefault();
      if (!e.repeat) {
        if (a === 'roll') this.rollQueued = true;
        if (a === 'pause' || a === 'mute' || a === 'autoFire' || a === 'confirm' || a === 'fire') this.onAction?.(a);
      }
      this.down.add(e.code);
    };
    const ku = (e: KeyboardEvent) => {
      this.down.delete(e.code);
    };
    const blur = () => {
      this.down.clear();
      this.drag = null;
      this.dragFire = false;
    };
    this.on(win, 'keydown', kd as EventListener);
    this.on(win, 'keyup', ku as EventListener);
    this.on(win, 'blur', blur);

    const pd = (e: PointerEvent) => {
      if (this.drag) {
        // A second finger rolls.
        if (e.pointerType === 'touch') this.rollQueued = true;
        return;
      }
      this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, fx: NaN, fy: NaN, px: e.clientX, py: e.clientY };
      this.dragFire = true;
      surface.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const pm = (e: PointerEvent) => {
      if (this.drag && e.pointerId === this.drag.id) {
        this.drag.px = e.clientX;
        this.drag.py = e.clientY;
      }
    };
    const pu = (e: PointerEvent) => {
      if (this.drag && e.pointerId === this.drag.id) {
        this.drag = null;
        this.dragFire = false;
      }
    };
    this.on(surface, 'pointerdown', pd as EventListener);
    this.on(surface, 'pointermove', pm as EventListener);
    this.on(surface, 'pointerup', pu as EventListener);
    this.on(surface, 'pointercancel', pu as EventListener);
    this.on(surface, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
  }

  private on(t: EventTarget, type: string, fn: EventListener): void {
    t.addEventListener(type, fn, { passive: false });
    this.cleanup.push(() => t.removeEventListener(type, fn));
  }

  /** Queue a roll (the HUD's touch button). */
  roll(): void {
    this.rollQueued = true;
  }

  get dragging(): boolean {
    return !!this.drag;
  }

  private key(a: KeyAction): boolean {
    return KEYS[a].some((c) => this.down.has(c));
  }

  /** The input for this step. `player` is where the aircraft is (for drag steering). */
  read(player: { x: number; y: number }, toField: ScreenToField, autoFire: boolean): Input {
    let x = (this.key('right') ? 1 : 0) - (this.key('left') ? 1 : 0);
    let y = (this.key('up') ? 1 : 0) - (this.key('down') ? 1 : 0);
    let fire = this.key('fire') || autoFire;
    let roll = this.rollQueued;
    this.rollQueued = false;

    const pads = this.win.navigator?.getGamepads?.() ?? [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      if (Math.abs(ax) > 0.18) x += ax;
      if (Math.abs(ay) > 0.18) y -= ay;
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      if (b(12)) y += 1;
      if (b(13)) y -= 1;
      if (b(14)) x -= 1;
      if (b(15)) x += 1;
      if (b(0) || b(7) || b(5)) fire = true;
      const r = b(1) || b(2) || b(4) || b(6);
      if (r && !this.padRoll) roll = true;
      this.padRoll = r;
      const st = b(9);
      if (st && !this.padPause) this.onAction?.('pause');
      this.padPause = st;
    }

    let target: Input['target'] = null;
    if (this.drag) {
      const d = this.drag;
      const now = toField(d.px, d.py);
      if (Number.isNaN(d.fx)) {
        const start = toField(d.sx, d.sy);
        d.fx = player.x - start.x * this.dragGain;
        d.fy = player.y - start.y * this.dragGain;
      }
      target = { x: d.fx + now.x * this.dragGain, y: d.fy + now.y * this.dragGain };
      fire = fire || this.dragFire;
    }
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), target, fire, roll };
  }

  dispose(): void {
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
  }
}
