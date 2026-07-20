// Opening a .vinegar.json document from a dropped or picked file, replacing
// the current drawing. Shared by the File ▸ Open command and canvas file drops.

import { hasUnsavedChanges, useEditor } from "../store/editorStore";
import { notify } from "../store/toastStore";
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
 */
export function loadDocumentText(text: string): void {
  try {
    useEditor.getState().loadDocument(parseDocument(text));
  } catch (err) {
    notify.error(
      "Could not open file:\n" + (err instanceof Error ? err.message : String(err))
    );
  }
}

/**
 * Open a dropped document file: confirm discarding unsaved changes, read the
 * file, then load it. No-op for anything that isn't a document file.
 */
export async function openDocumentFile(file: File): Promise<void> {
  if (!confirmDiscardCurrent()) return;
  let text: string;
  try {
    text = await file.text();
  } catch {
    notify.error("Could not read file: " + file.name);
    return;
  }
  loadDocumentText(text);
}
