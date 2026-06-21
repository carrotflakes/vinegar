import { bezierSegments } from "../model/bezier";
import { shapeBounds, shapeCenter } from "../model/bounds";
import type { BezierShape, Document, Shape } from "../model/types";
import { contentBounds } from "./exportBounds";

function num(n: number): string {
  // Trim to a sane precision and drop trailing zeros.
  return parseFloat(n.toFixed(3)).toString();
}

function commonAttrs(shape: Shape): string {
  const parts: string[] = [];
  const fillable = !(
    shape.type === "line" ||
    (shape.type === "path" && !shape.closed)
  );
  parts.push(`fill="${fillable && shape.fill ? shape.fill : "none"}"`);
  if (shape.stroke && shape.strokeWidth > 0) {
    parts.push(`stroke="${shape.stroke}"`);
    parts.push(`stroke-width="${num(shape.strokeWidth)}"`);
    parts.push(`stroke-linejoin="round" stroke-linecap="round"`);
  }
  if (shape.opacity < 1) parts.push(`opacity="${num(shape.opacity)}"`);
  if (shape.rotation) {
    const c = shapeCenter(shape);
    const deg = (shape.rotation * 180) / Math.PI;
    parts.push(`transform="rotate(${num(deg)} ${num(c.x)} ${num(c.y)})"`);
  }
  return parts.join(" ");
}

function shapeToSvg(shape: Shape): string {
  const attrs = commonAttrs(shape);
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      return `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(
        b.width
      )}" height="${num(b.height)}" ${attrs} />`;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      return `<ellipse cx="${num(b.x + b.width / 2)}" cy="${num(
        b.y + b.height / 2
      )}" rx="${num(b.width / 2)}" ry="${num(b.height / 2)}" ${attrs} />`;
    }
    case "line":
      return `<line x1="${num(shape.x1)}" y1="${num(shape.y1)}" x2="${num(
        shape.x2
      )}" y2="${num(shape.y2)}" ${attrs} />`;
    case "path": {
      const pts = shape.points.map((p) => `${num(p.x)},${num(p.y)}`).join(" ");
      const tag = shape.closed ? "polygon" : "polyline";
      return `<${tag} points="${pts}" ${attrs} />`;
    }
    case "bezier":
      return `<path d="${bezierPathData(shape)}" ${attrs} />`;
    case "polygon": {
      const d = shape.polys
        .flat()
        .map(
          (ring) =>
            "M " +
            ring.map((p) => `${num(p.x)} ${num(p.y)}`).join(" L ") +
            " Z"
        )
        .join(" ");
      return `<path d="${d}" fill-rule="evenodd" ${attrs} />`;
    }
  }
}

function bezierPathData(shape: BezierShape): string {
  const segs = bezierSegments(shape);
  if (shape.anchors.length === 0) return "";
  const start = shape.anchors[0].p;
  let d = `M ${num(start.x)} ${num(start.y)}`;
  for (const s of segs) {
    d += ` C ${num(s.c1.x)} ${num(s.c1.y)} ${num(s.c2.x)} ${num(
      s.c2.y
    )} ${num(s.p1.x)} ${num(s.p1.y)}`;
  }
  if (shape.closed) d += " Z";
  return d;
}

/** Serialize a document's shapes to a standalone SVG string. */
export function exportSvg(doc: Document, margin = 8): string {
  const bounds = contentBounds(doc, margin);
  if (!bounds) throw new Error("Nothing to export.");

  const body = doc.order
    .map((id) => doc.shapes[id])
    .filter(Boolean)
    .map((s) => "  " + shapeToSvg(s as Shape))
    .join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(
      bounds.width
    )}" height="${num(bounds.height)}" viewBox="${num(bounds.x)} ${num(
      bounds.y
    )} ${num(bounds.width)} ${num(bounds.height)}">`,
    body,
    `</svg>`,
    "",
  ].join("\n");
}
