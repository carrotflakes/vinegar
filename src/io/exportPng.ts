import { buildRenderTree, paintNode } from "../canvas/render";
import type { Document } from "../model/types";
import { contentBounds } from "./exportBounds";

export interface PngOptions {
  /** Pixel density multiplier (1 = bounds size, 2 = retina). */
  scale?: number;
  /** Background color; omit for a transparent PNG. */
  background?: string;
  margin?: number;
}

/** Render a document's shapes to a PNG Blob, cropped to content bounds. */
export async function exportPng(
  doc: Document,
  opts: PngOptions = {}
): Promise<Blob> {
  const { scale = 2, background, margin = 8 } = opts;
  const bounds = contentBounds(doc, margin);
  if (!bounds) throw new Error("Nothing to export.");

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
  for (const node of buildRenderTree(doc)) paintNode(ctx, node);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG encoding failed."));
    }, "image/png");
  });
}
