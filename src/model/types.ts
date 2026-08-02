// ===========================================================================
// Document model — shape geometry is local and each node carries an affine
// transform into its parent coordinate space.
// ===========================================================================

import type { Paint, SolidPaint } from "./paint";

export type Vec2 = { x: number; y: number };

export const STROKE_CAPS = ["butt", "round", "square"] as const;
export type StrokeCap = (typeof STROKE_CAPS)[number];

export const STROKE_JOINS = ["miter", "round", "bevel"] as const;
export type StrokeJoin = (typeof STROKE_JOINS)[number];

export const STROKE_ALIGNMENTS = ["inside", "center", "outside"] as const;
export type StrokeAlignment = (typeof STROKE_ALIGNMENTS)[number];

/** Canvas/SVG-compatible 2D affine matrix [a, b, c, d, e, f]. */
export type Matrix = [number, number, number, number, number, number];

export type ShapeType =
  | "rect"
  | "ellipse"
  | "line"
  | "path"
  | "compoundPath"
  | "image"
  | "text"
  | "brush";

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

/**
 * A non-destructive appearance effect (Illustrator's Effect menu). Effects are
 * an ordered stack rendered after the node's content but before its opacity/
 * blend composite. Their lengths are in the node's local space, like geometry
 * and stroke width, so they scale with the node's transform chain.
 */
export interface DropShadowEffect {
  type: "drop-shadow";
  /** Shadow colour (`#rrggbb`). */
  color: string;
  /** 0..1 shadow opacity. */
  alpha: number;
  /** Gaussian blur amount in local units. */
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface BlurEffect {
  type: "blur";
  /** Gaussian standard deviation in local units. */
  radius: number;
}

/**
 * Unitless colour adjustment (maps 1:1 to CSS `filter` functions for preview and
 * to chained `feColorMatrix` primitives for SVG export). Multipliers are 1 = no
 * change; `hue` is a rotation in degrees. Being unitless, it does not scale with
 * the node's transform and adds nothing to the effect margin.
 */
export interface ColorAdjustEffect {
  type: "color-adjust";
  /** RGB multiplier, ≥ 0 (1 = unchanged). */
  brightness: number;
  /** Contrast multiplier around mid-grey, ≥ 0 (1 = unchanged). */
  contrast: number;
  /** Saturation multiplier, ≥ 0 (0 = greyscale, 1 = unchanged). */
  saturation: number;
  /** Hue rotation in degrees. */
  hue: number;
}

/**
 * Solid-colour tint, masked by the node's own alpha and mixed over its content
 * by `alpha` (0 = untouched, 1 = fully recoloured within the silhouette). Maps
 * to a canvas `source-atop` fill for preview and a single `feColorMatrix` for
 * SVG export; being unitless it adds nothing to the effect margin.
 */
export interface ColorOverlayEffect {
  type: "color-overlay";
  /** Overlay colour (`#rrggbb`). */
  color: string;
  /** 0..1 mix amount. */
  alpha: number;
}

export type Effect =
  | DropShadowEffect
  | BlurEffect
  | ColorAdjustEffect
  | ColorOverlayEffect;

export const EFFECT_TYPES = [
  "drop-shadow",
  "blur",
  "color-adjust",
  "color-overlay",
] as const;

/**
 * Fields shared by every persisted scene node.
 *
 * No field here is optional. A defaulted field carries its default explicitly
 * (`blendMode: "normal"`, `effects: []`) and a genuinely absent one is `null`,
 * so each field has exactly one representation per state — `undefined` never
 * means anything. Optional fields used to buy additive file migrations for
 * free; the migration chain is gone, so they only bought tri-state bugs.
 */
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
  blendMode: BlendMode;
  /** Ordered appearance-effect stack; empty means no effects. */
  effects: Effect[];
  hidden: boolean;
  locked: boolean;
  /**
   * Links this node's geometry to a parametric generator. When set, the
   * geometry is (re)produced from `args` and the node can be re-tuned via the
   * generator's parameters. Editing vertices directly detaches the link (the
   * field goes back to null), leaving a plain hand-editable node.
   */
  generator: GeneratorRef | null;
  /**
   * Numeric fields driven by a document parameter, keyed by bindable field
   * path (`"strokeWidth"`, `"generator.args.radius"`, `"modifiers.1.distance"`).
   * The field itself keeps the last resolved number, so every consumer reads a
   * plain value and a dangling reference degrades to the literal it was
   * showing. Empty means the node binds nothing. See docs/parameters.md.
   */
  bindings: Record<string, ParamRef>;
}

/**
 * The neutral value of every shared node field that has one. Spread this into
 * a node literal, then override what the node actually needs — it keeps new
 * BaseNode fields from having to be added at dozens of construction sites.
 */
export function baseNodeDefaults(): Pick<
  BaseNode,
  "transformOrigin" | "opacity" | "blendMode" | "effects" | "hidden" | "locked" | "generator" | "bindings"
> {
  return {
    transformOrigin: null,
    opacity: 1,
    blendMode: "normal",
    effects: [],
    hidden: false,
    locked: false,
    generator: null,
    bindings: {},
  };
}

/**
 * A named global colour ("document colour") stored on the document. Nodes
 * reference it by id through a `swatch` Paint variant; editing the swatch once
 * re-tints every referencing fill/stroke live. See docs/global-colors.md.
 */
export interface Swatch {
  id: string;
  name: string;
  /** Concrete paint. v1: SolidPaint. Never a swatch reference (no chains). */
  paint: SolidPaint;
}

/**
 * A named number stored on the document, the numeric counterpart of a
 * {@link Swatch}. Node fields reference it through {@link BaseNode.bindings},
 * so editing the parameter once retunes every bound field. See
 * docs/parameters.md.
 */
export interface DocParam {
  id: string;
  name: string;
  value: number;
  /** UI hints for the scrubber; not enforced on bound values. */
  min: number | null;
  max: number | null;
  step: number | null;
  /** Round the value to a whole number when resolving bound fields. */
  integer: boolean;
}

/**
 * One bound numeric field's link to a document parameter. `scale` is a per-use
 * multiplier (1 = the parameter as stored), precedented by a swatch
 * reference's per-use `alpha`: it covers "half the margin" / "double the
 * stroke" without an expression language.
 */
export interface ParamRef {
  paramId: string;
  scale: number;
}

/** A node's link to the generator that produced its geometry. */
export interface GeneratorRef {
  /** Id of a built-in generator or a document script (`doc.scripts`). */
  scriptId: string;
  /** Parameter values fed to the generator to build the geometry. */
  args: Record<string, number>;
}

/**
 * A user-authored parametric generator stored in the document. `source` is the
 * generator's code; compiling it yields the parameter schema and a geometry
 * builder (see model/generators.ts). Nodes reference it by `id` through their
 * `generator` link, so the drawing stays self-contained and portable.
 */
export interface ScriptDef {
  id: string;
  name: string;
  source: string;
}

/** Common paint fields shared by every shape. */
export interface BaseShape extends BaseNode {
  /** `null` fill means "no fill" (transparent). */
  fill: Paint | null;
  /** `null` stroke means "no stroke". */
  stroke: Paint | null;
  strokeWidth: number;
  /** Alternating dash/gap lengths in local units; empty means solid. */
  strokeDash: number[];
  /** Offset into the repeated dash pattern, in local units. */
  strokeDashOffset: number;
  strokeCap: StrokeCap;
  strokeJoin: StrokeJoin;
  /** Open paths render centered even if a non-center value is stored. */
  strokeAlignment: StrokeAlignment;
}

/** The neutral paint/stroke fields of a shape, to spread like baseNodeDefaults. */
export function baseShapeDefaults(): Pick<
  BaseShape,
  "fill" | "stroke" | "strokeWidth" | "strokeDash" | "strokeDashOffset" | "strokeCap" | "strokeJoin" | "strokeAlignment"
> {
  return {
    fill: null,
    stroke: null,
    strokeWidth: 0,
    strokeDash: [],
    strokeDashOffset: 0,
    strokeCap: "round",
    strokeJoin: "round",
    strokeAlignment: "center",
  };
}

/** Axis-aligned rectangle, defined by its top-left corner and size. */
export interface RectShape extends BaseShape {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Shared circular radius for all four corners; `0` means square corners. */
  cornerRadius: number;
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

/**
 * A single anchor of a path. Control handles are stored as absolute
 * points in the shape's local space. A `null` handle
 * means that side is a sharp corner.
 */
export type AnchorType = "cusp" | "smooth" | "symmetric";

export interface PathAnchor {
  p: Vec2;
  hIn: Vec2 | null;
  hOut: Vec2 | null;
  /** Handle-linkage rule. Absent means it is derived from the handles. */
  t?: AnchorType;
}

/** One contour of a path shape. */
export interface PathSubpath {
  anchors: PathAnchor[];
  closed: boolean;
}

interface PathModifierBase {
  /** `false` bypasses this stage without removing it from the stack. */
  enabled?: boolean;
}

export type PathModifier = PathModifierBase & (
  | { type: "simplify"; tolerance: number }
  | { type: "flatten"; tolerance: number }
  | { type: "offset"; distance: number; join: StrokeJoin }
  | { type: "outline"; width: number; cap: StrokeCap; join: StrokeJoin }
  | { type: "smooth" }
  | { type: "reverse" }
);

export const PATH_MODIFIER_TYPES = [
  "simplify",
  "flatten",
  "offset",
  "outline",
  "smooth",
  "reverse",
] as const;

/**
 * A multi-subpath outline. Null handles make straight segments; non-null
 * handles make cubic Bézier segments. All subpaths share one winding rule.
 */
export interface PathShape extends BaseShape {
  type: "path";
  subpaths: PathSubpath[];
  /** Ordered non-destructive geometry stages; absent is an empty stack. */
  modifiers?: PathModifier[];
  /** Winding rule for fill, hit-testing, and clipping. */
  fillRule: "nonzero" | "evenodd";
}

/**
 * A compound path owns real areal leaf nodes but paints their outlines once,
 * using the container's appearance and the even-odd fill rule.
 */
export interface CompoundPathNode extends BaseShape {
  type: "compoundPath";
  /** Child node ids, back-to-front. Must contain areal leaf shapes only. */
  childIds: string[];
}

/** @deprecated Use CompoundPathNode. Kept as a source-compatible type alias. */
export type CompoundPathShape = CompoundPathNode;

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
   * numeric fields and interactive handle dragging.
   */
  lockAspect: boolean;
}

/**
 * One anchor of a brush centerline: a cubic Bézier anchor (absolute handles in
 * local space, `null` = sharp corner, matching {@link PathAnchor}) carrying a
 * width multiplier.
 */
export interface BrushAnchor {
  p: Vec2;
  hIn: Vec2 | null;
  hOut: Vec2 | null;
  /** Handle-linkage rule. Absent means it is derived from the handles. */
  t?: AnchorType;
  /** Width multiplier at this anchor, `>= 0`; `1` = the full `strokeWidth`. */
  w: number;
}

/**
 * A pressure-profiled freehand stroke. The centerline is an open cubic Bézier
 * (`anchors`); the rendered shape is the variable-width envelope of that line,
 * filled with the `stroke` paint using the nonzero winding rule. `strokeWidth`
 * is the base width that every anchor's `w` scales. Fill and the stroke detail
 * fields (dash/cap/join/alignment) are unused in v1 — ends are round caps.
 */
export interface BrushShape extends BaseShape {
  type: "brush";
  anchors: BrushAnchor[];
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
  /**
   * When true the frontmost child is a mask that clips all preceding children.
   * Named apart from the frame's flag on purpose: the two used to share the
   * name `clip` with *opposite* defaults, which read as the same thing.
   */
  clipsToMask: boolean;
}

/**
 * A frame (formerly "artboard"): an export/layout container node. Structurally
 * a Group with a fixed content box `[0,0,width,height]` in local space (an
 * SVG-viewport), a background, and children authored in frame-local
 * coordinates. Moving the frame moves its children through the transform chain
 * for free; resizing changes the box, never the children's scale.
 *
 * Invariant: a frame lives only at the top-level scene scope. Its id appears
 * only in `Document.rootIds`; it is never a descendant of a group, symbol, or
 * another frame (so frames never nest). Enforced by the serializer and by every
 * reparent/group operation. See docs/document-model.md.
 */
export interface FrameNode extends BaseNode {
  type: "frame";
  /** Child node ids, back-to-front. May be empty. */
  childIds: string[];
  /** Content box size in the frame's local space (origin at 0,0). */
  width: number;
  height: number;
  /** Fill drawn behind children; `null` = transparent. */
  background: string | null;
  /** Clip children to the content box (a frame is a viewport by default). */
  clipsContent: boolean;
}

export function makeFrame(
  x: number,
  y: number,
  width: number,
  height: number,
  name = "Frame"
): FrameNode {
  return {
    id: makeId("frame"),
    name,
    type: "frame",
    transform: [1, 0, 0, 1, x, y],
    ...baseNodeDefaults(),
    childIds: [],
    width,
    height,
    background: "#ffffff",
    clipsContent: true,
  };
}

export type PrimitiveShape =
  | RectShape
  | EllipseShape
  | LineShape
  | PathShape;

export type Shape =
  | PrimitiveShape
  | CompoundPathNode
  | ImageShape
  | TextShape
  | BrushShape;

export type SceneNode = Shape | Group | SymbolInstance | FrameNode;

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

/**
 * A persistent user guide: an infinite axis-aligned line in world space.
 * `axis: "x"` is a *vertical* line at world x = `position` (matching the axis
 * naming of the transient alignment guides in geometry/snap.ts).
 */
export interface GuideLine {
  id: string;
  axis: "x" | "y";
  position: number;
}

/** Metadata for forward-compatible document management. */
export interface DocumentMetadata {
  /**
   * Display name, and the stem every save/export filename is derived from.
   * Independent of the file on disk: opening `sketch.vinegar.json` shows
   * whatever name the document was saved with, like Illustrator's title.
   */
  name: string;
  createdAt: string;
  modifiedAt: string;
}

/** Name given to a document that has never been named or saved. */
export const UNTITLED_DOCUMENT_NAME = "Untitled";

/**
 * Binary resources are referenced by id instead of being embedded in shapes.
 * `source` is intentionally a discriminated union so packaged/external asset
 * locations can be added without changing every image-like node.
 */
export interface DocumentAsset {
  id: string;
  kind: "image";
  mimeType: string;
  /** Original file name, or null when the asset arrived without one. */
  name: string | null;
  source: { type: "data"; data: string };
}

/** The whole drawing document. Root/child ids are always back-to-front. */
export interface Document {
  nodes: Record<string, SceneNode>;
  rootIds: string[];
  /** Symbol definitions; their content lives in `nodes` outside `rootIds`. */
  symbols: Record<string, SymbolDef>;
  /** Named global colours referenced by node `swatch` fills/strokes. */
  swatches: Record<string, Swatch>;
  /** Panel display order. Every id here exists in `swatches` and vice versa. */
  swatchOrder: string[];
  /** Named global numbers referenced by node `bindings`. */
  params: Record<string, DocParam>;
  /** Panel display order. Every id here exists in `params` and vice versa. */
  paramOrder: string[];
  /** User-authored parametric generators referenced by node `generator` links. */
  scripts: Record<string, ScriptDef>;
  /** Persistent ruler guides (world space); see docs/rulers-and-guides.md. */
  guides: GuideLine[];
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
    swatches: {},
    swatchOrder: [],
    params: {},
    paramOrder: [],
    scripts: {},
    guides: [],
    settings: { unit: "px", dpi: 96, gridSize: 50 },
    metadata: { name: UNTITLED_DOCUMENT_NAME, createdAt: now, modifiedAt: now },
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
