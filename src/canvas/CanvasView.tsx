import { useCallback, useEffect, useMemo, useRef } from "react";
import { subscribeImageCache } from "../imageCache";
import { type Guide, type Spacing } from "@/model/geometry/snap";
import type { PathShape, Bounds, Shape, Vec2 } from "../model/types";
import { currentSymbolScope, useEditor } from "../store/editorStore";
import { setPointer } from "../store/pointerStore";
import "./CanvasView.css";
import { readCanvasTheme, type CanvasTheme } from "./canvasTheme";
import { paintCanvas } from "./paint";
import { useCanvasGestures } from "./hooks/useCanvasGestures";
import { useCanvasKeyboard } from "./hooks/useCanvasKeyboard";
import { useCanvasSizing } from "./hooks/useCanvasSizing";
import { useCanvasTheme } from "./hooks/useCanvasTheme";
import { useCoarsePointer } from "./hooks/useCoarsePointer";
import { usePointerHandlers } from "./hooks/usePointerHandlers";
import { useTextEditing } from "./hooks/useTextEditing";
import { useWheelZoom } from "./hooks/useWheelZoom";
import {
  TOUCH_HIT_SCALE,
  type Interaction,
  type LastInsert,
  type ToolContext,
} from "./interaction";
import ModifierBar from "./ModifierBar";
import TextEditor from "./TextEditor";
import { commitPenDraft } from "./tools/penTool";

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
  const guidesRef = useRef<Guide[]>([]);
  const spacingsRef = useRef<Spacing[]>([]);
  const rafRef = useRef<number | null>(null);
  const themeRef = useRef<CanvasTheme>(readCanvasTheme());
  const spaceRef = useRef(false);
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

  const {
    textEdit,
    textEditRef,
    beginTextEdit,
    commitTextEdit,
    cancelTextEdit,
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
      guides: guidesRef,
      spacings: spacingsRef,
      hitScale: () => (coarseRef.current ? TOUCH_HIT_SCALE : 1),
      scheduleDraw,
    }),
    [scheduleDraw]
  );

  const gestures = useCanvasGestures(ctx);

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
  useCanvasSizing(wrapRef, canvasRef, sizeRef, draw);

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
