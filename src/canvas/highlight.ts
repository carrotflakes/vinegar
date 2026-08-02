import { nodeWorldBounds, shapeBounds } from "@/model/geometry/bounds";
import { matrixScale, shapeWorldMatrix } from "@/model/geometry/matrix";
import { isShape } from "@/model/scene";
import type { Bounds, Document, Shape, Vec2 } from "@/model/types";
import { worldToScreen, type Viewport } from "@/model/geometry/viewport";
import { cachedShapePath, tracePath } from "./render/path";
import { resolvedSubpaths } from "@/model/path/pathModifiers";

const HIGHLIGHT = "#3b82f6";
/**
 * A locked node under the pointer. Deliberately not the accent: it marks what
 * a click will *not* take, so it has to read as a different kind of statement
 * from "this is what you would get".
 */
const LOCKED = "#cbd5e1";
/** Dash pattern (CSS px) of the locked outline. */
const LOCKED_DASH = [5, 4];
/**
 * Dark backing line under the accent one. The outline lands on artwork of any
 * color, so a single stroke disappears against something close to its own hue;
 * two contrasting lines always leave one of them visible.
 */
const HALO = "rgba(0,0,0,0.45)";
/** Resting outline width in CSS pixels. */
const OUTLINE_WIDTH = 1.5;
/** Extra width and interior wash at the peak of the hover pulse. */
const PULSE_WIDTH = 3;
const PULSE_WASH = 0.22;
/** Pulse length in ms. See `highlightPulse` for why this stays short. */
export const PULSE_MS = 260;
/** Inset of the off-screen arrow from the viewport edge, in CSS pixels. */
const ARROW_INSET = 26;
const ARROW_SIZE = 9;

/**
 * Pulse strength (1 → 0) for a highlight that started at `at`, or 0 once it has
 * settled. The canvas has no dirty-region redraw, so every animated frame costs
 * a full scene repaint: this is a one-shot burst on hover, never a loop.
 */
export function highlightPulse(at: number, now: number): number {
  const t = Math.min(Math.max((now - at) / PULSE_MS, 0), 1);
  return (1 - t) ** 2;
}

/** Screen-space bounds of a world-space box under the current viewport. */
function screenBounds(viewport: Viewport, b: Bounds): Bounds {
  const corners = [
    worldToScreen(viewport, { x: b.x, y: b.y }),
    worldToScreen(viewport, { x: b.x + b.width, y: b.y }),
    worldToScreen(viewport, { x: b.x + b.width, y: b.y + b.height }),
    worldToScreen(viewport, { x: b.x, y: b.y + b.height }),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Build the highlight geometry of a leaf onto the current path. */
function traceLeaf(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  shape: Shape
): Path2D | null {
  // Text and images have no vector outline of their own; use their box.
  if (shape.type === "text" || shape.type === "image") {
    const b = shapeBounds(shape, doc);
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.width, b.height);
    return null;
  }
  const path = cachedShapePath(shape, doc);
  if (path) return path;
  tracePath(ctx, shape, true, doc);
  return null;
}

/**
 * Whether the pulse may wash a leaf's interior. Filling an open path silently
 * closes it, which paints a face a curve never had, so those get the outline
 * alone. Compound-path components are always closed.
 */
function fillable(shape: Shape): boolean {
  if (shape.type === "line") return false;
  if (shape.type === "path") {
    const subpaths = resolvedSubpaths(shape);
    return subpaths.length > 0 && subpaths.every((sp) => sp.closed);
  }
  return true;
}

/** Outline one leaf along its real geometry, in world space. */
function outlineShape(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  shape: Shape,
  viewport: Viewport,
  pulse: number,
  accent: string,
  dash: number[]
): void {
  const m = shapeWorldMatrix(doc, shape);
  ctx.save();
  ctx.transform(...m);
  // The transform stack already carries the viewport zoom and the node's own
  // scale, so undo both to keep the outline a constant screen width.
  const unit = 1 / (viewport.scale * matrixScale(m));
  const path = traceLeaf(ctx, doc, shape);
  const stroke = () => (path ? ctx.stroke(path) : ctx.stroke());

  if (pulse > 0 && fillable(shape)) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = PULSE_WASH * pulse;
    if (path) ctx.fill(path, "evenodd");
    else ctx.fill("evenodd");
    ctx.globalAlpha = 1;
  }
  const width = OUTLINE_WIDTH + PULSE_WIDTH * pulse;
  // The dash pattern is authored in screen pixels like the widths are, so it
  // has to be scaled into the world space this strokes in.
  if (dash.length) ctx.setLineDash(dash.map((step) => step * unit));
  ctx.strokeStyle = HALO;
  ctx.lineWidth = (width + 2) * unit;
  stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = width * unit;
  stroke();
  ctx.restore();
}

/**
 * Outline a container by its box, the way every editor does: tracing each leaf
 * inside a group turns a hover into a wall of lines, and says less about what
 * the group *is* than its extent does.
 */
function outlineBox(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  bounds: Bounds,
  pulse: number,
  accent: string,
  dash: number[]
): void {
  const corners = [
    worldToScreen(viewport, { x: bounds.x, y: bounds.y }),
    worldToScreen(viewport, { x: bounds.x + bounds.width, y: bounds.y }),
    worldToScreen(viewport, {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    }),
    worldToScreen(viewport, { x: bounds.x, y: bounds.y + bounds.height }),
  ];
  const box = () => {
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
  };
  if (pulse > 0) {
    box();
    ctx.fillStyle = accent;
    ctx.globalAlpha = PULSE_WASH * 0.6 * pulse;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const width = OUTLINE_WIDTH + PULSE_WIDTH * pulse;
  if (dash.length) ctx.setLineDash(dash);
  box();
  ctx.strokeStyle = HALO;
  ctx.lineWidth = width + 2;
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = width;
  ctx.stroke();
}

/**
 * Padlock badge, drawn in screen space at a corner of the outlined node. The
 * dashed outline alone reads as "some other kind of line" — the lock is what
 * makes it say *why* the click will pass through.
 */
function drawLockBadge(
  ctx: CanvasRenderingContext2D,
  at: Vec2,
  accent: string
): void {
  const bodyW = 9;
  const bodyH = 7;
  const x = at.x;
  const y = at.y;
  ctx.save();
  // The badge follows a dashed outline; its own strokes are solid.
  ctx.setLineDash([]);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Shackle first, so the body covers where it meets the case.
  const shackle = () => {
    ctx.beginPath();
    ctx.arc(x, y - bodyH / 2, 2.4, Math.PI, 0);
  };
  const body = () => {
    ctx.beginPath();
    ctx.rect(x - bodyW / 2, y - bodyH / 2, bodyW, bodyH);
  };
  // Dark backing, for the same reason the outline has a halo.
  ctx.strokeStyle = HALO;
  ctx.lineWidth = 4;
  shackle();
  ctx.stroke();
  body();
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.6;
  shackle();
  ctx.stroke();
  ctx.fillStyle = accent;
  body();
  ctx.fill();
  ctx.restore();
}

/**
 * Arrow at the viewport edge pointing at a highlighted node that sits outside
 * the view, so hovering a layer row still says where its artwork is.
 */
function drawOffscreenArrow(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  target: Vec2,
  pulse: number,
  rulerInset: number
): void {
  const center = { x: size.width / 2, y: size.height / 2 };
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const dir = { x: dx / len, y: dy / len };

  // Walk from the center towards the target until the inset viewport edge. The
  // rulers are opaque bands painted after this, so the top/left inset has to
  // clear them or the arrow is drawn under them.
  const minX = Math.min(ARROW_INSET + rulerInset, center.x);
  const minY = Math.min(ARROW_INSET + rulerInset, center.y);
  const maxX = Math.max(size.width - ARROW_INSET, center.x);
  const maxY = Math.max(size.height - ARROW_INSET, center.y);
  const axis = (d: number, lo: number, hi: number, c: number) =>
    d > 0 ? (hi - c) / d : d < 0 ? (lo - c) / d : Infinity;
  const t = Math.min(
    axis(dir.x, minX, maxX, center.x),
    axis(dir.y, minY, maxY, center.y)
  );
  // The pulse starts the arrow inside and lets it settle outwards, which reads
  // as "over there" without ever leaving the inset box.
  const tip = {
    x: center.x + dir.x * (t - 6 * pulse),
    y: center.y + dir.y * (t - 6 * pulse),
  };
  const normal = { x: -dir.y, y: dir.x };
  const s = ARROW_SIZE * (1 + 0.35 * pulse);

  ctx.save();
  ctx.fillStyle = HIGHLIGHT;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tip.x + dir.x * s, tip.y + dir.y * s);
  ctx.lineTo(
    tip.x - dir.x * s + normal.x * s * 0.8,
    tip.y - dir.y * s + normal.y * s * 0.8
  );
  ctx.lineTo(
    tip.x - dir.x * s - normal.x * s * 0.8,
    tip.y - dir.y * s - normal.y * s * 0.8
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Outline a node the pointer is over: a leaf along its real geometry (a box
 * alone is ambiguous when shapes overlap), a container by its extent. A node
 * entirely outside the view gets an edge arrow pointing towards it.
 * `pulse` (1 → 0) briefly thickens the outline and washes the interior when the
 * hover starts, which is what actually catches the eye — the resting outline is
 * quiet on purpose.
 *
 * The "locked" variant is the same drawing in a muted dashed line with a
 * padlock badge: it marks something a click will pass *through*, which has to
 * be distinguishable at a glance from what the click would take.
 */
export function drawNodeHighlight(
  ctx: CanvasRenderingContext2D,
  opts: {
    dpr: number;
    size: { width: number; height: number };
    viewport: Viewport;
    doc: Document;
    nodeId: string;
    pulse: number;
    /** Screen space the rulers cover on the top/left edges (0 when hidden). */
    rulerInset: number;
    variant?: "accent" | "locked";
  }
): void {
  const { dpr, size, viewport, doc, nodeId, pulse, rulerInset } = opts;
  const locked = opts.variant === "locked";
  const accent = locked ? LOCKED : HIGHLIGHT;
  const dash = locked ? LOCKED_DASH : [];
  const bounds = nodeWorldBounds(doc, nodeId);
  if (!bounds) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const b = screenBounds(viewport, bounds);
  const offscreen =
    b.x + b.width < 0 ||
    b.y + b.height < 0 ||
    b.x > size.width ||
    b.y > size.height;
  if (offscreen) {
    drawOffscreenArrow(
      ctx,
      size,
      { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      pulse,
      rulerInset
    );
    return;
  }

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineJoin = "round";
  const node = doc.nodes[nodeId];
  if (isShape(node)) {
    // World-space drawing, matching renderScene's viewport transform.
    ctx.translate(viewport.offset.x, viewport.offset.y);
    ctx.rotate(viewport.rotation);
    ctx.scale(viewport.flipX ? -viewport.scale : viewport.scale, viewport.scale);
    outlineShape(ctx, doc, node, viewport, pulse, accent, dash);
  } else {
    outlineBox(ctx, viewport, bounds, pulse, accent, dash);
  }
  ctx.restore();

  if (locked) {
    // Top-left of the outline, kept inside the viewport (and clear of the
    // rulers) so a locked background bigger than the screen still shows it.
    const inset = 9;
    drawLockBadge(
      ctx,
      {
        x: Math.min(Math.max(b.x + inset, rulerInset + inset), size.width - inset),
        y: Math.min(Math.max(b.y + inset, rulerInset + inset), size.height - inset),
      },
      accent
    );
  }
}
