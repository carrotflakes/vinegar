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
import {
  addFreeformPointAt,
  freeformPoint,
  isFreeform,
  updateFreeformPoint,
} from "@/model/freeform";
import { resolvePaintRef, type Paint, type PaintTarget } from "@/model/paint";
import { isShape } from "@/model/scene";
import type { Shape, Vec2 } from "@/model/types";
import type { EditorState } from "@/store/state";
import { gradientTargetShape, useGradientTool } from "@/store/gradientToolStore";
import {
  freeformControls,
  pickFreeformHandle,
  screenToFreeformSpace,
  spreadWeight,
} from "../freeformHandles";
import {
  gradientControls,
  pickGradientHandle,
  pickGradientRamp,
  screenToPaintSpace,
  type GradientHandle,
} from "../gradientHandles";
import { CLICK_SLOP, type Interaction, type ToolContext } from "../interaction";
import { pickShape } from "../picking";

/** Screen-space radius a handle is grabbed within (scaled for touch). */
const HANDLE_HIT = 9;

/** Snap the axis to 15° steps while Shift is held. */
const SNAP_STEP = Math.PI / 12;

/** The gradient a solid (or missing) paint becomes on the first drag. */
function seedGradient(shape: Shape, target: PaintTarget, state: EditorState): GradientPaint {
  const current = resolvePaintRef(shape[target], state.doc.swatches);
  const solid = current?.type === "solid" ? current : null;
  // A half-transparent fill stays half-transparent when it becomes a ramp.
  return gradient([gradientStop(solid?.color ?? "#000000", 0), gradientStop("#ffffff", 1)], {
    space: "local",
    alpha: solid?.alpha ?? 1,
  });
}

function setPaint(
  state: EditorState,
  shape: Shape,
  target: PaintTarget,
  paint: Paint
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
  /** Alt duplicates the colour point being dragged (freeform fields only). */
  alt = false
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

  // A freeform field is a set of points, not a ramp: dragging places one
  // rather than an axis, so it takes over the whole press.
  if (shape && isFreeform(shape[target])) {
    if (onFreeformDown(ctx, state, shape, target, screen, world, alt)) return;
    // A press away from the current field is for picking another shape, not
    // for replacing this field with a newly seeded ramp. Keep blank-canvas
    // presses inert and make selecting artwork a press-only operation, as it
    // is when the tool has no current target below.
    const hitId = pickShape(ctx, world);
    const picked = hitId ? state.doc.nodes[hitId] : undefined;
    if (isShape(picked) && !picked.locked && picked.id !== shape.id) {
      state.setSelection([picked.id]);
      ctx.scheduleDraw();
    }
    return;
  }

  if (!shape) {
    const hitId = pickShape(ctx, world);
    if (!hitId) return;
    const picked = state.doc.nodes[hitId];
    if (!isShape(picked) || picked.locked) return;
    state.setSelection([hitId]);
    shape = picked;
    // The press that picks a shape only picks it. On a freeform field the
    // next press is what adds a colour point — selecting artwork must not
    // paint on it.
    if (isFreeform(shape[target])) {
      ctx.scheduleDraw();
      return;
    }
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
    paint: pinned,
    start,
    startScreen: screen,
    placed: false,
  };
  ctx.scheduleDraw();
}

/**
 * A press while the target paint is a freeform field. Returns whether it was
 * consumed: a point (or its spread ring) was grabbed, or a point was added —
 * the last one only when the press landed on the shape itself, so a press out
 * on the canvas still falls through to picking another shape.
 */
function onFreeformDown(
  ctx: ToolContext,
  state: EditorState,
  shape: Shape,
  target: PaintTarget,
  screen: Vec2,
  world: Vec2,
  alt: boolean
): boolean {
  const { stopId } = useGradientTool.getState();
  const controls = freeformControls(
    state.doc,
    shape,
    target,
    state.viewport,
    stopId,
    ctx.hitScale()
  );
  if (!controls) return false;
  const hit = pickFreeformHandle(controls, screen, HANDLE_HIT * ctx.hitScale());
  if (hit) {
    return beginFreeformDrag(ctx, state, shape, target, hit.id, screen, {
      mode: hit.type === "spread" ? "spread" : "move",
      // Alt duplicates the point on the way, as it does for a selection move.
      duplicate: hit.type === "point" && alt,
    });
  }
  // Adding needs a place *on* the artwork; elsewhere the press means "pick".
  if (pickShape(ctx, world) !== shape.id) return false;
  const p = screenToFreeformSpace(state.doc, shape, controls.paint, state.viewport, screen);
  if (!p) return false;
  const { paint, point } = addFreeformPointAt(controls.paint, p);
  const started = beginFreeformDrag(ctx, state, shape, target, point.id, screen, {
    mode: "move",
    duplicate: false,
    label: "Add color point",
  });
  if (started) setPaint(state, shape, target, paint);
  ctx.scheduleDraw();
  return started;
}

function beginFreeformDrag(
  ctx: ToolContext,
  state: EditorState,
  shape: Shape,
  target: PaintTarget,
  pointId: string,
  startScreen: Vec2,
  opts: { mode: "move" | "spread"; duplicate: boolean; label?: string }
): boolean {
  useGradientTool.getState().setStopId(pointId);
  state.beginInteraction(
    opts.label ??
      (opts.duplicate
        ? "Duplicate color point"
        : opts.mode === "spread"
          ? "Edit color point spread"
          : "Move color point")
  );
  ctx.interaction.current = {
    kind: "freeform-point",
    shapeId: shape.id,
    target,
    pointId,
    mode: opts.mode,
    startScreen,
    duplicate: opts.duplicate,
  };
  ctx.scheduleDraw();
  return true;
}

/**
 * Drag a colour point to the pointer, or its spread ring to a new weight.
 *
 * An Alt-drag duplicates the point the first time the press travels past the
 * click slop and then moves the copy, so the original stays put and the whole
 * thing lands as one undo step — the same bargain `promotePendingMove` strikes
 * for a selection.
 */
export function onFreeformPointMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Extract<Interaction, { kind: "freeform-point" }>,
  screen: Vec2
): void {
  const shape = state.doc.nodes[inter.shapeId];
  if (!isShape(shape)) return;
  const paint = shape[inter.target];
  if (!isFreeform(paint)) return;

  if (inter.mode === "spread") {
    const center = freeformPointScreen(state, shape, inter.target, inter.pointId);
    if (!center) return;
    const radius = Math.hypot(screen.x - center.x, screen.y - center.y);
    setPaint(
      state,
      shape,
      inter.target,
      updateFreeformPoint(paint, inter.pointId, {
        weight: spreadWeight(radius, ctx.hitScale()),
      })
    );
    ctx.scheduleDraw();
    return;
  }

  let current = paint;
  let pointId = inter.pointId;
  if (inter.duplicate) {
    const travel = Math.hypot(
      screen.x - inter.startScreen.x,
      screen.y - inter.startScreen.y
    );
    if (travel <= CLICK_SLOP) return; // still a click: nothing to duplicate yet
    const source = paint.points.find((p) => p.id === pointId);
    if (!source) return;
    const copy = freeformPoint(source.color, source.position, {
      alpha: source.alpha,
      weight: source.weight,
    });
    current = { ...paint, points: [...paint.points, copy] };
    pointId = copy.id;
    inter.duplicate = false;
    inter.pointId = copy.id;
    useGradientTool.getState().setStopId(copy.id);
  }

  const p = screenToFreeformSpace(state.doc, shape, current, state.viewport, screen);
  if (!p) return;
  setPaint(state, shape, inter.target, updateFreeformPoint(current, pointId, { position: p }));
  ctx.scheduleDraw();
}

/** Screen position of one colour point — the centre a spread drag measures from. */
function freeformPointScreen(
  state: EditorState,
  shape: Shape,
  target: PaintTarget,
  pointId: string
): Vec2 | null {
  const controls = freeformControls(state.doc, shape, target, state.viewport);
  return controls?.points.find((p) => p.id === pointId)?.point ?? null;
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
  const p = screenToPaintSpace(state.doc, shape, inter.paint, state.viewport, screen);
  if (!p) return;
  inter.placed = true;
  setPaint(state, shape, inter.target, {
    ...inter.paint,
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

/**
 * Add a stop where the ramp was double-clicked. A double-click that lands
 * anywhere else is not a ramp edit and leaves the gradient alone.
 */
export function addGradientStopAt(ctx: ToolContext, state: EditorState, screen: Vec2): void {
  const { target } = useGradientTool.getState();
  const controls = gradientControls(
    state.doc,
    gradientTargetShape(state.doc, state.selection),
    target,
    state.viewport,
    ctx.hitScale()
  );
  if (!controls) return;
  const t = pickGradientRamp(controls, screen, ctx.hitScale());
  if (t === null) return;
  const { paint, stop } = addStopAt(controls.paint, t);
  state.updateSelectedStyle({ [target]: paint });
  useGradientTool.getState().setStopId(stop.id);
}

export function finishGradient(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction
): void {
  // A press that never became a drag changed nothing; don't leave an empty
  // undo step (or a collapsed gradient) behind.
  if (inter.kind === "gradient-axis" && !inter.placed) state.cancelInteraction();
  else state.endInteraction();
  ctx.scheduleDraw();
}
