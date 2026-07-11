import { subpathSegments } from "../model/bezier";
import { shapeBounds } from "../model/bounds";
import { isIdentity } from "../model/matrix";
import { isGroup, isShape } from "../model/scene";
import type { BezierShape, Document, Matrix, SceneNode, Shape } from "../model/types";
import { contentBounds } from "./exportBounds";

function num(n: number): string {
  // Trim to a sane precision and drop trailing zeros.
  return parseFloat(n.toFixed(3)).toString();
}

function matrixAttr(matrix: Matrix): string {
  return `matrix(${matrix.map(num).join(" ")})`;
}

function commonAttrs(shape: Shape): string {
  const parts: string[] = [];
  const fillable = !(
    shape.type === "line" ||
    (shape.type === "path" && !shape.closed) ||
    (shape.type === "bezier" && !shape.subpaths.some((sp) => sp.closed))
  );
  parts.push(`fill="${fillable && shape.fill ? shape.fill : "none"}"`);
  if (shape.stroke && shape.strokeWidth > 0) {
    parts.push(`stroke="${shape.stroke}"`);
    parts.push(`stroke-width="${num(shape.strokeWidth)}"`);
    parts.push(`stroke-linejoin="round" stroke-linecap="round"`);
  }
  if (shape.opacity < 1) parts.push(`opacity="${num(shape.opacity)}"`);
  if (shape.blendMode && shape.blendMode !== "normal") {
    parts.push(`style="mix-blend-mode:${shape.blendMode}"`);
  }
  if (!isIdentity(shape.transform)) {
    parts.push(`transform="${matrixAttr(shape.transform)}"`);
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
  const parts: string[] = [];
  for (const sp of shape.subpaths) {
    const segs = subpathSegments(sp);
    if (sp.anchors.length === 0) continue;
    const start = sp.anchors[0].p;
    let d = `M ${num(start.x)} ${num(start.y)}`;
    for (const s of segs) {
      d += ` C ${num(s.c1.x)} ${num(s.c1.y)} ${num(s.c2.x)} ${num(
        s.c2.y
      )} ${num(s.p1.x)} ${num(s.p1.y)}`;
    }
    if (sp.closed) d += " Z";
    parts.push(d);
  }
  return parts.join(" ");
}

/**
 * Serialize a render node. Groups become `<g>`; ones that composite as a
 * layer (opacity/blend) get `isolation:isolate` so their children blend
 * within the group, matching the canvas.
 */
function nodeToSvg(doc: Document, node: SceneNode, indent: string): string[] {
  if (isShape(node)) {
    return node.hidden ? [] : [indent + shapeToSvg(node)];
  }
  const g = node;
  if (g.hidden) return [];
  const attrs: string[] = [];
  if (!isIdentity(g.transform)) attrs.push(`transform="${matrixAttr(g.transform)}"`);
  const alpha = g.opacity ?? 1;
  if (alpha < 1) attrs.push(`opacity="${num(alpha)}"`);
  if (g.blendMode && g.blendMode !== "normal") {
    attrs.push(`style="mix-blend-mode:${g.blendMode};isolation:isolate"`);
  } else if (alpha < 1) {
    attrs.push(`style="isolation:isolate"`);
  }
  return [
    indent + `<g${attrs.length ? " " + attrs.join(" ") : ""}>`,
    ...g.childIds.flatMap((id) => {
      const child = doc.nodes[id];
      return child ? nodeToSvg(doc, child, indent + "  ") : [];
    }),
    indent + `</g>`,
  ];
}

/** Whether any visible shape or group in the tree uses a blend mode. */
function usesBlend(doc: Document, node: SceneNode): boolean {
  if (node.blendMode && node.blendMode !== "normal") return true;
  return isGroup(node) && node.childIds.some((id) => {
    const child = doc.nodes[id];
    return !!child && usesBlend(doc, child);
  });
}

/** Serialize a document's shapes to a standalone SVG string. */
export function exportSvg(doc: Document, margin = 8): string {
  const bounds = contentBounds(doc, margin);
  if (!bounds) throw new Error("Nothing to export.");

  const roots = doc.rootIds.map((id) => doc.nodes[id]).filter(Boolean);
  const body = roots.flatMap((n) => nodeToSvg(doc, n, "  ")).join("\n");
  // Blend modes should composite against the drawing only, not the page the
  // SVG happens to be embedded in.
  const isolate = roots.some((node) => usesBlend(doc, node))
    ? ` style="isolation:isolate"`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(
      bounds.width
    )}" height="${num(bounds.height)}" viewBox="${num(bounds.x)} ${num(
      bounds.y
    )} ${num(bounds.width)} ${num(bounds.height)}"${isolate}>`,
    body,
    `</svg>`,
    "",
  ].join("\n");
}
