import { isShapeHidden, isShapeLocked } from "../../model/groups";
import {
  applyMatrix,
  invertMatrix,
  shapeWorldMatrix,
} from "@/model/geometry/matrix";
import { reversePath } from "@/model/path/path";
import { isShape, scopeLeafIds } from "../../model/scene";
import type { Matrix, PathShape, Shape, Vec2 } from "../../model/types";
import { worldToScreen } from "@/model/geometry/viewport";
import { currentFocusRoot, type EditorState } from "../../store/editorStore";
import { NODE_GRAB, type ToolContext } from "../interaction";

/**
 * Continuing an existing open path — the pen picking up an endpoint, the pencil
 * drawing on from one — is the same act done with two different inputs, so both
 * find the target and prepare it here.
 */

/** Screen-space grab radius for path endpoints and the pen's own anchors,
 *  enlarged for touch like every other hit target. */
export function grabRadius(ctx: ToolContext): number {
  return NODE_GRAB * ctx.hitScale();
}

/** Find the topmost open Bézier path with an endpoint under `screen`. */
export function pickOpenEndpoint(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2
): { shape: PathShape; end: "start" | "end" } | null {
  const tol = grabRadius(ctx);
  const { doc, viewport } = state;
  const near = (shape: Shape, w: Vec2) => {
    const sp = worldToScreen(
      viewport,
      shape ? applyMatrix(shapeWorldMatrix(doc, shape), w) : w
    );
    return Math.hypot(sp.x - screen.x, sp.y - screen.y) <= tol;
  };
  const ids = scopeLeafIds(doc, currentFocusRoot(state));
  for (let i = ids.length - 1; i >= 0; i--) {
    const s = doc.nodes[ids[i]];
    if (
      !isShape(s) ||
      s.type !== "path" ||
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

/** World position of the endpoint a pickup would continue from. */
export function endpointWorld(
  state: EditorState,
  pick: { shape: PathShape; end: "start" | "end" }
): Vec2 {
  const anchors = pick.shape.subpaths[0].anchors;
  const a = pick.end === "start" ? anchors[0] : anchors[anchors.length - 1];
  return applyMatrix(shapeWorldMatrix(state.doc, pick.shape), a.p);
}

export interface OpenPathPickup {
  /** The path to append to: reversed when the *start* was picked up, so both
   *  tools only ever append, and stripped of its generator link. */
  base: PathShape;
  world: Matrix;
  inverse: Matrix;
}

/**
 * Prepare the open path under `screen` to be continued, or null when there is
 * none (or the caller's `requireSelected` rule rejects it — the pencil only
 * continues a deliberately selected path, while the pen takes any).
 *
 * Continuing by hand overrides the geometry, so the generator link is dropped
 * here for both tools: a shape whose points came from a generator would
 * otherwise regenerate them and discard the drawing.
 */
export function pickupOpenPath(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  { requireSelected }: { requireSelected: boolean }
): OpenPathPickup | null {
  const pick = pickOpenEndpoint(ctx, state, screen);
  if (!pick) return null;
  if (requireSelected && !state.selection.includes(pick.shape.id)) return null;
  const world = shapeWorldMatrix(state.doc, pick.shape);
  const inverse = invertMatrix(world);
  if (!inverse) return null;
  const base: PathShape = {
    ...(pick.end === "start" ? reversePath(pick.shape) : pick.shape),
    generator: null,
  };
  return { base, world, inverse };
}
