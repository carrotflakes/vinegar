import type { Guide, Spacing } from "@/model/geometry/snap";
import { applyMatrix } from "@/model/geometry/matrix";
import { effectiveAnchorType } from "@/model/path/anchorType";
import type { Bounds, PathShape, Matrix, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "@/model/geometry/viewport";
import { HANDLE_IDS, HANDLE_SIZE } from "./handles";
import {
  frameCorners,
  frameHandlePoint,
  frameRotationPoint,
  type SelectionFrame,
} from "./frame";
import {
  ANCHOR_SIZE,
  HANDLE_DOT,
  WIDTH_KNOB,
  brushWidthKnobs,
  nodeSubpaths,
  type NodeEditShape,
} from "./nodes";
import { CORNER_RADIUS_HANDLE_SIZE } from "./cornerRadiusHandle";

const ACCENT = "#3b82f6";
/** Width knobs get their own hue so they read apart from Bézier handles. */
const WIDTH_ACCENT = "#f0a132";

export interface OverlayOptions {
  dpr: number;
  viewport: Viewport;
  /** Oriented frame around the current selection, if any. */
  frame: SelectionFrame | null;
  /** Screen-space marquee rect, if a selection drag is active. */
  marquee: Bounds | null;
  /** Whether resize/rotate handles should be drawn. */
  showHandles: boolean;
  /** Suppress the rotation stalk/handle and pivot marker (e.g. for frames,
   *  which are never rotated). Resize handles are still drawn. */
  hideRotate?: boolean;
  /** Screen-space size of resize handles (enlarged for touch). */
  handleSize?: number;
  /** World bounds of the drilled-into group, outlined to show isolation. */
  activeGroupBounds?: Bounds | null;
  /** Screen-space center of the selected rectangle's shared-radius control. */
  cornerRadiusHandle?: Vec2 | null;
}

/** Draw selection chrome on top of the rendered scene, in screen space. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  opts: OverlayOptions
): void {
  const { dpr, viewport, frame, marquee } = opts;
  const handleSize = opts.handleSize ?? HANDLE_SIZE;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (opts.activeGroupBounds) {
    const b = opts.activeGroupBounds;
    const corners = [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
      { x: b.x, y: b.y + b.height },
    ].map((point) => worldToScreen(viewport, point));
    ctx.strokeStyle = "rgba(150,160,175,0.85)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (frame) {
    const toS = (w: Vec2) => worldToScreen(viewport, w);
    const corners = frameCorners(frame).map(toS);

    // Oriented bounding box.
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++)
      ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    if (opts.showHandles) {
      // Rotation handle: a stalk above the top edge ending in a circle.
      if (!opts.hideRotate) {
        const topMid = toS(frameHandlePoint(frame, "n"));
        const rot = toS(frameRotationPoint(frame, viewport.scale));
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(topMid.x, topMid.y);
        ctx.lineTo(rot.x, rot.y);
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rot.x, rot.y, handleSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Resize handles.
      const half = handleSize / 2;
      ctx.fillStyle = "#ffffff";
      for (const id of HANDLE_IDS) {
        const sp = toS(frameHandlePoint(frame, id));
        ctx.beginPath();
        ctx.rect(
          Math.round(sp.x - half),
          Math.round(sp.y - half),
          handleSize,
          handleSize
        );
        ctx.fill();
        ctx.stroke();
      }

      // Rotation pivot: target marker, draggable independently of the frame.
      if (!opts.hideRotate) {
        const pivot = toS(frame.pivot);
        const radius = Math.max(4, handleSize * 0.45);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pivot.x, pivot.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pivot.x - radius - 3, pivot.y);
        ctx.lineTo(pivot.x + radius + 3, pivot.y);
        ctx.moveTo(pivot.x, pivot.y - radius - 3);
        ctx.lineTo(pivot.x, pivot.y + radius + 3);
        ctx.stroke();
      }

      if (opts.cornerRadiusHandle) {
        const control = opts.cornerRadiusHandle;
        const controlRadius = (CORNER_RADIUS_HANDLE_SIZE * handleSize) / HANDLE_SIZE / 2;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(control.x, control.y, controlRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  if (marquee) {
    ctx.fillStyle = "rgba(59,130,246,0.12)";
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
    ctx.strokeRect(
      marquee.x + 0.5,
      marquee.y + 0.5,
      marquee.width,
      marquee.height
    );
  }
}

/** A frame's name and the world position of its top-left corner. */
export interface FrameLabel {
  name: string;
  topLeft: Vec2;
  selected: boolean;
}

/** Highlight the frame a move drag would drop into, given its four world-space
 *  content-box corners. Drawn as a bold accent outline in screen space. */
export function drawFrameDropTarget(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  corners: Vec2[]
): void {
  if (corners.length < 3) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pts = corners.map((w) => worldToScreen(viewport, w));
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
}

/** Draw frame name labels above each frame's top-left corner, in screen space.
 *  The selection frame + resize handles are drawn by the normal overlay. */
export function drawFrameLabels(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  labels: FrameLabel[]
): void {
  if (labels.length === 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "bottom";
  for (const label of labels) {
    const p = worldToScreen(viewport, label.topLeft);
    ctx.fillStyle = label.selected ? ACCENT : "#8a9099";
    ctx.fillText(label.name, p.x, p.y - 4);
  }
}

/** Draw magenta alignment guides (in screen space). */
export function drawGuides(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  guides: Guide[]
): void {
  if (guides.length === 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#f0398b";
  ctx.lineWidth = 1;
  for (const g of guides) {
    if (g.axis === "x") {
      const a = worldToScreen(viewport, { x: g.value, y: g.from });
      const b = worldToScreen(viewport, { x: g.value, y: g.to });
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x) + 0.5, a.y);
      ctx.lineTo(Math.round(b.x) + 0.5, b.y);
      ctx.stroke();
    } else {
      const a = worldToScreen(viewport, { x: g.from, y: g.value });
      const b = worldToScreen(viewport, { x: g.to, y: g.value });
      ctx.beginPath();
      ctx.moveTo(a.x, Math.round(a.y) + 0.5);
      ctx.lineTo(b.x, Math.round(b.y) + 0.5);
      ctx.stroke();
    }
  }
}

/** Draw equal-spacing marker bars with end ticks (in screen space). */
export function drawSpacings(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  spacings: Spacing[]
): void {
  if (spacings.length === 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#f0398b";
  ctx.lineWidth = 1;
  const tick = 4;
  for (const s of spacings) {
    const p1 = s.horizontal
      ? worldToScreen(viewport, { x: s.a, y: s.pos })
      : worldToScreen(viewport, { x: s.pos, y: s.a });
    const p2 = s.horizontal
      ? worldToScreen(viewport, { x: s.b, y: s.pos })
      : worldToScreen(viewport, { x: s.pos, y: s.b });
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy) || 1;
    const tx = (-dy / length) * tick;
    const ty = (dx / length) * tick;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.moveTo(p1.x - tx, p1.y - ty);
    ctx.lineTo(p1.x + tx, p1.y + ty);
    ctx.moveTo(p2.x - tx, p2.y - ty);
    ctx.lineTo(p2.x + tx, p2.y + ty);
    ctx.stroke();
  }
}

function square(ctx: CanvasRenderingContext2D, c: Vec2, size: number): void {
  const h = size / 2;
  ctx.beginPath();
  ctx.rect(Math.round(c.x - h), Math.round(c.y - h), size, size);
}

function diamond(ctx: CanvasRenderingContext2D, c: Vec2, size: number): void {
  const h = size / 2;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - h);
  ctx.lineTo(c.x + h, c.y);
  ctx.lineTo(c.x, c.y + h);
  ctx.lineTo(c.x - h, c.y);
  ctx.closePath();
}

function dot(ctx: CanvasRenderingContext2D, c: Vec2, r: number): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
}

/** Draw the anchors and control handles of a Bézier shape (node editing). */
export function drawNodes(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  shape: NodeEditShape,
  transform: Matrix,
  active: readonly { sub: number; index: number }[],
  anchorSize = ANCHOR_SIZE,
  dotSize = HANDLE_DOT,
  knobSize = WIDTH_KNOB
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toS = (w: Vec2) => worldToScreen(viewport, applyMatrix(transform, w));
  const subpaths = nodeSubpaths(shape);
  const selected = new Set(active.map((node) => `${node.sub}:${node.index}`));

  // Handle lines + dots.
  ctx.strokeStyle = "#9bbcf6";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (const subpath of subpaths) {
    for (const a of subpath.anchors) {
      const sp = toS(a.p);
      for (const h of [a.hIn, a.hOut]) {
        if (!h) continue;
        const sh = toS(h);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sh.x, sh.y);
        ctx.stroke();
        dot(ctx, sh, dotSize / 2);
        ctx.fill();
        ctx.strokeStyle = ACCENT;
        ctx.stroke();
        ctx.strokeStyle = "#9bbcf6";
      }
    }
  }

  // Width knobs, on the selected anchors of a brush only. Drawn under the
  // anchor squares so the anchor stays readable when the stroke is thin.
  if (shape.type === "brush") {
    const knobs = brushWidthKnobs(
      shape,
      transform,
      viewport,
      active.filter((node) => node.sub === 0).map((node) => node.index)
    );
    ctx.lineWidth = 1;
    for (const knob of knobs) {
      // A bar from the anchor out to the knob, reading as the half-width.
      ctx.strokeStyle = WIDTH_ACCENT;
      ctx.beginPath();
      ctx.moveTo(knob.anchorScreen.x, knob.anchorScreen.y);
      ctx.lineTo(knob.screen.x, knob.screen.y);
      ctx.stroke();
      diamond(ctx, knob.screen, knobSize);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.stroke();
    }
  }

  // Anchor markers: cusp = square, smooth = circle, symmetric = diamond.
  ctx.lineWidth = 1.5;
  subpaths.forEach((subpath, sub) => {
    subpath.anchors.forEach((a, i) => {
      const sp = toS(a.p);
      const type = effectiveAnchorType(a);
      if (type === "smooth") dot(ctx, sp, anchorSize / 2);
      else if (type === "symmetric") diamond(ctx, sp, anchorSize);
      else square(ctx, sp, anchorSize);
      ctx.fillStyle = selected.has(`${sub}:${i}`) ? ACCENT : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.stroke();
    });
  });
}

/**
 * Draw the brush/eraser tip outline under a hovering pen. Pens report hover
 * before they touch down, so this previews the stroke width at the exact spot
 * the next stroke will start. Fingers have no hover, so this never appears for
 * touch and never needs to be cleared by one.
 */
export function drawBrushCursor(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  hover: Vec2,
  worldRadius: number
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const p = worldToScreen(viewport, hover);
  const r = worldRadius * viewport.scale;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(r, 1), 0, Math.PI * 2);
  // A dark hairline under a light one, so the ring reads on any artwork.
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();
}

/**
 * Ring over the endpoint of a selected open path that the pencil would continue
 * if a stroke started now. A hollow accent disc, sized like a node handle, so it
 * reads as "connect here" without hiding the anchor beneath it.
 */
export function drawEndpointHint(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  world: Vec2
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const p = worldToScreen(viewport, world);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();
}

/** Draw the in-progress pen path: placed anchors plus a rubber-band segment. */
export function drawPenDraft(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  shape: PathShape,
  transform: Matrix,
  hover: Vec2 | null
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toS = (w: Vec2) => worldToScreen(viewport, applyMatrix(transform, w));
  // The pen always drafts a single subpath.
  const anchors = shape.subpaths[0]?.anchors ?? [];
  if (anchors.length === 0) return;

  // Rubber band from the last anchor to the cursor, curving out via its handle.
  if (hover) {
    const last = anchors[anchors.length - 1];
    const from = toS(last.p);
    const c1 = toS(last.hOut ?? last.p);
    const to = toS(hover);
    ctx.strokeStyle = "#c7d7f7";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(c1.x, c1.y, to.x, to.y, to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Handle dots.
  ctx.strokeStyle = "#9bbcf6";
  for (const a of anchors) {
    const sp = toS(a.p);
    for (const h of [a.hIn, a.hOut]) {
      if (!h) continue;
      const sh = toS(h);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sh.x, sh.y);
      ctx.stroke();
    }
  }

  // Anchor squares; highlight the first so users see where to close.
  anchors.forEach((a, i) => {
    const sp = toS(a.p);
    square(ctx, sp, ANCHOR_SIZE);
    ctx.fillStyle = i === 0 ? ACCENT : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

/** Rubber-band rectangle swept while dragging out an area-text box. */
export function drawTextDraft(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  start: Vec2,
  current: Vec2
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ].map((point) => worldToScreen(viewport, point));
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}
