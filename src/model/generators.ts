// ===========================================================================
// Parametric shape generators. A generator is a pure function args -> local
// geometry (Bézier subpaths, centered on the origin), plus a parameter schema
// the properties panel renders generically. Nodes reference a generator by id
// (`node.generator`, see GeneratorRef); changing an arg regenerates only the
// geometry, preserving the node's paint and transform. Built-ins live here as
// native synchronous code; user-authored document scripts can slot in later
// behind the same registry shape.
// ===========================================================================

import type {
  BezierAnchor,
  BezierSubpath,
  ScriptDef,
  Vec2,
} from "./types";

/** One tunable parameter, driving a generic numeric control in the UI. */
export interface GeneratorParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Snap edits to whole numbers (point counts, sides, …). */
  integer?: boolean;
}

export interface GeneratorDef {
  id: string;
  name: string;
  params: GeneratorParam[];
  /** Pure: parameter values -> local-space subpaths centered on the origin. */
  build: (args: Record<string, number>) => BezierSubpath[];
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

/**
 * Star / regular polygon. With `innerRatio` at 1 the inner vertices vanish and
 * it becomes a regular `points`-gon; below 1 the inner radius pulls in to form
 * a star. All corners are sharp (no Bézier handles).
 */
function buildStar(args: Record<string, number>): BezierSubpath[] {
  const n = Math.round(clamp(args.points, 3, 60));
  const radius = Math.max(1, args.radius ?? 80);
  const k = clamp(args.innerRatio, 0.05, 1);
  const polygon = k >= 0.999;
  const count = polygon ? n : n * 2;
  const anchors: BezierAnchor[] = [];
  for (let i = 0; i < count; i++) {
    const r = polygon || i % 2 === 0 ? radius : radius * k;
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
    anchors.push({
      p: { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
      hIn: null,
      hOut: null,
    });
  }
  return [{ anchors, closed: true }];
}

const TAU = Math.PI * 2;
const polar = (angle: number, r: number): Vec2 => ({
  x: Math.cos(angle) * r,
  y: Math.sin(angle) * r,
});
const sharp = (p: Vec2): BezierAnchor => ({ p, hIn: null, hOut: null });

/** A 4-anchor Bézier circle; `reverse` flips winding (for nonzero-fill holes). */
function circleSubpath(r: number, reverse = false): BezierSubpath {
  const k = r * 0.5522847498; // cubic-circle handle length
  const anchors: BezierAnchor[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const p = polar(a, r);
    const tx = -Math.sin(a) * k;
    const ty = Math.cos(a) * k;
    anchors.push({ p, hIn: { x: p.x - tx, y: p.y - ty }, hOut: { x: p.x + tx, y: p.y + ty } });
  }
  if (!reverse) return { anchors, closed: true };
  const rev = anchors
    .slice()
    .reverse()
    .map((an) => ({ p: an.p, hIn: an.hOut, hOut: an.hIn }));
  return { anchors: rev, closed: true };
}

/** Catmull-Rom → Bézier handles through `pts`; `closed` wraps the tangents. */
function smoothAnchors(pts: Vec2[], closed: boolean): BezierAnchor[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 1] : p;
    const next = i < n - 1 ? pts[i + 1] : closed ? pts[0] : p;
    const dx = (next.x - prev.x) / 6;
    const dy = (next.y - prev.y) / 6;
    return {
      p,
      hIn: closed || i > 0 ? { x: p.x - dx, y: p.y - dy } : null,
      hOut: closed || i < n - 1 ? { x: p.x + dx, y: p.y + dy } : null,
    };
  });
}

/**
 * Gear: trapezoidal teeth between the tip and root radii, with an optional
 * round center hole — a second, reverse-wound subpath cut out by the nonzero
 * fill. Demonstrates multiple subpaths.
 */
function buildGear(args: Record<string, number>): BezierSubpath[] {
  const teeth = Math.round(clamp(args.teeth, 3, 60));
  const radius = Math.max(1, args.radius ?? 80);
  const root = radius * (1 - clamp(args.toothDepth, 0.02, 0.6));
  const hole = clamp(args.hole, 0, 0.85);
  const step = TAU / teeth;
  const anchors: BezierAnchor[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = -Math.PI / 2 + i * step;
    anchors.push(sharp(polar(a, root)));
    anchors.push(sharp(polar(a + step * 0.15, radius)));
    anchors.push(sharp(polar(a + step * 0.35, radius)));
    anchors.push(sharp(polar(a + step * 0.5, root)));
  }
  const subpaths: BezierSubpath[] = [{ anchors, closed: true }];
  if (hole > 0.01) subpaths.push(circleSubpath(radius * hole, true));
  return subpaths;
}

/**
 * Archimedean spiral as an OPEN smooth path: `turns` revolutions out to
 * `radius`. Demonstrates open subpaths and Bézier handles.
 */
function buildSpiral(args: Record<string, number>): BezierSubpath[] {
  const turns = clamp(args.turns, 0.25, 12);
  const radius = Math.max(1, args.radius ?? 80);
  const n = Math.max(2, Math.round(turns * 16));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(polar(t * turns * TAU - Math.PI / 2, t * radius));
  }
  return [{ anchors: smoothAnchors(pts, false), closed: false }];
}

/**
 * Flower: `petals` rounded lobes swinging between the inner and outer radius as
 * one smooth closed curve. Demonstrates Bézier handles.
 */
function buildFlower(args: Record<string, number>): BezierSubpath[] {
  const petals = Math.round(clamp(args.petals, 3, 24));
  const radius = Math.max(1, args.radius ?? 80);
  const inner = clamp(args.innerRatio, 0.05, 0.95) * radius;
  const count = petals * 2;
  const pts: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    pts.push(polar(-Math.PI / 2 + (i * TAU) / count, i % 2 === 0 ? radius : inner));
  }
  return [{ anchors: smoothAnchors(pts, true), closed: true }];
}

/**
 * Moon phase: the lit region bounded by the disc's limb (a semicircle) and the
 * terminator (a semi-ellipse whose signed horizontal radius shrinks and crosses
 * over as the phase advances). `phase` runs a full cycle — 0/1 new, 0.25 waxing
 * crescent, 0.5 full, 0.75 waning gibbous — flipping the lit side at half. The
 * two arcs meet in sharp cusps at the poles (the crescent's tips). Demonstrates
 * Bézier handles and elliptical arcs.
 */
function buildMoon(args: Record<string, number>): BezierSubpath[] {
  const R = Math.max(1, args.radius ?? 80);
  const phase = clamp(args.phase, 0, 1);
  const waxing = phase <= 0.5;
  const illum = waxing ? phase * 2 : (1 - phase) * 2; // 0 (new) .. 1 (full)
  const side = waxing ? 1 : -1; // lit limb on the right while waxing
  const c = 0.5522847498; // cubic handle length for a quarter arc
  const aLimb = side * R; // limb bulges a full radius
  const aTerm = side * R * (1 - 2 * illum); // terminator: +R (new) .. -R (full)
  const anchors: BezierAnchor[] = [
    { p: { x: 0, y: -R }, hIn: { x: c * aTerm, y: -R }, hOut: { x: c * aLimb, y: -R } },
    { p: { x: aLimb, y: 0 }, hIn: { x: aLimb, y: -c * R }, hOut: { x: aLimb, y: c * R } },
    { p: { x: 0, y: R }, hIn: { x: c * aLimb, y: R }, hOut: { x: c * aTerm, y: R } },
    { p: { x: aTerm, y: 0 }, hIn: { x: aTerm, y: c * R }, hOut: { x: aTerm, y: -c * R } },
  ];
  return [{ anchors, closed: true }];
}

export const GENERATORS: Record<string, GeneratorDef> = {
  star: {
    id: "star",
    name: "Star",
    params: [
      { key: "points", label: "Points", min: 3, max: 60, step: 1, default: 5, integer: true },
      { key: "radius", label: "Radius", min: 1, max: 1000, step: 1, default: 80 },
      { key: "innerRatio", label: "Inner ratio", min: 0.05, max: 1, step: 0.01, default: 0.5 },
    ],
    build: buildStar,
  },
  gear: {
    id: "gear",
    name: "Gear",
    params: [
      { key: "teeth", label: "Teeth", min: 3, max: 60, step: 1, default: 10, integer: true },
      { key: "radius", label: "Radius", min: 1, max: 1000, step: 1, default: 80 },
      { key: "toothDepth", label: "Tooth depth", min: 0.02, max: 0.6, step: 0.01, default: 0.18 },
      { key: "hole", label: "Center hole", min: 0, max: 0.85, step: 0.01, default: 0.35 },
    ],
    build: buildGear,
  },
  spiral: {
    id: "spiral",
    name: "Spiral",
    params: [
      { key: "turns", label: "Turns", min: 0.25, max: 12, step: 0.25, default: 3 },
      { key: "radius", label: "Radius", min: 1, max: 1000, step: 1, default: 80 },
    ],
    build: buildSpiral,
  },
  flower: {
    id: "flower",
    name: "Flower",
    params: [
      { key: "petals", label: "Petals", min: 3, max: 24, step: 1, default: 6, integer: true },
      { key: "radius", label: "Radius", min: 1, max: 1000, step: 1, default: 80 },
      { key: "innerRatio", label: "Inner ratio", min: 0.05, max: 0.95, step: 0.01, default: 0.45 },
    ],
    build: buildFlower,
  },
  moon: {
    id: "moon",
    name: "Moon",
    params: [
      { key: "phase", label: "Phase", min: 0, max: 1, step: 0.01, default: 0.25 },
      { key: "radius", label: "Radius", min: 1, max: 1000, step: 1, default: 80 },
    ],
    build: buildMoon,
  },
};

/** Lifecycle of a document script's worker-compiled metadata. */
export type ScriptStatus = "compiling" | "ready" | "error" | "untrusted";

/**
 * A resolved generator for the UI: a built-in (native `build`), or a document
 * script's cached metadata. Document scripts carry NO `build` here — their
 * geometry is produced off the main thread via the generator worker — so the
 * main thread never executes user code just to render controls.
 */
export interface ResolvedGenerator {
  id: string;
  name: string;
  params: GeneratorParam[];
  status: ScriptStatus;
  /** Native builder; present for built-ins only. */
  build?: (args: Record<string, number>) => BezierSubpath[] | null;
  /** Compile error for a document script, if any. */
  error?: string;
}

/**
 * Worker-compiled metadata for one document script, cached in editor state
 * (keyed by script id). `source` records which revision produced it, so a
 * later edit triggers a recompile.
 */
export interface ScriptMeta {
  source: string;
  status: "compiling" | "ready" | "error";
  params: GeneratorParam[];
  error?: string;
}

/** The generator's default argument set, keyed by param. */
export function defaultArgs(gen: {
  params: GeneratorParam[];
}): Record<string, number> {
  return Object.fromEntries(gen.params.map((p) => [p.key, p.default]));
}

/** Marker returned by a resolved but not-yet-approved document script. */
export const UNTRUSTED_ERROR =
  "Generators are disabled for this document. Enable them to run its scripts.";

/**
 * Resolve a generator id for the UI. Pure and side-effect-free: it NEVER runs
 * user code. Built-ins report native params. A document script reports its
 * worker-compiled `scriptMeta` (or a "compiling" placeholder until it lands);
 * an untrusted document reports "untrusted" so the UI can offer to enable it.
 * Returns null when the id matches neither a built-in nor a document script.
 */
export function resolveGenerator(
  scriptId: string,
  scripts: Record<string, ScriptDef> = {},
  trusted = true,
  scriptMeta: Record<string, ScriptMeta> = {}
): ResolvedGenerator | null {
  const builtin = GENERATORS[scriptId];
  if (builtin) {
    return {
      id: builtin.id,
      name: builtin.name,
      params: builtin.params,
      status: "ready",
      build: builtin.build,
    };
  }
  const def = scripts[scriptId];
  if (!def) return null;
  if (!trusted) {
    return { id: def.id, name: def.name, params: [], status: "untrusted", error: UNTRUSTED_ERROR };
  }
  const meta = scriptMeta[def.id];
  if (!meta || meta.source !== def.source || meta.status === "compiling") {
    return { id: def.id, name: def.name, params: meta?.params ?? [], status: "compiling" };
  }
  return {
    id: def.id,
    name: def.name,
    params: meta.params,
    status: meta.error ? "error" : "ready",
    error: meta.error,
  };
}

// --- Document-script compilation -----------------------------------------
//
// A user generator's source is the body of a factory function that returns
// `{ params, build }`. compileScript runs it (via `new Function`) with no
// arguments and no injected globals. This is invoked ONLY inside the generator
// worker (and, where Workers are unavailable, the client's sync fallback) — the
// main thread never calls it — so user code stays off the UI thread. Results
// are cached by source string so repeated builds never recompile.

interface CompiledScript {
  params: GeneratorParam[];
  build: (args: Record<string, number>) => BezierSubpath[] | null;
  error?: string;
}

const compileCache = new Map<string, CompiledScript>();

export function compileScript(source: string): CompiledScript {
  const cached = compileCache.get(source);
  if (cached) return cached;
  const result = compileUncached(source);
  compileCache.set(source, result);
  return result;
}

function compileUncached(source: string): CompiledScript {
  let def: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    def = new Function(`"use strict";\n${source}`)();
  } catch (err) {
    return errorScript(err instanceof Error ? err.message : String(err));
  }
  if (!def || typeof def !== "object" || typeof (def as { build?: unknown }).build !== "function") {
    return errorScript("Script must return { params, build }.");
  }
  const raw = def as { params?: unknown; build: (args: Record<string, number>) => unknown };
  const params = Array.isArray(raw.params)
    ? raw.params.map(normalizeParam).filter((p): p is GeneratorParam => p !== null)
    : [];
  return {
    params,
    build: (args) => {
      try {
        return validSubpaths(raw.build(args));
      } catch {
        return null;
      }
    },
  };
}

function errorScript(error: string): CompiledScript {
  return { params: [], build: () => null, error };
}

function normalizeParam(value: unknown): GeneratorParam | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.key !== "string") return null;
  const min = num(o.min, 0);
  return {
    key: o.key,
    label: typeof o.label === "string" ? o.label : o.key,
    min,
    max: num(o.max, 100),
    step: num(o.step, 1),
    default: num(o.default, min),
    ...(o.integer === true ? { integer: true } : {}),
  };
}

const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const validPoint = (value: unknown): value is Vec2 =>
  !!value &&
  Number.isFinite((value as Vec2).x) &&
  Number.isFinite((value as Vec2).y);
const point = (value: Vec2): Vec2 => ({ x: value.x, y: value.y });

/** Coerce a script's returned geometry into validated subpaths, or null. */
function validSubpaths(value: unknown): BezierSubpath[] | null {
  if (!Array.isArray(value)) return null;
  const subpaths: BezierSubpath[] = [];
  for (const sp of value) {
    if (!sp || typeof sp !== "object" || !Array.isArray((sp as { anchors?: unknown }).anchors))
      continue;
    const anchors: BezierAnchor[] = [];
    for (const a of (sp as { anchors: unknown[] }).anchors) {
      if (!a || !validPoint((a as { p?: unknown }).p)) continue;
      const an = a as { p: Vec2; hIn?: unknown; hOut?: unknown };
      anchors.push({
        p: point(an.p),
        hIn: validPoint(an.hIn) ? point(an.hIn) : null,
        hOut: validPoint(an.hOut) ? point(an.hOut) : null,
      });
    }
    if (anchors.length >= 2)
      subpaths.push({ anchors, closed: !!(sp as { closed?: unknown }).closed });
  }
  return subpaths.length > 0 ? subpaths : null;
}
