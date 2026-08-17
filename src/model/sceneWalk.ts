// ===========================================================================
// One answer to "what is inside this container, and what confines it".
//
// Several readers walk the scene tree recursively in paint order — the canvas
// renderer, the two render-bounds passes, the SVG exporter and the world-bounds
// pass. What they *do* at each node differs completely; how they descend does
// not. Each of them used to re-derive the descent itself, and they drifted:
// the SVG exporter fell through on frames and silently dropped every framed
// node in the document.
//
// This module owns the descent. A reader asks what a container expands to,
// then does its own work with the answer.
//
// Hit-testing and export bounds deliberately do *not* use this: they work from
// a flattened leaf list (`symbolLeafIds`, `scopeLeafIds`) and walk *upward*
// through ancestors, which is a different algorithm rather than a copy of this
// one.
// ===========================================================================

import { clippingContentIds, clippingMask, type ClippingMaskShape } from "./clippingMask";
import { isFrame, isGroup, isInstance } from "./scene";
import type { Document, FrameNode, SceneNode } from "./types";

/**
 * What a container node expands to. `childIds` is always the list to descend
 * into, in back-to-front paint order, so a reader that only needs to recurse
 * can ignore the variant entirely.
 */
export type ContainerContents =
  | {
      kind: "group";
      childIds: string[];
      /**
       * The mask shape when this is a clipping group, else null. It is **not**
       * in `childIds`: a mask confines its siblings instead of being painted
       * with them.
       */
      mask: ClippingMaskShape | null;
    }
  | {
      kind: "frame";
      childIds: string[];
      /** Confines `childIds` to its content box when `clipsContent` is set. */
      frame: FrameNode;
    }
  | {
      kind: "instance";
      childIds: string[];
      /** Push onto the reader's active-symbol set while descending. */
      symbolId: string;
    };

/**
 * What `node` expands to, or null when there is nothing to descend into: a
 * leaf, an instance of a missing symbol, or an instance that would re-enter a
 * symbol already being expanded.
 *
 * `activeSymbols` is the caller's symbol expansion stack. Passing it is what
 * stops a cyclic symbol from recursing forever, so a reader that descends into
 * instances must maintain one — add `symbolId` before descending and remove it
 * after. A reader that cannot reach an instance may omit it.
 */
export function containerContents(
  doc: Document,
  node: SceneNode,
  activeSymbols?: ReadonlySet<string>
): ContainerContents | null {
  if (isGroup(node)) {
    const mask = clippingMask(doc, node);
    return {
      kind: "group",
      // Without a mask this is just `node.childIds`; the helper stays in the
      // path so the mask never leaks into the painted list.
      childIds: mask ? clippingContentIds(doc, node) : node.childIds,
      mask,
    };
  }
  if (isFrame(node)) {
    return { kind: "frame", childIds: node.childIds, frame: node };
  }
  if (isInstance(node)) {
    if (activeSymbols?.has(node.symbolId)) return null;
    const definition = doc.symbols[node.symbolId];
    if (!definition) return null;
    return {
      kind: "instance",
      childIds: [definition.rootNodeId],
      symbolId: node.symbolId,
    };
  }
  return null;
}

/**
 * Just the ids to descend into — for a reader that treats every container the
 * same and needs no confinement or symbol bookkeeping.
 */
export function containerChildIds(
  doc: Document,
  node: SceneNode,
  activeSymbols?: ReadonlySet<string>
): string[] {
  return containerContents(doc, node, activeSymbols)?.childIds ?? [];
}
