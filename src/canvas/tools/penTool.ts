import {
  applyMatrix,
  invertMatrix,
  shapeWorldMatrix,
} from "@/model/geometry/matrix";
import { isShape } from "../../model/scene";
import { makeId, type PathShape, type Vec2 } from "../../model/types";
import { worldToScreen } from "@/model/geometry/viewport";
import {
  markersFromDefaults,
  styleFromDefaults,
  useEditor,
  type EditorState,
} from "../../store/editorStore";
import type { Interaction, ToolContext } from "../interaction";
import { grabRadius, pickupOpenPath } from "./openPathPickup";
import { EMPTY_EXCLUDE, pointSnap } from "../picking";
import { constrain45 } from "../util";
import type { SnapTargets } from "@/model/geometry/snap";
import { usePenDraftInfo } from "../../store/penDraftStore";

/** The single subpath a pen draft works on. */
function draftSubpath(draft: PathShape) {
  return draft.subpaths[0];
}

/** Chrome that only makes sense while a draft is alive. Finishing from the
 *  keyboard or the on-screen bar never passes through the canvas pointer-up
 *  that would otherwise clear it. */
function clearDraftChrome(ctx: ToolContext) {
  ctx.preview.current = null;
  ctx.hover.current = null;
  ctx.guides.current = [];
  ctx.spacings.current = [];
}

/** Mirror the draft's anchor count out to the on-screen bar (PenDraftBar). */
function publishDraft(ctx: ToolContext) {
  const draft = ctx.penDraft.current;
  usePenDraftInfo
    .getState()
    .setAnchors(draft ? draftSubpath(draft).anchors.length : 0);
}

/** Would placing the next anchor at `screen` close the draft instead? */
function closesDraft(
  ctx: ToolContext,
  state: EditorState,
  draft: PathShape,
  screen: Vec2
): boolean {
  const anchors = draftSubpath(draft).anchors;
  if (anchors.length < 2) return false;
  const first = worldToScreen(
    state.viewport,
    applyMatrix(shapeWorldMatrix(state.doc, draft), anchors[0].p)
  );
  return Math.hypot(first.x - screen.x, first.y - screen.y) <= grabRadius(ctx);
}

/** Snap lines from the anchors already placed in the draft, so a path can be
 *  aligned against itself (the draft is not in the document, so the ordinary
 *  shape targets do not cover it). */
function draftSnapTargets(state: EditorState, draft: PathShape): SnapTargets {
  const m = shapeWorldMatrix(state.doc, draft);
  const x: SnapTargets["x"] = [];
  const y: SnapTargets["y"] = [];
  for (const a of draftSubpath(draft).anchors) {
    const w = applyMatrix(m, a.p);
    x.push({ value: w.x, lo: w.y, hi: w.y });
    y.push({ value: w.y, lo: w.x, hi: w.x });
  }
  return { x, y };
}

/** Snap a world point for the pen, including the draft's own anchors. */
function penSnap(
  ctx: ToolContext,
  state: EditorState,
  draft: PathShape | null,
  world: Vec2
): Vec2 {
  return pointSnap(
    ctx,
    world,
    EMPTY_EXCLUDE,
    draft ? { extra: draftSnapTargets(state, draft) } : {}
  );
}

// ---- draft lifecycle ------------------------------------------------------

export function commitPenDraft(ctx: ToolContext) {
  const draft = ctx.penDraft.current;
  const extended = ctx.penExtend.current;
  ctx.penDraft.current = null;
  ctx.penExtend.current = null;
  clearDraftChrome(ctx);
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
  publishDraft(ctx);
  ctx.scheduleDraw();
}

/** Close the draft and commit it — the on-screen counterpart of clicking the
 *  first anchor, which is a small target on touch. */
export function closePenDraft(ctx: ToolContext) {
  const draft = ctx.penDraft.current;
  if (!draft || draftSubpath(draft).anchors.length < 2) return;
  draftSubpath(draft).closed = true;
  commitPenDraft(ctx);
}

export function cancelPenDraft(ctx: ToolContext) {
  ctx.penDraft.current = null;
  ctx.penExtend.current = null;
  clearDraftChrome(ctx);
  publishDraft(ctx);
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
  publishDraft(ctx);
  ctx.scheduleDraw();
}

// ---- pointer handling -----------------------------------------------------

export function onPenDown(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2,
  shift: boolean
) {
  const draft = ctx.penDraft.current;
  // Closing wins over snapping: the click lands exactly on the first anchor.
  if (draft && closesDraft(ctx, state, draft, screen)) {
    draftSubpath(draft).closed = true;
    commitPenDraft(ctx);
    return;
  }
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
    const snapped = penSnap(ctx, state, draft, world);
    world = draftInverse ? applyMatrix(draftInverse, snapped) : snapped;
  }
  if (!draft) {
    // Clicking an endpoint of an existing open path picks it up and
    // continues it; the commit then replaces the original shape. The pen takes
    // any open path, unlike the pencil (see pickupOpenPath).
    const pick = pickupOpenPath(ctx, state, screen, { requireSelected: false });
    if (pick) {
      // The prepared base is the baseline too, so a pickup that changes
      // nothing still compares equal and leaves the shape untouched.
      const baseline = pick.base;
      ctx.penExtend.current = baseline;
      const shape = structuredClone(baseline);
      ctx.penDraft.current = shape;
      ctx.preview.current = shape;
      ctx.interaction.current = {
        kind: "pen-anchor",
        index: draftSubpath(shape).anchors.length - 1,
        // The endpoint keeps whatever incoming handle it already had; the drag
        // may only pull the new outgoing one.
        keepIn: true,
      };
      publishDraft(ctx);
      ctx.scheduleDraw();
      return;
    }
    const shape: PathShape = {
      id: makeId("path"),
      name: "Curve",
      type: "path",
      subpaths: [
        { anchors: [{ p: world, hIn: null, hOut: null }], closed: false },
      ],
      fillRule: "nonzero",
      ...styleFromDefaults(state.style),
      ...markersFromDefaults(state.style),
    };
    ctx.penDraft.current = shape;
    ctx.preview.current = shape;
    ctx.interaction.current = { kind: "pen-anchor", index: 0, keepIn: false };
    publishDraft(ctx);
    ctx.scheduleDraw();
    return;
  }

  const sp = draftSubpath(draft);
  sp.anchors.push({ p: world, hIn: null, hOut: null });
  ctx.preview.current = draft;
  ctx.interaction.current = {
    kind: "pen-anchor",
    index: sp.anchors.length - 1,
    keepIn: false,
  };
  publishDraft(ctx);
  ctx.scheduleDraw();
}

/**
 * Dragging right after placing an anchor pulls out its handles. Normally both
 * come out together (a symmetric anchor); Alt — or continuing an existing
 * endpoint, whose incoming handle belongs to the segment already drawn —
 * leaves the incoming handle alone, so the anchor becomes a cusp with an
 * independent outgoing handle. That is the corner-to-curve transition, which
 * otherwise needed a trip through the Node tool.
 */
export function onPenAnchorMove(
  ctx: ToolContext,
  state: EditorState,
  inter: Extract<Interaction, { kind: "pen-anchor" }>,
  world: Vec2,
  shiftKey: boolean,
  altKey: boolean
) {
  const draft = ctx.penDraft.current;
  if (!draft) return;
  const inverse = invertMatrix(shapeWorldMatrix(state.doc, draft));
  const localWorld = inverse ? applyMatrix(inverse, world) : world;
  const a = draftSubpath(draft).anchors[inter.index];
  const target = shiftKey ? constrain45(a.p, localWorld) : localWorld;
  a.hOut = target;
  if (altKey || inter.keepIn) {
    // Tag it explicitly: a stale "smooth"/"symmetric" tag would make the Node
    // tool re-link the handles we just deliberately broke apart.
    a.t = "cusp";
  } else {
    a.hIn = { x: 2 * a.p.x - target.x, y: 2 * a.p.y - target.y };
    a.t = "symmetric";
  }
  ctx.scheduleDraw();
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
  const screen = worldToScreen(state.viewport, world);
  if (closesDraft(ctx, state, draft, screen)) {
    // Pull the preview onto the first anchor: the click will land there too.
    ctx.guides.current = [];
    ctx.hover.current = { p: anchors[0].p, close: true };
  } else if (shiftKey && last) {
    ctx.guides.current = [];
    ctx.hover.current = { p: constrain45(last.p, localWorld), close: false };
  } else {
    const snapped = penSnap(ctx, state, draft, world);
    ctx.hover.current = {
      p: inverse ? applyMatrix(inverse, snapped) : snapped,
      close: false,
    };
  }
  ctx.scheduleDraw();
}

/** Cursor for both the pen and pencil tools. */
export function penPencilCursor(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2
): string {
  // Mid-draft the pen's "connect here" affordance means "click to close";
  // otherwise both tools point at whatever endpoint their hint is ringing.
  const draft = state.tool === "pen" ? ctx.penDraft.current : null;
  if (draft) {
    return closesDraft(ctx, state, draft, screen) ? "pointer" : "crosshair";
  }
  return ctx.endpointHint.current ? "pointer" : "crosshair";
}
