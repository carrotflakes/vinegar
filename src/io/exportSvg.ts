import { subpathSegments } from "../model/bezier";
import { shapeBounds } from "../model/bounds";
import { applyMatrix, isIdentity } from "../model/matrix";
import { gradientToSvg, paintToSvgAttrs, type Paint } from "../model/paint";
import { isGroup, isShape } from "../model/scene";
import type { BezierShape, Bounds, Document, Matrix, SceneNode, Shape } from "../model/types";
import { contentBounds } from "./exportBounds";

export interface SvgOptions {
  margin?: number;
  /** Explicit crop region (e.g. an artboard). Overrides content bounds. */
  bounds?: Bounds;
  /** Backdrop colour drawn behind the content; omit/null for transparent. */
  background?: string | null;
}

/**
 * Collects gradient definitions referenced during serialization. Solids become
 * plain attributes; gradients register a `<*Gradient>` def and are referenced
 * by `url(#id)`.
 */
interface Defs {
  items: string[];
  paintAttrs(paint: Paint, kind: "fill" | "stroke"): string[];
}

function makeDefs(): Defs {
  const items: string[] = [];
  return {
    items,
    paintAttrs(paint, kind) {
      if (paint.type === "solid") return paintToSvgAttrs(paint, kind);
      const id = `grad${items.length}`;
      items.push(gradientToSvg(paint, id));
      return [`${kind}="url(#${id})"`];
    },
  };
}

function num(n: number): string {
  // Trim to a sane precision and drop trailing zeros.
  return parseFloat(n.toFixed(3)).toString();
}

function matrixAttr(matrix: Matrix): string {
  return `matrix(${matrix.map(num).join(" ")})`;
}

function commonAttrs(shape: Shape, defs: Defs): string {
  const parts: string[] = [];
  const fillable = !(
    shape.type === "line" ||
    (shape.type === "path" && !shape.closed) ||
    (shape.type === "bezier" && !shape.subpaths.some((sp) => sp.closed))
  );
  if (fillable && shape.fill) parts.push(...defs.paintAttrs(shape.fill, "fill"));
  else parts.push(`fill="none"`);
  if (shape.stroke && shape.strokeWidth > 0) {
    parts.push(...defs.paintAttrs(shape.stroke, "stroke"));
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

function shapeToSvg(shape: Shape, defs: Defs): string {
  const attrs = commonAttrs(shape, defs);
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
    case "compoundPath":
      return `<path d="${shape.components
        .map((component) => primitivePathData(component, component.transform))
        .join(" ")}" fill-rule="evenodd" ${attrs} />`;
  }
}

function primitivePathData(shape: Exclude<Shape, { type: "compoundPath" }>, matrix: Matrix): string {
  const point = (p: { x: number; y: number }) => {
    const out = applyMatrix(matrix, p);
    return `${num(out.x)} ${num(out.y)}`;
  };
  const polygon = (points: { x: number; y: number }[], closed: boolean) =>
    points.length
      ? `M ${point(points[0])}${points.slice(1).map((p) => ` L ${point(p)}`).join("")}${closed ? " Z" : ""}`
      : "";
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      return polygon([
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ], true);
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      const rx = b.width / 2, ry = b.height / 2;
      const k = 0.5522847498307936;
      const a = { x: cx + rx, y: cy };
      const curves = [
        [{ x: cx + rx, y: cy + k * ry }, { x: cx + k * rx, y: cy + ry }, { x: cx, y: cy + ry }],
        [{ x: cx - k * rx, y: cy + ry }, { x: cx - rx, y: cy + k * ry }, { x: cx - rx, y: cy }],
        [{ x: cx - rx, y: cy - k * ry }, { x: cx - k * rx, y: cy - ry }, { x: cx, y: cy - ry }],
        [{ x: cx + k * rx, y: cy - ry }, { x: cx + rx, y: cy - k * ry }, a],
      ];
      return `M ${point(a)} ${curves.map(([c1, c2, p]) => `C ${point(c1)} ${point(c2)} ${point(p)}`).join(" ")} Z`;
    }
    case "line":
      return `M ${point({ x: shape.x1, y: shape.y1 })} L ${point({ x: shape.x2, y: shape.y2 })}`;
    case "path":
      return polygon(shape.points, shape.closed);
    case "polygon":
      return shape.polys.flat().map((ring) => polygon(ring, true)).join(" ");
    case "bezier":
      return shape.subpaths.map((sp) => {
        if (!sp.anchors.length) return "";
        let d = `M ${point(sp.anchors[0].p)}`;
        for (const segment of subpathSegments(sp)) {
          d += ` C ${point(segment.c1)} ${point(segment.c2)} ${point(segment.p1)}`;
        }
        return d + (sp.closed ? " Z" : "");
      }).join(" ");
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
 * within the group, matching the canvas. Symbol instances expand inline as
 * `<g>` wrapping their definition's content.
 */
function nodeToSvg(
  doc: Document,
  node: SceneNode,
  indent: string,
  defs: Defs,
  activeSymbols: Set<string> = new Set()
): string[] {
  if (isShape(node)) {
    return node.hidden ? [] : [indent + shapeToSvg(node, defs)];
  }
  if (node.hidden) return [];
  let childIds: string[];
  let symbolId: string | null = null;
  if (isGroup(node)) {
    childIds = node.childIds;
  } else if (node.type === "instance") {
    if (activeSymbols.has(node.symbolId)) return [];
    const def = doc.symbols[node.symbolId];
    if (!def) return [];
    childIds = [def.rootNodeId];
    symbolId = node.symbolId;
  } else {
    return [];
  }
  const attrs: string[] = [];
  if (!isIdentity(node.transform)) attrs.push(`transform="${matrixAttr(node.transform)}"`);
  const alpha = node.opacity ?? 1;
  if (alpha < 1) attrs.push(`opacity="${num(alpha)}"`);
  if (node.blendMode && node.blendMode !== "normal") {
    attrs.push(`style="mix-blend-mode:${node.blendMode};isolation:isolate"`);
  } else if (alpha < 1) {
    attrs.push(`style="isolation:isolate"`);
  }
  if (symbolId) activeSymbols.add(symbolId);
  const body = childIds.flatMap((id) => {
    const child = doc.nodes[id];
    return child ? nodeToSvg(doc, child, indent + "  ", defs, activeSymbols) : [];
  });
  if (symbolId) activeSymbols.delete(symbolId);
  return [
    indent + `<g${attrs.length ? " " + attrs.join(" ") : ""}>`,
    ...body,
    indent + `</g>`,
  ];
}

/** Whether any visible shape or group in the tree uses a blend mode. */
function usesBlend(
  doc: Document,
  node: SceneNode,
  activeSymbols: Set<string> = new Set()
): boolean {
  if (node.blendMode && node.blendMode !== "normal") return true;
  if (node.type === "instance") {
    if (activeSymbols.has(node.symbolId)) return false;
    const def = doc.symbols[node.symbolId];
    const root = def ? doc.nodes[def.rootNodeId] : null;
    if (!def || !root) return false;
    activeSymbols.add(node.symbolId);
    const result = usesBlend(doc, root, activeSymbols);
    activeSymbols.delete(node.symbolId);
    return result;
  }
  return isGroup(node) && node.childIds.some((id) => {
    const child = doc.nodes[id];
    return !!child && usesBlend(doc, child, activeSymbols);
  });
}

/** Serialize a document's shapes to a standalone SVG string. */
export function exportSvg(doc: Document, opts: SvgOptions = {}): string {
  const { margin = 8 } = opts;
  const bounds = opts.bounds ?? contentBounds(doc, margin);
  if (!bounds) throw new Error("Nothing to export.");

  const defs = makeDefs();
  const roots = doc.rootIds.map((id) => doc.nodes[id]).filter(Boolean);
  const inner = roots.flatMap((n) => nodeToSvg(doc, n, "  ", defs)).join("\n");
  // Blend modes should composite against the drawing only, not the page the
  // SVG happens to be embedded in.
  const isolate = roots.some((node) => usesBlend(doc, node))
    ? ` style="isolation:isolate"`
    : "";

  // An explicit crop clips content to the region; a background paints behind it.
  const clip = opts.bounds
    ? `clip${defs.items.length}`
    : null;
  if (clip) {
    defs.items.push(
      `<clipPath id="${clip}"><rect x="${num(bounds.x)}" y="${num(
        bounds.y
      )}" width="${num(bounds.width)}" height="${num(bounds.height)}"/></clipPath>`
    );
  }
  const bg =
    opts.background
      ? `  <rect x="${num(bounds.x)}" y="${num(bounds.y)}" width="${num(
          bounds.width
        )}" height="${num(bounds.height)}" fill="${opts.background}"/>`
      : null;
  const body = clip
    ? [`  <g clip-path="url(#${clip})">`, inner, `  </g>`].join("\n")
    : inner;

  const defsBlock = defs.items.length
    ? [`  <defs>`, ...defs.items.map((d) => "    " + d), `  </defs>`]
    : [];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(
      bounds.width
    )}" height="${num(bounds.height)}" viewBox="${num(bounds.x)} ${num(
      bounds.y
    )} ${num(bounds.width)} ${num(bounds.height)}"${isolate}>`,
    ...defsBlock,
    ...(bg ? [bg] : []),
    body,
    `</svg>`,
    "",
  ].join("\n");
}
