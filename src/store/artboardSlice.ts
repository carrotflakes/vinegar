// Artboards: rectangular export/layout regions on the plane. They live in the
// document (so edits are undoable via `transact`) but own no scene content.

import {
  artboardBounds,
  makeArtboard,
  makeId,
  type Artboard,
  type Document,
} from "../model/types";
import { unionNodeWorldBounds } from "@/model/geometry/bounds";
import {
  applyWorldTransformToNode,
  translation as translationMatrix,
} from "@/model/geometry/matrix";
import { appendToScope, copyPayload, remapPayload } from "./docOps";
import type { ArtboardActions, StoreCtx } from "./state";

/** Default size for a board created without a drag (e.g. the Add command). */
const DEFAULT_SIZE = { width: 1080, height: 1080 };

/** Gap between a board and its duplicate when placed beside the original. */
const DUPLICATE_GAP = 40;

/**
 * The scene roots a board "contains": top-level nodes whose world bounds
 * overlap the board at all (not just those fully inside). Boards own no
 * children, so this is purely geometric — it's what travels when a board is
 * moved or duplicated. Locked nodes are included: lock here means "not directly
 * selectable/editable", not "pinned in world", so locked artwork rides along
 * with its board like a locked child follows its parent frame. */
export function artboardContentIds(doc: Document, board: Artboard): string[] {
  const b = artboardBounds(board);
  return doc.rootIds.filter((id) => {
    const wb = unionNodeWorldBounds(doc, [id]);
    return (
      wb != null &&
      wb.x < b.x + b.width &&
      wb.x + wb.width > b.x &&
      wb.y < b.y + b.height &&
      wb.y + wb.height > b.y
    );
  });
}

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
    duplicateArtboard: (id) => {
      const { doc } = get();
      const board = doc.artboards.find((ab) => ab.id === id);
      if (!board) return;
      const dx = board.width + DUPLICATE_GAP;
      const dy = 0;
      const copy: Artboard = {
        ...board,
        id: makeId("artboard"),
        name: `${board.name} copy`,
        x: board.x + dx,
        y: board.y + dy,
      };
      // Clone the artwork the board contains, offset by the same delta so it
      // stays aligned with the board copy.
      let next = doc;
      const contentIds = artboardContentIds(doc, board);
      if (contentIds.length) {
        const dup = remapPayload(copyPayload(doc, contentIds)!);
        next = { ...next, nodes: { ...next.nodes, ...dup.nodes } };
        const moved = { ...next.nodes };
        for (const rid of dup.rootIds) {
          moved[rid] = applyWorldTransformToNode(
            next,
            moved[rid],
            translationMatrix(dx, dy)
          );
        }
        next = appendToScope({ ...next, nodes: moved }, null, dup.rootIds);
      }
      // Insert the board copy right after the source (= export order).
      const index = next.artboards.findIndex((ab) => ab.id === id);
      const artboards = [...next.artboards];
      artboards.splice(index + 1, 0, copy);
      transact({ ...next, artboards }, { label: "Duplicate artboard" });
      set({ selectedArtboardId: copy.id, selection: [] });
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
