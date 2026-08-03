import { shapeBounds } from "@/model/geometry/bounds";
import { cachedBrushEnvelope } from "@/model/brush/brushOutline";
import { isCompoundChild } from "@/model/path/compoundPath";
import { subpathSegments } from "@/model/path/path";
import { resolvedSubpaths } from "@/model/path/pathModifiers";
import { effectiveRectCornerRadius, roundedRectSubpath } from "@/model/roundedRect";
import { isShape } from "@/model/scene";
import type { Document, Shape } from "@/model/types";
import { renderCachesDisabled } from "@/debug/renderFlags";

type PathTarget = Pick<
  CanvasRenderingContext2D,
  | "rect"
  | "moveTo"
  | "lineTo"
  | "bezierCurveTo"
  | "closePath"
  | "ellipse"
>;

/** Append non-compound geometry to either a live canvas path or a Path2D. */
function appendPath(target: PathTarget, shape: Shape, doc?: Document): void {
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      if (effectiveRectCornerRadius(shape) <= 0) {
        target.rect(b.x, b.y, b.width, b.height);
        break;
      }
      const subpath = roundedRectSubpath(shape);
      const segments = subpathSegments(subpath);
      if (!segments.length) break;
      target.moveTo(segments[0].p0.x, segments[0].p0.y);
      for (const segment of segments) {
        target.bezierCurveTo(
          segment.c1.x,
          segment.c1.y,
          segment.c2.x,
          segment.c2.y,
          segment.p1.x,
          segment.p1.y
        );
      }
      target.closePath();
      break;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      // CanvasRenderingContext2D.ellipse() connects from the current point to
      // the arc start. Compound paths already have a current point from the
      // preceding component, so explicitly start a new subpath first.
      target.moveTo(b.x + b.width, b.y + b.height / 2);
      target.ellipse(
        b.x + b.width / 2,
        b.y + b.height / 2,
        Math.max(b.width / 2, 0),
        Math.max(b.height / 2, 0),
        0,
        0,
        Math.PI * 2
      );
      break;
    }
    case "line": {
      target.moveTo(shape.x1, shape.y1);
      target.lineTo(shape.x2, shape.y2);
      break;
    }
    case "path": {
      for (const sp of resolvedSubpaths(shape, doc)) {
        const segs = subpathSegments(sp);
        if (segs.length === 0) {
          if (sp.anchors[0]) {
            const p = sp.anchors[0].p;
            target.moveTo(p.x, p.y);
          }
          continue;
        }
        target.moveTo(segs[0].p0.x, segs[0].p0.y);
        for (const s of segs) {
          if (
            s.c1.x === s.p0.x &&
            s.c1.y === s.p0.y &&
            s.c2.x === s.p1.x &&
            s.c2.y === s.p1.y
          ) {
            target.lineTo(s.p1.x, s.p1.y);
          } else {
            target.bezierCurveTo(
              s.c1.x,
              s.c1.y,
              s.c2.x,
              s.c2.y,
              s.p1.x,
              s.p1.y
            );
          }
        }
        if (sp.closed) target.closePath();
      }
      break;
    }
    case "brush": {
      const ring = cachedBrushEnvelope(shape);
      if (ring.length >= 2) {
        target.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) {
          target.lineTo(ring[i].x, ring[i].y);
        }
        target.closePath();
      }
      break;
    }
    case "compoundPath":
    case "image":
    case "text":
      break;
  }
}

const pathCache = new WeakMap<Shape, Path2D>();
const compoundPathCache = new WeakMap<
  Shape,
  { path: Path2D; components: Shape[] }
>();

/**
 * Immutable shape references make Path2D entries self-invalidating. Compound
 * paths additionally validate their component references because editing a
 * child does not replace the compound container.
 */
export function cachedShapePath(
  shape: Shape,
  doc?: Document,
  preview?: Shape | null
): Path2D | null {
  // Pen and pencil drafts mutate in place between pointer events. Persisted
  // document shapes are immutable, but transient previews are not.
  if (shape === preview || renderCachesDisabled) return null;
  if (typeof Path2D === "undefined") return null;
  if (shape.type !== "compoundPath") {
    const cached = pathCache.get(shape);
    if (cached) return cached;
    const path = new Path2D();
    appendPath(path, shape, doc);
    pathCache.set(shape, path);
    return path;
  }
  if (
    !doc ||
    typeof DOMMatrix === "undefined" ||
    typeof Path2D.prototype.addPath !== "function"
  ) {
    return null;
  }
  const components = shape.childIds.flatMap((id) => {
    const stored = doc.nodes[id];
    const component = preview?.id === id ? preview : stored;
    return isShape(component) &&
      isCompoundChild(component, doc) &&
      !component.hidden
      ? [component]
      : [];
  });
  const cached = compoundPathCache.get(shape);
  if (
    cached &&
    cached.components.length === components.length &&
    cached.components.every((component, index) => component === components[index])
  ) {
    return cached.path;
  }
  const path = new Path2D();
  for (const component of components) {
    const child = cachedShapePath(component, doc, preview);
    if (!child) return null;
    path.addPath(child, new DOMMatrix(component.transform));
  }
  compoundPathCache.set(shape, { path, components });
  return path;
}

/** Build the geometry of a shape onto the current canvas path as a fallback. */
export function tracePath(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  begin = true,
  doc?: Document,
  preview?: Shape | null
): void {
  if (begin) ctx.beginPath();
  if (shape.type !== "compoundPath") {
    appendPath(ctx, shape);
    return;
  }
  if (!doc) return;
  for (const id of shape.childIds) {
    const stored = doc.nodes[id];
    const component = preview?.id === id ? preview : stored;
    if (
      !isShape(component) ||
      !isCompoundChild(component, doc) ||
      component.hidden
    ) {
      continue;
    }
    ctx.save();
    ctx.transform(...component.transform);
    tracePath(ctx, component, false, doc, preview);
    ctx.restore();
  }
}
