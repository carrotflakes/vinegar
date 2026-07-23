// Artboard tool: drag on empty space to create a board, drag a board's body to
// move it, or drag its handles to resize. Boards are axis-aligned world rects,
// so the unrotated handle helpers in ../handles apply directly.

import { patchArtboard } from "../../store/artboardSlice";
import type { EditorState } from "../../store/editorStore";
import {
  artboardBounds,
  makeArtboard,
  type Artboard,
  type Bounds,
  type Vec2,
} from "../../model/types";
import { worldToScreen } from "@/model/geometry/viewport";
import { CLICK_SLOP, type Interaction, type ToolContext } from "../interaction";
import {
  HANDLE_IDS,
  HANDLE_SIZE,
  handleCursor,
  handlePoint,
  resizeBounds,
  type HandleId,
} from "../handles";

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

/** Normalized rect between two world points. */
function rectFrom(a: Vec2, b: Vec2): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
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
    const handle = hitHandle(artboardBounds(selected), screen, state, ctx.hitScale());
    if (handle) {
      state.beginInteraction("Resize artboard");
      ctx.interaction.current = {
        kind: "artboard-resize",
        id: selected.id,
        handle,
        orig: artboardBounds(selected),
      };
      return;
    }
  }

  const hit = pickArtboard(state.doc.artboards, world);
  if (hit) {
    state.selectArtboard(hit.id);
    state.beginInteraction("Move artboard");
    ctx.interaction.current = {
      kind: "artboard-move",
      id: hit.id,
      grab: world,
      orig: artboardBounds(hit),
    };
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
  ctx.interaction.current = { kind: "artboard-create", id: board.id, start: world };
  ctx.scheduleDraw();
}

export function onArtboardMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction,
  world: Vec2
) {
  if (inter.kind === "artboard-create") {
    state.setDoc(patchArtboard(state.doc, inter.id, rectFrom(inter.start, world)));
  } else if (inter.kind === "artboard-move") {
    const dx = world.x - inter.grab.x;
    const dy = world.y - inter.grab.y;
    state.setDoc(
      patchArtboard(state.doc, inter.id, {
        x: inter.orig.x + dx,
        y: inter.orig.y + dy,
      })
    );
  } else if (inter.kind === "artboard-resize") {
    state.setDoc(
      patchArtboard(state.doc, inter.id, resizeBounds(inter.orig, inter.handle, world))
    );
  }
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
    const handle = hitHandle(artboardBounds(selected), screen, state, ctx.hitScale());
    if (handle) return handleCursor(handle);
  }
  return pickArtboard(state.doc.artboards, world) ? "move" : "crosshair";
}
