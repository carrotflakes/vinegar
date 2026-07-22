// Global colours ("document colours"): discovery and baking of `swatch` paint
// references across the scene. The concrete colour lives once in doc.swatches;
// these helpers find and, when detaching/deleting, resolve every reference to a
// concrete paint in place. See docs/global-colors.md.

import { isSwatchRef, resolvePaintRef } from "./paint";
import type { Document, SceneNode, Shape } from "./types";
import { isShape } from "./scene";

/** The two paint slots every shape carries. */
export type PaintTarget = "fill" | "stroke";

/** Whether a node's `target` paint references swatch `id`. */
function refsSwatch(node: SceneNode, target: PaintTarget, id: string): boolean {
  if (!isShape(node)) return false;
  const paint = node[target];
  return isSwatchRef(paint) && paint.swatchId === id;
}

/** Count fill/stroke references to a single swatch across all nodes. */
export function swatchUsageCount(doc: Document, id: string): number {
  let n = 0;
  for (const node of Object.values(doc.nodes)) {
    if (refsSwatch(node, "fill", id)) n++;
    if (refsSwatch(node, "stroke", id)) n++;
  }
  return n;
}

/** Fill/stroke reference counts for every swatch, in one scan (panel display). */
export function swatchUsageCounts(doc: Document): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (paint: Shape["fill"]) => {
    if (isSwatchRef(paint)) counts.set(paint.swatchId, (counts.get(paint.swatchId) ?? 0) + 1);
  };
  for (const node of Object.values(doc.nodes)) {
    if (!isShape(node)) continue;
    bump(node.fill);
    bump(node.stroke);
  }
  return counts;
}

/**
 * Return a nodes map with every `swatch` reference (optionally limited to one
 * swatch id, and/or a set of node ids and target) baked to its concrete paint.
 * A dangling reference resolves to `null` (no paint). Returns the same map when
 * nothing changed so callers can skip a no-op transaction.
 */
export function bakeSwatchRefs(
  doc: Document,
  opts: { swatchId?: string; nodeIds?: Iterable<string>; target?: PaintTarget } = {}
): Record<string, SceneNode> {
  const ids = opts.nodeIds ? [...opts.nodeIds] : Object.keys(doc.nodes);
  const targets: PaintTarget[] = opts.target ? [opts.target] : ["fill", "stroke"];
  let nodes = doc.nodes;
  let changed = false;
  for (const nodeId of ids) {
    const node = doc.nodes[nodeId];
    if (!isShape(node)) continue;
    let next = node;
    for (const target of targets) {
      const paint = next[target];
      if (!isSwatchRef(paint)) continue;
      if (opts.swatchId && paint.swatchId !== opts.swatchId) continue;
      next = { ...next, [target]: resolvePaintRef(paint, doc.swatches) } as Shape;
    }
    if (next !== node) {
      if (!changed) {
        nodes = { ...doc.nodes };
        changed = true;
      }
      nodes[nodeId] = next;
    }
  }
  return nodes;
}
