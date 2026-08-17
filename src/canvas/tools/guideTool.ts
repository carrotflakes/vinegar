// Creating, dragging and dropping persistent guides. Guides are not scene
// nodes, so this sits alongside the tools rather than inside selectTool: it
// runs ahead of the tool dispatch for every tool that can touch guides.
// See docs/rulers-and-guides.md.

import type { EditorState } from "../../store/state";
import type { Vec2 } from "../../model/types";
import { pickGuide } from "../guides";
import { overGuideDeleteZone, rulerBandAt, overRulers } from "../rulers";
import type { Interaction, ToolContext } from "../interaction";
import { pointSnap } from "../picking";

interface CanvasSize {
  width: number;
  height: number;
}

/** Whether guides can be picked and dragged at all right now. */
function guidesEditable(state: EditorState): boolean {
  return state.guidesVisible && !state.guidesLocked;
}

/**
 * Handle a pointer-down that belongs to the guides layer: a press in a ruler
 * band pulls out a new guide, a press on an existing guide picks it up.
 * Returns whether the press was consumed (so tools should not see it).
 */
export function onGuideDown(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2,
  size: CanvasSize
): boolean {
  if (state.rulersVisible && overRulers(screen, size)) {
    const band = rulerBandAt(screen, size);
    // The corner box (band === null) is inert, but it must still swallow the
    // press so it does not draw on the canvas underneath.
    if (!band || !guidesEditable(state)) return true;
    // Dragging down off the top ruler makes a horizontal guide, and vice versa.
    const axis = band === "horizontal" ? "y" : "x";
    state.beginInteraction("Add guide");
    const id = state.addGuide(axis, axis === "x" ? world.x : world.y);
    ctx.interaction.current = { kind: "guide-drag", id, axis, created: true };
    ctx.scheduleDraw();
    return true;
  }

  // An existing guide is only picked up by the selection tools: a stray guide
  // under a pencil/brush stroke must not swallow the press.
  if (!guidesEditable(state) || (state.tool !== "select" && state.tool !== "node")) {
    return false;
  }
  const hit = pickGuide(state.doc, state.viewport, screen, size, 4 * ctx.hitScale());
  if (!hit) return false;
  // Order matters: a node selection clears the guide selection, not vice versa.
  state.setSelection([]);
  state.setSelectedGuide(hit.id);
  state.beginInteraction("Move guide");
  ctx.interaction.current = {
    kind: "guide-drag",
    id: hit.id,
    axis: hit.axis,
    created: false,
  };
  ctx.scheduleDraw();
  return true;
}

/** Track the pointer, snapping the guide like any other created geometry. */
export function onGuideMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction,
  world: Vec2
): void {
  if (inter.kind !== "guide-drag") return;
  const snapped = pointSnap(ctx, world, new Set(), {
    excludeGuideId: inter.id,
  });
  state.moveGuide(inter.id, inter.axis === "x" ? snapped.x : snapped.y);
  ctx.scheduleDraw();
}

/** Drop the guide; releasing over a ruler or beyond it discards the guide. */
export function finishGuideDrag(
  ctx: ToolContext,
  state: EditorState,
  inter: Interaction,
  screen: Vec2,
  size: CanvasSize
): void {
  if (inter.kind !== "guide-drag") return;
  if (state.rulersVisible && overGuideDeleteZone(screen, size)) {
    state.removeGuide(inter.id);
  }
  state.endInteraction();
  ctx.scheduleDraw();
}
