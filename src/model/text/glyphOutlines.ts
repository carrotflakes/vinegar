import type { Font, Glyph, PathCommand } from "opentype.js";
import { getOutlineFont, subscribeFontCache } from "@/fontCache";
import { fontFileFor } from "@/fonts";
import { renderCachesDisabled } from "@/debug/renderFlags";
import type { PathAnchor, PathSubpath, TextShape, Vec2 } from "../types";
import { layoutTextInBrowser } from "./layout";

let cache = new WeakMap<TextShape, PathSubpath[] | null>();
// A font arriving turns nulls into geometry, so nothing may outlive the load.
subscribeFontCache(() => { cache = new WeakMap(); });

/**
 * Glyph geometry for a text shape, in the shape's own coordinate space (the
 * space `shape.x`/`shape.y` live in), or null when the text has no outlines to
 * give:
 *
 * - the family is a system font, or its file has not been parsed yet
 *   (`getOutlineFont` starts the load and the canvas repaints on arrival),
 * - the family ships no italic face for an italic shape, where the browser
 *   synthesises the slant and a sheared outline would not be the same shape,
 * - a character has no glyph in the font, where painting falls back to a
 *   system font whose outlines we cannot read.
 *
 * A null answer is never an error: every consumer keeps the behaviour it had
 * before text had geometry (a box, or `fillText`).
 */
export function textSubpaths(shape: TextShape): PathSubpath[] | null {
  if (!renderCachesDisabled) {
    const hit = cache.get(shape);
    if (hit !== undefined) return hit;
  }
  const result = buildTextSubpaths(shape);
  if (!renderCachesDisabled) cache.set(shape, result);
  return result;
}

/** Whether a style could be outlined once its font is loaded. */
export function hasOutlineFace(
  family: string,
  weight: number,
  italic: boolean
): boolean {
  return fontFileFor(family, weight, italic)?.italic === italic;
}

function buildTextSubpaths(shape: TextShape): PathSubpath[] | null {
  if (!hasOutlineFace(shape.fontFamily, shape.fontWeight, shape.italic)) {
    return null;
  }
  const font = getOutlineFont(shape.fontFamily, shape.fontWeight, shape.italic);
  if (!font) return null;
  // The painted layout, so outlines land where the glyphs were drawn.
  const layout = layoutTextInBrowser(shape);
  const scale = shape.fontSize / font.unitsPerEm;
  const subpaths: PathSubpath[] = [];
  for (const line of layout.lines) {
    let pen = shape.x + line.x;
    const baseline = shape.y + line.baseline;
    let previous: Glyph | null = null;
    for (const char of Array.from(line.text)) {
      const glyph = font.charToGlyph(char);
      // `.notdef`: painting falls back to another font, so bail out rather
      // than put a box where a glyph was.
      if (glyph.index === 0 && char !== " ") return null;
      if (previous) pen += font.getKerningValue(previous, glyph) * scale;
      // opentype lays glyphs out with y already pointing down from the
      // baseline, the space text shapes are in, so no flip is needed.
      for (const contour of commandsToSubpaths(
        glyph.getPath(pen, baseline, shape.fontSize).commands
      )) {
        subpaths.push(contour);
      }
      pen += (glyph.advanceWidth ?? 0) * scale;
      previous = glyph;
    }
  }
  return subpaths;
}

/**
 * Turn one glyph's command list into subpaths. Glyph contours are always
 * closed and are separated by `moveTo` (opentype emits no `closePath` for
 * TrueType outlines), and quadratics are raised to cubics, since the document
 * model only stores cubic anchors.
 */
export function commandsToSubpaths(commands: PathCommand[]): PathSubpath[] {
  const subpaths: PathSubpath[] = [];
  let anchors: PathAnchor[] = [];
  let current: Vec2 = { x: 0, y: 0 };
  const flush = () => {
    const contour = closeContour(anchors);
    if (contour) subpaths.push(contour);
    anchors = [];
  };
  for (const command of commands) {
    switch (command.type) {
      case "M":
        flush();
        current = { x: command.x, y: command.y };
        anchors.push({ p: current, hIn: null, hOut: null });
        break;
      case "L":
        current = { x: command.x, y: command.y };
        anchors.push({ p: current, hIn: null, hOut: null });
        break;
      case "C":
        setOutHandle(anchors, { x: command.x1, y: command.y1 });
        current = { x: command.x, y: command.y };
        anchors.push({
          p: current,
          hIn: { x: command.x2, y: command.y2 },
          hOut: null,
        });
        break;
      case "Q": {
        const control = { x: command.x1, y: command.y1 };
        const end = { x: command.x, y: command.y };
        setOutHandle(anchors, lerp(current, control, 2 / 3));
        anchors.push({ p: end, hIn: lerp(end, control, 2 / 3), hOut: null });
        current = end;
        break;
      }
      case "Z":
        flush();
        break;
    }
  }
  flush();
  return subpaths;
}

function setOutHandle(anchors: PathAnchor[], handle: Vec2): void {
  const last = anchors[anchors.length - 1];
  if (last) last.hOut = handle;
}

function lerp(from: Vec2, to: Vec2, t: number): Vec2 {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

const EPSILON = 1e-9;

/**
 * Finish a contour. A glyph outline restates points — it opens with a `moveTo`
 * and a `lineTo` to the same place, and returns to its start at the end — so
 * coincident anchors are folded together, keeping whichever handles they carry,
 * and anything left degenerate is dropped.
 */
function closeContour(anchors: PathAnchor[]): PathSubpath | null {
  const kept: PathAnchor[] = [];
  for (const anchor of anchors) {
    const previous = kept[kept.length - 1];
    if (previous && samePoint(previous.p, anchor.p)) {
      mergeAnchor(previous, anchor);
      continue;
    }
    kept.push(anchor);
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (!first || !last) return null;
  if (kept.length > 1 && samePoint(first.p, last.p)) {
    mergeAnchor(first, last);
    kept.pop();
  }
  return kept.length >= 3 ? { anchors: kept, closed: true } : null;
}

/** Fold a coincident anchor into the one that stays; handles never collide. */
function mergeAnchor(target: PathAnchor, extra: PathAnchor): void {
  if (extra.hIn) target.hIn = extra.hIn;
  if (extra.hOut) target.hOut = extra.hOut;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

export type { Font };
