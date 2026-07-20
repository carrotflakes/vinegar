import { IDENTITY, multiply } from "./matrix";
import { isAreal } from "./boolean";
import { strokeDetailFields } from "./stroke";
import {
  makeId,
  type CompoundPathNode,
  type PrimitiveShape,
  type SceneNode,
  type Shape,
  type Document,
} from "./types";
import {
  isCompoundPath,
  isShape,
  parentIdOf,
  selectionRoots,
} from "./scene";

export function isCompoundChild(
  node: SceneNode | undefined
): node is PrimitiveShape {
  if (!node || (node.type !== "rect" && node.type !== "ellipse" && node.type !== "path")) {
    return false;
  }
  return node.type !== "path" ||
    (node.subpaths.length > 0 && node.subpaths.every((sp) => sp.closed));
}

/** Real child shapes whose outlines currently participate in the compound. */
export function compoundChildren(
  doc: Document,
  compound: CompoundPathNode,
  includeHidden = false
): PrimitiveShape[] {
  return compound.childIds.flatMap((id) => {
    const node = doc.nodes[id];
    return isCompoundChild(node) && (includeHidden || !node.hidden)
      ? [node]
      : [];
  });
}

/** Compound paths only accept fully closed, area-bearing geometry. */
export function canCompoundShape(shape: Shape): boolean {
  if (shape.type === "compoundPath") return shape.childIds.length > 0;
  if (!isAreal(shape)) return false;
  if (shape.type === "path") {
    return shape.subpaths.length > 0 && shape.subpaths.every((sp) => sp.closed);
  }
  return true;
}

export function canMakeCompoundPathSelection(doc: Document, selection: string[]): boolean {
  const roots = selectionRoots(doc, selection);
  if (roots.length < 2) return false;
  const parent = parentIdOf(doc, roots[0]);
  if (doc.nodes[parent ?? ""]?.type === "compoundPath") return false;
  return roots.every(
    (id) => parentIdOf(doc, id) === parent && isShape(doc.nodes[id]) && canCompoundShape(doc.nodes[id])
  );
}

export function canReleaseCompoundPathSelection(doc: Document, selection: string[]): boolean {
  const roots = selectionRoots(doc, selection);
  return roots.length > 0 && roots.every((id) => doc.nodes[id]?.type === "compoundPath");
}

/** Create a compound container in the inputs' parent space. */
export function makeCompoundPath(shapes: Shape[]): CompoundPathNode | null {
  if (shapes.length < 2 || !shapes.every(canCompoundShape)) return null;
  const base = shapes[0];
  return {
    id: makeId("compound"),
    name: "Compound Path",
    type: "compoundPath",
    childIds: shapes.flatMap((shape) =>
      isCompoundPath(shape) ? shape.childIds : [shape.id]
    ),
    fill: base.fill,
    stroke: base.stroke,
    strokeWidth: base.strokeWidth,
    ...strokeDetailFields(base),
    opacity: base.opacity,
    blendMode: base.blendMode,
    effects: base.effects ? structuredClone(base.effects) : undefined,
    transform: [...IDENTITY],
    transformOrigin: null,
  };
}

/** Release retained geometry, applying the compound's current appearance. */
export function releaseCompoundPath(
  doc: Document,
  shape: CompoundPathNode
): PrimitiveShape[] {
  return compoundChildren(doc, shape, true).map((component) => ({
    ...structuredClone(component),
    fill: shape.fill,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    ...strokeDetailFields(shape),
    opacity: shape.opacity,
    blendMode: shape.blendMode,
    transform: multiply(shape.transform, component.transform),
  }));
}
