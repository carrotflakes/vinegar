import type { Guide, SnapTargets, Spacing } from "../model/snap";
import type {
  BezierShape,
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
      shapeId?: string;
      groupId?: string;
      persistent: boolean;
    }
  | {
      kind: "move";
      start: Vec2;
      originals: Record<string, SceneNode>;
      origUnion: Bounds;
      targets: SnapTargets;
      boxes: Bounds[];
      selectionPivot?: Vec2;
      selectionTransform?: Matrix;
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
      selectionPivot?: Vec2;
      selectionTransform?: Matrix;
    }
  | {
      kind: "rotate";
      pivot: Vec2;
      startAngle: number;
      /** Frame rotation at drag start; magnetic snapping targets the result. */
      startRotation: number;
      originals: Record<string, SceneNode>;
      selectionPivot?: Vec2;
      selectionTransform?: Matrix;
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
      orig: BezierShape | BrushShape;
      /** Anchor selection captured at pointer-down, all within `shapeId`. */
      selected: { sub: number; index: number }[];
    }
  | {
      kind: "node-handle";
      shapeId: string;
      sub: number;
      index: number;
      part: "in" | "out";
      orig: BezierShape | BrushShape;
    }
  | { kind: "marquee"; start: Vec2; additive: boolean }
  | { kind: "artboard-create"; id: string; start: Vec2 }
  | { kind: "artboard-move"; id: string; grab: Vec2; orig: Bounds }
  | { kind: "artboard-resize"; id: string; handle: HandleId; orig: Bounds };

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
  penDraft: { current: BezierShape | null };
  /** When the pen picked up an existing open path, its pre-edit original. */
  penExtend: { current: BezierShape | null };
  lastInsert: { current: LastInsert | null };
  hover: { current: Vec2 | null };
  guides: { current: Guide[] };
  spacings: { current: Spacing[] };
  /** Multiplier that enlarges hit targets when the primary pointer is touch. */
  hitScale: () => number;
  scheduleDraw: () => void;
}
