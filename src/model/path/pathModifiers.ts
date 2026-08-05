import ClipperLib from "clipper-lib";
import { ellipseSubpath } from "../ellipse";
import { flattenSubpathAdaptive, ringsToSubpaths } from "./path";
import { contours, intPath, SCALE, treeToPolys } from "./clipperPaths";
import { applyPathOpSubpaths } from "./pathOps";
import { roundedRectSubpath } from "../roundedRect";
import type {
  LineShape,
  PathModifier,
  PathShape,
  PathSubpath,
  PrimitiveShape,
  SceneNode,
  StrokeCap,
  StrokeJoin,
} from "../types";

const OFFSET_FLATNESS = 0.1;

export const DEFAULT_PATH_MODIFIER: Record<
  PathModifier["type"],
  () => PathModifier
> = {
  simplify: () => ({ type: "simplify", tolerance: 2.5 }),
  flatten: () => ({ type: "flatten", tolerance: 0.5 }),
  offset: () => ({ type: "offset", distance: 10, join: "round" }),
  outline: () => ({ type: "outline", width: 10, cap: "round", join: "round" }),
  smooth: () => ({ type: "smooth" }),
  reverse: () => ({ type: "reverse" }),
};

function clipperJoin(join: StrokeJoin): number {
  switch (join) {
    case "miter": return ClipperLib.JoinType.jtMiter;
    case "round": return ClipperLib.JoinType.jtRound;
    case "bevel": return ClipperLib.JoinType.jtSquare;
  }
}

function clipperEnd(cap: StrokeCap, closed: boolean): number {
  if (closed) return ClipperLib.EndType.etClosedLine;
  switch (cap) {
    case "butt": return ClipperLib.EndType.etOpenButt;
    case "round": return ClipperLib.EndType.etOpenRound;
    case "square": return ClipperLib.EndType.etOpenSquare;
  }
}

/** Turn every contour into a centered filled band. */
function outlineSubpaths(
  subpaths: PathSubpath[],
  width: number,
  cap: StrokeCap,
  join: StrokeJoin
): PathSubpath[] {
  if (width <= 0) return [];
  const outline = new ClipperLib.ClipperOffset(4, OFFSET_FLATNESS * SCALE);
  let added = false;
  for (const subpath of subpaths) {
    const path = intPath(flattenSubpathAdaptive(subpath, OFFSET_FLATNESS));
    if (path.length < 2) continue;
    outline.AddPath(path, clipperJoin(join), clipperEnd(cap, subpath.closed));
    added = true;
  }
  if (!added) return [];
  const tree = new ClipperLib.PolyTree();
  outline.Execute(tree, width / 2 * SCALE);
  return ringsToSubpaths(treeToPolys(tree).flat());
}

/** Offset flattened contours. Open contours use a two-sided outline. */
function offsetSubpaths(
  subpaths: PathSubpath[],
  distance: number,
  join: StrokeJoin,
  fillRule: PathShape["fillRule"]
): PathSubpath[] {
  if (distance === 0) return subpaths;
  const execute = (closed: boolean): PathSubpath[] => {
    const offset = new ClipperLib.ClipperOffset(4, OFFSET_FLATNESS * SCALE);
    const paths = subpaths
      .filter((subpath) => subpath.closed === closed)
      .map((subpath) => intPath(flattenSubpathAdaptive(subpath, OFFSET_FLATNESS)))
      .filter((path) => path.length >= (closed ? 3 : 2));
    if (!paths.length) return [];
    let input = paths;
    if (closed) {
      // Canonicalize the filled region before offsetting. ClipperOffset relies
      // on opposite outer/hole orientations; a union supplies those even when
      // an even-odd source stores every contour in the same direction. It also
      // removes redundant nested contours under the nonzero rule.
      const clipper = new ClipperLib.Clipper();
      clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
      const tree = new ClipperLib.PolyTree();
      const rule = fillRule === "evenodd"
        ? ClipperLib.PolyFillType.pftEvenOdd
        : ClipperLib.PolyFillType.pftNonZero;
      clipper.Execute(ClipperLib.ClipType.ctUnion, tree, rule, rule);
      input = contours(tree);
    }
    for (const path of input) {
      offset.AddPath(
        path,
        clipperJoin(join),
        closed
          ? ClipperLib.EndType.etClosedPolygon
          : ClipperLib.EndType.etOpenButt
      );
    }
    const tree = new ClipperLib.PolyTree();
    // Open contours resolve to a symmetric two-sided outline.
    offset.Execute(tree, (closed ? distance : Math.abs(distance)) * SCALE);
    return ringsToSubpaths(treeToPolys(tree).flat());
  };
  const result = [...execute(true), ...execute(false)];
  return result;
}

function applyModifier(
  subpaths: PathSubpath[],
  modifier: PathModifier,
  fillRule: PathShape["fillRule"]
): PathSubpath[] {
  switch (modifier.type) {
    case "simplify":
      return applyPathOpSubpaths(subpaths, "simplify", modifier.tolerance);
    case "flatten":
      return applyPathOpSubpaths(subpaths, "flatten", modifier.tolerance);
    case "smooth":
      return applyPathOpSubpaths(subpaths, "smooth");
    case "reverse":
      return applyPathOpSubpaths(subpaths, "reverse");
    case "offset":
      return offsetSubpaths(subpaths, modifier.distance, modifier.join, fillRule);
    case "outline":
      return outlineSubpaths(subpaths, modifier.width, modifier.cap, modifier.join);
  }
}

function lineSubpath(shape: LineShape): PathSubpath {
  return {
    closed: false,
    anchors: [
      { p: { x: shape.x1, y: shape.y1 }, hIn: null, hOut: null },
      { p: { x: shape.x2, y: shape.y2 }, hIn: null, hOut: null },
    ],
  };
}

/**
 * A shape's own geometry as subpaths, before any modifier runs. This is the
 * editable base: a rect's rounded corners, a path's stored anchors.
 */
export function baseSubpaths(shape: PrimitiveShape): PathSubpath[] {
  switch (shape.type) {
    case "rect":
      return [roundedRectSubpath(shape)];
    case "ellipse":
      return [ellipseSubpath(shape)];
    case "line":
      return [lineSubpath(shape)];
    case "path":
      return shape.subpaths;
  }
}

/** Whether a node's geometry can be taken through a modifier stack. */
export function isModifiable(
  node: SceneNode | null | undefined
): node is PrimitiveShape {
  return node?.type === "rect" || node?.type === "ellipse" ||
    node?.type === "line" || node?.type === "path";
}

/** Whether the stack holds at least one stage that is not bypassed. */
export function hasActiveModifiers(node: SceneNode | null | undefined): boolean {
  return isModifiable(node) &&
    !!node.modifiers?.some((modifier) => modifier.enabled !== false);
}

const resolvedCache = new WeakMap<PrimitiveShape, PathSubpath[]>();

/** Evaluate a shape's immutable base geometry through its modifier stack. */
export function resolvedSubpaths(shape: PrimitiveShape): PathSubpath[] {
  const modifiers = shape.modifiers ?? [];
  if (!modifiers.some((modifier) => modifier.enabled !== false)) {
    return baseSubpaths(shape);
  }
  const cached = resolvedCache.get(shape);
  if (cached) return cached;
  const fillRule = shape.type === "path" ? shape.fillRule : "nonzero";
  let result = baseSubpaths(shape);
  for (const modifier of modifiers) {
    if (modifier.enabled === false) continue;
    result = applyModifier(result, modifier, fillRule);
  }
  resolvedCache.set(shape, result);
  return result;
}

/**
 * Resolved geometry, but only when a modifier actually reshapes the node.
 * `null` lets a reader keep its shape-specific fast path (a bare rect stays a
 * `<rect>`, an ellipse keeps its analytic hit test), so the generic subpath
 * route costs nothing until the user adds a stage.
 */
export function modifiedSubpaths(
  node: SceneNode | null | undefined
): PathSubpath[] | null {
  if (!isModifiable(node) || node.type === "path") return null;
  return hasActiveModifiers(node) ? resolvedSubpaths(node) : null;
}

/**
 * Bake the evaluated stack into editable base geometry. Only paths can absorb
 * the result in place; `applyShapeModifiers` (model/path/convertToPath.ts)
 * converts a modified primitive to a path first.
 */
export function applyPathModifiers(shape: PathShape): PathShape {
  if (!(shape.modifiers?.length)) return shape;
  return {
    ...shape,
    subpaths: resolvedSubpaths(shape),
    modifiers: [],
    generator: null,
  };
}
