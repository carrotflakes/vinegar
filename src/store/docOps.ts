// ===========================================================================
// Pure document operations shared by the editor store slices. Nothing here
// reads or writes store state; every function maps a Document to a Document.
// ===========================================================================

import {
  IDENTITY,
  invertMatrix,
  isIdentity,
  multiply,
  nodeWorldMatrix,
  translation as translationMatrix,
} from "@/model/geometry/matrix";
import {
  containsBounds,
  intersectBounds,
  nodeWorldBounds,
} from "@/model/geometry/bounds";
import { GENERATORS } from "@/model/generators/generators";
import { referencedParamIds } from "@/model/params";
import {
  childIdsOf,
  descendantNodeIds,
  isCompoundPath,
  isContainer,
  isNodeHidden,
  isNodeLocked,
  parentIdOf,
  referencedAssetIdsOf,
  referencedScriptIds,
  referencedSwatchIds,
  selectionRoots,
  withChildIds,
} from "../model/scene";
import {
  baseNodeDefaults,
  makeId,
  type Bounds,
  type BrushShape,
  type DocParam,
  type Document,
  type DocumentAsset,
  type Group,
  type Matrix,
  type PathShape,
  type SceneNode,
  type ScriptDef,
  type Swatch,
  type SymbolInstance,
} from "../model/types";

export { withChildIds as replaceChildren } from "../model/scene";

/** A detached subtree: the nodes plus the roots that head them. */
export interface NodePayload {
  nodes: Record<string, SceneNode>;
  rootIds: string[];
}

/**
 * A copied selection. Besides the nodes it carries the document-level
 * resources they point at, so a paste into another document keeps generators
 * editable, images visible and global colours linked instead of leaving
 * dangling ids behind.
 */
export interface ClipboardPayload extends NodePayload {
  /** Document scripts the copied nodes' generator links point at. */
  scripts: Record<string, ScriptDef>;
  /** Image assets used by copied image nodes and pattern paints. */
  assets: Record<string, DocumentAsset>;
  /** Global colours referenced by copied fills/strokes. */
  swatches: Record<string, Swatch>;
  /** Document parameters the copied nodes' bindings point at. */
  params: Record<string, DocParam>;
  /** Whether the source document's scripts were trusted when copied. */
  scriptsTrusted: boolean;
}

/**
 * The shapes the node tool edits for a given selection: a single path or brush,
 * or the visible path children of a single compound path. Anything else (a
 * multi-selection, a group, a generator-less non-path leaf) has no anchors to
 * edit and yields nothing.
 */
export function nodeEditTargets(
  doc: Document,
  selection: readonly string[]
): (PathShape | BrushShape)[] {
  if (selection.length !== 1) return [];
  const selected = doc.nodes[selection[0]];
  if (selected?.type === "path" || selected?.type === "brush") return [selected];
  if (selected?.type !== "compoundPath") return [];
  return selected.childIds.flatMap((id) => {
    const child = doc.nodes[id];
    return child?.type === "path" && !child.hidden ? [child] : [];
  });
}

/**
 * Settle a freshly drawn frame into the scene it was drawn over.
 *
 * A frame paints its background over whatever sits behind it, so a frame drawn
 * on top of existing art would hide it. Two moves at creation time keep the
 * scene looking like what the user drew:
 *
 * - top-level nodes that fall *completely* inside the frame become its children
 *   (rebased into frame-local space), so "inside the frame" means the same
 *   thing structurally and visually;
 * - the frame drops behind the backmost visible top-level node it overlaps, so
 *   art that only partly overlaps (and is therefore not absorbed) stays
 *   visible. With no overlap at all the frame keeps its frontmost slot, and
 *   with it the natural export order.
 *
 * Hidden nodes are ignored entirely and locked ones are left where they are —
 * both are outside what a creation drag may claim — though a locked node still
 * counts for the ordering, since it is visible and could be covered.
 * See docs/document-model.md.
 */
export function settleNewFrame(doc: Document, frameId: string): Document {
  const frame = doc.nodes[frameId];
  if (frame?.type !== "frame") return doc;
  const frameBox = nodeWorldBounds(doc, frameId);
  if (!frameBox) return doc;
  const inverse = invertMatrix(nodeWorldMatrix(doc, frameId));
  if (!inverse) return doc;

  // Frames never nest, so other frames neither move nor push this one back.
  const boxes = new Map<string, Bounds>();
  const overlapping = doc.rootIds.filter((id) => {
    const node = doc.nodes[id];
    if (id === frameId || node?.type === "frame" || isNodeHidden(doc, id)) return false;
    const box = nodeWorldBounds(doc, id);
    if (!box || !intersectBounds(box, frameBox)) return false;
    boxes.set(id, box);
    return true;
  });
  const absorbed = overlapping.filter(
    (id) => !isNodeLocked(doc, id) && containsBounds(frameBox, boxes.get(id)!)
  );

  const rest = doc.rootIds.filter((id) => id !== frameId && !absorbed.includes(id));
  const backmost = overlapping[0];
  let index = rest.length;
  if (backmost !== undefined) {
    const kept = rest.indexOf(backmost);
    index =
      kept >= 0
        ? kept
        : // The backmost overlap was absorbed: take the slot it left behind.
          doc.rootIds
            .slice(0, doc.rootIds.indexOf(backmost))
            .filter((id) => rest.includes(id)).length;
  }

  const nodes = { ...doc.nodes };
  for (const id of absorbed) {
    nodes[id] = { ...nodes[id]!, transform: multiply(inverse, nodeWorldMatrix(doc, id)) };
  }
  nodes[frameId] = { ...frame, childIds: [...frame.childIds, ...absorbed] };
  const rootIds = [...rest];
  rootIds.splice(index, 0, frameId);
  return { ...doc, nodes, rootIds };
}

/** Remove the given roots (and their subtrees) from the scene. */
export function removeRoots(doc: Document, roots: string[]): Document {
  const effectiveRoots = new Set(selectionRoots(doc, roots));
  const remove = new Set(
    [...effectiveRoots].flatMap((id) => [id, ...descendantNodeIds(doc, id)])
  );
  // A compound path may not be empty. Removing its final remaining child
  // removes the compound container as well (and may in turn empty an outer
  // compound in malformed/pre-validation data).
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of Object.values(doc.nodes)) {
      if (!isCompoundPath(node) || remove.has(node.id)) continue;
      if (node.childIds.every((id) => remove.has(id))) {
        effectiveRoots.add(node.id);
        remove.add(node.id);
        for (const id of descendantNodeIds(doc, node.id)) remove.add(id);
        changed = true;
      }
    }
  }
  let next = doc;
  const parents = new Set([...effectiveRoots].map((id) => parentIdOf(doc, id)));
  for (const parent of parents) {
    next = withChildIds(next, parent, childIdsOf(next, parent).filter((id) => !remove.has(id)));
  }
  const nodes = { ...next.nodes };
  for (const id of remove) delete nodes[id];
  return { ...next, nodes };
}

/**
 * Swap one node for the node(s) an operation produced, in its own slot.
 *
 * `added` is every node the result needs (the replacements themselves plus any
 * nodes they contain); `slotIds` are the ones that take the source's place in
 * the parent's child list, so paint order survives the swap. The source and its
 * subtree are dropped unless `added` re-states them — which is how an op that
 * wraps the original in a new container keeps it alive.
 */
export function replaceNodeWith(
  doc: Document,
  id: string,
  added: SceneNode[],
  slotIds: string[]
): Document {
  const nodes = { ...doc.nodes };
  const kept = new Set(added.map((node) => node.id));
  if (!kept.has(id)) {
    for (const gone of [id, ...descendantNodeIds(doc, id)]) delete nodes[gone];
  }
  for (const node of added) nodes[node.id] = node;
  const parent = parentIdOf(doc, id);
  const order = [...childIdsOf(doc, parent)];
  order.splice(order.indexOf(id), 1, ...slotIds);
  return withChildIds({ ...doc, nodes }, parent, order);
}

/**
 * The child list after several consumed siblings collapse into one result
 * node, which takes the frontmost consumed slot so the result keeps the paint
 * order its inputs had.
 */
export function collapseSiblings(
  siblings: string[],
  consumed: Set<string>,
  ordered: string[],
  resultId: string
): string[] {
  const order = siblings.filter((id) => !consumed.has(id));
  const at = siblings
    .slice(0, siblings.indexOf(ordered[0]))
    .filter((id) => !consumed.has(id)).length;
  order.splice(at, 0, resultId);
  return order;
}

/** Snapshot the selection as a payload whose roots carry world transforms. */
export function copyPayload(
  doc: Document,
  selection: string[],
  scriptsTrusted = true
): ClipboardPayload | null {
  const roots = selectionRoots(doc, selection);
  if (!roots.length) return null;
  const ids = new Set(roots.flatMap((id) => [id, ...descendantNodeIds(doc, id)]));
  const nodes: Record<string, SceneNode> = {};
  for (const id of ids) nodes[id] = structuredClone(doc.nodes[id]);
  for (const id of roots) nodes[id] = { ...nodes[id], transform: nodeWorldMatrix(doc, id) };
  const all = Object.values(nodes);
  const pick = <T>(ids: Iterable<string>, from: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const id of ids) if (from[id]) out[id] = structuredClone(from[id]);
    return out;
  };
  return {
    nodes,
    rootIds: roots,
    scripts: pick(referencedScriptIds(all), doc.scripts),
    assets: pick(referencedAssetIdsOf(all), doc.assets),
    swatches: pick(referencedSwatchIds(all), doc.swatches),
    params: pick(referencedParamIds(all), doc.params),
    scriptsTrusted,
  };
}

/**
 * Copy `roots` in place: every copy keeps its original's transform and lands
 * directly after it among its siblings, so paint order stays interleaved.
 * Shared by Duplicate, which then nudges the copies, and the select tool's
 * Alt-drag, which drags them away instead.
 */
export function duplicateRoots(
  doc: Document,
  roots: string[]
): { doc: Document; newIds: string[] } {
  const effective = selectionRoots(doc, roots);
  const byParent = new Map<string | null, string[]>();
  for (const id of effective) {
    const parent = parentIdOf(doc, id);
    byParent.set(parent, [...(byParent.get(parent) ?? []), id]);
  }
  let next = doc;
  const newIds: string[] = [];
  for (const [parent, selected] of byParent) {
    const raw = copyPayload(doc, selected)!;
    // copyPayload lifts the roots to world transforms for pasting elsewhere;
    // these copies stay siblings of their originals, so put the local ones back.
    for (const id of raw.rootIds) {
      raw.nodes[id] = {
        ...raw.nodes[id],
        transform: structuredClone(doc.nodes[id].transform),
      };
    }
    const dup = remapPayload(raw);
    next = { ...next, nodes: { ...next.nodes, ...dup.nodes } };
    const oldToNew = new Map(selected.map((id, i) => [id, dup.rootIds[i]]));
    const reordered: string[] = [];
    for (const id of childIdsOf(next, parent)) {
      reordered.push(id);
      const copy = oldToNew.get(id);
      if (copy) reordered.push(copy);
    }
    next = withChildIds(next, parent, reordered);
    newIds.push(...dup.rootIds);
  }
  return { doc: next, newIds };
}

/** What {@link reattachPayloadResources} resolved for a pending paste. */
export interface ReattachedPayload {
  nodes: Record<string, SceneNode>;
  scripts: Record<string, ScriptDef>;
  assets: Record<string, DocumentAsset>;
  swatches: Record<string, Swatch>;
  swatchOrder: string[];
  params: Record<string, DocParam>;
  paramOrder: string[];
  /** Ids of scripts taken from the payload (the document lacked them). */
  addedScripts: string[];
  /** True when an image/pattern asset resolves neither here nor in the payload. */
  missingAsset: boolean;
}

/**
 * Reconnect pasted nodes to the destination document's resources. A definition
 * the document already has wins (same id ⇒ same origin, possibly edited since);
 * one it lacks is taken from the payload. An unresolvable generator link is
 * dropped so the geometry still pastes as a plain, hand-editable path, while an
 * unresolvable asset is reported — an image node without its bytes is nothing
 * worth pasting, so the caller refuses the paste instead.
 */
export function reattachPayloadResources(
  doc: Document,
  payload: NodePayload,
  resources: Pick<ClipboardPayload, "scripts" | "assets" | "swatches" | "params">
): ReattachedPayload {
  const nodes = { ...payload.nodes };
  const scripts = { ...doc.scripts };
  const addedScripts: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const scriptId = node.generator?.scriptId;
    if (!scriptId || GENERATORS[scriptId] || scripts[scriptId]) continue;
    const script = resources.scripts[scriptId];
    if (script) {
      scripts[scriptId] = structuredClone(script);
      addedScripts.push(scriptId);
    } else {
      nodes[id] = { ...node, generator: null };
    }
  }

  const all = Object.values(nodes);
  const assets = { ...doc.assets };
  let missingAsset = false;
  for (const assetId of referencedAssetIdsOf(all)) {
    if (assets[assetId]) continue;
    const asset = resources.assets[assetId];
    if (asset) assets[assetId] = structuredClone(asset);
    else missingAsset = true;
  }

  // A dangling swatch reference is tolerated by the model (the paint is simply
  // skipped), so a missing global colour only costs the link, not the paste.
  const swatches = { ...doc.swatches };
  const swatchOrder = [...doc.swatchOrder];
  for (const swatchId of referencedSwatchIds(all)) {
    if (swatches[swatchId]) continue;
    const swatch = resources.swatches[swatchId];
    if (!swatch) continue;
    swatches[swatchId] = structuredClone(swatch);
    swatchOrder.push(swatchId);
  }

  // Same for parameters: without the merge a pasted binding would dangle and
  // its field would freeze at the last value the source document resolved.
  const params = { ...doc.params };
  const paramOrder = [...doc.paramOrder];
  for (const paramId of referencedParamIds(all)) {
    if (params[paramId]) continue;
    const param = resources.params[paramId];
    if (!param) continue;
    params[paramId] = structuredClone(param);
    paramOrder.push(paramId);
  }

  return { nodes, scripts, assets, swatches, swatchOrder, params, paramOrder, addedScripts, missingAsset };
}

/** Clone a payload under fresh ids, optionally nudging its roots. */
export function remapPayload(payload: NodePayload, offset = 0): NodePayload {
  const ids = new Map(Object.keys(payload.nodes).map((id) => [id, makeId(payload.nodes[id].type)]));
  const roots = new Set(payload.rootIds);
  const nodes: Record<string, SceneNode> = {};
  for (const [oldId, node] of Object.entries(payload.nodes)) {
    const id = ids.get(oldId)!;
    let next: SceneNode = { ...structuredClone(node), id };
    if (isContainer(next)) {
      next = { ...next, childIds: next.childIds.map((child) => ids.get(child)!) };
    }
    if (offset && roots.has(oldId)) next = { ...next, transform: multiply(translationMatrix(offset, offset), next.transform) };
    nodes[id] = next;
  }
  return { nodes, rootIds: payload.rootIds.map((id) => ids.get(id)!) };
}

export function groupNode(id: string, childIds: string[]): Group {
  return { id, name: "Group", type: "group", childIds, clipsToMask: false, transform: [...IDENTITY], ...baseNodeDefaults() };
}

export function instanceNode(id: string, symbolId: string, transform: Matrix): SymbolInstance {
  return {
    id,
    name: "Instance",
    type: "instance",
    symbolId,
    transform,
    ...baseNodeDefaults(),
  };
}

/**
 * Append nodes as new top-most children of the given editing scope.
 *
 * Every caller builds its nodes in world space (tools work from world pointer
 * coordinates, and clipboard payload roots carry world transforms), so a scope
 * whose container is not at the world origin has the container's inverse world
 * matrix baked into each appended root — otherwise content drawn inside a
 * focused container would jump by that container's transform the moment it is
 * committed. Scene roots and symbol definition roots are identity, so this is a
 * no-op for them. See docs/design/focus.md.
 */
export function appendToScope(
  doc: Document,
  scope: string | null,
  ids: string[]
): Document | null {
  let next = doc;
  if (scope !== null) {
    if (!isContainer(doc.nodes[scope])) return null;
    const inverse = invertMatrix(nodeWorldMatrix(doc, scope));
    if (!inverse) return null;
    if (!isIdentity(inverse)) {
      const nodes = { ...next.nodes };
      for (const id of ids) {
        const node = nodes[id];
        if (node) nodes[id] = { ...node, transform: multiply(inverse, node.transform) };
      }
      next = { ...next, nodes };
    }
  }
  return withChildIds(next, scope, [...childIdsOf(next, scope), ...ids]);
}
