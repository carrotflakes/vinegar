import {
  closestPointOnPath,
  insertAnchorOnSegment,
} from "../../model/path";
import { closestPointOnBrush, insertBrushAnchor } from "../../model/brushEdit";
import {
  applyMatrix,
  invertMatrix,
  matrixScale,
  shapeWorldMatrix,
} from "../../model/matrix";
import { isShape } from "../../model/scene";
import type { Vec2 } from "../../model/types";
import { useEditor, type EditorState } from "../../store/editorStore";
import { NODE_GRAB, type Interaction, type ToolContext } from "../interaction";
import { hitNodes, moveAnchors, moveHandle, nodeSubpaths } from "../nodes";
import {
  pickShape,
  pickTolerance,
  pointSnap,
  selectedNodeShape,
} from "../picking";
import { constrain45 } from "../util";

export type NodeInteraction = Extract<
  Interaction,
  { kind: "node-anchor" | "node-handle" }
>;

export function onNodeDown(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2,
  shiftKey: boolean
) {
  const sel = selectedNodeShape(state);
  if (sel) {
    const hit = hitNodes(
      sel,
      shapeWorldMatrix(state.doc, sel),
      screen,
      state.viewport,
      NODE_GRAB * ctx.hitScale(),
      shiftKey
    );
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
      state.beginInteraction();
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
    const inverse = invertMatrix(shapeWorldMatrix(state.doc, sel));
    const local = inverse ? applyMatrix(inverse, world) : world;
    const localScale = matrixScale(shapeWorldMatrix(state.doc, sel));
    const withinPath = (distance: number) =>
      distance * localScale <= pickTolerance(ctx);

    let insert: { next: typeof sel; sub: number; index: number } | null = null;
    if (sel.type === "path") {
      const loc = closestPointOnPath(sel, local);
      if (loc && withinPath(loc.distance)) {
        const next = insertAnchorOnSegment(sel, loc.sub, loc.segIndex, loc.t);
        if (next !== sel) insert = { next, sub: loc.sub, index: loc.segIndex + 1 };
      }
    } else {
      const loc = closestPointOnBrush(sel, local);
      if (loc && withinPath(loc.distance)) {
        const next = insertBrushAnchor(sel, loc.segIndex, loc.t);
        if (next !== sel) insert = { next, sub: 0, index: loc.segIndex + 1 };
      }
    }
    if (insert) {
      const { next, sub, index } = insert;
      state.beginInteraction();
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
  // Select another node-editable shape (path or brush), or clear.
  const id = pickShape(ctx, world);
  const picked = id ? state.doc.nodes[id] : null;
  if (picked && (picked.type === "path" || picked.type === "brush")) {
    state.setSelection([id!]);
    state.setEditNodes([]);
  } else {
    state.clearSelection();
  }
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

  state.applyShapes({
    [inter.shapeId]: moveHandle(
      inter.orig,
      inter.sub,
      inter.index,
      inter.part,
      localWorld,
      !altKey
    ),
  });
}

export function onNodeDoubleClick(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2
) {
  const sel = selectedNodeShape(state);
  if (!sel) return;
  const hit = hitNodes(
    sel,
    shapeWorldMatrix(state.doc, sel),
    screen,
    state.viewport,
    NODE_GRAB * ctx.hitScale()
  );
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
  const sel = selectedNodeShape(state);
  if (
    sel &&
    hitNodes(
      sel,
      shapeWorldMatrix(state.doc, sel),
      screen,
      state.viewport,
      NODE_GRAB * ctx.hitScale()
    )
  ) {
    return "move";
  }
  // "copy" (arrow + plus) over the path itself: a click inserts a point. Only
  // Paths support inserting anchors; brush insertion is handled on click only.
  if (!sel || sel.type !== "path") return "default";
  const inverse = invertMatrix(shapeWorldMatrix(state.doc, sel));
  const loc = closestPointOnPath(sel, inverse ? applyMatrix(inverse, world) : world);
  const localScale = matrixScale(shapeWorldMatrix(state.doc, sel));
  return loc && loc.distance * localScale <= pickTolerance(ctx)
    ? "copy"
    : "default";
}
