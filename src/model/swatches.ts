// Global colours ("document colours"): discovery and baking of `swatch` paint
// references across the scene. The concrete colour lives once in doc.swatches;
// these helpers find and, when detaching/deleting, resolve every reference to a
// concrete paint in place. See docs/global-colors.md.

import { isSwatchRef, resolvePaintRef, type PaintTarget } from "./paint";
import type { Document, SceneNode } from "./types";
import { mapNodePaints, nodePaints } from "./scene";

export type { PaintTarget } from "./paint";

/** Count references to a single swatch across every paint in the document. */
export function swatchUsageCount(doc: Document, id: string): number {
  return swatchUsageCounts(doc).get(id) ?? 0;
}

/**
 * Reference counts for every swatch, in one scan (panel display). Counts every
 * paint a node carries — a fill/stroke effect's paint included, so deleting the
 * swatch cannot silently blank one out.
 */
export function swatchUsageCounts(doc: Document): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of Object.values(doc.nodes)) {
    for (const paint of nodePaints(node)) {
      if (isSwatchRef(paint)) {
        counts.set(paint.swatchId, (counts.get(paint.swatchId) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Return a nodes map with every `swatch` reference (optionally limited to one
 * swatch id, and/or a set of node ids and target) baked to its concrete paint.
 * A dangling reference resolves to `null` (no paint). Returns the same map when
 * nothing changed so callers can skip a no-op transaction.
 *
 * `target` addresses a shape's own fill/stroke, so unlinking one leaves effect
 * paints alone; an untargeted bake (deleting a swatch) covers everything.
 */
export function bakeSwatchRefs(
  doc: Document,
  opts: { swatchId?: string; nodeIds?: Iterable<string>; target?: PaintTarget } = {}
): Record<string, SceneNode> {
  const ids = opts.nodeIds ? [...opts.nodeIds] : Object.keys(doc.nodes);
  let nodes = doc.nodes;
  for (const nodeId of ids) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const next = mapNodePaints(node, (paint, slot) => {
      if (!isSwatchRef(paint)) return paint;
      if (opts.swatchId && paint.swatchId !== opts.swatchId) return paint;
      if (opts.target && slot !== opts.target) return paint;
      return resolvePaintRef(paint, doc.swatches);
    });
    if (next === node) continue;
    if (nodes === doc.nodes) nodes = { ...doc.nodes };
    nodes[nodeId] = next;
  }
  return nodes;
}
