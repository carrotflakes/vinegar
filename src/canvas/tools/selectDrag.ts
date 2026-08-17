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
import { GENERATORS, defaultArgs } from "@/model/generators/generators";
import {
  clampParamValue,
  handleParamValue,
} from "@/model/generators/handles";
import { magnetAngle, snapAngle } from "@/model/geometry/rotate";
import { resizeShapeToBounds } from "@/model/geometry/transforms";
import { normalizeRect } from "@/model/geometry/bounds";
import { isFrame, isGroup, isShape } from "../../model/scene";
import { computeSnap } from "@/model/geometry/snap";
import { activeGuideLines } from "../guides";
import type { SceneNode, Shape, Vec2 } from "../../model/types";
import { worldToScreen } from "@/model/geometry/viewport";
import { useEditor, type EditorState } from "../../store/editorStore";
import { setReadout } from "../../store/pointerStore";
import { constrainAspectRatio, resizeBounds } from "../handles";
import { CLICK_SLOP, type Interaction, type ToolContext } from "../interaction";
import { pointSnap, SNAP_PX } from "../picking";
import { promotePendingMove } from "./selectTool";
import { formatAngle, formatSize } from "../util";

export type SelectInteraction = Extract<
  Interaction,
  {
    kind:
      | "select-pending"
      | "pivot"
      | "move"
      | "resize"
      | "rotate"
      | "corner-radius"
      | "generator-param"
      | "marquee";
  }
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
  shiftKey: boolean,
  noReparent: boolean
) {
  // Record the live modifier so the drop-target highlight can hide while
  // reparenting is suppressed.
  inter.noReparent = noReparent;
  let rawDx = world.x - inter.start.x;
  let rawDy = world.y - inter.start.y;
  // Shift locks the drag to whichever axis leads, matching the Shift on resize
  // and rotate. The lock outranks snapping: an alignment line on the locked
  // axis would otherwise pull the move off it.
  const locked: "x" | "y" | null = shiftKey
    ? Math.abs(rawDx) >= Math.abs(rawDy)
      ? "y"
      : "x"
    : null;
  if (locked === "y") rawDy = 0;
  if (locked === "x") rawDx = 0;
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
      SNAP_PX / state.viewport.scale
    );
    if (locked !== "x") dx += snap.dx;
    if (locked !== "y") dy += snap.dy;
    ctx.guides.current = locked
      ? snap.guides.filter((guide) => guide.axis !== locked)
      : snap.guides;
    ctx.spacings.current = locked ? [] : snap.spacings;
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
  const entries = Object.entries(inter.originals);
  const soloFrame =
    inter.single && entries.length === 1 && isFrame(entries[0][1])
      ? entries[0][1]
      : null;
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
  // Frames are layout containers rather than artwork. Normalize only after aspect
  // constraint so a crossed handle still follows the pointer without leaving
  // a reflected frame transform behind.
  if (soloFrame) {
    to = normalizeRect(to.x, to.y, to.width, to.height);
  }
  // A frame resizes its content box, never its children's scale. `to` is in
  // frame-local space; its origin offset folds into the frame transform so
  // the moved edge tracks the pointer while the opposite edge stays put.
  // (Frames are top-level, so their world matrix is their own transform.)
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
  // Text, compound paths and parametric (generator-backed) shapes are excluded
  // from the geometry-fold path and resize through the transform below instead.
  // Text has no baked-scale representation (w/h are measured, not authored,
  // and fontSize is separate). A parametric shape's subpaths are the
  // generator's output; folding a scale into them would be overwritten on
  // the next regenerate, so the scale must live in `transform` to survive.
  const soloGeometryLeaf =
    inter.single &&
    entries.length === 1 &&
    isShape(entries[0][1]) &&
    entries[0][1].type !== "text" &&
    entries[0][1].type !== "compoundPath" &&
    !entries[0][1].generator
      ? (entries[0][1] as Shape)
      : null;
  const next: Record<string, SceneNode> = {};
  if (soloGeometryLeaf) {
    // A single leaf shape resizes in its own local axes, so the scale can
    // be folded straight into its geometry (w/h or points) instead of the
    // transform — keeping `transform` rotation-only and the numeric size
    // fields honest. A crossed axis is the exception: fold its absolute size
    // into geometry, then retain only the reflection in the node transform.
    const normalized = normalizeRect(to.x, to.y, to.width, to.height);
    let resized = resizeShapeToBounds(
      soloGeometryLeaf,
      inter.from,
      normalized
    );
    const centerX = normalized.x + normalized.width / 2;
    const centerY = normalized.y + normalized.height / 2;
    const reflection: SceneNode["transform"] = [
      to.width < 0 ? -1 : 1,
      0,
      0,
      to.height < 0 ? -1 : 1,
      to.width < 0 ? centerX * 2 : 0,
      to.height < 0 ? centerY * 2 : 0,
    ];
    resized = {
      ...resized,
      transform: multiply(resized.transform, reflection),
    };
    next[soloGeometryLeaf.id] = resized;
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
  setReadout(formatSize(Math.abs(to.width), Math.abs(to.height)));
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

/** Generator args span whole counts and 0..1 ratios, so scale the precision. */
function formatParam(value: number): string {
  return Math.abs(value) < 10
    ? String(Math.round(value * 100) / 100)
    : String(Math.round(value));
}

/**
 * Drag one generator argument by its on-canvas knob. Built-in generators build
 * synchronously, so the geometry is regenerated in place on every move and the
 * whole drag lands as the one undo step opened at pointer-down.
 */
function dragGeneratorParam(
  state: EditorState,
  inter: Drag<"generator-param">,
  world: Vec2
) {
  const shape = state.doc.nodes[inter.shapeId];
  if (!isShape(shape) || shape.type !== "path" || !shape.generator) return;
  const def = GENERATORS[shape.generator.scriptId];
  if (!def) return;
  const key = inter.control.param.key;
  const args = { ...defaultArgs(def), ...shape.generator.args };
  const value = clampParamValue(
    inter.control.param,
    handleParamValue(
      inter.control.handle,
      inter.startValue,
      args[key] ?? inter.startValue,
      inter.startLocal,
      applyMatrix(inter.inverse, world)
    )
  );
  setReadout(`${inter.control.param.label} ${formatParam(value)}`);
  if (args[key] === value) return;
  const merged = { ...args, [key]: value };
  const subpaths = def.build(merged);
  if (!subpaths) return;
  state.applyShapes({
    [shape.id]: {
      ...shape,
      subpaths,
      generator: { ...shape.generator, args: merged },
    },
  });
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

/**
 * A press only becomes a move once it has travelled this far in screen pixels,
 * so pressing on a shape to select it can no longer nudge it. Coarse pointers
 * get the same slop as every other hit target.
 */
function pendingSlop(ctx: ToolContext): number {
  return CLICK_SLOP * ctx.hitScale();
}

/**
 * Advance an armed press: below the slop nothing happens yet, past it the drag
 * is promoted to a real move and the same event drives its first step.
 */
function dragPending(
  ctx: ToolContext,
  state: EditorState,
  inter: Drag<"select-pending">,
  screen: Vec2,
  world: Vec2,
  shiftKey: boolean,
  altKey: boolean,
  noReparent: boolean
) {
  const travelled = Math.hypot(
    screen.x - inter.startScreen.x,
    screen.y - inter.startScreen.y
  );
  if (travelled < pendingSlop(ctx)) return;
  promotePendingMove(ctx, state, inter, altKey);
  const promoted = ctx.interaction.current;
  if (promoted.kind !== "move") return;
  // Duplicating replaced the document, so the move runs against fresh state.
  dragMove(ctx, useEditor.getState(), promoted, world, shiftKey, noReparent);
}

export function onSelectMove(
  ctx: ToolContext,
  state: EditorState,
  inter: SelectInteraction,
  screen: Vec2,
  world: Vec2,
  shiftKey: boolean,
  altKey = false,
  noReparent = false
) {
  switch (inter.kind) {
    case "select-pending":
      dragPending(ctx, state, inter, screen, world, shiftKey, altKey, noReparent);
      break;
    case "pivot":
      dragPivot(state, inter, world);
      break;
    case "move":
      dragMove(ctx, state, inter, world, shiftKey, noReparent);
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
    case "generator-param":
      dragGeneratorParam(state, inter, world);
      break;
    case "marquee":
      dragMarquee(ctx, state, inter, screen);
      break;
  }
}
