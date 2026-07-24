import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { isDocumentFile, openDocumentFile } from "../../io/openDocument";
import {
  drillScopeRoot,
  expandToGroups,
  isWithinGroup,
} from "../../model/groups";
import { isGroup, scopeRootGroupId } from "../../model/scene";
import type { Vec2 } from "../../model/types";
import { screenToWorld } from "@/model/geometry/viewport";
import { currentSymbolScope, useEditor } from "../../store/editorStore";
import { readModifiers } from "../../store/inputStore";
import { openContextMenu } from "../../store/menuStore";
import { setPointer, setReadout } from "../../store/pointerStore";
import { canvasMenu, selectionMenu } from "../../ui/menus";
import { resolveCursor } from "../cursor";
import { type ToolContext } from "../interaction";
import { cancelActiveInteraction } from "../interactionLifecycle";
import { pickShape } from "../picking";
import {
  finishArtboard,
  onArtboardDown,
  onArtboardMove,
} from "../tools/artboardTool";
import { finishBrush, onBrushMove, startBrush } from "../tools/brushTool";
import { bucketFillAt } from "../tools/bucketTool";
import { finishEraser, onEraserMove, startEraser } from "../tools/eraserTool";
import {
  onNodeDoubleClick,
  onNodeDown,
  onNodeMarqueeMove,
  onNodeMarqueeUp,
  onNodeMove,
} from "../tools/nodeTool";
import {
  commitPenDraft,
  onPenAnchorMove,
  onPenDown,
  onPenHoverMove,
} from "../tools/penTool";
import {
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
import type { CanvasGestures } from "./useCanvasGestures";
import type { TextEditing } from "./useTextEditing";

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
  const { pointersRef, gestureRef, beginGesture, updateGesture } = gestures;
  const { textEditRef, beginTextEdit, commitTextEdit } = text;

  const screenPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const updateHoverCursor = (screen: Vec2, world: Vec2) => {
    const canvas = canvasRef.current!;
    const state = useEditor.getState();
    canvas.style.cursor = resolveCursor(ctx, state, screen, world, spaceRef.current);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // Right button is reserved for the context menu (see onContextMenu).
    if (e.button === 2) return;
    // Palm rejection: while a pen brush/eraser stroke is live, ignore touch
    // contacts so a resting palm/finger cannot hijack it into a gesture.
    if (
      (ctx.interaction.current.kind === "brush" ||
        ctx.interaction.current.kind === "eraser") &&
      e.pointerType === "touch"
    )
      return;
    const activeTextId = textEditRef.current?.shape.id;
    if (activeTextId) commitTextEdit(activeTextId);
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const screen = screenPoint(e);
    pointersRef.current.set(e.pointerId, screen);

    // A second pointer promotes the interaction to a two-finger gesture.
    if (pointersRef.current.size >= 2) {
      beginGesture();
      return;
    }

    const state = useEditor.getState();
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

    const tool = state.tool;

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
      startBrush(
        ctx,
        state,
        world,
        e.pointerType === "pen" ? e.pressure : 1,
        e.pointerId
      );
      return;
    }
    if (tool === "eraser") {
      startEraser(ctx, world, e.pointerId);
      return;
    }
    if (tool === "bucket") {
      // A plain click commits (or toasts) immediately; no drag interaction.
      bucketFillAt(state, world);
      return;
    }
    if (tool === "artboard") {
      onArtboardDown(ctx, state, screen, world);
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
    const screen = screenPoint(e);
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, screen);
    }
    if (gestureRef.current) {
      updateGesture();
      return;
    }

    const inter = ctx.interaction.current;
    // A touch contact ignored by a drawing tool's pointerdown handler can
    // still deliver events through implicit pointer capture. Only the pointer
    // that started the interaction may contribute samples.
    if (
      (inter.kind === "brush" || inter.kind === "eraser") &&
      e.pointerId !== inter.pointerId
    )
      return;
    const state = useEditor.getState();
    const world = screenToWorld(state.viewport, screen);
    const mod = readModifiers(e);
    setPointer(world);

    if (inter.kind === "none") {
      if (state.tool === "pen" && ctx.penDraft.current) {
        onPenHoverMove(ctx, state, world, mod.shift);
      }
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
        onSelectMove(ctx, state, inter, screen, world, mod.shift);
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
      case "node-marquee":
        onNodeMarqueeMove(ctx, state, inter, screen);
        break;
      case "artboard-create":
      case "artboard-move":
      case "artboard-resize":
        onArtboardMove(ctx, state, inter, world);
        break;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);

    // Winding down a gesture: end it once fewer than two pointers remain. A
    // lone leftover finger stays inert until lifted (no tool restart).
    if (gestureRef.current) {
      if (pointersRef.current.size < 2) gestureRef.current = null;
      return;
    }

    const inter = ctx.interaction.current;
    // Do not let an ignored palm/finger end the active drawing interaction.
    if (
      (inter.kind === "brush" || inter.kind === "eraser") &&
      e.pointerId !== inter.pointerId
    )
      return;
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
      case "resize":
      case "rotate":
      case "corner-radius":
      case "node-anchor":
      case "node-handle":
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
      case "artboard-create":
      case "artboard-move":
      case "artboard-resize":
        finishArtboard(ctx, state, inter);
        break;
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    if (gestureRef.current) {
      if (pointersRef.current.size < 2) gestureRef.current = null;
      return;
    }
    const inter = ctx.interaction.current;
    // Likewise, cancellation of an unrelated touch pointer must not cancel
    // the pointer that owns the drawing interaction.
    if (
      (inter.kind === "brush" || inter.kind === "eraser") &&
      e.pointerId !== inter.pointerId
    )
      return;
    if (inter.kind !== "none") cancelActiveInteraction(ctx);
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
      const symbolRoot = scopeRootGroupId(state.doc, currentSymbolScope(state));
      const scopeRoot = drillScopeRoot(state.doc, state.activeGroupId, symbolRoot);
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
      void openDocumentFile(docFile);
      return;
    }
    void state.placeImageFiles(files, world, fitWithin);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const state = useEditor.getState();
    const world = screenToWorld(state.viewport, screenPoint(e));
    if (state.tool === "select" || state.tool === "node") {
      const hitId = pickShape(ctx, world);
      if (hitId) {
        // Mirror onSelectDown's drill-aware resolution so right-clicking a
        // child inside the active group keeps it selected instead of jumping
        // out to the whole group.
        const symbolRoot = scopeRootGroupId(state.doc, currentSymbolScope(state));
        const activeGroup =
          state.activeGroupId && isGroup(state.doc.nodes[state.activeGroupId])
            ? state.activeGroupId
            : null;
        const insideActive =
          activeGroup != null && isWithinGroup(state.doc, hitId, activeGroup);
        if (activeGroup && !insideActive) state.setActiveGroup(null);
        const scopeRoot = insideActive ? activeGroup : symbolRoot;
        const expanded = expandToGroups(state.doc, [hitId], scopeRoot);
        if (!expanded.some((id) => state.selection.includes(id))) {
          state.setSelection(expanded);
        }
        openContextMenu(e.clientX, e.clientY, selectionMenu());
        return;
      }
    }
    openContextMenu(e.clientX, e.clientY, canvasMenu(world));
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onContextMenu,
    onDrop,
  };
}
