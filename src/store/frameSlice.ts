// Frames: export/layout container nodes on the plane. Frames are ordinary scene
// nodes, so selection, rename, delete, duplicate and move all reuse the normal
// node actions; only creation and export-order reordering are frame-specific.

import { makeFrame, type Document } from "../model/types";
import { framesInPaintOrder } from "../model/scene";
import { appendToScope } from "./docOps";
import { clearTransient, type FrameActions, type StoreCtx } from "./state";

/** Default size for a frame created without a drag (e.g. the Add command). */
const DEFAULT_SIZE = { width: 1080, height: 1080 };

/** Reorder the top-level frames so `id` lands at frame-index `toIndex`, leaving
 *  loose (non-frame) roots in place. Returns the same doc when nothing moves. */
export function reorderFrameInRootIds(
  doc: Document,
  id: string,
  toIndex: number
): Document {
  const frameIds = framesInPaintOrder(doc).map((frame) => frame.id);
  const from = frameIds.indexOf(id);
  if (from < 0) return doc;
  const reordered = [...frameIds];
  const [moved] = reordered.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, reordered.length));
  if (clamped === from) return doc;
  reordered.splice(clamped, 0, moved);
  // Rebuild rootIds: non-frame roots keep their slots; frame slots are filled
  // from the reordered frame order.
  let cursor = 0;
  const rootIds = doc.rootIds.map((rootId) =>
    doc.nodes[rootId]?.type === "frame" ? reordered[cursor++] : rootId
  );
  return { ...doc, rootIds };
}

export function createFrameActions({ set, get, transact }: StoreCtx): FrameActions {
  return {
    addFrame: (at) => {
      const { doc } = get();
      const w = DEFAULT_SIZE.width;
      const h = DEFAULT_SIZE.height;
      const x = (at?.x ?? 0) - w / 2;
      const y = (at?.y ?? 0) - h / 2;
      const frame = makeFrame(x, y, w, h, `Frame ${framesInPaintOrder(doc).length + 1}`);
      const next = appendToScope(
        { ...doc, nodes: { ...doc.nodes, [frame.id]: frame } },
        null,
        [frame.id]
      );
      transact(next, { label: "Add frame" });
      set({ selection: [frame.id], ...clearTransient });
    },
    updateFrame: (id, patch) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (node?.type !== "frame") return;
      const t = node.transform;
      const next = {
        ...node,
        transform: [t[0], t[1], t[2], t[3], patch.x ?? t[4], patch.y ?? t[5]] as typeof t,
        width: patch.width !== undefined ? Math.max(1, patch.width) : node.width,
        height: patch.height !== undefined ? Math.max(1, patch.height) : node.height,
        background: patch.background !== undefined ? patch.background : node.background,
      };
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: next } },
        {
          label: "Edit frame",
          coalesceKey: `frame:${id}:${Object.keys(patch).sort().join(",")}`,
        }
      );
    },
    reorderFrame: (id, toIndex) => {
      const next = reorderFrameInRootIds(get().doc, id, toIndex);
      if (next === get().doc) return;
      transact(next, {
        label: "Reorder frame",
        coalesceKey: `frame:${id}:reorder`,
      });
    },
  };
}
