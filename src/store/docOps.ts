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
import { GENERATORS } from "@/model/generators/generators";
import {
  childIdsOf,
  descendantNodeIds,
  isCompoundPath,
  isContainer,
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
  type Document,
  type DocumentAsset,
  type Group,
  type Matrix,
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
  /** Whether the source document's scripts were trusted when copied. */
  scriptsTrusted: boolean;
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
    scriptsTrusted,
  };
}

/** What {@link reattachPayloadResources} resolved for a pending paste. */
export interface ReattachedPayload {
  nodes: Record<string, SceneNode>;
  scripts: Record<string, ScriptDef>;
  assets: Record<string, DocumentAsset>;
  swatches: Record<string, Swatch>;
  swatchOrder: string[];
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
  resources: Pick<ClipboardPayload, "scripts" | "assets" | "swatches">
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

  return { nodes, scripts, assets, swatches, swatchOrder, addedScripts, missingAsset };
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
 * no-op for them. See docs/focus.md.
 */
export function appendToScope(doc: Document, scope: string | null, ids: string[]): Document {
  let next = doc;
  if (scope !== null) {
    const inverse = invertMatrix(nodeWorldMatrix(doc, scope));
    if (!inverse) return doc;
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
