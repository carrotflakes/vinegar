// Frame tool: drag on empty space to create a frame (an export/layout container
// node). Existing frames are selected, moved and resized with the Select tool,
// like any other node — this tool only handles creation. Create snaps to the
// grid, other frames and scene shapes, and honours Shift (square) and Alt (from
// centre).

import type { EditorState } from "../../store/editorStore";
import { makeFrame, type Bounds, type FrameNode, type Vec2 } from "../../model/types";
import { isShapeHidden } from "../../model/groups";
import { framesInPaintOrder, shapesInPaintOrder } from "../../model/scene";
import { nodeWorldBounds, worldShapeBounds } from "@/model/geometry/bounds";
import {
  boundsSnapTargets,
  snapPoint,
  type Guide,
  type SnapTargets,
} from "@/model/geometry/snap";
import { activeGuideLines } from "../guides";
import {
  CLICK_SLOP,
  type FrameSnap,
  type Interaction,
  type ToolContext,
} from "../interaction";

const EMPTY_TARGETS: SnapTargets = { x: [], y: [] };

/** Set a frame's world position (translation) and/or content-box size. */
function patchFrame(
  doc: EditorState["doc"],
  id: string,
  rect: Partial<Bounds>
): EditorState["doc"] {
  const node = doc.nodes[id];
  if (node?.type !== "frame") return doc;
  const t = node.transform;
  const next: FrameNode = {
    ...node,
    transform: [t[0], t[1], t[2], t[3], rect.x ?? t[4], rect.y ?? t[5]],
    width: rect.width !== undefined ? Math.max(0, rect.width) : node.width,
    height: rect.height !== undefined ? Math.max(0, rect.height) : node.height,
  };
  return { ...doc, nodes: { ...doc.nodes, [id]: next } };
}

/** Alignment/distribution snap targets for a frame-create drag: other frames'
 *  content boxes plus scene shapes. */
function frameSnapData(state: EditorState, excludeId: string): FrameSnap {
  const frameBoxes = framesInPaintOrder(state.doc)
    .filter((frame) => frame.id !== excludeId)
    .map((frame) => nodeWorldBounds(state.doc, frame.id))
    .filter((b): b is Bounds => !!b);
  const shapeBoxes = shapesInPaintOrder(state.doc, null)
    .filter((s) => !isShapeHidden(state.doc, s))
    .map((s) => worldShapeBounds(state.doc, s));
  return {
    targets: boundsSnapTargets([...frameBoxes, ...shapeBoxes]),
    boxes: frameBoxes,
  };
}

/** Normalized rect between two world points. */
function rectFrom(a: Vec2, b: Vec2): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function onFrameDown(
  ctx: ToolContext,
  state: EditorState,
  _screen: Vec2,
  world: Vec2
) {
  const frame = makeFrame(
    world.x,
    world.y,
    0,
    0,
    `Frame ${framesInPaintOrder(state.doc).length + 1}`
  );
  state.beginInteraction("Add frame");
  state.setDoc({
    ...state.doc,
    nodes: { ...state.doc.nodes, [frame.id]: frame },
    rootIds: [...state.doc.rootIds, frame.id],
  });
  state.setSelection([frame.id]);
  ctx.interaction.current = {
    kind: "frame-create",
    id: frame.id,
    start: world,
    snap: frameSnapData(state, frame.id),
  };
  ctx.scheduleDraw();
}

export function onFrameMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction,
  world: Vec2,
  shift: boolean,
  alt: boolean
) {
  if (inter.kind !== "frame-create") return;
  const gridSize = state.gridSnap ? state.gridSize : null;
  const guideLines = activeGuideLines(state);
  const snapOn =
    state.snapEnabled ||
    gridSize !== null ||
    guideLines.x.length > 0 ||
    guideLines.y.length > 0;
  const threshold = 6 / state.viewport.scale;
  let guides: Guide[] = [];

  let p = world;
  if (snapOn) {
    const r = snapPoint(
      world,
      {
        targets: state.snapEnabled ? inter.snap.targets : EMPTY_TARGETS,
        gridSize,
        guideLines,
      },
      threshold
    );
    p = r.point;
    guides = r.guides;
  }
  let dx = p.x - inter.start.x;
  let dy = p.y - inter.start.y;
  if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * m;
    dy = (dy < 0 ? -1 : 1) * m;
  }
  const rect = alt
    ? {
        x: inter.start.x - Math.abs(dx),
        y: inter.start.y - Math.abs(dy),
        width: 2 * Math.abs(dx),
        height: 2 * Math.abs(dy),
      }
    : rectFrom(inter.start, { x: inter.start.x + dx, y: inter.start.y + dy });
  state.setDoc(patchFrame(state.doc, inter.id, rect));
  ctx.guides.current = guides;
  ctx.scheduleDraw();
}

export function finishFrame(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction
) {
  if (inter.kind !== "frame-create") return;
  const node = state.doc.nodes[inter.id];
  // A click (or negligible drag) creates nothing; roll the frame back out.
  if (
    node?.type !== "frame" ||
    (node.width < CLICK_SLOP && node.height < CLICK_SLOP)
  ) {
    state.cancelInteraction();
    state.clearSelection();
  } else {
    state.endInteraction();
  }
  ctx.scheduleDraw();
}

export function frameCursor(): string {
  return "crosshair";
}
