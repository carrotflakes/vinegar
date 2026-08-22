// ===========================================================================
// Async parse cache for bundled font binaries. Glyph geometry is asked for
// synchronously while painting, so the cache answers from memory and starts a
// background fetch on a miss, notifying subscribers when the font arrives —
// exactly the shape of `imageCache.ts`, for the same reason.
// ===========================================================================

import * as opentypeNs from "opentype.js";
// opentype.js ships as CJS; depending on the bundler/SSR interop the library
// lands either on the namespace itself or on its `default` (see boolean.ts).
const opentype: typeof opentypeNs =
  (opentypeNs as { default?: typeof opentypeNs }).default ?? opentypeNs;
import type { Font } from "opentype.js";
import { fontFileFor, fontFileUrl } from "./fonts";
import type { Document, TextShape } from "./model/types";
import { isShape } from "./model/scene";

/** Parsed fonts by file name; null marks a failed load (don't retry). */
const parsed = new Map<string, Font | null>();
const pending = new Map<string, Promise<Font | null>>();
const listeners = new Set<() => void>();

/**
 * Notify when the geometry a text shape resolves to may have changed: a
 * pending font settles, or the browser reports new metrics (the outlines are
 * *placed* by the measured layout, so a metrics change moves them). Subscribers
 * drop whatever they derived from text and repaint.
 */
export function subscribeFontCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announce such a change from outside the cache (see `layout.ts`). */
export function notifyFontsChanged(): void {
  for (const listener of listeners) listener();
}

/**
 * Hand the cache a font binary directly, bypassing the fetch. Node has no
 * origin to resolve `/fonts/…` against, so tests read the file themselves.
 */
export function provideFontBinary(file: string, data: ArrayBuffer): void {
  parsed.set(file, opentype.parse(data));
  pending.delete(file);
  notifyFontsChanged();
}

function load(file: string): Promise<Font | null> {
  const existing = pending.get(file);
  if (existing) return existing;
  const promise = fetch(fontFileUrl(file))
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .then((data) => (data ? opentype.parse(data) : null))
    .catch(() => null)
    .then((font) => {
      parsed.set(file, font);
      pending.delete(file);
      notifyFontsChanged();
      return font;
    });
  pending.set(file, promise);
  return promise;
}

/**
 * The parsed font a text style resolves to, or null while it loads, after a
 * failure, or for a system font that ships no binary. A miss starts the load
 * in the background; callers fall back to whatever they do without geometry.
 */
export function getOutlineFont(
  family: string,
  weight: number,
  italic: boolean
): Font | null {
  const file = fontFileFor(family, weight, italic);
  if (!file) return null;
  const hit = parsed.get(file.file);
  if (hit !== undefined) return hit;
  void load(file.file);
  return null;
}

/** Await one style's font (exports, and the outline command's precondition). */
export function loadOutlineFont(
  family: string,
  weight: number,
  italic: boolean
): Promise<Font | null> {
  const file = fontFileFor(family, weight, italic);
  if (!file) return Promise.resolve(null);
  const hit = parsed.get(file.file);
  if (hit !== undefined) return Promise.resolve(hit);
  return load(file.file);
}

/** Every text style a document uses, deduplicated. */
export function referencedTextStyles(
  doc: Document
): { family: string; weight: number; italic: boolean }[] {
  const seen = new Map<string, TextShape>();
  for (const node of Object.values(doc.nodes)) {
    if (!isShape(node) || node.type !== "text") continue;
    seen.set(`${node.fontFamily}\n${node.fontWeight}\n${node.italic}`, node);
  }
  return [...seen.values()].map((shape) => ({
    family: shape.fontFamily,
    weight: shape.fontWeight,
    italic: shape.italic,
  }));
}

/** Ensure every font the document's text needs is parsed, for exports. */
export async function ensureDocFontsLoaded(doc: Document): Promise<void> {
  await Promise.all(
    referencedTextStyles(doc).map((style) =>
      loadOutlineFont(style.family, style.weight, style.italic)
    )
  );
}
