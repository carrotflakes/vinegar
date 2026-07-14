import { subpathSegments } from "../model/bezier";
import { shapeBounds } from "../model/bounds";
import {
  clippingContentIds,
  clippingMask,
  shapeFillRule,
  type ClippingMaskShape,
} from "../model/clippingMask";
import { hasEffects, SHADOW_BLUR_TO_STDDEV } from "../model/effects";
import { applyMatrix, isIdentity } from "../model/matrix";
import { gradientToSvg, paintToSvgAttrs, type Paint } from "../model/paint";
import { isGroup, isShape } from "../model/scene";
import { effectiveRectCornerRadius, roundedRectSubpath } from "../model/roundedRect";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  STROKE_MITER_LIMIT,
  strokeCap,
  strokeJoin,
} from "../model/stroke";
import type { BezierShape, Bounds, Document, Effect, Matrix, PrimitiveShape, SceneNode, Shape } from "../model/types";
import { contentBounds } from "./exportBounds";
import { layoutTextInBrowser } from "../canvas/textLayout";
import { fontStack } from "../ui/fonts";

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
  clipPath(shape: ClippingMaskShape): string;
  strokeClip(markup: string): string;
  strokeMask(markup: string, bounds: Bounds): string;
  filter(effects: Effect[]): string;
  nextId(prefix: string): string;
}

/** Filter primitives for one effect, consuming the previous result via default `in`. */
function effectPrimitive(effect: Effect): string {
  if (effect.type === "blur") {
    return `<feGaussianBlur stdDeviation="${num(effect.radius)}" />`;
  }
  return `<feDropShadow dx="${num(effect.offsetX)}" dy="${num(
    effect.offsetY
  )}" stdDeviation="${num(effect.blur * SHADOW_BLUR_TO_STDDEV)}" flood-color="${
    effect.color
  }" flood-opacity="${num(effect.alpha)}" />`;
}

function makeDefs(): Defs {
  const items: string[] = [];
  let id = 0;
  const nextId = (prefix: string) => `${prefix}${id++}`;
  return {
    items,
    nextId,
    paintAttrs(paint, kind) {
      if (paint.type === "solid") return paintToSvgAttrs(paint, kind);
      // SVG pattern export is not implemented yet; emit a neutral placeholder
      // so the shape stays visible rather than crashing the exporter.
      if (paint.type === "pattern") return [`${kind}="#8a9099"`];
      const gradientId = nextId("grad");
      items.push(gradientToSvg(paint, gradientId));
      return [`${kind}="url(#${gradientId})"`];
    },
    clipPath(shape) {
      const clipId = nextId("clip");
      items.push(
        `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${maskShapeToSvg(shape)}</clipPath>`
      );
      return clipId;
    },
    strokeClip(markup) {
      const clipId = nextId("strokeClip");
      items.push(
        `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${markup}</clipPath>`
      );
      return clipId;
    },
    strokeMask(markup, bounds) {
      const maskId = nextId("strokeMask");
      items.push(
        `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${num(bounds.x)}" y="${num(
          bounds.y
        )}" width="${num(bounds.width)}" height="${num(
          bounds.height
        )}" style="mask-type:luminance"><rect x="${num(bounds.x)}" y="${num(
          bounds.y
        )}" width="${num(bounds.width)}" height="${num(
          bounds.height
        )}" fill="white"/>${markup}</mask>`
      );
      return maskId;
    },
    filter(effects) {
      const filterId = nextId("fx");
      // A generous region keeps large blurs/offset shadows from clipping.
      items.push(
        `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">${effects
          .map(effectPrimitive)
          .join("")}</filter>`
      );
      return filterId;
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Opacity / blend / transform attributes shared by every node kind. */
function baseAttrs(shape: Shape): string[] {
  const parts: string[] = [];
  if (shape.opacity < 1) parts.push(`opacity="${num(shape.opacity)}"`);
  if (shape.blendMode && shape.blendMode !== "normal") {
    parts.push(`style="mix-blend-mode:${shape.blendMode}"`);
  }
  if (!isIdentity(shape.transform)) {
    parts.push(`transform="${matrixAttr(shape.transform)}"`);
  }
  return parts;
}

/** `filter="url(#…)"` for a node's effect stack, or empty when it has none. */
function filterAttr(node: SceneNode, defs: Defs): string {
  return hasEffects(node.effects) ? `filter="url(#${defs.filter(node.effects)})"` : "";
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
    parts.push(...strokeSvgAttrs(shape, defs, shape.strokeWidth));
  }
  parts.push(...baseAttrs(shape));
  const fx = filterAttr(shape, defs);
  if (fx) parts.push(fx);
  return parts.join(" ");
}

function strokeSvgAttrs(shape: Shape, defs: Defs, width: number): string[] {
  if (!shape.stroke) return [];
  const parts = [
    ...defs.paintAttrs(shape.stroke, "stroke"),
    `stroke-width="${num(width)}"`,
    `stroke-linecap="${strokeCap(shape)}"`,
    `stroke-linejoin="${strokeJoin(shape)}"`,
    `stroke-miterlimit="${STROKE_MITER_LIMIT}"`,
  ];
  const dash = normalizeStrokeDash(shape.strokeDash);
  if (dash.length) {
    parts.push(`stroke-dasharray="${dash.map(num).join(" ")}"`);
    if (shape.strokeDashOffset) {
      parts.push(`stroke-dashoffset="${num(shape.strokeDashOffset)}"`);
    }
  }
  return parts;
}

function fillSvgAttrs(shape: Shape, defs: Defs): string[] {
  const fillable = !(
    shape.type === "line" ||
    (shape.type === "path" && !shape.closed) ||
    (shape.type === "bezier" && !shape.subpaths.some((sp) => sp.closed))
  );
  return fillable && shape.fill
    ? defs.paintAttrs(shape.fill, "fill")
    : [`fill="none"`];
}

function expandedBounds(bounds: Bounds, amount: number): Bounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

function shapeToSvg(doc: Document, shape: Shape, defs: Defs): string {
  if (shape.type === "image") {
    const asset = doc.assets[shape.assetId];
    if (!asset) return "";
    const b = shapeBounds(shape);
    const attrs = [...baseAttrs(shape), filterAttr(shape, defs)].filter(Boolean).join(" ");
    return `<image x="${num(b.x)}" y="${num(b.y)}" width="${num(
      b.width
    )}" height="${num(b.height)}" preserveAspectRatio="none" href="${
      asset.source.data
    }"${attrs ? " " + attrs : ""} />`;
  }
  const alignment = effectiveStrokeAlignment(shape);
  if (!shape.stroke || shape.strokeWidth <= 0 || alignment === "center") {
    return shapeGeometryToSvg(shape, commonAttrs(shape, defs));
  }

  // SVG has no interoperable inside/outside stroke positioning. Paint fill
  // and stroke separately, double the stroke width, then clip/mask the latter.
  const fill = shapeGeometryToSvg(shape, [...fillSvgAttrs(shape, defs), `stroke="none"`].join(" "));
  const stroke = shapeGeometryToSvg(
    shape,
    [`fill="none"`, ...strokeSvgAttrs(shape, defs, shape.strokeWidth * 2)].join(" ")
  );
  const silhouette = shapeGeometryToSvg(
    shape,
    `fill="black" stroke="none"${
      shape.type === "polygon" || shape.type === "compoundPath" ? ` clip-rule="evenodd"` : ""
    }`
  );
  const limitedStroke = alignment === "inside"
    ? `<g clip-path="url(#${defs.strokeClip(silhouette)})">${stroke}</g>`
    : (() => {
        // Keep this region padding in sync with STROKE_MITER_LIMIT and the
        // conservative strokeOutset policy; an undersized mask clips miters.
        const pad = Math.max(1, shape.strokeWidth * STROKE_MITER_LIMIT);
        const mask = defs.strokeMask(silhouette, expandedBounds(shapeBounds(shape), pad));
        return `<g mask="url(#${mask})">${stroke}</g>`;
      })();
  const wrapper = [...baseAttrs(shape), filterAttr(shape, defs)].filter(Boolean).join(" ");
  return `<g${wrapper ? " " + wrapper : ""}>${fill}${limitedStroke}</g>`;
}

function shapeGeometryToSvg(shape: Shape, attrs: string): string {
  switch (shape.type) {
    case "text": {
      const layout = layoutTextInBrowser(shape);
      const fontAttrs = [
        `font-family="${escapeXml(fontStack(shape.fontFamily))}"`,
        `font-size="${num(shape.fontSize)}"`,
        `font-weight="${shape.fontWeight}"`,
        shape.italic ? `font-style="italic"` : "",
        `xml:space="preserve"`,
      ].filter(Boolean).join(" ");
      const lines = layout.lines.map((line) =>
        `<tspan x="${num(shape.x + line.x)}" y="${num(shape.y + line.baseline)}">${escapeXml(line.text)}</tspan>`
      ).join("");
      return `<text ${fontAttrs} ${attrs}>${lines}</text>`;
    }
    case "rect": {
      const b = shapeBounds(shape);
      const radius = effectiveRectCornerRadius(shape);
      return `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(
        b.width
      )}" height="${num(b.height)}"${radius > 0 ? ` rx="${num(radius)}" ry="${num(radius)}"` : ""} ${attrs} />`;
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
    case "image":
      return "";
  }
}

function primitivePathData(shape: PrimitiveShape, matrix: Matrix): string {
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
      if (effectiveRectCornerRadius(shape) > 0) {
        const subpath = roundedRectSubpath(shape);
        const segments = subpathSegments(subpath);
        if (!segments.length) return "";
        return `M ${point(segments[0].p0)} ${segments
          .map((segment) =>
            `C ${point(segment.c1)} ${point(segment.c2)} ${point(segment.p1)}`
          )
          .join(" ")} Z`;
      }
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
 * SVG geometry for a clipping shape. A clipping mask is defined only by its
 * path, transform, and fill rule: its paint, opacity, blend mode, and hidden
 * flag deliberately never enter the definition.
 */
function maskShapeToSvg(shape: ClippingMaskShape): string {
  let d = "";
  switch (shape.type) {
    case "rect":
    case "ellipse":
    case "path":
    case "bezier":
    case "polygon":
      d = primitivePathData(shape, [1, 0, 0, 1, 0, 0]);
      break;
    case "compoundPath":
      d = shape.components
        .map((component) => primitivePathData(component, component.transform))
        .join(" ");
      break;
  }
  const rule = shapeFillRule(shape);
  const attrs = [
    `d="${d}"`,
    `fill-rule="${rule}"`,
    `clip-rule="${rule}"`,
  ];
  if (!isIdentity(shape.transform)) {
    attrs.push(`transform="${matrixAttr(shape.transform)}"`);
  }
  return `<path ${attrs.join(" ")} />`;
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
    return node.hidden ? [] : [indent + shapeToSvg(doc, node, defs)];
  }
  if (node.hidden) return [];
  let childIds: string[];
  let symbolId: string | null = null;
  let clipId: string | null = null;
  if (isGroup(node)) {
    const mask = clippingMask(doc, node);
    if (mask) {
      childIds = clippingContentIds(doc, node);
      clipId = defs.clipPath(mask);
    } else {
      childIds = node.childIds;
    }
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
  if (clipId) attrs.push(`clip-path="url(#${clipId})"`);
  const fx = filterAttr(node, defs);
  if (fx) attrs.push(fx);
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
  return isGroup(node) && clippingContentIds(doc, node).some((id) => {
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
  const clip = opts.bounds ? defs.nextId("clip") : null;
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
