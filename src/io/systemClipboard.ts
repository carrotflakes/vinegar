// System-clipboard bridge for copy/paste across tabs and apps. Copy writes the
// selection as SVG (the interop carrier); paste reads it back through the
// native `paste` event. A per-copy nonce embedded on the SVG root lets us
// recognise our own copy so a same-tab paste can restore full fidelity from
// the in-memory clipboard instead of round-tripping through SVG.
//
// The SVG also carries the native payload — the copied nodes plus the scripts,
// assets and variables they reference — inside a <metadata> element, so a paste
// in ANOTHER tab (or after a reload) restores generator links, effects and
// global colours rather than re-importing flattened geometry. The payload is a
// regular Vinegar document, so parsing it reuses the file format's validation
// and version gate; foreign SVG simply has no such element.

import {
  descendantNodeIds,
  reachableSymbols,
  referencedSymbolIds,
} from "@/model/scene";
import type { ClipboardPayload } from "@/store/docOps";
import { createEmptyDocument, type Document } from "../model/types";
import { exportSvg } from "./exportSvg";
import { parseDocument, serializeDocument } from "./serialize";

const NONCE_ATTR = "data-vinegar-copy";
const PAYLOAD_ATTR = "data-vinegar-payload";
const PAYLOAD_RE = new RegExp(`<metadata ${PAYLOAD_ATTR}="([A-Za-z0-9+/=]*)"`);

/**
 * Cap on the embedded payload (base64 characters). Big pasted images would
 * otherwise be carried twice — once as the SVG's data URI, once as the
 * payload's asset — and blow up every clipboard write; past the cap the copy
 * degrades to plain SVG interop.
 */
const MAX_PAYLOAD_CHARS = 8 * 1024 * 1024;

// Module-scoped: only the tab that performed the copy holds the live nonce, so
// a cross-tab paste naturally falls through to the embedded payload (or, for
// foreign SVG, to geometry import).
let lastCopyNonce: string | null = null;

const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on big art.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (base64: string): string => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/**
 * The payload as a standalone Vinegar document: the copied nodes as roots plus
 * only the definitions they reference. Symbol definitions ride along through
 * `doc.symbols` so the document validates; merging them into the destination
 * is not implemented yet, so a cross-tab paste of an instance still falls back
 * to SVG geometry.
 */
function payloadDocument(doc: Document, payload: ClipboardPayload): Document {
  const nodes = { ...payload.nodes };
  const symbols: Document["symbols"] = {};
  for (const symbolId of referencedSymbolIds(Object.values(payload.nodes))) {
    for (const reachable of reachableSymbols(doc, symbolId)) {
      const def = doc.symbols[reachable];
      if (!def) continue;
      symbols[reachable] = def;
      for (const id of [def.rootNodeId, ...descendantNodeIds(doc, def.rootNodeId)]) {
        if (doc.nodes[id]) nodes[id] = doc.nodes[id];
      }
    }
  }
  return {
    ...createEmptyDocument(),
    nodes,
    rootIds: payload.rootIds,
    symbols,
    scripts: payload.scripts,
    assets: payload.assets,
    vars: payload.vars,
    varOrder: Object.keys(payload.vars),
  };
}

/** Serialize just the given roots to SVG, tagged with the copy nonce. */
function buildSelectionSvg(doc: Document, payload: ClipboardPayload, nonce: string): string {
  const svg = exportSvg({ ...doc, rootIds: payload.rootIds });
  const tagged = svg.replace("<svg ", `<svg ${NONCE_ATTR}="${nonce}" `);
  let encoded: string;
  try {
    encoded = toBase64(serializeDocument(payloadDocument(doc, payload)));
  } catch {
    return tagged; // Not serializable — plain SVG still copies.
  }
  if (encoded.length > MAX_PAYLOAD_CHARS) return tagged;
  return tagged.replace(
    /(<svg[^>]*>)/,
    `$1<metadata ${PAYLOAD_ATTR}="${encoded}"></metadata>`
  );
}

/**
 * Best-effort mirror of the copied selection to the system clipboard as SVG.
 * The in-memory clipboard remains the source of truth; failures here (no
 * Clipboard API, denied permission, insecure context) are silently ignored.
 */
export async function copySelectionToSystemClipboard(
  doc: Document,
  payload: ClipboardPayload
): Promise<void> {
  if (!payload.rootIds.length) return;
  const nonce = Math.random().toString(36).slice(2);
  let svg: string;
  try {
    svg = buildSelectionSvg(doc, payload, nonce);
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

/**
 * Recover the native payload embedded by a Vinegar copy, or null when the SVG
 * carries none (foreign art) or a version/shape this build cannot read. The
 * bytes come from outside the app, so scripts always arrive untrusted no matter
 * what the copying tab believed.
 */
export function payloadFromSvg(svgText: string): ClipboardPayload | null {
  const match = PAYLOAD_RE.exec(svgText);
  if (!match) return null;
  let doc: Document;
  try {
    doc = parseDocument(fromBase64(match[1]));
  } catch {
    return null;
  }
  return {
    nodes: doc.nodes,
    rootIds: doc.rootIds,
    scripts: doc.scripts,
    assets: doc.assets,
    vars: doc.vars,
    scriptsTrusted: false,
  };
}
