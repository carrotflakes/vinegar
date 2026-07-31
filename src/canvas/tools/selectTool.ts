import { nodeWorldBounds, unionNodeWorldBounds, worldShapeBounds } from "@/model/geometry/bounds";
import {
  drillScopeRoot,
  exactlySelectedGroup,
  expandToGroups,
  isShapeHidden,
  isWithinGroup,
} from "../../model/groups";
import { marqueeHitNode } from "@/model/geometry/hitTest";
import {
  applyMatrix,
  invertMatrix,
  multiply,
  nodeWorldMatrix,
} from "@/model/geometry/matrix";
import {
  childIdsOf,
  descendantShapeIds,
  framesInPaintOrder,
  isFrame,
  isGroup,
  isInstance,
  isNodeLocked,
  isShape,
  parentIdOf,
  scopeLeafIds,
  selectionRoots,
  shapesInPaintOrder,
  withChildIds,
} from "../../model/scene";
import { collectSnapTargets } from "@/model/geometry/snap";
import type { Document, SceneNode, Shape, Vec2 } from "../../model/types";
import { screenToWorld, worldToScreen } from "@/model/geometry/viewport";
import { currentFocusRoot, useEditor, type EditorState } from "../../store/editorStore";
import { HANDLE_SIZE, handleCursorRotated } from "../handles";
import type { Interaction, ToolContext } from "../interaction";
import {
  hitFrameHandle,
  isVisibleForPicking,
  pickFrameBorder,
  pickLockedShape,
  pickShape,
  selectionFrame,
} from "../picking";
import { boundsFromCorners } from "../util";

function snapshot(ids: string[]): Record<string, SceneNode> {
  const { doc } = useEditor.getState();
  const out: Record<string, SceneNode> = {};
  for (const id of selectionRoots(doc, ids)) if (doc.nodes[id]) out[id] = doc.nodes[id];
  return out;
}

/**
 * Start moving `selection` without changing it. Shared by normal picking and
 * the drag-an-already-selected-locked-shape path (lock blocks *selecting*, not
 * moving what is already selected).
 */
function beginSelectionMove(
  ctx: ToolContext,
  state: EditorState,
  world: Vec2,
  selection: string[]
) {
  const originals = snapshot(selection);
  const selectedGroup = exactlySelectedGroup(state.doc, selection);
  const transient = !selectedGroup && selection.length > 1;
  const selectedLeafIds = new Set(
    selectionRoots(state.doc, selection).flatMap((id) =>
      descendantShapeIds(state.doc, id)
    )
  );
  const others = shapesInPaintOrder(state.doc, currentFocusRoot(state)).filter(
    (s): s is Shape => !selectedLeafIds.has(s.id) && !isShapeHidden(state.doc, s)
  );
  state.beginInteraction("Move selection");
  ctx.interaction.current = {
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
}

/**
 * The topmost frame whose content box contains `world`, searched front-to-back.
 * Hidden and locked frames are skipped: dropping art into one would make it
 * vanish or become unselectable the instant the pointer is released.
 */
function droppableFrameAt(doc: Document, world: Vec2): string | null {
  const frames = framesInPaintOrder(doc);
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (frame.hidden || frame.locked) continue;
    const inverse = invertMatrix(nodeWorldMatrix(doc, frame.id));
    if (!inverse) continue;
    const p = applyMatrix(inverse, world);
    if (p.x >= 0 && p.x <= frame.width && p.y >= 0 && p.y <= frame.height) {
      return frame.id;
    }
  }
  return null;
}

const boundsCenter = (b: { x: number; y: number; width: number; height: number }): Vec2 => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

/** The frame `id` would drop into, by its own world-bounds centre. */
function frameUnderCenter(doc: Document, id: string): string | null {
  const b = nodeWorldBounds(doc, id);
  return b ? droppableFrameAt(doc, boundsCenter(b)) : null;
}

/** The frame the moved roots would drop into (union-centre test), for the drag
 *  highlight. `ids` should exclude frames (they never reparent). */
export function frameDropTarget(doc: Document, ids: string[]): string | null {
  const b = unionNodeWorldBounds(doc, ids);
  return b ? droppableFrameAt(doc, boundsCenter(b)) : null;
}

/**
 * After a move drag, reparent each moved root into the frame it was dropped over
 * (or back out to the scene root), preserving world position. Only nodes that
 * are at the scene root or already directly inside a frame are auto-reparented —
 * a node inside a user group keeps its group, so group contents are never
 * disturbed. Frames themselves stay top-level and are skipped.
 */
function reparentDroppedIntoFrames(doc: Document, ids: string[]): Document {
  let next = doc;
  for (const id of ids) {
    const node = next.nodes[id];
    if (!node || isFrame(node)) continue;
    const currentParent = parentIdOf(next, id);
    const parentNode = currentParent ? next.nodes[currentParent] : null;
    // Only re-home top-level nodes and existing frame children.
    if (parentNode && !isFrame(parentNode)) continue;
    const target = frameUnderCenter(next, id);
    if (target === currentParent) continue;
    const oldWorld = nodeWorldMatrix(next, id);
    const inverseTarget = invertMatrix(nodeWorldMatrix(next, target));
    if (!inverseTarget) continue;
    next = withChildIds(
      next,
      currentParent,
      childIdsOf(next, currentParent).filter((child) => child !== id)
    );
    next = withChildIds(next, target, [...childIdsOf(next, target), id]);
    next = {
      ...next,
      nodes: {
        ...next.nodes,
        [id]: { ...next.nodes[id], transform: multiply(inverseTarget, oldWorld) },
      },
    };
  }
  return next;
}

/**
 * Commit a move drag: if the pointer actually moved, auto-reparent the moved
 * roots into/out of frames (world position preserved), then close the undo step
 * — so the translation and the reparent land as one action.
 */
export function finishSelectMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Extract<Interaction, { kind: "move" }>,
  reparent: boolean
) {
  const moved = Object.keys(inter.originals).some(
    (id) => state.doc.nodes[id] && state.doc.nodes[id] !== inter.originals[id]
  );
  if (reparent && moved && currentFocusRoot(state) === null) {
    const next = reparentDroppedIntoFrames(state.doc, Object.keys(inter.originals));
    if (next !== state.doc) state.setDoc(next);
  }
  state.endInteraction();
  ctx.scheduleDraw();
}

export function onSelectDown(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2,
  shiftKey: boolean
) {
  // Rotation / resize handles take priority over picking shapes.
  const hit = hitFrameHandle(ctx, screen);
  if (hit?.type === "corner-radius") {
    const control = hit.control;
    state.beginInteraction("Adjust corner radius");
    ctx.interaction.current = {
      kind: "corner-radius",
      shapeId: control.shapeId,
      startScreen: screen,
      startRadius: control.radius,
      direction: control.direction,
      pixelsPerRadius: control.pixelsPerRadius,
      maxRadius: control.maxRadius,
    };
    return;
  }
  if (hit?.type === "pivot") {
    const group = exactlySelectedGroup(state.doc, state.selection);
    const shape =
      !group && state.selection.length === 1
        ? state.doc.nodes[state.selection[0]]
        : null;
    const persistent = !!group || !!shape;
    if (persistent) state.beginInteraction("Move transform origin");
    ctx.interaction.current = {
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
    state.beginInteraction("Rotate selection");
    ctx.interaction.current = {
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
    const single =
      state.selection.length === 1 ? state.doc.nodes[state.selection[0]] : null;
    const lockAspect =
      !!single && isShape(single) && single.type === "image" && !!single.lockAspect;
    // Resizing a frame changes its box only; snapshot its direct children so
    // they can be kept fixed in world space against the box's origin shift.
    const frameChildren = single && isFrame(single)
      ? Object.fromEntries(
          single.childIds
            .map((cid) => [cid, state.doc.nodes[cid]] as const)
            .filter(([, node]) => !!node)
        )
      : undefined;
    state.beginInteraction("Resize selection");
    ctx.interaction.current = {
      kind: "resize",
      handle: hit.id,
      from: frame.bounds,
      frameTransform: frame.transform,
      originals: snapshot(state.selection),
      single: state.selection.length === 1,
      lockAspect,
      frameChildren,
      selectionPivot: transient ? state.selectionPivot ?? undefined : undefined,
      selectionTransform: transient ? frame.transform : undefined,
    };
    return;
  }

  // A locked shape can't be *selected* by clicking, but one that is already in
  // the selection (e.g. picked from the Layers panel) can still be dragged to
  // move it — lock blocks selecting/editing, not moving what's already
  // selected. If the locked shape under the cursor isn't selected, fall through
  // so the click behaves normally.
  const lockedHit = pickLockedShape(ctx, world);
  if (lockedHit) {
    const scopeRoot = currentFocusRoot(state);
    const roots = expandToGroups(state.doc, [lockedHit], scopeRoot);
    if (roots.some((id) => state.selection.includes(id))) {
      beginSelectionMove(ctx, state, world, state.selection);
      return;
    }
  }

  const focusRoot = currentFocusRoot(state);
  const activeGroup =
    state.activeGroupId && isGroup(state.doc.nodes[state.activeGroupId])
      ? state.activeGroupId
      : null;
  const hitId = pickShape(ctx, world);
  if (hitId) {
    // While drilled into a group, hits inside it resolve to its direct
    // children; a hit outside steps back out to the top level.
    const insideActive =
      activeGroup != null && isWithinGroup(state.doc, hitId, activeGroup);
    if (activeGroup && !insideActive) state.setActiveGroup(null);
    const scopeRoot = insideActive ? activeGroup : focusRoot;
    let selection: string[];
    if (shiftKey) {
      const group = expandToGroups(state.doc, [hitId], scopeRoot);
      const has = group.every((id) => state.selection.includes(id));
      selection = has
        ? state.selection.filter((id) => !group.includes(id))
        : [...new Set([...state.selection, ...group])];
      state.setSelection(selection);
    } else if (!expandToGroups(state.doc, [hitId], scopeRoot).some((id) => state.selection.includes(id))) {
      selection = expandToGroups(state.doc, [hitId], scopeRoot);
      state.setSelection(selection);
    } else {
      selection = state.selection;
    }
    beginSelectionMove(ctx, state, world, selection);
    return;
  }

  // No shape hit: grabbing a frame's border selects and moves it (frames are
  // ordinary nodes, so this is a normal selection move — children follow).
  const borderTol =
    ((HANDLE_SIZE / 2 + 3) * ctx.hitScale()) / state.viewport.scale;
  const borderFrame = pickFrameBorder(state.doc, world, borderTol);
  if (borderFrame) {
    if (activeGroup) state.setActiveGroup(null);
    if (!state.selection.includes(borderFrame)) state.setSelection([borderFrame]);
    beginSelectionMove(ctx, state, world, [borderFrame]);
    return;
  }

  if (!shiftKey) {
    state.clearSelection();
    if (activeGroup) state.setActiveGroup(null);
  }
  ctx.interaction.current = {
    kind: "marquee",
    start: world,
    additive: shiftKey,
  };
  ctx.marquee.current = { x: screen.x, y: screen.y, width: 0, height: 0 };
}

export function onMarqueeUp(
  ctx: ToolContext,
  state: EditorState,
  inter: Extract<Interaction, { kind: "marquee" }>,
  end: Vec2
) {
  // The drawn marquee is axis-aligned in screen space, so under a rotated
  // viewport its world footprint is a rotated rectangle. Build the region from
  // all four screen corners (not just the two diagonal ones) so the world AABB
  // actually encloses what the user drew. Like rotated instances, this can
  // over-select slightly at the corners; exact oriented-rect hit-testing would
  // mean reworking the shared marquee test in hitTest.ts.
  const a = worldToScreen(state.viewport, inter.start);
  const b = worldToScreen(state.viewport, end);
  const region = boundsFromCorners(
    [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ].map((corner) => screenToWorld(state.viewport, corner))
  );
  const scope = currentFocusRoot(state);
  const drillRoot = drillScopeRoot(state.doc, state.activeGroupId, scope);
  const hits = scopeLeafIds(state.doc, scope).filter((id) => {
    const s = state.doc.nodes[id];
    return (
      (isShape(s) || isInstance(s)) &&
      isVisibleForPicking(state.doc, id) &&
      !isNodeLocked(state.doc, id) &&
      marqueeHitNode(state.doc, s, region, scope ?? undefined)
    );
  });
  const base = inter.additive ? state.selection : [];
  state.setSelection(
    expandToGroups(state.doc, [...new Set([...base, ...hits])], drillRoot)
  );
  ctx.marquee.current = null;
  ctx.scheduleDraw();
}

/** Double-clicking the pivot handle resets it to the default. */
export function onSelectDoubleClick(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2
): boolean {
  if (hitFrameHandle(ctx, screen)?.type !== "pivot") return false;
  const group = exactlySelectedGroup(state.doc, state.selection);
  if (group) {
    state.updateNodeStyle(group.id, { transformOrigin: null });
  } else if (state.selection.length === 1) {
    state.updateSelectedStyle({ transformOrigin: null });
  } else {
    state.setSelectionPivot(null);
  }
  ctx.scheduleDraw();
  return true;
}

export function selectCursor(
  ctx: ToolContext,
  screen: Vec2,
  world: Vec2
): string {
  const state = useEditor.getState();
  const frameCursor = (id: Parameters<typeof handleCursorRotated>[0]) => {
    const frame = selectionFrame();
    const mirrored = !!state.viewport.flipX;
    const screenRotation =
      state.viewport.rotation + (mirrored ? -1 : 1) * (frame?.rotation ?? 0);
    return handleCursorRotated(id, screenRotation, mirrored);
  };
  const hit = hitFrameHandle(ctx, screen);
  if (hit?.type === "pivot") return "crosshair";
  if (hit?.type === "corner-radius") {
    return frameCursor("se");
  }
  if (hit?.type === "rotate") return "grab";
  if (hit?.type === "resize") {
    return frameCursor(hit.id);
  }
  const lockedHit = pickLockedShape(ctx, world);
  if (lockedHit) {
    const scopeRoot = currentFocusRoot(state);
    if (
      expandToGroups(state.doc, [lockedHit], scopeRoot).some((id) =>
        state.selection.includes(id)
      )
    )
      return "move";
  }
  if (pickShape(ctx, world)) return "move";
  const borderTol =
    ((HANDLE_SIZE / 2 + 3) * ctx.hitScale()) / state.viewport.scale;
  if (pickFrameBorder(state.doc, world, borderTol)) return "move";
  return "default";
}
