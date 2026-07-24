// Artboard tool: drag on empty space to create a board, drag a board's body to
// move it, or drag its handles to resize. Boards are axis-aligned world rects,
// so the unrotated handle helpers in ../handles apply directly. Create / move /
// resize snap to the grid, other boards and scene shapes, and honour Shift
// (square / keep aspect) and Alt (from centre). The move/resize builders are
// shared with the Select tool so boards can be adjusted without switching tools.

import { patchArtboard } from "../../store/artboardSlice";
import type { EditorState } from "../../store/editorStore";
import {
  artboardBounds,
  makeArtboard,
  type Artboard,
  type Bounds,
  type Vec2,
} from "../../model/types";
import { isShapeHidden } from "../../model/groups";
import { shapesInPaintOrder } from "../../model/scene";
import { worldShapeBounds } from "@/model/geometry/bounds";
import {
  boundsSnapTargets,
  computeSnap,
  snapPoint,
  type Guide,
  type SnapTargets,
} from "@/model/geometry/snap";
import { worldToScreen } from "@/model/geometry/viewport";
import {
  CLICK_SLOP,
  type ArtboardSnap,
  type Interaction,
  type ToolContext,
} from "../interaction";
import {
  HANDLE_IDS,
  HANDLE_SIZE,
  constrainAspectRatio,
  handleCursor,
  handlePoint,
  resizeBounds,
  type HandleId,
} from "../handles";

const EMPTY_TARGETS: SnapTargets = { x: [], y: [] };

/** The board the point falls inside, searched front-to-back (topmost first). */
function pickArtboard(artboards: Artboard[], world: Vec2): Artboard | null {
  for (let i = artboards.length - 1; i >= 0; i--) {
    const ab = artboards[i];
    if (
      world.x >= ab.x &&
      world.x <= ab.x + ab.width &&
      world.y >= ab.y &&
      world.y <= ab.y + ab.height
    ) {
      return ab;
    }
  }
  return null;
}

/** The board whose outline (within `tol` world units) the point lands on,
 * front-to-back. Interior points miss so marquee/picking still works there. */
export function pickArtboardBorder(
  artboards: Artboard[],
  world: Vec2,
  tol: number
): Artboard | null {
  for (let i = artboards.length - 1; i >= 0; i--) {
    const b = artboardBounds(artboards[i]);
    const inOuter =
      world.x >= b.x - tol &&
      world.x <= b.x + b.width + tol &&
      world.y >= b.y - tol &&
      world.y <= b.y + b.height + tol;
    const inInner =
      world.x >= b.x + tol &&
      world.x <= b.x + b.width - tol &&
      world.y >= b.y + tol &&
      world.y <= b.y + b.height - tol;
    if (inOuter && !inInner) return artboards[i];
  }
  return null;
}

/** The resize handle of `bounds` nearest `screen`, within grab tolerance. */
function hitHandle(
  bounds: Bounds,
  screen: Vec2,
  state: EditorState,
  hitScale: number
): HandleId | null {
  const tol = (HANDLE_SIZE / 2 + 3) * hitScale;
  let best: HandleId | null = null;
  let bestDist = tol;
  for (const id of HANDLE_IDS) {
    const p = worldToScreen(state.viewport, handlePoint(bounds, id));
    const d = Math.hypot(p.x - screen.x, p.y - screen.y);
    if (d <= bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/** A resize handle hit for a specific board (used by both artboard/select tools). */
export function hitArtboardHandle(
  state: EditorState,
  board: Artboard,
  screen: Vec2,
  hitScale: number
): HandleId | null {
  return hitHandle(artboardBounds(board), screen, state, hitScale);
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

/** Alignment/distribution snap targets for a board drag, excluding `excludeId`. */
function artboardSnapData(state: EditorState, excludeId: string): ArtboardSnap {
  const boardBoxes = state.doc.artboards
    .filter((ab) => ab.id !== excludeId)
    .map(artboardBounds);
  const shapeBoxes = shapesInPaintOrder(state.doc, null)
    .filter((s) => !isShapeHidden(state.doc, s))
    .map((s) => worldShapeBounds(state.doc, s));
  return {
    targets: boundsSnapTargets([...boardBoxes, ...shapeBoxes]),
    boxes: boardBoxes,
  };
}

/** Resize `orig` about its centre so the dragged handle reaches `p` (Alt). */
export function resizeFromCenter(orig: Bounds, handle: HandleId, p: Vec2): Bounds {
  const cx = orig.x + orig.width / 2;
  const cy = orig.y + orig.height / 2;
  let w = orig.width;
  let h = orig.height;
  if (handle.includes("e") || handle.includes("w")) w = 2 * Math.abs(p.x - cx);
  if (handle.includes("n") || handle.includes("s")) h = 2 * Math.abs(p.y - cy);
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Force `rect` back to `orig`'s aspect ratio while keeping its centre (Shift+Alt). */
export function aspectAboutCenter(rect: Bounds, orig: Bounds): Bounds {
  const cx = orig.x + orig.width / 2;
  const cy = orig.y + orig.height / 2;
  const s = Math.max(rect.width / orig.width, rect.height / orig.height);
  const w = orig.width * s;
  const h = orig.height * s;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Begin resizing an existing board (shared by the artboard + select tools). */
export function beginArtboardResize(
  ctx: ToolContext,
  state: EditorState,
  board: Artboard,
  handle: HandleId
) {
  state.selectArtboard(board.id);
  state.beginInteraction("Resize artboard");
  ctx.interaction.current = {
    kind: "artboard-resize",
    id: board.id,
    handle,
    orig: artboardBounds(board),
    snap: artboardSnapData(state, board.id),
  };
}

/** Begin moving an existing board (shared by the artboard + select tools). */
export function beginArtboardMove(
  ctx: ToolContext,
  state: EditorState,
  board: Artboard,
  world: Vec2
) {
  state.selectArtboard(board.id);
  state.beginInteraction("Move artboard");
  ctx.interaction.current = {
    kind: "artboard-move",
    id: board.id,
    grab: world,
    orig: artboardBounds(board),
    snap: artboardSnapData(state, board.id),
  };
}

export function onArtboardDown(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2
) {
  const selected = state.doc.artboards.find(
    (ab) => ab.id === state.selectedArtboardId
  );
  if (selected) {
    const handle = hitArtboardHandle(state, selected, screen, ctx.hitScale());
    if (handle) {
      beginArtboardResize(ctx, state, selected, handle);
      return;
    }
  }

  const hit = pickArtboard(state.doc.artboards, world);
  if (hit) {
    beginArtboardMove(ctx, state, hit, world);
    return;
  }

  // Empty space: start creating a new board that grows with the drag.
  const board = makeArtboard(
    world.x,
    world.y,
    0,
    0,
    `Artboard ${state.doc.artboards.length + 1}`
  );
  state.beginInteraction("Add artboard");
  state.setDoc({ ...state.doc, artboards: [...state.doc.artboards, board] });
  state.selectArtboard(board.id);
  ctx.interaction.current = {
    kind: "artboard-create",
    id: board.id,
    start: world,
    snap: artboardSnapData(state, board.id),
  };
  ctx.scheduleDraw();
}

export function onArtboardMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction,
  world: Vec2,
  shift: boolean,
  alt: boolean
) {
  const gridSize = state.gridSnap ? state.gridSize : null;
  const snapOn = state.snapEnabled || gridSize !== null;
  const threshold = 6 / state.viewport.scale;
  let guides: Guide[] = [];
  ctx.spacings.current = [];

  if (inter.kind === "artboard-create") {
    let p = world;
    if (snapOn) {
      const r = snapPoint(
        world,
        { targets: state.snapEnabled ? inter.snap.targets : EMPTY_TARGETS, gridSize },
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
    state.setDoc(patchArtboard(state.doc, inter.id, rect));
  } else if (inter.kind === "artboard-move") {
    let dx = world.x - inter.grab.x;
    let dy = world.y - inter.grab.y;
    if (snapOn) {
      const movingBox = {
        x: inter.orig.x + dx,
        y: inter.orig.y + dy,
        width: inter.orig.width,
        height: inter.orig.height,
      };
      const snap = computeSnap(
        movingBox,
        {
          targets: state.snapEnabled ? inter.snap.targets : EMPTY_TARGETS,
          boxes: state.snapEnabled ? inter.snap.boxes : [],
          gridSize,
        },
        threshold
      );
      dx += snap.dx;
      dy += snap.dy;
      guides = snap.guides;
      ctx.spacings.current = snap.spacings;
    }
    state.setDoc(
      patchArtboard(state.doc, inter.id, {
        x: inter.orig.x + dx,
        y: inter.orig.y + dy,
      })
    );
  } else if (inter.kind === "artboard-resize") {
    let p = world;
    if (snapOn) {
      const r = snapPoint(
        world,
        { targets: state.snapEnabled ? inter.snap.targets : EMPTY_TARGETS, gridSize },
        threshold
      );
      p = r.point;
      guides = r.guides;
    }
    let rect: Bounds;
    if (alt) {
      rect = resizeFromCenter(inter.orig, inter.handle, p);
      if (shift) rect = aspectAboutCenter(rect, inter.orig);
    } else {
      rect = resizeBounds(inter.orig, inter.handle, p);
      if (shift) {
        rect = constrainAspectRatio(
          inter.orig,
          inter.handle,
          rect,
          inter.orig.width / inter.orig.height
        );
      }
    }
    state.setDoc(patchArtboard(state.doc, inter.id, rect));
  }
  ctx.guides.current = guides;
  ctx.scheduleDraw();
}

export function finishArtboard(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction
) {
  if (inter.kind === "artboard-create") {
    const ab = state.doc.artboards.find((a) => a.id === inter.id);
    // A click (or negligible drag) creates nothing; roll the board back out.
    if (!ab || (ab.width < CLICK_SLOP && ab.height < CLICK_SLOP)) {
      state.cancelInteraction();
      state.selectArtboard(null);
    } else {
      state.endInteraction();
    }
  } else if (inter.kind === "artboard-move" || inter.kind === "artboard-resize") {
    state.endInteraction();
  }
  ctx.scheduleDraw();
}

export function artboardCursor(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2
): string {
  const selected = state.doc.artboards.find(
    (ab) => ab.id === state.selectedArtboardId
  );
  if (selected) {
    const handle = hitArtboardHandle(state, selected, screen, ctx.hitScale());
    if (handle) return handleCursor(handle);
  }
  return pickArtboard(state.doc.artboards, world) ? "move" : "crosshair";
}
