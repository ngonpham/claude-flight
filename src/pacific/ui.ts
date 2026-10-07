/**
 * The game's screens and HUD, in Vietnamese, as plain DOM over the canvas: the title screen
 * (aircraft, difficulty, the ten-battle campaign map), the briefing card before each battle, the
 * in-flight HUD (score, lives, hull, rolls, guns, chain multiplier, level progress, boss bar,
 * banners, score pop-ups, touch buttons), pause, results, game over and the victory epilogue.
 * Styled like a wartime briefing: navy, khaki and signal red, stencil-wide capitals.
 */
import { BOSSES } from './bosses';
import { PACIFIC } from './config';
import { EPILOGUE, LEVELS, type LevelDef } from './levels';
import type { SaveData } from './save';
import { scoreMultiplier } from './sim/game';
import type { Difficulty, GameState, LevelBonus, PickupKind, PlaneId } from './types';

type Child = Node | string | null | undefined | false;

/** Create an element: h('div.cls#id', {attrs}, children). */
function h(tag: string, attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {}, ...kids: Child[]): HTMLElement {
  const [name, ...rest] = tag.split('.');
  const [el, id] = name.split('#');
  const node = document.createElement(el || 'div');
  if (id) node.id = id;
  if (rest.length) node.className = rest.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
    } else node.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

const CSS = `
:root { --navy:#0d1b2e; --navy2:#16263d; --khaki:#c9b98a; --paper:#efe6cf; --red:#c8202c; --gold:#e3b23c; --ink:#1b1b1b; --ok:#5fbf6a; }
.pz-root { position:fixed; inset:0; pointer-events:none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif; color: var(--paper); user-select:none; -webkit-user-select:none; }
.pz-root * { box-sizing:border-box; }
.pz-vignette { position:absolute; inset:0; background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.45) 100%); }
.pz-hud { position:absolute; inset:0; display:none; }
.pz-hud.on { display:block; }
.pz-top { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:flex-start; padding:10px 14px; gap:10px; text-shadow: 0 1px 2px #000, 0 0 6px rgba(0,0,0,.6); }
.pz-score b { font-size: clamp(18px, 2.6vw, 28px); letter-spacing:.06em; font-variant-numeric: tabular-nums; display:block; }
.pz-score small { opacity:.75; font-size:12px; letter-spacing:.12em; display:block; }
.pz-mult { color: var(--gold); font-weight:800; margin-left:6px; font-size:16px; }
.pz-mid { text-align:center; flex:1; min-width:0; }
.pz-mid .t { font-weight:800; letter-spacing:.14em; font-size: clamp(12px, 1.6vw, 16px); text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pz-prog { height:5px; background: rgba(255,255,255,.18); border-radius:3px; margin:6px auto 0; max-width:320px; overflow:hidden; }
.pz-prog i { display:block; height:100%; background: var(--khaki); width:0; }
.pz-right { text-align:right; font-size:14px; line-height:1.5; }
.pz-icons { letter-spacing:2px; font-size:16px; }
.pz-hp i { display:inline-block; width:14px; height:9px; margin-left:3px; background:var(--ok); border:1px solid rgba(0,0,0,.6); transform: skewX(-15deg); }
.pz-hp i.off { background: rgba(255,255,255,.15); }
.pz-hp.low i:not(.off) { background: #ff4d3d; animation: pzblink .5s steps(2) infinite; }
.pz-gun i { display:inline-block; width:7px; height:12px; margin-left:2px; background:var(--gold); }
.pz-gun i.off { background: rgba(255,255,255,.15); }
.pz-boss { position:absolute; top:62px; left:50%; transform:translateX(-50%); width:min(560px, 80vw); display:none; text-align:center; text-shadow:0 1px 2px #000; }
.pz-boss.on { display:block; }
.pz-boss .n { font-weight:800; letter-spacing:.12em; font-size:13px; text-transform:uppercase; color:#ffd5d0; }
.pz-boss .bar { height:9px; margin-top:4px; background: rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.35); }
.pz-boss .bar i { display:block; height:100%; width:100%; background: linear-gradient(90deg, #ff4d3d, #ffb03d); transition: width .1s; }
.pz-banner { position:absolute; top:22%; left:0; right:0; text-align:center; font-weight:900; letter-spacing:.18em; text-transform:uppercase; font-size: clamp(20px, 4vw, 44px); opacity:0; transition: opacity .25s; text-shadow: 0 2px 4px #000, 0 0 18px rgba(0,0,0,.7); padding: 0 16px; }
.pz-banner small { display:block; font-size: .42em; letter-spacing:.2em; margin-top:.4em; color: var(--khaki); }
.pz-banner.on { opacity:1; }
.pz-banner.warn { color:#ff5546; animation: pzblink .45s steps(2) infinite; }
.pz-banner.gold { color: var(--gold); }
@keyframes pzblink { 50% { opacity:.25; } }
.pz-pops { position:absolute; inset:0; overflow:hidden; }
.pz-pop { position:absolute; transform:translate(-50%,-50%); font-weight:800; font-size:14px; color:#fff6d6; text-shadow:0 1px 2px #000; animation: pzrise .9s ease-out forwards; white-space:nowrap; }
.pz-pop.big { font-size:20px; color: var(--gold); }
.pz-pop.pick { font-size:16px; color: #b6ffbf; }
@keyframes pzrise { from { opacity:1; transform:translate(-50%,-50%); } to { opacity:0; transform:translate(-50%,-160%); } }
.pz-touch { position:absolute; inset:0; display:none; }
.pz-touch.on { display:block; }
.pz-btn-roll, .pz-btn-pause { position:absolute; pointer-events:auto; border-radius:50%; border:2px solid rgba(255,255,255,.6); background: rgba(13,27,46,.45); color:#fff; font-weight:800; display:flex; align-items:center; justify-content:center; }
.pz-btn-roll { right:18px; bottom:22px; width:74px; height:74px; font-size:13px; letter-spacing:.08em; }
.pz-btn-pause { left:14px; top:96px; width:42px; height:42px; font-size:16px; }
.pz-screen { position:absolute; inset:0; display:none; align-items:center; justify-content:center; padding:16px; pointer-events:auto; background: rgba(6,12,22,.55); overflow:auto; }
.pz-screen.on { display:flex; }
.pz-card { width:min(980px, 100%); max-height:100%; overflow:auto; background: linear-gradient(180deg, rgba(22,38,61,.96), rgba(13,27,46,.97)); border: 1px solid rgba(201,185,138,.5); box-shadow: 0 20px 60px rgba(0,0,0,.6); padding: clamp(14px, 3vw, 28px); border-radius: 6px; }
.pz-card.narrow { width:min(640px, 100%); }
.pz-logo { text-align:center; margin-bottom: 6px; }
.pz-logo h1 { margin:0; font-size: clamp(34px, 7vw, 72px); font-weight:900; letter-spacing:.12em; color: var(--paper); text-shadow: 3px 3px 0 var(--red), 0 0 30px rgba(200,32,44,.35); line-height:1; }
.pz-logo p { margin:.5em 0 0; letter-spacing:.32em; text-transform:uppercase; color: var(--khaki); font-size: clamp(11px, 1.6vw, 15px); }
.pz-sec { margin-top:18px; }
.pz-sec > h3 { margin:0 0 8px; font-size:12px; letter-spacing:.24em; text-transform:uppercase; color: var(--khaki); font-weight:700; }
.pz-row { display:flex; gap:10px; flex-wrap:wrap; }
.pz-plane { flex:1 1 220px; text-align:left; padding:12px; border:1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.04); color:inherit; cursor:pointer; border-radius:4px; font: inherit; }
.pz-plane.sel { border-color: var(--gold); background: rgba(227,178,60,.12); box-shadow: inset 0 0 0 1px var(--gold); }
.pz-plane b { font-size:16px; letter-spacing:.04em; }
.pz-plane em { font-style:normal; color: var(--khaki); font-size:12px; margin-left:6px; }
.pz-plane p { margin:6px 0 8px; font-size:13px; opacity:.85; line-height:1.35; }
.pz-stat { display:flex; align-items:center; gap:8px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; opacity:.9; margin-top:3px; }
.pz-stat span { width:64px; }
.pz-stat i { flex:1; height:6px; background: rgba(255,255,255,.12); position:relative; }
.pz-stat i::after { content:""; position:absolute; inset:0; width: var(--v); background: var(--khaki); }
.pz-seg { display:inline-flex; border:1px solid rgba(255,255,255,.25); border-radius:4px; overflow:hidden; }
.pz-seg button { background:transparent; color:inherit; border:0; padding:8px 16px; cursor:pointer; font: inherit; font-weight:700; letter-spacing:.06em; }
.pz-seg button.sel { background: var(--khaki); color: var(--ink); }
.pz-levels { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:8px; }
.pz-lv { text-align:left; padding:9px 10px; border:1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.04); color:inherit; cursor:pointer; border-radius:4px; font: inherit; min-height:64px; }
.pz-lv small { display:block; font-size:11px; color: var(--khaki); letter-spacing:.06em; }
.pz-lv b { display:block; font-size:14px; margin-top:2px; }
.pz-lv span { font-size:11px; opacity:.7; }
.pz-lv.sel { border-color: var(--gold); background: rgba(227,178,60,.14); }
.pz-lv[disabled] { opacity:.38; cursor:not-allowed; }
.pz-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; margin-top:20px; }
.pz-go { background: var(--red); color:#fff; border:0; padding:13px 28px; font-weight:900; letter-spacing:.18em; font-size:16px; cursor:pointer; border-radius:4px; box-shadow: 0 4px 0 #7d1119; font-family:inherit; text-transform:uppercase; }
.pz-go:active { transform: translateY(2px); box-shadow: 0 2px 0 #7d1119; }
.pz-alt { background: transparent; color: var(--paper); border:1px solid rgba(255,255,255,.35); padding:12px 18px; font-weight:700; letter-spacing:.1em; cursor:pointer; border-radius:4px; font-family:inherit; text-transform:uppercase; font-size:13px; }
.pz-foot { margin-top:16px; text-align:center; font-size:12px; opacity:.65; }
.pz-foot a { color: var(--khaki); }
.pz-brief .k { color: var(--khaki); letter-spacing:.2em; font-size:12px; text-transform:uppercase; }
.pz-brief h2 { margin:.15em 0 .1em; font-size: clamp(28px, 5vw, 48px); letter-spacing:.08em; text-transform:uppercase; font-weight:900; }
.pz-brief .place { opacity:.8; font-size:14px; }
.pz-brief p { line-height:1.55; font-size: clamp(14px, 1.7vw, 16px); }
.pz-brief .box { border-left:3px solid var(--red); padding:6px 12px; background: rgba(255,255,255,.04); margin:10px 0; font-size:14px; line-height:1.45; }
.pz-brief .fact { border-left-color: var(--gold); font-style:italic; opacity:.9; }
.pz-table { width:100%; border-collapse:collapse; font-size:15px; margin-top:6px; }
.pz-table td { padding:6px 4px; border-bottom:1px solid rgba(255,255,255,.08); }
.pz-table td:last-child { text-align:right; font-variant-numeric: tabular-nums; font-weight:700; }
.pz-table tr.total td { font-size:19px; color: var(--gold); border-bottom:0; padding-top:12px; }
.pz-keys { display:grid; grid-template-columns: auto 1fr; gap:6px 14px; font-size:14px; }
.pz-keys kbd { background: var(--paper); color: var(--ink); padding:1px 6px; border-radius:3px; font-weight:700; font-size:12px; margin-right:3px; font-family: inherit; }
.pz-legend { display:flex; flex-wrap:wrap; gap:10px; font-size:13px; }
.pz-legend span { display:inline-flex; align-items:center; gap:6px; }
.pz-coin { width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-weight:900; font-size:12px; border:2px solid #fff6d8; color:#fff; }
.pz-hint { position:absolute; bottom:12px; left:0; right:0; text-align:center; font-size:12px; opacity:.7; text-shadow:0 1px 2px #000; }
@media (max-width: 640px) { .pz-right { font-size:12px; } .pz-boss { top:56px; } .pz-top { padding:8px; } .pz-plane p { display:none; } }
@media (max-width: 640px), (max-height: 560px) { .pz-sticky { position: sticky; bottom: calc(-1 * clamp(14px, 3vw, 28px)); margin: 16px calc(-1 * clamp(14px, 3vw, 28px)) 0; padding: 12px; background: rgba(13,27,46,.97); border-top: 1px solid rgba(201,185,138,.35); } }
`;

const PICK_TEXT: Record<PickupKind, string> = {
  pow: 'NÂNG CẤP SÚNG', wing: 'PHI ĐỘI HỘ TỐNG', roll: 'THÊM VÒNG LỘN', repair: 'SỬA CHỮA', medal: 'HUÂN CHƯƠNG',
};
const PICK_COLOR: Record<PickupKind, string> = { pow: '#d8342c', wing: '#2f9e48', roll: '#2f6fd8', repair: '#c0161e', medal: '#e8b828' };
const PICK_LETTER: Record<PickupKind, string> = { pow: 'P', wing: 'W', roll: 'R', repair: '+', medal: '★' };
const PICK_HELP: Record<PickupKind, string> = {
  pow: 'Nâng cấp súng (5 cấp)', wing: 'Hai máy bay hộ tống', roll: 'Thêm một vòng lộn né đạn', repair: 'Vá một ô giáp', medal: 'Điểm thưởng',
};

export interface TitleHandlers {
  onStart(level: number): void;
  onPlane(p: PlaneId): void;
  onDifficulty(d: Difficulty): void;
  onToggle(what: 'muted' | 'music' | 'autoFire'): void;
}

export interface ResultInfo {
  level: LevelDef;
  state: GameState;
  levelScore: number;
  last: boolean;
}

const fmt = (n: number) => Math.floor(n).toLocaleString('vi-VN');

export class UI {
  readonly root: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly screens: Record<string, HTMLElement> = {};
  private bannerTimer = 0;
  private lastHud = '';
  private pops = 0;
  onRoll: (() => void) | null = null;
  onPause: (() => void) | null = null;

  constructor(parent: HTMLElement, private readonly touch: boolean) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.root = h('div.pz-root');
    parent.append(this.root);
    this.root.append(h('div.pz-vignette'));
    this.hud = h('div.pz-hud');
    this.root.append(this.hud);
    const e = this.el;
    e.score = h('b', {}, '0');
    e.mult = h('span.pz-mult');
    e.hi = h('small', {}, 'KỶ LỤC 0');
    e.title = h('div.t');
    e.prog = h('i');
    e.lives = h('div.pz-icons');
    e.hp = h('div.pz-hp');
    e.rolls = h('div.pz-icons');
    e.gun = h('div.pz-gun');
    this.hud.append(h('div.pz-top', {},
      h('div.pz-score', {}, h('small', {}, 'ĐIỂM'), h('div', {}, e.score), e.mult, e.hi),
      h('div.pz-mid', {}, e.title, h('div.pz-prog', {}, e.prog)),
      h('div.pz-right', {}, e.lives, e.hp, e.rolls, e.gun)));
    e.bossName = h('div.n');
    e.bossBar = h('i');
    e.boss = h('div.pz-boss', {}, e.bossName, h('div.bar', {}, e.bossBar));
    e.banner = h('div.pz-banner');
    e.pops = h('div.pz-pops');
    this.hud.append(e.boss, e.banner, e.pops);
    e.touch = h('div.pz-touch', {},
      h('button.pz-btn-roll', { onpointerdown: (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); this.onRoll?.(); } }, 'LỘN'),
      h('button.pz-btn-pause', { onpointerdown: (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); this.onPause?.(); }, 'aria-label': 'Tạm dừng' }, '❚❚'));
    if (touch) e.touch.classList.add('on');
    this.hud.append(e.touch);
    for (const k of ['title', 'brief', 'results', 'over', 'victory', 'pause', 'help']) {
      this.screens[k] = h('div.pz-screen');
      this.root.append(this.screens[k]);
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────────────────────────

  setHud(on: boolean): void {
    this.hud.classList.toggle('on', on);
  }

  updateHud(s: GameState, hi: number): void {
    const p = s.player;
    const lv = LEVELS[s.level];
    const prog = s.phase === 'intro' ? 0 : s.phase === 'waves' ? Math.min(1, s.t / lv.duration) : 1;
    const mult = scoreMultiplier(s);
    const key = [s.score, hi, p.lives, p.hp, p.maxHp, p.rolls, p.weapon, p.wingmen, mult, Math.round(prog * 200), s.boss?.hp ?? -1, s.boss?.stage ?? '', s.level].join('|');
    if (key === this.lastHud) return;
    this.lastHud = key;
    const e = this.el;
    e.score.textContent = fmt(s.score);
    e.hi.textContent = `KỶ LỤC ${fmt(Math.max(hi, s.score))}`;
    e.mult.textContent = mult > 1 ? `×${mult.toFixed(1)}` : '';
    e.title.textContent = `Màn ${s.level + 1} · ${lv.title} · ${lv.date}`;
    e.prog.style.width = `${prog * 100}%`;
    e.lives.textContent = `${'✈'.repeat(Math.max(0, Math.min(9, p.lives)))}`;
    e.lives.title = `${p.lives} mạng`;
    e.hp.replaceChildren(...Array.from({ length: p.maxHp }, (_, i) => h(i < (p.alive ? p.hp : 0) ? 'i' : 'i.off')));
    e.hp.classList.toggle('low', p.alive && p.hp === 1 && p.maxHp > 1);
    e.rolls.textContent = `⟳ ${'●'.repeat(p.rolls)}${'○'.repeat(Math.max(0, PACIFIC.player.maxRolls - p.rolls))}`;
    e.gun.replaceChildren('SÚNG ', ...Array.from({ length: PACIFIC.player.maxWeapon }, (_, i) => h(i < p.weapon ? 'i' : 'i.off')), p.wingmen ? ` +${p.wingmen}` : '');
    const b = s.boss;
    const showBoss = !!b && (b.stage === 'enter' || b.stage === 'fight' || b.stage === 'escape');
    e.boss.classList.toggle('on', showBoss);
    if (b && showBoss) {
      e.bossName.textContent = b.stage === 'escape' ? `${b.def.name} — đang rút lui` : b.def.name;
      e.bossBar.style.width = `${Math.max(0, (b.hp / b.maxHp) * 100)}%`;
    }
  }

  banner(text: string, sub = '', kind: '' | 'warn' | 'gold' = '', ms = 2200): void {
    const b = this.el.banner;
    b.className = `pz-banner on ${kind}`;
    b.replaceChildren(text, sub ? h('small', {}, sub) : '');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('on'), ms);
  }

  popup(x: number, y: number, text: string, cls = ''): void {
    if (this.pops > 24) return;
    this.pops++;
    const p = h(`div.pz-pop${cls ? `.${cls}` : ''}`, { style: `left:${x.toFixed(0)}px;top:${y.toFixed(0)}px` }, text);
    this.el.pops.append(p);
    window.setTimeout(() => {
      p.remove();
      this.pops--;
    }, 900);
  }

  pickupText(kind: PickupKind): string {
    return PICK_TEXT[kind];
  }

  // ── screens ───────────────────────────────────────────────────────────────────────────────────

  hideScreens(): void {
    for (const s of Object.values(this.screens)) s.classList.remove('on');
  }

  private show(name: string, ...content: HTMLElement[]): void {
    this.hideScreens();
    const s = this.screens[name];
    s.replaceChildren(...content);
    s.classList.add('on');
    const go = s.querySelector<HTMLElement>('.pz-go');
    go?.focus({ preventScroll: true });
  }

  get screenOpen(): string | null {
    for (const [k, s] of Object.entries(this.screens)) if (s.classList.contains('on')) return k;
    return null;
  }

  showTitle(save: SaveData, selected: number, hd: TitleHandlers): void {
    const planes = (Object.keys(PACIFIC.planes) as PlaneId[]).map((id) => {
      const st = PACIFIC.planes[id];
      const bar = (label: string, v: number) => h('div.pz-stat', {}, h('span', {}, label), h('i', { style: `--v:${Math.round(v * 100)}%` }));
      const fire = (st.damage / st.fireInterval) / (1.25 / 0.085);
      return h(`button.pz-plane${save.plane === id ? '.sel' : ''}`, { onclick: () => hd.onPlane(id), type: 'button' },
        h('b', {}, st.name), h('em', {}, st.nick), h('p', {}, st.blurb),
        bar('Tốc độ', st.speed / 32), bar('Giáp', st.hp / 4), bar('Hỏa lực', fire), bar('Tập trung', 1 - st.spread * 0.6));
    });
    const diffs = (Object.keys(PACIFIC.difficulty) as Difficulty[]).map((d) =>
      h(`button${save.difficulty === d ? '.sel' : ''}`, { onclick: () => hd.onDifficulty(d), type: 'button' }, PACIFIC.difficulty[d].label));
    const levels = LEVELS.map((lv) => {
      const locked = lv.index > save.unlocked;
      return h(`button.pz-lv${selected === lv.index ? '.sel' : ''}`, { disabled: locked, type: 'button', onclick: () => { if (!locked) hd.onStart(lv.index); } },
        h('small', {}, `${lv.index + 1} · ${lv.date}`), h('b', {}, locked ? `🔒 ${lv.title}` : lv.title),
        h('span', {}, save.best[lv.index] ? `Tốt nhất ${fmt(save.best[lv.index])}` : lv.place));
    });
    const toggle = (what: 'muted' | 'music' | 'autoFire', on: boolean, label: string) =>
      h('button.pz-alt', { onclick: () => hd.onToggle(what), type: 'button' }, `${label}: ${on ? 'BẬT' : 'TẮT'}`);
    const card = h('div.pz-card', {},
      h('div.pz-logo', {}, h('h1', {}, 'BẮN MÁY BAY'), h('p', {}, 'Mặt trận Thái Bình Dương · 1941–1945')),
      h('div.pz-sec', {}, h('h3', {}, 'Máy bay'), h('div.pz-row', {}, ...planes)),
      h('div.pz-sec', {}, h('h3', {}, 'Độ khó'), h('div.pz-seg', {}, ...diffs)),
      h('div.pz-sec', {}, h('h3', {}, 'Chiến dịch — chọn trận để xuất kích'), h('div.pz-levels', {}, ...levels)),
      h('div.pz-actions.pz-sticky', {},
        h('button.pz-go', { onclick: () => hd.onStart(Math.min(save.unlocked, selected)), type: 'button' }, `Xuất kích ▶ Màn ${Math.min(save.unlocked, selected) + 1}`),
        h('button.pz-alt', { onclick: () => this.showHelp(() => this.showTitle(save, selected, hd)), type: 'button' }, 'Hướng dẫn'),
        toggle('muted', !save.muted, 'Âm thanh'), toggle('music', save.music, 'Nhạc'), toggle('autoFire', save.autoFire, 'Tự bắn')),
      h('div.pz-foot', {}, `Kỷ lục ${fmt(save.hiScore)} · Mọi mô hình, cảnh và âm thanh đều được tạo bằng mã (Three.js) · `,
        h('a', { href: './' }, 'Về Tater\'s Flight Sim')));
    this.show('title', card);
  }

  showHelp(back: () => void): void {
    const keys: [string[], string][] = [
      [['←', '↑', '→', '↓'], 'Bay (hoặc W A S D)'],
      [['Space'], 'Bắn (giữ) — hoặc J, Z; F bật/tắt tự bắn'],
      [['X'], 'Lộn vòng né đạn: bất tử ~1 giây, số lần có hạn (hoặc K, Shift)'],
      [['P'], 'Tạm dừng (hoặc Esc)'],
      [['M'], 'Bật/tắt âm thanh'],
    ];
    const legend = (Object.keys(PICK_TEXT) as PickupKind[]).map((k) =>
      h('span', {}, h('span.pz-coin', { style: `background:${PICK_COLOR[k]}` }, PICK_LETTER[k]), PICK_HELP[k]));
    const card = h('div.pz-card.narrow', {},
      h('div.pz-brief', {}, h('div.k', {}, 'Hướng dẫn'), h('h2', {}, 'Cách chơi')),
      h('div.pz-sec', {}, h('h3', {}, 'Bàn phím · tay cầm'), h('div.pz-keys', {}, ...keys.flatMap(([k, t]) => [h('div', {}, ...k.map((x) => h('kbd', {}, x))), h('div', {}, t)]))),
      h('div.pz-sec', {}, h('h3', {}, 'Màn hình cảm ứng'), h('p', {}, 'Kéo ngón tay ở bất kỳ đâu để lái — máy bay đi theo chuyển động của ngón tay và tự bắn. Chạm bằng ngón thứ hai hoặc nút LỘN để lộn vòng.')),
      h('div.pz-sec', {}, h('h3', {}, 'Vật phẩm'), h('div.pz-legend', {}, ...legend)),
      h('div.pz-sec', {}, h('h3', {}, 'Mẹo'), h('p', {},
        'Hạ toàn bộ một tốp máy bay để nhận vật phẩm. Bắn liên tục không bị trúng để tăng hệ số điểm (tối đa ×4). Phá tháp pháo, ụ phòng không và sàn phóng của boss trước — mỗi bộ phận bị phá cũng làm boss mất máu. Boss sẽ rút lui nếu không bị hạ sau gần hai phút.')),
      h('div.pz-actions', {}, h('button.pz-go', { onclick: back, type: 'button' }, 'Quay lại')));
    this.show('help', card);
  }

  showBriefing(lv: LevelDef, plane: PlaneId, onGo: () => void): void {
    const boss = BOSSES[lv.boss];
    const card = h('div.pz-card.narrow.pz-brief', {},
      h('div.k', {}, `Màn ${lv.index + 1} / ${LEVELS.length} · ${lv.date} · ${lv.env.light}`),
      h('h2', {}, lv.title),
      h('div.place', {}, `${lv.place} · Bạn lái ${PACIFIC.planes[plane].name}`),
      h('p', {}, lv.brief),
      h('div.box', {}, h('b', {}, 'Nhiệm vụ: '), lv.objective),
      h('div.box', {}, h('b', {}, `Mục tiêu chính — ${boss.name}: `), lv.bossIntel),
      h('div.box.fact', {}, h('b', {}, 'Bạn có biết? '), lv.fact),
      h('div.pz-actions', {}, h('button.pz-go', { onclick: onGo, type: 'button' }, 'Xuất kích ▶')),
      h('div.pz-foot', {}, this.touch ? 'Chạm nút để bắt đầu' : 'Enter hoặc Space để bắt đầu'));
    this.show('brief', card);
  }

  showResults(r: ResultInfo, onNext: () => void): void {
    const st = r.state.stats;
    const rows: [string, string][] = [
      ['Máy bay & tàu địch bị hạ', `${st.kills} / ${st.spawned}`],
      ['Độ chính xác', `${st.shots ? Math.round((st.hits / st.shots) * 100) : 0}%`],
      ['Mục tiêu chính', st.bossKilled ? `Đã tiêu diệt (${Math.round(st.bossTime)} s)` : 'Đã rút lui'],
      ...r.state.bonus.map((b: LevelBonus) => [b.label, `+${fmt(b.points)}`] as [string, string]),
    ];
    const card = h('div.pz-card.narrow.pz-brief', {},
      h('div.k', {}, `Màn ${r.level.index + 1} · ${r.level.date}`),
      h('h2', {}, st.bossKilled ? 'Nhiệm vụ hoàn thành' : 'Kết thúc trận'),
      h('div.place', {}, r.level.title),
      h('table.pz-table', {}, ...rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))),
        h('tr.total', {}, h('td', {}, 'Điểm màn này'), h('td', {}, fmt(r.levelScore))),
        h('tr.total', {}, h('td', {}, 'Tổng điểm'), h('td', {}, fmt(r.state.score)))),
      h('div.pz-actions', {}, h('button.pz-go', { onclick: onNext, type: 'button' }, r.last ? 'Kết thúc chiến dịch ▶' : `Màn ${r.level.index + 2} ▶`)));
    this.show('results', card);
  }

  showGameOver(lv: LevelDef, score: number, onRetry: () => void, onMenu: () => void): void {
    const card = h('div.pz-card.narrow.pz-brief', {},
      h('div.k', {}, `Màn ${lv.index + 1} · ${lv.title}`),
      h('h2', {}, 'Mất toàn bộ máy bay'),
      h('p', {}, `Điểm: ${fmt(score)}. Chơi lại màn này với đủ ba mạng (điểm tính lại từ 0), hoặc về sở chỉ huy chọn trận khác.`),
      h('div.pz-actions', {}, h('button.pz-go', { onclick: onRetry, type: 'button' }, 'Chơi lại màn ▶'), h('button.pz-alt', { onclick: onMenu, type: 'button' }, 'Về menu')));
    this.show('over', card);
  }

  showVictory(score: number, hi: number, onMenu: () => void): void {
    const card = h('div.pz-card.narrow.pz-brief', {},
      h('div.k', {}, '2/9/1945 · Vịnh Tokyo'),
      h('h2', {}, 'Chiến thắng'),
      h('p', {}, EPILOGUE),
      h('table.pz-table', {}, h('tr.total', {}, h('td', {}, 'Tổng điểm chiến dịch'), h('td', {}, fmt(score))), h('tr', {}, h('td', {}, 'Kỷ lục'), h('td', {}, fmt(hi)))),
      h('div.pz-actions', {}, h('button.pz-go', { onclick: onMenu, type: 'button' }, 'Về menu')));
    this.show('victory', card);
  }

  showPause(onResume: () => void, onRestart: () => void, onMenu: () => void): void {
    const card = h('div.pz-card.narrow.pz-brief', {},
      h('h2', {}, 'Tạm dừng'),
      h('div.pz-actions', {},
        h('button.pz-go', { onclick: onResume, type: 'button' }, 'Tiếp tục ▶'),
        h('button.pz-alt', { onclick: onRestart, type: 'button' }, 'Chơi lại màn'),
        h('button.pz-alt', { onclick: onMenu, type: 'button' }, 'Về menu')),
      h('div.pz-foot', {}, 'P / Esc: tiếp tục · M: âm thanh · F: tự bắn'));
    this.show('pause', card);
  }
}
