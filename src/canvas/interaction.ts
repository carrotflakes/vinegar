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
import type { HandleId } from "./handles";
import type { CornerRadiusControl } from "./cornerRadiusHandle";

export type FrameHit =
  | { type: "corner-radius"; control: CornerRadiusControl }
  | { type: "pivot" }
  | { type: "resize"; id: HandleId }
  | { type: "rotate" }
  | null;

export type Interaction =
  | { kind: "none" }
  | { kind: "pan"; startScreen: Vec2; startOffset: Vec2 }
  | {
      kind: "pivot";
      shapeId?: string | undefined;
      groupId?: string | undefined;
      persistent: boolean;
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
  | { kind: "create"; start: Vec2 }
  | { kind: "text-create"; start: Vec2; current: Vec2 }
  | { kind: "pencil" }
  | { kind: "brush"; pointerId: number }
  | { kind: "eraser"; pointerId: number }
  | { kind: "pen-anchor"; index: number }
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
       *  out of a ruler. Dropping it back on a ruler removes it. */
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
  hover: { current: Vec2 | null };
  guides: { current: Guide[] };
  spacings: { current: Spacing[] };
  /** Multiplier that enlarges hit targets when the primary pointer is touch. */
  hitScale: () => number;
  scheduleDraw: () => void;
}
