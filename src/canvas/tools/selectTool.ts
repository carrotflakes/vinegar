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
  applyWorldTransformToNode,
  boundsTransform,
  invertMatrix,
  multiply,
  nodeWorldMatrix,
  rotationAbout as matrixRotationAbout,
  shapeWorldMatrix,
  translation as translationMatrix,
} from "@/model/geometry/matrix";
import { magnetAngle, snapAngle } from "@/model/geometry/rotate";
import { resizeShapeToBounds } from "@/model/geometry/transforms";
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
import { collectSnapTargets, computeSnap } from "@/model/geometry/snap";
import { activeGuideLines } from "../guides";
import type { Document, SceneNode, Shape, Vec2 } from "../../model/types";
import { screenToWorld, worldToScreen } from "@/model/geometry/viewport";
import { currentFocusRoot, useEditor, type EditorState } from "../../store/editorStore";
import { setReadout } from "../../store/pointerStore";
import {
  HANDLE_SIZE,
  constrainAspectRatio,
  handleCursorRotated,
  resizeBounds,
} from "../handles";
import type { Interaction, ToolContext } from "../interaction";
import {
  hitFrameHandle,
  isVisibleForPicking,
  pickFrameBorder,
  pickLockedShape,
  pickShape,
  pointSnap,
  selectionFrame,
} from "../picking";
import { boundsFromCorners, formatAngle, formatSize } from "../util";

export type SelectInteraction = Extract<
  Interaction,
  { kind: "pivot" | "move" | "resize" | "rotate" | "corner-radius" | "marquee" }
>;

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

export function onSelectMove(
  ctx: ToolContext,
  state: EditorState,
  inter: SelectInteraction,
  screen: Vec2,
  world: Vec2,
  shiftKey: boolean,
  noReparent = false
) {
  switch (inter.kind) {
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
      // Record the live modifier so the drop-target highlight can hide while
      // reparenting is suppressed.
      inter.noReparent = noReparent;
      const rawDx = world.x - inter.start.x;
      const rawDy = world.y - inter.start.y;
      let dx = rawDx;
      let dy = rawDy;
      const gridSize = state.gridSnap ? state.gridSize : null;
      const guideLines = activeGuideLines(state);
      if (state.snapEnabled || gridSize || guideLines.x.length || guideLines.y.length) {
        const movingBox = {
          x: inter.origUnion.x + rawDx,
          y: inter.origUnion.y + rawDy,
          width: inter.origUnion.width,
          height: inter.origUnion.height,
        };
        const snap = computeSnap(
          movingBox,
          {
            targets: state.snapEnabled ? inter.targets : { x: [], y: [] },
            boxes: state.snapEnabled ? inter.boxes : [],
            gridSize,
            guideLines,
          },
          6 / state.viewport.scale
        );
        dx += snap.dx;
        dy += snap.dy;
        ctx.guides.current = snap.guides;
        ctx.spacings.current = snap.spacings;
      } else {
        ctx.guides.current = [];
        ctx.spacings.current = [];
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
        state.setSelectionTransform(multiply(delta, inter.selectionTransform));
      }
      setReadout(`Δ ${Math.round(dx)}, ${Math.round(dy)}`);
      break;
    }
    case "resize": {
      const handlePt = pointSnap(ctx, world, new Set(Object.keys(inter.originals)));
      const inverseFrame = invertMatrix(inter.frameTransform);
      if (!inverseFrame) break;
      const localPointer = applyMatrix(inverseFrame, handlePt);
      let to = resizeBounds(inter.from, inter.handle, localPointer);
      if (
        (inter.lockAspect || shiftKey) &&
        inter.from.width > 0 &&
        inter.from.height > 0
      ) {
        to = constrainAspectRatio(
          inter.from,
          inter.handle,
          to,
          inter.from.width / inter.from.height
        );
      }
      const entries = Object.entries(inter.originals);
      // A frame resizes its content box, never its children's scale. `to` is in
      // frame-local space; its origin offset folds into the frame transform so
      // the moved edge tracks the pointer while the opposite edge stays put.
      // (Frames are top-level, so their world matrix is their own transform.)
      const soloFrame =
        inter.single && entries.length === 1 && isFrame(entries[0][1])
          ? entries[0][1]
          : null;
      if (soloFrame) {
        const next: Record<string, SceneNode> = {
          [soloFrame.id]: {
            ...soloFrame,
            width: Math.max(1, to.width),
            height: Math.max(1, to.height),
            transform: multiply(soloFrame.transform, translationMatrix(to.x, to.y)),
          },
        };
        // Keep the frame's contents fixed in world space: undo the box's
        // local-origin shift on each direct child (grandchildren follow).
        const compensate = translationMatrix(-to.x, -to.y);
        for (const [cid, child] of Object.entries(inter.frameChildren ?? {})) {
          next[cid] = { ...child, transform: multiply(compensate, child.transform) };
        }
        state.applyShapes(next);
        setReadout(formatSize(to.width, to.height));
        break;
      }
      // Text and parametric (generator-backed) shapes are excluded from the
      // geometry-fold path and resize through the transform below instead.
      // Text has no baked-scale representation (w/h are measured, not authored,
      // and fontSize is separate). A parametric shape's subpaths are the
      // generator's output; folding a scale into them would be overwritten on
      // the next regenerate, so the scale must live in `transform` to survive.
      const soloLeaf =
        inter.single &&
        entries.length === 1 &&
        isShape(entries[0][1]) &&
        entries[0][1].type !== "text" &&
        !entries[0][1].generator
          ? (entries[0][1] as Shape)
          : null;
      const next: Record<string, SceneNode> = {};
      if (soloLeaf) {
        // A single leaf shape resizes in its own local axes, so the scale can
        // be folded straight into its geometry (w/h or points) instead of the
        // transform — keeping `transform` rotation-only and the numeric size
        // fields honest. Visually identical: resizeShapeToBounds applies the
        // same axis-aligned scale the transform path would post-multiply.
        next[soloLeaf.id] = resizeShapeToBounds(soloLeaf, inter.from, to);
        state.applyShapes(next);
      } else {
        const localDelta = boundsTransform(inter.from, to);
        const worldDelta = multiply(
          inter.frameTransform,
          multiply(localDelta, inverseFrame)
        );
        for (const [id, orig] of entries) {
          next[id] = applyWorldTransformToNode(state.doc, orig, worldDelta);
        }
        state.applyShapes(next);
        if (inter.selectionPivot) {
          state.setSelectionPivot(applyMatrix(worldDelta, inter.selectionPivot));
        }
        if (inter.selectionTransform) {
          state.setSelectionTransform(
            multiply(worldDelta, inter.selectionTransform)
          );
        }
      }
      setReadout(formatSize(to.width, to.height));
      break;
    }
    case "rotate": {
      let delta =
        Math.atan2(world.y - inter.pivot.y, world.x - inter.pivot.x) -
        inter.startAngle;
      if (shiftKey) {
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
        state.setSelectionPivot(applyMatrix(rotationDelta, inter.selectionPivot));
      }
      if (inter.selectionTransform) {
        state.setSelectionTransform(
          multiply(rotationDelta, inter.selectionTransform)
        );
      }
      setReadout(formatAngle(inter.startRotation + delta));
      break;
    }
    case "corner-radius": {
      const shape = state.doc.nodes[inter.shapeId];
      if (!isShape(shape) || shape.type !== "rect") break;
      const deltaPixels =
        (screen.x - inter.startScreen.x) * inter.direction.x +
        (screen.y - inter.startScreen.y) * inter.direction.y;
      const radius = Math.max(
        0,
        Math.min(
          inter.maxRadius,
          inter.startRadius + deltaPixels / inter.pixelsPerRadius
        )
      );
      state.applyShapes({
        [shape.id]: { ...shape, cornerRadius: radius },
      });
      setReadout(`R ${Math.round(radius)}`);
      break;
    }
    case "marquee": {
      const start = worldToScreen(state.viewport, inter.start);
      ctx.marquee.current = {
        x: Math.min(start.x, screen.x),
        y: Math.min(start.y, screen.y),
        width: Math.abs(screen.x - start.x),
        height: Math.abs(screen.y - start.y),
      };
      ctx.scheduleDraw();
      break;
    }
  }
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
