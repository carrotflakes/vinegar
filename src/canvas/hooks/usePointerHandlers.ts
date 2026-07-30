import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { handleFromDataTransferItem } from "../../io/fileSystem";
import { isDocumentFile, openDocumentFile } from "../../io/openDocument";
import { drillScopeRoot, expandToGroups } from "../../model/groups";
import { isGroup } from "../../model/scene";
import type { Vec2 } from "../../model/types";
import { screenToWorld } from "@/model/geometry/viewport";
import { currentFocusRoot, useEditor } from "../../store/editorStore";
import { readModifiers } from "../../store/inputStore";
import { setPointer, setReadout } from "../../store/pointerStore";
import { resolveCursor } from "../cursor";
import { type ToolContext } from "../interaction";
import { cancelActiveInteraction } from "../interactionLifecycle";
import { pickShape } from "../picking";
import {
  finishFrame,
  onFrameDown,
  onFrameMove,
} from "../tools/frameTool";
import { finishBrush, onBrushMove, startBrush } from "../tools/brushTool";
import {
  finishGuideDrag,
  onGuideDown,
  onGuideMove,
} from "../tools/guideTool";
import { bucketFillAt } from "../tools/bucketTool";
import { finishEraser, onEraserMove, startEraser } from "../tools/eraserTool";
import {
  onNodeDoubleClick,
  onNodeDown,
  onNodeMarqueeMove,
  onNodeMarqueeUp,
  onNodeMove,
  onNodeWidthMove,
} from "../tools/nodeTool";
import {
  commitPenDraft,
  onPenAnchorMove,
  onPenDown,
  onPenHoverMove,
} from "../tools/penTool";
import {
  finishSelectMove,
  onMarqueeUp,
  onSelectDoubleClick,
  onSelectDown,
  onSelectMove,
} from "../tools/selectTool";
import {
  finishCreate,
  finishPencil,
  onCreateMove,
  onPencilMove,
  startPencil,
  startShape,
} from "../tools/shapeTools";
import {
  finishTextCreate,
  moveTextCreate,
  startTextCreate,
} from "../tools/textTool";
import { useCanvasContextMenu } from "./useCanvasContextMenu";
import type { CanvasGestures } from "./useCanvasGestures";
import { useTouchTapGesture } from "./useTouchTapGesture";
import type { TextEditing } from "./useTextEditing";
import { useBrush } from "../../store/brushStore";
import { usePreferences } from "../../store/preferencesStore";
import { notify } from "../../store/toastStore";
import { useRef } from "react";
import { routeContact, type ContactRoute } from "../inputRouting";

interface PointerHandlerDeps {
  ctx: ToolContext;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  spaceRef: RefObject<boolean>;
  sizeRef: RefObject<{ width: number; height: number; dpr: number }>;
  gestures: CanvasGestures;
  text: Pick<TextEditing, "textEditRef" | "beginTextEdit" | "commitTextEdit">;
}

export interface PointerHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onDoubleClick: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  onDrop: (e: ReactDragEvent<HTMLCanvasElement>) => void;
}

/** All canvas pointer/mouse event handlers, dispatching to the active tool. */
export function usePointerHandlers(deps: PointerHandlerDeps): PointerHandlers {
  const { ctx, canvasRef, spaceRef, sizeRef, gestures, text } = deps;
  const { pointersRef, gestureRef, beginGesture, updateGesture, captureGestureBaseline } =
    gestures;
  const { textEditRef, beginTextEdit, commitTextEdit } = text;
  const contextMenu = useCanvasContextMenu({ ctx, canvasRef, sizeRef });
  const tap = useTouchTapGesture();

  /** A pen is on the glass right now. */
  const penDownRef = useRef(false);
  /** When the pen last reported anything, for the post-stroke cooldown. */
  const penSeenAtRef = useRef(0);
  /** Touch contacts rejected at pointerdown; their later events are dead. */
  const rejectedTouchRef = useRef<Set<number>>(new Set());
  /**
   * The pointer that started the interaction in progress. Every interaction is
   * owned by exactly one contact: on a tablet, a palm, a second finger or a
   * hovering pen all deliver events into a live drag, and none of them may
   * steer or end it. Interactions only ever begin in `onPointerDown`, so this
   * is the single place ownership needs to be recorded.
   */
  const ownerRef = useRef<{ pointerId: number; pointerType: string } | null>(
    null
  );

  /** Whether `pointerId` may drive the interaction currently in progress. */
  const ownsInteraction = (pointerId: number) =>
    ownerRef.current === null || ownerRef.current.pointerId === pointerId;

  /** Ask `inputRouting` what a contact landing right now means. */
  const routeDown = (e: ReactPointerEvent<HTMLCanvasElement>): ContactRoute => {
    const state = useEditor.getState();
    return routeContact({
      pointerType: e.pointerType,
      penDown: penDownRef.current,
      sincePen: penSeenAtRef.current
        ? performance.now() - penSeenAtRef.current
        : Infinity,
      liveTouches: pointersRef.current.size,
      tool: state.tool,
      fingerDrawing: usePreferences.getState().canvas.fingerDrawing,
    });
  };

  const screenPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const updateHoverCursor = (screen: Vec2, world: Vec2) => {
    const canvas = canvasRef.current!;
    const state = useEditor.getState();
    canvas.style.cursor = resolveCursor(
      ctx,
      state,
      screen,
      world,
      spaceRef.current,
      sizeRef.current
    );
  };

  /**
   * Show the brush/eraser tip outline while a pen hovers over the canvas, and
   * take it away for every other pointer. Only pens hover, so this is the one
   * affordance touch cannot have — and the one that makes a stylus feel aimed.
   */
  const updateBrushHover = (isPen: boolean, tool: string, world: Vec2) => {
    const wanted = isPen && (tool === "brush" || tool === "eraser");
    if (!wanted) {
      if (!ctx.brushHover.current) return;
      ctx.brushHover.current = null;
      ctx.scheduleDraw();
      return;
    }
    const brush = useBrush.getState();
    ctx.brushHover.current = {
      p: world,
      radius: (tool === "brush" ? brush.size : brush.eraserSize) / 2,
    };
    ctx.scheduleDraw();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // Right button is reserved for the context menu (see onContextMenu).
    if (e.button === 2) return;
    const isPen = e.pointerType === "pen";
    const isTouch = e.pointerType === "touch";
    // Read the verdict before the pen bookkeeping below changes the inputs.
    const route = routeDown(e);

    if (isPen) {
      penDownRef.current = true;
      penSeenAtRef.current = performance.now();
      // The first pen contact hands the canvas to the stylus for good.
      if (usePreferences.getState().notePenInput()) {
        notify.info(
          "Pen detected — your finger now pans instead of drawing. " +
            "Two-finger tap to undo; change it under Finger in the modifier bar."
        );
      }
      // The pen outranks anything a hand resting on the glass had started:
      // drop a live pinch and any touch-driven drag rather than fight them.
      contextMenu.cancelTouch();
      tap.reset();
      if (gestureRef.current) {
        gestureRef.current = null;
        pointersRef.current.clear();
      } else if (
        ctx.interaction.current.kind !== "none" &&
        ownerRef.current?.pointerType === "touch"
      ) {
        cancelActiveInteraction(ctx);
        ownerRef.current = null;
      }
    }

    if (route === "reject-palm" || route === "reject-cooldown") {
      rejectedTouchRef.current.add(e.pointerId);
      // A palm rules out any tap that was brewing. A contact merely held back
      // by the cooldown still joins one, so "draw a stroke, immediately
      // two-finger undo" is not swallowed by palm rejection.
      if (route === "reject-palm") tap.reset();
      else tap.down(e.pointerId, screenPoint(e));
      return;
    }
    const activeTextId = textEditRef.current?.shape.id;
    if (activeTextId) commitTextEdit(activeTextId);
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const screen = screenPoint(e);
    ownerRef.current = { pointerId: e.pointerId, pointerType: e.pointerType };
    // The tip outline is a hover affordance; the stroke itself replaces it.
    ctx.brushHover.current = null;

    // Pinch/pan gestures are touch-only. Tracking pen/mouse pointers here would
    // let a lingering pen contact — e.g. two rapid Apple Pencil strokes whose
    // up/down interleave — be miscounted as a second finger and hijack the
    // fresh stroke into a two-finger gesture.
    if (isTouch) {
      pointersRef.current.set(e.pointerId, screen);
      tap.down(e.pointerId, screen);
      if (route === "gesture") {
        contextMenu.cancelTouch();
        beginGesture();
        return;
      }
      // Remember the selection so a follow-up pinch can restore it instead of
      // leaving whatever this first touch selects.
      captureGestureBaseline();
    }

    const state = useEditor.getState();
    if (isTouch && (state.tool === "select" || state.tool === "node")) {
      contextMenu.startTouch(e.pointerId, e.clientX, e.clientY);
    }
    const world = screenToWorld(state.viewport, screen);
    const mod = readModifiers(e);

    if (e.button === 1 || spaceRef.current) {
      ctx.interaction.current = {
        kind: "pan",
        startScreen: screen,
        startOffset: { ...state.viewport.offset },
      };
      return;
    }
    if (e.button !== 0) return;

    // Rulers and guides sit above every tool: a press in a ruler band pulls out
    // a guide, and an unlocked guide under the cursor is picked up.
    if (onGuideDown(ctx, state, screen, world, sizeRef.current)) return;
    if (state.selectedGuideId) state.setSelectedGuide(null);

    const tool = state.tool;

    // With finger drawing off, a lone finger pans instead of painting: the
    // canvas belongs to the pen, the finger stays a navigation device. Guides
    // are checked first, so a finger can still pull one out of a ruler.
    if (route === "pan") {
      ctx.interaction.current = {
        kind: "pan",
        startScreen: screen,
        startOffset: { ...state.viewport.offset },
      };
      return;
    }

    if (tool === "select") {
      onSelectDown(ctx, state, screen, world, mod.shift);
      return;
    }
    if (tool === "node") {
      onNodeDown(ctx, state, screen, world, mod.shift);
      return;
    }
    if (tool === "pen") {
      onPenDown(ctx, state, screen, world, mod.shift);
      return;
    }
    if (tool === "pencil") {
      startPencil(ctx, state, world);
      return;
    }
    if (tool === "brush") {
      startBrush(ctx, state, world, isPen ? e.pressure : 1);
      return;
    }
    if (tool === "eraser") {
      startEraser(ctx, world);
      return;
    }
    if (tool === "bucket") {
      // A plain click commits (or toasts) immediately; no drag interaction.
      bucketFillAt(state, world);
      return;
    }
    if (tool === "frame") {
      onFrameDown(ctx, state, screen, world);
      return;
    }
    if (tool === "text") {
      const hitId = pickShape(ctx, world);
      const hit = hitId ? state.doc.nodes[hitId] : null;
      if (hit?.type === "text") {
        beginTextEdit(hit, hit);
        return;
      }
      startTextCreate(ctx, world);
      return;
    }

    // rect / ellipse / line
    startShape(ctx, state, world);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const isPen = e.pointerType === "pen";
    // Only contact keeps the cooldown alive. A pen *hovering* also reports
    // moves, and treating those as pen activity would suppress touch for as
    // long as the stylus is held near the glass.
    if (isPen && e.buttons !== 0) penSeenAtRef.current = performance.now();
    const screen = screenPoint(e);
    // A rejected palm keeps emitting moves; none of them may reach a tool, but
    // travelling still disqualifies the tap it might have been part of.
    if (rejectedTouchRef.current.has(e.pointerId)) {
      tap.move(e.pointerId, screen);
      return;
    }

    contextMenu.moveTouch(e.pointerId, e.clientX, e.clientY);
    if (e.pointerType === "touch") tap.move(e.pointerId, screen);
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, screen);
    }
    if (gestureRef.current) {
      updateGesture();
      return;
    }

    const inter = ctx.interaction.current;
    // Only the owner drives a live drag; a palm or second finger delivering
    // events through implicit pointer capture is dropped here. With nothing in
    // progress every pointer is free to update the hover chrome below.
    if (inter.kind !== "none" && !ownsInteraction(e.pointerId)) return;
    const state = useEditor.getState();
    const world = screenToWorld(state.viewport, screen);
    const mod = readModifiers(e);
    setPointer(world);

    if (inter.kind === "none") {
      if (state.tool === "pen" && ctx.penDraft.current) {
        onPenHoverMove(ctx, state, world, mod.shift);
      }
      updateBrushHover(isPen, state.tool, world);
      updateHoverCursor(screen, world);
      return;
    }

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
      case "pivot":
      case "move":
      case "resize":
      case "rotate":
      case "corner-radius":
      case "marquee":
        onSelectMove(ctx, state, inter, screen, world, mod.shift, e.metaKey || e.ctrlKey);
        break;
      case "create":
        onCreateMove(ctx, state, inter.start, world, mod.shift, mod.alt);
        break;
      case "text-create":
        moveTextCreate(ctx, inter, world);
        break;
      case "pencil":
        onPencilMove(ctx, world);
        break;
      case "brush": {
        // Drain coalesced moves so fast strokes keep their full sample density.
        const native = e.nativeEvent;
        const isPen = e.pointerType === "pen";
        const coalesced =
          typeof native.getCoalescedEvents === "function"
            ? native.getCoalescedEvents()
            : [];
        const events = coalesced.length ? coalesced : [native];
        onBrushMove(
          ctx,
          state,
          events.map((ev) => ({
            world: screenToWorld(state.viewport, screenPoint(ev)),
            pressure: isPen ? ev.pressure : 1,
          }))
        );
        break;
      }
      case "eraser":
        onEraserMove(ctx, state, world);
        break;
      case "pen-anchor":
        onPenAnchorMove(ctx, state, inter.index, world, mod.shift);
        break;
      case "node-anchor":
      case "node-handle":
        onNodeMove(ctx, state, inter, world, mod.shift, mod.alt);
        break;
      case "node-width":
        onNodeWidthMove(ctx, state, inter, world, mod.alt);
        break;
      case "node-marquee":
        onNodeMarqueeMove(ctx, state, inter, screen);
        break;
      case "frame-create":
        onFrameMove(ctx, state, inter, world, mod.shift, mod.alt);
        break;
      case "guide-drag":
        onGuideMove(ctx, state, inter, world);
        break;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "pen") {
      penDownRef.current = false;
      penSeenAtRef.current = performance.now();
    }
    // Two- and three-finger taps mean undo/redo. A contact held back by the
    // pen cooldown is still part of its run, so this is judged before the
    // rejected contacts drop out.
    const tapped = e.pointerType === "touch" && tap.up(e.pointerId);
    if (rejectedTouchRef.current.delete(e.pointerId) && !tapped) return;

    contextMenu.endTouch(e.pointerId);
    const canvas = canvasRef.current!;
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);

    // A fired tap consumes the release, so no tool sees the lift as the end of
    // a drag.
    if (tapped) {
      gestureRef.current = null;
      // Usually nothing is in flight (the second finger cancelled it), but a
      // stroke the palm filter let slip past must be discarded, not committed.
      cancelActiveInteraction(ctx);
      return;
    }

    // Winding down a gesture: end it once fewer than two pointers remain. A
    // lone leftover finger stays inert until lifted (no tool restart).
    if (gestureRef.current) {
      if (pointersRef.current.size < 2) gestureRef.current = null;
      return;
    }

    const inter = ctx.interaction.current;
    // Only the owner can end what it started: a palm lifting must not commit
    // (or cancel) someone else's drag.
    if (inter.kind !== "none" && !ownsInteraction(e.pointerId)) return;
    ownerRef.current = null;
    ctx.interaction.current = { kind: "none" };
    const state = useEditor.getState();
    ctx.guides.current = [];
    ctx.spacings.current = [];
    setReadout(null);

    switch (inter.kind) {
      case "pivot":
        if (inter.persistent) state.endInteraction();
        ctx.scheduleDraw();
        break;
      case "move":
        // A move drop may reparent the moved roots into/out of a frame; holding
        // Cmd/Ctrl on release suppresses that (drop stays in the current parent).
        finishSelectMove(ctx, state, inter, !(e.metaKey || e.ctrlKey));
        break;
      case "resize":
      case "rotate":
      case "corner-radius":
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
        finishPencil(ctx, state);
        break;
      case "brush":
        finishBrush(ctx, state);
        break;
      case "eraser":
        finishEraser(ctx, state);
        break;
      case "pen-anchor":
        // Keep the draft alive for the next click; the curve preview persists.
        break;
      case "marquee":
        onMarqueeUp(
          ctx,
          state,
          inter,
          screenToWorld(state.viewport, screenPoint(e))
        );
        break;
      case "node-marquee": {
        const screen = screenPoint(e);
        onNodeMarqueeUp(ctx, state, inter, screen, screenToWorld(state.viewport, screen));
        break;
      }
      case "frame-create":
        finishFrame(ctx, state, inter);
        break;
      case "guide-drag":
        finishGuideDrag(ctx, state, inter, screenPoint(e), sizeRef.current);
        break;
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "pen") {
      penDownRef.current = false;
      penSeenAtRef.current = performance.now();
    }
    // A cancelled contact can never have been a clean tap.
    if (e.pointerType === "touch") tap.reset();
    if (rejectedTouchRef.current.delete(e.pointerId)) return;
    contextMenu.endTouch(e.pointerId);
    const canvas = canvasRef.current!;
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    if (gestureRef.current) {
      if (pointersRef.current.size < 2) gestureRef.current = null;
      return;
    }
    const inter = ctx.interaction.current;
    // Likewise, cancelling an unrelated contact must not cancel the drag its
    // owner is still performing.
    if (inter.kind === "none" || !ownsInteraction(e.pointerId)) return;
    ownerRef.current = null;
    cancelActiveInteraction(ctx);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const state = useEditor.getState();
    const screen = screenPoint(e);
    if (state.tool === "select") {
      if (onSelectDoubleClick(ctx, state, screen)) return;
      const world = screenToWorld(state.viewport, screen);
      const hitId = pickShape(ctx, world);
      if (!hitId) return;
      // Drill one level into the group under the cursor, selecting the child
      // that was hit; a second double-click descends further.
      const scopeRoot = drillScopeRoot(
        state.doc,
        state.activeGroupId,
        currentFocusRoot(state)
      );
      const resolved = expandToGroups(state.doc, [hitId], scopeRoot)[0];
      if (resolved && isGroup(state.doc.nodes[resolved])) {
        state.setActiveGroup(resolved);
        state.setSelection(expandToGroups(state.doc, [hitId], resolved));
        ctx.scheduleDraw();
        return;
      }
      const directHit = state.doc.nodes[hitId];
      if (directHit?.type === "text") {
        beginTextEdit(directHit, directHit);
        return;
      }
      // Double-clicking an instance dives into its symbol's local view.
      const hit = state.doc.nodes[hitId];
      if (hit && hit.type === "instance") state.enterSymbolEdit(hit.symbolId);
      return;
    }
    if (state.tool === "pen" && ctx.penDraft.current) {
      commitPenDraft(ctx);
      return;
    }
    if (state.tool === "node") {
      onNodeDoubleClick(ctx, state, screen);
    }
  };

  // Dropping onto the canvas places files at the drop point. (Assets/symbols
  // dragged out of the library panels use pointer-based drag, see
  // usePanelCanvasDrag, so only OS file drops arrive here.)
  const onDrop = (e: ReactDragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const state = useEditor.getState();
    const world = screenToWorld(state.viewport, screenPoint(e));
    const dt = e.dataTransfer;
    const { width, height } = sizeRef.current;
    const fitWithin = {
      width: (width / state.viewport.scale) * 0.8,
      height: (height / state.viewport.scale) * 0.8,
    };

    const files = [...(dt?.files ?? [])];
    if (!files.length) return;
    // A dropped .vinegar.json opens as the document; image files get placed.
    const docFile = files.find(isDocumentFile);
    if (docFile) {
      // Chromium exposes a file handle through the matching item, which lets a
      // dropped document be overwritten by a later Save. The item is only
      // readable while the drop event is live, so start the lookup here and
      // hand the pending result over rather than the item itself.
      const item = [...(dt?.items ?? [])].filter((i) => i.kind === "file")[
        files.indexOf(docFile)
      ];
      void openDocumentFile(docFile, item ? handleFromDataTransferItem(item) : null);
      return;
    }
    void state.placeImageFiles(files, world, fitWithin);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onContextMenu: contextMenu.onContextMenu,
    onDrop,
  };
}
