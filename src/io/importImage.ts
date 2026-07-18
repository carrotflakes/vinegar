// Turning picked/dropped image files into document assets.

import { loadAssetImage } from "../imageCache";
import { makeId, type DocumentAsset } from "../model/types";

/** Image MIME types the browser can decode and we accept for placement. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp";

export function isImageFile(file: File): boolean {
  return IMAGE_ACCEPT.split(",").includes(file.type);
}

/**
 * Pull decodable image files out of a clipboard (or drag) payload. Pasted
 * screenshots arrive as a `file` item with a synthetic name; `placeImageFiles`
 * supplies a fallback name for those.
 */
export function imageFilesFromData(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.items]
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter((f): f is File => f != null && isImageFile(f));
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
 * Read a file into a data-URL asset and decode it once to learn its natural
 * size (the decode also pre-warms the render cache). Resolves null for files
 * that fail to read or decode.
 */
export async function importImageFile(file: File): Promise<ImportedImage | null> {
  const data = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
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
