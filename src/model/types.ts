// ===========================================================================
// Document model — vector shapes are stored in world coordinates.
// Geometry is intentionally explicit (no transform matrices yet) to keep
// hit-testing, selection and editing straightforward. Rotation/transform
// support can be layered on later.
// ===========================================================================

export type Vec2 = { x: number; y: number };

export type ShapeType =
  | "rect"
  | "ellipse"
  | "line"
  | "path"
  | "bezier"
  | "polygon";

/**
 * Blend modes shared verbatim by Canvas 2D (`globalCompositeOperation`) and
 * CSS/SVG (`mix-blend-mode`). "normal" (or an absent field) means source-over.
 */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

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
  /** How the shape composites onto what's below. Absent = "normal". */
  blendMode?: BlendMode;
  /** Rotation in radians about the shape's local bounding-box center. */
  rotation: number;
  /** Immediate enclosing group (see `Group`); `null`/absent = ungrouped. */
  groupId?: string | null;
  /** Hidden shapes are not rendered and cannot be picked on the canvas. */
  hidden?: boolean;
  /** Locked shapes cannot be picked or edited on the canvas. */
  locked?: boolean;
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

/**
 * Multi-polygon, produced by boolean operations. `polys` is an array of
 * polygons, each `[outerRing, ...holeRings]`; rings are closed loops with no
 * repeated final point. Rendered with the even-odd rule so holes show through.
 */
export interface PolygonShape extends BaseShape {
  type: "polygon";
  polys: Vec2[][][];
}

/** Flatten a polygon shape's polys into a flat list of rings. */
export function polygonRings(shape: PolygonShape): Vec2[][] {
  return shape.polys.flat();
}

/**
 * A group is a real document entity: it can nest (via `parentId`) and carries
 * its own visual properties. Opacity/blend on a group composite the whole
 * group as one layer. Membership lives on shapes (`shape.groupId` = immediate
 * group); a group's block is kept contiguous in `order`.
 */
export interface Group {
  id: string;
  name: string;
  /** Enclosing group; `null`/absent = top level. */
  parentId?: string | null;
  /** 0..1 group-layer opacity. Absent = 1. */
  opacity?: number;
  /** How the group layer composites onto what's below. Absent = "normal". */
  blendMode?: BlendMode;
  /** Hides every descendant. */
  hidden?: boolean;
  /** Locks every descendant. */
  locked?: boolean;
}

export type Shape =
  | RectShape
  | EllipseShape
  | LineShape
  | PathShape
  | BezierShape
  | PolygonShape;

/** Axis-aligned bounding box. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Document-wide values that should travel with the drawing file. */
export interface DocumentSettings {
  /** Authoring unit. Geometry continues to be stored as unitless numbers. */
  unit: "px" | "mm" | "cm" | "in" | "pt";
  /** Resolution used when converting physical units to pixels. */
  dpi: number;
  /** Document grid, as opposed to the user's transient snap preference. */
  gridSize: number;
}

/** Metadata for forward-compatible document management. */
export interface DocumentMetadata {
  createdAt: string;
  modifiedAt: string;
}

/**
 * Binary resources are referenced by id instead of being embedded in shapes.
 * `source` is intentionally a discriminated union so packaged/external asset
 * locations can be added without changing every image-like node.
 */
export interface DocumentAsset {
  id: string;
  kind: "image";
  mimeType: string;
  name?: string;
  source: { type: "data"; data: string };
}

/** The whole drawing document. `order` lists shape ids back-to-front. */
export interface Document {
  shapes: Record<string, Shape>;
  order: string[];
  groups: Record<string, Group>;
  settings: DocumentSettings;
  metadata: DocumentMetadata;
  assets: Record<string, DocumentAsset>;
  /** Namespaced data reserved for future plugins/importers. */
  extensions: Record<string, unknown>;
}

export function createEmptyDocument(): Document {
  const now = new Date().toISOString();
  return {
    shapes: {},
    order: [],
    groups: {},
    settings: { unit: "px", dpi: 96, gridSize: 50 },
    metadata: { createdAt: now, modifiedAt: now },
    assets: {},
    extensions: {},
  };
}

let idCounter = 0;
export function makeId(prefix = "shape"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}
