import {
  closestPointOnPath,
  insertAnchorOnSegment,
} from "@/model/path/path";
import { closestPointOnBrush, insertBrushAnchor } from "@/model/brush/brushEdit";
import {
  applyMatrix,
  invertMatrix,
  matrixScale,
  shapeWorldMatrix,
} from "@/model/geometry/matrix";
import { isShape } from "../../model/scene";
import type { Bounds, Vec2 } from "../../model/types";
import { worldToScreen } from "@/model/geometry/viewport";
import { useEditor, type EditorState } from "../../store/editorStore";
import { setReadout } from "../../store/pointerStore";
import {
  CLICK_SLOP,
  NODE_GRAB,
  type Interaction,
  type ToolContext,
} from "../interaction";
import {
  hitBrushWidth,
  hitNodes,
  moveAnchors,
  moveHandle,
  nodeSubpaths,
  type NodeEditShape,
} from "../nodes";
import {
  brushAnchorNormal,
  setBrushAnchorWidths,
  widthFromDrag,
  widthGrabOffset,
} from "@/model/brush/brushWidth";
import {
  grabbableHandles,
  pickShape,
  pickTolerance,
  pointSnap,
  selectedNodeShape,
  selectedNodeShapes,
} from "../picking";
import { boundsFromPoints, constrain45 } from "../util";

export type NodeInteraction = Extract<
  Interaction,
  { kind: "node-anchor" | "node-handle" }
>;

type NodeMarquee = Extract<Interaction, { kind: "node-marquee" }>;

export type NodeWidthInteraction = Extract<Interaction, { kind: "node-width" }>;

type NodeRef = { shapeId: string; sub: number; index: number };

/**
 * Anchors of the edited shapes whose *screen* position falls inside the
 * screen-space marquee `rect`. Testing in screen space keeps the hit region
 * exactly the rectangle the user drew, even when the viewport is rotated.
 */
function nodesInRect(state: EditorState, rect: Bounds): NodeRef[] {
  const hits: NodeRef[] = [];
  for (const shape of selectedNodeShapes(state)) {
    const matrix = shapeWorldMatrix(state.doc, shape);
    nodeSubpaths(shape).forEach((subpath, sub) => {
      subpath.anchors.forEach((anchor, index) => {
        const p = worldToScreen(state.viewport, applyMatrix(matrix, anchor.p));
        if (
          p.x >= rect.x &&
          p.x <= rect.x + rect.width &&
          p.y >= rect.y &&
          p.y <= rect.y + rect.height
        ) {
          hits.push({ shapeId: shape.id, sub, index });
        }
      });
    });
  }
  return hits;
}

/** Marquee hits, unioned with the pre-drag selection on Shift; store dedupes. */
function marqueeSelection(state: EditorState, inter: NodeMarquee, screen: Vec2) {
  const hits = nodesInRect(state, boundsFromPoints(inter.startScreen, screen));
  return inter.additive ? [...inter.original, ...hits] : hits;
}

interface SegmentTarget {
  shape: NodeEditShape;
  sub: number;
  segIndex: number;
  t: number;
  worldDistance: number;
}

/** Closest segment across every node-editable selected shape. */
function closestSegmentTarget(
  ctx: ToolContext,
  state: EditorState,
  shapes: NodeEditShape[],
  world: Vec2
): SegmentTarget | null {
  let best: SegmentTarget | null = null;
  for (const shape of shapes) {
    const matrix = shapeWorldMatrix(state.doc, shape);
    const inverse = invertMatrix(matrix);
    const local = inverse ? applyMatrix(inverse, world) : world;
    const scale = matrixScale(matrix);
    if (shape.type === "path") {
      const loc = closestPointOnPath(shape, local);
      if (!loc) continue;
      const worldDistance = loc.distance * scale;
      if (worldDistance > pickTolerance(ctx) ||
          (best && best.worldDistance <= worldDistance)) continue;
      best = {
        shape,
        sub: loc.sub,
        segIndex: loc.segIndex,
        t: loc.t,
        worldDistance,
      };
      continue;
    }
    const loc = closestPointOnBrush(shape, local);
    if (!loc) continue;
    const worldDistance = loc.distance * scale;
    if (worldDistance > pickTolerance(ctx) ||
        (best && best.worldDistance <= worldDistance)) continue;
    best = {
      shape,
      sub: 0,
      segIndex: loc.segIndex,
      t: loc.t,
      worldDistance,
    };
  }
  return best;
}

/** Indices of the anchors of `shapeId` currently selected in the node tool. */
function selectedAnchorIndices(state: EditorState, shapeId: string): number[] {
  return state.editNodes
    .filter((node) => node.shapeId === shapeId && node.sub === 0)
    .map((node) => node.index);
}

/**
 * The width knob under the cursor, across the brushes being node-edited. Only
 * selected anchors carry knobs, so this is empty until an anchor is picked.
 */
function pickWidthKnob(
  ctx: ToolContext,
  state: EditorState,
  shapes: NodeEditShape[],
  screen: Vec2
) {
  for (const shape of shapes) {
    if (shape.type !== "brush") continue;
    const knob = hitBrushWidth(
      shape,
      shapeWorldMatrix(state.doc, shape),
      screen,
      state.viewport,
      selectedAnchorIndices(state, shape.id),
      NODE_GRAB * ctx.hitScale()
    );
    if (knob) return { shape, knob };
  }
  return null;
}

export function onNodeDown(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2,
  shiftKey: boolean
) {
  const candidates = selectedNodeShapes(state);
  const hitTarget = candidates.flatMap((shape) => {
    const hit = hitNodes(
      shape,
      shapeWorldMatrix(state.doc, shape),
      screen,
      state.viewport,
      NODE_GRAB * ctx.hitScale(),
      shiftKey,
      grabbableHandles(state, shape)
    );
    return hit ? [{ shape, hit }] : [];
  })[0];
  // Width knobs sit between the two: a Bézier handle still wins over a knob,
  // but a knob wins over the anchor it hangs off (they can overlap on a thin
  // anchor, where the knob is nudged out to its minimum offset).
  const widthTarget =
    !hitTarget || (hitTarget.hit.part === "anchor" && !shiftKey)
      ? pickWidthKnob(ctx, state, candidates, screen)
      : null;
  if (widthTarget) {
    const { shape, knob } = widthTarget;
    const inverse = invertMatrix(shapeWorldMatrix(state.doc, shape));
    const local = inverse ? applyMatrix(inverse, world) : world;
    const normal = brushAnchorNormal(shape, knob.index);
    state.beginInteraction("Edit brush width");
    ctx.interaction.current = {
      kind: "node-width",
      shapeId: shape.id,
      index: knob.index,
      orig: shape,
      selected: selectedAnchorIndices(state, shape.id),
      normal,
      grabOffset: widthGrabOffset(shape, knob.index, normal, local),
    };
    return;
  }
  const segmentTarget = hitTarget
    ? null
    : closestSegmentTarget(ctx, state, candidates, world);
  const sel =
    hitTarget?.shape ?? segmentTarget?.shape ?? selectedNodeShape(state);
  if (sel) {
    const hit = hitTarget?.shape.id === sel.id ? hitTarget.hit : null;
    if (hit) {
      const node = { shapeId: sel.id, sub: hit.sub, index: hit.index };
      const current = state.editNodes.filter((selected) => selected.shapeId === sel.id);
      const sameNode = (selected: typeof node) =>
        selected.sub === node.sub && selected.index === node.index;
      const alreadySelected = current.some(sameNode);
      let selected = current;
      if (hit.part === "anchor" && shiftKey) {
        if (alreadySelected) {
          state.setEditNodes(current.filter((selectedNode) => !sameNode(selectedNode)));
          return;
        }
        selected = [...current, node];
      } else if (alreadySelected) {
        // Preserve the group when dragging an already-selected anchor, but make
        // the pressed anchor active by moving it to the end.
        selected = [...current.filter((selectedNode) => !sameNode(selectedNode)), node];
      } else {
        selected = [node];
      }
      state.setEditNodes(selected);
      state.beginInteraction("Edit path nodes");
      ctx.interaction.current =
        hit.part === "anchor"
          ? {
              kind: "node-anchor",
              shapeId: sel.id,
              sub: hit.sub,
              index: hit.index,
              orig: sel,
              selected: selected.map(({ sub, index }) => ({ sub, index })),
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
    // Clicking the path itself (not a node) inserts an anchor there and starts
    // dragging it, all as one undo step.
    let insert: {
      next: NodeEditShape;
      sub: number;
      index: number;
    } | null = null;
    if (segmentTarget?.shape.id === sel.id) {
      const next = sel.type === "path"
        ? insertAnchorOnSegment(
            sel,
            segmentTarget.sub,
            segmentTarget.segIndex,
            segmentTarget.t
          )
        : insertBrushAnchor(sel, segmentTarget.segIndex, segmentTarget.t);
      if (next !== sel) {
        insert = {
          next,
          sub: segmentTarget.sub,
          index: segmentTarget.segIndex + 1,
        };
      }
    }
    if (insert) {
      const { next, sub, index } = insert;
      state.beginInteraction("Insert path node");
      state.applyShapes({ [sel.id]: next });
      state.setEditNodes([{ shapeId: sel.id, sub, index }]);
      ctx.lastInsert.current = { shapeId: sel.id, sub, index, time: Date.now() };
      ctx.interaction.current = {
        kind: "node-anchor",
        shapeId: sel.id,
        sub,
        index,
        orig: next,
        selected: [{ sub, index }],
      };
      return;
    }
  }
  // Empty space: start a marquee that selects anchors of the edited shape(s).
  // A plain click (no drag) instead re-picks the shape under the cursor; that
  // fallback lives in onNodeMarqueeUp.
  ctx.interaction.current = {
    kind: "node-marquee",
    start: world,
    startScreen: screen,
    additive: shiftKey,
    original: state.editNodes.map(({ shapeId, sub, index }) => ({ shapeId, sub, index })),
  };
  ctx.marquee.current = { x: screen.x, y: screen.y, width: 0, height: 0 };
}

function draggedPast(startScreen: Vec2, screen: Vec2): boolean {
  return (
    Math.abs(screen.x - startScreen.x) > CLICK_SLOP ||
    Math.abs(screen.y - startScreen.y) > CLICK_SLOP
  );
}

export function onNodeMarqueeMove(
  ctx: ToolContext,
  state: EditorState,
  inter: NodeMarquee,
  screen: Vec2
) {
  ctx.marquee.current = boundsFromPoints(inter.startScreen, screen);
  // Only touch the selection once past the click slop, so an accidental
  // sub-pixel drag before a click doesn't clobber the current anchors.
  if (draggedPast(inter.startScreen, screen)) {
    state.setEditNodes(marqueeSelection(state, inter, screen));
  }
  ctx.scheduleDraw();
}

export function onNodeMarqueeUp(
  ctx: ToolContext,
  state: EditorState,
  inter: NodeMarquee,
  screen: Vec2,
  world: Vec2
) {
  ctx.marquee.current = null;
  if (draggedPast(inter.startScreen, screen)) {
    state.setEditNodes(marqueeSelection(state, inter, screen));
    ctx.scheduleDraw();
    return;
  }
  // Treated as a click on empty space. Shift-click keeps the current anchors;
  // a plain click re-picks a node-editable shape, or clears the selection.
  if (!inter.additive) {
    const id = pickShape(ctx, world);
    const picked = id ? state.doc.nodes[id] : null;
    if (picked && (picked.type === "path" || picked.type === "brush")) {
      state.setSelection([id!]);
      state.setEditNodes([]);
    } else {
      state.clearSelection();
    }
  }
  ctx.scheduleDraw();
}

export function onNodeMove(
  ctx: ToolContext,
  state: EditorState,
  inter: NodeInteraction,
  world: Vec2,
  shiftKey: boolean,
  altKey: boolean
) {
  const current = state.doc.nodes[inter.shapeId];
  const inverse = isShape(current)
    ? invertMatrix(shapeWorldMatrix(state.doc, current))
    : null;
  const localWorld = inverse ? applyMatrix(inverse, world) : world;

  if (inter.kind === "node-anchor") {
    let target: Vec2;
    if (shiftKey) {
      // Constrain to 45° rays from the anchor's original position.
      const origP =
        nodeSubpaths(inter.orig)[inter.sub]?.anchors[inter.index]?.p ?? localWorld;
      target = constrain45(origP, localWorld);
      ctx.guides.current = [];
      ctx.spacings.current = [];
    } else {
      const snapped = pointSnap(ctx, world, new Set([inter.shapeId]));
      target = inverse ? applyMatrix(inverse, snapped) : snapped;
    }
    const origin =
      nodeSubpaths(inter.orig)[inter.sub]?.anchors[inter.index]?.p ?? target;
    state.applyShapes({
      [inter.shapeId]: moveAnchors(
        inter.orig,
        inter.selected,
        target.x - origin.x,
        target.y - origin.y
      ),
    });
    return;
  }

  // Shift constrains the handle to 45° rays from its own anchor, the same
  // meaning it has when dragging an anchor.
  const anchor = nodeSubpaths(inter.orig)[inter.sub]?.anchors[inter.index];
  const target =
    shiftKey && anchor ? constrain45(anchor.p, localWorld) : localWorld;
  state.applyShapes({
    [inter.shapeId]: moveHandle(
      inter.orig,
      inter.sub,
      inter.index,
      inter.part,
      target,
      altKey
    ),
  });
}

/**
 * Drag a brush anchor's width knob. Other selected anchors follow by the same
 * *ratio* so the stroke keeps its taper; Alt levels them to one absolute width
 * instead (also the behaviour when the grabbed anchor starts at zero, where a
 * ratio is meaningless).
 */
export function onNodeWidthMove(
  ctx: ToolContext,
  state: EditorState,
  inter: NodeWidthInteraction,
  world: Vec2,
  altKey: boolean
) {
  const current = state.doc.nodes[inter.shapeId];
  const inverse = isShape(current)
    ? invertMatrix(shapeWorldMatrix(state.doc, current))
    : null;
  const local = inverse ? applyMatrix(inverse, world) : world;

  const width = widthFromDrag(
    inter.orig,
    inter.index,
    inter.normal,
    local,
    inter.grabOffset
  );
  const startWidth = inter.orig.anchors[inter.index]?.w ?? 0;
  const absolute = altKey || startWidth < 1e-3;
  const next = setBrushAnchorWidths(
    inter.orig,
    inter.selected.length ? inter.selected : [inter.index],
    absolute ? () => width : (w) => (w * width) / startWidth
  );
  state.applyShapes({ [inter.shapeId]: next });
  setReadout(`W ${(width * inter.orig.strokeWidth).toFixed(1)}`);
  ctx.scheduleDraw();
}

export function onNodeDoubleClick(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2
) {
  const target = selectedNodeShapes(state).flatMap((shape) => {
    const hit = hitNodes(
      shape,
      shapeWorldMatrix(state.doc, shape),
      screen,
      state.viewport,
      NODE_GRAB * ctx.hitScale(),
      false,
      grabbableHandles(state, shape)
    );
    return hit ? [{ shape, hit }] : [];
  })[0];
  if (!target) return;
  const { shape: sel, hit } = target;
  if (hit?.part !== "anchor") return;
  // The first click of this double-click may have just inserted this
  // anchor; don't immediately flip it to a corner as well.
  const ins = ctx.lastInsert.current;
  if (
    ins &&
    ins.shapeId === sel.id &&
    ins.sub === hit.sub &&
    ins.index === hit.index &&
    Date.now() - ins.time < 600
  )
    return;
  state.toggleNodeSmooth(sel.id, hit.sub, hit.index);
  state.setEditNodes([{ shapeId: sel.id, sub: hit.sub, index: hit.index }]);
}

export function nodeCursor(
  ctx: ToolContext,
  screen: Vec2,
  world: Vec2
): string {
  const state = useEditor.getState();
  const shapes = selectedNodeShapes(state);
  if (pickWidthKnob(ctx, state, shapes, screen)) return "move";
  if (shapes.some((shape) => hitNodes(
    shape,
    shapeWorldMatrix(state.doc, shape),
    screen,
    state.viewport,
    NODE_GRAB * ctx.hitScale(),
    false,
    grabbableHandles(state, shape)
  ))) {
    return "move";
  }
  // "copy" (arrow + plus) over the path itself: a click inserts a point. Only
  // Paths support inserting anchors; brush insertion is handled on click only.
  return closestSegmentTarget(
    ctx,
    state,
    shapes.filter((shape) => shape.type === "path"),
    world
  )
    ? "copy"
    : "default";
}
