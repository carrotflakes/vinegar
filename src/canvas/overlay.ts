import type { Guide, Spacing } from "../model/snap";
import { applyMatrix } from "../model/matrix";
import type { Artboard, Bounds, BezierShape, Matrix, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";
import { HANDLE_IDS, HANDLE_SIZE, handlePoint } from "./handles";
import {
  frameCorners,
  frameHandlePoint,
  frameRotationPoint,
  type SelectionFrame,
} from "./frame";
import { ANCHOR_SIZE, HANDLE_DOT, nodeSubpaths, type NodeEditShape } from "./nodes";
import { CORNER_RADIUS_HANDLE_SIZE } from "./cornerRadiusHandle";

const ACCENT = "#3b82f6";

export interface OverlayOptions {
  dpr: number;
  viewport: Viewport;
  /** Oriented frame around the current selection, if any. */
  frame: SelectionFrame | null;
  /** Screen-space marquee rect, if a selection drag is active. */
  marquee: Bounds | null;
  /** Whether resize/rotate handles should be drawn. */
  showHandles: boolean;
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
    const nw = worldToScreen(viewport, { x: b.x, y: b.y });
    const se = worldToScreen(viewport, { x: b.x + b.width, y: b.y + b.height });
    ctx.strokeStyle = "rgba(150,160,175,0.85)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.strokeRect(nw.x + 0.5, nw.y + 0.5, se.x - nw.x, se.y - nw.y);
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

/**
 * Draw artboard name labels (all boards) and the selection frame + resize
 * handles for the selected board, in screen space.
 */
export function drawArtboardChrome(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  artboards: Artboard[],
  selectedId: string | null,
  handleSize = HANDLE_SIZE
): void {
  if (artboards.length === 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toS = (w: Vec2) => worldToScreen(viewport, w);

  ctx.font =
    "11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "bottom";
  for (const ab of artboards) {
    const p = toS({ x: ab.x, y: ab.y });
    ctx.fillStyle = ab.id === selectedId ? ACCENT : "#8a9099";
    ctx.fillText(ab.name, p.x, p.y - 4);
  }

  const selected = artboards.find((ab) => ab.id === selectedId);
  if (!selected) return;

  const b: Bounds = {
    x: selected.x,
    y: selected.y,
    width: selected.width,
    height: selected.height,
  };
  const nw = toS({ x: b.x, y: b.y });
  const se = toS({ x: b.x + b.width, y: b.y + b.height });
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1;
  ctx.strokeRect(nw.x + 0.5, nw.y + 0.5, se.x - nw.x, se.y - nw.y);

  const half = handleSize / 2;
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  for (const id of HANDLE_IDS) {
    const sp = toS(handlePoint(b, id));
    ctx.beginPath();
    ctx.rect(Math.round(sp.x - half), Math.round(sp.y - half), handleSize, handleSize);
    ctx.fill();
    ctx.stroke();
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
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    if (s.horizontal) {
      ctx.moveTo(p1.x, p1.y - tick);
      ctx.lineTo(p1.x, p1.y + tick);
      ctx.moveTo(p2.x, p2.y - tick);
      ctx.lineTo(p2.x, p2.y + tick);
    } else {
      ctx.moveTo(p1.x - tick, p1.y);
      ctx.lineTo(p1.x + tick, p1.y);
      ctx.moveTo(p2.x - tick, p2.y);
      ctx.lineTo(p2.x + tick, p2.y);
    }
    ctx.stroke();
  }
}

function square(ctx: CanvasRenderingContext2D, c: Vec2, size: number): void {
  const h = size / 2;
  ctx.beginPath();
  ctx.rect(Math.round(c.x - h), Math.round(c.y - h), size, size);
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
  active: { sub: number; index: number } | null,
  anchorSize = ANCHOR_SIZE,
  dotSize = HANDLE_DOT
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toS = (w: Vec2) => worldToScreen(viewport, applyMatrix(transform, w));
  const subpaths = nodeSubpaths(shape);

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

  // Anchor squares.
  ctx.lineWidth = 1.5;
  subpaths.forEach((subpath, sub) => {
    subpath.anchors.forEach((a, i) => {
      const sp = toS(a.p);
      square(ctx, sp, anchorSize);
      ctx.fillStyle =
        active && active.sub === sub && active.index === i
          ? ACCENT
          : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.stroke();
    });
  });
}

/** Draw the in-progress pen path: placed anchors plus a rubber-band segment. */
export function drawPenDraft(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  viewport: Viewport,
  shape: BezierShape,
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
  const a = worldToScreen(viewport, start);
  const b = worldToScreen(viewport, current);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.setLineDash([]);
}
