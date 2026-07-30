// Frames: export/layout container nodes on the plane. Frames are ordinary scene
// nodes, so selection, rename, delete, duplicate, reorder and move all reuse the
// normal node actions (Layers panel included); only creation and content-box
// edits are frame-specific.

import { makeFrame } from "../model/types";
import { framesInPaintOrder } from "../model/scene";
import { appendToScope } from "./docOps";
import { clearTransient, currentFocusRoot, type FrameActions, type StoreCtx } from "./state";

/** Default size for a frame created without a drag (e.g. the Add command). */
const DEFAULT_SIZE = { width: 1080, height: 1080 };

export function createFrameActions({ set, get, transact }: StoreCtx): FrameActions {
  return {
    addFrame: (at) => {
      const s = get(); const doc = s.doc;
      // Frames only exist at the top level, so one added from inside a focus
      // scope would be invisible in the view that created it.
      if (currentFocusRoot(s) !== null) return;
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
      // A new frame is what the user is now working in, so the rulers count
      // from it (see docs/rulers-and-guides.md).
      set({ selection: [frame.id], activeFrameId: frame.id, ...clearTransient });
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
        clipsContent: patch.clipsContent ?? node.clipsContent,
      };
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: next } },
        {
          label: "Edit frame",
          coalesceKey: `frame:${id}:${Object.keys(patch).sort().join(",")}`,
        }
      );
    },
  };
}
