import { pointsToAnchors, simplifyPath } from "../../model/freehand";
import {
  makeId,
  type PathShape,
  type Shape,
  type Vec2,
} from "../../model/types";
import {
  styleFromDefaults,
  type EditorState,
  type StyleDefaults,
} from "../../store/editorStore";
import { setReadout } from "../../store/pointerStore";
import { CLICK_SLOP, type ToolContext } from "../interaction";
import { EMPTY_EXCLUDE, pointSnap } from "../picking";
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

export function startPencil(ctx: ToolContext, state: EditorState, world: Vec2) {
  const shape: Shape = {
    id: makeId("path"),
    name: "Path",
    type: "path",
    subpaths: [{
      anchors: [{ p: world, hIn: null, hOut: null }],
      closed: false,
    }],
    ...styleFromDefaults(state.style),
    fill: null,
  };
  ctx.preview.current = shape;
  ctx.interaction.current = { kind: "pencil" };
  ctx.scheduleDraw();
}

export function onPencilMove(ctx: ToolContext, world: Vec2) {
  const shape = ctx.preview.current;
  if (shape && shape.type === "path") {
    const anchors = shape.subpaths[0].anchors;
    const last = anchors[anchors.length - 1]?.p;
    if (!last || Math.hypot(world.x - last.x, world.y - last.y) > 1.5) {
      anchors.push({ p: world, hIn: null, hOut: null });
      ctx.scheduleDraw();
    }
  }
}

export function finishPencil(ctx: ToolContext, state: EditorState) {
  const shape = ctx.preview.current;
  ctx.preview.current = null;
  if (shape && shape.type === "path" && shape.subpaths[0].anchors.length >= 2) {
    state.addShape(freehandToPath(shape.subpaths[0].anchors.map((anchor) => anchor.p), state));
  }
  ctx.scheduleDraw();
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
    type: tool === "rect" ? "rect" : "ellipse",
    x,
    y,
    width,
    height,
    ...(tool === "rect" ? { cornerRadius: 0 } : {}),
    ...base,
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
  const simplified = simplifyPath(pts, 2 / state.viewport.scale);
  const anchors = pointsToAnchors(simplified.length >= 2 ? simplified : pts, closed);
  return {
    id: makeId("path"),
    name: "Pencil",
    type: "path",
    subpaths: [{ anchors, closed }],
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
