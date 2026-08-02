import {
  clippingMask,
  isNodeVisibleForHitTesting,
} from "../model/clippingMask";
import { hitTestNode } from "@/model/geometry/hitTest";
import {
  isInstance,
  isNodeHidden,
  isNodeLocked,
  isShape,
  scopeLeafIds,
  shapesInPaintOrder,
} from "../model/scene";
import { framesInPaintOrder } from "../model/scene";
import { invertMatrix, nodeWorldMatrix, applyMatrix } from "@/model/geometry/matrix";
import {
  collectSnapTargets,
  snapPoint,
  type SnapTargets,
} from "@/model/geometry/snap";
import { visibleHandleKeys } from "@/model/nodeEdit";
import { nodeEditTargets } from "@/store/docOps";
import { usePreferences } from "@/store/preferencesStore";
import { activeGuideLines } from "./guides";
import type { Document, Shape, Vec2 } from "../model/types";
import { worldToScreen } from "@/model/geometry/viewport";
import { currentFocusRoot, useEditor, type EditorState } from "../store/editorStore";
import {
  frameHandlePoint,
  frameRotationPoint,
  isMixedFrameSelection,
  singleSelectedFrame,
  type SelectionFrame,
  type SelectionLeaf,
} from "./frame";
import {
  selectedSelectionLeaves,
  selectionFrameForSelection,
} from "@/model/geometry/selectionFrame";
import { HANDLE_SIZE, PARAM_KNOB_SIZE, usableHandleIds } from "./handles";
import { cornerRadiusControl } from "./cornerRadiusHandle";
import { generatorControls, pickGeneratorControl } from "./generatorHandles";
import type { FrameHit, ToolContext } from "./interaction";
import type { NodeEditShape } from "./nodes";

/** The single selected shape the node tool can edit (path or brush). */
export function selectedNodeShapes(state: EditorState): NodeEditShape[] {
  return nodeEditTargets(state.doc, state.selection);
}

/**
 * The handles of `shape` currently drawn by the node overlay, which are the
 * only ones that may be grabbed — rendering (`paint.ts`) and hit-testing must
 * agree on this. Null means all of them (the show-all preference).
 */
export function grabbableHandles(
  state: EditorState,
  shape: NodeEditShape
): ReadonlySet<string> | null {
  return visibleHandleKeys(
    shape,
    state.editNodes.filter((node) => node.shapeId === shape.id),
    usePreferences.getState().canvas.showAllHandles
  );
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
  return selectedSelectionLeaves(doc, selection);
}

export const EMPTY_EXCLUDE = new Set<string>();

export const pickTolerance = (ctx: ToolContext) =>
  (5 * ctx.hitScale()) / useEditor.getState().viewport.scale;

export const isVisibleForPicking = isNodeVisibleForHitTesting;

export function selectionFrame(): SelectionFrame | null {
  const { doc, selection, selectionPivot, selectionTransform } =
    useEditor.getState();
  return selectionFrameForSelection(
    doc,
    selection,
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
  if (isMixedFrameSelection(doc, selection)) return null;
  const frame = selectionFrame();
  if (!frame) return null;
  // Frames are never rotated and have no corner-radius/pivot editing, so only
  // their resize handles are hit-testable.
  const isFrameSelection = singleSelectedFrame(doc, selection) !== null;
  if (!isFrameSelection) {
    // Generator knobs sit inside the selection, so they take priority over the
    // frame's own handles when the two land on top of each other.
    const control = pickGeneratorControl(
      generatorControls(doc, selection, viewport),
      screen,
      (PARAM_KNOB_SIZE / 2 + 2) * ctx.hitScale()
    );
    if (control) return { type: "generator-param", control };
  }
  const radiusControl = isFrameSelection
    ? null
    : cornerRadiusControl(doc, selection, viewport, ctx.hitScale());
  if (
    radiusControl &&
    Math.hypot(
      radiusControl.point.x - screen.x,
      radiusControl.point.y - screen.y
    ) <= PARAM_KNOB_SIZE * ctx.hitScale()
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
  for (const id of usableHandleIds(frame.bounds)) {
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
