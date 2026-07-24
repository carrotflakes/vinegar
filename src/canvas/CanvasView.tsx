import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeImageCache } from "../imageCache";
import {
  drillScopeRoot,
  expandToGroups,
  isWithinGroup,
} from "../model/groups";
import { isDocumentFile, openDocumentFile } from "../io/openDocument";
import { isGroup, scopeRootGroupId } from "../model/scene";
import { type Guide, type Spacing } from "@/model/geometry/snap";
import type { PathShape, Bounds, Shape, TextShape, Vec2 } from "../model/types";
import {
  rotateAt,
  screenToWorld,
  snapAngleToQuarter,
  zoomAt,
  type Viewport,
} from "@/model/geometry/viewport";
import { currentSymbolScope, useEditor } from "../store/editorStore";
import { readModifiers } from "../store/inputStore";
import { openContextMenu } from "../store/menuStore";
import { setPointer, setReadout } from "../store/pointerStore";
import { usePreferences } from "../store/preferencesStore";
import { canvasMenu, selectionMenu } from "../ui/menus";
import "./CanvasView.css";
import { readCanvasTheme, type CanvasTheme } from "./canvasTheme";
import { resolveCursor } from "./cursor";
import { paintCanvas } from "./paint";
import { useCanvasKeyboard } from "./hooks/useCanvasKeyboard";
import { useCanvasSizing } from "./hooks/useCanvasSizing";
import { useCanvasTheme } from "./hooks/useCanvasTheme";
import { useCoarsePointer } from "./hooks/useCoarsePointer";
import { useWheelZoom } from "./hooks/useWheelZoom";
import {
  TOUCH_HIT_SCALE,
  type Interaction,
  type LastInsert,
  type ToolContext,
} from "./interaction";
import ModifierBar from "./ModifierBar";
import { pickShape } from "./picking";
import TextEditor from "./TextEditor";
import { measureTextShape } from "./textLayout";
import {
  finishArtboard,
  onArtboardDown,
  onArtboardMove,
} from "./tools/artboardTool";
import {
  cancelBrush,
  finishBrush,
  onBrushMove,
  startBrush,
} from "./tools/brushTool";
import { bucketFillAt } from "./tools/bucketTool";
import {
  cancelEraser,
  finishEraser,
  onEraserMove,
  startEraser,
} from "./tools/eraserTool";
import {
  onNodeDoubleClick,
  onNodeDown,
  onNodeMarqueeMove,
  onNodeMarqueeUp,
  onNodeMove,
} from "./tools/nodeTool";
import {
  commitPenDraft,
  onPenAnchorMove,
  onPenDown,
  onPenHoverMove,
} from "./tools/penTool";
import {
  onMarqueeUp,
  onSelectDoubleClick,
  onSelectDown,
  onSelectMove,
} from "./tools/selectTool";
import {
  finishCreate,
  finishPencil,
  onCreateMove,
  onPencilMove,
  startPencil,
  startShape,
} from "./tools/shapeTools";
import {
  finishTextCreate,
  moveTextCreate,
  startTextCreate,
} from "./tools/textTool";

interface TextEditSession {
  shape: TextShape;
  original: TextShape | null;
  previousSelection: string[];
}

export default function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const editingSymbolName = useEditor((s) => {
    const id = currentSymbolScope(s);
    return id ? s.doc.symbols[id]?.name ?? "Symbol" : null;
  });
  const exitSymbolEdit = useEditor((s) => s.exitSymbolEdit);

  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const interactionRef = useRef<Interaction>({ kind: "none" });
  const previewRef = useRef<Shape | null>(null);
  const marqueeRef = useRef<Bounds | null>(null);
  const penDraftRef = useRef<PathShape | null>(null);
  const penExtendRef = useRef<PathShape | null>(null);
  const lastInsertRef = useRef<LastInsert | null>(null);
  const hoverRef = useRef<Vec2 | null>(null);
  const textEditRef = useRef<TextEditSession | null>(null);
  const [textEdit, setTextEditState] = useState<TextEditSession | null>(null);
  const guidesRef = useRef<Guide[]>([]);
  const spacingsRef = useRef<Spacing[]>([]);
  const rafRef = useRef<number | null>(null);
  const themeRef = useRef<CanvasTheme>(readCanvasTheme());
  const spaceRef = useRef(false);
  // Active pointers (screen coords, canvas-relative) for multi-touch gestures.
  const pointersRef = useRef<Map<number, Vec2>>(new Map());
  // Two-finger pinch/pan gesture snapshot, or null when no gesture is active.
  const gestureRef = useRef<{
    startDist: number;
    startAngle: number;
    startCenter: Vec2;
    startViewport: Viewport;
  } | null>(null);
  const coarseRef = useRef(
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
  );

  // ---- drawing -----------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    paintCanvas({
      ctx2d,
      size: sizeRef.current,
      state: useEditor.getState(),
      theme: themeRef.current,
      coarse: coarseRef.current,
      preview: previewRef.current,
      marquee: marqueeRef.current,
      interaction: interactionRef.current,
      penDraft: penDraftRef.current,
      hover: hoverRef.current,
      guides: guidesRef.current,
      spacings: spacingsRef.current,
      hiddenTextId: textEditRef.current?.original?.id ?? null,
    });
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);

  const setTextEdit = useCallback((session: TextEditSession | null) => {
    textEditRef.current = session;
    setTextEditState(session);
    scheduleDraw();
  }, [scheduleDraw]);

  const beginTextEdit = useCallback((shape: TextShape, original: TextShape | null) => {
    const state = useEditor.getState();
    const previousSelection = state.selection;
    state.setSelection([shape.id]);
    setTextEdit({ shape, original, previousSelection });
  }, [setTextEdit]);

  const commitTextEdit = useCallback((expectedId?: string) => {
    const session = textEditRef.current;
    if (!session || (expectedId && session.shape.id !== expectedId)) return;
    textEditRef.current = null;
    setTextEditState(null);
    const state = useEditor.getState();
    const isEmpty = session.shape.text.trim() === "";
    if (session.original) {
      if (isEmpty) {
        // Emptying an existing text removes it rather than leaving an
        // invisible, unselectable node behind.
        state.setSelection([session.shape.id]);
        state.deleteSelected();
      } else if (JSON.stringify(session.shape) !== JSON.stringify(session.original)) {
        // Skip the no-op history entry when nothing actually changed.
        state.updateShape(session.shape);
      }
    } else if (!isEmpty) {
      state.addShape(session.shape);
    } else {
      // A freshly created text left empty never becomes a document node.
      state.setSelection(session.previousSelection);
    }
    scheduleDraw();
  }, [scheduleDraw]);

  const cancelTextEdit = useCallback((expectedId?: string) => {
    const session = textEditRef.current;
    if (!session || (expectedId && session.shape.id !== expectedId)) return;
    setTextEdit(null);
    if (session && !session.original) {
      useEditor.getState().setSelection(session.previousSelection);
    }
  }, [setTextEdit]);

  const changeTextEdit = useCallback((text: string) => {
    const session = textEditRef.current;
    if (!session) return;
    setTextEdit({ ...session, shape: measureTextShape({ ...session.shape, text }) });
  }, [setTextEdit]);

  // Mutable state shared with the tool modules (see ToolContext).
  const ctx = useMemo<ToolContext>(
    () => ({
      interaction: interactionRef,
      preview: previewRef,
      marquee: marqueeRef,
      penDraft: penDraftRef,
      penExtend: penExtendRef,
      lastInsert: lastInsertRef,
      hover: hoverRef,
      guides: guidesRef,
      spacings: spacingsRef,
      hitScale: () => (coarseRef.current ? TOUCH_HIT_SCALE : 1),
      scheduleDraw,
    }),
    [scheduleDraw]
  );

  // Redraw on any store change; commit a pending pen path when leaving the tool.
  useEffect(
    () =>
      useEditor.subscribe((s) => {
        if (s.tool !== "pen" && penDraftRef.current) commitPenDraft(ctx);
        scheduleDraw();
      }),
    [ctx, scheduleDraw]
  );

  // Repaint when an image asset finishes decoding.
  useEffect(() => subscribeImageCache(scheduleDraw), [scheduleDraw]);

  useCanvasTheme(themeRef, scheduleDraw);

  // Font metrics can change after the document first paints. Refresh the
  // persisted text bounds without creating an undo entry.
  useEffect(() => {
    if (!("fonts" in document)) return;
    let active = true;
    const refresh = () => {
      if (!active) return;
      useEditor.getState().remeasureTextShapes();
      const session = textEditRef.current;
      if (session) setTextEdit({ ...session, shape: measureTextShape(session.shape) });
      scheduleDraw();
    };
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener("loadingdone", refresh);
    return () => {
      active = false;
      document.fonts.removeEventListener("loadingdone", refresh);
    };
  }, [scheduleDraw, setTextEdit]);

  useCanvasSizing(wrapRef, canvasRef, sizeRef, draw);

  const screenPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ---- multi-touch gestures (pinch-zoom / two-finger pan) ----------------

  /** The centroid, spread and angle of the first two active pointers. */
  const twoPointerMetrics = ():
    | { center: Vec2; dist: number; angle: number }
    | null => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };

  /** Discard any in-progress single-pointer tool op, rolling back the doc. */
  const cancelActiveInteraction = () => {
    const inter = interactionRef.current;
    interactionRef.current = { kind: "none" };
    const state = useEditor.getState();
    guidesRef.current = [];
    spacingsRef.current = [];
    setReadout(null);
    switch (inter.kind) {
      case "move":
      case "resize":
      case "rotate":
      case "corner-radius":
      case "pivot":
      case "node-anchor":
      case "node-handle":
      case "artboard-move":
      case "artboard-resize":
        // These commit through begin/endInteraction; roll back the snapshot.
        state.cancelInteraction();
        break;
      case "artboard-create":
        state.cancelInteraction();
        state.selectArtboard(null);
        break;
      case "create":
      case "pencil":
        // Drag-time changes live only in the preview shape.
        previewRef.current = null;
        break;
      case "brush":
        // Also clear the brush tool's transient capture state.
        cancelBrush(ctx);
        break;
      case "eraser":
        cancelEraser(ctx);
        break;
      case "text-create":
        break;
      case "marquee":
        marqueeRef.current = null;
        break;
      case "node-marquee":
        // Selection is updated live during the drag; roll it back.
        marqueeRef.current = null;
        state.setEditNodes(inter.original);
        break;
      // "pan" / "pen-anchor" / "none": nothing to undo.
    }
    scheduleDraw();
  };

  const beginGesture = () => {
    const m = twoPointerMetrics();
    if (!m) return;
    cancelActiveInteraction();
    gestureRef.current = {
      startDist: m.dist,
      startAngle: m.angle,
      startCenter: m.center,
      startViewport: useEditor.getState().viewport,
    };
  };

  const updateGesture = () => {
    const g = gestureRef.current;
    const m = twoPointerMetrics();
    if (!g || !m) return;
    const factor = m.dist > 0 && g.startDist > 0 ? m.dist / g.startDist : 1;
    // Twist rotation is opt-in; when enabled it can snap to quarter turns. The
    // snap targets the absolute orientation, so derive the delta from that.
    const canvas = usePreferences.getState().canvas;
    let delta = canvas.rotationEnabled ? m.angle - g.startAngle : 0;
    if (canvas.rotationEnabled && canvas.rotationSnap) {
      const target = snapAngleToQuarter(g.startViewport.rotation + delta);
      delta = target - g.startViewport.rotation;
    }
    // Zoom and twist around the initial centroid (both keep it fixed), then pan
    // so that world point stays pinned under the current, moving centroid.
    const zoomed = zoomAt(g.startViewport, g.startCenter, factor);
    const rotated = rotateAt(zoomed, g.startCenter, delta);
    useEditor.getState().setViewport({
      ...rotated,
      offset: {
        x: rotated.offset.x + (m.center.x - g.startCenter.x),
        y: rotated.offset.y + (m.center.y - g.startCenter.y),
      },
    });
    scheduleDraw();
  };

  // ---- pointer handling --------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Right button is reserved for the context menu (see onContextMenu).
    if (e.button === 2) return;
    // Palm rejection: while a pen brush/eraser stroke is live, ignore touch
    // contacts so a resting palm/finger cannot hijack it into a gesture.
    if (
      (interactionRef.current.kind === "brush" ||
        interactionRef.current.kind === "eraser") &&
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
      interactionRef.current = {
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

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const screen = screenPoint(e);
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, screen);
    }
    if (gestureRef.current) {
      updateGesture();
      return;
    }

    const inter = interactionRef.current;
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
      if (state.tool === "pen" && penDraftRef.current) {
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

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
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

    const inter = interactionRef.current;
    // Do not let an ignored palm/finger end the active drawing interaction.
    if (
      (inter.kind === "brush" || inter.kind === "eraser") &&
      e.pointerId !== inter.pointerId
    )
      return;
    interactionRef.current = { kind: "none" };
    const state = useEditor.getState();
    guidesRef.current = [];
    spacingsRef.current = [];
    setReadout(null);

    switch (inter.kind) {
      case "pivot":
        if (inter.persistent) state.endInteraction();
        scheduleDraw();
        break;
      case "move":
      case "resize":
      case "rotate":
      case "corner-radius":
      case "node-anchor":
      case "node-handle":
        state.endInteraction();
        scheduleDraw();
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

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    if (gestureRef.current) {
      if (pointersRef.current.size < 2) gestureRef.current = null;
      return;
    }
    const inter = interactionRef.current;
    // Likewise, cancellation of an unrelated touch pointer must not cancel
    // the pointer that owns the drawing interaction.
    if (
      (inter.kind === "brush" || inter.kind === "eraser") &&
      e.pointerId !== inter.pointerId
    )
      return;
    if (inter.kind !== "none") cancelActiveInteraction();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
    if (state.tool === "pen" && penDraftRef.current) {
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
  const onDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
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

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
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

  const updateHoverCursor = (screen: Vec2, world: Vec2) => {
    const canvas = canvasRef.current!;
    const state = useEditor.getState();
    canvas.style.cursor = resolveCursor(ctx, state, screen, world, spaceRef.current);
  };

  useCoarsePointer(coarseRef, scheduleDraw);
  useWheelZoom(canvasRef);
  useCanvasKeyboard(ctx, canvasRef, spaceRef);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => setPointer(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={onDrop}
      />
      {textEdit && (
        <TextEditor
          key={textEdit.shape.id}
          shape={textEdit.shape}
          onChange={changeTextEdit}
          onCommit={() => commitTextEdit(textEdit.shape.id)}
          onCancel={() => cancelTextEdit(textEdit.shape.id)}
        />
      )}
      <ModifierBar />
      {editingSymbolName !== null && (
        <div className="symbol-edit-bar">
          <span className="symbol-edit-label">
            Editing symbol · {editingSymbolName}
          </span>
          <button className="symbol-edit-done" onClick={exitSymbolEdit}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
