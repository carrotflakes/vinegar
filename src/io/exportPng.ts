import { ensureDocImagesLoaded } from "../canvas/imageCache";
import { paintNode } from "../canvas/render";
import type { Bounds, Document } from "../model/types";
import { contentBounds } from "./exportBounds";

export interface PngOptions {
  /** Pixel density multiplier (1 = bounds size, 2 = retina). */
  scale?: number;
  /** Background color; omit for a transparent PNG. */
  background?: string;
  margin?: number;
  /** Explicit crop region (e.g. an artboard). Overrides content bounds. */
  bounds?: Bounds;
  /** Encoded image MIME type. Defaults to `image/png`. */
  mimeType?: string;
  /** Lossy quality (0–1) for `image/jpeg` and `image/webp`. */
  quality?: number;
}

/** Render a document's shapes to a raster Blob, cropped to content or explicit bounds. */
export async function exportPng(
  doc: Document,
  opts: PngOptions = {}
): Promise<Blob> {
  const { scale = 2, background, margin = 8, mimeType = "image/png", quality } = opts;
  const bounds = opts.bounds ?? contentBounds(doc, margin);
  if (!bounds) throw new Error("Nothing to export.");

  // Painting is synchronous; make sure every placed image has pixels first.
  await ensureDocImagesLoaded(doc);
  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D context.");

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);
  // With an explicit crop region, clip so shapes spanning the edge are cropped.
  if (opts.bounds) {
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();
  }
  for (const nodeId of doc.rootIds) paintNode(ctx, doc, nodeId);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Image encoding failed."));
      },
      mimeType,
      quality
    );
  });
}
