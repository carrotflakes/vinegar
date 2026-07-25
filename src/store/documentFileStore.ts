import { create } from "zustand";
import type { FileHandle } from "../io/fileSystem";

// Which file on disk the current document belongs to. Deliberately outside the
// editor store: this is session state, not document content — it is never
// serialized, never undoable, and is dropped by New / Open like a fresh tab.
//
// A null handle means "no file to overwrite" (never saved, saved through the
// download fallback, or opened from a drop the browser gave us no handle for);
// File ▸ Save then behaves like Save As.

interface DocumentFileState {
  handle: FileHandle | null;
  /** The file's name on disk, for the title tooltip. Null when there is none. */
  fileName: string | null;
  attach: (handle: FileHandle) => void;
  clear: () => void;
}

export const useDocumentFile = create<DocumentFileState>((set) => ({
  handle: null,
  fileName: null,
  attach: (handle) => set({ handle, fileName: handle.name }),
  clear: () => set({ handle: null, fileName: null }),
}));
