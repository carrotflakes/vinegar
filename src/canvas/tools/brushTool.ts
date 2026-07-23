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
import type { ToolContext } from "../interaction";

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
  /** Last raw position kept, for the minimum-distance filter. */
  last: Vec2;
  opts: BrushOptions;
}

let active: ActiveStroke | null = null;

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
  pressure: number,
  pointerId: number
) {
  const opts = useBrush.getState();
  const w = pressureToWidth(pressure, opts);
  active = { raw: [{ p: world, w }], smoothed: world, last: world, opts };
  ctx.preview.current = buildPreview(state, anchorsFromRaw(active.raw));
  ctx.interaction.current = { kind: "brush", pointerId };
  ctx.scheduleDraw();
}

export function onBrushMove(
  ctx: ToolContext,
  state: EditorState,
  samples: { world: Vec2; pressure: number }[]
) {
  if (!active) return;
  const { opts } = active;
  // Minimum spacing in screen pixels, converted to world units. The pencil
  // filters in world units; screen-relative keeps detail when zoomed out.
  const minDist = 1.2 / state.viewport.scale;
  let changed = false;
  for (const { world, pressure } of samples) {
    // Exponential moving average: strength 0 tracks exactly, →1 lags heavily.
    const s = opts.stabilizer;
    active.smoothed = {
      x: active.smoothed.x + (world.x - active.smoothed.x) * (1 - s),
      y: active.smoothed.y + (world.y - active.smoothed.y) * (1 - s),
    };
    const p = active.smoothed;
    if (Math.hypot(p.x - active.last.x, p.y - active.last.y) < minDist) continue;
    active.raw.push({ p, w: pressureToWidth(pressure, opts) });
    active.last = p;
    changed = true;
  }
  if (changed) {
    ctx.preview.current = buildPreview(state, anchorsFromRaw(active.raw));
    ctx.scheduleDraw();
  }
}

export function finishBrush(ctx: ToolContext, state: EditorState) {
  const stroke = active;
  active = null;
  ctx.preview.current = null;
  if (!stroke || stroke.raw.length < 1) {
    ctx.scheduleDraw();
    return;
  }
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
  const simplified = simplifyWidthSamples(raw, 2 / state.viewport.scale, 0.05);
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
