// Opening a saved document from a dropped or picked file, replacing the
// current drawing. Shared by the File ▸ Open command and canvas file drops.
//
// Two on-disk forms are accepted, told apart by content rather than by name:
// the compact `.vinegar` container (`io/container.ts`) and plain
// `.vinegar.json` text. Both end up in the same validator.

import { hasUnsavedChanges, useEditor } from "../store/editorStore";
import { useDocumentFile } from "../store/documentFileStore";
import { notify } from "../store/toastStore";
import { parseDocumentBytes } from "./container";
import { type FileHandle } from "./fileSystem";
import { parseDocument } from "./serialize";
import type { Document } from "../model/types";

/** A saved-document file (either of our own forms), as opposed to an image drop. */
export function isDocumentFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".vinegar") ||
    name.endsWith(".json") ||
    file.type === "application/json"
  );
}

/** Prompt before throwing away unsaved work; returns whether to proceed. */
function confirmDiscardCurrent(): boolean {
  if (!hasUnsavedChanges(useEditor.getState())) return true;
  return window.confirm("Discard unsaved changes to the current drawing?");
}

/** Adopt `doc` as the current document, attaching `handle` when there is one. */
function adopt(doc: Document, handle?: FileHandle | null): void {
  useEditor.getState().loadDocument(doc);
  const file = useDocumentFile.getState();
  if (handle) file.attach(handle);
  else file.clear();
}

/**
 * Replace the current document with one parsed from `bytes`. Reports parse
 * errors the same way as the File ▸ Open command. Assumes the caller has
 * already confirmed discarding unsaved changes.
 *
 * `handle` is the file the bytes came from, where the browser gave us one:
 * attaching it lets File ▸ Save overwrite that file, in the form it already
 * has. Without one the document starts detached, so the next Save asks for a
 * destination.
 */
export async function loadDocumentBytes(
  bytes: Uint8Array,
  handle?: FileHandle | null
): Promise<void> {
  let doc: Document;
  try {
    doc = await parseDocumentBytes(bytes);
  } catch (err) {
    notify.error(
      "Could not open file:\n" + (err instanceof Error ? err.message : String(err))
    );
    return;
  }
  adopt(doc, handle);
}

/** The JSON-text path, for callers that already hold the text. */
export function loadDocumentText(text: string, handle?: FileHandle | null): void {
  let doc: Document;
  try {
    doc = parseDocument(text);
  } catch (err) {
    notify.error(
      "Could not open file:\n" + (err instanceof Error ? err.message : String(err))
    );
    return;
  }
  adopt(doc, handle);
}

/** Read `file` and load it, whichever form it is in. */
export async function loadDocumentFile(
  file: File,
  handle?: FileHandle | null
): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    notify.error("Could not read file: " + file.name);
    return;
  }
  await loadDocumentBytes(bytes, handle);
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
  await loadDocumentFile(file, await pendingHandle);
}
