// System-clipboard bridge for copy/paste across tabs and apps. Copy writes the
// selection as SVG (the interop carrier); paste reads it back through the
// native `paste` event. A per-copy nonce embedded on the SVG root lets us
// recognise our own copy so a same-tab paste can restore full fidelity from
// the in-memory clipboard instead of round-tripping through SVG.

import type { Document } from "../model/types";
import { exportSvg } from "./exportSvg";

const NONCE_ATTR = "data-vinegar-copy";

// Module-scoped: only the tab that performed the copy holds the live nonce, so
// a cross-tab paste naturally falls through to SVG geometry import.
let lastCopyNonce: string | null = null;

/** Serialize just the given roots to SVG, tagged with the copy nonce. */
function buildSelectionSvg(doc: Document, rootIds: string[], nonce: string): string {
  const svg = exportSvg({ ...doc, rootIds });
  return svg.replace("<svg ", `<svg ${NONCE_ATTR}="${nonce}" `);
}

/**
 * Best-effort mirror of the copied selection to the system clipboard as SVG.
 * The in-memory clipboard remains the source of truth; failures here (no
 * Clipboard API, denied permission, insecure context) are silently ignored.
 */
export async function copySelectionToSystemClipboard(
  doc: Document,
  rootIds: string[]
): Promise<void> {
  if (!rootIds.length) return;
  const nonce = Math.random().toString(36).slice(2);
  let svg: string;
  try {
    svg = buildSelectionSvg(doc, rootIds, nonce);
  } catch {
    return; // Nothing exportable (e.g. empty bounds).
  }
  lastCopyNonce = nonce;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/svg+xml": new Blob([svg], { type: "image/svg+xml" }),
        "text/plain": new Blob([svg], { type: "text/plain" }),
      }),
    ]);
  } catch {
    // Clipboard write unavailable — same-tab paste still works via memory.
  }
}

/** Pull the SVG text out of a paste event's clipboard data, if any. */
export function svgTextFromClipboard(data: DataTransfer | null): string | null {
  if (!data) return null;
  const text = data.getData("text/plain") || data.getData("image/svg+xml");
  return text && /<svg[\s>]/i.test(text) ? text : null;
}

/** True when the pasted SVG is the one this tab just copied. */
export function isOwnCopy(svgText: string): boolean {
  return lastCopyNonce != null && svgText.includes(`${NONCE_ATTR}="${lastCopyNonce}"`);
}
