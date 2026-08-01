import {
  brushAnchor,
  fitBrushAnchors,
  simplifyWidthSamples,
  type WidthSample,
} from "@/model/brush/brushOutline";
import {
  makeId,
  type BrushAnchor,
  type BrushShape,
  type Vec2,
} from "../../model/types";
import { styleFromDefaults, type EditorState } from "../../store/editorStore";
import { useBrush, pressureToWidth, type BrushOptions } from "../../store/brushStore";
import { SMOOTH_REF_MS, type StrokeSample, type ToolContext } from "../interaction";

/** One captured input sample: smoothed position + width multiplier. */
type Sample = WidthSample;

/**
 * Transient capture state for the in-progress stroke. Only one brush stroke can
 * be live at a time, so a module-level singleton mirrors how the other tools
 * keep their drag state on the shared context.
 */
interface ActiveStroke {
  raw: Sample[];
  /** EMA-smoothed position, updated per input sample. */
  smoothed: Vec2;
  /** EMA-smoothed width multiplier, updated per input sample. */
  smoothedW: number;
  /** Last raw position kept, for the minimum-distance filter. */
  last: Vec2;
  /** Timestamp of the last sample the average was advanced with (ms). */
  lastT: number;
  opts: BrushOptions;
}

let active: ActiveStroke | null = null;

/**
 * Fraction of the width error kept per {@link SMOOTH_REF_MS}, i.e. a ~16 ms
 * time constant. Pressure sensors are noisy at full rate and the envelope shows
 * every wobble as a bulge, but the response has to stay much quicker than the
 * position stabilizer: width is how a stroke reads as pressed, and lagging it
 * would flatten short accents. Deliberately independent of the stabilizer
 * setting — this smooths the sensor, not the hand.
 */
const PRESSURE_RETAIN = 0.35;

/** Screen-space spacing between kept samples, in world units: screen-relative
 *  keeps detail when zoomed out (the pencil filters the same way). */
function brushMinDist(state: EditorState): number {
  return 1.2 / state.viewport.scale;
}

/** A new preview object each frame so the envelope cache never serves a stale
 * ring for the growing stroke (the WeakMap is keyed on shape identity). */
function buildPreview(state: EditorState, anchors: BrushAnchor[]): BrushShape {
  return {
    id: "brush-preview",
    name: "Brush",
    type: "brush",
    anchors,
    ...styleFromDefaults(state.style),
    fill: null,
    // The brush is painted with its stroke paint; use the base size as width.
    strokeWidth: active?.opts.size ?? state.style.strokeWidth,
  };
}

function anchorsFromRaw(raw: Sample[]): BrushAnchor[] {
  // Handle-less anchors while drawing; the commit fits smooth Béziers.
  return raw.map((s) => brushAnchor(s.p, s.w));
}

export function startBrush(
  ctx: ToolContext,
  state: EditorState,
  world: Vec2,
  pressure: number
) {
  const opts = useBrush.getState();
  const w = pressureToWidth(pressure, opts);
  active = {
    raw: [{ p: world, w }],
    smoothed: world,
    smoothedW: w,
    last: world,
    // Event timestamps share the `performance.now` clock, so the first sample's
    // dt is measured from the press.
    lastT: performance.now(),
    opts,
  };
  ctx.preview.current = buildPreview(state, anchorsFromRaw(active.raw));
  ctx.interaction.current = { kind: "brush" };
  ctx.scheduleDraw();
}

export function onBrushMove(
  ctx: ToolContext,
  state: EditorState,
  samples: StrokeSample[]
) {
  if (!active) return;
  const { opts } = active;
  const minDist = brushMinDist(state);
  let changed = false;
  for (const { world, pressure, t } of samples) {
    // Exponential moving average: strength 0 tracks exactly, →1 lags heavily.
    // The strength is per SMOOTH_REF_MS and each sample keeps `s^(dt/ref)` of
    // the error, so a 240 Hz stylus and a 60 Hz mouse draw the same line at the
    // same setting. dt is clamped: coalesced samples may share a timestamp
    // (which must not stall the average) and a resumed stroke must not snap.
    const step = Math.min(100, Math.max(1, t - active.lastT));
    const retain = opts.stabilizer ** (step / SMOOTH_REF_MS);
    active.lastT = t;
    active.smoothed = {
      x: active.smoothed.x + (world.x - active.smoothed.x) * (1 - retain),
      y: active.smoothed.y + (world.y - active.smoothed.y) * (1 - retain),
    };
    // Both averages advance on *every* sample, including the ones the distance
    // filter drops below: their pressure is part of the stroke even where their
    // position adds nothing, so pressing harder while barely moving still
    // thickens the line.
    const wRetain = PRESSURE_RETAIN ** (step / SMOOTH_REF_MS);
    active.smoothedW +=
      (pressureToWidth(pressure, opts) - active.smoothedW) * (1 - wRetain);
    const p = active.smoothed;
    if (Math.hypot(p.x - active.last.x, p.y - active.last.y) < minDist) continue;
    active.raw.push({ p, w: active.smoothedW });
    active.last = p;
    changed = true;
  }
  if (changed) {
    ctx.preview.current = buildPreview(state, anchorsFromRaw(active.raw));
    ctx.scheduleDraw();
  }
}

/** Frames the tail settle is allowed to take; at the maximum stabilizer (0.95)
 *  this closes 96% of the remaining gap, and at the default it converges long
 *  before. */
const SETTLE_STEPS = 64;

/**
 * Walk the smoothed point the rest of the way to where the pen was lifted. The
 * average trails the pointer, so without this a stroke ends short of its
 * release point — barely at the default stabilizer, visibly at high settings,
 * and the end of a stroke is what people aim. Settling by the same average
 * rather than jumping straight to the raw point keeps a heavily smoothed line
 * from growing a spike on its tail. The width holds at its last smoothed value:
 * pens report a meaningless pressure (usually 0) on release, and the taper is
 * what shapes the tip.
 */
function settleTail(stroke: ActiveStroke, world: Vec2, minDist: number): void {
  for (let i = 0; i < SETTLE_STEPS; i++) {
    const retain = stroke.opts.stabilizer;
    stroke.smoothed = {
      x: stroke.smoothed.x + (world.x - stroke.smoothed.x) * (1 - retain),
      y: stroke.smoothed.y + (world.y - stroke.smoothed.y) * (1 - retain),
    };
    const p = stroke.smoothed;
    if (Math.hypot(p.x - stroke.last.x, p.y - stroke.last.y) >= minDist) {
      stroke.last = { ...p };
      stroke.raw.push({ p: { ...p }, w: stroke.smoothedW });
    }
    if (Math.hypot(p.x - world.x, p.y - world.y) <= minDist / 2) break;
  }
}

export function finishBrush(ctx: ToolContext, state: EditorState, world: Vec2) {
  const stroke = active;
  active = null;
  ctx.preview.current = null;
  if (!stroke || stroke.raw.length < 1) {
    ctx.scheduleDraw();
    return;
  }
  settleTail(stroke, world, brushMinDist(state));
  const opts = stroke.opts;
  const raw = stroke.raw.map((s) => ({ p: { ...s.p }, w: s.w }));
  // A tap with no travel becomes a single round dot.
  if (raw.length === 1) {
    const anchors = [brushAnchor(raw[0].p, raw[0].w)];
    state.addBrushStroke(makeBrushShape(state, anchors, opts.size));
    ctx.scheduleDraw();
    return;
  }
  applyTaper(raw, opts.taper);
  const simplified = simplifyWidthSamples(raw, opts.simplify / state.viewport.scale, 0.05);
  const anchors = fitBrushAnchors(simplified.length >= 2 ? simplified : raw);
  state.addBrushStroke(makeBrushShape(state, anchors, opts.size));
  ctx.scheduleDraw();
}

/** Drop the live stroke without committing (tool switch / gesture / Escape). */
export function cancelBrush(ctx: ToolContext) {
  active = null;
  ctx.preview.current = null;
  ctx.scheduleDraw();
}

function makeBrushShape(
  state: EditorState,
  anchors: BrushAnchor[],
  size: number
): BrushShape {
  return {
    id: makeId("brush"),
    name: "Brush",
    type: "brush",
    anchors,
    ...styleFromDefaults(state.style),
    fill: null,
    strokeWidth: size,
  };
}

// ---- commit-time processing -------------------------------------------------

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Scale widths down to a point over `taper` arc length at both ends. */
function applyTaper(raw: Sample[], taper: number): void {
  if (taper <= 0 || raw.length < 2) return;
  const n = raw.length;
  const fromStart = new Array<number>(n);
  const fromEnd = new Array<number>(n);
  fromStart[0] = 0;
  for (let i = 1; i < n; i++) fromStart[i] = fromStart[i - 1] + dist(raw[i].p, raw[i - 1].p);
  fromEnd[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) fromEnd[i] = fromEnd[i + 1] + dist(raw[i].p, raw[i + 1].p);
  for (let i = 0; i < n; i++) {
    const factor = Math.min(
      Math.min(1, fromStart[i] / taper),
      Math.min(1, fromEnd[i] / taper)
    );
    raw[i].w *= factor;
  }
}
