import { useCallback, useEffect, useRef } from "react";
import { shapeBounds, unionBounds } from "../model/bounds";
import { hitTestShape } from "../model/hitTest";
import {
  resizeShapeToBounds,
  translateShape,
} from "../model/transforms";
import {
  makeId,
  type Bounds,
  type Shape,
  type Vec2,
} from "../model/types";
import {
  screenToWorld,
  worldToScreen,
  zoomAt,
} from "../model/viewport";
import { styleFromDefaults, useEditor } from "../store/editorStore";
import {
  HANDLE_IDS,
  HANDLE_SIZE,
  handleCursor,
  handlePoint,
  resizeBounds,
  type HandleId,
} from "./handles";
import { drawOverlay } from "./overlay";
import { renderScene } from "./render";

type Interaction =
  | { kind: "none" }
  | { kind: "pan"; startScreen: Vec2; startOffset: Vec2 }
  | { kind: "move"; start: Vec2; originals: Record<string, Shape> }
  | {
      kind: "resize";
      handle: HandleId;
      from: Bounds;
      originals: Record<string, Shape>;
    }
  | { kind: "create"; start: Vec2 }
  | { kind: "pen" }
  | { kind: "marquee"; start: Vec2; additive: boolean };

/** Distance below which a created shape is considered an accidental click. */
const CLICK_SLOP = 3;

export default function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const interactionRef = useRef<Interaction>({ kind: "none" });
  const previewRef = useRef<Shape | null>(null);
  const marqueeRef = useRef<Bounds | null>(null);
  const rafRef = useRef<number | null>(null);
  const spaceRef = useRef(false);

  // ---- drawing -----------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    const { doc, viewport, selection } = useEditor.getState();

    renderScene(ctx, {
      width,
      height,
      dpr,
      viewport,
      doc,
      preview: previewRef.current,
      background: "#ffffff",
      showGrid: true,
    });

    const selectedShapes = selection
      .map((id) => doc.shapes[id])
      .filter(Boolean) as Shape[];
    drawOverlay(ctx, {
      dpr,
      viewport,
      selectionBounds: unionBounds(selectedShapes),
      marquee: marqueeRef.current,
      showHandles: selectedShapes.length > 0,
    });
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);

  // Redraw whenever any store slice changes.
  useEffect(() => useEditor.subscribe(scheduleDraw), [scheduleDraw]);

  // ---- sizing ------------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => ro.disconnect();
  }, [draw]);

  // ---- helpers -----------------------------------------------------------
  const screenPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const pickTolerance = () => 5 / useEditor.getState().viewport.scale;

  /** Find which selection handle (if any) is under a screen point. */
  const hitHandle = (screen: Vec2): HandleId | null => {
    const { doc, selection, viewport } = useEditor.getState();
    const shapes = selection
      .map((id) => doc.shapes[id])
      .filter(Boolean) as Shape[];
    const b = unionBounds(shapes);
    if (!b) return null;
    const grab = HANDLE_SIZE;
    for (const id of HANDLE_IDS) {
      const sp = worldToScreen(viewport, handlePoint(b, id));
      if (Math.abs(sp.x - screen.x) <= grab && Math.abs(sp.y - screen.y) <= grab)
        return id;
    }
    return null;
  };

  /** Topmost shape id at a world point, or null. */
  const pickShape = (world: Vec2): string | null => {
    const { doc } = useEditor.getState();
    const tol = pickTolerance();
    for (let i = doc.order.length - 1; i >= 0; i--) {
      const shape = doc.shapes[doc.order[i]];
      if (shape && hitTestShape(shape, world, tol)) return doc.order[i];
    }
    return null;
  };

  // ---- pointer handling --------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const screen = screenPoint(e);
    const state = useEditor.getState();
    const world = screenToWorld(state.viewport, screen);

    // Pan: middle button or space-held drag, regardless of tool.
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
      // 1) resize handle?
      const handle = hitHandle(screen);
      if (handle) {
        const shapes = state.selection
          .map((id) => state.doc.shapes[id])
          .filter(Boolean) as Shape[];
        const from = unionBounds(shapes)!;
        const originals: Record<string, Shape> = {};
        for (const s of shapes) originals[s.id] = s;
        state.beginInteraction();
        interactionRef.current = { kind: "resize", handle, from, originals };
        return;
      }

      // 2) a shape?
      const hitId = pickShape(world);
      if (hitId) {
        let selection = state.selection;
        if (e.shiftKey) {
          state.toggleSelection(hitId);
          selection = useEditor.getState().selection;
        } else if (!selection.includes(hitId)) {
          state.setSelection([hitId]);
          selection = [hitId];
        }
        const originals: Record<string, Shape> = {};
        for (const id of selection) {
          const s = useEditor.getState().doc.shapes[id];
          if (s) originals[id] = s;
        }
        state.beginInteraction();
        interactionRef.current = { kind: "move", start: world, originals };
        return;
      }

      // 3) empty space -> marquee
      if (!e.shiftKey) state.clearSelection();
      interactionRef.current = {
        kind: "marquee",
        start: world,
        additive: e.shiftKey,
      };
      marqueeRef.current = { x: screen.x, y: screen.y, width: 0, height: 0 };
      return;
    }

    if (tool === "pen") {
      const shape: Shape = {
        id: makeId("path"),
        name: "Path",
        type: "path",
        points: [world],
        closed: false,
        ...styleFromDefaults(state.style),
        fill: null,
      };
      previewRef.current = shape;
      interactionRef.current = { kind: "pen" };
      scheduleDraw();
      return;
    }

    // rect / ellipse / line creation
    previewRef.current = makeCreatedShape(tool, world, world, state.style);
    interactionRef.current = { kind: "create", start: world };
    scheduleDraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const inter = interactionRef.current;
    const state = useEditor.getState();
    const screen = screenPoint(e);
    const world = screenToWorld(state.viewport, screen);

    // Hover cursor feedback when idle and using the select tool.
    if (inter.kind === "none") {
      updateHoverCursor(screen, world);
      return;
    }

    switch (inter.kind) {
      case "pan": {
        state.setViewport({
          ...state.viewport,
          offset: {
            x: inter.startOffset.x + (screen.x - inter.startScreen.x),
            y: inter.startOffset.y + (screen.y - inter.startScreen.y),
          },
        });
        break;
      }
      case "move": {
        const dx = world.x - inter.start.x;
        const dy = world.y - inter.start.y;
        const next: Record<string, Shape> = {};
        for (const [id, orig] of Object.entries(inter.originals)) {
          next[id] = translateShape(orig, dx, dy);
        }
        state.applyShapes(next);
        break;
      }
      case "resize": {
        const to = resizeBounds(inter.from, inter.handle, world);
        const next: Record<string, Shape> = {};
        for (const [id, orig] of Object.entries(inter.originals)) {
          next[id] = resizeShapeToBounds(orig, inter.from, to);
        }
        state.applyShapes(next);
        break;
      }
      case "create": {
        previewRef.current = makeCreatedShape(
          state.tool,
          inter.start,
          world,
          state.style
        );
        scheduleDraw();
        break;
      }
      case "pen": {
        const shape = previewRef.current;
        if (shape && shape.type === "path") {
          const last = shape.points[shape.points.length - 1];
          if (!last || Math.hypot(world.x - last.x, world.y - last.y) > 1.5) {
            shape.points.push(world);
            scheduleDraw();
          }
        }
        break;
      }
      case "marquee": {
        const start = worldToScreen(state.viewport, inter.start);
        marqueeRef.current = {
          x: Math.min(start.x, screen.x),
          y: Math.min(start.y, screen.y),
          width: Math.abs(screen.x - start.x),
          height: Math.abs(screen.y - start.y),
        };
        scheduleDraw();
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    const inter = interactionRef.current;
    interactionRef.current = { kind: "none" };
    const state = useEditor.getState();

    switch (inter.kind) {
      case "move":
      case "resize":
        state.endInteraction();
        break;
      case "create": {
        const shape = previewRef.current;
        previewRef.current = null;
        if (shape && isShapeSubstantial(shape)) state.addShape(shape);
        scheduleDraw();
        break;
      }
      case "pen": {
        const shape = previewRef.current;
        previewRef.current = null;
        if (shape && shape.type === "path" && shape.points.length >= 2) {
          state.addShape(shape);
        }
        scheduleDraw();
        break;
      }
      case "marquee": {
        const end = screenToWorld(
          state.viewport,
          screenPoint(e)
        );
        const region = boundsFromPoints(inter.start, end);
        const hits = state.doc.order.filter((id) => {
          const s = state.doc.shapes[id];
          return s && boundsIntersect(shapeBounds(s), region);
        });
        const base = inter.additive ? state.selection : [];
        state.setSelection(Array.from(new Set([...base, ...hits])));
        marqueeRef.current = null;
        scheduleDraw();
        break;
      }
    }
  };

  const updateHoverCursor = (screen: Vec2, world: Vec2) => {
    const canvas = canvasRef.current!;
    const state = useEditor.getState();
    if (spaceRef.current) {
      canvas.style.cursor = "grab";
      return;
    }
    if (state.tool !== "select") {
      canvas.style.cursor = "crosshair";
      return;
    }
    const handle = hitHandle(screen);
    if (handle) {
      canvas.style.cursor = handleCursor(handle);
      return;
    }
    canvas.style.cursor = pickShape(world) ? "move" : "default";
  };

  // ---- wheel zoom / pan --------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = useEditor.getState();
      const rect = canvas.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        state.setViewport(zoomAt(state.viewport, anchor, factor));
      } else {
        state.setViewport({
          ...state.viewport,
          offset: {
            x: state.viewport.offset.x - e.deltaX,
            y: state.viewport.offset.y - e.deltaY,
          },
        });
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ---- space-to-pan tracking --------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        spaceRef.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = "grab";
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}

// ===========================================================================
// helpers
// ===========================================================================

function makeCreatedShape(
  tool: string,
  a: Vec2,
  b: Vec2,
  style: { fill: string | null; stroke: string | null; strokeWidth: number }
): Shape {
  const base = { ...styleFromDefaults(style) };
  if (tool === "rect") {
    return {
      id: makeId("rect"),
      name: "Rectangle",
      type: "rect",
      x: a.x,
      y: a.y,
      width: b.x - a.x,
      height: b.y - a.y,
      ...base,
    };
  }
  if (tool === "ellipse") {
    return {
      id: makeId("ellipse"),
      name: "Ellipse",
      type: "ellipse",
      x: a.x,
      y: a.y,
      width: b.x - a.x,
      height: b.y - a.y,
      ...base,
    };
  }
  // line
  return {
    id: makeId("line"),
    name: "Line",
    type: "line",
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    ...base,
    fill: null,
  };
}

function isShapeSubstantial(shape: Shape): boolean {
  if (shape.type === "line") {
    return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) > CLICK_SLOP;
  }
  if (shape.type === "rect" || shape.type === "ellipse") {
    return Math.abs(shape.width) > CLICK_SLOP || Math.abs(shape.height) > CLICK_SLOP;
  }
  return true;
}

function boundsFromPoints(a: Vec2, b: Vec2): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}
