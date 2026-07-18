import { reverseBezier } from "../../model/bezier";
import { isShapeHidden, isShapeLocked } from "../../model/groups";
import {
  applyMatrix,
  invertMatrix,
  shapeWorldMatrix,
} from "../../model/matrix";
import { isShape, scopeLeafIds } from "../../model/scene";
import { makeId, type BezierShape, type Shape, type Vec2 } from "../../model/types";
import { worldToScreen } from "../../model/viewport";
import {
  currentSymbolScope,
  styleFromDefaults,
  useEditor,
  type EditorState,
} from "../../store/editorStore";
import { NODE_GRAB, type ToolContext } from "../interaction";
import { EMPTY_EXCLUDE, pointSnap } from "../picking";
import { constrain45 } from "../util";

/** The single subpath a pen draft works on. */
function draftSubpath(draft: BezierShape) {
  return draft.subpaths[0];
}

// ---- draft lifecycle ------------------------------------------------------

export function commitPenDraft(ctx: ToolContext) {
  const draft = ctx.penDraft.current;
  const extended = ctx.penExtend.current;
  ctx.penDraft.current = null;
  ctx.penExtend.current = null;
  ctx.preview.current = null;
  ctx.hover.current = null;
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
  ctx.scheduleDraw();
}

export function cancelPenDraft(ctx: ToolContext) {
  ctx.penDraft.current = null;
  ctx.penExtend.current = null;
  ctx.preview.current = null;
  ctx.hover.current = null;
  ctx.scheduleDraw();
}

// Soft undo: drop the last-placed anchor without discarding the whole draft.
export function undoPenAnchor(ctx: ToolContext) {
  const draft = ctx.penDraft.current;
  if (!draft) return;
  const anchors = draftSubpath(draft).anchors;
  anchors.pop();
  if (anchors.length === 0) {
    cancelPenDraft(ctx);
    return;
  }
  ctx.interaction.current = { kind: "none" };
  ctx.preview.current = draft;
  ctx.scheduleDraw();
}

// ---- pointer handling -----------------------------------------------------

/** Find the topmost open Bézier path with an endpoint under `screen`. */
export function pickOpenEndpoint(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2
): { shape: BezierShape; end: "start" | "end" } | null {
  const tol = NODE_GRAB * ctx.hitScale();
  const { doc, viewport } = state;
  const near = (shape: Shape, w: Vec2) => {
    const sp = worldToScreen(
      viewport,
      shape ? applyMatrix(shapeWorldMatrix(doc, shape), w) : w
    );
    return Math.hypot(sp.x - screen.x, sp.y - screen.y) <= tol;
  };
  const ids = scopeLeafIds(doc, currentSymbolScope(state));
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
}

export function onPenDown(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2,
  shift: boolean
) {
  const draft = ctx.penDraft.current;
  const draftInverse = draft
    ? invertMatrix(shapeWorldMatrix(state.doc, draft))
    : null;
  const localWorld = draftInverse ? applyMatrix(draftInverse, world) : world;
  const draftAnchors = draft ? draftSubpath(draft).anchors : null;
  const last = draftAnchors?.[draftAnchors.length - 1];
  if (shift && last) {
    world = constrain45(last.p, localWorld);
    ctx.guides.current = [];
  } else {
    const snapped = pointSnap(ctx, world, EMPTY_EXCLUDE);
    world = draftInverse ? applyMatrix(draftInverse, snapped) : snapped;
  }
  if (!draft) {
    // Clicking an endpoint of an existing open path picks it up and
    // continues it; the commit then replaces the original shape.
    const pick = pickOpenEndpoint(ctx, state, screen);
    if (pick) {
      const picked =
        pick.end === "start" ? reverseBezier(pick.shape) : pick.shape;
      // Continuing a generated path by hand overrides its geometry, so drop the
      // generator link (kept off both draft and baseline so a no-op pickup that
      // changes nothing still compares equal and leaves the shape untouched).
      const baseline = { ...picked, generator: undefined };
      ctx.penExtend.current = baseline;
      const shape = structuredClone(baseline);
      ctx.penDraft.current = shape;
      ctx.preview.current = shape;
      ctx.interaction.current = {
        kind: "pen-anchor",
        index: draftSubpath(shape).anchors.length - 1,
      };
      ctx.scheduleDraw();
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
    ctx.penDraft.current = shape;
    ctx.preview.current = shape;
    ctx.interaction.current = { kind: "pen-anchor", index: 0 };
    ctx.scheduleDraw();
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
      commitPenDraft(ctx);
      return;
    }
  }

  sp.anchors.push({ p: world, hIn: null, hOut: null });
  ctx.preview.current = draft;
  ctx.interaction.current = { kind: "pen-anchor", index: sp.anchors.length - 1 };
  ctx.scheduleDraw();
}

/** Dragging right after placing an anchor pulls out its handles. */
export function onPenAnchorMove(
  ctx: ToolContext,
  state: EditorState,
  index: number,
  world: Vec2,
  shiftKey: boolean
) {
  const draft = ctx.penDraft.current;
  if (draft) {
    const inverse = invertMatrix(shapeWorldMatrix(state.doc, draft));
    const localWorld = inverse ? applyMatrix(inverse, world) : world;
    const a = draftSubpath(draft).anchors[index];
    const target = shiftKey ? constrain45(a.p, localWorld) : localWorld;
    a.hOut = target;
    a.hIn = { x: 2 * a.p.x - target.x, y: 2 * a.p.y - target.y };
    ctx.scheduleDraw();
  }
}

/** Track the rubber-band preview point while no drag is active. */
export function onPenHoverMove(
  ctx: ToolContext,
  state: EditorState,
  world: Vec2,
  shiftKey: boolean
) {
  const draft = ctx.penDraft.current;
  if (!draft) return;
  const inverse = invertMatrix(shapeWorldMatrix(state.doc, draft));
  const localWorld = inverse ? applyMatrix(inverse, world) : world;
  const anchors = draftSubpath(draft).anchors;
  const last = anchors[anchors.length - 1];
  ctx.hover.current =
    shiftKey && last
      ? constrain45(last.p, localWorld)
      : (() => {
          const snapped = pointSnap(ctx, world, EMPTY_EXCLUDE);
          return inverse ? applyMatrix(inverse, snapped) : snapped;
        })();
  ctx.scheduleDraw();
}

/** Cursor for both the pen and pencil tools. */
export function penPencilCursor(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2
): string {
  // Highlight continuable endpoints of open paths.
  return state.tool === "pen" &&
    !ctx.penDraft.current &&
    pickOpenEndpoint(ctx, state, screen)
    ? "pointer"
    : "crosshair";
}
