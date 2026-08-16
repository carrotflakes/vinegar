// The one place that decides what a paste means, shared by both routes into it:
// the native `paste` event (which carries its own data) and the Paste command
// in the menus and palette (which reads the system clipboard itself — the only
// way to paste on iOS, where Safari dispatches no `paste` event unless focus
// sits inside a text field).

import { hasFileData, imageFilesFromData } from "@/io/importImage";
import { importSvg } from "@/io/importSvg";
import { isOwnCopy, payloadFromSvg, svgTextFromClipboard } from "@/io/systemClipboard";
import type { Vec2 } from "@/model/types";
import { useEditor } from "@/store/editorStore";
import { notify } from "@/store/toastStore";
import { pasteForeignPayload, placeImagesFitted, placeSvgFitted } from "./canvasPlacement";

/** Shown when a paste arrives but nothing in it can become artwork. */
export const NOTHING_TO_PASTE =
  "Nothing to paste — the clipboard holds no artwork this app can read.";

/** Clipboard contents reduced to what a paste can act on. */
export interface ClipboardContent {
  images: File[];
  /** SVG markup — our own copy, another tab's, or foreign art. */
  svg: string | null;
  /** An SVG file: the same vector art, still to be read off the file. */
  svgFile: File | null;
  /** A file was present that we could not turn into any of the above. */
  unusableFile: boolean;
}

/** Whether a file is SVG — vector art to paste, not a raster image to place. */
function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || (!file.type && /\.svgz?$/i.test(file.name));
}

/** Read a paste event's payload. Synchronous: `clipboardData` dies with the event. */
export function clipboardContentFromEvent(e: ClipboardEvent): ClipboardContent {
  const data = e.clipboardData;
  const files = imageFilesFromData(data);
  // An SVG on the clipboard is artwork we can edit, so it is imported as
  // vectors rather than embedded as an image — the same choice the async read
  // makes, and the same one the file picker deliberately does not (placing an
  // SVG *file* as an image asset stays available there).
  const images = files.filter((f) => !isSvgFile(f));
  const svg = svgTextFromClipboard(data);
  const svgFile = svg ? null : (files.find(isSvgFile) ?? null);
  return {
    images,
    svg,
    svgFile,
    unusableFile: hasFileData(data) && !images.length && !svg && !svgFile,
  };
}

/** Whether the async clipboard can be read at all (Safari/Chrome yes, Firefox no). */
export function canReadSystemClipboard(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function";
}

// No ⌘V fallback for iOS. Safari dispatches no `paste` event while focus is
// outside a text field, and `navigator.clipboard.read()` cannot stand in for
// it: iOS shows its paste confirmation only while ⌘ is held and withdraws it
// the moment the key comes up, so the read is always refused. Pasting there
// goes through the Paste command (long-press menu, palette), whose tap is a
// gesture iOS honours.

/** Preference order when one clipboard item offers several image types. */
const TYPE_PREFERENCE = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function typeRank(type: string): number {
  const i = TYPE_PREFERENCE.indexOf(type);
  return i === -1 ? TYPE_PREFERENCE.length : i;
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/avif": "avif",
};

/**
 * Read the system clipboard through the async API. Returns null when the read
 * is unavailable or refused (no permission, insecure context, the user
 * dismissed iOS's paste confirmation) — the caller falls back to the in-memory
 * clipboard rather than reporting an error.
 *
 * Must be called straight off a user gesture: the permission rides on the
 * gesture's transient activation.
 */
export async function readSystemClipboard(): Promise<ClipboardContent | null> {
  if (!canReadSystemClipboard()) return null;
  let items: ClipboardItem[];
  try {
    items = await navigator.clipboard.read();
  } catch {
    return null;
  }
  const images: File[] = [];
  let svg: string | null = null;
  let sawFile = false;
  for (const item of items) {
    // SVG is vector art to us, never a raster image — a Vinegar copy carries
    // its payload in the markup, so importing it beats embedding it as a file.
    const svgType = item.types.find((t) => t === "image/svg+xml");
    // One item is one image, however many flavours it is offered in (a
    // screenshot commonly advertises PNG and TIFF at once). Take the first that
    // retrieves, in our own order of preference, so it lands once.
    const imageTypes = item.types
      .filter((t) => t.startsWith("image/") && t !== svgType)
      .sort((a, b) => typeRank(a) - typeRank(b));
    for (const type of imageTypes) {
      sawFile = true;
      try {
        const blob = await item.getType(type);
        images.push(new File([blob], `pasted.${EXTENSIONS[type] ?? "img"}`, { type }));
        break;
      } catch {
        // Type advertised but not retrievable; the next flavour may be.
      }
    }
    if (svg) continue;
    for (const type of [svgType, "text/plain"]) {
      if (!type || !item.types.includes(type)) continue;
      try {
        const text = await (await item.getType(type)).text();
        if (/<svg[\s>]/i.test(text)) {
          svg = text;
          break;
        }
      } catch {
        // Unreadable text type; fall through.
      }
    }
  }
  return { images, svg, svgFile: null, unusableFile: sawFile && !images.length && !svg };
}

/**
 * Bring SVG markup in. Our own copy in this tab pastes from memory for full
 * fidelity; a copy from another tab restores the payload embedded in the SVG;
 * anything else (or a payload this document can't take) comes in as plain
 * vector geometry.
 */
function pasteSvgMarkup(svg: string, name: string, at?: Vec2): void {
  const s = useEditor.getState();
  if (s.clipboard && isOwnCopy(svg)) {
    s.paste(at);
    return;
  }
  const payload = payloadFromSvg(svg);
  if (!payload || !pasteForeignPayload(payload, at)) {
    placeSvgFitted(importSvg(svg, name), at);
  }
}

/**
 * Apply clipboard content to the document. Images win over markup (a copied
 * screenshot also carries an HTML wrapper). Returns false when nothing landed —
 * note that a `true` for an image or an SVG file only means the work started,
 * since reading those is asynchronous.
 */
export function pasteClipboardContent(content: ClipboardContent, at?: Vec2): boolean {
  if (content.images.length) {
    void placeImagesFitted(content.images, at);
    return true;
  }
  if (content.svg) {
    pasteSvgMarkup(content.svg, "Pasted SVG", at);
    return true;
  }
  const svgFile = content.svgFile;
  if (svgFile) {
    void svgFile.text().then((markup) => {
      // Not markup after all (a compressed .svgz, a mislabelled file).
      if (!/<svg[\s>]/i.test(markup)) {
        notify.error(NOTHING_TO_PASTE);
        return;
      }
      pasteSvgMarkup(markup, svgFile.name.replace(/\.svgz?$/i, "") || "Pasted SVG", at);
    });
    return true;
  }
  return useEditor.getState().paste(at);
}
