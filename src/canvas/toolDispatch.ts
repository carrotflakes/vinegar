// Which tool a pointer event belongs to, and what that tool is called with.
//
// Everything here is a pure dispatch over the active tool / live interaction:
// no pointer arbitration, no React. `hooks/usePointerHandlers` decides *whether*
// an event counts (pen vs palm vs gesture) and then hands the survivors here.

import type { EditorState } from "../store/editorStore";
import type { TextShape, Vec2 } from "../model/types";
import { screenToWorld } from "@/model/geometry/viewport";
import type { Interaction, StrokeSample, ToolContext } from "./interaction";
import { pickShape } from "./picking";
import { finishFrame, onFrameDown, onFrameMove } from "./tools/frameTool";
import { finishBrush, onBrushMove, startBrush } from "./tools/brushTool";
import { finishGuideDrag, onGuideMove } from "./tools/guideTool";
import { bucketFillAt } from "./tools/bucketTool";
import { finishEraser, onEraserMove, startEraser } from "./tools/eraserTool";
import {
  onNodeDown,
  onNodeMarqueeMove,
  onNodeMarqueeUp,
  onNodeMove,
  onNodeWidthMove,
} from "./tools/nodeTool";
import { onPenAnchorMove, onPenDown } from "./tools/penTool";
import {
  finishSelectMove,
  finishSelectPending,
  onMarqueeUp,
  onSelectDown,
} from "./tools/selectTool";
import { onSelectMove } from "./tools/selectDrag";
import {
  finishCreate,
  finishPencil,
  onCreateMove,
  onPencilMove,
  startPencil,
  startShape,
} from "./tools/shapeTools";
import { finishTextCreate, moveTextCreate, startTextCreate } from "./tools/textTool";

/** Opening a text shape for editing; owned by `hooks/useTextEditing`. */
type BeginTextEdit = (shape: TextShape, original: TextShape | null) => void;

export interface ToolDownInput {
  screen: Vec2;
  world: Vec2;
  shift: boolean;
  /** Pen pressure for this contact; 1 for mouse and touch. */
  pressure: number;
  beginTextEdit: BeginTextEdit;
}

/** Hand a fresh contact to the active tool, starting whatever it begins. */
export function startToolInteraction(
  ctx: ToolContext,
  state: EditorState,
  { screen, world, shift, pressure, beginTextEdit }: ToolDownInput
): void {
  switch (state.tool) {
    case "select":
      onSelectDown(ctx, state, screen, world, shift);
      return;
    case "node":
      onNodeDown(ctx, state, screen, world, shift);
      return;
    case "pen":
      onPenDown(ctx, state, screen, world, shift);
      return;
    case "pencil":
      startPencil(ctx, state, world, screen);
      return;
    case "brush":
      startBrush(ctx, state, world, pressure);
      return;
    case "eraser":
      startEraser(ctx, world);
      return;
    case "bucket":
      // A plain click commits (or toasts) immediately; no drag interaction.
      bucketFillAt(state, world);
      return;
    case "frame":
      onFrameDown(ctx, state, screen, world);
      return;
    case "text": {
      const hitId = pickShape(ctx, world);
      const hit = hitId ? state.doc.nodes[hitId] : null;
      if (hit?.type === "text") beginTextEdit(hit, hit);
      else startTextCreate(ctx, world);
      return;
    }
    default:
      // rect / ellipse / line
      startShape(ctx, state, world);
  }
}

export interface ToolMoveInput {
  screen: Vec2;
  world: Vec2;
  shift: boolean;
  alt: boolean;
  /** Cmd/Ctrl: a move drag would drop without reparenting into a frame. */
  noReparent: boolean;
  /**
   * The full run of samples this move covers (coalesced events), so fast
   * freehand strokes keep their sample density. Read by the brush and pencil.
   */
  strokeSamples: () => StrokeSample[];
}

/** Advance the live interaction. `inter` is never "none". */
export function dispatchToolMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction,
  { screen, world, shift, alt, noReparent, strokeSamples }: ToolMoveInput
): void {
  switch (inter.kind) {
    case "pan":
      state.setViewport({
        ...state.viewport,
        offset: {
          x: inter.startOffset.x + (screen.x - inter.startScreen.x),
          y: inter.startOffset.y + (screen.y - inter.startScreen.y),
        },
      });
      break;
    case "select-pending":
    case "pivot":
    case "move":
    case "resize":
    case "rotate":
    case "corner-radius":
    case "generator-param":
    case "marquee":
      onSelectMove(ctx, state, inter, screen, world, shift, alt, noReparent);
      break;
    case "create":
      onCreateMove(ctx, state, inter.start, world, shift, alt);
      break;
    case "text-create":
      moveTextCreate(ctx, inter, world);
      break;
    case "pencil":
      onPencilMove(ctx, state, strokeSamples());
      break;
    case "brush":
      onBrushMove(ctx, state, strokeSamples());
      break;
    case "eraser":
      onEraserMove(ctx, state, world);
      break;
    case "pen-anchor":
      onPenAnchorMove(ctx, state, inter, world, shift, alt);
      break;
    case "node-anchor":
    case "node-handle":
      onNodeMove(ctx, state, inter, world, shift, alt);
      break;
    case "node-width":
      onNodeWidthMove(ctx, state, inter, world, alt);
      break;
    case "node-marquee":
      onNodeMarqueeMove(ctx, state, inter, screen);
      break;
    case "frame-create":
      onFrameMove(ctx, state, inter, world, shift, alt);
      break;
    case "guide-drag":
      onGuideMove(ctx, state, inter, world);
      break;
  }
}

export interface ToolUpInput {
  screen: Vec2;
  /** Cmd/Ctrl on release: drop a move in its current parent. */
  noReparent: boolean;
  canvasSize: { width: number; height: number; dpr: number };
  beginTextEdit: BeginTextEdit;
}

/**
 * Commit the interaction the released contact was driving. The caller has
 * already cleared `ctx.interaction`, so `inter` is the drag as it stood.
 */
export function finishToolInteraction(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction,
  { screen, noReparent, canvasSize, beginTextEdit }: ToolUpInput
): void {
  switch (inter.kind) {
    case "select-pending":
      // Released without ever becoming a drag: it was a click.
      finishSelectPending(ctx, state, inter);
      break;
    case "pivot":
      if (inter.persistent) state.endInteraction();
      ctx.scheduleDraw();
      break;
    case "move":
      // A move drop may reparent the moved roots into/out of a frame; holding
      // Cmd/Ctrl on release suppresses that (drop stays in the current parent).
      finishSelectMove(ctx, state, inter, !noReparent);
      break;
    case "resize":
    case "rotate":
    case "corner-radius":
    case "generator-param":
    case "node-anchor":
    case "node-handle":
    case "node-width":
      state.endInteraction();
      ctx.scheduleDraw();
      break;
    case "create":
      finishCreate(ctx, state);
      break;
    case "text-create":
      beginTextEdit(finishTextCreate(state, inter), null);
      break;
    case "pencil":
      finishPencil(ctx, state, screenToWorld(state.viewport, screen));
      break;
    case "brush":
      finishBrush(ctx, state, screenToWorld(state.viewport, screen));
      break;
    case "eraser":
      finishEraser(ctx, state);
      break;
    case "pen-anchor":
      // Keep the draft alive for the next click; the curve preview persists.
      break;
    case "marquee":
      onMarqueeUp(ctx, state, inter, screenToWorld(state.viewport, screen));
      break;
    case "node-marquee":
      onNodeMarqueeUp(
        ctx,
        state,
        inter,
        screen,
        screenToWorld(state.viewport, screen)
      );
      break;
    case "frame-create":
      finishFrame(ctx, state, inter);
      break;
    case "guide-drag":
      finishGuideDrag(ctx, state, inter, screen, canvasSize);
      break;
  }
}
