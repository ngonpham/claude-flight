/**
 * The game's 3D view: one three.js scene drawn from a fixed camera high behind the player, tilted a
 * little from straight down. It mirrors the simulation state every frame — aircraft, ships, the
 * boss and its parts, bullets, pick-ups, scenery — and turns the simulation's events into effects
 * (explosions, falling wrecks, sinking hulls, splashes, smoke), with cloud layers and the sea.
 *
 * Two layers share the playfield's coordinates. Aircraft fly on the plane y = AIR_Y. Everything on
 * the sea (ships, gun sites, islands, shadows, the ocean) lives in `sea`, a group scaled about the
 * camera position so that sea level projects exactly onto the aircraft plane: a ship under the
 * player on screen is under the player in the simulation, whatever the perspective.
 */
import * as THREE from 'three';
import { BOSSES } from '../bosses';
import { PACIFIC } from '../config';
import { ENEMIES } from '../enemies';
import type { LevelDef } from '../levels';
import { bossOffset, wingmanPos } from '../sim/game';
import type { Boss, BossPartDef, Decor, Enemy, GameEvent, GameState, PickupKind, PlaneId } from '../types';
import { Clouds, type ViewRect } from './clouds';
import { createOcean } from './ocean';
import { Particles } from './particles';
import { planeModel, type PlaneModel } from './planes';
import { decorModel, wakeShallow } from './scenery';
import { aaMountGeo, bossHullModel, bossPartY, enemyShipModel, partGeo } from './ships';

/** World height of the aircraft plane. */
export const AIR_Y = 24;
/** Aircraft are drawn this much larger than their ~0.25 u/m models, so they read on a phone. */
export const AIR_SCALE = 1.4;
const TILT = 0.4;
/** Camera distance of a 16:10 screen, the one the levels' fog densities are set for. */
const REF_DIST = 100;
const FOV = 38;

interface AirObj {
  kind: string;
  root: THREE.Group;
  body: THREE.Mesh;
  props: THREE.Mesh[];
  shadow: THREE.Mesh;
  model: PlaneModel;
  smokeT: number;
}

interface ShipObj {
  kind: string;
  root: THREE.Group;
  body: THREE.Mesh;
  wake: THREE.Mesh | null;
  mount: THREE.Mesh | null;
  funnels: THREE.Vector3[];
  smokeT: number;
}

interface Wreck {
  air: AirObj | null;
  ship: ShipObj | null;
  /** Air wrecks: world velocity; ship wrecks sink in place. */
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  t: number;
  smokeT: number;
}

interface BossObj {
  boss: Boss;
  root: THREE.Group;
  body: THREE.Mesh;
  wake: THREE.Mesh | null;
  parts: Map<string, THREE.Object3D>;
  escorts: Map<string, AirObj>;
  /** Prop disc of each engine part. */
  engineProps: Map<string, THREE.Mesh>;
  boomT: number;
  smokeT: number;
}

interface DecorObj {
  root: THREE.Group;
  smoke: THREE.Vector3[];
  fire: THREE.Vector3[];
  t: number;
}

interface Flare {
  light: THREE.PointLight;
  x: number;
  y: number;
  z: number;
  t: number;
}

const PICKUP_COLORS: Record<PickupKind, [number, string]> = {
  pow: [0xd8342c, 'P'],
  wing: [0x2f9e48, 'W'],
  roll: [0x2f6fd8, 'R'],
  repair: [0xf2f2ee, '+'],
  medal: [0xe8b828, '★'],
};

const bulletVert = /* glsl */ `
attribute float aStyle;
uniform float uScale;
varying float vStyle;
void main() {
  vStyle = aStyle;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp((aStyle > 0.5 ? 1.7 : 1.05) * uScale / max(0.1, -mv.z), 2.0, 96.0);
  gl_Position = projectionMatrix * mv;
}
`;
const bulletFrag = /* glsl */ `
varying float vStyle;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  vec3 core = vStyle > 0.5 ? vec3(1.0, 0.85, 0.95) : vec3(1.0, 0.97, 0.75);
  vec3 ring = vStyle > 0.5 ? vec3(0.95, 0.15, 0.55) : vec3(1.0, 0.42, 0.08);
  vec3 c = mix(core, ring, smoothstep(0.25, 0.55, r));
  c = mix(c, vec3(0.12, 0.02, 0.02), smoothstep(0.78, 0.92, r));
  gl_FragColor = vec4(c, 1.0 - smoothstep(0.92, 1.0, r));
  #include <colorspace_fragment>
}
`;

function letterTexture(letter: string, color: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const col = new THREE.Color(color);
  g.fillStyle = `#${col.getHexString()}`;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#fff6d8';
  g.stroke();
  g.fillStyle = letter === '+' || letter === '★' ? '#c0161e' : '#ffffff';
  if (letter === '★') g.fillStyle = '#7a3c00';
  g.font = 'bold 38px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
  /** Ground layer (scaled about the camera) and the sea-level frame inside it. */
  private readonly ground = new THREE.Group();
  readonly sea = new THREE.Group();
  private readonly air = new THREE.Group();
  private readonly ocean = createOcean();
  readonly particles = new Particles(3200);
  private readonly clouds = new Clouds(AIR_Y);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.5);
  private readonly hemi = new THREE.HemisphereLight(0xbcd8ff, 0x2a4a5a, 1);
  private readonly paint = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.08 });
  private readonly flashMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.08, emissive: 0xffe6b0, emissiveIntensity: 0.35 });
  private readonly shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false });
  private readonly propMat = new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  private readonly waterMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: true });
  private readonly discGeo = new THREE.CircleGeometry(1, 20);
  private readonly airPool = new Map<string, AirObj[]>();
  private readonly shipPool = new Map<string, ShipObj[]>();
  private readonly enemies = new Map<number, AirObj | ShipObj>();
  private readonly decor = new Map<number, DecorObj>();
  private readonly pickups = new Map<number, THREE.Group>();
  private readonly pickupMats = new Map<PickupKind, THREE.Material[]>();
  private readonly coinGeo = new THREE.CylinderGeometry(1, 1, 0.28, 24);
  private readonly ringGeo = new THREE.RingGeometry(1.25, 1.55, 28);
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private readonly wakeGeos = new Map<string, THREE.BufferGeometry | null>();
  private wrecks: Wreck[] = [];
  private player: AirObj | null = null;
  private wing: AirObj[] = [];
  private bossObj: BossObj | null = null;
  private readonly pBullets: THREE.InstancedMesh;
  private readonly eBullets: THREE.Points;
  private readonly eBulletPos: Float32Array;
  private readonly eBulletStyle: Float32Array;
  /** The player's hit point (bullet-hell style): bullets only count inside this small dot. */
  private readonly hitDot = new THREE.Mesh(
    new THREE.CircleGeometry(PACIFIC.player.radius * 0.8, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2), transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }),
  );
  private flares: Flare[] = [];
  private flareT = 0;
  private night = false;
  private time = 0;
  private shake = 0;
  private k = 1;
  private readonly basePos = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private width = 1;
  private height = 1;
  private shotFlashT = 0;
  private camDist = REF_DIST;
  private fogDensity = 0.004;

  constructor(container: HTMLElement, opts: { antialias?: boolean; pixelRatio?: number } = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: opts.antialias ?? true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(opts.pixelRatio ?? Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.ground, this.air, this.particles.group, this.clouds.group, this.sun, this.sun.target, this.hemi);
    this.ground.add(this.sea);
    this.sea.position.y = AIR_Y;
    this.sea.add(this.ocean.mesh);

    const bgeo = new THREE.BoxGeometry(0.17, 0.17, 1.9);
    const bmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.8) });
    this.pBullets = new THREE.InstancedMesh(bgeo, bmat, PACIFIC.caps.playerBullets);
    this.pBullets.count = 0;
    this.pBullets.frustumCulled = false;
    this.air.add(this.pBullets);

    const cap = PACIFIC.caps.enemyBullets;
    this.eBulletPos = new Float32Array(cap * 3);
    this.eBulletStyle = new Float32Array(cap);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(this.eBulletPos, 3).setUsage(THREE.DynamicDrawUsage));
    eg.setAttribute('aStyle', new THREE.BufferAttribute(this.eBulletStyle, 1).setUsage(THREE.DynamicDrawUsage));
    eg.setDrawRange(0, 0);
    this.eBullets = new THREE.Points(eg, new THREE.ShaderMaterial({ vertexShader: bulletVert, fragmentShader: bulletFrag, transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } } }));
    this.eBullets.frustumCulled = false;
    this.eBullets.renderOrder = 40;
    this.scene.add(this.eBullets);
    this.hitDot.renderOrder = 50;
    this.hitDot.visible = false;
    this.air.add(this.hitDot);

    for (const kind of Object.keys(PICKUP_COLORS) as PickupKind[]) {
      const [col, letter] = PICKUP_COLORS[kind];
      const side = new THREE.MeshStandardMaterial({ color: 0xd8c070, metalness: 0.6, roughness: 0.35 });
      const tex = letterTexture(letter, col);
      const face = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : col, map: tex, emissive: col, emissiveIntensity: 0.35, roughness: 0.4 });
      this.pickupMats.set(kind, [side, face, face]);
    }
    this.resize(container.clientWidth || 800, container.clientHeight || 600);
  }

  // ── camera and layers ─────────────────────────────────────────────────────────────────────────

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = `${this.width}px`;
    this.renderer.domElement.style.height = `${this.height}px`;
    this.fitCamera(this.width / this.height);
  }

  /** Place the camera so the whole playfield fits, centred, with room for the HUD. */
  private fitCamera(aspect: number): void {
    const cam = this.camera;
    cam.fov = FOV;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const W = PACIFIC.field.halfW, H = PACIFIC.field.halfH;
    const dir = new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT));
    const corners = [[-W, -H], [W, -H], [-W, H], [W, H]];
    const p = new THREE.Vector3();
    let tz = 0;
    const place = (d: number) => {
      for (let it = 0; it < 6; it++) {
        cam.position.set(0, AIR_Y, tz).addScaledVector(dir, d);
        cam.lookAt(0, AIR_Y, tz);
        cam.updateMatrixWorld();
        const top = p.set(0, AIR_Y, -H).project(cam).y;
        const bot = p.set(0, AIR_Y, H).project(cam).y;
        tz -= ((top + bot) / 2) * H * 0.5;
      }
    };
    const fits = (d: number) => {
      place(d);
      return corners.every(([x, y]) => {
        p.set(x, AIR_Y, -y).project(cam);
        return Math.abs(p.x) < 0.97 && p.y < 0.9 && p.y > -0.96;
      });
    };
    let lo = 20, hi = 900;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    place(hi);
    this.camDist = hi;
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = this.fogDensity * (REF_DIST / this.camDist);
    this.basePos.copy(cam.position);
    cam.updateMatrixWorld();
    const s = this.height / (2 * Math.tan((FOV * Math.PI) / 360));
    for (const mat of [this.eBullets.material as THREE.ShaderMaterial]) mat.uniforms.uScale.value = s * this.renderer.getPixelRatio();
  }

  /** The visible rectangle on the horizontal plane at world height y. */
  viewRect(y: number): ViewRect {
    const cam = this.camera;
    const r: ViewRect = { xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity };
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this.v.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
      const t = (y - cam.position.y) / Math.min(-1e-3, this.v.y);
      const x = cam.position.x + this.v.x * t, z = cam.position.z + this.v.z * t;
      r.xMin = Math.min(r.xMin, x);
      r.xMax = Math.max(r.xMax, x);
      r.zMin = Math.min(r.zMin, z);
      r.zMax = Math.max(r.zMax, z);
    }
    return r;
  }

  private updateLayers(): void {
    const C = this.camera.position;
    this.k = C.y / Math.max(1, C.y - AIR_Y);
    this.ground.scale.setScalar(this.k);
    this.ground.position.copy(C).multiplyScalar(1 - this.k);
    this.ground.updateMatrixWorld(true);
  }

  /** Playfield → world on the aircraft plane. */
  airWorld(x: number, y: number, out = new THREE.Vector3(), h = 0): THREE.Vector3 {
    return out.set(x, AIR_Y + h, -y);
  }

  /** Playfield → world at sea level (+ h). */
  seaWorld(x: number, y: number, out = new THREE.Vector3(), h = 0): THREE.Vector3 {
    return this.sea.localToWorld(out.set(x, h, -y));
  }

  /** Screen pixels of a playfield point (for HUD pop-ups). */
  project(x: number, y: number): { x: number; y: number } {
    this.airWorld(x, y, this.v2).project(this.camera);
    return { x: (this.v2.x * 0.5 + 0.5) * this.width, y: (-this.v2.y * 0.5 + 0.5) * this.height };
  }

  /** Screen pixels → playfield (on the aircraft plane). */
  screenToField(px: number, py: number): { x: number; y: number } {
    const cam = this.camera;
    this.v.set((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    const t = (AIR_Y - cam.position.y) / Math.min(-1e-3, this.v.y);
    return { x: cam.position.x + this.v.x * t, y: -(cam.position.z + this.v.z * t) };
  }

  // ── level set-up ──────────────────────────────────────────────────────────────────────────────

  setLevel(level: LevelDef, plane: PlaneId): void {
    this.clearAll();
    const env = level.env;
    this.scene.background = new THREE.Color(env.fogColor);
    // The haze is set for a landscape screen; a portrait one puts the camera further back.
    this.fogDensity = env.fog;
    this.scene.fog = new THREE.FogExp2(env.fogColor, env.fog * (REF_DIST / this.camDist));
    this.sunDir.set(...env.sun).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    this.sun.color.set(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.hemi.color.set(env.skyColor);
    this.hemi.groundColor.set(env.groundColor);
    this.hemi.intensity = env.hemiIntensity;
    this.renderer.toneMappingExposure = env.exposure;
    this.ocean.setLook({ deep: env.seaDeep, shallow: env.seaShallow, sky: env.fogColor, sunDir: env.sun, sunColor: env.sunColor, glint: env.glint });
    this.clouds.setLook(env.cloudsLow, env.cloudsHigh, env.cloudColor, env.rain, (y) => this.viewRect(y));
    this.night = env.sunIntensity < 1.5 && env.hemiIntensity < 0.8;
    this.player = this.makeAir(plane, AIR_SCALE);
    this.wing = [this.makeAir(plane, AIR_SCALE * 0.82), this.makeAir(plane, AIR_SCALE * 0.82)];
  }

  private clearAll(): void {
    for (const [, o] of this.enemies) this.releaseObj(o);
    this.enemies.clear();
    for (const w of this.wrecks) {
      if (w.air) this.releaseAir(w.air);
      if (w.ship) this.releaseShip(w.ship);
    }
    this.wrecks = [];
    for (const [, d] of this.decor) this.disposeDecor(d);
    this.decor.clear();
    for (const [, p] of this.pickups) this.air.remove(p);
    this.pickups.clear();
    this.disposeBoss();
    for (const o of [this.player, ...this.wing]) if (o) this.releaseAir(o);
    this.player = null;
    this.wing = [];
    for (const f of this.flares) this.scene.remove(f.light);
    this.flares = [];
    this.particles.clear();
  }

  // ── object pools ──────────────────────────────────────────────────────────────────────────────

  private makeAir(kind: string, scale = 1): AirObj {
    const pool = this.airPool.get(`${kind}:${scale}`);
    const reused = pool?.pop();
    if (reused) {
      reused.root.visible = true;
      reused.shadow.visible = true;
      reused.body.material = this.paint;
      for (const p of reused.props) p.visible = true;
      this.air.add(reused.root);
      this.sea.add(reused.shadow);
      return reused;
    }
    const model = planeModel(kind as Parameters<typeof planeModel>[0]);
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const body = new THREE.Mesh(model.geo, this.paint);
    root.add(body);
    const props = model.props.map((p) => {
      const d = new THREE.Mesh(this.discGeo, this.propMat);
      d.position.set(...p.pos);
      d.scale.setScalar(p.r);
      root.add(d);
      return d;
    });
    root.scale.setScalar(scale);
    const shadow = new THREE.Mesh(model.geo, this.shadowMat);
    shadow.rotation.order = 'YXZ';
    shadow.renderOrder = -4;
    this.air.add(root);
    this.sea.add(shadow);
    return { kind: `${kind}:${scale}`, root, body, props, shadow, model, smokeT: 0 };
  }

  private releaseAir(o: AirObj): void {
    this.air.remove(o.root);
    this.sea.remove(o.shadow);
    o.root.rotation.set(0, 0, 0);
    o.root.position.set(0, 0, 0);
    let pool = this.airPool.get(o.kind);
    if (!pool) this.airPool.set(o.kind, (pool = []));
    pool.push(o);
  }

  private wakeGeo(kind: string, len: number, beam: number): THREE.BufferGeometry | null {
    if (!this.wakeGeos.has(kind)) this.wakeGeos.set(kind, wakeShallow(len, beam, len * 1.2));
    return this.wakeGeos.get(kind) ?? null;
  }

  private makeShip(kind: Enemy['kind']): ShipObj {
    const pool = this.shipPool.get(kind);
    const reused = pool?.pop();
    if (reused) {
      reused.root.visible = true;
      reused.root.position.set(0, 0, 0);
      reused.root.rotation.set(0, 0, 0);
      reused.body.material = this.paint;
      if (reused.mount) reused.mount.visible = true;
      this.sea.add(reused.root);
      return reused;
    }
    const model = enemyShipModel(kind);
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const body = new THREE.Mesh(model.geo, this.paint);
    root.add(body);
    let wake: THREE.Mesh | null = null;
    if (kind !== 'aaGun') {
      const g = this.wakeGeo(kind, model.len, model.beam);
      if (g) {
        wake = new THREE.Mesh(g, this.waterMat);
        wake.renderOrder = -6;
        root.add(wake);
      }
    }
    let mount: THREE.Mesh | null = null;
    if (kind === 'aaGun') {
      mount = new THREE.Mesh(aaMountGeo(1.3), this.paint);
      mount.position.y = 0.15;
      root.add(mount);
    }
    this.sea.add(root);
    return { kind, root, body, wake, mount, funnels: model.funnels.map((f) => new THREE.Vector3(...f)), smokeT: 0 };
  }

  private releaseShip(o: ShipObj): void {
    this.sea.remove(o.root);
    let pool = this.shipPool.get(o.kind);
    if (!pool) this.shipPool.set(o.kind, (pool = []));
    pool.push(o);
  }

  private releaseObj(o: AirObj | ShipObj): void {
    if ('shadow' in o) this.releaseAir(o);
    else this.releaseShip(o);
  }

  private disposeDecor(d: DecorObj): void {
    this.sea.remove(d.root);
    d.root.traverse((c) => {
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    });
  }

  private disposeBoss(): void {
    const b = this.bossObj;
    if (!b) return;
    b.root.parent?.remove(b.root);
    for (const [, e] of b.escorts) this.releaseAir(e);
    this.bossObj = null;
  }

  // ── per-frame sync ────────────────────────────────────────────────────────────────────────────

  /** Mirror the state, play its events, advance the effects. `dt` is real seconds since last frame. */
  frame(s: GameState, events: readonly GameEvent[], dt: number): void {
    this.time += dt;
    // Camera shake (screen-space; the sea layer follows the camera so nothing slips).
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 1.6;
    this.camera.position.copy(this.basePos).add(this.v.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.4, (Math.random() - 0.5) * sh));
    this.camera.updateMatrixWorld();
    this.updateLayers();
    const drift = s.scrollSpeed * this.k;

    this.ocean.update(this.time, s.scroll);
    for (const e of events) this.playEvent(e);
    this.syncDecor(s, dt);
    this.syncPlayer(s);
    this.syncEnemies(s, dt);
    this.syncBoss(s, dt);
    this.syncBullets(s);
    this.syncPickups(s);
    this.updateWrecks(dt, drift);
    this.updateFlares(dt, drift);
    this.shotFlashT = Math.max(0, this.shotFlashT - dt);
    this.particles.update(dt, drift, (this.eBullets.material as THREE.ShaderMaterial).uniforms.uScale.value);
    this.clouds.update(dt, drift, (y) => this.viewRect(y), this.sunDir);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private placeAir(o: AirObj, x: number, y: number, heading: number, bank: number, alt = 0, pitch = 0): void {
    o.root.position.set(x, AIR_Y + alt, -y);
    o.root.rotation.set(pitch, -heading, bank);
    // Shadow: along the sun ray down to the sea, in sea-frame coordinates.
    const sy = Math.max(0.2, this.sunDir.y);
    this.v.set(x - (this.sunDir.x / sy) * (AIR_Y + alt), 0, -y - (this.sunDir.z / sy) * (AIR_Y + alt));
    this.sea.worldToLocal(this.v);
    o.shadow.position.set(this.v.x, 0.08, this.v.z);
    o.shadow.rotation.set(0, -heading, 0);
    const sc = o.root.scale.x;
    o.shadow.scale.set(sc * Math.cos(bank) / this.k, 0.01, sc / this.k);
  }

  private syncPlayer(s: GameState): void {
    const p = s.player;
    const o = this.player;
    if (!o) return;
    const show = p.alive && !(p.invuln > 0 && Math.floor(this.time * 14) % 2 === 0 && p.roll === 0);
    o.root.visible = show;
    o.shadow.visible = p.alive;
    this.hitDot.visible = p.alive && s.phase !== 'intro' && s.phase !== 'clear';
    this.hitDot.position.set(p.x, AIR_Y + 1.2, -p.y);
    if (p.alive) {
      let roll = -p.bank * PACIFIC.player.maxBank;
      let lift = 0;
      if (p.roll > 0) {
        const f = 1 - p.roll / PACIFIC.player.rollTime;
        roll += f * Math.PI * 2;
        lift = Math.sin(f * Math.PI) * 5;
      }
      o.root.scale.setScalar(AIR_SCALE * (1 + lift * 0.06));
      this.placeAir(o, p.x, p.y, 0, roll, lift, -p.vy * 0.004);
      if (p.flash > 0) o.body.material = this.flashMat;
      else o.body.material = this.paint;
    }
    for (let i = 0; i < this.wing.length; i++) {
      const w = this.wing[i];
      const on = p.alive && i < p.wingmen;
      w.root.visible = on;
      w.shadow.visible = on;
      if (on) {
        const q = wingmanPos(s, i);
        this.placeAir(w, q.x, q.y, 0, -p.bank * PACIFIC.player.maxBank * 0.8, -0.5);
      }
    }
  }

  private syncEnemies(s: GameState, dt: number): void {
    const seen = new Set<number>();
    for (const e of s.enemies) {
      if (!e.alive) continue;
      seen.add(e.id);
      const def = ENEMIES[e.kind];
      let o = this.enemies.get(e.id);
      if (!o) {
        o = def.surface ? this.makeShip(e.kind) : this.makeAir(e.kind, AIR_SCALE);
        this.enemies.set(e.id, o);
      }
      if ('shadow' in o) {
        const bank = Math.max(-1, Math.min(1, -e.turnRate * 0.35));
        this.placeAir(o, e.x, e.y, e.heading, bank, def.size > 1.5 ? 1 : 0);
        o.body.material = e.flash > 0 ? this.flashMat : this.paint;
        o.smokeT -= dt;
        if (e.hp < e.maxHp * 0.5 && o.smokeT <= 0) {
          o.smokeT = 0.06;
          this.airWorld(e.x, e.y, this.v);
          this.particles.emit('smoke', this.v.x, this.v.y, this.v.z, 0, 0.5, 0, 0.9, 1.1);
        }
        if (e.kind === 'ohka') {
          this.airWorld(e.x - Math.sin(e.heading) * 1, e.y - Math.cos(e.heading) * 1, this.v);
          this.particles.emit('fire', this.v.x, this.v.y, this.v.z, 0, 0, 0, 0.9, 0.18, false);
        }
      } else {
        o.root.position.set(e.x, 0, -e.y);
        o.root.rotation.set(0, -e.heading, 0);
        o.body.material = e.flash > 0 ? this.flashMat : this.paint;
        if (o.mount) o.mount.rotation.y = e.heading - Math.atan2(s.player.x - e.x, s.player.y - e.y);
        o.smokeT -= dt;
        if (o.smokeT <= 0 && o.funnels.length) {
          o.smokeT = 0.25;
          const f = o.funnels[Math.floor(Math.random() * o.funnels.length)];
          this.v.copy(f);
          o.root.localToWorld(this.v);
          this.particles.emit(e.hp < e.maxHp * 0.5 ? 'darkSmoke' : 'smoke', this.v.x, this.v.y, this.v.z, 0, 1, 0, 1.2, 2);
        }
      }
    }
    for (const [id, o] of this.enemies) {
      if (!seen.has(id)) {
        this.releaseObj(o);
        this.enemies.delete(id);
      }
    }
  }

  private syncDecor(s: GameState, dt: number): void {
    const seen = new Set<number>();
    for (const d of s.decor) {
      seen.add(d.id);
      let o = this.decor.get(d.id);
      if (!o) {
        o = this.buildDecor(d);
        this.decor.set(d.id, o);
      }
      o.root.position.set(d.x, 0, -d.y);
      o.t -= dt;
      if (o.t <= 0 && (o.smoke.length || o.fire.length)) {
        o.t = 0.14;
        for (const p of o.smoke) {
          this.v.copy(p);
          o.root.localToWorld(this.v);
          this.particles.emit('darkSmoke', this.v.x + (Math.random() - 0.5), this.v.y, this.v.z, 0.5, 2.2, 0, 2.2, 4.5);
        }
        for (const p of o.fire) {
          this.v.copy(p);
          o.root.localToWorld(this.v);
          this.particles.emit('fire', this.v.x, this.v.y, this.v.z, 0, 1.5, 0, 1.3, 0.5);
        }
      }
    }
    for (const [id, o] of this.decor) {
      if (!seen.has(id)) {
        this.disposeDecor(o);
        this.decor.delete(id);
      }
    }
  }

  private buildDecor(d: Decor): DecorObj {
    const m = decorModel(d.kind, d.seed, d.scale);
    const root = new THREE.Group();
    root.rotation.y = d.rot;
    const body = new THREE.Mesh(m.geo, this.paint);
    root.add(body);
    if (m.shallow) {
      const w = new THREE.Mesh(m.shallow, this.waterMat);
      w.renderOrder = -8;
      root.add(w);
    }
    this.sea.add(root);
    return { root, smoke: m.smoke.map((p) => new THREE.Vector3(...p)), fire: m.fire.map((p) => new THREE.Vector3(...p)), t: Math.random() * 0.2 };
  }

  // ── boss ──────────────────────────────────────────────────────────────────────────────────────

  private buildBoss(b: Boss): BossObj {
    const def = b.def;
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const parts = new Map<string, THREE.Object3D>();
    const escorts = new Map<string, AirObj>();
    const engineProps = new Map<string, THREE.Mesh>();
    let body: THREE.Mesh;
    let wake: THREE.Mesh | null = null;
    if (def.surface) {
      const hull = bossHullModel(def.kind);
      body = new THREE.Mesh(hull?.geo ?? new THREE.BoxGeometry(4, 1, 20), this.paint);
      root.add(body);
      if (hull && def.kind !== 'suribachi') {
        const g = this.wakeGeo(`boss:${def.kind}`, hull.len, hull.beam);
        if (g) {
          wake = new THREE.Mesh(g, this.waterMat);
          wake.renderOrder = -6;
          root.add(wake);
        }
      }
      for (const p of def.parts) {
        const g = partGeo(p.look, p.r);
        if (!g) continue;
        const mesh = new THREE.Mesh(g, this.paint);
        mesh.position.set(p.dx, bossPartY(def.kind, p.look), -p.dy);
        root.add(mesh);
        parts.set(p.id, mesh);
      }
      this.sea.add(root);
    } else {
      const kind = def.kind === 'fuchida' ? 'b5nLead' : def.kind === 'yamamoto' ? 'bettyLead' : 'emily';
      const model = planeModel(kind);
      body = new THREE.Mesh(model.geo, this.paint);
      root.add(body);
      const propMeshes = model.props.map((p) => {
        const d = new THREE.Mesh(this.discGeo, this.propMat);
        d.position.set(...p.pos);
        d.scale.setScalar(p.r);
        root.add(d);
        return d;
      });
      root.scale.setScalar(def.size);
      for (const p of def.parts) {
        if (p.look === 'escort') {
          escorts.set(p.id, this.makeAir('zero', AIR_SCALE));
        } else if (p.look === 'engine') {
          let best: THREE.Mesh | null = null, bd = Infinity;
          for (const d of propMeshes) {
            const dd = Math.abs(d.position.x * def.size - p.dx);
            if (dd < bd) {
              bd = dd;
              best = d;
            }
          }
          if (best) engineProps.set(p.id, best);
        } else {
          const mesh = new THREE.Mesh(aaMountGeo(1.2 / def.size), this.paint);
          mesh.position.set(p.dx / def.size, 0.45, -p.dy / def.size);
          root.add(mesh);
          parts.set(p.id, mesh);
        }
      }
      const shadow = new THREE.Mesh(model.geo, this.shadowMat);
      shadow.name = 'bossShadow';
      shadow.renderOrder = -4;
      this.sea.add(shadow);
      root.userData.shadow = shadow;
      this.air.add(root);
    }
    return { boss: b, root, body, wake, parts, escorts, engineProps, boomT: 0, smokeT: 0 };
  }

  private syncBoss(s: GameState, dt: number): void {
    const b = s.boss;
    if (!b || b.stage === 'gone') {
      if (this.bossObj && (!b || b !== this.bossObj.boss || b.stage === 'gone')) {
        const sh = this.bossObj.root.userData.shadow as THREE.Mesh | undefined;
        if (sh) this.sea.remove(sh);
        this.disposeBoss();
      }
      return;
    }
    if (!this.bossObj || this.bossObj.boss !== b) {
      this.disposeBoss();
      this.bossObj = this.buildBoss(b);
    }
    const o = this.bossObj;
    const def = b.def;
    o.body.material = b.flash > 0 ? this.flashMat : this.paint;
    const dying = b.stage === 'dying';
    const t = b.stageT;
    if (def.surface) {
      o.root.position.set(b.x, dying ? -Math.min(3, t * t * 0.25) : 0, -b.y);
      o.root.rotation.set(dying ? t * 0.02 : 0, -def.heading, dying ? Math.min(0.35, t * 0.09) : 0);
    } else {
      const fall = dying ? t * t * 2.2 : 0;
      o.root.position.set(b.x, AIR_Y + 1.5 - fall, -b.y);
      o.root.rotation.set(dying ? -t * 0.15 : 0, -def.heading, dying ? t * 0.9 : Math.cos(def.swayW * b.t) * -0.25);
      const shadow = o.root.userData.shadow as THREE.Mesh | undefined;
      if (shadow) {
        const sy = Math.max(0.2, this.sunDir.y);
        const alt = AIR_Y + 1.5 - fall;
        this.v.set(b.x - (this.sunDir.x / sy) * alt, 0, -b.y - (this.sunDir.z / sy) * alt);
        this.sea.worldToLocal(this.v);
        shadow.position.set(this.v.x, 0.08, this.v.z);
        shadow.rotation.set(0, -def.heading, 0);
        shadow.scale.set(def.size / this.k, 0.01, def.size / this.k);
        shadow.visible = alt > 0;
      }
    }
    for (const part of b.parts) {
      const pdef: BossPartDef = part.def;
      const mesh = o.parts.get(pdef.id);
      if (mesh) {
        mesh.visible = part.alive;
        mesh.rotation.y = def.heading - part.aim;
        if (part.alive && part.flash > 0 && mesh instanceof THREE.Mesh) mesh.material = this.flashMat;
        else if (mesh instanceof THREE.Mesh) mesh.material = this.paint;
      }
      const esc = o.escorts.get(pdef.id);
      if (esc) {
        if (part.alive) {
          const a = Math.atan2(pdef.dy, pdef.dx) + (pdef.orbit?.w ?? 0) * b.t;
          // Orbiting counter-clockwise: the escort heads along the tangent.
          const heading = Math.atan2(-Math.sin(a), Math.cos(a)) + (pdef.orbit && pdef.orbit.w < 0 ? Math.PI : 0);
          this.placeAir(esc, part.x, part.y, heading, -0.7);
          esc.body.material = part.flash > 0 ? this.flashMat : this.paint;
        } else {
          esc.root.visible = false;
          esc.shadow.visible = false;
        }
      }
      const prop = o.engineProps.get(pdef.id);
      if (prop) prop.visible = part.alive;
    }
    // Smoke from wrecked mounts and burning engines.
    o.smokeT -= dt;
    if (o.smokeT <= 0) {
      o.smokeT = 0.12;
      for (const part of b.parts) {
        if (part.alive || part.def.look === 'escort') continue;
        if (def.surface) this.seaWorld(part.x, part.y, this.v, 1);
        else this.airWorld(part.x, part.y, this.v);
        this.particles.emit('darkSmoke', this.v.x, this.v.y, this.v.z, 0, 1.5, 0, 1.6, 2.5);
        if (Math.random() < 0.5) this.particles.emit('fire', this.v.x, this.v.y, this.v.z, 0, 1, 0, 1, 0.4);
      }
    }
    if (dying) {
      o.boomT -= dt;
      if (o.boomT <= 0) {
        o.boomT = 0.12 + Math.random() * 0.12;
        const h = def.hull[Math.floor(Math.random() * def.hull.length)];
        const a = Math.random() * Math.PI * 2;
        const off = bossOffset(def.heading, h.dx, h.dy, { x: 0, y: 0 });
        const px = b.x + off.x + Math.cos(a) * h.r * 0.8;
        const py = b.y + off.y + Math.sin(a) * h.r * 0.8;
        if (def.surface) this.seaWorld(px, py, this.v, 1);
        else this.v.copy(o.root.position).add(this.v2.set(Math.cos(a) * h.r, 0, Math.sin(a) * h.r));
        this.particles.explode(this.v.x, this.v.y, this.v.z, 1.4);
        this.shake = Math.min(1.2, this.shake + 0.15);
      }
    }
  }

  // ── bullets and pick-ups ──────────────────────────────────────────────────────────────────────

  private syncBullets(s: GameState): void {
    let n = 0;
    for (const b of s.pBullets) {
      if (!b.alive || n >= PACIFIC.caps.playerBullets) continue;
      this.q.setFromEuler(this.e.set(0, -Math.atan2(b.vx, b.vy), 0));
      this.m.compose(this.v.set(b.x, AIR_Y + 0.3, -b.y), this.q, this.v2.set(b.style ? 0.8 : 1, 1, 1));
      this.pBullets.setMatrixAt(n++, this.m);
    }
    this.pBullets.count = n;
    this.pBullets.instanceMatrix.needsUpdate = true;
    let m = 0;
    for (const b of s.eBullets) {
      if (!b.alive || m >= PACIFIC.caps.enemyBullets) continue;
      this.eBulletPos[m * 3] = b.x;
      this.eBulletPos[m * 3 + 1] = AIR_Y + 0.5;
      this.eBulletPos[m * 3 + 2] = -b.y;
      this.eBulletStyle[m] = b.style;
      m++;
    }
    const g = this.eBullets.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aStyle as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, m);
  }

  private syncPickups(s: GameState): void {
    const seen = new Set<number>();
    for (const k of s.pickups) {
      if (!k.alive) continue;
      seen.add(k.id);
      let g = this.pickups.get(k.id);
      if (!g) {
        g = new THREE.Group();
        const coin = new THREE.Mesh(this.coinGeo, this.pickupMats.get(k.kind));
        coin.rotation.x = 0.35;
        const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
        ring.rotation.x = -Math.PI / 2;
        g.add(coin, ring);
        this.air.add(g);
        this.pickups.set(k.id, g);
      }
      g.position.set(k.x, AIR_Y + 1 + Math.sin(this.time * 3 + k.id) * 0.3, -k.y);
      g.children[0].rotation.y = this.time * 2.5;
      const pulse = 1 + 0.12 * Math.sin(this.time * 8);
      g.children[1].scale.setScalar(pulse);
      g.visible = k.age < PACIFIC.pickup.life - 3 || Math.floor(this.time * 8) % 2 === 0;
    }
    for (const [id, g] of this.pickups) {
      if (!seen.has(id)) {
        this.air.remove(g);
        this.pickups.delete(id);
      }
    }
  }

  // ── events and effects ────────────────────────────────────────────────────────────────────────

  private playEvent(e: GameEvent): void {
    const P = this.particles;
    switch (e.type) {
      case 'kill': {
        const o = e.id !== undefined ? this.enemies.get(e.id) : undefined;
        const def = ENEMIES[e.kind as Enemy['kind']];
        if (e.surface) {
          this.seaWorld(e.x, e.y, this.v, 0.8);
          P.explode(this.v.x, this.v.y, this.v.z, def.kind === 'aaGun' || def.kind === 'barge' ? 1.2 : 2);
          P.burst('darkSmoke', this.v.x, this.v.y, this.v.z, 6, 2, 3, 3);
          this.shake = Math.min(1, this.shake + 0.25);
        } else {
          this.airWorld(e.x, e.y, this.v);
          P.explode(this.v.x, this.v.y, this.v.z, def.size > 1.5 ? 2.2 : 1);
          this.shake = Math.min(1, this.shake + (def.size > 1.5 ? 0.3 : 0.08));
        }
        if (o && e.id !== undefined) {
          this.enemies.delete(e.id);
          if ('shadow' in o) {
            o.shadow.visible = false;
            this.wrecks.push({ air: o, ship: null, vx: Math.sin(e.heading ?? 0) * 8, vy: -2, vz: -Math.cos(e.heading ?? 0) * 8, spin: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 4), t: 0, smokeT: 0 });
          } else if (e.kind === 'aaGun') {
            this.releaseShip(o);
          } else {
            this.wrecks.push({ air: null, ship: o, vx: 0, vy: 0, vz: 0, spin: Math.random() < 0.5 ? -1 : 1, t: 0, smokeT: 0 });
          }
        }
        break;
      }
      case 'hit':
        if (e.surface) {
          this.seaWorld(e.x, e.y, this.v, 0.6);
          P.emit('flash', this.v.x, this.v.y, this.v.z, 0, 0, 0, 1.1, 0.08);
        } else {
          this.airWorld(e.x, e.y, this.v, 0.4);
          P.burst('spark', this.v.x, this.v.y, this.v.z, 2, 9, 0.25, 0.3);
          P.emit('flash', this.v.x, this.v.y, this.v.z, 0, 0, 0, 0.8, 0.06);
        }
        break;
      case 'partKill': {
        const surf = !!e.surface;
        if (surf) this.seaWorld(e.x, e.y, this.v, 1);
        else this.airWorld(e.x, e.y, this.v);
        P.explode(this.v.x, this.v.y, this.v.z, 1.6);
        this.shake = Math.min(1.2, this.shake + 0.3);
        if (e.kind === 'escort' && this.bossObj) {
          for (const [id, esc] of this.bossObj.escorts) {
            const part = this.bossObj.boss.parts.find((p) => p.def.id === id);
            if (part && !part.alive && esc.root.visible) {
              const copy = this.makeAir('zero', AIR_SCALE);
              copy.root.position.copy(esc.root.position);
              copy.root.rotation.copy(esc.root.rotation);
              copy.shadow.visible = false;
              esc.root.visible = false;
              this.wrecks.push({ air: copy, ship: null, vx: 0, vy: -2, vz: 4, spin: 4, t: 0, smokeT: 0 });
            }
          }
        }
        break;
      }
      case 'bossDown': {
        if (e.surface) this.seaWorld(e.x, e.y, this.v, 1.5);
        else this.airWorld(e.x, e.y, this.v);
        P.explode(this.v.x, this.v.y, this.v.z, 4);
        P.emit('flash', this.v.x, this.v.y + 2, this.v.z, 0, 0, 0, 30, 0.35);
        this.shake = 1.6;
        break;
      }
      case 'playerHit':
        this.airWorld(e.x, e.y, this.v);
        P.burst('spark', this.v.x, this.v.y, this.v.z, 10, 12, 0.35, 0.5);
        P.burst('smoke', this.v.x, this.v.y, this.v.z, 3, 2, 1.2, 1);
        this.shake = Math.min(1.2, this.shake + 0.45);
        break;
      case 'playerDown':
        this.airWorld(e.x, e.y, this.v);
        P.explode(this.v.x, this.v.y, this.v.z, 2.4);
        this.shake = 1.4;
        if (this.player) {
          const copy = this.makeAir(this.player.kind.split(':')[0], AIR_SCALE);
          copy.root.position.copy(this.player.root.position);
          copy.root.rotation.copy(this.player.root.rotation);
          copy.shadow.visible = false;
          this.wrecks.push({ air: copy, ship: null, vx: 0, vy: -1, vz: 6, spin: 5, t: 0, smokeT: 0 });
        }
        break;
      case 'wingmanDown':
        this.airWorld(e.x, e.y, this.v);
        P.explode(this.v.x, this.v.y, this.v.z, 1.2);
        break;
      case 'pickup':
        this.airWorld(e.x, e.y, this.v, 1);
        P.burst('glow', this.v.x, this.v.y, this.v.z, 16, 8, 0.6, 0.5);
        P.emit('flash', this.v.x, this.v.y, this.v.z, 0, 0, 0, 5, 0.2);
        break;
      case 'drop':
        this.airWorld(e.x, e.y, this.v, 1);
        P.emit('flash', this.v.x, this.v.y, this.v.z, 0, 0, 0, 4, 0.2);
        break;
      case 'shot':
        if (this.shotFlashT <= 0) {
          this.shotFlashT = 0.05;
          this.airWorld(e.x, e.y + 2.1, this.v, 0.3);
          P.emit('flash', this.v.x, this.v.y, this.v.z, 0, 0, 0, 1.4, 0.05, false);
        }
        break;
      case 'enemyShot':
        if (Math.random() < 0.6) {
          this.airWorld(e.x, e.y, this.v, 0.5);
          P.emit('glow', this.v.x, this.v.y, this.v.z, 0, 0, 0, e.n ? 2.2 : 1.3, 0.12, false);
        }
        break;
      case 'launch':
        this.seaWorld(e.x, e.y, this.v, 2);
        P.burst('smoke', this.v.x, this.v.y, this.v.z, 3, 2, 1, 1);
        break;
      case 'respawn':
        this.airWorld(e.x, e.y, this.v);
        P.burst('glow', this.v.x, this.v.y, this.v.z, 20, 10, 0.6, 0.6);
        break;
      default:
        break;
    }
  }

  private updateWrecks(dt: number, drift: number): void {
    const keep: Wreck[] = [];
    for (const w of this.wrecks) {
      w.t += dt;
      w.smokeT -= dt;
      if (w.air) {
        const r = w.air.root;
        w.vy -= 16 * dt;
        r.position.x += w.vx * dt;
        r.position.y += w.vy * dt;
        r.position.z += (w.vz + drift) * dt;
        r.rotation.z += w.spin * dt;
        r.rotation.x -= 0.6 * dt;
        if (w.smokeT <= 0) {
          w.smokeT = 0.04;
          this.particles.emit('darkSmoke', r.position.x, r.position.y, r.position.z, 0, 0, 0, 1.2, 1.4);
          this.particles.emit('fire', r.position.x, r.position.y, r.position.z, 0, 0, 0, 0.9, 0.25);
        }
        if (r.position.y <= 0.2) {
          this.particles.splash(r.position.x, r.position.z, 1.2);
          this.releaseAir(w.air);
          continue;
        }
      } else if (w.ship) {
        const r = w.ship.root;
        r.position.y -= dt * (0.15 + w.t * 0.25);
        r.rotation.z += w.spin * dt * 0.08;
        r.rotation.x += dt * 0.03;
        if (w.ship.wake) w.ship.wake.visible = false;
        if (w.smokeT <= 0) {
          w.smokeT = 0.1;
          this.v.set(0, 1, 0);
          r.localToWorld(this.v);
          this.particles.emit('darkSmoke', this.v.x, Math.max(0.5, this.v.y), this.v.z, 0, 2, 0, 2.2, 3);
          if (w.t < 2) this.particles.emit('fire', this.v.x, Math.max(0.5, this.v.y), this.v.z, 0, 1, 0, 1.4, 0.4);
        }
        if (w.t > 4) {
          if (w.ship.wake) w.ship.wake.visible = true;
          this.releaseShip(w.ship);
          continue;
        }
      }
      keep.push(w);
    }
    this.wrecks = keep;
  }

  private updateFlares(dt: number, drift: number): void {
    if (!this.night) return;
    this.flareT -= dt;
    if (this.flareT <= 0 && this.flares.length < 3) {
      this.flareT = 4 + Math.random() * 4;
      const r = this.viewRect(AIR_Y * 1.5);
      const light = new THREE.PointLight(0xffe2b0, 900, 90, 1.6);
      const f: Flare = { light, x: r.xMin + (r.xMax - r.xMin) * (0.2 + Math.random() * 0.6), y: AIR_Y * 1.5, z: r.zMin + (r.zMax - r.zMin) * (0.15 + Math.random() * 0.4), t: 0 };
      this.scene.add(light);
      this.flares.push(f);
    }
    this.flares = this.flares.filter((f) => {
      f.t += dt;
      f.y -= 1.2 * dt;
      f.z += drift * dt;
      const life = 9;
      const k = Math.min(1, f.t * 2) * Math.max(0, 1 - Math.max(0, f.t - life + 2) / 2);
      f.light.position.set(f.x, f.y, f.z);
      f.light.intensity = 900 * k * (0.85 + 0.15 * Math.sin(f.t * 23));
      if (Math.random() < 0.5) this.particles.emit('glow', f.x, f.y, f.z, 0, 0, 0, 2.6 * k + 0.2, 0.15);
      if (Math.random() < 0.2) this.particles.emit('smoke', f.x, f.y + 0.5, f.z, 0, 0.5, 0, 0.8, 2);
      if (f.t > life) {
        this.scene.remove(f.light);
        f.light.dispose();
        return false;
      }
      return true;
    });
  }

  /** Debug numbers for the developer overlay and tests. */
  stats(): { calls: number; triangles: number; particles: number; enemies: number; decor: number } {
    const i = this.renderer.info.render;
    return { calls: i.calls, triangles: i.triangles, particles: this.particles.count, enemies: this.enemies.size, decor: this.decor.size };
  }

  dispose(): void {
    this.clearAll();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Every boss draws something: used by tests to check each boss has a model. */
export function bossHasModel(kind: keyof typeof BOSSES): boolean {
  return BOSSES[kind].surface ? bossHullModel(kind) !== null : true;
}
