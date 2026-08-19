/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(
  text: string,
  filename: string,
  mime = "text/plain"
): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export interface PickedTextFile {
  name: string;
  text: string;
}

/**
 * Open a native file picker and resolve with the selected file. The fallback
 * for browsers without the File System Access API, which is why callers get
 * the `File` itself: a document may be binary, and only its bytes will do.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Open a native file picker and resolve with the selected file and its text. */
export async function pickTextFileWithName(
  accept: string
): Promise<PickedTextFile | null> {
  const file = await pickFile(accept);
  if (!file) return null;
  try {
    return { name: file.name, text: await file.text() };
  } catch {
    return null;
  }
}
