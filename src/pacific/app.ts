/**
 * The arcade game's controller: owns the simulation state, the 3D view, the HUD, the sound and the
 * controls, runs the fixed-step loop, and moves between the screens — title (with the autopilot
 * flying a demo behind it), briefing, play, pause, results, game over, victory. Progress and
 * choices are saved after every level.
 *
 * URL options for testing and screenshots: ?level=1–10, ?plane=p38|f6f|f4u, ?diff=easy|normal|hard,
 * ?god=1 (cannot be hurt), ?auto=1 (the autopilot flies), ?play=1 (skip the title), ?mute=1,
 * ?seed=n. `window.pacific` exposes the state and a few helpers.
 */
import { PACIFIC } from './config';
import { GameAudio } from './audio';
import { Controls } from './input';
import { LEVELS, LEVEL_COUNT } from './levels';
import { loadSave, recordLevel, writeSave, type SaveData } from './save';
import { botInput } from './sim/bot';
import { carryOf, createGame, freshCarry, NO_INPUT, startCarry, stepGame } from './sim/game';
import type { Carry, Difficulty, GameEvent, GameState, PickupKind, PlaneId } from './types';
import { UI } from './ui';
import { View } from './render/view';

type Mode = 'title' | 'brief' | 'play' | 'pause' | 'results' | 'over' | 'victory';

export interface AppOptions {
  search: string;
  storage: Storage | null;
  touch: boolean;
}

export class PacificApp {
  readonly view: View;
  readonly ui: UI;
  readonly audio = new GameAudio();
  readonly controls: Controls;
  save: SaveData;
  state: GameState;
  mode: Mode = 'title';
  private acc = 0;
  private lastT = 0;
  private selected = 0;
  private levelStartScore = 0;
  private overShown = false;
  private readonly params: URLSearchParams;
  private readonly god: boolean;
  private auto: boolean;
  private demo = false;
  private raf = 0;
  fps = 0;

  constructor(private readonly container: HTMLElement, opts: AppOptions) {
    this.params = new URLSearchParams(opts.search);
    this.save = loadSave(opts.storage);
    const plane = this.params.get('plane') as PlaneId | null;
    if (plane && plane in PACIFIC.planes) this.save.plane = plane;
    const diff = this.params.get('diff') as Difficulty | null;
    if (diff && diff in PACIFIC.difficulty) this.save.difficulty = diff;
    if (this.params.get('mute') === '1') this.save.muted = true;
    this.god = this.params.get('god') === '1';
    this.auto = this.params.get('auto') === '1';
    const lv = Number(this.params.get('level'));
    if (Number.isFinite(lv) && lv >= 1 && lv <= LEVEL_COUNT) this.selected = lv - 1;
    else this.selected = this.save.unlocked;

    this.view = new View(container);
    this.ui = new UI(container, opts.touch);
    this.controls = new Controls(this.view.renderer.domElement);
    this.audio.setMuted(this.save.muted);
    this.state = createGame({ level: 0, difficulty: 'normal', plane: this.save.plane, god: true });

    this.controls.onAction = (a) => this.onAction(a);
    this.ui.onRoll = () => this.controls.roll();
    this.ui.onPause = () => this.togglePause();
    const unlock = () => this.audio.start();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'play') this.togglePause();
    });

    const app = this;
    (window as unknown as { pacific: unknown }).pacific = {
      app,
      get state() { return app.state; },
      start: (level: number) => this.startLevel(level - 1, startCarry(this.save.plane, this.save.difficulty, level - 1)),
      skipToBoss: () => this.skipToBoss(),
      setAuto: (on: boolean) => { this.auto = on; },
      stats: () => this.view.stats(),
    };

    this.resize();
    if (this.params.get('play') === '1' || this.params.has('level')) this.startLevel(this.selected, startCarry(this.save.plane, this.save.difficulty, this.selected), this.params.get('play') === '1');
    else this.showTitle();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private resize(): void {
    this.view.resize(this.container.clientWidth || window.innerWidth, this.container.clientHeight || window.innerHeight);
  }

  private persist(): void {
    writeSave(window.localStorage ?? null, this.save);
  }

  // ── screens ───────────────────────────────────────────────────────────────────────────────────

  private startDemo(): void {
    const lv = Math.floor(Math.random() * LEVEL_COUNT);
    this.demo = true;
    this.state = createGame({ level: lv, difficulty: 'normal', plane: this.save.plane, god: true, seed: (Math.random() * 1e9) | 0, carry: { ...freshCarry(this.save.plane, 'normal'), weapon: 3, wingmen: 2 } });
    this.view.setLevel(LEVELS[lv], this.save.plane);
  }

  showTitle(): void {
    this.mode = 'title';
    this.ui.setHud(false);
    this.startDemo();
    this.audio.setMusic(false);
    this.ui.showTitle(this.save, this.selected, {
      onStart: (level) => {
        this.selected = level;
        this.audio.start();
        this.startLevel(level, startCarry(this.save.plane, this.save.difficulty, level));
      },
      onPlane: (p) => {
        this.save.plane = p;
        this.persist();
        this.showTitle();
      },
      onDifficulty: (d) => {
        this.save.difficulty = d;
        this.persist();
        this.showTitle();
      },
      onToggle: (w) => {
        this.save[w] = !this.save[w];
        if (w === 'muted') this.audio.setMuted(this.save.muted);
        this.persist();
        this.showTitle();
      },
    });
  }

  /** Set up a level and show its briefing (or go straight in). */
  startLevel(level: number, carry: Carry, skipBrief = false): void {
    this.demo = false;
    this.overShown = false;
    const seed = this.params.has('seed') ? Number(this.params.get('seed')) : undefined;
    this.state = createGame({ level, difficulty: this.save.difficulty, plane: this.save.plane, carry, god: this.god, seed });
    this.levelStartScore = carry.score;
    this.view.setLevel(LEVELS[level], this.save.plane);
    this.ui.setHud(true);
    this.ui.updateHud(this.state, this.save.hiScore);
    if (skipBrief) this.go();
    else {
      this.mode = 'brief';
      this.audio.setMusic(false);
      this.ui.showBriefing(LEVELS[level], this.save.plane, () => this.go());
    }
  }

  private go(): void {
    this.audio.start();
    this.ui.hideScreens();
    this.mode = 'play';
    this.acc = 0;
    this.audio.setMusic(this.save.music);
    const lv = LEVELS[this.state.level];
    this.ui.banner(`Màn ${lv.index + 1} — ${lv.title}`, `${lv.place} · ${lv.date}`, '', 2600);
  }

  private togglePause(): void {
    if (this.mode === 'play') {
      this.mode = 'pause';
      this.audio.setMusic(false);
      this.ui.showPause(() => this.togglePause(), () => this.restartLevel(), () => this.showTitle());
    } else if (this.mode === 'pause') {
      this.ui.hideScreens();
      this.mode = 'play';
      this.lastT = performance.now();
      this.audio.setMusic(this.save.music, this.state.phase === 'boss');
    }
  }

  private restartLevel(): void {
    this.startLevel(this.state.level, startCarry(this.save.plane, this.save.difficulty, this.state.level), true);
  }

  private skipToBoss(): void {
    const s = this.state;
    s.nextSpawn = s.schedule.length;
    s.t = LEVELS[s.level].duration + 11;
    for (const e of s.enemies) e.alive = false;
    if (s.phase === 'intro') {
      s.phase = 'waves';
      s.phaseT = 0;
    }
  }

  private onAction(a: string): void {
    if (a === 'mute') {
      this.save.muted = !this.save.muted;
      this.audio.setMuted(this.save.muted);
      this.persist();
      if (this.mode === 'play') this.ui.banner(this.save.muted ? 'Tắt âm thanh' : 'Bật âm thanh', '', '', 900);
      return;
    }
    if (a === 'autoFire') {
      this.save.autoFire = !this.save.autoFire;
      this.persist();
      if (this.mode === 'play') this.ui.banner(this.save.autoFire ? 'Tự bắn: BẬT' : 'Tự bắn: TẮT', '', '', 900);
      return;
    }
    if (a === 'pause') {
      this.togglePause();
      return;
    }
    if ((a === 'confirm' || a === 'fire') && (this.mode === 'brief' || this.mode === 'results' || this.mode === 'over' || this.mode === 'victory')) {
      const go = this.container.querySelector<HTMLElement>('.pz-screen.on .pz-go');
      // Enter on the focused button already clicks it (the browser's own activation).
      if (go && !(a === 'confirm' && document.activeElement === go)) go.click();
    }
  }

  private finishLevel(): void {
    const s = this.state;
    const lv = LEVELS[s.level];
    const levelScore = s.score - this.levelStartScore;
    this.save = recordLevel(this.save, s.level, s.score, levelScore);
    const last = s.level === LEVEL_COUNT - 1;
    if (last) this.save.victories++;
    this.persist();
    this.mode = 'results';
    this.audio.setMusic(false);
    this.ui.showResults({ level: lv, state: s, levelScore, last }, () => {
      if (last) {
        this.mode = 'victory';
        this.ui.setHud(false);
        this.ui.showVictory(s.score, this.save.hiScore, () => this.showTitle());
      } else {
        this.selected = s.level + 1;
        this.startLevel(s.level + 1, carryOf(s));
      }
    });
  }

  // ── events → HUD ──────────────────────────────────────────────────────────────────────────────

  private hudEvent(e: GameEvent): void {
    const s = this.state;
    switch (e.type) {
      case 'kill':
      case 'partKill':
        if (e.n && e.n > 0) {
          const p = this.view.project(e.x, e.y);
          this.ui.popup(p.x, p.y, `+${e.n}`, e.n >= 1000 ? 'big' : '');
        }
        break;
      case 'bossDown': {
        const p = this.view.project(e.x, e.y);
        this.ui.popup(p.x, p.y, `+${e.n ?? 0}`, 'big');
        this.ui.banner('Đã tiêu diệt', s.boss?.def.name ?? '', 'gold', 2800);
        break;
      }
      case 'pickup': {
        const p = this.view.project(e.x, e.y);
        this.ui.popup(p.x, p.y, e.n ? `+${e.n}` : this.ui.pickupText(e.kind as PickupKind), 'pick');
        break;
      }
      case 'warning':
        this.ui.banner('Cảnh báo', `${s.boss?.def.name ?? ''} đang tiến đến`.trim(), 'warn', PACIFIC.boss.warning * 1000);
        this.audio.setMusic(this.save.music, true);
        break;
      case 'bossIn':
        this.ui.banner('Cảnh báo', `${s.boss?.def.name ?? ''}`, 'warn', 1800);
        break;
      case 'bossEscape':
        this.ui.banner('Mục tiêu rút lui', '', '', 2200);
        break;
      case 'clear':
        this.audio.setMusic(false);
        this.ui.banner(e.n ? 'Nhiệm vụ hoàn thành' : 'Kết thúc trận', LEVELS[s.level].title, 'gold', 3000);
        break;
      case 'extraLife':
        this.ui.banner('Thêm một mạng!', '', 'gold', 1500);
        break;
      case 'chain': {
        const p = this.view.project(e.x, e.y);
        this.ui.popup(p.x, p.y - 24, `Chuỗi ${e.n}`, 'big');
        break;
      }
      case 'playerDown':
        if (s.player.lives > 0) this.ui.banner('Bị bắn rơi!', `Còn ${s.player.lives} mạng`, 'warn', 1600);
        break;
      default:
        break;
    }
  }

  // ── loop ──────────────────────────────────────────────────────────────────────────────────────

  private loop(t: number): void {
    this.raf = requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.1, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    const s = this.state;
    const running = this.mode === 'play' || (this.mode === 'title' && this.demo) || this.mode === 'results' || this.mode === 'over';
    if (running && !s.done) {
      this.acc += dt;
      const step = PACIFIC.sim.dt;
      let n = 0;
      while (this.acc >= step && n < PACIFIC.sim.maxStepsPerFrame) {
        const input = this.mode === 'play' && !this.auto && s.phase !== 'gameover'
          ? this.controls.read(s.player, (x, y) => this.view.screenToField(x, y), this.save.autoFire)
          : this.mode === 'play' || this.demo ? botInput(s) : NO_INPUT;
        stepGame(s, input, step);
        this.acc -= step;
        n++;
      }
      if (n === PACIFIC.sim.maxStepsPerFrame) this.acc = 0;
    }
    const events = s.events.splice(0, s.events.length);
    const live = this.mode === 'play';
    for (const e of events) {
      if (live || this.mode === 'results' || this.mode === 'over') this.audio.play(e);
      if (live) this.hudEvent(e);
    }
    this.view.frame(s, events, dt);
    this.view.render();
    this.audio.update(s, live);
    this.adaptResolution(dt);
    if (live) {
      this.ui.updateHud(s, this.save.hiScore);
      if (s.done) this.finishLevel();
      else if (s.phase === 'gameover' && s.phaseT > 2.6 && !this.overShown) {
        this.overShown = true;
        this.mode = 'over';
        this.save.hiScore = Math.max(this.save.hiScore, s.score);
        this.persist();
        this.audio.setMusic(false);
        this.ui.showGameOver(LEVELS[s.level], s.score, () => this.restartLevel(), () => this.showTitle());
      }
    }
    if (this.mode === 'title' && this.demo && (s.done || s.phase === 'gameover')) this.startDemo();
  }

  /** Low-end devices: after a few seconds under 40 fps, render at a lower pixel ratio (once per step). */
  private slowT = 0;
  private adaptResolution(dt: number): void {
    if (this.mode !== 'play' && this.mode !== 'title') return;
    const r = this.view.renderer.getPixelRatio();
    this.slowT = this.fps < 40 ? this.slowT + dt : Math.max(0, this.slowT - dt * 2);
    if (this.slowT > 3 && r > 1) {
      this.slowT = 0;
      this.view.renderer.setPixelRatio(Math.max(1, r - 0.5));
      this.resize();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.view.dispose();
  }
}

