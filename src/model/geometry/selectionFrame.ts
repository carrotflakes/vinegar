import { clippingMask } from "../clippingMask";
import { exactlySelectedGroup } from "../groups";
import {
  descendantNodeIds,
  isFrame,
  isGroup,
  isInstance,
  isShape,
  sceneIndex,
  selectionRoots,
} from "../scene";
import type {
  Bounds,
  Document,
  FrameNode,
  Group,
  Matrix,
  Shape,
  SymbolInstance,
  Vec2,
} from "../types";
import { leafLocalBounds, unionNodeWorldBounds } from "./bounds";
import {
  applyMatrix,
  groupWorldMatrix,
  invertMatrix,
  matrixRotationAngle,
  multiply,
  nodeWorldMatrix,
  transformBounds,
} from "./matrix";

/** A selectable paintable leaf: a shape or a symbol instance. */
export type SelectionLeaf = Shape | SymbolInstance;

/** Mixed frame/artwork selections may move, but have no shared transform box. */
export function isMixedFrameSelection(
  doc: Document,
  selection: string[]
): boolean {
  return selection.length > 1 && selection.some((id) => isFrame(doc.nodes[id]));
}

/** An oriented frame around the current selection. */
export interface SelectionFrame {
  /** Geometric center of the selection in world space. */
  center: Vec2;
  /** Effective rotation center in world space. */
  pivot: Vec2;
  rotation: number;
  bounds: Bounds;
  transform: Matrix;
}

const isLeaf = (
  node: Document["nodes"][string] | undefined
): node is SelectionLeaf => isShape(node) || isInstance(node);

/** Paintable leaves covered by a node selection. */
export function selectedSelectionLeaves(
  doc: Document,
  selection: string[]
): SelectionLeaf[] {
  const paintable = new Set(sceneIndex(doc).shapeIds);
  return selectionRoots(doc, selection)
    .flatMap((id) => {
      const node = doc.nodes[id];
      if (isLeaf(node)) return [id];
      if (isGroup(node) && node.clipsToMask) {
        const mask = clippingMask(doc, node);
        return mask ? [mask.id] : [];
      }
      return descendantNodeIds(doc, id).filter((childId) =>
        paintable.has(childId)
      );
    })
    .map((id) => doc.nodes[id])
    .filter(isLeaf);
}

export function getSelectionFrame(
  doc: Document,
  shapes: SelectionLeaf[],
  group?: Group | null,
  selectionPivot?: Vec2 | null,
  selectionTransform?: Matrix | null
): SelectionFrame | null {
  if (shapes.length === 0) return null;
  if (group) {
    const transform = groupWorldMatrix(doc, group.id);
    const inverse = invertMatrix(transform);
    if (inverse) {
      const bounds = unionBounds(
        shapes.map((shape) =>
          transformBounds(
            leafLocalBounds(doc, shape),
            multiply(inverse, nodeWorldMatrix(doc, shape.id))
          )
        )
      );
      const center = applyMatrix(transform, boundsCenter(bounds));
      return {
        center,
        pivot: applyMatrix(
          transform,
          group.transformOrigin ?? boundsCenter(bounds)
        ),
        rotation: matrixRotationAngle(transform),
        bounds,
        transform,
      };
    }
  }
  if (shapes.length === 1) {
    const shape = shapes[0];
    const bounds = leafLocalBounds(doc, shape);
    const transform = nodeWorldMatrix(doc, shape.id);
    const center = applyMatrix(transform, boundsCenter(bounds));
    return {
      center,
      pivot: shape.transformOrigin
        ? applyMatrix(transform, shape.transformOrigin)
        : center,
      rotation: matrixRotationAngle(transform),
      bounds,
      transform,
    };
  }
  if (selectionTransform) {
    const inverse = invertMatrix(selectionTransform);
    if (inverse) {
      const bounds = unionBounds(
        shapes.map((shape) =>
          transformBounds(
            leafLocalBounds(doc, shape),
            multiply(inverse, nodeWorldMatrix(doc, shape.id))
          )
        )
      );
      const center = applyMatrix(selectionTransform, boundsCenter(bounds));
      return {
        center,
        pivot: selectionPivot ?? center,
        rotation: matrixRotationAngle(selectionTransform),
        bounds,
        transform: selectionTransform,
      };
    }
  }
  const bounds = unionNodeWorldBounds(
    doc,
    shapes.map((shape) => shape.id)
  );
  if (!bounds) return null;
  const center = boundsCenter(bounds);
  return {
    center,
    pivot: selectionPivot ?? center,
    rotation: 0,
    bounds,
    transform: [1, 0, 0, 1, 0, 0],
  };
}

/** The lone selected frame node, or null. */
export function singleSelectedFrame(
  doc: Document,
  selection: string[]
): FrameNode | null {
  if (selection.length !== 1) return null;
  const node = doc.nodes[selection[0]];
  return isFrame(node) ? node : null;
}

/** Selection frame for a frame node's own content box. */
export function frameNodeSelectionFrame(
  doc: Document,
  frame: FrameNode
): SelectionFrame {
  const transform = nodeWorldMatrix(doc, frame.id);
  const bounds = { x: 0, y: 0, width: frame.width, height: frame.height };
  const center = applyMatrix(transform, boundsCenter(bounds));
  return {
    center,
    pivot: frame.transformOrigin
      ? applyMatrix(transform, frame.transformOrigin)
      : center,
    rotation: matrixRotationAngle(transform),
    bounds,
    transform,
  };
}

/** Pure selection-to-frame entry point shared by canvas chrome and commands. */
export function selectionFrameForSelection(
  doc: Document,
  selection: string[],
  selectionPivot?: Vec2 | null,
  selectionTransform?: Matrix | null
): SelectionFrame | null {
  const frame = singleSelectedFrame(doc, selection);
  if (frame) return frameNodeSelectionFrame(doc, frame);
  return getSelectionFrame(
    doc,
    selectedSelectionLeaves(doc, selection),
    exactlySelectedGroup(doc, selection),
    selectionPivot,
    selectionTransform
  );
}

function boundsCenter(bounds: Bounds): Vec2 {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function unionBounds(bounds: Bounds[]): Bounds {
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}
