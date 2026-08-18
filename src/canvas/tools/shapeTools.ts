import { pointsToAnchors, simplifyPath } from "@/model/path/freehand";
import { applyMatrix } from "@/model/geometry/matrix";
import {
  makeId,
  type Matrix,
  type PathAnchor,
  type PathShape,
  type Shape,
  type Vec2,
} from "../../model/types";
import {
  markersFromDefaults,
  styleFromDefaults,
  type EditorState,
  type StyleDefaults,
} from "../../store/editorStore";
import { usePencil } from "../../store/pencilStore";
import { setReadout } from "../../store/pointerStore";
import {
  CLICK_SLOP,
  SMOOTH_REF_MS,
  type StrokeSample,
  type ToolContext,
} from "../interaction";
import { EMPTY_EXCLUDE, guideGridSnap, pointSnap } from "../picking";
import { grabRadius, pickupOpenPath } from "./openPathPickup";
import { constrain45, formatAngle, formatSize } from "../util";

// ---- rect / ellipse / line ------------------------------------------------

export function startShape(ctx: ToolContext, state: EditorState, world: Vec2) {
  const start = pointSnap(ctx, world, EMPTY_EXCLUDE);
  ctx.preview.current = makeCreatedShape(state.tool, start, start, state.style);
  ctx.interaction.current = { kind: "create", start };
  ctx.scheduleDraw();
}

/**
 * The world axes a creation drag is still free to move its corner along, which
 * is the only place snapping may act (see the snapping rule in
 * `docs/design/rulers-and-guides.md`). Without Shift both are free. With it a
 * rect/ellipse keeps the pointer on whichever axis grew more and derives the
 * other from it, and a line is pinned to a 45° ray, where no world axis is free
 * at all.
 */
function createSnapAxes(
  tool: string,
  start: Vec2,
  world: Vec2,
  shiftKey: boolean
): { x: boolean; y: boolean } | undefined {
  if (!shiftKey) return undefined;
  if (tool === "line") return { x: false, y: false };
  return Math.abs(world.x - start.x) >= Math.abs(world.y - start.y)
    ? { x: true, y: false }
    : { x: false, y: true };
}

export function onCreateMove(
  ctx: ToolContext,
  state: EditorState,
  start: Vec2,
  world: Vec2,
  shiftKey: boolean,
  altKey: boolean
) {
  const axes = createSnapAxes(state.tool, start, world, shiftKey);
  const shape = makeCreatedShape(
    state.tool,
    start,
    pointSnap(ctx, world, EMPTY_EXCLUDE, axes ? { axes } : {}),
    state.style,
    shiftKey,
    altKey
  );
  ctx.preview.current = shape;
  if (shape.type === "line") {
    const len = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    const ang = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
    setReadout(`L ${Math.round(len)} · ${formatAngle(ang)}`);
  } else if (shape.type === "rect" || shape.type === "ellipse") {
    setReadout(formatSize(shape.width, shape.height));
  }
  ctx.scheduleDraw();
}

export function finishCreate(ctx: ToolContext, state: EditorState) {
  const shape = ctx.preview.current;
  ctx.preview.current = null;
  if (shape && isShapeSubstantial(shape)) state.addShape(shape);
  ctx.scheduleDraw();
}

// ---- pencil (freehand) ------------------------------------------------------

// Live smoothing state for the active freehand stroke. `smoothed` is the EMA of
// the raw pointer, advanced every move sample (like the brush's stabilizer);
// `smoothing` is captured at stroke start so mid-stroke option changes don't
// jump the line. `last` is the last committed world point, for the min-distance
// filter. `extend`, when set, means the stroke is continuing a selected open
// path instead of drawing a new one: the preview shape is that path (reversed
// so we always append to the end), `inverse` maps world → the path's local
// space, and `newPoints` collects the drawn tail in world space for the commit.
// Reset on each `startPencil`, so a leftover after a cancel is harmless.
interface PencilExtend {
  base: PathShape;
  inverse: Matrix;
  world: Matrix;
  newPoints: Vec2[];
}
interface PencilStroke {
  smoothed: Vec2;
  smoothing: number;
  last: Vec2;
  /** Timestamp of the last sample the average was advanced with (ms). */
  lastT: number;
  extend: PencilExtend | null;
}
let pencilStroke: PencilStroke | null = null;

/** Screen-space spacing between kept freehand samples, in world units. The
 *  filter has to be screen-relative: a fixed world distance would drop detail
 *  when zoomed out and turn strokes angular when zoomed in. */
function pencilMinDist(state: EditorState): number {
  return 1.2 / state.viewport.scale;
}

/** How close the stroke's end has to come to its start to close the path. */
function pencilCloseTol(ctx: ToolContext, state: EditorState): number {
  // The same distance (and the same touch enlargement) at which the pen closes
  // a draft by clicking its first anchor.
  return grabRadius(ctx) / state.viewport.scale;
}

/** Did the stroke end back on its own start, closely enough to meet it? */
function freehandEndsOnStart(
  first: Vec2,
  last: Vec2,
  closeTol: number
): boolean {
  return Math.hypot(last.x - first.x, last.y - first.y) <= closeTol;
}

/**
 * Does a freehand stroke become a closed path? The live close hint and the
 * commit both ask this and must never disagree — a ring that promises a closed
 * path and a release that leaves it open is worse than no ring at all — so the
 * rule lives here only. The `count` floor holds in every mode: a stroke of two
 * or three samples closes into a degenerate sliver, never a region.
 */
function freehandCloses(
  first: Vec2,
  last: Vec2,
  count: number,
  closeTol: number
): boolean {
  if (count <= 3) return false;
  switch (usePencil.getState().close) {
    case "never":
      return false;
    case "always":
      return true;
    default:
      return freehandEndsOnStart(first, last, closeTol);
  }
}

/**
 * Advance the exponential moving average towards the raw pointer: strength 0
 * tracks it exactly, →1 lags heavily. The strength is defined per
 * {@link SMOOTH_REF_MS}, and a sample covering `dt` keeps `s^(dt/ref)` of the
 * error, so the line comes out the same on a 60 Hz mouse and a 240 Hz stylus
 * (see {@link StrokeSample}). `dt` is clamped: a batch of coalesced samples
 * sharing one timestamp must not stall the average, and a stroke resumed after
 * a long pause must not snap to the pointer.
 */
function advanceSmoothing(
  stroke: PencilStroke,
  world: Vec2,
  dt: number
): void {
  const step = Math.min(100, Math.max(1, dt));
  const retain = stroke.smoothing ** (step / SMOOTH_REF_MS);
  stroke.smoothed = {
    x: stroke.smoothed.x + (world.x - stroke.smoothed.x) * (1 - retain),
    y: stroke.smoothed.y + (world.y - stroke.smoothed.y) * (1 - retain),
  };
}

/** Append the current smoothed point to the live stroke, unless it sits too
 *  close to the last kept one. Reports whether anything was added. */
function pushPencilPoint(
  stroke: PencilStroke,
  shape: PathShape,
  minDist: number
): boolean {
  const p = stroke.smoothed;
  if (Math.hypot(p.x - stroke.last.x, p.y - stroke.last.y) < minDist) {
    return false;
  }
  appendPencilPoint(stroke, shape, p);
  return true;
}

/** Append an already-filtered point to the capture and its live preview. */
function appendPencilPoint(
  stroke: PencilStroke,
  shape: PathShape,
  p: Vec2
): void {
  stroke.last = { ...p };
  const ext = stroke.extend;
  if (ext) {
    ext.newPoints.push({ ...p });
    // Append to the preview in the path's local space so it renders in place.
    shape.subpaths[0].anchors.push({
      p: applyMatrix(ext.inverse, p),
      hIn: null,
      hOut: null,
    });
  } else {
    shape.subpaths[0].anchors.push({ p: { ...p }, hIn: null, hOut: null });
  }
}

/** Frames the tail settle is allowed to take; at the maximum smoothing (0.95)
 *  this closes 96% of the remaining gap, and at the default it converges long
 *  before. */
const SETTLE_STEPS = 64;

interface PencilTailSettlement {
  smoothed: Vec2;
  last: Vec2;
  points: Vec2[];
}

/**
 * Calculate the tail that a release at `world` would append. Keeping this pure
 * lets the live close affordance ask the exact same question as pointer-up,
 * without mutating the preview before the pointer is actually lifted.
 */
function pencilTailSettlement(
  stroke: PencilStroke,
  world: Vec2,
  minDist: number
): PencilTailSettlement {
  const trial: PencilStroke = {
    ...stroke,
    smoothed: { ...stroke.smoothed },
    last: { ...stroke.last },
  };
  const points: Vec2[] = [];
  for (let i = 0; i < SETTLE_STEPS; i++) {
    advanceSmoothing(trial, world, SMOOTH_REF_MS);
    const p = trial.smoothed;
    if (Math.hypot(p.x - trial.last.x, p.y - trial.last.y) >= minDist) {
      trial.last = { ...p };
      points.push({ ...p });
    }
    if (Math.hypot(p.x - world.x, p.y - world.y) <= minDist / 2) break;
  }
  return { smoothed: trial.smoothed, last: trial.last, points };
}

/**
 * Walk the smoothed point the rest of the way to where the pointer was lifted.
 * The average trails the pointer, so without this a stroke ends short of its
 * release point — barely at the default smoothing, visibly at high settings,
 * and it is the end of a stroke that people aim. Settling by the same average
 * rather than jumping straight to the raw point keeps a heavily smoothed line
 * from growing a spike on its tail; it also lets the release point decide
 * whether the stroke closes.
 */
function settlePencilTail(
  stroke: PencilStroke,
  shape: PathShape,
  world: Vec2,
  minDist: number
): void {
  const settled = pencilTailSettlement(stroke, world, minDist);
  for (const p of settled.points) appendPencilPoint(stroke, shape, p);
  stroke.smoothed = settled.smoothed;
}

/** Throw away any half-captured stroke (the document it belonged to is gone). */
export function resetPencilStroke() {
  pencilStroke = null;
}

export function startPencil(
  ctx: ToolContext,
  state: EditorState,
  world: Vec2,
  screen: Vec2
) {
  const smoothing = usePencil.getState().smoothing;
  // Starting near an endpoint of a *selected* open path continues it. Requiring
  // selection keeps the pencil from silently grabbing whatever lies under the
  // cursor (the pen tool continues any open path; here it must be deliberate).
  const pick = pickupOpenPath(ctx, state, screen, { requireSelected: true });
  if (pick) {
    pencilStroke = {
      smoothed: { ...world },
      smoothing,
      last: { ...world },
      lastT: performance.now(),
      extend: {
        base: pick.base,
        inverse: pick.inverse,
        world: pick.world,
        newPoints: [],
      },
    };
    // The preview is the existing path; the drawn tail is appended live.
    ctx.preview.current = structuredClone(pick.base);
    ctx.interaction.current = { kind: "pencil" };
    ctx.scheduleDraw();
    return;
  }
  // A freehand stroke is imprecise everywhere except where it begins, so the
  // start point snaps — but only to guides and the grid, the references the
  // user placed on purpose. Nothing after it snaps: the rest is freehand.
  world = guideGridSnap(ctx, world);
  pencilStroke = {
    smoothed: world,
    smoothing,
    last: world,
    // Event timestamps share the `performance.now` clock, so the first sample's
    // dt is measured from the press.
    lastT: performance.now(),
    extend: null,
  };
  const shape: Shape = {
    id: makeId("path"),
    name: "Path",
    type: "path",
    subpaths: [{
      anchors: [{ p: world, hIn: null, hOut: null }],
      closed: false,
    }],
    fillRule: "nonzero",
    ...styleFromDefaults(state.style),
    ...markersFromDefaults(state.style),
    fill: null,
  };
  ctx.preview.current = shape;
  ctx.interaction.current = { kind: "pencil" };
  ctx.scheduleDraw();
}

/** `samples` is the whole run the move event covers (coalesced included), so a
 *  fast stroke keeps its sample density instead of one point per frame. */
export function onPencilMove(
  ctx: ToolContext,
  state: EditorState,
  samples: StrokeSample[]
) {
  const shape = ctx.preview.current;
  if (!shape || shape.type !== "path" || !pencilStroke) return;
  const minDist = pencilMinDist(state);
  let changed = false;
  let releaseWorld: Vec2 | null = null;
  for (const { world, t } of samples) {
    releaseWorld = world;
    // The average advances on every sample, even ones the filter then drops.
    advanceSmoothing(pencilStroke, world, t - pencilStroke.lastT);
    pencilStroke.lastT = t;
    if (pushPencilPoint(pencilStroke, shape, minDist)) changed = true;
  }
  const closeHintChanged = releaseWorld
    ? updateCloseHint(ctx, state, shape, releaseWorld)
    : false;
  if (changed || closeHintChanged) {
    // The start snap's guide lines have done their job once the stroke is
    // under way; leaving them up for its whole length is just clutter.
    if (changed && ctx.guides.current.length) ctx.guides.current = [];
    ctx.scheduleDraw();
  }
}

/**
 * Preview the close: the closing edge and the fill the closed path would get,
 * plus a ring on the point releasing there would close onto. Closing is
 * otherwise invisible until the pointer is up, and by then it has already
 * happened — the pen shows the same promise with the same mark while a click
 * would close its draft. An extension closes onto the far end of the path it
 * continues, which is that path's first anchor (the pickup reverses it so the
 * tail always appends to the end). This is the stroke's own state
 * (`closeHint`), not the hover affordance that rings someone else's endpoint.
 */
function updateCloseHint(
  ctx: ToolContext,
  state: EditorState,
  shape: PathShape,
  releaseWorld: Vec2
): boolean {
  const stroke = pencilStroke;
  if (!stroke) return false;
  const anchors = shape.subpaths[0].anchors;
  const ext = stroke.extend;
  // An extension's preview is the continued path, drawn in its local space; the
  // settled tail is in world space, so the comparison happens in world.
  const first = ext ? applyMatrix(ext.world, anchors[0].p) : anchors[0].p;
  const settled = pencilTailSettlement(
    stroke,
    releaseWorld,
    pencilMinDist(state)
  );
  const closeTol = pencilCloseTol(ctx, state);
  const closes = freehandCloses(
    first,
    settled.last,
    anchors.length + settled.points.length,
    closeTol
  );
  // The ring marks a place, so it only says something while releasing *there*
  // is what closes the path: a forced close draws none, and the closing edge
  // in the preview carries the promise instead.
  const ring =
    closes && freehandEndsOnStart(first, settled.last, closeTol) ? first : null;
  const ringChanged = (ctx.closeHint.current !== null) !== (ring !== null);
  ctx.closeHint.current = ring;
  // A loop the user deliberately closed is a region and takes the current fill,
  // but an extension never overwrites a fill the continued path already has.
  const baseFill = ext ? ext.base.fill : null;
  const nextFill = closes ? baseFill ?? state.style.fill : baseFill;
  const shapeChanged =
    shape.fill !== nextFill || shape.subpaths[0].closed !== closes;
  shape.fill = nextFill;
  shape.subpaths[0].closed = closes;
  return ringChanged || shapeChanged;
}

/** `world` is where the pointer was lifted; the stroke is settled onto it. */
export function finishPencil(
  ctx: ToolContext,
  state: EditorState,
  world: Vec2
) {
  const stroke = pencilStroke;
  pencilStroke = null;
  const shape = ctx.preview.current;
  ctx.preview.current = null;
  // The close ring belongs to the stroke; touch has no hover to clear it later.
  ctx.closeHint.current = null;
  ctx.guides.current = [];
  if (stroke && shape && shape.type === "path") {
    settlePencilTail(stroke, shape, world, pencilMinDist(state));
  }
  if (stroke?.extend) {
    commitPencilExtend(state, stroke.extend, pencilCloseTol(ctx, state));
    ctx.scheduleDraw();
    return;
  }
  if (shape && shape.type === "path" && shape.subpaths[0].anchors.length >= 2) {
    state.addShape(
      freehandToPath(
        shape.subpaths[0].anchors.map((anchor) => anchor.p),
        state,
        pencilCloseTol(ctx, state)
      )
    );
  }
  ctx.scheduleDraw();
}

/**
 * Commit a freehand extension of an open path. The drawn tail is fitted in
 * world space (so the tolerance stays screen-relative regardless of the target
 * path's transform), then mapped back into the path's local space and spliced
 * onto the original anchors, replacing the endpoint anchor with the refitted
 * one while keeping its incoming handle. The original geometry is otherwise
 * untouched. A stroke with no travel leaves the path unchanged.
 *
 * An extension that comes back to the path's far end closes it, under the same
 * {@link freehandCloses} rule (and the same live hint) as a fresh stroke — the
 * two ends of an open path are the only way to draw a loop in two goes.
 */
function commitPencilExtend(
  state: EditorState,
  ext: PencilExtend,
  closeTol: number
): void {
  if (ext.newPoints.length < 1) return;
  const orig = ext.base.subpaths[0].anchors;
  const { points, closed } = resolveExtendClose(
    orig,
    ext.newPoints,
    ext.world,
    closeTol
  );
  const anchors = buildExtendedAnchors(
    orig,
    points,
    ext.world,
    ext.inverse,
    usePencil.getState().simplify / state.viewport.scale
  );
  state.updateShape({
    ...ext.base,
    subpaths: [{ anchors, closed }],
    ...(closed && ext.base.fill === null ? { fill: state.style.fill } : {}),
  });
}

/**
 * Does an extension close the path it continues, and which of the drawn points
 * survive? The pickup reversed the path so the tail appends to its end, which
 * makes `orig[0]` the far end — the only point an extension can close onto.
 * A stroke that ended there duplicates it and the closed subpath implies that
 * edge, so the duplicate is dropped; a forced close ends wherever the pointer
 * lifted and keeps every point (`freehandToPath` does the same for a fresh
 * stroke). Pure and exported for tests.
 */
export function resolveExtendClose(
  orig: PathAnchor[],
  newPointsWorld: Vec2[],
  world: Matrix,
  closeTol: number
): { points: Vec2[]; closed: boolean } {
  const startWorld = applyMatrix(world, orig[0].p);
  const last = newPointsWorld[newPointsWorld.length - 1];
  const closed = freehandCloses(
    startWorld,
    last,
    orig.length + newPointsWorld.length,
    closeTol
  );
  const points =
    closed && freehandEndsOnStart(startWorld, last, closeTol)
      ? newPointsWorld.slice(0, -1)
      : newPointsWorld;
  return { points, closed };
}

/**
 * Splice a freehand tail onto an open path's anchors. `newPointsWorld` is the
 * drawn tail in world space; it is prefixed with the path's world-space
 * endpoint so the fit is continuous, simplified/fitted in world space (keeping
 * `tolerance` screen-relative whatever the path's transform), then mapped back
 * to local. The refitted first anchor lands on the old endpoint and inherits
 * its incoming handle, so the original geometry up to the seam is preserved.
 * Pure and exported for tests.
 */
export function buildExtendedAnchors(
  orig: PathAnchor[],
  newPointsWorld: Vec2[],
  world: Matrix,
  inverse: Matrix,
  tolerance: number
): PathAnchor[] {
  const endpointWorld = applyMatrix(world, orig[orig.length - 1].p);
  const tailWorld = [endpointWorld, ...newPointsWorld];
  const simplified = simplifyPath(tailWorld, tolerance);
  const fitted = pointsToAnchors(simplified.length >= 2 ? simplified : tailWorld, false);
  const toLocal = (v: Vec2 | null) => (v ? applyMatrix(inverse, v) : null);
  const tail: PathAnchor[] = fitted.map((a) => ({
    p: applyMatrix(inverse, a.p),
    hIn: toLocal(a.hIn),
    hOut: toLocal(a.hOut),
    ...(a.t ? { t: a.t } : {}),
  }));
  // `tail[0]` sits on the old endpoint; keep that anchor's original incoming
  // handle so the existing curve into the seam is preserved.
  if (tail[0]) tail[0].hIn = orig[orig.length - 1].hIn;
  return [...orig.slice(0, -1), ...tail];
}

// ---- shape construction -----------------------------------------------------

function makeCreatedShape(
  tool: string,
  a: Vec2,
  bRaw: Vec2,
  style: StyleDefaults,
  shift = false,
  alt = false
): Shape {
  const base = { ...styleFromDefaults(style) };

  if (tool === "line") {
    const b = shift ? constrain45(a, bRaw) : bRaw;
    return {
      id: makeId("line"),
      name: "Line",
      type: "line",
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      ...base,
      ...markersFromDefaults(style),
      fill: null,
    };
  }

  // rect / ellipse — Shift = square/circle, Alt = grow from center.
  let dx = bRaw.x - a.x;
  let dy = bRaw.y - a.y;
  if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * m;
    dy = (dy < 0 ? -1 : 1) * m;
  }
  const p1 = alt ? { x: a.x - dx, y: a.y - dy } : a;
  const p2 = { x: a.x + dx, y: a.y + dy };
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);

  return {
    id: makeId(tool),
    name: tool === "rect" ? "Rectangle" : "Ellipse",
    x,
    y,
    width,
    height,
    ...base,
    ...(tool === "rect"
      ? { type: "rect" as const, cornerRadius: 0 }
      : { type: "ellipse" as const }),
  };
}

/**
 * Convert a freehand polyline into a smooth, editable Bézier shape. Closes the
 * path when the stroke ends near where it began.
 */
function freehandToPath(
  rawPoints: Vec2[],
  state: EditorState,
  closeTol: number
): PathShape {
  let pts = rawPoints;
  const closed = freehandCloses(
    pts[0],
    pts[pts.length - 1],
    pts.length,
    closeTol
  );
  // A stroke that ended on its start duplicates the first point; the closed
  // subpath implies that edge. A forced close ends wherever the pointer lifted,
  // and dropping that point would throw away real geometry.
  if (closed && freehandEndsOnStart(pts[0], pts[pts.length - 1], closeTol)) {
    pts = pts.slice(0, -1);
  }
  const simplified = simplifyPath(pts, usePencil.getState().simplify / state.viewport.scale);
  const anchors = pointsToAnchors(simplified.length >= 2 ? simplified : pts, closed);
  return {
    id: makeId("path"),
    name: "Pencil",
    type: "path",
    subpaths: [{ anchors, closed }],
    fillRule: "nonzero",
    ...styleFromDefaults(state.style),
    ...markersFromDefaults(state.style),
    // An open stroke is a line and takes no fill; a loop the user deliberately
    // closed is a region, so it gets the current fill like any drawn shape.
    ...(closed ? {} : { fill: null }),
  };
}

function isShapeSubstantial(shape: Shape): boolean {
  if (shape.type === "line") {
    return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) > CLICK_SLOP;
  }
  if (shape.type === "rect" || shape.type === "ellipse") {
    return (
      Math.abs(shape.width) > CLICK_SLOP || Math.abs(shape.height) > CLICK_SLOP
    );
  }
  return true;
}
