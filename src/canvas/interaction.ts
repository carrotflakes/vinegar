import type { Guide, SnapTargets, Spacing } from "@/model/geometry/snap";
import type {
  PathShape,
  Bounds,
  BrushShape,
  Matrix,
  SceneNode,
  Shape,
  Vec2,
} from "../model/types";
import type { GradientPaint } from "@/model/gradient";
import type { PaintTarget } from "@/model/paint";
import type { GradientHandle } from "./gradientHandles";
import type { HandleId } from "./handles";
import type { CachedSelectHover } from "./tools/selectTool";
import type { CornerRadiusControl } from "./cornerRadiusHandle";
import type { GeneratorControl } from "./generatorHandles";

export type FrameHit =
  | { type: "corner-radius"; control: CornerRadiusControl }
  | { type: "generator-param"; control: GeneratorControl }
  | { type: "pivot" }
  | { type: "resize"; id: HandleId }
  | { type: "rotate" }
  | null;

/**
 * The pen's rubber-band target: where the next anchor would land (in the
 * draft's local space) and whether placing it there closes the path — the
 * preview and the click itself must agree on that.
 */
export interface PenHover {
  p: Vec2;
  close: boolean;
}

export type Interaction =
  | { kind: "none" }
  | { kind: "pan"; startScreen: Vec2; startOffset: Vec2 }
  | {
      /** Dragging a whole new gradient axis onto a shape. */
      kind: "gradient-axis";
      shapeId: string;
      target: PaintTarget;
      /** The existing gradient, or the seeded replacement, held until drag. */
      paint: GradientPaint;
      /** Press point, in the gradient's own space. */
      start: Vec2;
      /** Press point in screen space, to tell a drag from a click. */
      startScreen: Vec2;
      /**
       * Whether the drag has passed {@link CLICK_SLOP} and actually rewritten
       * the paint. A press that never does is a click (it may be the first
       * half of a double-click adding a stop) and must leave the gradient
       * alone rather than collapse it to a zero-length axis.
       */
      placed: boolean;
    }
  | {
      /** Dragging one handle of the gradient annotator. */
      kind: "gradient-handle";
      shapeId: string;
      target: PaintTarget;
      handle: GradientHandle;
      /** The paint as it stood when the drag began (midpoints need its gaps). */
      origin: GradientPaint;
    }
  | {
      /** Dragging one colour point of a freeform gradient, or its spread ring. */
      kind: "freeform-point";
      shapeId: string;
      target: PaintTarget;
      pointId: string;
      /** `move` drags the point itself; `spread` sets its weight. */
      mode: "move" | "spread";
      /** Press point in screen space, to tell a drag from a click. */
      startScreen: Vec2;
      /**
       * Alt was held: the point is duplicated once the press passes
       * {@link CLICK_SLOP}, and the copy is what moves — so an Alt-*click*
       * leaves no invisible duplicate stacked on the original.
       */
      duplicate: boolean;
    }
  | {
      kind: "pivot";
      shapeId?: string | undefined;
      groupId?: string | undefined;
      persistent: boolean;
    }
  | {
      /**
       * A press on the selection that has not yet travelled far enough to be a
       * drag. Past {@link CLICK_SLOP} it is promoted to a "move" (see
       * `promotePendingMove`); released before that it resolves as a click, so
       * a shaky hand can no longer nudge artwork by pressing on it.
       */
      kind: "select-pending";
      startScreen: Vec2;
      start: Vec2;
      /** Selection roots a promoted move would carry. */
      selection: string[];
      /**
       * Releasing without a drag narrows the selection to this — clicking one
       * member of a multi-selection singles it out. Null leaves it alone.
       */
      collapseTo: string[] | null;
    }
  | {
      kind: "move";
      start: Vec2;
      originals: Record<string, SceneNode>;
      origUnion: Bounds;
      targets: SnapTargets;
      boxes: Bounds[];
      selectionPivot?: Vec2 | undefined;
      selectionTransform?: Matrix | undefined;
      /** Live: the drop would skip frame reparenting (Cmd/Ctrl held). Drives the
       *  drop-target highlight; the drop reads the modifier authoritatively. */
      noReparent?: boolean;
    }
  | {
      kind: "resize";
      handle: HandleId;
      from: Bounds;
      frameTransform: Matrix;
      originals: Record<string, SceneNode>;
      single: boolean;
      /** Preserve the starting width:height ratio (locked image or Shift). */
      lockAspect: boolean;
      /**
       * When resizing a frame, its direct children captured at drag start.
       * Resizing a frame changes its box only; children are kept fixed in world
       * space by compensating the frame's local-origin shift against these.
       */
      frameChildren?: Record<string, SceneNode> | undefined;
      selectionPivot?: Vec2 | undefined;
      selectionTransform?: Matrix | undefined;
    }
  | {
      kind: "rotate";
      pivot: Vec2;
      startAngle: number;
      /** Frame rotation at drag start; magnetic snapping targets the result. */
      startRotation: number;
      originals: Record<string, SceneNode>;
      selectionPivot?: Vec2 | undefined;
      selectionTransform?: Matrix | undefined;
    }
  | {
      kind: "corner-radius";
      shapeId: string;
      startScreen: Vec2;
      startRadius: number;
      direction: Vec2;
      pixelsPerRadius: number;
      maxRadius: number;
    }
  | {
      /** Dragging one generator argument by its on-canvas knob. */
      kind: "generator-param";
      shapeId: string;
      control: GeneratorControl;
      /** Grab point in the node's local space, and the arg value there. */
      startLocal: Vec2;
      startValue: number;
      /** World -> node local, captured at pointer-down. */
      inverse: Matrix;
    }
  | { kind: "create"; start: Vec2 }
  | { kind: "text-create"; start: Vec2; current: Vec2 }
  | { kind: "pencil" }
  | { kind: "brush" }
  | { kind: "eraser" }
  | {
      kind: "pen-anchor";
      index: number;
      /** The anchor already had an incoming handle (the pen picked up an
       *  existing endpoint), so the drag may only pull its outgoing one. */
      keepIn: boolean;
    }
  | {
      kind: "node-anchor";
      shapeId: string;
      sub: number;
      index: number;
      orig: PathShape | BrushShape;
      /** Anchor selection captured at pointer-down, all within `shapeId`. */
      selected: { sub: number; index: number }[];
    }
  | {
      kind: "node-handle";
      shapeId: string;
      sub: number;
      index: number;
      part: "in" | "out";
      orig: PathShape | BrushShape;
    }
  | {
      /** Dragging a brush anchor's width knob along the centerline normal. */
      kind: "node-width";
      shapeId: string;
      index: number;
      orig: BrushShape;
      /** Anchor indices scaled together, by the grabbed anchor's ratio. */
      selected: number[];
      /** Unit normal in local space, captured at pointer-down. */
      normal: Vec2;
      /** Grab point's overshoot past the true half-width, held for the drag. */
      grabOffset: number;
    }
  | { kind: "marquee"; start: Vec2; additive: boolean }
  | {
      kind: "node-marquee";
      start: Vec2;
      startScreen: Vec2;
      additive: boolean;
      /**
       * Anchor selection at drag start. Union base for Shift-drag, and the
       * state restored if the drag is cancelled (selection updates live).
       */
      original: { shapeId: string; sub: number; index: number }[];
    }
  | { kind: "frame-create"; id: string; start: Vec2; snap: FrameSnap }
  | {
      /** Dragging a document guide, either an existing one or one just pulled
       *  out of a ruler. Dropping it back on or beyond a ruler removes it. */
      kind: "guide-drag";
      id: string;
      axis: "x" | "y";
      /** The guide was created by this drag, so a cancel must remove it. */
      created: boolean;
    };

/** Precomputed snap data for a frame-create drag: alignment lines from other
 * frames + scene shapes, and other frames' AABBs for equal-spacing. */
export interface FrameSnap {
  targets: SnapTargets;
  boxes: Bounds[];
}

/**
 * One input sample for a freehand tool (pencil, brush). A move event carries a
 * whole run of these — its coalesced history — so a fast stroke keeps its
 * density. `t` is the event timestamp in milliseconds on the `performance.now`
 * clock, which lets the smoothing be expressed per unit of *time* rather than
 * per sample: pointers report anywhere from 60 to 240 samples a second, and a
 * per-sample average would smooth a 240 Hz stylus far less than a 60 Hz mouse
 * at the same setting.
 */
export interface StrokeSample {
  world: Vec2;
  pressure: number;
  t: number;
}

/** The sample interval the freehand smoothing strengths are defined against:
 *  one 60 Hz frame. A stroke sampled faster takes proportionally smaller steps
 *  towards the pointer, so the same setting means the same line either way. */
export const SMOOTH_REF_MS = 1000 / 60;

/** Distance below which a created shape is considered an accidental click. */
export const CLICK_SLOP = 3;
export const NODE_GRAB = 8;
/** Hit tolerances grow by this factor for coarse (touch) pointers. */
export const TOUCH_HIT_SCALE = 2.2;
/** Selection/node chrome is drawn this much larger for touch. */
export const TOUCH_DRAW_SCALE = 1.6;

/** Last segment-click insertion, so a double-click doesn't also toggle it. */
export interface LastInsert {
  shapeId: string;
  sub: number;
  index: number;
  time: number;
}

/**
 * Mutable canvas state shared between CanvasView and the tool modules.
 * The ref-shaped fields are owned by CanvasView; tool handlers read and
 * write them directly and call `scheduleDraw` to repaint.
 */
export interface ToolContext {
  interaction: { current: Interaction };
  preview: { current: Shape | null };
  marquee: { current: Bounds | null };
  penDraft: { current: PathShape | null };
  /** When the pen picked up an existing open path, its pre-edit original. */
  penExtend: { current: PathShape | null };
  lastInsert: { current: LastInsert | null };
  /** Where the pen's next anchor would land (see {@link PenHover}). */
  hover: { current: PenHover | null };
  /** Brush/eraser tip preview under a hovering pen (world units), if any. */
  brushHover: { current: { p: Vec2; radius: number } | null };
  /**
   * What the select tool is hovering — the node a click would take, and
   * whether a locked-but-selected leaf is under the pointer. Resolved once per
   * pointer move and read by both the cursor and the hover outline, so the two
   * always agree. Null when nothing is hovered or another tool is active.
   */
  selectHover: { current: CachedSelectHover | null };
  /**
   * World position of the open path's endpoint the active tool would continue
   * if drawing started now, highlighted as an affordance — the pencil needs the
   * path selected, the pen takes any. Null when no endpoint is in reach. This
   * is a *hover* state; the mid-stroke "would close" promise is
   * {@link ToolContext.closeHint}, and the two are kept apart so neither has to
   * reason about the other's lifetime (they render as the same ring: it means
   * "the path connects here" either way).
   */
  endpointHint: { current: Vec2 | null };
  /**
   * World position of the live freehand stroke's own start point while
   * releasing now would close it. Set during the drag, cleared when it ends.
   */
  closeHint: { current: Vec2 | null };
  guides: { current: Guide[] };
  spacings: { current: Spacing[] };
  /** Multiplier that enlarges hit targets when the primary pointer is touch. */
  hitScale: () => number;
  scheduleDraw: () => void;
}
