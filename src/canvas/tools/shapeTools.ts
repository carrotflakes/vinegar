import { pointsToAnchors, simplifyPath } from "@/model/path/freehand";
import { reversePath } from "@/model/path/path";
import {
  applyMatrix,
  invertMatrix,
  shapeWorldMatrix,
} from "@/model/geometry/matrix";
import {
  makeId,
  type Matrix,
  type PathAnchor,
  type PathShape,
  type Shape,
  type Vec2,
} from "../../model/types";
import {
  styleFromDefaults,
  type EditorState,
  type StyleDefaults,
} from "../../store/editorStore";
import { usePencil } from "../../store/pencilStore";
import { setReadout } from "../../store/pointerStore";
import { CLICK_SLOP, type ToolContext } from "../interaction";
import { EMPTY_EXCLUDE, pointSnap } from "../picking";
import { pickOpenEndpoint } from "./penTool";
import { constrain45, formatAngle, formatSize } from "../util";

// ---- rect / ellipse / line ------------------------------------------------

export function startShape(ctx: ToolContext, state: EditorState, world: Vec2) {
  const start = pointSnap(ctx, world, EMPTY_EXCLUDE);
  ctx.preview.current = makeCreatedShape(state.tool, start, start, state.style);
  ctx.interaction.current = { kind: "create", start };
  ctx.scheduleDraw();
}

export function onCreateMove(
  ctx: ToolContext,
  state: EditorState,
  start: Vec2,
  world: Vec2,
  shiftKey: boolean,
  altKey: boolean
) {
  const shape = makeCreatedShape(
    state.tool,
    start,
    pointSnap(ctx, world, EMPTY_EXCLUDE),
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
let pencilStroke:
  | { smoothed: Vec2; smoothing: number; last: Vec2; extend: PencilExtend | null }
  | null = null;

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
  const pick = pickOpenEndpoint(ctx, state, screen);
  if (pick && state.selection.includes(pick.shape.id)) {
    const worldMatrix = shapeWorldMatrix(state.doc, pick.shape);
    const inverse = invertMatrix(worldMatrix);
    if (inverse) {
      // Reverse a "start" pickup so the drawn tail always appends to the end;
      // continuing by hand overrides the geometry, so drop any generator link.
      const base: PathShape = {
        ...(pick.end === "start" ? reversePath(pick.shape) : pick.shape),
        generator: null,
      };
      pencilStroke = {
        smoothed: { ...world },
        smoothing,
        last: { ...world },
        extend: { base, inverse, world: worldMatrix, newPoints: [] },
      };
      // The preview is the existing path; the drawn tail is appended live.
      ctx.preview.current = structuredClone(base);
      ctx.interaction.current = { kind: "pencil" };
      ctx.scheduleDraw();
      return;
    }
  }
  pencilStroke = { smoothed: world, smoothing, last: world, extend: null };
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
    fill: null,
  };
  ctx.preview.current = shape;
  ctx.interaction.current = { kind: "pencil" };
  ctx.scheduleDraw();
}

export function onPencilMove(ctx: ToolContext, world: Vec2) {
  const shape = ctx.preview.current;
  if (!shape || shape.type !== "path" || !pencilStroke) return;
  // Exponential moving average: strength 0 tracks the pointer exactly, →1 lags
  // heavily. Advanced every sample even when no anchor is added below.
  const s = pencilStroke.smoothing;
  pencilStroke.smoothed = {
    x: pencilStroke.smoothed.x + (world.x - pencilStroke.smoothed.x) * (1 - s),
    y: pencilStroke.smoothed.y + (world.y - pencilStroke.smoothed.y) * (1 - s),
  };
  const p = pencilStroke.smoothed;
  const last = pencilStroke.last;
  if (Math.hypot(p.x - last.x, p.y - last.y) <= 1.5) return;
  pencilStroke.last = { ...p };
  const ext = pencilStroke.extend;
  if (ext) {
    ext.newPoints.push({ ...p });
    // Append to the preview in the path's local space so it renders in place.
    shape.subpaths[0].anchors.push({ p: applyMatrix(ext.inverse, p), hIn: null, hOut: null });
  } else {
    shape.subpaths[0].anchors.push({ p: { ...p }, hIn: null, hOut: null });
  }
  ctx.scheduleDraw();
}

export function finishPencil(ctx: ToolContext, state: EditorState) {
  const stroke = pencilStroke;
  pencilStroke = null;
  const shape = ctx.preview.current;
  ctx.preview.current = null;
  if (stroke?.extend) {
    commitPencilExtend(state, stroke.extend);
    ctx.scheduleDraw();
    return;
  }
  if (shape && shape.type === "path" && shape.subpaths[0].anchors.length >= 2) {
    state.addShape(freehandToPath(shape.subpaths[0].anchors.map((anchor) => anchor.p), state));
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
 */
function commitPencilExtend(state: EditorState, ext: PencilExtend): void {
  if (ext.newPoints.length < 1) return;
  const anchors = buildExtendedAnchors(
    ext.base.subpaths[0].anchors,
    ext.newPoints,
    ext.world,
    ext.inverse,
    usePencil.getState().simplify / state.viewport.scale
  );
  state.updateShape({ ...ext.base, subpaths: [{ anchors, closed: false }] });
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
function freehandToPath(rawPoints: Vec2[], state: EditorState): PathShape {
  let pts = rawPoints;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closeTol = 10 / state.viewport.scale;
  let closed = false;
  if (
    pts.length > 3 &&
    Math.hypot(last.x - first.x, last.y - first.y) <= closeTol
  ) {
    closed = true;
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
    fill: null,
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
