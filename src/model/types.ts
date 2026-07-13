// ===========================================================================
// Document model — shape geometry is local and each node carries an affine
// transform into its parent coordinate space.
// ===========================================================================

import type { Paint } from "./paint";

export type Vec2 = { x: number; y: number };

/** Canvas/SVG-compatible 2D affine matrix [a, b, c, d, e, f]. */
export type Matrix = [number, number, number, number, number, number];

export type ShapeType =
  | "rect"
  | "ellipse"
  | "line"
  | "path"
  | "bezier"
  | "polygon"
  | "compoundPath"
  | "image"
  | "text";

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

/** Fields shared by every persisted scene node. */
export interface BaseNode {
  id: string;
  name: string;
  /** Maps the node's local space into its parent space. */
  transform: Matrix;
  /** Explicit rotation center in local space; null uses content center. */
  transformOrigin: Vec2 | null;
  /** 0..1 */
  opacity: number;
  /** How the node composites onto what's below. */
  blendMode?: BlendMode;
  hidden?: boolean;
  locked?: boolean;
}

/** Common paint fields shared by every shape. */
export interface BaseShape extends BaseNode {
  /** `null` fill means "no fill" (transparent). */
  fill: Paint | null;
  /** `null` stroke means "no stroke". */
  stroke: Paint | null;
  strokeWidth: number;
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

/** Freehand / multi-point path. Points are in the shape's local space. */
export interface PathShape extends BaseShape {
  type: "path";
  points: Vec2[];
  closed: boolean;
}

/**
 * A single anchor of a Bézier path. Control handles are stored as absolute
 * points in the shape's local space. A `null` handle
 * means that side is a sharp corner.
 */
export interface BezierAnchor {
  p: Vec2;
  hIn: Vec2 | null;
  hOut: Vec2 | null;
}

/** One contour of a Bézier shape. */
export interface BezierSubpath {
  anchors: BezierAnchor[];
  closed: boolean;
}

/**
 * Cubic Bézier path produced by the pen tool. Boolean operations produce
 * multi-subpath (compound) shapes, where later subpaths can cut holes.
 */
export interface BezierShape extends BaseShape {
  type: "bezier";
  subpaths: BezierSubpath[];
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

/**
 * A compound path paints several retained source shapes as one even-odd path.
 * Components are deliberately not scene nodes: the compound path is a single
 * selectable/layer item and its component geometry is not node-editable.
 */
export interface CompoundPathShape extends BaseShape {
  type: "compoundPath";
  components: PrimitiveShape[];
  fillRule: "evenodd";
}

/** Flatten a polygon shape's polys into a flat list of rings. */
export function polygonRings(shape: PolygonShape): Vec2[][] {
  return shape.polys.flat();
}

/**
 * A placed raster image. The pixels live in a `DocumentAsset` referenced by
 * id; the shape only carries its placement rectangle in local space. Images
 * keep the BaseShape paint fields for uniformity but never use them
 * (fill/stroke stay null).
 */
export interface ImageShape extends BaseShape {
  type: "image";
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * When true, resizing keeps the current width:height ratio — both the panel's
   * numeric fields and interactive handle dragging. Absent means unlocked.
   */
  lockAspect?: boolean;
}

export type TextMode = "point" | "area";
export type TextAlign = "left" | "center" | "right";

/** A single-style text leaf. Width/height are persisted measured bounds. */
export interface TextShape extends BaseShape {
  type: "text";
  text: string;
  textMode: TextMode;
  x: number;
  y: number;
  /** Auto-measured for point text; the fixed wrapping width for area text. */
  width: number;
  /** Auto-measured line-box height. */
  height: number;
  /** Stable display name resolved through the editor's font catalogue. */
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  /** Unitless multiplier of fontSize. */
  lineHeight: number;
  align: TextAlign;
}

/**
 * A reusable symbol definition. Its content is a Group stored in `doc.nodes`
 * but never listed in `rootIds`; the definition root keeps an identity
 * transform, so symbol-local space is the root group's child space.
 */
export interface SymbolDef {
  id: string;
  name: string;
  /** Id of the definition's root Group in `doc.nodes`. */
  rootNodeId: string;
}

/**
 * A placed occurrence of a symbol. Instances are atomic in the scene (like
 * compound paths): selectable and transformable as one unit, with no
 * per-instance overrides beyond the BaseNode fields.
 */
export interface SymbolInstance extends BaseNode {
  type: "instance";
  symbolId: string;
}

/**
 * A group is a real scene node. Its child list is both the hierarchy and the
 * back-to-front paint order; parent information is derived by Scene Index.
 */
export interface Group extends BaseNode {
  type: "group";
  /** Child node ids, back-to-front. This is the canonical hierarchy/order. */
  childIds: string[];
}

export type PrimitiveShape =
  | RectShape
  | EllipseShape
  | LineShape
  | PathShape
  | BezierShape
  | PolygonShape;

export type Shape = PrimitiveShape | CompoundPathShape | ImageShape | TextShape;

export type SceneNode = Shape | Group | SymbolInstance;

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
 * A rectangular export/layout region on the infinite plane. Artboards do not
 * own scene content: which shapes belong to a board is decided geometrically
 * (by clipping) at export time. `background` is a plain colour string drawn as
 * the board's backdrop, or `null` for a transparent board.
 */
export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  background: string | null;
}

/** The world-space bounds of an artboard. */
export function artboardBounds(ab: Artboard): Bounds {
  return { x: ab.x, y: ab.y, width: ab.width, height: ab.height };
}

export function makeArtboard(
  x: number,
  y: number,
  width: number,
  height: number,
  name = "Artboard"
): Artboard {
  return { id: makeId("artboard"), name, x, y, width, height, background: "#ffffff" };
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

/** The whole drawing document. Root/child ids are always back-to-front. */
export interface Document {
  nodes: Record<string, SceneNode>;
  rootIds: string[];
  /** Symbol definitions; their content lives in `nodes` outside `rootIds`. */
  symbols: Record<string, SymbolDef>;
  /** Export/layout regions on the plane, in export order. */
  artboards: Artboard[];
  settings: DocumentSettings;
  metadata: DocumentMetadata;
  assets: Record<string, DocumentAsset>;
  /** Namespaced data reserved for future plugins/importers. */
  extensions: Record<string, unknown>;
}

export function createEmptyDocument(): Document {
  const now = new Date().toISOString();
  return {
    nodes: {},
    rootIds: [],
    symbols: {},
    artboards: [],
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
