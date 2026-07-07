import { useCallback, useEffect, useRef } from "react";
import {
  shapeBounds,
  shapeCenter,
  unionWorldBounds,
  worldShapeBounds,
} from "../model/bounds";
import { pointsToAnchors, simplifyPath } from "../model/freehand";
import { hitTestShape } from "../model/hitTest";
import { magnetAngle, rotateAbout, snapAngle } from "../model/rotate";
import {
  collectSnapTargets,
  computeSnap,
  snapPoint,
  type Guide,
  type SnapTargets,
  type Spacing,
} from "../model/snap";
import { resizeShapeToBounds, translateShape } from "../model/transforms";
import {
  makeId,
  type BezierShape,
  type Bounds,
  type Shape,
  type Vec2,
} from "../model/types";
import { screenToWorld, worldToScreen, zoomAt } from "../model/viewport";
import {
  expandToGroups,
  styleFromDefaults,
  useEditor,
  type EditorState,
} from "../store/editorStore";
import { setPointer, setReadout } from "../store/pointerStore";
import {
  frameHandlePoint,
  frameRotationPoint,
  getSelectionFrame,
  type SelectionFrame,
} from "./frame";
import {
  HANDLE_IDS,
  HANDLE_SIZE,
  handleCursorRotated,
  resizeBounds,
  type HandleId,
} from "./handles";
import {
  ANCHOR_SIZE,
  HANDLE_DOT,
  hitBezierNodes,
  moveAnchor,
  moveHandle,
} from "./nodes";
import {
  drawGuides,
  drawNodes,
  drawOverlay,
  drawPenDraft,
  drawSpacings,
} from "./overlay";
import { resizeSingleShape } from "./resize";
import { renderScene } from "./render";

type FrameHit =
  | { type: "resize"; id: HandleId }
  | { type: "rotate" }
  | null;

type Interaction =
  | { kind: "none" }
  | { kind: "pan"; startScreen: Vec2; startOffset: Vec2 }
  | {
      kind: "move";
      start: Vec2;
      originals: Record<string, Shape>;
      origUnion: Bounds;
      targets: SnapTargets;
      boxes: Bounds[];
    }
  | {
      kind: "resize";
      handle: HandleId;
      from: Bounds;
      originals: Record<string, Shape>;
      single: boolean;
    }
  | {
      kind: "rotate";
      pivot: Vec2;
      startAngle: number;
      /** Frame rotation at drag start; magnetic snapping targets the result. */
      startRotation: number;
      originals: Record<string, Shape>;
    }
  | { kind: "create"; start: Vec2 }
  | { kind: "pencil" }
  | { kind: "pen-anchor"; index: number }
  | { kind: "node-anchor"; shapeId: string; index: number; orig: BezierShape }
  | {
      kind: "node-handle";
      shapeId: string;
      index: number;
      part: "in" | "out";
      orig: BezierShape;
    }
  | { kind: "marquee"; start: Vec2; additive: boolean };

/** Distance below which a created shape is considered an accidental click. */
const CLICK_SLOP = 3;
const NODE_GRAB = 8;
/** Hit tolerances grow by this factor for coarse (touch) pointers. */
const TOUCH_HIT_SCALE = 2.2;
/** Selection/node chrome is drawn this much larger for touch. */
const TOUCH_DRAW_SCALE = 1.6;

function selectedBezier(state: EditorState): BezierShape | null {
  if (state.selection.length !== 1) return null;
  const s = state.doc.shapes[state.selection[0]];
  return s && s.type === "bezier" ? s : null;
}

export default function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const interactionRef = useRef<Interaction>({ kind: "none" });
  const previewRef = useRef<Shape | null>(null);
  const marqueeRef = useRef<Bounds | null>(null);
  const penDraftRef = useRef<BezierShape | null>(null);
  const hoverRef = useRef<Vec2 | null>(null);
  const guidesRef = useRef<Guide[]>([]);
  const spacingsRef = useRef<Spacing[]>([]);
  const rafRef = useRef<number | null>(null);
  const spaceRef = useRef(false);
  const coarseRef = useRef(
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
  );

  /** Multiplier that enlarges hit targets when the primary pointer is touch. */
  const hitScale = () => (coarseRef.current ? TOUCH_HIT_SCALE : 1);

  // ---- drawing -----------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    const state = useEditor.getState();
    const { doc, viewport, selection, tool } = state;

    renderScene(ctx, {
      width,
      height,
      dpr,
      viewport,
      doc,
      preview: previewRef.current,
      background: "#ffffff",
      showGrid: true,
      gridSize: state.gridSize,
    });

    const chrome = coarseRef.current ? TOUCH_DRAW_SCALE : 1;
    const selectedShapes = selection
      .map((id) => doc.shapes[id])
      .filter(Boolean) as Shape[];
    drawOverlay(ctx, {
      dpr,
      viewport,
      frame: tool === "select" ? getSelectionFrame(selectedShapes) : null,
      marquee: marqueeRef.current,
      showHandles: tool === "select" && selectedShapes.length > 0,
      handleSize: HANDLE_SIZE * chrome,
    });

    if (tool === "node") {
      const sel = selectedBezier(state);
      if (sel) {
        const active =
          state.editNode && state.editNode.shapeId === sel.id
            ? state.editNode.index
            : null;
        drawNodes(
          ctx,
          dpr,
          viewport,
          sel,
          active,
          ANCHOR_SIZE * chrome,
          HANDLE_DOT * chrome
        );
      }
    }
    if (tool === "pen" && penDraftRef.current) {
      drawPenDraft(ctx, dpr, viewport, penDraftRef.current, hoverRef.current);
    }
    drawGuides(ctx, dpr, viewport, guidesRef.current);
    drawSpacings(ctx, dpr, viewport, spacingsRef.current);
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);

  // ---- pen draft lifecycle ----------------------------------------------
  const commitPenDraft = useCallback(() => {
    const draft = penDraftRef.current;
    penDraftRef.current = null;
    previewRef.current = null;
    hoverRef.current = null;
    if (draft) {
      const anchors = draft.anchors;
      // Drop a near-duplicate final anchor (left over from a double-click).
      if (anchors.length >= 2) {
        const a = anchors[anchors.length - 1].p;
        const b = anchors[anchors.length - 2].p;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) anchors.pop();
      }
      if (anchors.length >= 2) useEditor.getState().addShape(draft);
    }
    scheduleDraw();
  }, [scheduleDraw]);

  const cancelPenDraft = useCallback(() => {
    penDraftRef.current = null;
    previewRef.current = null;
    hoverRef.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  // Soft undo: drop the last-placed anchor without discarding the whole draft.
  const undoPenAnchor = useCallback(() => {
    const draft = penDraftRef.current;
    if (!draft) return;
    draft.anchors.pop();
    if (draft.anchors.length === 0) {
      cancelPenDraft();
      return;
    }
    interactionRef.current = { kind: "none" };
    previewRef.current = draft;
    scheduleDraw();
  }, [cancelPenDraft, scheduleDraw]);

  // Redraw on any store change; commit a pending pen path when leaving the tool.
  useEffect(
    () =>
      useEditor.subscribe((s) => {
        if (s.tool !== "pen" && penDraftRef.current) commitPenDraft();
        scheduleDraw();
      }),
    [scheduleDraw, commitPenDraft]
  );

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

  const pickTolerance = () =>
    (5 * hitScale()) / useEditor.getState().viewport.scale;

  const selectionFrame = (): SelectionFrame | null => {
    const { doc, selection } = useEditor.getState();
    const shapes = selection
      .map((id) => doc.shapes[id])
      .filter(Boolean) as Shape[];
    return getSelectionFrame(shapes);
  };

  /** Hit-test the resize handles and rotation handle of the selection frame. */
  const hitFrameHandle = (screen: Vec2): FrameHit => {
    const { viewport } = useEditor.getState();
    const frame = selectionFrame();
    if (!frame) return null;
    const tol = HANDLE_SIZE * hitScale();
    const rot = worldToScreen(viewport, frameRotationPoint(frame, viewport.scale));
    if (
      Math.abs(rot.x - screen.x) <= tol &&
      Math.abs(rot.y - screen.y) <= tol
    )
      return { type: "rotate" };
    for (const id of HANDLE_IDS) {
      const sp = worldToScreen(viewport, frameHandlePoint(frame, id));
      if (
        Math.abs(sp.x - screen.x) <= tol &&
        Math.abs(sp.y - screen.y) <= tol
      )
        return { type: "resize", id };
    }
    return null;
  };

  const pickShape = (world: Vec2): string | null => {
    const { doc } = useEditor.getState();
    const tol = pickTolerance();
    for (let i = doc.order.length - 1; i >= 0; i--) {
      const shape = doc.shapes[doc.order[i]];
      if (
        shape &&
        !shape.hidden &&
        !shape.locked &&
        hitTestShape(shape, world, tol)
      )
        return doc.order[i];
    }
    return null;
  };

  /**
   * Snap a single world point to alignment lines / grid (for creation, resize
   * and vertex editing). Updates the on-screen guides and returns the point.
   */
  const pointSnap = (world: Vec2, exclude: Set<string>): Vec2 => {
    const state = useEditor.getState();
    spacingsRef.current = [];
    if (!state.snapEnabled && !state.gridSnap) {
      guidesRef.current = [];
      return world;
    }
    const others = state.doc.order
      .map((id) => state.doc.shapes[id])
      .filter((s): s is Shape => !!s && !s.hidden && !exclude.has(s.id));
    const res = snapPoint(
      world,
      {
        targets: state.snapEnabled
          ? collectSnapTargets(others)
          : { x: [], y: [] },
        gridSize: state.gridSnap ? state.gridSize : null,
      },
      6 / state.viewport.scale
    );
    guidesRef.current = res.guides;
    return res.point;
  };

  const EMPTY_EXCLUDE = new Set<string>();

  // ---- pointer handling --------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const screen = screenPoint(e);
    const state = useEditor.getState();
    const world = screenToWorld(state.viewport, screen);

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
      onSelectDown(e, state, screen, world);
      return;
    }
    if (tool === "node") {
      onNodeDown(state, screen, world);
      return;
    }
    if (tool === "pen") {
      onPenDown(state, screen, world);
      return;
    }
    if (tool === "pencil") {
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
      interactionRef.current = { kind: "pencil" };
      scheduleDraw();
      return;
    }

    // rect / ellipse / line
    const start = pointSnap(world, EMPTY_EXCLUDE);
    previewRef.current = makeCreatedShape(tool, start, start, state.style);
    interactionRef.current = { kind: "create", start };
    scheduleDraw();
  };

  const snapshot = (ids: string[]): Record<string, Shape> => {
    const { doc } = useEditor.getState();
    const out: Record<string, Shape> = {};
    for (const id of ids) if (doc.shapes[id]) out[id] = doc.shapes[id];
    return out;
  };

  const onSelectDown = (
    e: React.PointerEvent,
    state: EditorState,
    screen: Vec2,
    world: Vec2
  ) => {
    // Rotation / resize handles take priority over picking shapes.
    const hit = hitFrameHandle(screen);
    if (hit?.type === "rotate") {
      const frame = selectionFrame()!;
      state.beginInteraction();
      interactionRef.current = {
        kind: "rotate",
        pivot: frame.center,
        startAngle: Math.atan2(world.y - frame.center.y, world.x - frame.center.x),
        startRotation: frame.rotation,
        originals: snapshot(state.selection),
      };
      return;
    }
    if (hit?.type === "resize") {
      const frame = selectionFrame()!;
      state.beginInteraction();
      interactionRef.current = {
        kind: "resize",
        handle: hit.id,
        from: frame.bounds,
        originals: snapshot(state.selection),
        single: state.selection.length === 1,
      };
      return;
    }

    const hitId = pickShape(world);
    if (hitId) {
      let selection: string[];
      if (e.shiftKey) {
        const group = expandToGroups(state.doc, [hitId]);
        const has = group.every((id) => state.selection.includes(id));
        selection = has
          ? state.selection.filter((id) => !group.includes(id))
          : [...new Set([...state.selection, ...group])];
        state.setSelection(selection);
      } else if (!state.selection.includes(hitId)) {
        selection = expandToGroups(state.doc, [hitId]);
        state.setSelection(selection);
      } else {
        selection = state.selection;
      }
      const originals = snapshot(selection);
      const selSet = new Set(selection);
      const others = state.doc.order
        .map((id) => state.doc.shapes[id])
        .filter((s): s is Shape => !!s && !selSet.has(s.id) && !s.hidden);
      state.beginInteraction();
      interactionRef.current = {
        kind: "move",
        start: world,
        originals,
        origUnion: unionWorldBounds(Object.values(originals)) ?? {
          x: world.x,
          y: world.y,
          width: 0,
          height: 0,
        },
        targets: collectSnapTargets(others),
        boxes: others.map(worldShapeBounds),
      };
      return;
    }

    if (!e.shiftKey) state.clearSelection();
    interactionRef.current = {
      kind: "marquee",
      start: world,
      additive: e.shiftKey,
    };
    marqueeRef.current = { x: screen.x, y: screen.y, width: 0, height: 0 };
  };

  const onNodeDown = (state: EditorState, screen: Vec2, world: Vec2) => {
    const sel = selectedBezier(state);
    if (sel) {
      const hit = hitBezierNodes(
        sel,
        screen,
        state.viewport,
        NODE_GRAB * hitScale()
      );
      if (hit) {
        state.setEditNode({ shapeId: sel.id, index: hit.index });
        state.beginInteraction();
        interactionRef.current =
          hit.part === "anchor"
            ? { kind: "node-anchor", shapeId: sel.id, index: hit.index, orig: sel }
            : {
                kind: "node-handle",
                shapeId: sel.id,
                index: hit.index,
                part: hit.part,
                orig: sel,
              };
        return;
      }
    }
    // Select another Bézier shape, or clear.
    const id = pickShape(world);
    if (id && state.doc.shapes[id].type === "bezier") {
      state.setSelection([id]);
      state.setEditNode(null);
    } else {
      state.clearSelection();
    }
  };

  const onPenDown = (state: EditorState, screen: Vec2, world: Vec2) => {
    world = pointSnap(world, EMPTY_EXCLUDE);
    const draft = penDraftRef.current;
    if (!draft) {
      const shape: BezierShape = {
        id: makeId("bezier"),
        name: "Curve",
        type: "bezier",
        anchors: [{ p: world, hIn: null, hOut: null }],
        closed: false,
        ...styleFromDefaults(state.style),
      };
      penDraftRef.current = shape;
      previewRef.current = shape;
      interactionRef.current = { kind: "pen-anchor", index: 0 };
      scheduleDraw();
      return;
    }

    // Click near the first anchor closes the path.
    if (draft.anchors.length >= 2) {
      const first = worldToScreen(state.viewport, draft.anchors[0].p);
      if (Math.hypot(first.x - screen.x, first.y - screen.y) <= NODE_GRAB) {
        draft.closed = true;
        commitPenDraft();
        return;
      }
    }

    draft.anchors.push({ p: world, hIn: null, hOut: null });
    previewRef.current = draft;
    interactionRef.current = { kind: "pen-anchor", index: draft.anchors.length - 1 };
    scheduleDraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const inter = interactionRef.current;
    const state = useEditor.getState();
    const screen = screenPoint(e);
    const world = screenToWorld(state.viewport, screen);
    setPointer(world);

    if (inter.kind === "none") {
      if (state.tool === "pen" && penDraftRef.current) {
        hoverRef.current = pointSnap(world, EMPTY_EXCLUDE);
        scheduleDraw();
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
      case "move": {
        const rawDx = world.x - inter.start.x;
        const rawDy = world.y - inter.start.y;
        let dx = rawDx;
        let dy = rawDy;
        const gridSize = state.gridSnap ? state.gridSize : null;
        if (state.snapEnabled || gridSize) {
          const movingBox = {
            x: inter.origUnion.x + rawDx,
            y: inter.origUnion.y + rawDy,
            width: inter.origUnion.width,
            height: inter.origUnion.height,
          };
          const snap = computeSnap(
            movingBox,
            {
              targets: state.snapEnabled
                ? inter.targets
                : { x: [], y: [] },
              boxes: state.snapEnabled ? inter.boxes : [],
              gridSize,
            },
            6 / state.viewport.scale
          );
          dx += snap.dx;
          dy += snap.dy;
          guidesRef.current = snap.guides;
          spacingsRef.current = snap.spacings;
        } else {
          guidesRef.current = [];
          spacingsRef.current = [];
        }
        const next: Record<string, Shape> = {};
        for (const [id, orig] of Object.entries(inter.originals)) {
          next[id] = translateShape(orig, dx, dy);
        }
        state.applyShapes(next);
        setReadout(`Δ ${Math.round(dx)}, ${Math.round(dy)}`);
        break;
      }
      case "resize": {
        const handlePt = pointSnap(world, new Set(Object.keys(inter.originals)));
        if (inter.single) {
          const entry = Object.entries(inter.originals)[0];
          if (entry) {
            const resized = resizeSingleShape(entry[1], inter.handle, handlePt);
            state.applyShapes({ [entry[0]]: resized });
            const b = shapeBounds(resized);
            setReadout(formatSize(b.width, b.height));
          }
        } else {
          const to = resizeBounds(inter.from, inter.handle, handlePt);
          const next: Record<string, Shape> = {};
          for (const [id, orig] of Object.entries(inter.originals)) {
            next[id] = resizeShapeToBounds(orig, inter.from, to);
          }
          state.applyShapes(next);
          setReadout(formatSize(to.width, to.height));
        }
        break;
      }
      case "rotate": {
        let delta =
          Math.atan2(world.y - inter.pivot.y, world.x - inter.pivot.x) -
          inter.startAngle;
        if (e.shiftKey) {
          delta = snapAngle(delta, 15);
        } else {
          // Ease the resulting angle onto 0/45/90… when close enough.
          const eased = magnetAngle(inter.startRotation + delta, 45, 4);
          if (eased !== null) delta = eased - inter.startRotation;
        }
        const next: Record<string, Shape> = {};
        for (const [id, orig] of Object.entries(inter.originals)) {
          const c = shapeCenter(orig);
          const nc = rotateAbout(inter.pivot, c, delta);
          const moved = translateShape(orig, nc.x - c.x, nc.y - c.y);
          next[id] = { ...moved, rotation: (orig.rotation || 0) + delta };
        }
        state.applyShapes(next);
        setReadout(formatAngle(inter.startRotation + delta));
        break;
      }
      case "create": {
        const shape = makeCreatedShape(
          state.tool,
          inter.start,
          pointSnap(world, EMPTY_EXCLUDE),
          state.style,
          e.shiftKey,
          e.altKey
        );
        previewRef.current = shape;
        if (shape.type === "line") {
          const len = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
          const ang = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
          setReadout(`L ${Math.round(len)} · ${formatAngle(ang)}`);
        } else if (shape.type === "rect" || shape.type === "ellipse") {
          setReadout(formatSize(shape.width, shape.height));
        }
        scheduleDraw();
        break;
      }
      case "pencil": {
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
      case "pen-anchor": {
        const draft = penDraftRef.current;
        if (draft) {
          const a = draft.anchors[inter.index];
          a.hOut = world;
          a.hIn = { x: 2 * a.p.x - world.x, y: 2 * a.p.y - world.y };
          scheduleDraw();
        }
        break;
      }
      case "node-anchor": {
        const snapped = pointSnap(world, new Set([inter.shapeId]));
        state.applyShapes({
          [inter.shapeId]: moveAnchor(inter.orig, inter.index, snapped),
        });
        break;
      }
      case "node-handle":
        state.applyShapes({
          [inter.shapeId]: moveHandle(
            inter.orig,
            inter.index,
            inter.part,
            world,
            !e.altKey
          ),
        });
        break;
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
    guidesRef.current = [];
    spacingsRef.current = [];
    setReadout(null);

    switch (inter.kind) {
      case "move":
      case "resize":
      case "rotate":
      case "node-anchor":
      case "node-handle":
        state.endInteraction();
        scheduleDraw();
        break;
      case "create": {
        const shape = previewRef.current;
        previewRef.current = null;
        if (shape && isShapeSubstantial(shape)) state.addShape(shape);
        scheduleDraw();
        break;
      }
      case "pencil": {
        const shape = previewRef.current;
        previewRef.current = null;
        if (shape && shape.type === "path" && shape.points.length >= 2) {
          state.addShape(freehandToBezier(shape.points, state));
        }
        scheduleDraw();
        break;
      }
      case "pen-anchor":
        // Keep the draft alive for the next click; the curve preview persists.
        break;
      case "marquee": {
        const end = screenToWorld(state.viewport, screenPoint(e));
        const region = boundsFromPoints(inter.start, end);
        const hits = state.doc.order.filter((id) => {
          const s = state.doc.shapes[id];
          return (
            s &&
            !s.hidden &&
            !s.locked &&
            boundsIntersect(worldShapeBounds(s), region)
          );
        });
        const base = inter.additive ? state.selection : [];
        state.setSelection(
          expandToGroups(state.doc, [...new Set([...base, ...hits])])
        );
        marqueeRef.current = null;
        scheduleDraw();
        break;
      }
    }
  };

  const onDoubleClick = () => {
    if (useEditor.getState().tool === "pen" && penDraftRef.current) {
      commitPenDraft();
    }
  };

  const updateHoverCursor = (screen: Vec2, world: Vec2) => {
    const canvas = canvasRef.current!;
    const state = useEditor.getState();
    if (spaceRef.current) {
      canvas.style.cursor = "grab";
      return;
    }
    if (state.tool === "pen" || state.tool === "pencil") {
      canvas.style.cursor = "crosshair";
      return;
    }
    if (state.tool === "node") {
      const sel = selectedBezier(state);
      canvas.style.cursor =
        sel && hitBezierNodes(sel, screen, state.viewport, NODE_GRAB * hitScale())
          ? "move"
          : "default";
      return;
    }
    const hit = hitFrameHandle(screen);
    if (hit?.type === "rotate") {
      canvas.style.cursor = "grab";
      return;
    }
    if (hit?.type === "resize") {
      const frame = selectionFrame();
      canvas.style.cursor = handleCursorRotated(hit.id, frame?.rotation ?? 0);
      return;
    }
    canvas.style.cursor = pickShape(world) ? "move" : "default";
  };

  // ---- coarse-pointer (touch) detection ----------------------------------
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(pointer: coarse)");
    const update = () => {
      coarseRef.current = mq.matches;
      scheduleDraw();
    };
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [scheduleDraw]);

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
        state.setViewport(zoomAt(state.viewport, anchor, Math.exp(-e.deltaY * 0.01)));
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

  // ---- keyboard: space-to-pan, pen finish/cancel ------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        spaceRef.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = "grab";
        return;
      }
      if (penDraftRef.current) {
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === "Enter") {
          e.preventDefault();
          commitPenDraft();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelPenDraft();
        } else if (
          (mod && !e.shiftKey && e.key.toLowerCase() === "z") ||
          e.key === "Backspace" ||
          e.key === "Delete"
        ) {
          // Step back one anchor instead of running the document-level undo.
          e.preventDefault();
          e.stopImmediatePropagation();
          undoPenAnchor();
        }
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
  }, [commitPenDraft, cancelPenDraft, undoPenAnchor]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setPointer(null)}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}

// ===========================================================================
// helpers
// ===========================================================================

/** Status-bar readout for a size, e.g. "120 × 80". */
function formatSize(width: number, height: number): string {
  return `${Math.round(Math.abs(width))} × ${Math.round(Math.abs(height))}`;
}

/** Status-bar readout for an angle in radians, normalized to (-180°, 180°]. */
function formatAngle(rad: number): string {
  let deg = (rad * 180) / Math.PI;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (deg === -180) deg = 180;
  return `${Math.round(deg * 10) / 10}°`;
}

/** Snap point b onto the nearest 45° ray from a (for Shift-constrained lines). */
function constrain45(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return b;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

function makeCreatedShape(
  tool: string,
  a: Vec2,
  bRaw: Vec2,
  style: { fill: string | null; stroke: string | null; strokeWidth: number },
  shift = false,
  alt = false
): Shape {
  const base = { ...styleFromDefaults(style) };

  if (tool === "line") {
    const b = shift ? constrain45(a, bRaw) : bRaw;
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

  // rect / ellipse — Shift = square/circle, Alt = grow from center.
  let dx = bRaw.x - a.x;
  let dy = bRaw.y - a.y;
  if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * m;
    dy = (dy < 0 ? -1 : 1) * m;
  }
  const p1 = alt ? { x: a.x - dx, y: a.y - dy } : a;
  const p2 = { x: a.x + dx, y: a.y + dy };
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);

  return {
    id: makeId(tool),
    name: tool === "rect" ? "Rectangle" : "Ellipse",
    type: tool === "rect" ? "rect" : "ellipse",
    x,
    y,
    width,
    height,
    ...base,
  };
}

/**
 * Convert a freehand polyline into a smooth, editable Bézier shape. Closes the
 * path when the stroke ends near where it began.
 */
function freehandToBezier(rawPoints: Vec2[], state: EditorState): BezierShape {
  let pts = rawPoints;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closeTol = 10 / state.viewport.scale;
  let closed = false;
  if (
    pts.length > 3 &&
    Math.hypot(last.x - first.x, last.y - first.y) <= closeTol
  ) {
    closed = true;
    pts = pts.slice(0, -1);
  }
  const simplified = simplifyPath(pts, 2 / state.viewport.scale);
  const anchors = pointsToAnchors(simplified.length >= 2 ? simplified : pts, closed);
  return {
    id: makeId("bezier"),
    name: "Pencil",
    type: "bezier",
    anchors,
    closed,
    ...styleFromDefaults(state.style),
    fill: null,
  };
}

function isShapeSubstantial(shape: Shape): boolean {
  if (shape.type === "line") {
    return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) > CLICK_SLOP;
  }
  if (shape.type === "rect" || shape.type === "ellipse") {
    return (
      Math.abs(shape.width) > CLICK_SLOP || Math.abs(shape.height) > CLICK_SLOP
    );
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
