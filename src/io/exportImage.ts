import type { Artboard, Bounds, Document } from "../model/types";
import { artboardBounds } from "../model/types";
import { contentBounds } from "./exportBounds";
import type { PngOptions } from "./exportPng";

/** Which part of the document a raster export covers. */
export type ExportScope = "content" | "artboard" | "selection";

/**
 * How the output pixel dimensions are chosen. `scale` multiplies the region's
 * logical size; `width`/`height` pin one axis to an absolute pixel count and
 * derive the multiplier from it (the other axis follows the aspect ratio).
 */
export type ExportSizeMode = "scale" | "width" | "height";

export type ExportFormat = "png" | "jpeg" | "webp";

interface FormatInfo {
  label: string;
  mimeType: string;
  extension: string;
  /** Whether the encoding preserves transparency. */
  hasAlpha: boolean;
  /** Whether a lossy quality factor applies. */
  lossy: boolean;
}

export const FORMAT_INFO: Record<ExportFormat, FormatInfo> = {
  png: { label: "PNG", mimeType: "image/png", extension: "png", hasAlpha: true, lossy: false },
  jpeg: { label: "JPEG", mimeType: "image/jpeg", extension: "jpg", hasAlpha: false, lossy: true },
  webp: { label: "WebP", mimeType: "image/webp", extension: "webp", hasAlpha: true, lossy: true },
};

export const EXPORT_FORMATS = Object.keys(FORMAT_INFO) as ExportFormat[];

export interface ExportImageSettings {
  format: ExportFormat;
  scope: ExportScope;
  sizeMode: ExportSizeMode;
  /** Multiplier for `sizeMode === "scale"`. */
  scale: number;
  /** Target pixels for `sizeMode === "width" | "height"`. */
  pixelSize: number;
  /** Transparent output; when false, `background` is painted behind content. */
  transparent: boolean;
  background: string;
  /** Lossy quality (0–1) for JPEG/WebP. */
  quality: number;
  /** Extra padding around content bounds (ignored for artboard scope). */
  margin: number;
}

export const DEFAULT_EXPORT_SETTINGS: ExportImageSettings = {
  format: "png",
  scope: "content",
  sizeMode: "scale",
  scale: 2,
  pixelSize: 1000,
  transparent: true,
  background: "#ffffff",
  quality: 0.92,
  margin: 8,
};

export const SCALE_PRESETS = [0.5, 1, 2, 3, 4] as const;

/**
 * Largest output edge, in pixels. Browsers cap canvas dimensions (Safari and
 * Chrome both refuse ≳16384 px per side); beyond this `toBlob` yields null and
 * the encode fails, so the UI blocks the export before it reaches that point.
 */
export const MAX_EXPORT_EDGE = 16384;

/** Whether the output size exceeds what the canvas backend can encode. */
export function exceedsPixelLimit(size: { width: number; height: number }): boolean {
  return size.width > MAX_EXPORT_EDGE || size.height > MAX_EXPORT_EDGE;
}

/** Region selection context resolved by the caller (has scene/selection access). */
export interface ExportRegionContext {
  artboard: Artboard | null;
  selectionBounds: Bounds | null;
}

/** Resolve the crop region for the chosen scope, or null when nothing fits. */
export function resolveExportBounds(
  doc: Document,
  settings: ExportImageSettings,
  ctx: ExportRegionContext
): Bounds | null {
  if (settings.scope === "artboard") {
    return ctx.artboard ? artboardBounds(ctx.artboard) : null;
  }
  if (settings.scope === "selection") {
    return ctx.selectionBounds;
  }
  return contentBounds(doc, settings.margin);
}

/**
 * Effective pixel-density multiplier for the given bounds. Absolute width/height
 * modes divide the target pixels by the region's logical extent; scale mode uses
 * the multiplier directly. Always positive.
 */
export function effectiveScale(settings: ExportImageSettings, bounds: Bounds): number {
  let scale: number;
  if (settings.sizeMode === "width") {
    scale = settings.pixelSize / bounds.width;
  } else if (settings.sizeMode === "height") {
    scale = settings.pixelSize / bounds.height;
  } else {
    scale = settings.scale;
  }
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Output pixel dimensions for the given settings and region. */
export function outputPixelSize(
  settings: ExportImageSettings,
  bounds: Bounds
): { width: number; height: number } {
  const scale = effectiveScale(settings, bounds);
  return {
    width: Math.max(1, Math.ceil(bounds.width * scale)),
    height: Math.max(1, Math.ceil(bounds.height * scale)),
  };
}

/** Whether the current format supports a transparent background at all. */
export function supportsTransparency(settings: ExportImageSettings): boolean {
  return FORMAT_INFO[settings.format].hasAlpha;
}

/**
 * Translate export settings into the low-level {@link PngOptions} consumed by
 * `exportPng`. The artboard's own background wins when the region is an artboard
 * and no explicit override is requested. Formats without an alpha channel always
 * receive a background so they never flatten onto black.
 */
export function toPngOptions(
  settings: ExportImageSettings,
  bounds: Bounds,
  artboard: Artboard | null
): PngOptions {
  const info = FORMAT_INFO[settings.format];
  const scale = effectiveScale(settings, bounds);
  const wantsTransparent = settings.transparent && info.hasAlpha;
  let background: string | undefined;
  if (!wantsTransparent) {
    background =
      settings.scope === "artboard" && artboard?.background
        ? artboard.background
        : settings.background;
  }
  return {
    scale,
    background,
    bounds,
    margin: settings.margin,
    mimeType: info.mimeType,
    quality: info.lossy ? settings.quality : undefined,
  };
}

/** Filename stem + extension for a completed export. */
export function exportFilename(
  settings: ExportImageSettings,
  stem: string
): string {
  return `${stem}.${FORMAT_INFO[settings.format].extension}`;
}

/* --- Persistence -------------------------------------------------------- */

const SETTINGS_KEY = "vinegar.exportSettings";

/** Load persisted export settings, merged over defaults. Never throws. */
export function loadExportSettings(): ExportImageSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_EXPORT_SETTINGS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_EXPORT_SETTINGS;
    // Merge over defaults so a stored subset (or an older schema) stays valid.
    return { ...DEFAULT_EXPORT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

/** Persist export settings for the next session. Never throws. */
export function saveExportSettings(settings: ExportImageSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage is optional */
  }
}
