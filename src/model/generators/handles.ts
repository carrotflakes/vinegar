// ===========================================================================
// On-canvas parameter handles for generator nodes. A handle is a *data*
// descriptor — position plus a linear (or angular) mapping from a dragged
// local-space point back to one generator argument — so the canvas layer can
// draw and drag it without knowing anything about the generator, and so the
// same descriptors can later cross the worker boundary for document scripts.
//
// Descriptors are rebuilt from the current args on every frame, which makes
// the linear `unitsPerLocal` mapping a first-order approximation that stays
// accurate for the non-linear params (ratios, phase) as the drag proceeds.
// ===========================================================================

import type { GeneratorParam } from "./generators";
import type { Vec2 } from "../types";

interface HandleBase {
  /** Generator argument this handle drives. */
  param: string;
  /** Where the knob sits, in the node's local space. */
  at: Vec2;
}

export type GeneratorHandle =
  | (HandleBase & {
      kind: "distance";
      /** Unit local-space direction in which the value increases. */
      axis: Vec2;
      /** Param units gained per local unit travelled along `axis`. */
      unitsPerLocal: number;
    })
  | (HandleBase & {
      kind: "angle";
      /** Local-space point the pointer angle is measured around. */
      center: Vec2;
    });

const DEG = 180 / Math.PI;

function polar(angleDeg: number, r: number): Vec2 {
  const a = angleDeg / DEG;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function unit(angleDeg: number): Vec2 {
  return polar(angleDeg, 1);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

/** Signed difference to the shortest way round, in degrees. */
function angleDelta(a: number, b: number) {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * Index of the vertex whose angle sits closest to `target`, over `count`
 * vertices starting at `start` degrees. Knobs are placed off the cardinal axes
 * this way so they rarely land on top of the selection frame's own handles.
 */
function vertexNear(start: number, count: number, target: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const d = Math.abs(angleDelta(start + (i * 360) / count, target));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Radial knob at `angleDeg`: dragging outwards increases the value. */
function radial(
  param: string,
  angleDeg: number,
  distance: number,
  unitsPerLocal: number
): GeneratorHandle {
  return {
    param,
    kind: "distance",
    at: polar(angleDeg, distance),
    axis: unit(angleDeg),
    unitsPerLocal,
  };
}

type HandleBuilder = (args: Record<string, number>) => GeneratorHandle[];

const BUILDERS: Record<string, HandleBuilder> = {
  star: (args) => {
    const n = Math.round(clamp(args.points, 3, 60));
    const r = Math.max(1, args.radius ?? 80);
    const k = clamp(args.innerRatio, 0.05, 1);
    const outer = -90 + (vertexNear(-90, n, -45) * 360) / n;
    const inner = -90 + 180 / n + (vertexNear(-90 + 180 / n, n, 45) * 360) / n;
    return [
      radial("radius", outer, r, 1),
      radial("innerRatio", inner, r * k, 1 / r),
    ];
  },
  gear: (args) => {
    const teeth = Math.round(clamp(args.teeth, 3, 60));
    const r = Math.max(1, args.radius ?? 80);
    const depth = clamp(args.toothDepth, 0.02, 0.6);
    const hole = clamp(args.hole, 0, 0.85);
    const step = 360 / teeth;
    // Tip midpoints sit a quarter step past each tooth's root angle.
    const tip = -90 + step * 0.25 + vertexNear(-90 + step * 0.25, teeth, -45) * step;
    const root = -90 + vertexNear(-90, teeth, 45) * step;
    const handles = [
      radial("radius", tip, r, 1),
      // The root radius shrinks as the tooth deepens, so travel outwards
      // *reduces* the value.
      radial("toothDepth", root, r * (1 - depth), -1 / r),
    ];
    // A closed-up hole would put its knob on the pivot marker; the panel
    // re-opens it.
    if (hole > 0.02) handles.push(radial("hole", 135, r * hole, 1 / r));
    return handles;
  },
  spiral: (args) => {
    const turns = clamp(args.turns, 0.25, 12);
    const r = Math.max(1, args.radius ?? 80);
    return [radial("radius", turns * 360 - 90, r, 1)];
  },
  flower: (args) => {
    const petals = Math.round(clamp(args.petals, 3, 24));
    const r = Math.max(1, args.radius ?? 80);
    const k = clamp(args.innerRatio, 0.05, 0.95);
    const step = 180 / petals;
    const outer = -90 + vertexNear(-90, petals, -45) * step * 2;
    const inner = -90 + step + vertexNear(-90 + step, petals, 45) * step * 2;
    return [
      radial("radius", outer, r, 1),
      radial("innerRatio", inner, r * k, 1 / r),
    ];
  },
  arrow: (args) => {
    const length = Math.max(1, args.length ?? 100);
    const head = Math.max(1, args.headLength ?? 60);
    const height = Math.max(1, args.height ?? 100);
    const shaft = (height * clamp(args.shaftRatio, 0.05, 1)) / 2;
    return [
      // Nudged off the shaft's centre line and tip so the knobs clear the
      // selection frame's own mid-edge handles.
      {
        param: "length",
        kind: "distance",
        at: { x: -length, y: shaft * 0.5 },
        axis: { x: -1, y: 0 },
        unitsPerLocal: 1,
      },
      {
        param: "headLength",
        kind: "distance",
        at: { x: head, y: -height * 0.12 },
        axis: { x: 1, y: 0 },
        unitsPerLocal: 1,
      },
      {
        param: "height",
        kind: "distance",
        at: { x: 0, y: -height / 2 },
        axis: { x: 0, y: -1 },
        unitsPerLocal: 2,
      },
      {
        param: "shaftRatio",
        kind: "distance",
        at: { x: -length * 0.5, y: -shaft },
        axis: { x: 0, y: -1 },
        unitsPerLocal: 2 / height,
      },
    ];
  },
  sector: (args) => {
    const r = Math.max(1, args.radius ?? 80);
    const start = clamp(args.startAngle, -360, 360);
    const sweep = clamp(args.sweepAngle, 1, 359);
    const center = { x: 0, y: 0 };
    return [
      radial("radius", start + sweep / 2, r, 1),
      { param: "startAngle", kind: "angle", at: polar(start, r * 0.75), center },
      {
        param: "sweepAngle",
        kind: "angle",
        at: polar(start + sweep, r * 0.75),
        center,
      },
    ];
  },
  moon: (args) => {
    const R = Math.max(1, args.radius ?? 80);
    const phase = clamp(args.phase, 0, 1);
    const waxing = phase <= 0.5;
    const illum = waxing ? phase * 2 : (1 - phase) * 2;
    // Extreme point of the terminator; its x moves at -R*4 per unit of phase
    // in both halves of the cycle.
    const terminator = (waxing ? 1 : -1) * R * (1 - 2 * illum);
    return [
      {
        param: "radius",
        kind: "distance",
        at: { x: 0, y: -R },
        axis: { x: 0, y: -1 },
        unitsPerLocal: 1,
      },
      {
        param: "phase",
        kind: "distance",
        at: { x: terminator, y: 0 },
        axis: { x: 1, y: 0 },
        unitsPerLocal: -1 / (4 * R),
      },
    ];
  },
};

/**
 * Local-space handles for one generator's current args. Empty for generators
 * without handle definitions (all document scripts, for now).
 */
export function generatorHandles(
  scriptId: string,
  args: Record<string, number>
): GeneratorHandle[] {
  return BUILDERS[scriptId]?.(args) ?? [];
}

/**
 * The value a drag maps to: `startValue` plus the travel from the grab point,
 * projected onto the handle's axis (or measured as a turn about its centre).
 * Measuring from the grab point rather than the knob's drawn position keeps the
 * value from jumping when the pointer grabs slightly off-centre.
 */
export function handleParamValue(
  handle: GeneratorHandle,
  startValue: number,
  currentValue: number,
  startLocal: Vec2,
  local: Vec2
): number {
  if (handle.kind === "distance") {
    const travel =
      (local.x - startLocal.x) * handle.axis.x +
      (local.y - startLocal.y) * handle.axis.y;
    return startValue + travel * handle.unitsPerLocal;
  }
  const angleOf = (p: Vec2) =>
    Math.atan2(p.y - handle.center.y, p.x - handle.center.x) * DEG;
  const raw = startValue + angleDelta(angleOf(local), angleOf(startLocal));
  // Angles are periodic: pick the turn nearest the live value so a drag can
  // wind past ±180° continuously instead of snapping back.
  return raw + 360 * Math.round((currentValue - raw) / 360);
}

/** Clamp a dragged value into the parameter's declared range and step. */
export function clampParamValue(param: GeneratorParam, value: number): number {
  const v = clamp(value, param.min, param.max);
  return param.integer ? Math.round(v) : v;
}
