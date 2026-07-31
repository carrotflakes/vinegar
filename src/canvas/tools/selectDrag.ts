// Driving a live select-tool drag: one function per kind of drag, plus the
// dispatcher the pointer layer calls. Starting and committing these drags is
// selectTool's job; this module only advances one that is already running.

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
import { isFrame, isGroup, isShape } from "../../model/scene";
import { computeSnap } from "@/model/geometry/snap";
import { activeGuideLines } from "../guides";
import type { SceneNode, Shape, Vec2 } from "../../model/types";
import { worldToScreen } from "@/model/geometry/viewport";
import type { EditorState } from "../../store/editorStore";
import { setReadout } from "../../store/pointerStore";
import { constrainAspectRatio, resizeBounds } from "../handles";
import type { Interaction, ToolContext } from "../interaction";
import { pointSnap } from "../picking";
import { formatAngle, formatSize } from "../util";

export type SelectInteraction = Extract<
  Interaction,
  { kind: "pivot" | "move" | "resize" | "rotate" | "corner-radius" | "marquee" }
>;

type Drag<K extends SelectInteraction["kind"]> = Extract<
  SelectInteraction,
  { kind: K }
>;

/** Drag the transform origin of a group, a shape, or a transient selection. */
function dragPivot(state: EditorState, inter: Drag<"pivot">, world: Vec2) {
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
    return;
  }
  if (inter.shapeId) {
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
    return;
  }
  state.setSelectionPivot(world);
}

function dragMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Drag<"move">,
  world: Vec2,
  noReparent: boolean
) {
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
}

function dragResize(
  ctx: ToolContext,
  state: EditorState,
  inter: Drag<"resize">,
  world: Vec2,
  shiftKey: boolean
) {
  const handlePt = pointSnap(ctx, world, new Set(Object.keys(inter.originals)));
  const inverseFrame = invertMatrix(inter.frameTransform);
  if (!inverseFrame) return;
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
    return;
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
}

function dragRotate(
  state: EditorState,
  inter: Drag<"rotate">,
  world: Vec2,
  shiftKey: boolean
) {
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
}

function dragCornerRadius(
  state: EditorState,
  inter: Drag<"corner-radius">,
  screen: Vec2
) {
  const shape = state.doc.nodes[inter.shapeId];
  if (!isShape(shape) || shape.type !== "rect") return;
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
}

function dragMarquee(
  ctx: ToolContext,
  state: EditorState,
  inter: Drag<"marquee">,
  screen: Vec2
) {
  const start = worldToScreen(state.viewport, inter.start);
  ctx.marquee.current = {
    x: Math.min(start.x, screen.x),
    y: Math.min(start.y, screen.y),
    width: Math.abs(screen.x - start.x),
    height: Math.abs(screen.y - start.y),
  };
  ctx.scheduleDraw();
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
    case "pivot":
      dragPivot(state, inter, world);
      break;
    case "move":
      dragMove(ctx, state, inter, world, noReparent);
      break;
    case "resize":
      dragResize(ctx, state, inter, world, shiftKey);
      break;
    case "rotate":
      dragRotate(state, inter, world, shiftKey);
      break;
    case "corner-radius":
      dragCornerRadius(state, inter, screen);
      break;
    case "marquee":
      dragMarquee(ctx, state, inter, screen);
      break;
  }
}
