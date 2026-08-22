import { subpathSegments } from "@/model/path/path";
import { hasActiveModifiers } from "@/model/path/pathModifiers";
import { shapeBounds } from "@/model/geometry/bounds";
import { getAssetImage } from "../imageCache";
import type { ClippingMaskShape } from "../model/clippingMask";
import { shapeFillRule, shapeSubpaths } from "@/model/path/shapeGeometry";
import {
  activeEffects,
  hasEffects,
  isGeometryEffect,
  paintsGeometryEffects,
  pixelEffects,
  strokeEffectOutset,
  SHADOW_BLUR_TO_STDDEV,
} from "../model/effects";
import { applyMatrix, isIdentity } from "@/model/geometry/matrix";
import {
  freeformAverage,
  type FreeformPaint,
  freeformRaster,
} from "@/model/freeform";
import { gradientToSvgDef } from "@/model/gradient";
import {
  hexToRgb,
  paintToSvgAttrs,
  patternPlacement,
  resolvePaintRef,
  type Paint,
  type PaintTarget,
  type PatternPaint,
} from "../model/paint";
import { strokeEndContours, suppressesStrokeCaps } from "../model/marker";
import { isShape } from "../model/scene";
import { containerContents } from "../model/sceneWalk";
import { effectiveRectCornerRadius } from "../model/roundedRect";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  strokeOutset,
  STROKE_MITER_LIMIT,
  supportsStrokeAlignment,
} from "../model/stroke";
import type {
  PathSubpath,
  BlendMode,
  Bounds,
  Document,
  DocumentAsset,
  ColorAdjustEffect,
  TintEffect,
  Effect,
  GeometryEffect,
  Matrix,
  SceneNode,
  Shape,
  Vec2,
} from "../model/types";
import { contentBounds } from "./exportBounds";
import {
  embeddedImageSize,
  validImageSize,
  type ImageSize,
} from "./imageDimensions";
import { layoutTextInBrowser } from "../model/text/layout";
import { fontStack } from "../fonts";

export interface SvgOptions {
  margin?: number | undefined;
  /** Explicit crop region (e.g. a frame). Overrides content bounds. */
  bounds?: Bounds;
  /** Backdrop colour drawn behind the content; omit/null for transparent. */
  background?: string | null | undefined;
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
    kind: PaintTarget,
    bounds: Bounds,
    overflow?: number
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
  if (effect.type === "tint") {
    return tintPrimitive(effect);
  }
  if (effect.type === "drop-shadow") {
    return `<feDropShadow dx="${num(effect.offsetX)}" dy="${num(
      effect.offsetY
    )}" stdDeviation="${num(
      effect.blur * SHADOW_BLUR_TO_STDDEV
    )}" flood-color="${effect.color}" flood-opacity="${num(effect.alpha)}" />`;
  }
  // Geometry effects are sibling elements, not filter primitives; `shapeToSvg`
  // splits them out of the stack before it ever builds a filter.
  return "";
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

/**
 * Tint as a single `feColorMatrix` computing `mix(src, colour, alpha)` per
 * channel while preserving the source alpha — the sRGB counterpart of the
 * canvas `source-atop` fill.
 */
function tintPrimitive(effect: TintEffect): string {
  const { r, g, b } = hexToRgb(effect.color);
  const a = Math.max(0, Math.min(1, effect.alpha));
  const k = num(1 - a);
  const t = (channel: number) => num((a * channel) / 255);
  return (
    `<feColorMatrix color-interpolation-filters="sRGB" type="matrix" values="` +
    `${k} 0 0 0 ${t(r)} 0 ${k} 0 0 ${t(g)} 0 0 ${k} 0 ${t(b)} 0 0 0 1 0" />`
  );
}

function makeDefs(doc: Document): Defs {
  const items: string[] = [];
  let id = 0;
  const nextId = (prefix: string) => `${prefix}${id++}`;
  const imageIds = new Map<string, string>();
  const patternIds = new Map<string, string>();
  const freeformIds = new Map<string, string>();
  const freeformId = (paint: FreeformPaint, bounds: Bounds, overflow: number) => {
    const key = JSON.stringify([paint, bounds, overflow]);
    const existing = freeformIds.get(key);
    if (existing) return existing;
    const markup = freeformToSvg(paint, nextId("ff"), bounds, overflow);
    if (!markup) return null;
    freeformIds.set(key, markup.id);
    items.push(markup.def);
    return markup.id;
  };
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
    const tiled = paint.mode === "tile";
    const image = tiled ? imageId(asset, size) : "";
    const key = JSON.stringify([
      paint.mode,
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
    paintAttrs(paint, kind, bounds, overflow = 0) {
      // Bake `swatch` references to concrete paint; a dangling ref emits
      // `${kind}="none"` (harmless for stroke; suppresses the default black fill).
      const resolved = resolvePaintRef(paint, doc.swatches);
      if (!resolved) return [`${kind}="none"`];
      paint = resolved;
      if (paint.type === "solid") return paintToSvgAttrs(paint, kind);
      if (paint.type === "freeform") {
        const id = freeformId(paint, bounds, overflow);
        // No canvas to rasterise into (a headless export): the mean colour is
        // the honest flat stand-in.
        if (!id) {
          const avg = freeformAverage(paint);
          return paintToSvgAttrs(
            { type: "solid", color: avg.color, alpha: avg.alpha * paint.alpha },
            kind
          );
        }
        return [`${kind}="url(#${id})"`];
      }
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
      items.push(gradientToSvgDef(paint, gradientId, bounds));
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

/** Largest exported raster per side; the field is smooth, so this is ample. */
const FREEFORM_EXPORT_SIDE = 512;
/** How far past the shape's box the raster reaches, as a fraction of it. */
const FREEFORM_PAD = 0.08;

/**
 * A freeform gradient as a one-tile `<pattern>` holding the rasterised field —
 * SVG has no scattered-interpolation paint server, the same reason a conic
 * ramp goes out as flat wedges. The pixels come from `freeformRaster`, so the
 * export shows exactly what the canvas showed. Returns null where there is no
 * canvas to rasterise into (SSR/headless), leaving the caller a flat fallback.
 */
function freeformToSvg(
  paint: FreeformPaint,
  id: string,
  bounds: Bounds,
  overflow: number
): { id: string; def: string } | null {
  if (typeof document === "undefined" || paint.points.length === 0) return null;
  // The tile is padded past the shape so a stroke, which paints outside the
  // box the field is laid out over, still lands on real pixels.
  // SVG patterns repeat outside their tile. Cover the complete painted
  // stroke/marker reach so no adjacent copy can become visible.
  const padX = Math.max(bounds.width * FREEFORM_PAD, overflow + 1, 1);
  const padY = Math.max(bounds.height * FREEFORM_PAD, overflow + 1, 1);
  const rect: Bounds = {
    x: bounds.x - padX,
    y: bounds.y - padY,
    width: Math.max(bounds.width + padX * 2, 1),
    height: Math.max(bounds.height + padY * 2, 1),
  };
  const long = Math.max(rect.width, rect.height);
  const w = Math.max(1, Math.round((rect.width / long) * FREEFORM_EXPORT_SIDE));
  const h = Math.max(1, Math.round((rect.height / long) * FREEFORM_EXPORT_SIDE));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(freeformRaster(paint, rect, bounds, w, h), w, h), 0, 0);
  const href = canvas.toDataURL("image/png");
  return {
    id,
    def:
      `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(rect.x)}" y="${num(
        rect.y
      )}" width="${num(rect.width)}" height="${num(rect.height)}">` +
      `<image href="${escapeXml(href)}" x="0" y="0" width="${num(
        rect.width
      )}" height="${num(rect.height)}" preserveAspectRatio="none"/>` +
      `</pattern>`,
  };
}

function patternToSvg(
  paint: PatternPaint,
  size: ImageSize,
  id: string,
  imageId: string,
  asset: DocumentAsset,
  bounds: Bounds
): string {
  if (paint.mode === "tile") {
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

/**
 * `filter="url(#…)"` for a node's pixel effects, or empty when it has none.
 * Geometry effects never reach a filter: `shapeToSvg` emits them as elements,
 * and a node with no outline drops them entirely.
 */
function filterAttr(node: SceneNode, defs: Defs): string {
  const pixel = pixelEffects(node.effects);
  return hasEffects(pixel) ? `filter="url(#${defs.filter(pixel)})"` : "";
}

function commonAttrs(
  doc: Document,
  shape: Shape,
  defs: Defs,
  /** Outer attributes to fold in; empty when a wrapping <g> carries them. */
  outer: string[] = []
): string {
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
  parts.push(...outer);
  return parts.join(" ");
}

/**
 * The shape's end markers as sibling `<path>` elements. Their geometry is baked
 * in the shape's own coordinate space rather than placed with a transform, so a
 * user-space gradient runs continuously from the line into its arrowhead —
 * exactly as the canvas paints it.
 */
function markerSvg(doc: Document, shape: Shape, defs: Defs): string {
  const contours = strokeEndContours(shape);
  if (!contours.length || !shape.stroke) return "";
  const bounds = shapeBounds(shape, doc);
  return contours
    .map((contour) => {
      const attrs = contour.filled
        ? [
            ...defs.paintAttrs(shape.stroke!, "fill", bounds, strokeOutset(shape)),
            `stroke="none"`,
          ]
        : [
            `fill="none"`,
            ...defs.paintAttrs(shape.stroke!, "stroke", bounds, strokeOutset(shape)),
            `stroke-width="${num(shape.strokeWidth)}"`,
            `stroke-linecap="${shape.strokeCap}"`,
            // Round joins, not the shape's: see paintMarkers.
            `stroke-linejoin="round"`,
          ];
      return `<path d="${subpathsData([contour.subpath])}" ${attrs.join(" ")} />`;
    })
    .join("");
}

function strokeSvgAttrs(
  shape: Shape,
  defs: Defs,
  width: number,
  doc?: Document
): string[] {
  if (!shape.stroke) return [];
  const penOutset =
    (width / 2) * (shape.strokeJoin === "miter" ? STROKE_MITER_LIMIT : 1);
  const parts = [
    ...defs.paintAttrs(
      shape.stroke,
      "stroke",
      shapeBounds(shape, doc),
      Math.max(strokeOutset(shape), penOutset)
    ),
    `stroke-width="${num(width)}"`,
    `stroke-linecap="${suppressesStrokeCaps(shape) ? "butt" : shape.strokeCap}"`,
    `stroke-linejoin="${shape.strokeJoin}"`,
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

/**
 * A shape and its effect stack. Pixel effects become one `<filter>`, but a
 * geometry effect is an *element* painted over the artwork, so a stack that
 * mixes the two splits into runs: each run of pixel effects wraps everything
 * emitted so far in its own filtered `<g>`, and each fill/stroke effect appends
 * a sibling drawn from the same geometry. Nesting the wrappers is what keeps
 * "blur, then add a stroke" distinct from "add a stroke, then blur it".
 */
function shapeToSvg(doc: Document, shape: Shape, defs: Defs): string {
  const effects = activeEffects(shape.effects);
  const geometryEffects =
    effects.some(isGeometryEffect) && paintsGeometryEffects(shape, doc);
  if (!geometryEffects) {
    return shapeContentSvg(
      doc,
      shape,
      defs,
      [...baseAttrs(shape), filterAttr(shape, defs)].filter(Boolean)
    );
  }
  let markup = shapeContentSvg(doc, shape, defs, []);
  let pending: Effect[] = [];

  const flushFilter = () => {
    if (!pending.length) return;
    markup = `<g filter="url(#${defs.filter(pending)})">${markup}</g>`;
    pending = [];
  };
  for (const effect of effects) {
    if (isGeometryEffect(effect)) {
      flushFilter();
      markup += geometryEffectSvg(doc, shape, effect, defs);
    } else {
      pending.push(effect);
    }
  }
  flushFilter();
  const attrs = isolatedBaseAttrs(shape).join(" ");
  return `<g${attrs ? " " + attrs : ""}>${markup}</g>`;
}

/**
 * `baseAttrs` plus `isolation: isolate`, so a blending geometry effect mixes
 * with the node's own artwork and stops there. Canvas gets this for free — the
 * effect stack runs on a layer holding nothing but the node — while SVG would
 * otherwise let `mix-blend-mode` reach the page behind it.
 */
function isolatedBaseAttrs(shape: Shape): string[] {
  const parts = baseAttrs(shape);
  const styled = parts.findIndex((part) => part.startsWith("style="));
  const isolate = `isolation:isolate`;
  if (styled < 0) return [...parts, `style="${isolate}"`];
  parts[styled] = `style="mix-blend-mode:${shape.blendMode};${isolate}"`;
  return parts;
}

/** `style="mix-blend-mode:…"`, or empty for the default. */
function blendAttr(blendMode: BlendMode): string {
  return blendMode === "normal" ? "" : `style="mix-blend-mode:${blendMode}"`;
}

/**
 * One fill or stroke effect as elements drawn from the shape's own geometry.
 * Stroke alignment uses the same clip/mask construction as a shape's own
 * off-centre stroke, since SVG has no interoperable stroke positioning.
 */
function geometryEffectSvg(
  doc: Document,
  shape: Shape,
  effect: GeometryEffect,
  defs: Defs
): string {
  const paint = effect.paint;
  if (!paint) return "";
  const bounds = shapeBounds(shape, doc);
  const blend = blendAttr(effect.blendMode);
  if (effect.type === "fill") {
    const attrs = [
      ...defs.paintAttrs(paint, "fill", bounds),
      `stroke="none"`,
      blend,
    ].filter(Boolean);
    return shapeGeometryToSvg(doc, shape, attrs.join(" "));
  }
  if (effect.width <= 0) return "";
  const outset = strokeEffectOutset(effect);
  const strokeAttrs = (width: number) =>
    [
      `fill="none"`,
      ...defs.paintAttrs(paint, "stroke", bounds, outset),
      `stroke-width="${num(width)}"`,
      `stroke-linecap="${effect.cap}"`,
      `stroke-linejoin="${effect.join}"`,
      `stroke-miterlimit="${STROKE_MITER_LIMIT}"`,
    ].join(" ");
  const alignment = supportsStrokeAlignment(shape) ? effect.alignment : "center";
  if (alignment === "center") {
    return shapeGeometryToSvg(
      doc,
      shape,
      [strokeAttrs(effect.width), blend].filter(Boolean).join(" ")
    );
  }
  // Off-centre: the clipped/masked group blends as a whole, so the pass never
  // mixes with the half of itself that alignment cuts away.
  const stroke = shapeGeometryToSvg(doc, shape, strokeAttrs(effect.width * 2));
  const silhouette = shapeGeometryToSvg(
    doc,
    shape,
    `fill="black" stroke="none"${
      shapeFillRule(shape) === "evenodd" ? ` clip-rule="evenodd"` : ""
    }`
  );
  if (alignment === "inside") {
    const clip = `clip-path="url(#${defs.strokeClip(silhouette)})"`;
    return `<g ${[clip, blend].filter(Boolean).join(" ")}>${stroke}</g>`;
  }
  // Region padding matches the conservative outset policy; an undersized mask
  // clips miters.
  const pad = Math.max(1, effect.width * STROKE_MITER_LIMIT);
  const mask = defs.strokeMask(silhouette, expandedBounds(bounds, pad));
  const masked = `mask="url(#${mask})"`;
  return `<g ${[masked, blend].filter(Boolean).join(" ")}>${stroke}</g>`;
}

/** The shape's own artwork, with `outer` on its outermost element. */
function shapeContentSvg(
  doc: Document,
  shape: Shape,
  defs: Defs,
  outer: string[]
): string {
  if (shape.type === "image") {
    const asset = doc.assets[shape.assetId];
    if (!asset) return "";
    const b = shapeBounds(shape);
    const attrs = outer.join(" ");
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
    parts.push(...outer);
    return shapeGeometryToSvg(doc, shape, parts.join(" "));
  }
  const markers = markerSvg(doc, shape, defs);
  const alignment = effectiveStrokeAlignment(shape);
  if (!shape.stroke || shape.strokeWidth <= 0 || alignment === "center") {
    if (!markers) {
      return shapeGeometryToSvg(doc, shape, commonAttrs(doc, shape, defs, outer));
    }
    // Markers make the node several elements, so opacity / blend / transform /
    // filter move to the wrapper they share.
    const line = shapeGeometryToSvg(doc, shape, commonAttrs(doc, shape, defs));
    const wrapper = outer.join(" ");
    return `<g${wrapper ? " " + wrapper : ""}>${line}${markers}</g>`;
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
  const wrapper = outer.join(" ");
  return `<g${wrapper ? " " + wrapper : ""}>${fill}${limitedStroke}${markers}</g>`;
}

function shapeGeometryToSvg(doc: Document, shape: Shape, attrs: string): string {
  // Primitive SVG elements below are an output-form fast path, not a second
  // geometry derivation: they only apply while the shape still *is* that
  // primitive. A modifier has no SVG counterpart, so it falls through to the
  // canonical `<path>` route.
  if (hasActiveModifiers(shape)) {
    return `<path d="${geometryPathData(shape, doc)}" ${attrs} />`;
  }
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
    case "path":
    case "brush":
    case "compoundPath": {
      const d = geometryPathData(shape, doc);
      if (!d) return "";
      // A path only states its rule when it stores one; the other two always
      // carry the rule their geometry is defined under.
      const rule = shape.type === "path"
        ? (shape.fillRule ? ` fill-rule="${shape.fillRule}"` : "")
        : ` fill-rule="${shapeFillRule(shape)}"`;
      return `<path d="${d}"${rule} ${attrs} />`;
    }
    case "image":
      return "";
  }
}

/** Path data for a shape's canonical geometry, optionally under a matrix. */
function geometryPathData(
  shape: Shape,
  doc: Document,
  matrix?: Matrix
): string {
  return subpathsData(shapeSubpaths(shape, doc) ?? [], matrix);
}

function subpathsData(subpaths: PathSubpath[], matrix?: Matrix): string {
  const at = (p: Vec2) => {
    const out = matrix ? applyMatrix(matrix, p) : p;
    return `${num(out.x)} ${num(out.y)}`;
  };
  const parts: string[] = [];
  for (const sp of subpaths) {
    if (sp.anchors.length === 0) continue;
    let d = `M ${at(sp.anchors[0].p)}`;
    for (const s of subpathSegments(sp)) {
      // Straight segments carry their handles on the endpoints; emitting them
      // as cubics would bloat the file for no visual difference.
      d += s.c1.x === s.p0.x && s.c1.y === s.p0.y &&
        s.c2.x === s.p1.x && s.c2.y === s.p1.y
        ? ` L ${at(s.p1)}`
        : ` C ${at(s.c1)} ${at(s.c2)} ${at(s.p1)}`;
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
  const d = geometryPathData(shape, doc);
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
  const contents = containerContents(doc, node, activeSymbols);
  if (!contents) return [];
  const { childIds } = contents;
  const symbolId = contents.kind === "instance" ? contents.symbolId : null;
  let clipId: string | null = null;
  // A frame's own background box, painted behind its children (the editor's
  // checkerboard for a transparent frame is chrome, so it stays out of export).
  let background: string | null = null;
  if (contents.kind === "group" && contents.mask) {
    clipId = defs.clipPath(contents.mask);
  } else if (contents.kind === "frame") {
    const { frame } = contents;
    if (frame.background) {
      background = `<rect width="${num(frame.width)}" height="${num(
        frame.height
      )}" fill="${escapeXml(frame.background)}"/>`;
    }
    if (frame.clipsContent) {
      clipId = defs.nextId("clip");
      defs.items.push(
        `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect width="${num(
          frame.width
        )}" height="${num(frame.height)}"/></clipPath>`
      );
    }
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
    ...(background ? [indent + "  " + background] : []),
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
  const contents = containerContents(doc, node, activeSymbols);
  if (!contents) return false;
  const symbolId = contents.kind === "instance" ? contents.symbolId : null;
  if (symbolId) activeSymbols.add(symbolId);
  const result = contents.childIds.some((id) => {
    const child = doc.nodes[id];
    return !!child && usesBlend(doc, child, activeSymbols);
  });
  if (symbolId) activeSymbols.delete(symbolId);
  return result;
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
