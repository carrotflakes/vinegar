// Turning picked/dropped image files into document assets.

import { loadAssetImage } from "../imageCache";
import { makeId, type DocumentAsset } from "../model/types";

/** MIME types offered in the file picker. Not the acceptance test — see `isImageFile`. */
export const IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp,image/avif,image/heic,image/heif,image/tiff";

/** Extensions we treat as images when the platform hands us a file with no MIME type. */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svgz?|bmp|avif|heic|heif|tiff?)$/i;

/**
 * Whether a file is worth *trying* to decode. Deliberately permissive: the
 * clipboard hands over types no allow-list anticipates (HEIC from an iPad's
 * photo library, TIFF from macOS Preview, an empty type from Safari), and
 * silently dropping them here is indistinguishable from a broken paste. The
 * real gate is `importImageFile`, which reports a failed decode to the user.
 */
export function isImageFile(file: File): boolean {
  if (file.type) return file.type.startsWith("image/");
  return IMAGE_EXTENSIONS.test(file.name);
}

/**
 * Pull candidate image files out of a clipboard (or drag) payload. Pasted
 * screenshots arrive as a `file` item with a synthetic name; `placeImageFiles`
 * supplies a fallback name for those. Some browsers populate only `files` on a
 * paste, so that is the fallback when `items` yields nothing.
 */
export function imageFilesFromData(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = [...data.items]
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter((f): f is File => f != null);
  const files = fromItems.length ? fromItems : [...data.files];
  return files.filter(isImageFile);
}

/** Whether the payload carries any file at all — an image we rejected, or something else. */
export function hasFileData(data: DataTransfer | null): boolean {
  if (!data) return false;
  return [...data.types].includes("Files") || data.files.length > 0;
}

/** Open a native file picker and resolve with the selected image files. */
export function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_ACCEPT;
    input.multiple = true;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

export interface ImportedImage {
  asset: DocumentAsset;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Import every decodable image in a batch, dropping non-images and any that
 * fail to read/decode. The shared front end for both placing images as scene
 * nodes and importing them as bare assets.
 */
export async function importImageFiles(files: File[]): Promise<ImportedImage[]> {
  const results = await Promise.all(files.filter(isImageFile).map(importImageFile));
  return results.filter((img): img is ImportedImage => img !== null);
}

/** Read a Blob (or File) into a base64 data URL. Resolves null on read error. */
export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Read a file into a data-URL asset and decode it once to learn its natural
 * size (the decode also pre-warms the render cache). Resolves null for files
 * that fail to read or decode.
 */
export async function importImageFile(file: File): Promise<ImportedImage | null> {
  const data = await blobToDataUrl(file);
  if (!data) return null;
  const asset: DocumentAsset = {
    id: makeId("asset"),
    kind: "image",
    mimeType: file.type,
    name: file.name,
    source: { type: "data", data },
  };
  const img = await loadAssetImage(asset);
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  return { asset, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
}
