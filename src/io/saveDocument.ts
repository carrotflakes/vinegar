// Saving the current document to a file, and the identity that goes with it.
//
// Two paths, picked by browser capability:
//   * File System Access (Chromium) — Save overwrites the handle the document
//     was opened from / last saved to, Save As picks a new one.
//   * Everywhere else — both fall back to a plain download named after the
//     document, so Downloads collects copies rather than being overwritten.
//
// The document name (`doc.metadata.name`, edited in the app bar) is the single
// source of truth for suggested filenames; Save As adopts the name the user
// types into the picker so the two never drift apart.

import { downloadText } from "./download";
import { fileSlug } from "./exportFilenames";
import {
  ensureWritePermission,
  pickDocumentToSave,
  supportsFileSystem,
  writeTextToHandle,
  type FileHandle,
} from "./fileSystem";
import { serializeDocument } from "./serialize";
import { useDocumentFile } from "../store/documentFileStore";
import { useEditor } from "../store/editorStore";
import { notify } from "../store/toastStore";
import type { Document } from "../model/types";

const DOCUMENT_EXTENSION = ".vinegar.json";

/** Suggested filename for a document, e.g. `my-sketch.vinegar.json`. */
export function documentFileName(doc: Document): string {
  return fileSlug(doc.metadata.name, "untitled") + DOCUMENT_EXTENSION;
}

/**
 * Recover a display name from a filename: `my-sketch.vinegar.json` →
 * `my-sketch`. Used to adopt whatever the user typed into the save picker.
 */
export function documentNameFromFileName(fileName: string): string {
  return fileName.replace(/\.json$/i, "").replace(/\.vinegar$/i, "");
}

/**
 * Save to the attached file when there is one, otherwise fall through to
 * Save As. Returns whether the document was written (false = cancelled/failed).
 */
export async function saveDocument(): Promise<boolean> {
  const { handle } = useDocumentFile.getState();
  if (!handle || !supportsFileSystem()) return saveDocumentAs();

  try {
    if (!(await ensureWritePermission(handle))) {
      // Permission was revoked or refused; let the user re-pick a destination
      // rather than silently doing nothing.
      return saveDocumentAs();
    }
    await writeTextToHandle(handle, serializeDocument(useEditor.getState().doc));
  } catch (err) {
    notify.error(
      "Could not save file:\n" + (err instanceof Error ? err.message : String(err))
    );
    return false;
  }
  useEditor.getState().markSaved();
  notify.success(`Saved ${handle.name}`);
  return true;
}

/** Always ask where to save. Falls back to a download where FSA is missing. */
export async function saveDocumentAs(): Promise<boolean> {
  const state = useEditor.getState();
  const suggested = documentFileName(state.doc);

  if (!supportsFileSystem()) {
    downloadText(serializeDocument(state.doc), suggested, "application/json");
    state.markSaved();
    return true;
  }

  let handle: FileHandle | null;
  try {
    handle = await pickDocumentToSave(suggested);
  } catch (err) {
    notify.error(
      "Could not save file:\n" + (err instanceof Error ? err.message : String(err))
    );
    return false;
  }
  if (!handle) return false; // cancelled

  try {
    // Adopt the typed name, but only when the user actually changed it: the
    // suggestion is a slug of the current name, so accepting it unchanged
    // would silently rewrite "My Sketch" into "my-sketch".
    if (handle.name !== suggested) {
      useEditor.getState().setDocumentName(documentNameFromFileName(handle.name));
    }
    await writeTextToHandle(handle, serializeDocument(useEditor.getState().doc));
  } catch (err) {
    notify.error(
      "Could not save file:\n" + (err instanceof Error ? err.message : String(err))
    );
    return false;
  }
  useDocumentFile.getState().attach(handle);
  useEditor.getState().markSaved();
  notify.success(`Saved ${handle.name}`);
  return true;
}
