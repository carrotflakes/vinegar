import { useCallback, useEffect, useRef } from "react";
import {
  unionNodeWorldBounds,
  worldShapeBounds,
} from "../model/bounds";
import {
  closestPointOnBezier,
  insertAnchorOnSegment,
  reverseBezier,
} from "../model/bezier";
import { pointsToAnchors, simplifyPath } from "../model/freehand";
import { exactlySelectedGroup, expandToGroups, isShapeHidden, isShapeLocked } from "../model/groups";
import { hitTestShape, marqueeHitShape } from "../model/hitTest";
import { magnetAngle, snapAngle } from "../model/rotate";
import {
  applyMatrix,
  applyWorldTransformToNode,
  boundsTransform,
  nodeWorldMatrix,
  invertMatrix,
  matrixScale,
  multiply,
  rotationAbout as matrixRotationAbout,
  shapeWorldMatrix,
  translation as translationMatrix,
} from "../model/matrix";
import {
  collectSnapTargets,
  computeSnap,
  snapPoint,
  type Guide,
  type SnapTargets,
  type Spacing,
} from "../model/snap";
import {
  makeId,
  type BezierShape,
  type Bounds,
  type Matrix,
  type SceneNode,
  type Shape,
  type Vec2,
} from "../model/types";
import { screenToWorld, worldToScreen, zoomAt } from "../model/viewport";
import {
  styleFromDefaults,
  useEditor,
  type EditorState,
} from "../store/editorStore";
import { descendantShapeIds, isGroup, isShape, sceneIndex, selectionRoots, shapesInPaintOrder } from "../model/scene";
import { openContextMenu } from "../store/menuStore";
import { setPointer, setReadout } from "../store/pointerStore";
import { canvasMenu, selectionMenu } from "../ui/menus";
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
import { renderScene } from "./render";

type FrameHit =
  | { type: "pivot" }
  | { type: "resize"; id: HandleId }
  | { type: "rotate" }
  | null;

type Interaction =
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
  | { kind: "create"; start: Vec2 }
  | { kind: "pencil" }
  | { kind: "pen-anchor"; index: number }
  | {
      kind: "node-anchor";
      shapeId: string;
      sub: number;
      index: number;
      orig: BezierShape;
    }
  | {
      kind: "node-handle";
      shapeId: string;
      sub: number;
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
  const s = state.doc.nodes[state.selection[0]];
  return s && s.type === "bezier" ? s : null;
}

/** The single subpath a pen draft works on. */
function draftSubpath(draft: BezierShape) {
  return draft.subpaths[0];
}

function selectedShapes(doc: EditorState["doc"], selection: string[]): Shape[] {
  return selectionRoots(doc, selection)
    .flatMap((id) => isShape(doc.nodes[id]) ? [id] : descendantShapeIds(doc, id))
    .map((id) => doc.nodes[id])
    .filter(isShape);
}

export default function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const interactionRef = useRef<Interaction>({ kind: "none" });
  const previewRef = useRef<Shape | null>(null);
  const marqueeRef = useRef<Bounds | null>(null);
  const penDraftRef = useRef<BezierShape | null>(null);
  /** When the pen picked up an existing open path, its pre-edit original. */
  const penExtendRef = useRef<BezierShape | null>(null);
  /** Last segment-click insertion, so a double-click doesn't also toggle it. */
  const lastInsertRef = useRef<{
    shapeId: string;
    sub: number;
    index: number;
    time: number;
  } | null>(null);
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
    const selected = selectedShapes(doc, selection);
    drawOverlay(ctx, {
      dpr,
      viewport,
      frame:
        tool === "select"
          ? getSelectionFrame(
              doc,
              selected,
              exactlySelectedGroup(doc, selection),
              state.selectionPivot,
              state.selectionTransform
            )
          : null,
      marquee: marqueeRef.current,
      showHandles: tool === "select" && selected.length > 0,
      handleSize: HANDLE_SIZE * chrome,
    });

    if (tool === "node") {
      const sel = selectedBezier(state);
      if (sel) {
        const active =
          state.editNode && state.editNode.shapeId === sel.id
            ? { sub: state.editNode.sub, index: state.editNode.index }
            : null;
        drawNodes(
          ctx,
          dpr,
          viewport,
          sel,
          shapeWorldMatrix(doc, sel),
          active,
          ANCHOR_SIZE * chrome,
          HANDLE_DOT * chrome
        );
      }
    }
    if (tool === "pen" && penDraftRef.current) {
      drawPenDraft(
        ctx,
        dpr,
        viewport,
        penDraftRef.current,
        shapeWorldMatrix(doc, penDraftRef.current),
        hoverRef.current
      );
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
    const extended = penExtendRef.current;
    penDraftRef.current = null;
    penExtendRef.current = null;
    previewRef.current = null;
    hoverRef.current = null;
    if (draft) {
      const anchors = draftSubpath(draft).anchors;
      // Drop a near-duplicate final anchor (left over from a double-click).
      if (anchors.length >= 2) {
        const a = anchors[anchors.length - 1].p;
        const b = anchors[anchors.length - 2].p;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) anchors.pop();
      }
      if (anchors.length >= 2) {
        const state = useEditor.getState();
        if (extended && isShape(state.doc.nodes[draft.id])) {
          // Skip the no-op case (picked an endpoint up but changed nothing).
          if (JSON.stringify(draft) !== JSON.stringify(extended)) {
            state.updateShape(draft);
          }
        } else {
          state.addShape(draft);
        }
      }
    }
    scheduleDraw();
  }, [scheduleDraw]);

  const cancelPenDraft = useCallback(() => {
    penDraftRef.current = null;
    penExtendRef.current = null;
    previewRef.current = null;
    hoverRef.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  // Soft undo: drop the last-placed anchor without discarding the whole draft.
  const undoPenAnchor = useCallback(() => {
    const draft = penDraftRef.current;
    if (!draft) return;
    const anchors = draftSubpath(draft).anchors;
    anchors.pop();
    if (anchors.length === 0) {
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
    const { doc, selection, selectionPivot, selectionTransform } =
      useEditor.getState();
    const shapes = selectedShapes(doc, selection);
    return getSelectionFrame(
      doc,
      shapes,
      exactlySelectedGroup(doc, selection),
      selectionPivot,
      selectionTransform
    );
  };

  /** Hit-test the resize handles and rotation handle of the selection frame. */
  const hitFrameHandle = (screen: Vec2): FrameHit => {
    const { viewport } = useEditor.getState();
    const frame = selectionFrame();
    if (!frame) return null;
    const tol = HANDLE_SIZE * hitScale();
    const pivot = worldToScreen(viewport, frame.pivot);
    if (
      Math.abs(pivot.x - screen.x) <= tol &&
      Math.abs(pivot.y - screen.y) <= tol
    ) {
      return { type: "pivot" };
    }
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
    const ids = sceneIndex(doc).shapeIds;
    for (let i = ids.length - 1; i >= 0; i--) {
      const shape = doc.nodes[ids[i]];
      if (
        isShape(shape) &&
        !isShapeHidden(doc, shape) &&
        !isShapeLocked(doc, shape) &&
        hitTestShape(doc, shape, world, tol)
      )
        return ids[i];
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
    const others = shapesInPaintOrder(state.doc)
      .filter(
        (s): s is Shape =>
          !!s && !isShapeHidden(state.doc, s) && !exclude.has(s.id)
      );
    const res = snapPoint(
      world,
      {
        targets: state.snapEnabled
          ? collectSnapTargets(state.doc, others)
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
    // Right button is reserved for the context menu (see onContextMenu).
    if (e.button === 2) return;
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
      onPenDown(state, screen, world, e.shiftKey);
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

  const snapshot = (ids: string[]): Record<string, SceneNode> => {
    const { doc } = useEditor.getState();
    const out: Record<string, SceneNode> = {};
    for (const id of selectionRoots(doc, ids)) if (doc.nodes[id]) out[id] = doc.nodes[id];
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
    if (hit?.type === "pivot") {
      const group = exactlySelectedGroup(state.doc, state.selection);
      const shape =
        !group && state.selection.length === 1
          ? state.doc.nodes[state.selection[0]]
          : null;
      const persistent = !!group || !!shape;
      if (persistent) state.beginInteraction();
      interactionRef.current = {
        kind: "pivot",
        groupId: group?.id,
        shapeId: shape?.id,
        persistent,
      };
      return;
    }
    if (hit?.type === "rotate") {
      const frame = selectionFrame()!;
      const group = exactlySelectedGroup(state.doc, state.selection);
      const transient = !group && state.selection.length > 1;
      if (transient && !state.selectionPivot) {
        state.setSelectionPivot(frame.pivot);
      }
      state.beginInteraction();
      interactionRef.current = {
        kind: "rotate",
        pivot: frame.pivot,
        startAngle: Math.atan2(world.y - frame.pivot.y, world.x - frame.pivot.x),
        startRotation: frame.rotation,
        originals: snapshot(state.selection),
        selectionPivot: transient
          ? state.selectionPivot ?? frame.pivot
          : undefined,
        selectionTransform: transient ? frame.transform : undefined,
      };
      return;
    }
    if (hit?.type === "resize") {
      const frame = selectionFrame()!;
      const group = exactlySelectedGroup(state.doc, state.selection);
      const transient = !group && state.selection.length > 1;
      state.beginInteraction();
      interactionRef.current = {
        kind: "resize",
        handle: hit.id,
        from: frame.bounds,
        frameTransform: frame.transform,
        originals: snapshot(state.selection),
        single: state.selection.length === 1,
        selectionPivot: transient ? state.selectionPivot ?? undefined : undefined,
        selectionTransform: transient ? frame.transform : undefined,
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
      } else if (!expandToGroups(state.doc, [hitId]).some((id) => state.selection.includes(id))) {
        selection = expandToGroups(state.doc, [hitId]);
        state.setSelection(selection);
      } else {
        selection = state.selection;
      }
      const originals = snapshot(selection);
      const selectedGroup = exactlySelectedGroup(state.doc, selection);
      const transient = !selectedGroup && selection.length > 1;
      const selectedLeafIds = new Set(selectionRoots(state.doc, selection).flatMap((id) => descendantShapeIds(state.doc, id)));
      const others = shapesInPaintOrder(state.doc)
        .filter(
          (s): s is Shape =>
            !selectedLeafIds.has(s.id) && !isShapeHidden(state.doc, s)
        );
      state.beginInteraction();
      interactionRef.current = {
        kind: "move",
        start: world,
        originals,
        origUnion: unionNodeWorldBounds(state.doc, Object.keys(originals)) ?? {
          x: world.x,
          y: world.y,
          width: 0,
          height: 0,
        },
        targets: collectSnapTargets(state.doc, others),
        boxes: others.map((shape) => worldShapeBounds(state.doc, shape)),
        selectionPivot: transient ? state.selectionPivot ?? undefined : undefined,
        selectionTransform: transient
          ? state.selectionTransform ?? undefined
          : undefined,
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
        shapeWorldMatrix(state.doc, sel),
        screen,
        state.viewport,
        NODE_GRAB * hitScale()
      );
      if (hit) {
        state.setEditNode({ shapeId: sel.id, sub: hit.sub, index: hit.index });
        state.beginInteraction();
        interactionRef.current =
          hit.part === "anchor"
            ? {
                kind: "node-anchor",
                shapeId: sel.id,
                sub: hit.sub,
                index: hit.index,
                orig: sel,
              }
            : {
                kind: "node-handle",
                shapeId: sel.id,
                sub: hit.sub,
                index: hit.index,
                part: hit.part,
                orig: sel,
              };
        return;
      }
      // Clicking the path itself (not a node) inserts an anchor there and
      // starts dragging it, all as one undo step.
      const inverse = invertMatrix(shapeWorldMatrix(state.doc, sel));
      const local = inverse ? applyMatrix(inverse, world) : world;
      const loc = closestPointOnBezier(sel, local);
      const localScale = matrixScale(shapeWorldMatrix(state.doc, sel));
      if (loc && loc.distance * localScale <= pickTolerance()) {
        const next = insertAnchorOnSegment(sel, loc.sub, loc.segIndex, loc.t);
        if (next !== sel) {
          const index = loc.segIndex + 1;
          state.beginInteraction();
          state.applyShapes({ [sel.id]: next });
          state.setEditNode({ shapeId: sel.id, sub: loc.sub, index });
          lastInsertRef.current = {
            shapeId: sel.id,
            sub: loc.sub,
            index,
            time: Date.now(),
          };
          interactionRef.current = {
            kind: "node-anchor",
            shapeId: sel.id,
            sub: loc.sub,
            index,
            orig: next,
          };
        }
        return;
      }
    }
    // Select another Bézier shape, or clear.
    const id = pickShape(world);
    if (id && state.doc.nodes[id]?.type === "bezier") {
      state.setSelection([id]);
      state.setEditNode(null);
    } else {
      state.clearSelection();
    }
  };

  /** Find the topmost open Bézier path with an endpoint under `screen`. */
  const pickOpenEndpoint = (
    state: EditorState,
    screen: Vec2
  ): { shape: BezierShape; end: "start" | "end" } | null => {
    const tol = NODE_GRAB * hitScale();
    const { doc, viewport } = state;
    const near = (shape: Shape, w: Vec2) => {
      const sp = worldToScreen(
        viewport,
        shape ? applyMatrix(shapeWorldMatrix(doc, shape), w) : w
      );
      return Math.hypot(sp.x - screen.x, sp.y - screen.y) <= tol;
    };
    const ids = sceneIndex(doc).shapeIds;
    for (let i = ids.length - 1; i >= 0; i--) {
      const s = doc.nodes[ids[i]];
      if (
        !isShape(s) ||
        s.type !== "bezier" ||
        // Only single-subpath open curves can be picked up and continued.
        s.subpaths.length !== 1 ||
        s.subpaths[0].closed ||
        isShapeHidden(doc, s) ||
        isShapeLocked(doc, s) ||
        s.subpaths[0].anchors.length < 2
      )
        continue;
      const anchors = s.subpaths[0].anchors;
      if (near(s, anchors[anchors.length - 1].p)) {
        return { shape: s, end: "end" };
      }
      if (near(s, anchors[0].p)) return { shape: s, end: "start" };
    }
    return null;
  };

  const onPenDown = (
    state: EditorState,
    screen: Vec2,
    world: Vec2,
    shift: boolean
  ) => {
    const draft = penDraftRef.current;
    const draftInverse = draft
      ? invertMatrix(shapeWorldMatrix(state.doc, draft))
      : null;
    const localWorld = draftInverse ? applyMatrix(draftInverse, world) : world;
    const draftAnchors = draft ? draftSubpath(draft).anchors : null;
    const last = draftAnchors?.[draftAnchors.length - 1];
    if (shift && last) {
      world = constrain45(last.p, localWorld);
      guidesRef.current = [];
    } else {
      const snapped = pointSnap(world, EMPTY_EXCLUDE);
      world = draftInverse ? applyMatrix(draftInverse, snapped) : snapped;
    }
    if (!draft) {
      // Clicking an endpoint of an existing open path picks it up and
      // continues it; the commit then replaces the original shape.
      const pick = pickOpenEndpoint(state, screen);
      if (pick) {
        const baseline =
          pick.end === "start" ? reverseBezier(pick.shape) : pick.shape;
        penExtendRef.current = baseline;
        const shape = structuredClone(baseline);
        penDraftRef.current = shape;
        previewRef.current = shape;
        interactionRef.current = {
          kind: "pen-anchor",
          index: draftSubpath(shape).anchors.length - 1,
        };
        scheduleDraw();
        return;
      }
      const shape: BezierShape = {
        id: makeId("bezier"),
        name: "Curve",
        type: "bezier",
        subpaths: [
          { anchors: [{ p: world, hIn: null, hOut: null }], closed: false },
        ],
        ...styleFromDefaults(state.style),
      };
      penDraftRef.current = shape;
      previewRef.current = shape;
      interactionRef.current = { kind: "pen-anchor", index: 0 };
      scheduleDraw();
      return;
    }

    // Click near the first anchor closes the path.
    const sp = draftSubpath(draft);
    if (sp.anchors.length >= 2) {
      const first = worldToScreen(
        state.viewport,
        applyMatrix(shapeWorldMatrix(state.doc, draft), sp.anchors[0].p)
      );
      if (Math.hypot(first.x - screen.x, first.y - screen.y) <= NODE_GRAB) {
        sp.closed = true;
        commitPenDraft();
        return;
      }
    }

    sp.anchors.push({ p: world, hIn: null, hOut: null });
    previewRef.current = draft;
    interactionRef.current = { kind: "pen-anchor", index: sp.anchors.length - 1 };
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
        const draft = penDraftRef.current;
        const inverse = invertMatrix(shapeWorldMatrix(state.doc, draft));
        const localWorld = inverse ? applyMatrix(inverse, world) : world;
        const anchors = draftSubpath(draft).anchors;
        const last = anchors[anchors.length - 1];
        hoverRef.current =
          e.shiftKey && last
            ? constrain45(last.p, localWorld)
            : (() => {
                const snapped = pointSnap(world, EMPTY_EXCLUDE);
                return inverse ? applyMatrix(inverse, snapped) : snapped;
              })();
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
      case "pivot": {
        if (inter.groupId) {
          const group = state.doc.nodes[inter.groupId];
          const inverse = isGroup(group)
            ? invertMatrix(nodeWorldMatrix(state.doc, group.id))
            : null;
          if (isGroup(group) && inverse) {
            state.setDoc({
              ...state.doc,
              nodes: {
                ...state.doc.nodes,
                [group.id]: {
                  ...group,
                  transformOrigin: applyMatrix(inverse, world),
                },
              },
            });
          }
        } else if (inter.shapeId) {
          const shape = state.doc.nodes[inter.shapeId];
          const inverse = isShape(shape)
            ? invertMatrix(shapeWorldMatrix(state.doc, shape))
            : null;
          if (isShape(shape) && inverse) {
            state.applyShapes({
              [shape.id]: {
                ...shape,
                transformOrigin: applyMatrix(inverse, world),
              },
            });
          }
        } else {
          state.setSelectionPivot(world);
        }
        break;
      }
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
        const delta = translationMatrix(dx, dy);
        const next: Record<string, SceneNode> = {};
        for (const [id, orig] of Object.entries(inter.originals)) {
          next[id] = applyWorldTransformToNode(state.doc, orig, delta);
        }
        state.applyShapes(next);
        if (inter.selectionPivot) {
          state.setSelectionPivot(applyMatrix(delta, inter.selectionPivot));
        }
        if (inter.selectionTransform) {
          state.setSelectionTransform(
            multiply(delta, inter.selectionTransform)
          );
        }
        setReadout(`Δ ${Math.round(dx)}, ${Math.round(dy)}`);
        break;
      }
      case "resize": {
        const handlePt = pointSnap(world, new Set(Object.keys(inter.originals)));
        const inverseFrame = invertMatrix(inter.frameTransform);
        if (!inverseFrame) break;
        const localPointer = applyMatrix(inverseFrame, handlePt);
        const to = resizeBounds(inter.from, inter.handle, localPointer);
        const localDelta = boundsTransform(inter.from, to);
        const worldDelta = multiply(
          inter.frameTransform,
          multiply(localDelta, inverseFrame)
        );
        const next: Record<string, SceneNode> = {};
        for (const [id, orig] of Object.entries(inter.originals)) {
          next[id] = applyWorldTransformToNode(state.doc, orig, worldDelta);
        }
        state.applyShapes(next);
        if (inter.selectionPivot) {
          state.setSelectionPivot(
            applyMatrix(worldDelta, inter.selectionPivot)
          );
        }
        if (inter.selectionTransform) {
          state.setSelectionTransform(
            multiply(worldDelta, inter.selectionTransform)
          );
        }
        setReadout(formatSize(to.width, to.height));
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
        const rotationDelta = matrixRotationAbout(inter.pivot, delta);
        const next: Record<string, SceneNode> = {};
        for (const [id, orig] of Object.entries(inter.originals)) {
          next[id] = applyWorldTransformToNode(state.doc, orig, rotationDelta);
        }
        state.applyShapes(next);
        if (inter.selectionPivot) {
          state.setSelectionPivot(
            applyMatrix(rotationDelta, inter.selectionPivot)
          );
        }
        if (inter.selectionTransform) {
          state.setSelectionTransform(
            multiply(rotationDelta, inter.selectionTransform)
          );
        }
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
          const inverse = invertMatrix(shapeWorldMatrix(state.doc, draft));
          const localWorld = inverse ? applyMatrix(inverse, world) : world;
          const a = draftSubpath(draft).anchors[inter.index];
          const target = e.shiftKey
            ? constrain45(a.p, localWorld)
            : localWorld;
          a.hOut = target;
          a.hIn = { x: 2 * a.p.x - target.x, y: 2 * a.p.y - target.y };
          scheduleDraw();
        }
        break;
      }
      case "node-anchor": {
        const current = state.doc.nodes[inter.shapeId];
        const inverse = isShape(current)
          ? invertMatrix(shapeWorldMatrix(state.doc, current))
          : null;
        const localWorld = inverse ? applyMatrix(inverse, world) : world;
        let target: Vec2;
        if (e.shiftKey) {
          // Constrain to 45° rays from the anchor's original position.
          const origP =
            inter.orig.subpaths[inter.sub]?.anchors[inter.index]?.p ??
            localWorld;
          target = constrain45(origP, localWorld);
          guidesRef.current = [];
          spacingsRef.current = [];
        } else {
          const snapped = pointSnap(world, new Set([inter.shapeId]));
          target = inverse ? applyMatrix(inverse, snapped) : snapped;
        }
        state.applyShapes({
          [inter.shapeId]: moveAnchor(inter.orig, inter.sub, inter.index, target),
        });
        break;
      }
      case "node-handle": {
        const current = state.doc.nodes[inter.shapeId];
        const inverse = isShape(current)
          ? invertMatrix(shapeWorldMatrix(state.doc, current))
          : null;
        const localWorld = inverse ? applyMatrix(inverse, world) : world;
        state.applyShapes({
          [inter.shapeId]: moveHandle(
            inter.orig,
            inter.sub,
            inter.index,
            inter.part,
            localWorld,
            !e.altKey
          ),
        });
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
        const hits = sceneIndex(state.doc).shapeIds.filter((id) => {
          const s = state.doc.nodes[id];
          return (
            isShape(s) &&
            !isShapeHidden(state.doc, s) &&
            !isShapeLocked(state.doc, s) &&
            marqueeHitShape(state.doc, s, region)
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

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const state = useEditor.getState();
    if (
      state.tool === "select" &&
      hitFrameHandle(screenPoint(e))?.type === "pivot"
    ) {
      const group = exactlySelectedGroup(state.doc, state.selection);
      if (group) {
        state.updateGroupStyle(group.id, { transformOrigin: null });
      } else if (state.selection.length === 1) {
        state.updateSelectedStyle({ transformOrigin: null });
      } else {
        state.setSelectionPivot(null);
      }
      scheduleDraw();
      return;
    }
    if (state.tool === "pen" && penDraftRef.current) {
      commitPenDraft();
      return;
    }
    if (state.tool === "node") {
      const sel = selectedBezier(state);
      if (!sel) return;
      const hit = hitBezierNodes(
        sel,
        shapeWorldMatrix(state.doc, sel),
        screenPoint(e),
        state.viewport,
        NODE_GRAB * hitScale()
      );
      if (hit?.part !== "anchor") return;
      // The first click of this double-click may have just inserted this
      // anchor; don't immediately flip it to a corner as well.
      const ins = lastInsertRef.current;
      if (
        ins &&
        ins.shapeId === sel.id &&
        ins.sub === hit.sub &&
        ins.index === hit.index &&
        Date.now() - ins.time < 600
      )
        return;
      state.toggleNodeSmooth(sel.id, hit.sub, hit.index);
      state.setEditNode({ shapeId: sel.id, sub: hit.sub, index: hit.index });
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const state = useEditor.getState();
    const world = screenToWorld(state.viewport, screenPoint(e));
    if (state.tool === "select" || state.tool === "node") {
      const hitId = pickShape(world);
      if (hitId) {
        if (!state.selection.includes(hitId)) {
          state.setSelection(expandToGroups(state.doc, [hitId]));
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
    if (spaceRef.current) {
      canvas.style.cursor = "grab";
      return;
    }
    if (state.tool === "pen" || state.tool === "pencil") {
      // Highlight continuable endpoints of open paths.
      canvas.style.cursor =
        state.tool === "pen" &&
        !penDraftRef.current &&
        pickOpenEndpoint(state, screen)
          ? "pointer"
          : "crosshair";
      return;
    }
    if (state.tool === "node") {
      const sel = selectedBezier(state);
      if (
        sel &&
        hitBezierNodes(
          sel,
          shapeWorldMatrix(state.doc, sel),
          screen,
          state.viewport,
          NODE_GRAB * hitScale()
        )
      ) {
        canvas.style.cursor = "move";
        return;
      }
      // "copy" (arrow + plus) over the path itself: a click inserts a point.
      const inverse = sel
        ? invertMatrix(shapeWorldMatrix(state.doc, sel))
        : null;
      const loc = sel
        ? closestPointOnBezier(sel, inverse ? applyMatrix(inverse, world) : world)
        : null;
      const localScale = sel
        ? matrixScale(shapeWorldMatrix(state.doc, sel))
        : 1;
      canvas.style.cursor =
        loc && loc.distance * localScale <= pickTolerance()
          ? "copy"
          : "default";
      return;
    }
    const hit = hitFrameHandle(screen);
    if (hit?.type === "pivot") {
      canvas.style.cursor = "crosshair";
      return;
    }
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
        onContextMenu={onContextMenu}
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
    subpaths: [{ anchors, closed }],
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

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}
