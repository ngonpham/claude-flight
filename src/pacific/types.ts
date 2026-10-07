/**
 * Shared shapes of "Pacific 1942" (the Bắn Máy Bay arcade game): enemy, boss and pick-up kinds,
 * movement patterns, gun patterns, the game state the pure simulation steps, and the events it
 * emits for the renderer, the sound and the HUD. Plain data only — no three.js, no DOM.
 *
 * Axes: playfield x right, y up the screen (the direction of flight). Heading 0 = flying up the
 * screen; positive headings turn clockwise (towards +x).
 */

export type PlaneId = 'p38' | 'f6f' | 'f4u';
export type Difficulty = 'easy' | 'normal' | 'hard';

export type EnemyKind =
  | 'zero' | 'oscar' | 'val' | 'kate' | 'betty' | 'frank' | 'george' | 'kamikaze' | 'ohka'
  | 'destroyer' | 'cruiser' | 'barge' | 'aaGun';

export type BossKind =
  | 'fuchida' | 'yubari' | 'shoho' | 'akagi' | 'hiei' | 'yamamoto' | 'emily' | 'musashi' | 'suribachi' | 'yamato';

export type PickupKind = 'pow' | 'wing' | 'roll' | 'repair' | 'medal';

export type DecorKind =
  | 'island' | 'atoll' | 'reef' | 'jungle' | 'fordIsland' | 'battleshipRow' | 'wakeAtoll' | 'midwayAtoll'
  | 'savo' | 'iwoJima' | 'coast' | 'usCarrier' | 'burningCarrier' | 'landingCraft' | 'wreck';

/** How an enemy moves. Every pattern except 'home' is a closed form of the enemy's age. */
export type Pattern =
  /** Straight line, optional sideways sine wobble and acceleration along the path. */
  | { type: 'line'; x0: number; y0: number; vx: number; vy: number; wobA?: number; wobF?: number; accel?: number }
  /** A cubic Bézier through four control points in `dur` s, then straight on along the end tangent. */
  | { type: 'bezier'; p: [number, number][]; dur: number }
  /** Fly down to yLoop, turn a full circle of radius r (dir +1 = loop to the right), fly on down. */
  | { type: 'loop'; x0: number; y0: number; speed: number; yLoop: number; r: number; dir: 1 | -1 }
  /** Slide down to yStop, hold there swaying for `hold` s, then leave with exitVy. */
  | { type: 'hover'; x0: number; y0: number; yStop: number; inT: number; hold: number; swayA: number; swayF: number; exitVy: number }
  /** Moves with the sea (plus its own vx, vy relative to the water). */
  | { type: 'ground'; x0: number; y0: number; vx: number; vy: number }
  /** Integrated: steers at the player at `speed`, `turn` rad/s, for `commit` s, then flies straight. */
  | { type: 'home'; x0: number; y0: number; speed: number; turn: number; commit: number; heading: number };

export type GunType = 'aimed' | 'spread' | 'ring' | 'spiral' | 'burst' | 'down' | 'spawn';

export interface GunDef {
  type: GunType;
  /** Seconds between volleys. */
  interval: number;
  /** Bullets per volley (spread, ring, burst, spiral arms). */
  count?: number;
  /** Total arc of a spread, rad. */
  arc?: number;
  /** Multiplies the base enemy bullet speed. */
  speed?: number;
  /** Seconds between the shots of a burst. */
  gap?: number;
  /** First shot no earlier than this after spawn / phase start. */
  delay?: number;
  /** Spiral turn per volley, rad. */
  twist?: number;
  /** 'spawn': which aircraft to launch. */
  spawn?: EnemyKind;
  /** Bullet look: 0 = small orange, 1 = big pink (heavy guns). */
  style?: 0 | 1;
}

export interface SpawnEvent {
  /** Seconds after the waves begin. */
  t: number;
  kind: EnemyKind;
  pattern: Pattern;
  /** Formation id: killing every member drops `drop`. 0 = no formation bonus. */
  group: number;
  drop: PickupKind | null;
  /** Turn the line pattern's velocity towards the player at spawn time. */
  aim?: boolean;
  /** Scenery that appears with this spawn, at its spawn point (gun sites sit on an island). */
  decor?: { kind: DecorKind; dx: number; dy: number; scale: number };
}

export interface DecorEvent {
  /** Scroll distance at which it appears at the top of the playfield. */
  at: number;
  kind: DecorKind;
  x: number;
  scale: number;
  rot: number;
  seed: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  style: number;
  alive: boolean;
}

export interface Enemy extends GunTimer {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** rad, 0 = up the screen. */
  heading: number;
  /** Turn rate (for banking), rad/s. */
  turnRate: number;
  age: number;
  hp: number;
  maxHp: number;
  pattern: Pattern;
  /** Scroll distance when spawned (ground patterns). */
  scroll0: number;
  group: number;
  drop: PickupKind | null;
  flash: number;
  /** Has been inside the playfield (only then may it leave and despawn). */
  entered: boolean;
  alive: boolean;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  age: number;
  x0: number;
  alive: boolean;
}

export interface Decor {
  id: number;
  kind: DecorKind;
  x: number;
  y: number;
  scale: number;
  rot: number;
  seed: number;
}

export interface BossPartDef {
  id: string;
  /** Offset from the boss centre, u (boss frame: +y = the boss's nose). */
  dx: number;
  dy: number;
  r: number;
  hp: number;
  score: number;
  /** Guns per phase (index 0, 1, 2); an empty list = silent in that phase. */
  guns: GunDef[][];
  /** Orbiting escorts: radius and angular speed (rad/s); dx/dy then give the start angle. */
  orbit?: { r: number; w: number };
  /** What the renderer draws: a turret of a size, an escort fighter, an engine, a bunker. */
  look: 'turret' | 'turretBig' | 'aa' | 'escort' | 'engine' | 'bunker' | 'deck' | 'bridge';
}

export interface BossDef {
  kind: BossKind;
  name: string;
  /** Ship / fortress (moves with the sea and stops the scroll) or an aircraft. */
  surface: boolean;
  hp: number;
  score: number;
  /** Hull circles (boss frame), the core hit area. */
  hull: { dx: number; dy: number; r: number }[];
  parts: BossPartDef[];
  /** The core's own guns per phase. */
  guns: GunDef[][];
  /** Where it settles (playfield y) and how it moves there. */
  holdY: number;
  swayX: number;
  swayY: number;
  swayW: number;
  /** Heading in rad (π = bow pointing down the screen towards the player). */
  heading: number;
  /** Visual scale for the model. */
  size: number;
}

/** The firing state of one gun. */
export interface GunTimer {
  fireT: number;
  burstLeft: number;
  burstT: number;
  spiral: number;
}

export interface BossPart {
  def: BossPartDef;
  hp: number;
  alive: boolean;
  /** One per gun of the current phase. */
  timers: GunTimer[];
  flash: number;
  /** Current position in the playfield (updated every step). */
  x: number;
  y: number;
  /** Where it aims (rad, playfield). */
  aim: number;
}

export type BossStage = 'enter' | 'fight' | 'dying' | 'escape' | 'gone';

export interface Boss {
  def: BossDef;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  t: number;
  stage: BossStage;
  stageT: number;
  phase: 0 | 1 | 2;
  parts: BossPart[];
  /** The core's guns of the current phase. */
  timers: GunTimer[];
  flash: number;
  /** Seconds of fighting (for the escape timer and the time bonus). */
  fightT: number;
}

export interface Player {
  plane: PlaneId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  lives: number;
  rolls: number;
  /** Seconds left in the evasive roll (0 = not rolling); rollCd blocks the next one. */
  roll: number;
  rollCd: number;
  invuln: number;
  weapon: number;
  wingmen: number;
  fireT: number;
  wingFireT: number;
  alive: boolean;
  respawnT: number;
  /** Visual bank, −1…1 (right wing down positive). */
  bank: number;
  flash: number;
}

export interface Input {
  /** Stick, −1…1 each (keyboard gives −1, 0, 1). */
  x: number;
  y: number;
  /** Absolute target in the playfield (touch / mouse drag); overrides the stick. */
  target: { x: number; y: number } | null;
  fire: boolean;
  /** Pressed this step (edge). */
  roll: boolean;
}

export type Phase = 'intro' | 'waves' | 'warning' | 'boss' | 'clear' | 'gameover';

export type GameEventType =
  | 'shot' | 'enemyShot' | 'hit' | 'kill' | 'partKill' | 'playerHit' | 'playerDown' | 'respawn' | 'wingmanDown'
  | 'pickup' | 'drop' | 'roll' | 'warning' | 'bossIn' | 'bossDown' | 'bossEscape' | 'clear' | 'gameover'
  | 'chain' | 'extraLife' | 'launch';

export interface GameEvent {
  type: GameEventType;
  x: number;
  y: number;
  /** Entity kind (enemy, boss, pick-up) where it applies. */
  kind?: string;
  /** Entity id (kills: the renderer turns that mesh into a wreck). */
  id?: number;
  /** Score awarded, chain length, … */
  n?: number;
  heading?: number;
  /** Surface unit (ship / ground) — sinks rather than falls. */
  surface?: boolean;
}

export interface LevelStats {
  shots: number;
  hits: number;
  kills: number;
  spawned: number;
  damageTaken: number;
  rollsUsed: number;
  bossTime: number;
  bossKilled: boolean;
}

export interface LevelBonus {
  label: string;
  points: number;
}

/** What carries over from one level to the next. */
export interface Carry {
  score: number;
  lives: number;
  hp: number;
  weapon: number;
  wingmen: number;
  rolls: number;
  nextExtraLife: number;
}

export interface GameState {
  level: number;
  difficulty: Difficulty;
  seed: number;
  rng: number;
  phase: Phase;
  phaseT: number;
  /** Seconds since the waves began. */
  t: number;
  /** Total real time in this level. */
  clock: number;
  scroll: number;
  scrollSpeed: number;
  player: Player;
  pBullets: Bullet[];
  eBullets: Bullet[];
  enemies: Enemy[];
  pickups: Pickup[];
  decor: Decor[];
  boss: Boss | null;
  schedule: SpawnEvent[];
  nextSpawn: number;
  decorSchedule: DecorEvent[];
  nextDecor: number;
  /** Formation bookkeeping: members still alive / killed by the player. */
  groups: Record<number, { total: number; left: number; killed: number; drop: PickupKind | null }>;
  score: number;
  nextExtraLife: number;
  chain: number;
  chainT: number;
  stats: LevelStats;
  bonus: LevelBonus[];
  events: GameEvent[];
  nextId: number;
  /** Test / attract-mode switch: the player cannot be hurt. */
  god: boolean;
  /** Level finished (boss down or escaped, bonus tallied, player flown off). */
  done: boolean;
}
