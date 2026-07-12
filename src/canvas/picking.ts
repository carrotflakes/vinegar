import { exactlySelectedGroup } from "../model/groups";
import { hitTestNode } from "../model/hitTest";
import {
  descendantNodeIds,
  isInstance,
  isNodeHidden,
  isNodeLocked,
  isShape,
  scopeLeafIds,
  selectionRoots,
  shapesInPaintOrder,
} from "../model/scene";
import { collectSnapTargets, snapPoint } from "../model/snap";
import type { BezierShape, Shape, Vec2 } from "../model/types";
import { worldToScreen } from "../model/viewport";
import { currentSymbolScope, useEditor, type EditorState } from "../store/editorStore";
import {
  frameHandlePoint,
  frameRotationPoint,
  getSelectionFrame,
  type SelectionFrame,
  type SelectionLeaf,
} from "./frame";
import { HANDLE_IDS, HANDLE_SIZE } from "./handles";
import type { FrameHit, ToolContext } from "./interaction";

export function selectedBezier(state: EditorState): BezierShape | null {
  if (state.selection.length !== 1) return null;
  const s = state.doc.nodes[state.selection[0]];
  return s && s.type === "bezier" ? s : null;
}

const isLeaf = (node: EditorState["doc"]["nodes"][string] | undefined): node is SelectionLeaf =>
  isShape(node) || isInstance(node);

/** Paintable leaves (shapes and instances) covered by the selection. */
export function selectedShapes(
  doc: EditorState["doc"],
  selection: string[]
): SelectionLeaf[] {
  return selectionRoots(doc, selection)
    .flatMap((id) => (isLeaf(doc.nodes[id]) ? [id] : descendantNodeIds(doc, id)))
    .map((id) => doc.nodes[id])
    .filter(isLeaf);
}

export const EMPTY_EXCLUDE = new Set<string>();

export const pickTolerance = (ctx: ToolContext) =>
  (5 * ctx.hitScale()) / useEditor.getState().viewport.scale;

export function selectionFrame(): SelectionFrame | null {
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
}

/** Hit-test the resize handles and rotation handle of the selection frame. */
export function hitFrameHandle(ctx: ToolContext, screen: Vec2): FrameHit {
  const { viewport } = useEditor.getState();
  const frame = selectionFrame();
  if (!frame) return null;
  const tol = HANDLE_SIZE * ctx.hitScale();
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
}

export function pickShape(ctx: ToolContext, world: Vec2): string | null {
  const state = useEditor.getState();
  const { doc } = state;
  const tol = pickTolerance(ctx);
  const ids = scopeLeafIds(doc, currentSymbolScope(state));
  for (let i = ids.length - 1; i >= 0; i--) {
    const node = doc.nodes[ids[i]];
    if (
      isLeaf(node) &&
      !isNodeHidden(doc, node.id) &&
      !isNodeLocked(doc, node.id) &&
      hitTestNode(doc, node, world, tol)
    )
      return ids[i];
  }
  return null;
}

/**
 * Snap a single world point to alignment lines / grid (for creation, resize
 * and vertex editing). Updates the on-screen guides and returns the point.
 */
export function pointSnap(
  ctx: ToolContext,
  world: Vec2,
  exclude: Set<string>
): Vec2 {
  const state = useEditor.getState();
  ctx.spacings.current = [];
  if (!state.snapEnabled && !state.gridSnap) {
    ctx.guides.current = [];
    return world;
  }
  const others = shapesInPaintOrder(state.doc, currentSymbolScope(state))
    .filter(
      (s): s is Shape =>
        !!s && !isNodeHidden(state.doc, s.id) && !exclude.has(s.id)
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
  ctx.guides.current = res.guides;
  return res.point;
}
