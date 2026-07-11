import { IDENTITY, multiply } from "./matrix";
import { isAreal } from "./boolean";
import {
  makeId,
  type CompoundPathShape,
  type PrimitiveShape,
  type Shape,
  type Document,
} from "./types";
import { isShape, parentIdOf, selectionRoots } from "./scene";

/** Compound paths only accept fully closed, area-bearing geometry. */
export function canCompoundShape(shape: Shape): boolean {
  if (shape.type === "compoundPath") return shape.components.length > 0;
  if (!isAreal(shape)) return false;
  if (shape.type === "bezier") {
    return shape.subpaths.length > 0 && shape.subpaths.every((sp) => sp.closed);
  }
  return true;
}

export function canMakeCompoundPathSelection(doc: Document, selection: string[]): boolean {
  const roots = selectionRoots(doc, selection);
  if (roots.length < 2) return false;
  const parent = parentIdOf(doc, roots[0]);
  return roots.every(
    (id) => parentIdOf(doc, id) === parent && isShape(doc.nodes[id]) && canCompoundShape(doc.nodes[id])
  );
}

export function canReleaseCompoundPathSelection(doc: Document, selection: string[]): boolean {
  const roots = selectionRoots(doc, selection);
  return roots.length > 0 && roots.every((id) => doc.nodes[id]?.type === "compoundPath");
}

function retainedComponents(shape: Shape): PrimitiveShape[] {
  if (shape.type !== "compoundPath") return [structuredClone(shape)];
  return shape.components.map((component) => ({
    ...structuredClone(component),
    transform: multiply(shape.transform, component.transform),
  }));
}

/** Create one non-node-editable compound path in the inputs' parent space. */
export function makeCompoundPath(shapes: Shape[]): CompoundPathShape | null {
  if (shapes.length < 2 || !shapes.every(canCompoundShape)) return null;
  const base = shapes[0];
  return {
    id: makeId("compound"),
    name: "Compound Path",
    type: "compoundPath",
    components: shapes.flatMap(retainedComponents),
    fillRule: "evenodd",
    fill: base.fill,
    stroke: base.stroke,
    strokeWidth: base.strokeWidth,
    opacity: base.opacity,
    blendMode: base.blendMode,
    transform: [...IDENTITY],
    transformOrigin: null,
  };
}

/** Release retained geometry, applying the compound's current appearance. */
export function releaseCompoundPath(shape: CompoundPathShape): PrimitiveShape[] {
  return shape.components.map((component) => ({
    ...structuredClone(component),
    id: makeId(component.type),
    fill: shape.fill,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    opacity: shape.opacity,
    blendMode: shape.blendMode,
    transform: multiply(shape.transform, component.transform),
    hidden: undefined,
    locked: undefined,
  }));
}
