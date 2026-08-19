// System-clipboard bridge for copy/paste across tabs and apps. Copy writes the
// selection as SVG (the interop carrier); paste reads it back through the
// native `paste` event. A per-copy nonce embedded on the SVG root lets us
// recognise our own copy so a same-tab paste can restore full fidelity from
// the in-memory clipboard instead of round-tripping through SVG.
//
// The SVG also carries the native payload — the copied nodes plus the scripts,
// assets and swatches they reference — inside a <metadata> element, so a paste
// in ANOTHER tab (or after a reload) restores generator links, effects and
// global colours rather than re-importing flattened geometry. The payload is a
// regular Vinegar file — the `.vinegar` container, base64'd — so parsing it
// reuses the file format's validation and version gate; foreign SVG simply has
// no such element. Reading accepts the uncompressed JSON form too, so a copy
// made before this build still pastes natively.

import {
  descendantNodeIds,
  reachableSymbols,
  referencedSymbolIds,
} from "@/model/scene";
import type { ClipboardPayload } from "@/store/docOps";
import { createEmptyDocument, type Document } from "../model/types";
import {
  decodeBase64,
  encodeBase64,
  encodeDocument,
  parseDocumentBytes,
} from "./container";
import { exportSvg } from "./exportSvg";

const NONCE_ATTR = "data-vinegar-copy";
const PAYLOAD_ATTR = "data-vinegar-payload";
const PAYLOAD_RE = new RegExp(`<metadata ${PAYLOAD_ATTR}="([A-Za-z0-9+/=]*)"`);

/**
 * Cap on the embedded payload (base64 characters). Big pasted images would
 * otherwise be carried twice — once as the SVG's data URI, once as the
 * payload's asset — and blow up every clipboard write; past the cap the copy
 * degrades to plain SVG interop. The payload is compressed, so reaching the cap
 * now takes genuinely enormous art rather than an ordinary big selection.
 */
const MAX_PAYLOAD_CHARS = 8 * 1024 * 1024;

// Module-scoped: only the tab that performed the copy holds the live nonce, so
// a cross-tab paste naturally falls through to the embedded payload (or, for
// foreign SVG, to geometry import).
let lastCopyNonce: string | null = null;

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
    swatches: payload.swatches,
    swatchOrder: Object.keys(payload.swatches),
    params: payload.params,
    paramOrder: Object.keys(payload.params),
  };
}

/** Serialize just the given roots to SVG, tagged with the copy nonce. */
async function buildSelectionSvg(
  doc: Document,
  payload: ClipboardPayload,
  nonce: string
): Promise<string> {
  const svg = exportSvg({ ...doc, rootIds: payload.rootIds });
  const tagged = svg.replace("<svg ", `<svg ${NONCE_ATTR}="${nonce}" `);
  let encoded: string;
  try {
    encoded = encodeBase64(await encodeDocument(payloadDocument(doc, payload)));
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
    svg = await buildSelectionSvg(doc, payload, nonce);
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
export async function payloadFromSvg(
  svgText: string
): Promise<ClipboardPayload | null> {
  const match = PAYLOAD_RE.exec(svgText);
  if (!match) return null;
  let doc: Document;
  try {
    doc = await parseDocumentBytes(decodeBase64(match[1]!));
  } catch {
    return null;
  }
  return {
    nodes: doc.nodes,
    rootIds: doc.rootIds,
    scripts: doc.scripts,
    assets: doc.assets,
    swatches: doc.swatches,
    params: doc.params,
    scriptsTrusted: false,
  };
}
