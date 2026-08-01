import { exactlySelectedGroup } from "../model/groups";
import {
  clippingMask,
  isNodeVisibleForHitTesting,
} from "../model/clippingMask";
import { hitTestNode } from "@/model/geometry/hitTest";
import {
  descendantNodeIds,
  isGroup,
  isInstance,
  isNodeHidden,
  isNodeLocked,
  isShape,
  scopeLeafIds,
  sceneIndex,
  selectionRoots,
  shapesInPaintOrder,
} from "../model/scene";
import { framesInPaintOrder } from "../model/scene";
import { invertMatrix, nodeWorldMatrix, applyMatrix } from "@/model/geometry/matrix";
import {
  collectSnapTargets,
  snapPoint,
  type SnapTargets,
} from "@/model/geometry/snap";
import { activeGuideLines } from "./guides";
import type { Document, Shape, Vec2 } from "../model/types";
import { worldToScreen } from "@/model/geometry/viewport";
import { currentFocusRoot, useEditor, type EditorState } from "../store/editorStore";
import {
  frameHandlePoint,
  frameNodeSelectionFrame,
  frameRotationPoint,
  getSelectionFrame,
  singleSelectedFrame,
  type SelectionFrame,
  type SelectionLeaf,
} from "./frame";
import { HANDLE_IDS, HANDLE_SIZE } from "./handles";
import {
  cornerRadiusControl,
  CORNER_RADIUS_HANDLE_SIZE,
} from "./cornerRadiusHandle";
import type { FrameHit, ToolContext } from "./interaction";
import type { NodeEditShape } from "./nodes";

/** The single selected shape the node tool can edit (path or brush). */
export function selectedNodeShapes(state: EditorState): NodeEditShape[] {
  if (state.selection.length !== 1) return [];
  const selected = state.doc.nodes[state.selection[0]];
  if (selected?.type === "path" || selected?.type === "brush") return [selected];
  if (selected?.type !== "compoundPath") return [];
  return selected.childIds.flatMap((id) => {
    const child = state.doc.nodes[id];
    return child?.type === "path" && !child.hidden ? [child] : [];
  });
}

export function selectedNodeShape(state: EditorState): NodeEditShape | null {
  const shapes = selectedNodeShapes(state);
  const activeId = state.editNodes[state.editNodes.length - 1]?.shapeId;
  return shapes.find((shape) => shape.id === activeId) ?? shapes[0] ?? null;
}

const isLeaf = (node: EditorState["doc"]["nodes"][string] | undefined): node is SelectionLeaf =>
  isShape(node) || isInstance(node);

/** Paintable leaves (shapes and instances) covered by the selection. */
export function selectedShapes(
  doc: EditorState["doc"],
  selection: string[]
): SelectionLeaf[] {
  const paintable = new Set(sceneIndex(doc).shapeIds);
  return selectionRoots(doc, selection)
    .flatMap((id) => {
      const node = doc.nodes[id];
      if (isLeaf(node)) return [id];
      if (isGroup(node) && node.clipsToMask) {
        const mask = clippingMask(doc, node);
        return mask ? [mask.id] : [];
      }
      return descendantNodeIds(doc, id).filter((childId) => paintable.has(childId));
    })
    .map((id) => doc.nodes[id])
    .filter(isLeaf);
}

export const EMPTY_EXCLUDE = new Set<string>();

export const pickTolerance = (ctx: ToolContext) =>
  (5 * ctx.hitScale()) / useEditor.getState().viewport.scale;

export const isVisibleForPicking = isNodeVisibleForHitTesting;

export function selectionFrame(): SelectionFrame | null {
  const { doc, selection, selectionPivot, selectionTransform } =
    useEditor.getState();
  const soleFrame = singleSelectedFrame(doc, selection);
  if (soleFrame) return frameNodeSelectionFrame(doc, soleFrame);
  const shapes = selectedShapes(doc, selection);
  return getSelectionFrame(
    doc,
    shapes,
    exactlySelectedGroup(doc, selection),
    selectionPivot,
    selectionTransform
  );
}

/**
 * The topmost frame whose content-box outline (within `tol` world units) the
 * point lands on, front-to-back. Interior points miss so shape picking / marquee
 * still work inside a frame. Frames are top-level and axis-aligned in practice,
 * so the test runs in frame-local space.
 *
 * Hidden and locked frames are unpickable, like any other node — select them
 * from the Layers panel instead.
 */
export function pickFrameBorder(
  doc: Document,
  world: Vec2,
  tol: number
): string | null {
  const frames = framesInPaintOrder(doc);
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (frame.hidden || frame.locked) continue;
    const inverse = invertMatrix(nodeWorldMatrix(doc, frame.id));
    if (!inverse) continue;
    const p = applyMatrix(inverse, world);
    const inOuter =
      p.x >= -tol && p.x <= frame.width + tol &&
      p.y >= -tol && p.y <= frame.height + tol;
    const inInner =
      p.x >= tol && p.x <= frame.width - tol &&
      p.y >= tol && p.y <= frame.height - tol;
    if (inOuter && !inInner) return frame.id;
  }
  return null;
}

/** Hit-test the resize handles and rotation handle of the selection frame. */
export function hitFrameHandle(ctx: ToolContext, screen: Vec2): FrameHit {
  const { doc, selection, viewport } = useEditor.getState();
  const frame = selectionFrame();
  if (!frame) return null;
  // Frames are never rotated and have no corner-radius/pivot editing, so only
  // their resize handles are hit-testable.
  const isFrameSelection = singleSelectedFrame(doc, selection) !== null;
  const radiusControl = isFrameSelection
    ? null
    : cornerRadiusControl(doc, selection, viewport, ctx.hitScale());
  if (
    radiusControl &&
    Math.hypot(
      radiusControl.point.x - screen.x,
      radiusControl.point.y - screen.y
    ) <= CORNER_RADIUS_HANDLE_SIZE * ctx.hitScale()
  ) {
    return { type: "corner-radius", control: radiusControl };
  }
  const tol = HANDLE_SIZE * ctx.hitScale();
  if (!isFrameSelection) {
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
  }
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
  const scope = currentFocusRoot(state);
  let ids = scopeLeafIds(doc, scope);
  // Once the user has drilled into a clipping group, prefer its visible
  // content over the otherwise-frontmost mask. The mask remains the fallback
  // hit for empty parts of its silhouette and stays frontmost outside edit mode.
  const active = state.activeGroupId ? doc.nodes[state.activeGroupId] : null;
  const activeMask = active?.type === "group" ? clippingMask(doc, active) : null;
  if (activeMask && ids.includes(activeMask.id)) {
    ids = [activeMask.id, ...ids.filter((id) => id !== activeMask.id)];
  }
  for (let i = ids.length - 1; i >= 0; i--) {
    const node = doc.nodes[ids[i]];
    if (
      isLeaf(node) &&
      isVisibleForPicking(doc, node.id) &&
      !isNodeLocked(doc, node.id) &&
      hitTestNode(doc, node, world, tol, scope ?? undefined)
    )
      return ids[i];
  }
  return null;
}

/**
 * The frontmost leaf under `world` *only when it is locked* (else null). A
 * non-locked shape on top short-circuits to null so normal picking wins. The
 * Select tool uses this to let an already-selected locked shape be dragged to
 * move it (it gates the result on selection membership; lock blocks selecting,
 * not moving what's already selected).
 */
export function pickLockedShape(ctx: ToolContext, world: Vec2): string | null {
  const state = useEditor.getState();
  const { doc } = state;
  const tol = pickTolerance(ctx);
  const scope = currentFocusRoot(state);
  const ids = scopeLeafIds(doc, scope);
  for (let i = ids.length - 1; i >= 0; i--) {
    const node = doc.nodes[ids[i]];
    if (
      isLeaf(node) &&
      isVisibleForPicking(doc, node.id) &&
      hitTestNode(doc, node, world, tol, scope ?? undefined)
    ) {
      return isNodeLocked(doc, node.id) ? ids[i] : null;
    }
  }
  return null;
}

/**
 * Snap a single world point to alignment lines / grid (for creation, resize
 * and vertex editing). Updates the on-screen guides and returns the point.
 */
/** Screen-pixel radius within which a point snaps. */
const SNAP_PX = 6;

/**
 * Snap a point to *deliberate* references only — the user's guides and the
 * grid — skipping the document's own shapes. The shape targets are bounding-box
 * lines, which is right for placing a rectangle but noise for a freehand stroke
 * that merely starts near existing art; and skipping them also skips collecting
 * every shape's world bounds, which would land on pointer-down latency.
 */
export function guideGridSnap(ctx: ToolContext, world: Vec2): Vec2 {
  const state = useEditor.getState();
  ctx.spacings.current = [];
  const guideLines = activeGuideLines(state);
  if (!state.gridSnap && !guideLines.x.length && !guideLines.y.length) {
    ctx.guides.current = [];
    return world;
  }
  const res = snapPoint(
    world,
    {
      targets: { x: [], y: [] },
      gridSize: state.gridSnap ? state.gridSize : null,
      guideLines,
    },
    SNAP_PX / state.viewport.scale
  );
  ctx.guides.current = res.guides;
  return res.point;
}

export function pointSnap(
  ctx: ToolContext,
  world: Vec2,
  exclude: Set<string>,
  /** Extra snap lines that are not shapes in the document — the pen's own
   *  in-progress anchors, for instance. Honoured only when object snapping is
   *  on, like the document's own targets. */
  extra?: SnapTargets
): Vec2 {
  const state = useEditor.getState();
  ctx.spacings.current = [];
  const guideLines = activeGuideLines(state);
  const hasGuides = guideLines.x.length > 0 || guideLines.y.length > 0;
  if (!state.snapEnabled && !state.gridSnap && !hasGuides) {
    ctx.guides.current = [];
    return world;
  }
  const others = shapesInPaintOrder(state.doc, currentFocusRoot(state))
    .filter(
      (s): s is Shape =>
        !!s && !isNodeHidden(state.doc, s.id) && !exclude.has(s.id)
    );
  const docTargets = state.snapEnabled
    ? collectSnapTargets(state.doc, others)
    : { x: [], y: [] };
  const res = snapPoint(
    world,
    {
      targets:
        extra && state.snapEnabled
          ? {
              x: [...docTargets.x, ...extra.x],
              y: [...docTargets.y, ...extra.y],
            }
          : docTargets,
      gridSize: state.gridSnap ? state.gridSize : null,
      guideLines,
    },
    SNAP_PX / state.viewport.scale
  );
  ctx.guides.current = res.guides;
  return res.point;
}
