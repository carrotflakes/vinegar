// ===========================================================================
// Async decode cache for raster image assets. Painting is synchronous, so
// the renderer asks the cache for a decoded image by asset; a miss kicks off
// a background decode and notifies subscribers when the pixels arrive, at
// which point the canvas repaints and picks them up.
// ===========================================================================

import type { Document, DocumentAsset } from "../model/types";
import { isShape } from "../model/scene";

/** Decoded pixels by asset id; null marks a failed decode (don't retry). */
const decoded = new Map<string, HTMLImageElement | null>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();
const listeners = new Set<() => void>();

/** Notify when any pending decode settles (canvas subscribes to repaint). */
export function subscribeImageCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function decode(asset: DocumentAsset): Promise<HTMLImageElement | null> {
  const existing = pending.get(asset.id);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = asset.source.data;
  }).then((img) => {
    decoded.set(asset.id, img);
    pending.delete(asset.id);
    for (const listener of listeners) listener();
    return img;
  });
  pending.set(asset.id, promise);
  return promise;
}

/**
 * Decoded image for an asset, or null while decoding / after a failure.
 * A miss starts the decode in the background.
 */
export function getAssetImage(asset: DocumentAsset): HTMLImageElement | null {
  const hit = decoded.get(asset.id);
  if (hit !== undefined) return hit;
  void decode(asset);
  return null;
}

/** Await one asset's pixels (import-time sizing, exports). */
export function loadAssetImage(
  asset: DocumentAsset
): Promise<HTMLImageElement | null> {
  const hit = decoded.get(asset.id);
  if (hit !== undefined) return Promise.resolve(hit);
  return decode(asset);
}

/** Ensure every asset referenced by an image node is decoded (for exports). */
export async function ensureDocImagesLoaded(doc: Document): Promise<void> {
  const used = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (isShape(node) && node.type === "image") used.add(node.assetId);
  }
  await Promise.all(
    [...used]
      .map((id) => doc.assets[id])
      .filter((asset): asset is DocumentAsset => !!asset)
      .map(loadAssetImage)
  );
}
