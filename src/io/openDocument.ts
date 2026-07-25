// Opening a .vinegar.json document from a dropped or picked file, replacing
// the current drawing. Shared by the File ▸ Open command and canvas file drops.

import { hasUnsavedChanges, useEditor } from "../store/editorStore";
import { useDocumentFile } from "../store/documentFileStore";
import { notify } from "../store/toastStore";
import { type FileHandle } from "./fileSystem";
import { parseDocument } from "./serialize";

/** A saved-document file (our own JSON format), as opposed to an image drop. */
export function isDocumentFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".json") || file.type === "application/json";
}

/** Prompt before throwing away unsaved work; returns whether to proceed. */
function confirmDiscardCurrent(): boolean {
  if (!hasUnsavedChanges(useEditor.getState())) return true;
  return window.confirm("Discard unsaved changes to the current drawing?");
}

/**
 * Replace the current document with one parsed from `text`. Reports parse
 * errors the same way as the File ▸ Open command. Assumes the caller has
 * already confirmed discarding unsaved changes.
 *
 * `handle` is the file the text came from, where the browser gave us one:
 * attaching it lets File ▸ Save overwrite that file. Without one the document
 * starts detached, so the next Save asks for a destination.
 */
export function loadDocumentText(text: string, handle?: FileHandle | null): void {
  try {
    useEditor.getState().loadDocument(parseDocument(text));
  } catch (err) {
    notify.error(
      "Could not open file:\n" + (err instanceof Error ? err.message : String(err))
    );
    return;
  }
  const file = useDocumentFile.getState();
  if (handle) file.attach(handle);
  else file.clear();
}

/**
 * Open a dropped document file: confirm discarding unsaved changes, read the
 * file, then load it. No-op for anything that isn't a document file.
 * `pendingHandle` is the drop's file handle where the browser offers one; the
 * caller starts that lookup while the drop event is still live, so the opened
 * document can be overwrite-saved just like one picked through File ▸ Open.
 */
export async function openDocumentFile(
  file: File,
  pendingHandle: Promise<FileHandle | null> | null = null
): Promise<void> {
  if (!confirmDiscardCurrent()) return;
  let text: string;
  try {
    text = await file.text();
  } catch {
    notify.error("Could not read file: " + file.name);
    return;
  }
  loadDocumentText(text, await pendingHandle);
}
