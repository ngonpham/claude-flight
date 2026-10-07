// @vitest-environment happy-dom
/**
 * Controls: key bindings map to actions, held keys steer and fire, the roll fires once per press,
 * a drag steers relative to where it started, and window blur releases everything.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Controls, KEYS, actionOf } from '../../src/pacific/input';

const toField = (px: number, py: number) => ({ x: px / 10, y: -py / 10 });
let controls: Controls | null = null;
afterEach(() => {
  controls?.dispose();
  controls = null;
});

function key(type: 'keydown' | 'keyup', code: string, repeat = false) {
  window.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true }));
}

function pointer(el: HTMLElement, type: string, x: number, y: number, id = 1) {
  el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true }));
}

describe('bindings', () => {
  it('every bound key maps back to its action, and no key is bound twice', () => {
    const seen = new Set<string>();
    for (const [a, codes] of Object.entries(KEYS)) {
      for (const c of codes) {
        expect(seen.has(c), c).toBe(false);
        seen.add(c);
        expect(actionOf(c)).toBe(a);
      }
    }
    expect(actionOf('KeyQ')).toBeNull();
  });
});

describe('Controls', () => {
  it('arrows / WASD steer, Space fires, X rolls once per press', () => {
    const el = document.createElement('div');
    controls = new Controls(el, window);
    key('keydown', 'ArrowRight');
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    let i = controls.read({ x: 0, y: 0 }, toField, false);
    expect(i).toMatchObject({ x: 1, y: 1, fire: true, roll: false, target: null });
    key('keydown', 'KeyX');
    expect(controls.read({ x: 0, y: 0 }, toField, false).roll).toBe(true);
    expect(controls.read({ x: 0, y: 0 }, toField, false).roll).toBe(false);
    key('keydown', 'KeyX', true);
    expect(controls.read({ x: 0, y: 0 }, toField, false).roll).toBe(false);
    key('keyup', 'ArrowRight');
    key('keyup', 'Space');
    i = controls.read({ x: 0, y: 0 }, toField, false);
    expect(i.x).toBe(0);
    expect(i.fire).toBe(false);
    expect(controls.read({ x: 0, y: 0 }, toField, true).fire).toBe(true);
  });

  it('pause, mute, auto-fire and confirm reach the action callback once per press', () => {
    const el = document.createElement('div');
    controls = new Controls(el, window);
    const got: string[] = [];
    controls.onAction = (a) => got.push(a);
    key('keydown', 'KeyP');
    key('keydown', 'KeyP', true);
    key('keydown', 'KeyM');
    key('keydown', 'KeyF');
    key('keydown', 'Enter');
    expect(got).toEqual(['pause', 'mute', 'autoFire', 'confirm']);
  });

  it('a drag steers relative to where it began and fires; a second finger rolls; lifting stops', () => {
    const el = document.createElement('div');
    document.body.append(el);
    controls = new Controls(el, window);
    pointer(el, 'pointerdown', 100, 100);
    let i = controls.read({ x: 3, y: -20 }, toField, false);
    expect(i.target!.x).toBeCloseTo(3);
    expect(i.target!.y).toBeCloseTo(-20);
    expect(i.fire).toBe(true);
    pointer(el, 'pointermove', 150, 50);
    i = controls.read({ x: 3, y: -20 }, toField, false);
    expect(i.target!.x).toBeCloseTo(3 + 5 * controls.dragGain);
    expect(i.target!.y).toBeCloseTo(-20 + 5 * controls.dragGain);
    pointer(el, 'pointerdown', 300, 300, 2);
    expect(controls.read({ x: 0, y: 0 }, toField, false).roll).toBe(true);
    pointer(el, 'pointerup', 150, 50);
    i = controls.read({ x: 0, y: 0 }, toField, false);
    expect(i.target).toBeNull();
    expect(i.fire).toBe(false);
  });

  it('losing focus releases held keys', () => {
    const el = document.createElement('div');
    controls = new Controls(el, window);
    key('keydown', 'ArrowLeft');
    window.dispatchEvent(new Event('blur'));
    expect(controls.read({ x: 0, y: 0 }, toField, false).x).toBe(0);
  });
});
