import { shapeBounds } from "@/model/geometry/bounds";
import { isCompoundChild } from "@/model/path/compoundPath";
import { subpathSegments } from "@/model/path/path";
import { hasActiveModifiers } from "@/model/path/pathModifiers";
import { shapeSubpaths } from "@/model/path/shapeGeometry";
import { effectiveRectCornerRadius } from "@/model/roundedRect";
import { isShape } from "@/model/scene";
import type { Document, PathSubpath, Shape } from "@/model/types";
import { renderCachesDisabled } from "@/debug/renderFlags";
import { subscribeFontCache } from "@/fontCache";

type PathTarget = Pick<
  CanvasRenderingContext2D,
  | "rect"
  | "moveTo"
  | "lineTo"
  | "bezierCurveTo"
  | "closePath"
  | "ellipse"
>;

function appendSubpaths(target: PathTarget, subpaths: PathSubpath[]): void {
  for (const sp of subpaths) {
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
        target.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p1.x, s.p1.y);
      }
    }
    if (sp.closed) target.closePath();
  }
}

/** Append non-compound geometry to either a live canvas path or a Path2D. */
function appendPath(target: PathTarget, shape: Shape): void {
  // Canvas primitives, not a second derivation of the geometry: `rect` and
  // `ellipse` hand the exact conic to the rasteriser instead of a flattened
  // stand-in. A modifier leaves no primitive silhouette, so they drop out then.
  if (!hasActiveModifiers(shape)) {
    if (shape.type === "rect" && effectiveRectCornerRadius(shape) <= 0) {
      const b = shapeBounds(shape);
      target.rect(b.x, b.y, b.width, b.height);
      return;
    }
    if (shape.type === "ellipse") {
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
      return;
    }
  }
  // A compound path is assembled from its components' own cached paths by the
  // callers below, so it contributes nothing of its own here.
  if (shape.type === "compoundPath") return;
  appendSubpaths(target, shapeSubpaths(shape) ?? []);
}

/** Trace loose contours (end markers) onto a live canvas path. */
export function traceSubpaths(
  ctx: CanvasRenderingContext2D,
  subpaths: PathSubpath[]
): void {
  ctx.beginPath();
  appendSubpaths(ctx, subpaths);
}

let pathCache = new WeakMap<Shape, Path2D>();
// Text geometry appears only once its font is parsed, so a path built while the
// font was still loading must not outlive the load.
subscribeFontCache(() => { pathCache = new WeakMap(); });
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
    appendPath(path, shape);
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
      isCompoundChild(component) &&
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
      !isCompoundChild(component) ||
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
