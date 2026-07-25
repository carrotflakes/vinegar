// Canvas rulers: the tick geometry and their drawing. Rulers are editor chrome
// painted into the main canvas (like frame labels), so they never reach an
// export and hit-testing stays in the normal pointer pipeline.
// See docs/rulers-and-guides.md.

import { nodeWorldMatrix } from "@/model/geometry/matrix";
import { isFrame } from "../model/scene";
import { formatUnits, toUnits, worldPerUnit } from "../model/units";
import { screenToWorld, type Viewport } from "@/model/geometry/viewport";
import type { Document, Vec2 } from "../model/types";
import type { CanvasTheme } from "./canvasTheme";

/** Thickness of each ruler band, in CSS pixels. */
export const RULER_SIZE = 20;
/** Rough spacing aimed for between labelled ticks. */
const LABEL_SPACING = 72;

interface CanvasSize {
  width: number;
  height: number;
}

/**
 * How one ruler band maps screen positions to world coordinates.
 * `axis` is the *world* axis the band measures, which the canvas rotation can
 * swap; `null` means the view is rotated off the axes and no tick spacing is
 * meaningful (the band is drawn empty).
 */
export interface RulerAxis {
  axis: "x" | "y";
  /** World units per screen pixel along the band (negative when mirrored). */
  scale: number;
  /** World coordinate at screen position 0 along the band. */
  origin: number;
}

/** Which world axis the horizontal (top) / vertical (left) band measures. */
export function rulerAxis(
  viewport: Viewport,
  horizontal: boolean
): RulerAxis | null {
  const at = (t: number) =>
    screenToWorld(viewport, horizontal ? { x: t, y: 0 } : { x: 0, y: t });
  const a = at(0);
  const b = at(1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const eps = 1e-6 * (Math.abs(dx) + Math.abs(dy) || 1);
  if (Math.abs(dy) <= eps) return { axis: "x", scale: dx, origin: a.x };
  if (Math.abs(dx) <= eps) return { axis: "y", scale: dy, origin: a.y };
  return null;
}

/** Screen position along the band for a world coordinate on its axis. */
export function rulerScreenOf(map: RulerAxis, world: number): number {
  return (world - map.origin) / map.scale;
}

/** A 1/2/5×10ⁿ step, in document units, no smaller than `min`. */
export function niceStep(min: number): number {
  if (!(min > 0) || !Number.isFinite(min)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(min)));
  for (const factor of [1, 2, 5]) {
    if (magnitude * factor >= min) return magnitude * factor;
  }
  return magnitude * 10;
}

/**
 * The world coordinate the rulers count from: the top-left corner of the active
 * frame (Illustrator's artboard rulers), else the world origin. Display only —
 * guides and geometry stay in world coordinates. `activeFrameId` follows
 * deliberate acts, never panning; see `EditorData.activeFrameId`.
 */
export function rulerOrigin(doc: Document, activeFrameId: string | null): Vec2 {
  const frame = activeFrameId ? doc.nodes[activeFrameId] : null;
  if (!frame || !isFrame(frame)) return { x: 0, y: 0 };
  // Frames are axis-aligned containers, so the world matrix' translation is
  // their top-left corner.
  const m = nodeWorldMatrix(doc, frame.id);
  return { x: m[4], y: m[5] };
}

/** Which ruler band a screen point is in (the corner box counts as neither). */
export function rulerBandAt(
  screen: Vec2,
  size: CanvasSize
): "horizontal" | "vertical" | null {
  const inTop = screen.y >= 0 && screen.y < RULER_SIZE && screen.x < size.width;
  const inLeft = screen.x >= 0 && screen.x < RULER_SIZE && screen.y < size.height;
  if (inTop && inLeft) return null;
  if (inTop) return "horizontal";
  if (inLeft) return "vertical";
  return null;
}

/** Whether a screen point is over either ruler band or the corner box. */
export function overRulers(screen: Vec2, size: CanvasSize): boolean {
  return (
    (screen.y < RULER_SIZE && screen.x < size.width && screen.y >= 0) ||
    (screen.x < RULER_SIZE && screen.y < size.height && screen.x >= 0)
  );
}

export interface RulerInput {
  dpr: number;
  size: CanvasSize;
  viewport: Viewport;
  doc: Document;
  /** The frame the rulers count from (see EditorData.activeFrameId). */
  activeFrameId: string | null;
  theme: CanvasTheme;
  /**
   * Selection extent in world space, shaded on both bands. There is
   * deliberately no live cursor marker: it would force a full canvas repaint on
   * every pointer move (see docs/render-performance.md).
   */
  selection: { x: number; y: number; width: number; height: number } | null;
}

/** Paint both ruler bands and the corner box. */
export function drawRulers(
  ctx: CanvasRenderingContext2D,
  input: RulerInput
): void {
  const { dpr, size, viewport, doc, activeFrameId, theme, selection } = input;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();

  const { width, height } = size;
  const origin = rulerOrigin(doc, activeFrameId);
  const perUnit = worldPerUnit(doc.settings);

  // Bands.
  ctx.fillStyle = theme.ruler.bg;
  ctx.fillRect(0, 0, width, RULER_SIZE);
  ctx.fillRect(0, 0, RULER_SIZE, height);

  ctx.font = "10px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "alphabetic";

  for (const horizontal of [true, false]) {
    const map = rulerAxis(viewport, horizontal);
    if (!map) continue;
    const originWorld = map.axis === "x" ? origin.x : origin.y;
    const length = horizontal ? width : height;

    // Selection extent, shaded before the ticks.
    if (selection) {
      const lo = map.axis === "x" ? selection.x : selection.y;
      const hi = lo + (map.axis === "x" ? selection.width : selection.height);
      const a = rulerScreenOf(map, lo);
      const b = rulerScreenOf(map, hi);
      const from = Math.min(a, b);
      const span = Math.max(1, Math.abs(b - a));
      ctx.fillStyle = theme.ruler.highlight;
      if (horizontal) ctx.fillRect(from, 0, span, RULER_SIZE);
      else ctx.fillRect(0, from, RULER_SIZE, span);
    }

    // Tick step in document units, then back to world units for positioning.
    const unitsPerPixel = Math.abs(map.scale) / perUnit;
    const step = niceStep(unitsPerPixel * LABEL_SPACING);
    const minorStep = step / 5;
    const worldStep = step * perUnit;
    const worldMinor = minorStep * perUnit;
    if (!Number.isFinite(worldStep) || worldStep <= 0) continue;
    const drawMinor = worldMinor / Math.abs(map.scale) >= 4;

    const startWorld = map.origin;
    const endWorld = map.origin + map.scale * length;
    const lo = Math.min(startWorld, endWorld);
    const hi = Math.max(startWorld, endWorld);

    if (drawMinor) {
      ctx.strokeStyle = theme.ruler.tick;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const firstMinor =
        Math.floor((lo - originWorld) / worldMinor) * worldMinor + originWorld;
      for (let w = firstMinor; w <= hi; w += worldMinor) {
        const p = Math.round(rulerScreenOf(map, w)) + 0.5;
        if (horizontal) {
          ctx.moveTo(p, RULER_SIZE - 4);
          ctx.lineTo(p, RULER_SIZE);
        } else {
          ctx.moveTo(RULER_SIZE - 4, p);
          ctx.lineTo(RULER_SIZE, p);
        }
      }
      ctx.stroke();
    }

    ctx.strokeStyle = theme.ruler.tick;
    ctx.fillStyle = theme.ruler.text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const firstMajor =
      Math.floor((lo - originWorld) / worldStep) * worldStep + originWorld;
    const labels: { p: number; text: string }[] = [];
    for (let w = firstMajor; w <= hi; w += worldStep) {
      const p = Math.round(rulerScreenOf(map, w)) + 0.5;
      if (horizontal) {
        ctx.moveTo(p, RULER_SIZE - 8);
        ctx.lineTo(p, RULER_SIZE);
      } else {
        ctx.moveTo(RULER_SIZE - 8, p);
        ctx.lineTo(RULER_SIZE, p);
      }
      labels.push({
        p,
        text: formatUnits(toUnits(w - originWorld, doc.settings), step),
      });
    }
    ctx.stroke();

    for (const label of labels) {
      if (horizontal) {
        if (label.p < RULER_SIZE) continue;
        ctx.fillText(label.text, label.p + 3, 11);
      } else {
        // Vertical band: rotate so the number reads bottom-to-top.
        if (label.p < RULER_SIZE) continue;
        ctx.save();
        ctx.translate(11, label.p - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label.text, 0, 0);
        ctx.restore();
      }
    }
  }

  // Corner box and the inner borders.
  ctx.fillStyle = theme.ruler.bg;
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
  ctx.strokeStyle = theme.ruler.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE - 0.5);
  ctx.lineTo(width, RULER_SIZE - 0.5);
  ctx.moveTo(RULER_SIZE - 0.5, 0);
  ctx.lineTo(RULER_SIZE - 0.5, height);
  ctx.stroke();

  ctx.restore();
}
