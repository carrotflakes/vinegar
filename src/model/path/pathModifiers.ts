import ClipperLib from "clipper-lib";
import { flattenSubpath, ringsToSubpaths } from "./path";
import { intPath, SCALE, treeToPolys } from "./clipperPaths";
import { applyPathOpSubpaths } from "./pathOps";
import type {
  PathModifier,
  PathShape,
  PathSubpath,
  StrokeJoin,
} from "../types";

export const DEFAULT_PATH_MODIFIER: Record<
  PathModifier["type"],
  () => PathModifier
> = {
  simplify: () => ({ type: "simplify", tolerance: 2.5 }),
  flatten: () => ({ type: "flatten", tolerance: 0.5 }),
  offset: () => ({ type: "offset", distance: 10, join: "round" }),
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

/** Offset flattened contours. Open contours use a two-sided outline. */
function offsetSubpaths(
  subpaths: PathSubpath[],
  distance: number,
  join: StrokeJoin
): PathSubpath[] {
  if (distance === 0) return subpaths;
  const execute = (closed: boolean): PathSubpath[] => {
    const offset = new ClipperLib.ClipperOffset(4, 0.25 * SCALE);
    let added = false;
    for (const subpath of subpaths) {
      if (subpath.closed !== closed) continue;
      const points = flattenSubpath(subpath);
      if (points.length < (closed ? 3 : 2)) continue;
      offset.AddPath(
        intPath(points),
        clipperJoin(join),
        closed
          ? ClipperLib.EndType.etClosedPolygon
          : ClipperLib.EndType.etOpenButt
      );
      added = true;
    }
    if (!added) return [];
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
  modifier: PathModifier
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
      return offsetSubpaths(subpaths, modifier.distance, modifier.join);
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
    result = applyModifier(result, modifier);
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
