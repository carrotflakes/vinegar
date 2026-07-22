import { subpathSegments } from "../model/path";
import { shapeBounds } from "../model/bounds";
import { cachedBrushEnvelope } from "../model/brushOutline";
import { compoundChildren } from "../model/compoundPath";
import { getAssetImage } from "../imageCache";
import {
  clippingContentIds,
  clippingMask,
  shapeFillRule,
  type ClippingMaskShape,
} from "../model/clippingMask";
import { hasEffects, SHADOW_BLUR_TO_STDDEV } from "../model/effects";
import { applyMatrix, isIdentity } from "../model/matrix";
import {
  gradientToSvg,
  paintToSvgAttrs,
  patternMode,
  patternPlacement,
  type Paint,
  type PatternPaint,
} from "../model/paint";
import { isGroup, isShape } from "../model/scene";
import { effectiveRectCornerRadius, roundedRectSubpath } from "../model/roundedRect";
import { ellipseSubpath } from "../model/ellipse";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  STROKE_MITER_LIMIT,
  strokeCap,
  strokeJoin,
} from "../model/stroke";
import type {
  PathShape,
  Bounds,
  Document,
  DocumentAsset,
  ColorAdjustEffect,
  Effect,
  Matrix,
  PrimitiveShape,
  SceneNode,
  Shape,
} from "../model/types";
import { contentBounds } from "./exportBounds";
import {
  embeddedImageSize,
  validImageSize,
  type ImageSize,
} from "./imageDimensions";
import { layoutTextInBrowser } from "../canvas/textLayout";
import { fontStack } from "../fonts";

export interface SvgOptions {
  margin?: number;
  /** Explicit crop region (e.g. an artboard). Overrides content bounds. */
  bounds?: Bounds;
  /** Backdrop colour drawn behind the content; omit/null for transparent. */
  background?: string | null;
}

/**
 * Collects paint and rendering definitions referenced during serialization.
 * Solids become plain attributes; gradients and patterns register a def and
 * are referenced by `url(#id)`.
 */
interface Defs {
  items: string[];
  paintAttrs(
    paint: Paint,
    kind: "fill" | "stroke",
    bounds: Bounds
  ): string[];
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
  if (effect.type === "color-adjust") {
    return colorAdjustPrimitives(effect);
  }
  return `<feDropShadow dx="${num(effect.offsetX)}" dy="${num(
    effect.offsetY
  )}" stdDeviation="${num(effect.blur * SHADOW_BLUR_TO_STDDEV)}" flood-color="${
    effect.color
  }" flood-opacity="${num(effect.alpha)}" />`;
}

/**
 * Colour adjustment as a chain of `feColorMatrix` primitives, one per CSS
 * `filter` function and in the same order the canvas applies them. They run in
 * sRGB (feColorMatrix defaults to linearRGB) to match the CSS-filter preview.
 */
function colorAdjustPrimitives(effect: ColorAdjustEffect): string {
  const { brightness: b, contrast: c, saturation: s, hue: h } = effect;
  const i = num(0.5 - 0.5 * c); // contrast intercept around mid-grey
  const cm = (attrs: string) =>
    `<feColorMatrix color-interpolation-filters="sRGB" ${attrs} />`;
  return [
    cm(`type="matrix" values="${num(b)} 0 0 0 0 0 ${num(b)} 0 0 0 0 0 ${num(b)} 0 0 0 0 0 1 0"`),
    cm(`type="matrix" values="${num(c)} 0 0 0 ${i} 0 ${num(c)} 0 0 ${i} 0 0 ${num(c)} 0 ${i} 0 0 0 1 0"`),
    cm(`type="saturate" values="${num(s)}"`),
    cm(`type="hueRotate" values="${num(h)}"`),
  ].join("");
}

function makeDefs(doc: Document): Defs {
  const items: string[] = [];
  let id = 0;
  const nextId = (prefix: string) => `${prefix}${id++}`;
  const imageIds = new Map<string, string>();
  const patternIds = new Map<string, string>();
  const imageId = (asset: DocumentAsset, size: ImageSize) => {
    const key = asset.source.data;
    const existing = imageIds.get(key);
    if (existing) return existing;
    const created = nextId("img");
    imageIds.set(key, created);
    items.push(imageToSvg(asset, size, created));
    return created;
  };
  const patternId = (
    paint: PatternPaint,
    asset: DocumentAsset,
    size: ImageSize,
    bounds: Bounds
  ) => {
    // Tile mode reuses a shared natural-size <image>; the fit modes size the
    // image to the shape's bounds, so they also key on the bounds.
    const tiled = patternMode(paint) === "tile";
    const image = tiled ? imageId(asset, size) : "";
    const key = JSON.stringify([
      patternMode(paint),
      image || asset.source.data,
      size.width,
      size.height,
      paint.scale,
      paint.rotation,
      paint.offset.x,
      paint.offset.y,
      tiled ? 0 : [bounds.x, bounds.y, bounds.width, bounds.height],
    ]);
    const existing = patternIds.get(key);
    if (existing) return existing;
    const created = nextId("pat");
    patternIds.set(key, created);
    items.push(patternToSvg(paint, size, created, image, asset, bounds));
    return created;
  };
  return {
    items,
    nextId,
    paintAttrs(paint, kind, bounds) {
      if (paint.type === "solid") return paintToSvgAttrs(paint, kind);
      if (paint.type === "pattern") {
        const asset = doc.assets[paint.assetId];
        const size = asset ? intrinsicImageSize(asset) : null;
        if (!asset || !size) return [`${kind}="#8a9099"`];
        const id = patternId(paint, asset, size, bounds);
        return [
          `${kind}="url(#${id})"`,
          ...(paint.alpha < 1 ? [`${kind}-opacity="${num(paint.alpha)}"`] : []),
        ];
      }
      const gradientId = nextId("grad");
      items.push(gradientToSvg(paint, gradientId, bounds));
      return [`${kind}="url(#${gradientId})"`];
    },
    clipPath(shape) {
      const clipId = nextId("clip");
      items.push(
        `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${maskShapeToSvg(doc, shape)}</clipPath>`
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

function intrinsicImageSize(asset: DocumentAsset): ImageSize | null {
  if (typeof Image !== "undefined") {
    const image = getAssetImage(asset);
    if (image) {
      const cached = validImageSize(image.naturalWidth, image.naturalHeight);
      if (cached) return cached;
    }
  }
  return embeddedImageSize(asset);
}

function imageToSvg(
  asset: DocumentAsset,
  size: ImageSize,
  id: string
): string {
  return (
    `<image id="${id}" width="${num(size.width)}" height="${num(
      size.height
    )}" preserveAspectRatio="none" href="${escapeXml(asset.source.data)}"/>`
  );
}

function patternToSvg(
  paint: PatternPaint,
  size: ImageSize,
  id: string,
  imageId: string,
  asset: DocumentAsset,
  bounds: Bounds
): string {
  if (patternMode(paint) === "tile") {
    const transform = [
      `translate(${num(paint.offset.x)} ${num(paint.offset.y)})`,
      `rotate(${num((paint.rotation * 180) / Math.PI)})`,
      `scale(${num(paint.scale)})`,
    ].join(" ");
    return (
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(
        size.width
      )}" height="${num(size.height)}" patternTransform="${transform}">` +
      `<use href="#${imageId}"/>` +
      `</pattern>`
    );
  }
  // fill / fit / stretch: one image sized to the shape's bounds. The pattern
  // tile equals the bounds box, so it never repeats over the shape and cover
  // overflow is clipped to the tile (matching the canvas no-repeat fill).
  const p = patternPlacement(paint, size, bounds);
  return (
    `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(bounds.x)}" y="${num(
      bounds.y
    )}" width="${num(bounds.width)}" height="${num(bounds.height)}">` +
    `<image href="${escapeXml(asset.source.data)}" x="${num(
      p.x - bounds.x
    )}" y="${num(p.y - bounds.y)}" width="${num(p.width)}" height="${num(
      p.height
    )}" preserveAspectRatio="none"/>` +
    `</pattern>`
  );
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

function commonAttrs(doc: Document, shape: Shape, defs: Defs): string {
  const parts: string[] = [];
  const bounds = shapeBounds(shape, doc);
  // SVG fills open subpaths by implicitly closing them while leaving their
  // stroke geometry open.
  const fillable = shape.type !== "line";
  if (fillable && shape.fill) {
    parts.push(...defs.paintAttrs(shape.fill, "fill", bounds));
  } else {
    parts.push(`fill="none"`);
  }
  if (shape.stroke && shape.strokeWidth > 0) {
    parts.push(...strokeSvgAttrs(shape, defs, shape.strokeWidth, doc));
  }
  parts.push(...baseAttrs(shape));
  const fx = filterAttr(shape, defs);
  if (fx) parts.push(fx);
  return parts.join(" ");
}

function strokeSvgAttrs(
  shape: Shape,
  defs: Defs,
  width: number,
  doc?: Document
): string[] {
  if (!shape.stroke) return [];
  const parts = [
    ...defs.paintAttrs(shape.stroke, "stroke", shapeBounds(shape, doc)),
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

function fillSvgAttrs(doc: Document, shape: Shape, defs: Defs): string[] {
  const fillable = shape.type !== "line";
  return fillable && shape.fill
    ? defs.paintAttrs(shape.fill, "fill", shapeBounds(shape, doc))
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
  if (shape.type === "brush") {
    // The envelope is a plain filled polygon painted with the stroke paint;
    // there is no SVG stroke to position, so bypass the alignment machinery.
    const parts: string[] = [];
    if (shape.stroke) {
      parts.push(...defs.paintAttrs(shape.stroke, "fill", shapeBounds(shape)));
    } else {
      parts.push(`fill="none"`);
    }
    parts.push(...baseAttrs(shape));
    const fx = filterAttr(shape, defs);
    if (fx) parts.push(fx);
    return shapeGeometryToSvg(doc, shape, parts.join(" "));
  }
  const alignment = effectiveStrokeAlignment(shape);
  if (!shape.stroke || shape.strokeWidth <= 0 || alignment === "center") {
    return shapeGeometryToSvg(doc, shape, commonAttrs(doc, shape, defs));
  }

  // SVG has no interoperable inside/outside stroke positioning. Paint fill
  // and stroke separately, double the stroke width, then clip/mask the latter.
  const fill = shapeGeometryToSvg(doc, shape, [...fillSvgAttrs(doc, shape, defs), `stroke="none"`].join(" "));
  const stroke = shapeGeometryToSvg(
    doc,
    shape,
    [`fill="none"`, ...strokeSvgAttrs(shape, defs, shape.strokeWidth * 2, doc)].join(" ")
  );
  const silhouette = shapeGeometryToSvg(
    doc,
    shape,
    `fill="black" stroke="none"${
      shapeFillRule(shape) === "evenodd" ? ` clip-rule="evenodd"` : ""
    }`
  );
  const limitedStroke = alignment === "inside"
    ? `<g clip-path="url(#${defs.strokeClip(silhouette)})">${stroke}</g>`
    : (() => {
        // Keep this region padding in sync with STROKE_MITER_LIMIT and the
        // conservative strokeOutset policy; an undersized mask clips miters.
        const pad = Math.max(1, shape.strokeWidth * STROKE_MITER_LIMIT);
        const mask = defs.strokeMask(silhouette, expandedBounds(shapeBounds(shape, doc), pad));
        return `<g mask="url(#${mask})">${stroke}</g>`;
      })();
  const wrapper = [...baseAttrs(shape), filterAttr(shape, defs)].filter(Boolean).join(" ");
  return `<g${wrapper ? " " + wrapper : ""}>${fill}${limitedStroke}</g>`;
}

function shapeGeometryToSvg(doc: Document, shape: Shape, attrs: string): string {
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
      const rule = shape.fillRule ? ` fill-rule="${shape.fillRule}"` : "";
      return `<path d="${pathData(shape)}"${rule} ${attrs} />`;
    }
    case "brush": {
      const ring = cachedBrushEnvelope(shape);
      if (ring.length < 3) return "";
      const d =
        "M " + ring.map((p) => `${num(p.x)} ${num(p.y)}`).join(" L ") + " Z";
      return `<path d="${d}" fill-rule="nonzero" ${attrs} />`;
    }
    case "compoundPath":
      return `<path d="${compoundChildren(doc, shape)
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
      const segments = subpathSegments(ellipseSubpath(shape));
      if (!segments.length) return "";
      return `M ${point(segments[0].p0)} ${segments
        .map((segment) =>
          `C ${point(segment.c1)} ${point(segment.c2)} ${point(segment.p1)}`
        )
        .join(" ")} Z`;
    }
    case "line":
      return `M ${point({ x: shape.x1, y: shape.y1 })} L ${point({ x: shape.x2, y: shape.y2 })}`;
    case "path":
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

function pathData(shape: PathShape): string {
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
function maskShapeToSvg(doc: Document, shape: ClippingMaskShape): string {
  let d = "";
  switch (shape.type) {
    case "rect":
    case "ellipse":
    case "path":
      d = primitivePathData(shape, [1, 0, 0, 1, 0, 0]);
      break;
    case "compoundPath":
      d = compoundChildren(doc, shape)
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

  const defs = makeDefs(doc);
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
