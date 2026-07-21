// Artboards: rectangular export/layout regions on the plane. They live in the
// document (so edits are undoable via `transact`) but own no scene content.

import { makeArtboard, type Artboard, type Document } from "../model/types";
import type { ArtboardActions, StoreCtx } from "./state";

/** Default size for a board created without a drag (e.g. the Add command). */
const DEFAULT_SIZE = { width: 1080, height: 1080 };

/** Replace one artboard by id with a patched copy; returns the same doc if absent. */
export function patchArtboard(
  doc: Document,
  id: string,
  patch: Partial<Omit<Artboard, "id">>
): Document {
  let changed = false;
  const artboards = doc.artboards.map((ab) => {
    if (ab.id !== id) return ab;
    changed = true;
    return {
      ...ab,
      ...patch,
      ...(patch.width !== undefined
        ? { width: Math.max(1, patch.width) }
        : {}),
      ...(patch.height !== undefined
        ? { height: Math.max(1, patch.height) }
        : {}),
    };
  });
  return changed ? { ...doc, artboards } : doc;
}

export function createArtboardActions({ set, get, transact }: StoreCtx): ArtboardActions {
  return {
    addArtboard: (at) => {
      const { doc } = get();
      const w = DEFAULT_SIZE.width;
      const h = DEFAULT_SIZE.height;
      const x = (at?.x ?? 0) - w / 2;
      const y = (at?.y ?? 0) - h / 2;
      const board = makeArtboard(x, y, w, h, `Artboard ${doc.artboards.length + 1}`);
      transact(
        { ...doc, artboards: [...doc.artboards, board] },
        { label: "Add artboard" }
      );
      set({ selectedArtboardId: board.id, selection: [] });
    },
    updateArtboard: (id, patch) => {
      const next = patchArtboard(get().doc, id, patch);
      if (next === get().doc) return;
      transact(next, {
        label: "Edit artboard",
        coalesceKey: `artboard:${id}:${Object.keys(patch).sort().join(",")}`,
      });
    },
    deleteArtboard: (id) => {
      const { doc } = get();
      if (!doc.artboards.some((ab) => ab.id === id)) return;
      transact(
        { ...doc, artboards: doc.artboards.filter((ab) => ab.id !== id) },
        { label: "Delete artboard" }
      );
      if (get().selectedArtboardId === id) set({ selectedArtboardId: null });
    },
    selectArtboard: (id) => {
      set({ selectedArtboardId: id, ...(id ? { selection: [] } : {}) });
    },
    reorderArtboard: (id, toIndex) => {
      const { doc } = get();
      const from = doc.artboards.findIndex((ab) => ab.id === id);
      if (from < 0) return;
      const artboards = [...doc.artboards];
      const [moved] = artboards.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, artboards.length));
      if (clamped === from) return;
      artboards.splice(clamped, 0, moved);
      transact(
        { ...doc, artboards },
        { label: "Reorder artboard", coalesceKey: `artboard:${id}:reorder` }
      );
    },
  };
}
