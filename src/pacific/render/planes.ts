/**
 * Procedural aircraft of the Pacific War, built with the modelling kit at about 0.25 field units
 * per metre (fighters a little chunkier, so they read from above): the player's P-38 Lightning,
 * F6F Hellcat and F4U Corsair, and the Japanese A6M Zero (early and late/kamikaze), Ki-43 Oscar,
 * D3A Val, B5N Kate, G4M Betty, Ki-84 Frank, N1K2 George, the Ōka rocket bomb and the H8K
 * Emily flying boat.
 *
 * Paint schemes follow the record: early carrier Zeros in light grey-green "ameiro", army fighters
 * with yellow leading-edge ID stripes, late-war dark green with white-bordered hinomaru; US Navy
 * glossy sea blue with the star-and-bar on the left upper wing only, the P-38 in olive drab.
 */
import type * as THREE from 'three';
import type { EnemyKind, PlaneId } from '../types';
import { Kit, starPoints, type Paint, type V3 } from './kit';

export interface PlaneModel {
  geo: THREE.BufferGeometry;
  /** Propeller hubs (model frame) and blur-disc radius. */
  props: { pos: V3; r: number }[];
  /** Hot spots (rocket motor). */
  glow: V3[];
  /** Half span, u. */
  semi: number;
}

const RED = 0xb3121c;
const WHITE = 0xe9e6dc;
const US_BLUE = 0x1b2c5a;
const GLASS = 0x9cc6d8;
const FRAME = 0x2a2a2a;

type Insignia = 'jp' | 'jpWhite' | 'us';

interface FighterSpec {
  len: number;
  r: number;
  noseR: number;
  noseLen: number;
  span: number;
  root: number;
  tip: number;
  sweep: number;
  wingS: number;
  wingY: number;
  dihedral: number;
  /** Inverted-gull inner panel (fraction of the semi-span) — the Corsair. */
  gull?: number;
  tailSpan: number;
  tailChord: number;
  finH: number;
  finChord: number;
  canopyS: number;
  canopyLen: number;
  canopyR: number;
  top: number;
  under: number;
  cowl: number;
  insignia: Insignia;
  /** Leading-edge ID stripe (Japanese army / late navy). */
  stripe?: number;
  /** Tail colour (a command aircraft). */
  tailColor?: number;
  /** Fuselage band. */
  band?: number;
  spats?: boolean;
  bomb?: boolean;
  torpedo?: boolean;
  /** Rounded wing tips. */
  roundTips?: boolean;
  propR?: number;
  /** Pointed nose, no propeller (the Ōka). */
  rocket?: boolean;
}

/** Top / under paint by face normal. */
function twoTone(top: number, under: number, split = -0.15): Paint {
  return (n) => (n.y > split ? top : under);
}

/** A half-wing planform (right side), root at x = 0, leading edge at z = 0. */
function halfWing(semi: number, root: number, tip: number, sweep: number, round: boolean): [number, number][] {
  const pts: [number, number][] = [[0, 0], [semi * 0.9, sweep * 0.9]];
  if (round) {
    pts.push([semi, sweep + tip * 0.25], [semi, sweep + tip * 0.7], [semi * 0.94, sweep + tip]);
  } else pts.push([semi, sweep], [semi, sweep + tip]);
  pts.push([0, root]);
  return pts;
}

function insignia(k: Kit, kind: Insignia, x: number, y: number, z: number, r: number, roll: number): void {
  if (kind === 'us') {
    k.disc(r, US_BLUE, [x, y, z], [0, 0, roll]);
    k.plate(starPoints(r * 0.92), 0.02, WHITE, [x, y + 0.012, z], [0, 0, roll]);
    k.box(r * 0.95, 0.02, r * 0.55, WHITE, [x - r * 1.35, y + Math.sin(-roll) * r * 1.35, z], [0, 0, roll]);
    k.box(r * 0.95, 0.02, r * 0.55, WHITE, [x + r * 1.35, y + Math.sin(roll) * r * 1.35, z], [0, 0, roll]);
    return;
  }
  if (kind === 'jpWhite') k.disc(r * 1.18, WHITE, [x, y - 0.004, z], [0, 0, roll]);
  k.disc(r, RED, [x, y + 0.004, z], [0, 0, roll]);
}

/** A single-engine propeller aircraft (or the Ōka). */
function fighter(sp: FighterSpec): PlaneModel {
  const k = new Kit();
  const L = sp.len;
  const z0 = -L / 2;
  const nose = (s: number) => z0 + s;
  const noseEnd = nose(sp.noseLen);
  const body: Paint = (n, c) => {
    if (!sp.rocket && c.z < noseEnd) return sp.cowl;
    if (sp.tailColor && c.z > L / 2 - sp.tailChord * 1.6) return sp.tailColor;
    if (sp.band && Math.abs(c.z - (L * 0.18)) < 0.09) return sp.band;
    return n.y > -0.25 ? sp.top : sp.under;
  };
  // Fuselage, tail to nose (s measured forward of the centre).
  const prof: [number, number][] = [
    [-L / 2, sp.r * 0.15],
    [-L / 2 + L * 0.12, sp.r * 0.45],
    [-L * 0.1, sp.r * 0.85],
    [L / 2 - sp.wingS - sp.root * 0.5, sp.r],
    [L / 2 - sp.noseLen, sp.noseR],
    [L / 2 - 0.04, sp.noseR * (sp.rocket ? 0.5 : 0.92)],
    [L / 2, sp.rocket ? 0.02 : sp.noseR * 0.55],
  ];
  k.lathe(prof, body, 10);
  if (!sp.rocket) k.cyl(0.02, sp.noseR * 0.35, 0.18, 8, 0x3a3a3a, [0, 0, z0 - 0.06], [-Math.PI / 2, 0, 0]);
  // Canopy.
  k.sphere(1, (n, c) => (Math.abs(c.z - nose(sp.canopyS + sp.canopyLen / 2)) % 0.22 < 0.03 ? FRAME : GLASS),
    [0, sp.r * 0.72, nose(sp.canopyS + sp.canopyLen / 2)], [sp.canopyR, sp.canopyR * 0.95, sp.canopyLen / 2], 8, 5);

  // Wings.
  const semi = sp.span / 2;
  const zLE = nose(sp.wingS);
  const t = 0.07;
  const wingPaint = (side: number): Paint => (n, c) => {
    if (n.y <= 0) return sp.under;
    const x = Math.abs(c.x);
    const le = zLE + (sp.sweep * x) / semi;
    if (sp.stripe && c.z < le + 0.13 && x > semi * 0.3) return sp.stripe;
    void side;
    return sp.top;
  };
  for (const side of [1, -1]) {
    const pts = halfWing(semi, sp.root, sp.tip, sp.sweep, !!sp.roundTips).map(([x, z]) => [x * side, z] as [number, number]);
    if (side < 0) pts.reverse();
    if (sp.gull) {
      // Inverted gull: the inner panel droops (anhedral), the outer panel rises from its end.
      const g = semi * sp.gull;
      const angIn = 0.32, angOut = 0.18;
      const baseZ = (sp.sweep * g) / semi;
      const chordG = sp.root - ((sp.root - sp.tip) * g) / semi;
      const innerPts: [number, number][] = side > 0
        ? [[0, 0], [g, baseZ], [g, baseZ + chordG], [0, sp.root]]
        : [[0, sp.root], [-g, baseZ + chordG], [-g, baseZ], [0, 0]];
      k.plate(innerPts, t, wingPaint(side), [0, sp.wingY, zLE], [0, 0, -side * angIn]);
      const outer = pts.filter(([x]) => Math.abs(x) > g + 1e-6).map(([x, z]) => [x - side * g, z] as [number, number]);
      const outerPts: [number, number][] = side > 0 ? [[0, baseZ], ...outer, [0, baseZ + chordG]] : [[0, baseZ + chordG], ...outer, [0, baseZ]];
      k.plate(outerPts, t, wingPaint(side), [side * g * Math.cos(angIn), sp.wingY - g * Math.sin(angIn), zLE], [0, 0, side * angOut]);
    } else {
      k.plate(pts, t, wingPaint(side), [0, sp.wingY, zLE], [0, 0, side * sp.dihedral]);
    }
    // Insignia: Japanese on both upper wings; US star on the left upper wing only.
    if (sp.insignia !== 'us' || side < 0) {
      const xi = side * semi * 0.62;
      const g = semi * (sp.gull ?? 0);
      const yi = sp.gull
        ? sp.wingY - g * Math.sin(0.32) + (Math.abs(xi) - g * Math.cos(0.32)) * Math.tan(0.18) + t / 2 + 0.012
        : sp.wingY + Math.tan(sp.dihedral) * Math.abs(xi) + t / 2 + 0.012;
      const ci = sp.root - ((sp.root - sp.tip) * 0.62);
      insignia(k, sp.insignia, xi, yi, zLE + sp.sweep * 0.62 + ci * 0.5, Math.min(0.24, ci * 0.33), side * (sp.gull ? 0.18 : sp.dihedral));
    }
    if (sp.spats) k.sphere(1, sp.under, [side * semi * 0.28, sp.wingY - 0.28, zLE + sp.root * 0.35], [0.1, 0.18, 0.2], 6, 4);
  }
  // Tail.
  const zT = L / 2 - sp.tailChord * 1.05;
  const tailPaint: Paint = sp.tailColor ? (n) => (n.y > 0 ? sp.tailColor! : sp.under) : twoTone(sp.top, sp.under, 0);
  const ts = sp.tailSpan / 2;
  k.plate([[0, 0], [ts, sp.tailChord * 0.25], [ts, sp.tailChord * 0.8], [0, sp.tailChord]], 0.05, tailPaint, [0, 0.02, zT]);
  k.plate([[-ts, sp.tailChord * 0.8], [-ts, sp.tailChord * 0.25], [0, 0], [0, sp.tailChord]], 0.05, tailPaint, [0, 0.02, zT]);
  const fc = sp.finChord;
  k.plate([[0, fc], [0, 0], [sp.finH, fc * 0.55], [sp.finH, fc * 0.95]], 0.05, sp.tailColor ?? sp.top, [0, sp.r * 0.5, L / 2 - fc * 1.05], [0, 0, Math.PI / 2]);
  if (sp.rocket) {
    for (const s of [1, -1]) k.plate([[0, fc], [0, 0], [sp.finH, fc * 0.4], [sp.finH, fc]], 0.04, sp.top, [s * ts, 0, L / 2 - fc], [0, 0, Math.PI / 2]);
  }
  if (sp.bomb) k.tube(0.09, 0.07, 0.75, 8, 0x2b2b2b, [0, -sp.r - 0.08, zLE + 0.3]);
  if (sp.torpedo) k.tube(0.07, 0.06, 1.3, 8, 0x4b4f52, [0, -sp.r - 0.06, zLE + 0.35]);
  return {
    geo: k.build(),
    props: sp.rocket ? [] : [{ pos: [0, 0, z0 - 0.1], r: sp.propR ?? semi * 0.33 }],
    glow: sp.rocket ? [[0, 0, L / 2 + 0.05]] : [],
    semi,
  };
}

// ── single-engine types ─────────────────────────────────────────────────────────────────────────

const ZERO: FighterSpec = {
  len: 2.7, r: 0.24, noseR: 0.28, noseLen: 0.45, span: 3.5, root: 0.78, tip: 0.36, sweep: 0.14, wingS: 0.8, wingY: -0.12, dihedral: 0.1,
  tailSpan: 1.35, tailChord: 0.36, finH: 0.45, finChord: 0.48, canopyS: 1.0, canopyLen: 0.8, canopyR: 0.17, top: 0xb8b39a, under: 0xc4c0a8,
  cowl: 0x1d1d1d, insignia: 'jp', roundTips: true,
};

export const PLANE_SPECS: Record<EnemyKind | PlaneId | 'emily' | 'b5nLead' | 'bettyLead', FighterSpec | null> = {
  zero: ZERO,
  kamikaze: { ...ZERO, top: 0x2d3b28, under: 0x9a9a8a, insignia: 'jpWhite', bomb: true, stripe: 0xd9a020 },
  oscar: {
    ...ZERO, len: 2.6, span: 3.3, root: 0.66, tip: 0.34, sweep: 0.08, noseR: 0.27, top: 0x55603a, under: 0xa5a68e, cowl: 0x2a2a28, insignia: 'jpWhite',
    stripe: 0xdfa424, canopyLen: 0.7,
  },
  val: {
    ...ZERO, len: 3.05, r: 0.26, span: 4.2, root: 0.9, tip: 0.42, sweep: 0.1, wingS: 0.85, top: 0xb2af9b, under: 0xbfbca8, cowl: 0x222222,
    spats: true, bomb: true, canopyS: 0.95, canopyLen: 1.15, tailSpan: 1.5, roundTips: true,
  },
  kate: {
    ...ZERO, len: 3.2, r: 0.27, span: 4.4, root: 0.95, tip: 0.45, sweep: 0.1, wingS: 0.9, top: 0x3d4b32, under: 0xb0b0a0, cowl: 0x1e1e1e,
    torpedo: true, canopyS: 0.9, canopyLen: 1.45, tailSpan: 1.6, finH: 0.55,
  },
  b5nLead: {
    ...ZERO, len: 3.2, r: 0.27, span: 4.4, root: 0.95, tip: 0.45, sweep: 0.1, wingS: 0.9, top: 0x3d4b32, under: 0xb0b0a0, cowl: 0x1e1e1e,
    canopyS: 0.9, canopyLen: 1.45, tailSpan: 1.6, finH: 0.55, tailColor: 0xb3121c, band: 0xd8b020,
  },
  frank: {
    ...ZERO, len: 2.85, r: 0.25, noseR: 0.3, span: 3.4, root: 0.75, tip: 0.38, sweep: 0.06, top: 0x3b4a2c, under: 0xb4b6b4, insignia: 'jpWhite',
    stripe: 0xdfa424, roundTips: false, canopyS: 1.05,
  },
  george: {
    ...ZERO, len: 2.75, r: 0.27, noseR: 0.31, span: 3.6, root: 0.8, tip: 0.4, sweep: 0.05, wingY: -0.02, top: 0x2b392a, under: 0xa8aa9e, insignia: 'jpWhite',
    stripe: 0xdfa424, roundTips: false,
  },
  ohka: {
    ...ZERO, len: 1.75, r: 0.18, noseR: 0.16, noseLen: 0.4, span: 1.5, root: 0.4, tip: 0.32, sweep: 0.02, wingS: 0.75, wingY: 0, dihedral: 0, tailSpan: 0.7,
    tailChord: 0.25, finH: 0.25, finChord: 0.3, canopyS: 0.55, canopyLen: 0.35, canopyR: 0.11, top: 0xa39f90, under: 0xb5b2a4, insignia: 'jpWhite',
    rocket: true, roundTips: false,
  },
  f6f: {
    len: 3.05, r: 0.31, noseR: 0.33, noseLen: 0.5, span: 3.95, root: 0.92, tip: 0.48, sweep: 0.06, wingS: 0.8, wingY: -0.16, dihedral: 0.1,
    tailSpan: 1.5, tailChord: 0.4, finH: 0.55, finChord: 0.55, canopyS: 1.05, canopyLen: 0.75, canopyR: 0.19, top: 0x22314f, under: 0x2a3a58,
    cowl: 0x22314f, insignia: 'us', propR: 0.62,
  },
  f4u: {
    len: 3.15, r: 0.27, noseR: 0.31, noseLen: 0.62, span: 3.95, root: 0.88, tip: 0.44, sweep: 0.05, wingS: 0.95, wingY: -0.12, dihedral: 0.12, gull: 0.32,
    tailSpan: 1.45, tailChord: 0.38, finH: 0.55, finChord: 0.55, canopyS: 1.45, canopyLen: 0.65, canopyR: 0.17, top: 0x2a3d5e, under: 0x3a4c6c,
    cowl: 0x2a3d5e, insignia: 'us', propR: 0.66,
  },
  // Built by their own functions below.
  p38: null, betty: null, bettyLead: null, emily: null, destroyer: null, cruiser: null, barge: null, aaGun: null,
};

// ── multi-engine aircraft ────────────────────────────────────────────────────────────────────────

/** Lockheed P-38 Lightning: central nacelle, twin booms with the engines, twin fins. */
function p38(): PlaneModel {
  const k = new Kit();
  const OD = 0x58593a, GREY = 0x8e918e;
  const tt = twoTone(OD, GREY, -0.2);
  const boomX = 0.78;
  // Central nacelle (cockpit and nose guns).
  k.lathe([[-0.55, 0.1], [-0.2, 0.22], [0.5, 0.25], [1.05, 0.2], [1.3, 0.08]], tt, 10);
  k.sphere(1, GLASS, [0, 0.2, -0.45], [0.16, 0.15, 0.38], 8, 5);
  // Booms: engine cowl, turbo-supercharger hump, tail.
  for (const s of [1, -1]) {
    k.lathe([[-1.95, 0.07], [-1.4, 0.13], [-0.2, 0.18], [0.7, 0.22], [1.1, 0.22], [1.3, 0.14]], tt, 9, [s * boomX, -0.02, 0]);
    k.sphere(1, 0x6b6b5a, [s * boomX, 0.17, 0.05], [0.09, 0.06, 0.3], 6, 4);
    // Oval fins at the boom ends.
    k.sphere(1, OD, [s * boomX, 0.2, 1.85], [0.04, 0.38, 0.32], 6, 6);
  }
  // Tailplane between the booms.
  k.plate([[-boomX - 0.12, 0], [boomX + 0.12, 0], [boomX + 0.12, 0.34], [-boomX - 0.12, 0.34]], 0.05, tt, [0, 0.05, 1.68]);
  // Wing: straight taper, through the booms.
  const semi = 2.45;
  for (const side of [1, -1]) {
    const pts: [number, number][] = side > 0 ? [[0, 0], [semi, 0.12], [semi, 0.48], [0, 0.8]] : [[0, 0.8], [-semi, 0.48], [-semi, 0.12], [0, 0]];
    k.plate(pts, 0.07, (n) => (n.y > 0 ? OD : GREY), [0, -0.02, -0.25], [0, 0, side * 0.03]);
  }
  insignia(k, 'us', -1.75, 0.04, 0.05, 0.2, -0.03);
  // White recognition tips on the fins and spinners.
  return { geo: k.build(), props: [{ pos: [boomX, -0.02, -1.97], r: 0.58 }, { pos: [-boomX, -0.02, -1.97], r: 0.58 }], glow: [], semi };
}

interface MultiSpec {
  len: number;
  r: number;
  /** Cross-section height / width (a flying-boat hull is deep). */
  deep: number;
  span: number;
  root: number;
  tip: number;
  sweep: number;
  wingS: number;
  wingY: number;
  engines: { x: number; r: number; len: number }[];
  tailSpan: number;
  finH: number;
  top: number;
  under: number;
  floats?: boolean;
}

/** A multi-engine bomber / flying boat: cigar or boat hull, glazed nose and tail, nacelles. */
function multi(sp: MultiSpec): PlaneModel {
  const k = new Kit();
  const L = sp.len;
  const tt = twoTone(sp.top, sp.under, -0.3);
  k.lathe([[-L / 2, sp.r * 0.25], [-L * 0.3, sp.r * 0.7], [-L * 0.05, sp.r], [L * 0.3, sp.r], [L * 0.44, sp.r * 0.75], [L / 2, sp.r * 0.25]], tt, 12, [0, 0, 0], [sp.deep, 1]);
  // Glazed nose and tail cone, cockpit.
  k.sphere(1, GLASS, [0, 0, -L / 2 + 0.05], [sp.r * 0.42, sp.r * 0.42 * sp.deep, sp.r * 0.6], 8, 5);
  k.sphere(1, GLASS, [0, 0.05, L / 2 - 0.02], [sp.r * 0.3, sp.r * 0.3, sp.r * 0.5], 8, 5);
  k.sphere(1, GLASS, [0, sp.r * sp.deep * 0.8, -L * 0.3], [sp.r * 0.45, sp.r * 0.35, sp.r * 0.8], 8, 5);
  const semi = sp.span / 2;
  const zLE = -L / 2 + sp.wingS;
  for (const side of [1, -1]) {
    const pts = halfWing(semi, sp.root, sp.tip, sp.sweep, true).map(([x, z]) => [x * side, z] as [number, number]);
    if (side < 0) pts.reverse();
    k.plate(pts, 0.12, (n) => (n.y > 0 ? sp.top : sp.under), [0, sp.wingY, zLE], [0, 0, side * 0.04]);
    insignia(k, 'jpWhite', side * semi * 0.7, sp.wingY + 0.08 + semi * 0.7 * 0.04, zLE + sp.sweep * 0.7 + 0.45, 0.32, side * 0.04);
    if (sp.floats) k.lathe([[-0.4, 0.04], [0, 0.13], [0.35, 0.05]], sp.under, 6, [side * semi * 0.88, sp.wingY - 0.6, zLE + 0.4]);
  }
  for (const e of sp.engines) {
    for (const side of [1, -1]) {
      k.lathe([[-e.len * 0.6, e.r * 0.4], [0, e.r], [e.len * 0.4, e.r * 0.95]], (n, c) => (c.z < zLE - e.len * 0.1 + 0.1 ? 0x1d1d1d : n.y > -0.2 ? sp.top : sp.under), 9,
        [side * e.x, sp.wingY + (sp.wingY > 0 ? 0.1 : 0), zLE + 0.25 - e.len * 0.1]);
    }
  }
  const ts = sp.tailSpan / 2;
  const zT = L / 2 - 0.85;
  k.plate([[0, 0], [ts, 0.25], [ts, 0.7], [0, 0.85]], 0.06, (n) => (n.y > 0 ? sp.top : sp.under), [0, sp.r * 0.3, zT]);
  k.plate([[-ts, 0.7], [-ts, 0.25], [0, 0], [0, 0.85]], 0.06, (n) => (n.y > 0 ? sp.top : sp.under), [0, sp.r * 0.3, zT]);
  k.plate([[0, 1], [0, 0], [sp.finH, 0.55], [sp.finH, 0.95]], 0.06, sp.top, [0, sp.r * sp.deep * 0.6, L / 2 - 1.05], [0, 0, Math.PI / 2]);
  const props: PlaneModel['props'] = [];
  for (const e of sp.engines) for (const side of [1, -1]) props.push({ pos: [side * e.x, sp.wingY + (sp.wingY > 0 ? 0.1 : 0), zLE + 0.25 - e.len * 0.7], r: e.r * 2.4 });
  return { geo: k.build(), props, glow: [], semi };
}

const BETTY: MultiSpec = {
  len: 5, r: 0.46, deep: 1, span: 6.2, root: 1.35, tip: 0.55, sweep: 0.2, wingS: 1.75, wingY: -0.05,
  engines: [{ x: 1.25, r: 0.3, len: 1.4 }], tailSpan: 2.2, finH: 0.8, top: 0x33422e, under: 0x9a9a8e,
};

const EMILY: MultiSpec = {
  len: 7, r: 0.55, deep: 1.55, span: 9.5, root: 1.55, tip: 0.6, sweep: 0.15, wingS: 2.6, wingY: 0.62,
  engines: [{ x: 1.82, r: 0.3, len: 1.3 }, { x: 3.9, r: 0.28, len: 1.2 }], tailSpan: 3, finH: 1.3, top: 0x2b3a2c, under: 0x8c908a, floats: true,
};

const cache = new Map<string, PlaneModel>();

/** The model of an aircraft kind (cached; never dispose the geometry). */
export function planeModel(kind: EnemyKind | PlaneId | 'emily' | 'b5nLead' | 'bettyLead'): PlaneModel {
  const hit = cache.get(kind);
  if (hit) return hit;
  let m: PlaneModel;
  if (kind === 'p38') m = p38();
  else if (kind === 'betty') m = multi(BETTY);
  else if (kind === 'bettyLead') m = multi({ ...BETTY, top: 0x2f3d2b });
  else if (kind === 'emily') m = multi(EMILY);
  else {
    const sp = PLANE_SPECS[kind];
    if (!sp) throw new Error(`no aircraft model for ${kind}`);
    m = fighter(sp);
  }
  cache.set(kind, m);
  return m;
}

export const AIR_MODEL_KINDS = ['zero', 'kamikaze', 'oscar', 'val', 'kate', 'b5nLead', 'frank', 'george', 'ohka', 'f6f', 'f4u', 'p38', 'betty', 'bettyLead', 'emily'] as const;
