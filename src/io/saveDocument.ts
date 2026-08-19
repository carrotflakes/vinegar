// Saving the current document to a file, and the identity that goes with it.
//
// A document is written either as the compact binary `.vinegar` container
// (the default, see `io/container.ts`) or as readable `.vinegar.json` text.
// The filename decides which, so a file keeps the form it was saved in.
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

import { encodeDocument } from "./container";
import { downloadBlob } from "./download";
import { fileSlug } from "./exportFilenames";
import {
  ensureWritePermission,
  pickDocumentToSave,
  supportsFileSystem,
  writeBlobToHandle,
  type FileHandle,
} from "./fileSystem";
import { serializeDocument } from "./serialize";
import { useDocumentFile } from "../store/documentFileStore";
import { useEditor } from "../store/editorStore";
import { notify } from "../store/toastStore";
import type { Document } from "../model/types";

/**
 * The two forms a document is written in. `binary` is the compact `.vinegar`
 * container (deflated body, raw asset bytes) and the default; `json` is the
 * same file as readable `.vinegar.json` text. Which one a save uses follows
 * the filename, so a document opened from either form saves back into it.
 */
export type DocumentFormat = "binary" | "json";

const EXTENSIONS: Record<DocumentFormat, string> = {
  binary: ".vinegar",
  json: ".vinegar.json",
};

/** The form a file of this name holds: `.json` is text, anything else binary. */
export function documentFormatOf(fileName: string): DocumentFormat {
  return /\.json$/i.test(fileName) ? "json" : "binary";
}

/** Suggested filename for a document, e.g. `my-sketch.vinegar`. */
export function documentFileName(
  doc: Document,
  format: DocumentFormat = "binary"
): string {
  return fileSlug(doc.metadata.name, "untitled") + EXTENSIONS[format];
}

/** The bytes to write for `doc` in the form `fileName` asks for. */
async function documentBlob(doc: Document, fileName: string): Promise<Blob> {
  if (documentFormatOf(fileName) === "json") {
    return new Blob([serializeDocument(doc)], {
      type: "application/json;charset=utf-8",
    });
  }
  return new Blob([(await encodeDocument(doc)) as BlobPart], {
    type: "application/octet-stream",
  });
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
    await writeBlobToHandle(
      handle,
      await documentBlob(useEditor.getState().doc, handle.name)
    );
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
    downloadBlob(await documentBlob(state.doc, suggested), suggested);
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
    await writeBlobToHandle(
      handle,
      await documentBlob(useEditor.getState().doc, handle.name)
    );
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
