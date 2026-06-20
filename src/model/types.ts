// ===========================================================================
// Document model — vector shapes are stored in world coordinates.
// Geometry is intentionally explicit (no transform matrices yet) to keep
// hit-testing, selection and editing straightforward. Rotation/transform
// support can be layered on later.
// ===========================================================================

export type Vec2 = { x: number; y: number };

export type ShapeType = "rect" | "ellipse" | "line" | "path" | "bezier";

/** Common visual + identity fields shared by every shape. */
export interface BaseShape {
  id: string;
  name: string;
  /** `null` fill means "no fill" (transparent). */
  fill: string | null;
  /** `null` stroke means "no stroke". */
  stroke: string | null;
  strokeWidth: number;
  /** 0..1 */
  opacity: number;
}

/** Axis-aligned rectangle, defined by its top-left corner and size. */
export interface RectShape extends BaseShape {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ellipse defined by its bounding box (top-left + size). */
export interface EllipseShape extends BaseShape {
  type: "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Straight line segment between two points. */
export interface LineShape extends BaseShape {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Freehand / multi-point path. Points are absolute world coordinates. */
export interface PathShape extends BaseShape {
  type: "path";
  points: Vec2[];
  closed: boolean;
}

/**
 * A single anchor of a Bézier path. Control handles are stored as absolute
 * world points (so transforms map them like any other point). A `null` handle
 * means that side is a sharp corner.
 */
export interface BezierAnchor {
  p: Vec2;
  hIn: Vec2 | null;
  hOut: Vec2 | null;
}

/** Cubic Bézier path produced by the pen tool. */
export interface BezierShape extends BaseShape {
  type: "bezier";
  anchors: BezierAnchor[];
  closed: boolean;
}

export type Shape =
  | RectShape
  | EllipseShape
  | LineShape
  | PathShape
  | BezierShape;

/** Axis-aligned bounding box. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole drawing document. `order` lists shape ids back-to-front. */
export interface Document {
  shapes: Record<string, Shape>;
  order: string[];
}

export function createEmptyDocument(): Document {
  return { shapes: {}, order: [] };
}

let idCounter = 0;
export function makeId(prefix = "shape"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}
