/**
 * Sound for the arcade game, synthesised live with the Web Audio API (nothing is downloaded): the
 * drone of the radial engines, gunfire, hits, explosions from a pop to a battleship blowing up,
 * pick-up chimes, the evasive-roll whoosh, the boss siren, a level-clear fanfare, and a quiet
 * marching snare-and-bass loop that speeds up for the boss. `play()` maps simulation events to
 * sounds, throttling the rapid ones.
 */
import type { GameEvent, GameState } from './types';

type Ctx = AudioContext;

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class GameAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private last = new Map<string, number>();
  private muted = false;
  private nextBeat = 0;
  private step = 0;
  private tempo = 104;
  private musicOn = false;

  /** Create / resume the audio context (call from a user gesture). */
  start(): void {
    try {
      if (!this.ctx) {
        const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (!AC) return;
        const ctx = new AC();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        this.master.connect(comp).connect(ctx.destination);
        this.sfx = ctx.createGain();
        this.sfx.gain.value = 0.9;
        this.sfx.connect(this.master);
        this.music = ctx.createGain();
        this.music.gain.value = 0.32;
        this.music.connect(this.master);
        const len = ctx.sampleRate * 2;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let s = 12345;
        for (let i = 0; i < len; i++) {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          d[i] = (s / 0x7fffffff) * 2 - 1;
        }
        this.startEngine();
      }
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMusic(on: boolean, boss = false): void {
    this.musicOn = on;
    this.tempo = boss ? 132 : 104;
    if (this.ctx && on && this.nextBeat < this.ctx.currentTime) this.nextBeat = this.ctx.currentTime + 0.1;
  }

  private startEngine(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 2;
    const osc = [62, 62.7, 124.5].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.12 : 0.35;
      o.connect(g).connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain).connect(this.sfx!);
    this.engine = { osc, gain, filter };
  }

  /** Per frame: engine pitch / level from the player, music scheduling. */
  update(s: GameState | null, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    const t = ctx.currentTime;
    const alive = !!s && s.player.alive && active;
    const v = s ? Math.hypot(s.player.vx, s.player.vy) : 0;
    const base = 60 + v * 0.6 + (s && s.player.roll > 0 ? 18 : 0);
    this.engine.osc[0].frequency.setTargetAtTime(base, t, 0.15);
    this.engine.osc[1].frequency.setTargetAtTime(base * 1.011, t, 0.15);
    this.engine.osc[2].frequency.setTargetAtTime(base * 2.01, t, 0.15);
    this.engine.filter.frequency.setTargetAtTime(380 + v * 9, t, 0.2);
    this.engine.gain.gain.setTargetAtTime(alive ? 0.07 : 0, t, 0.25);
    if (this.musicOn && active) this.scheduleMusic();
  }

  private scheduleMusic(): void {
    const ctx = this.ctx!;
    const beat = 60 / this.tempo / 4;
    if (this.nextBeat < ctx.currentTime - 0.5) this.nextBeat = ctx.currentTime + 0.05;
    // D minor march: bass roots per bar, snare on a 16-step grid.
    const roots = [38, 34, 36, 33];
    const snare = [1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0];
    while (this.nextBeat < ctx.currentTime + 0.25) {
      const st = this.step % 64;
      const bar = Math.floor(st / 16);
      const i = st % 16;
      const t = this.nextBeat;
      if (snare[i]) this.drum(t, i % 4 === 0 ? 0.32 : 0.16);
      if (i % 4 === 0) this.bass(t, NOTE(roots[bar] + (i === 8 ? 7 : 0)), beat * 3);
      if (i === 0 && bar % 2 === 0) this.kick(t);
      this.step++;
      this.nextBeat += beat;
    }
  }

  // ── primitives ────────────────────────────────────────────────────────────────────────────────

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): number {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay);
    return t + attack + decay * 6;
  }

  private burst(t: number, peak: number, decay: number, type: BiquadFilterType, f0: number, f1: number, out: AudioNode = this.sfx!, q = 0.8): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + decay * 3);
    const g = ctx.createGain();
    const end = this.env(g, t, peak, 0.004, decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(end);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, peak: number, dur: number, out: AudioNode = this.sfx!): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.25);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur * 2);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private drum(t: number, v: number): void {
    this.burst(t, v, 0.05, 'highpass', 1800, 1500, this.music!, 0.5);
    this.tone(t, 'triangle', 220, 140, v * 0.5, 0.06, this.music!);
  }

  private kick(t: number): void {
    this.tone(t, 'sine', 120, 40, 0.5, 0.18, this.music!);
  }

  private bass(t: number, f: number, dur: number): void {
    this.tone(t, 'triangle', f, f, 0.32, dur, this.music!);
  }

  private explosion(t: number, size: number): void {
    this.burst(t, 0.55 * Math.min(1.6, size), 0.12 + 0.18 * size, 'lowpass', 1600, 90);
    this.tone(t, 'sine', 90, 30, 0.45 * Math.min(1.5, size), 0.25 + 0.3 * size);
    if (size > 1.5) this.burst(t + 0.08, 0.35, 0.5 * size, 'lowpass', 500, 40);
  }

  private throttled(key: string, gap: number): boolean {
    const now = this.ctx!.currentTime;
    if (now - (this.last.get(key) ?? -1) < gap) return true;
    this.last.set(key, now);
    return false;
  }

  /** Play the sound of one simulation event. */
  play(e: GameEvent): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    switch (e.type) {
      case 'shot':
        if (this.throttled('shot', 0.075)) return;
        this.burst(t, 0.16, 0.025, 'bandpass', 2600, 1200, this.sfx!, 1.2);
        this.tone(t, 'square', 180, 90, 0.05, 0.04);
        break;
      case 'enemyShot':
        if (this.throttled('eshot', 0.06)) return;
        this.tone(t, 'sine', e.n ? 420 : 760, e.n ? 200 : 380, 0.06, 0.08);
        break;
      case 'hit':
        if (this.throttled('hit', 0.04)) return;
        this.burst(t, 0.1, 0.015, 'highpass', 4000, 3000);
        break;
      case 'kill':
        this.explosion(t, e.surface ? 1.6 : e.kind === 'betty' ? 1.4 : 0.8);
        break;
      case 'partKill':
        this.explosion(t, 1.3);
        break;
      case 'bossDown':
        this.explosion(t, 2.6);
        this.explosion(t + 0.35, 2);
        this.explosion(t + 0.9, 2.4);
        break;
      case 'playerHit':
        this.tone(t, 'square', 260, 110, 0.18, 0.18);
        this.burst(t, 0.3, 0.06, 'bandpass', 1400, 600);
        break;
      case 'playerDown':
        this.explosion(t, 2);
        this.tone(t + 0.1, 'sawtooth', 500, 60, 0.15, 1.2);
        break;
      case 'wingmanDown':
        this.explosion(t, 0.9);
        break;
      case 'pickup':
        [72, 76, 79, 84].forEach((n, i) => this.tone(t + i * 0.06, 'triangle', NOTE(n), NOTE(n), 0.2, 0.12));
        break;
      case 'drop':
        this.tone(t, 'sine', NOTE(88), NOTE(91), 0.08, 0.15);
        break;
      case 'roll':
        this.burst(t, 0.25, 0.25, 'bandpass', 300, 1800, this.sfx!, 2);
        break;
      case 'warning':
        for (let i = 0; i < 6; i++) this.tone(t + i * 0.45, 'square', i % 2 ? 660 : 880, i % 2 ? 660 : 880, 0.09, 0.4);
        break;
      case 'bossIn':
        this.tone(t, 'sawtooth', 55, 52, 0.2, 1.6);
        this.tone(t, 'sawtooth', 82.4, 78, 0.12, 1.6);
        break;
      case 'clear':
        [67, 72, 76, 79, 76, 79, 84].forEach((n, i) => {
          this.tone(t + i * 0.13, 'square', NOTE(n), NOTE(n), 0.08, i === 6 ? 0.8 : 0.14);
          this.tone(t + i * 0.13, 'triangle', NOTE(n - 12), NOTE(n - 12), 0.12, i === 6 ? 0.8 : 0.14);
        });
        break;
      case 'gameover':
        [69, 65, 62, 57].forEach((n, i) => this.tone(t + 0.6 + i * 0.32, 'triangle', NOTE(n), NOTE(n), 0.2, 0.36));
        break;
      case 'extraLife':
        [76, 79, 88, 84, 86, 91].forEach((n, i) => this.tone(t + i * 0.08, 'square', NOTE(n), NOTE(n), 0.07, 0.1));
        break;
      case 'chain':
        this.tone(t, 'triangle', NOTE(84 + Math.min(12, (e.n ?? 4) / 2)), NOTE(91), 0.07, 0.09);
        break;
      case 'launch':
        this.burst(t, 0.12, 0.3, 'lowpass', 900, 200);
        break;
      default:
        break;
    }
  }
}
