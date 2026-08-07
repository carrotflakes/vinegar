// The gradient tool: place and reshape a gradient directly on the artwork.
//
// A press on one of the annotator's handles drags that handle; a press
// anywhere else draws a whole new axis (Illustrator's gradient drag), turning
// a solid fill into a gradient on the way. Every edit is expressed in the
// gradient's own space — see `canvas/gradientHandles.ts` — so the same code
// serves a bounds-relative and a pinned gradient.

import {
  addStopAt,
  gradient,
  gradientStop,
  isGradientPaint,
  type GradientPaint,
  updateStop,
} from "@/model/gradient";
import { resolvePaintRef } from "@/model/paint";
import { isShape } from "@/model/scene";
import type { Shape, Vec2 } from "@/model/types";
import type { EditorState } from "@/store/state";
import { useGradientTool } from "@/store/gradientToolStore";
import {
  gradientControls,
  gradientTargetShape,
  pickGradientHandle,
  screenToPaintSpace,
  type GradientHandle,
} from "../gradientHandles";
import { CLICK_SLOP, type Interaction, type ToolContext } from "../interaction";
import { pickShape } from "../picking";

/**
 * The gradient a drag is about to write, per shape. It is held here instead of
 * on the shape so a press that turns out to be a click (a double-click adding
 * a stop) never touches the document at all.
 */
const pendingPaint = new Map<string, GradientPaint>();

/** Screen-space radius a handle is grabbed within (scaled for touch). */
const HANDLE_HIT = 9;

/** Snap the axis to 15° steps while Shift is held. */
const SNAP_STEP = Math.PI / 12;

/** The gradient a solid (or missing) paint becomes on the first drag. */
function seedGradient(shape: Shape, target: "fill" | "stroke", state: EditorState): GradientPaint {
  const current = resolvePaintRef(shape[target], state.doc.swatches);
  const color = current?.type === "solid" ? current.color : "#000000";
  return gradient([gradientStop(color, 0), gradientStop("#ffffff", 1)], { space: "local" });
}

function setPaint(
  state: EditorState,
  shape: Shape,
  target: "fill" | "stroke",
  paint: GradientPaint
): void {
  state.applyShapes({ [shape.id]: { ...shape, [target]: paint } });
}

/**
 * Start a gradient interaction. Without a shape selected the press picks one
 * first, so the tool works the way the select tool does.
 */
export function onGradientDown(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2,
  shift: boolean
): void {
  const { target } = useGradientTool.getState();
  let shape = gradientTargetShape(state.doc, state.selection);

  // Handles win over picking: they sit on top of the artwork.
  const controls = gradientControls(
    state.doc,
    shape,
    target,
    state.viewport,
    ctx.hitScale()
  );
  const hit = controls
    ? pickGradientHandle(controls, screen, HANDLE_HIT * ctx.hitScale())
    : null;
  if (controls && hit) {
    if (hit.type === "stop") useGradientTool.getState().setStopId(hit.id);
    state.beginInteraction("Edit gradient");
    ctx.interaction.current = {
      kind: "gradient-handle",
      shapeId: controls.shape.id,
      target,
      handle: hit,
      origin: controls.paint,
    };
    ctx.scheduleDraw();
    return;
  }

  if (!shape) {
    const hitId = pickShape(ctx, world);
    if (!hitId) return;
    const picked = state.doc.nodes[hitId];
    if (!isShape(picked) || picked.locked) return;
    state.setSelection([hitId]);
    shape = picked;
  }

  // Anywhere else: drag out a new axis, in the shape's own coordinates so it
  // lands exactly where the pointer went.
  const paint = isGradientPaint(shape[target])
    ? (shape[target] as GradientPaint)
    : seedGradient(shape, target, state);
  const pinned: GradientPaint = { ...paint, space: "local" };
  const start = screenToPaintSpace(state.doc, shape, pinned, state.viewport, screen);
  if (!start) return;
  state.beginInteraction("Place gradient");
  ctx.interaction.current = {
    kind: "gradient-axis",
    shapeId: shape.id,
    target,
    start,
    startScreen: screen,
    placed: false,
    shift,
  };
  pendingPaint.set(shape.id, pinned);
  ctx.scheduleDraw();
}

function snapped(start: Vec2, p: Vec2): Vec2 {
  const angle = Math.round(Math.atan2(p.y - start.y, p.x - start.x) / SNAP_STEP) * SNAP_STEP;
  const len = Math.hypot(p.x - start.x, p.y - start.y);
  return { x: start.x + Math.cos(angle) * len, y: start.y + Math.sin(angle) * len };
}

/** Drag the new axis out to the pointer. */
export function onGradientAxisMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Extract<Interaction, { kind: "gradient-axis" }>,
  screen: Vec2,
  shift: boolean
): void {
  // Until the press travels, it is still a click: leave the paint untouched.
  if (
    !inter.placed &&
    Math.hypot(screen.x - inter.startScreen.x, screen.y - inter.startScreen.y) <= CLICK_SLOP
  ) {
    return;
  }
  const shape = state.doc.nodes[inter.shapeId];
  if (!isShape(shape)) return;
  const paint = pendingPaint.get(inter.shapeId) ?? shape[inter.target];
  if (!isGradientPaint(paint)) return;
  const p = screenToPaintSpace(state.doc, shape, paint, state.viewport, screen);
  if (!p) return;
  inter.placed = true;
  setPaint(state, shape, inter.target, {
    ...paint,
    start: inter.start,
    end: shift ? snapped(inter.start, p) : p,
  });
  ctx.scheduleDraw();
}

/** Apply a handle drag. `origin` is the paint as it stood when the drag began. */
export function onGradientHandleMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Extract<Interaction, { kind: "gradient-handle" }>,
  screen: Vec2,
  shift: boolean
): void {
  const shape = state.doc.nodes[inter.shapeId];
  if (!isShape(shape)) return;
  const paint = shape[inter.target];
  if (!isGradientPaint(paint)) return;
  const p = screenToPaintSpace(state.doc, shape, paint, state.viewport, screen);
  if (!p) return;
  const next = movedPaint(paint, inter.handle, inter.origin, p, shift);
  if (next) setPaint(state, shape, inter.target, next);
  ctx.scheduleDraw();
}

/** Where one dragged handle puts the gradient. Pure, so it is easy to test. */
export function movedPaint(
  paint: GradientPaint,
  handle: GradientHandle,
  origin: GradientPaint,
  p: Vec2,
  shift: boolean
): GradientPaint | null {
  const d = { x: paint.end.x - paint.start.x, y: paint.end.y - paint.start.y };
  const len2 = d.x * d.x + d.y * d.y;
  switch (handle.type) {
    case "start": {
      // The ramp origin. A radial/conic centre carries its axis along, so the
      // ring keeps its size; a linear start only shortens the ramp.
      if (paint.kind === "linear") return { ...paint, start: shift ? snapped(paint.end, p) : p };
      return { ...paint, start: p, end: { x: p.x + d.x, y: p.y + d.y } };
    }
    case "end":
      return { ...paint, end: shift ? snapped(paint.start, p) : p };
    case "ratio": {
      if (len2 < 1e-12) return null;
      // Distance from the axis, in axis lengths.
      const ratio = ((p.x - paint.start.x) * -d.y + (p.y - paint.start.y) * d.x) / len2;
      return { ...paint, ratio: Math.max(0.01, Math.min(100, Math.abs(ratio))) };
    }
    case "focal": {
      if (len2 < 1e-12) return null;
      const v = { x: p.x - paint.start.x, y: p.y - paint.start.y };
      const focal = {
        x: (v.x * d.x + v.y * d.y) / len2,
        y: (v.x * -d.y + v.y * d.x) / len2 / Math.max(paint.ratio, 0.01),
      };
      // Outside the unit circle a focal point has no defined gradient.
      const r = Math.hypot(focal.x, focal.y);
      const clamped = r > 0.99 ? { x: (focal.x / r) * 0.99, y: (focal.y / r) * 0.99 } : focal;
      return { ...paint, focal: clamped };
    }
    case "stop": {
      if (len2 < 1e-12) return null;
      const t = ((p.x - paint.start.x) * d.x + (p.y - paint.start.y) * d.y) / len2;
      return updateStop(paint, handle.id, { offset: Math.max(0, Math.min(1, t)) });
    }
    case "midpoint": {
      if (len2 < 1e-12) return null;
      const stops = [...origin.stops].sort((a, b) => a.offset - b.offset);
      const i = stops.findIndex((s) => s.id === handle.id);
      const from = stops[i];
      const to = stops[i + 1];
      if (!from || !to) return null;
      const span = to.offset - from.offset;
      if (span <= 1e-6) return null;
      const t = ((p.x - paint.start.x) * d.x + (p.y - paint.start.y) * d.y) / len2;
      return updateStop(paint, handle.id, { midpoint: (t - from.offset) / span });
    }
  }
}

/** Add a stop where the axis was double-clicked. */
export function addGradientStopAt(
  state: EditorState,
  screen: Vec2
): void {
  const { target } = useGradientTool.getState();
  const shape = gradientTargetShape(state.doc, state.selection);
  if (!shape) return;
  const paint = shape[target];
  if (!isGradientPaint(paint)) return;
  const p = screenToPaintSpace(state.doc, shape, paint, state.viewport, screen);
  if (!p) return;
  const d = { x: paint.end.x - paint.start.x, y: paint.end.y - paint.start.y };
  const len2 = d.x * d.x + d.y * d.y;
  if (len2 < 1e-12) return;
  const t = ((p.x - paint.start.x) * d.x + (p.y - paint.start.y) * d.y) / len2;
  const { paint: next, stop } = addStopAt(paint, Math.max(0, Math.min(1, t)));
  state.updateSelectedStyle({ [target]: next });
  useGradientTool.getState().setStopId(stop.id);
}

/** Drop the paint a drag was about to write (cancel paths). */
export function cancelGradient(): void {
  pendingPaint.clear();
}

export function finishGradient(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction
): void {
  pendingPaint.clear();
  // A press that never became a drag changed nothing; don't leave an empty
  // undo step (or a collapsed gradient) behind.
  if (inter.kind === "gradient-axis" && !inter.placed) state.cancelInteraction();
  else state.endInteraction();
  ctx.scheduleDraw();
}
