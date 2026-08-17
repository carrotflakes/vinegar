// Persistent document guides on the canvas: where a guide lands on screen,
// what the pointer hits, and how it is drawn. The model lives in doc.guides
// (see docs/design/rulers-and-guides.md); the transient magenta alignment guides of
// geometry/snap.ts are a different thing entirely.

import {
  guidePositions,
  NO_GUIDE_LINES,
  type GuidePositions,
} from "@/model/geometry/snap";
import { worldToScreen, type Viewport } from "@/model/geometry/viewport";
import type { Document, GuideLine, Vec2 } from "../model/types";
import type { EditorData } from "../store/state";

const GUIDE_COLOR = "#3fb9d4";
const GUIDE_SELECTED_COLOR = "#ff8f3f";
/** Screen-space pick radius around a guide. */
export const GUIDE_HIT = 4;

/** A guide as a screen-space segment long enough to cross the whole canvas. */
export interface GuideSegment {
  a: Vec2;
  b: Vec2;
}

interface CanvasSize {
  width: number;
  height: number;
}

/**
 * The guide, in screen space. A guide is an infinite world line, so this
 * returns a segment extended well past the canvas in both directions along the
 * line's screen direction (which is not axis-aligned under canvas rotation).
 */
export function guideSegment(
  viewport: Viewport,
  guide: GuideLine,
  size: CanvasSize
): GuideSegment {
  const origin =
    guide.axis === "x"
      ? { x: guide.position, y: 0 }
      : { x: 0, y: guide.position };
  const along =
    guide.axis === "x"
      ? { x: guide.position, y: 1 }
      : { x: 1, y: guide.position };
  const p = worldToScreen(viewport, origin);
  const q = worldToScreen(viewport, along);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // Reach past the canvas even when the line's world origin sits far off-screen.
  const reach =
    2 * (size.width + size.height) + Math.abs(p.x) + Math.abs(p.y);
  return {
    a: { x: p.x - ux * reach, y: p.y - uy * reach },
    b: { x: p.x + ux * reach, y: p.y + uy * reach },
  };
}

/** The frontmost guide within `tolerance` screen pixels of `screen`, if any. */
export function pickGuide(
  doc: Document,
  viewport: Viewport,
  screen: Vec2,
  size: CanvasSize,
  tolerance = GUIDE_HIT
): GuideLine | null {
  for (let i = doc.guides.length - 1; i >= 0; i--) {
    const guide = doc.guides[i];
    const { a, b } = guideSegment(viewport, guide, size);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    // Perpendicular distance to the (effectively infinite) line.
    const distance =
      Math.abs(dx * (a.y - screen.y) - dy * (a.x - screen.x)) / length;
    if (distance <= tolerance) return guide;
  }
  return null;
}

/** The world coordinate a guide of this axis would take at a pointer position. */
export function guideValueAt(axis: "x" | "y", world: Vec2): number {
  return axis === "x" ? world.x : world.y;
}

/** Guide positions offered to the snapper: only visible guides, only when on.
 *  `excludeId` drops one guide — a guide being dragged must not snap to the
 *  line it is itself drawing, or it could never leave its starting position. */
export function activeGuideLines(
  state: Pick<EditorData, "doc" | "guideSnap" | "guidesVisible">,
  excludeId?: string
): GuidePositions {
  if (!state.guideSnap || !state.guidesVisible) return NO_GUIDE_LINES;
  return guidePositions(
    excludeId === undefined
      ? state.doc.guides
      : state.doc.guides.filter((guide) => guide.id !== excludeId)
  );
}

/** Draw the document's guides (screen space), highlighting the selected one. */
export function drawDocumentGuides(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  size: CanvasSize,
  guides: readonly GuideLine[],
  selectedId: string | null
): void {
  if (guides.length === 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();
  // Clip to the canvas so the long extension segments cannot bleed anywhere.
  ctx.beginPath();
  ctx.rect(0, 0, size.width, size.height);
  ctx.clip();
  for (const guide of guides) {
    const { a, b } = guideSegment(viewport, guide, size);
    const selected = guide.id === selectedId;
    ctx.strokeStyle = selected ? GUIDE_SELECTED_COLOR : GUIDE_COLOR;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath();
    // Half-pixel alignment keeps an axis-aligned guide crisp.
    if (Math.abs(a.x - b.x) < 0.5) {
      const x = Math.round(a.x) + 0.5;
      ctx.moveTo(x, a.y);
      ctx.lineTo(x, b.y);
    } else if (Math.abs(a.y - b.y) < 0.5) {
      const y = Math.round(a.y) + 0.5;
      ctx.moveTo(a.x, y);
      ctx.lineTo(b.x, y);
    } else {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
