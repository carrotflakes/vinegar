import ClipperLib from "clipper-lib";
import { flattenSubpathAdaptive, ringsToSubpaths } from "./path";
import { contours, intPath, SCALE, treeToPolys } from "./clipperPaths";
import { applyPathOpSubpaths } from "./pathOps";
import type {
  PathModifier,
  PathShape,
  PathSubpath,
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

const resolvedCache = new WeakMap<PathShape, PathSubpath[]>();

/** Evaluate a path's immutable base geometry through its modifier stack. */
export function resolvedSubpaths(shape: PathShape): PathSubpath[] {
  const modifiers = shape.modifiers ?? [];
  if (!modifiers.some((modifier) => modifier.enabled !== false)) {
    return shape.subpaths;
  }
  const cached = resolvedCache.get(shape);
  if (cached) return cached;
  let result = shape.subpaths;
  for (const modifier of modifiers) {
    if (modifier.enabled === false) continue;
    result = applyModifier(result, modifier, shape.fillRule);
  }
  resolvedCache.set(shape, result);
  return result;
}

/** Bake the evaluated stack into editable base geometry. */
export function applyPathModifiers(shape: PathShape): PathShape {
  if (!(shape.modifiers?.length)) return shape;
  return {
    ...shape,
    subpaths: resolvedSubpaths(shape),
    modifiers: [],
    generator: null,
  };
}
