import { useCallback, useEffect, useMemo, useRef } from "react";
import { subscribeImageCache } from "../imageCache";
import { type Guide, type Spacing } from "@/model/geometry/snap";
import type { PathShape, Bounds, Shape, Vec2 } from "../model/types";
import { useBrush } from "../store/brushStore";
import { useEditor } from "../store/editorStore";
import { useHighlight } from "../store/highlightStore";
import { setPointer } from "../store/pointerStore";
import { usePreferences } from "../store/preferencesStore";
import "./CanvasView.css";
import { readCanvasTheme, type CanvasTheme } from "./canvasTheme";
import { highlightPulse } from "./highlight";
import { paintCanvas } from "./paint";
import { useCanvasGestures } from "./hooks/useCanvasGestures";
import { useCanvasKeyboard } from "./hooks/useCanvasKeyboard";
import { useCanvasSizing } from "./hooks/useCanvasSizing";
import { useCanvasTheme } from "./hooks/useCanvasTheme";
import { useCoarsePointer } from "./hooks/useCoarsePointer";
import { usePointerHandlers } from "./hooks/usePointerHandlers";
import { useTextEditing } from "./hooks/useTextEditing";
import { useTouchDrawFix } from "./hooks/useTouchDrawFix";
import { useWheelZoom } from "./hooks/useWheelZoom";
import {
  TOUCH_HIT_SCALE,
  type Interaction,
  type LastInsert,
  type PenHover,
  type ToolContext,
} from "./interaction";
import ModifierBar from "./ModifierBar";
import PenDraftBar from "./PenDraftBar";
import FocusBreadcrumb from "./FocusBreadcrumb";
import TextEditor from "./TextEditor";
import { commitPenDraft } from "./tools/penTool";
import { discardCanvasTransients } from "./interactionLifecycle";
import { useRenderBenchmark } from "@/debug/useRenderBenchmark";

export default function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const interactionRef = useRef<Interaction>({ kind: "none" });
  const previewRef = useRef<Shape | null>(null);
  const marqueeRef = useRef<Bounds | null>(null);
  const penDraftRef = useRef<PathShape | null>(null);
  const penExtendRef = useRef<PathShape | null>(null);
  const lastInsertRef = useRef<LastInsert | null>(null);
  const hoverRef = useRef<PenHover | null>(null);
  const brushHoverRef = useRef<{ p: Vec2; radius: number } | null>(null);
  const endpointHintRef = useRef<Vec2 | null>(null);
  const guidesRef = useRef<Guide[]>([]);
  const spacingsRef = useRef<Spacing[]>([]);
  const rafRef = useRef<number | null>(null);
  const themeRef = useRef<CanvasTheme>(readCanvasTheme());
  const spaceRef = useRef(false);
  const coarseRef = useRef(
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
  );

  // ---- drawing -----------------------------------------------------------
  // `scheduleDraw` is defined below in terms of `draw`; the ref lets the pulse
  // animation ask for the next frame from inside `draw` itself.
  const scheduleDrawRef = useRef<(() => void) | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const { nodeId, at } = useHighlight.getState();
    const highlight = nodeId ? { nodeId } : null;
    const pulse = highlight ? highlightPulse(at, performance.now()) : 0;
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
      brushHover: brushHoverRef.current,
      endpointHint: endpointHintRef.current,
      guides: guidesRef.current,
      spacings: spacingsRef.current,
      hiddenTextId: textEditRef.current?.original?.id ?? null,
      highlight: highlight ? { nodeId: highlight.nodeId, pulse } : null,
    });
    // The hover pulse animates by re-scheduling itself until it settles; it is
    // deliberately short, because each frame repaints the whole scene.
    if (pulse > 0) scheduleDrawRef.current?.();
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);
  useEffect(() => {
    scheduleDrawRef.current = scheduleDraw;
  }, [scheduleDraw]);

  const {
    textEdit,
    textEditRef,
    beginTextEdit,
    commitTextEdit,
    cancelTextEdit,
    discardTextEdit,
    changeTextEdit,
  } = useTextEditing(scheduleDraw);

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
      brushHover: brushHoverRef,
      endpointHint: endpointHintRef,
      guides: guidesRef,
      spacings: spacingsRef,
      hitScale: () => (coarseRef.current ? TOUCH_HIT_SCALE : 1),
      scheduleDraw,
    }),
    [scheduleDraw]
  );

  const gestures = useCanvasGestures(ctx);

  // Redraw on any store change; commit a pending pen path when leaving the tool.
  // Unmounting is the same kind of exit: the draft lives in a ref that is about
  // to go away, and its on-screen bar reads a store that would otherwise be
  // left claiming a draft nothing owns any more.
  //
  // A *replaced* document (new / open / recover) is the opposite case: nothing
  // in flight may be committed, because it was drawn into a document that no
  // longer exists — it is dropped instead. See `_docEpoch`.
  const epochRef = useRef(useEditor.getState()._docEpoch);
  useEffect(() => {
    const unsubscribe = useEditor.subscribe((s) => {
      if (s._docEpoch !== epochRef.current) {
        epochRef.current = s._docEpoch;
        discardCanvasTransients(ctx);
        discardTextEdit();
      } else if (s.tool !== "pen" && penDraftRef.current) {
        commitPenDraft(ctx);
      }
      scheduleDraw();
    });
    return () => {
      unsubscribe();
      if (penDraftRef.current) commitPenDraft(ctx);
    };
  }, [ctx, scheduleDraw, discardTextEdit]);

  // Repaint when an image asset finishes decoding.
  useEffect(() => subscribeImageCache(scheduleDraw), [scheduleDraw]);

  // Preferences the canvas reads at paint time (e.g. the ruler origin mode).
  useEffect(() => usePreferences.subscribe(scheduleDraw), [scheduleDraw]);

  // Repaint while a panel row is hovered, to draw/erase its outline.
  useEffect(() => useHighlight.subscribe(scheduleDraw), [scheduleDraw]);

  // Resize the hovering tip ring as the size changes. `[` / `]` and the panel
  // both change it without the pointer moving, and the ring is where the new
  // size is legible — leaving it stale until the next move would make the
  // keyboard steps look like they did nothing.
  useEffect(
    () =>
      useBrush.subscribe((brush) => {
        const hover = brushHoverRef.current;
        if (!hover) return;
        const radius =
          (useEditor.getState().tool === "eraser" ? brush.eraserSize : brush.size) / 2;
        if (radius === hover.radius) return;
        brushHoverRef.current = { ...hover, radius };
        scheduleDraw();
      }),
    [scheduleDraw]
  );

  useCanvasTheme(themeRef, scheduleDraw);
  useCanvasSizing(wrapRef, canvasRef, sizeRef, draw);

  useRenderBenchmark(draw);

  const {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onContextMenu,
    onDrop,
  } = usePointerHandlers({
    ctx,
    canvasRef,
    spaceRef,
    sizeRef,
    gestures,
    text: { textEditRef, beginTextEdit, commitTextEdit },
  });

  useCoarsePointer(coarseRef, scheduleDraw);
  useWheelZoom(canvasRef);
  useTouchDrawFix(canvasRef, wrapRef);
  useCanvasKeyboard(ctx, canvasRef, spaceRef);

  return (
    <div className="canvas-wrap" ref={wrapRef} tabIndex={-1}>
      <canvas
        ref={canvasRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          setPointer(null);
          brushHoverRef.current = null;
          endpointHintRef.current = null;
          scheduleDraw();
        }}
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
      <PenDraftBar ctx={ctx} />
      <FocusBreadcrumb />
    </div>
  );
}
