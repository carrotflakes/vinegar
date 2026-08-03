import ClipperLib from "clipper-lib";
import { flattenSubpathAdaptive, ringsToSubpaths } from "./path";
import { booleanWithOperand, isAreal, operandIntoLocal } from "./boolean";
import { contours, intPath, SCALE, treeToPolys } from "./clipperPaths";
import { applyPathOpSubpaths } from "./pathOps";
import { enclosingSymbolId, isShape } from "../scene";
import type {
  Document,
  PathModifier,
  SceneNode,
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
  // No operand yet: the stage is inert and the row asks for one.
  boolean: () => ({ type: "boolean", op: "subtract", operandId: "" }),
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

/**
 * Whether two nodes share a coordinate space that a boolean can be expressed
 * in. A symbol definition's content has no single world placement — each
 * instance places it differently — so an operand on the other side of a symbol
 * boundary has no well-defined offset from its consumer. Same scope only.
 */
function sameGeometryScope(doc: Document, a: string, b: string): boolean {
  return enclosingSymbolId(doc, a) === enclosingSymbolId(doc, b);
}

/**
 * Resolve a boolean stage's operand into geometry, or null when it cannot
 * contribute — no document in hand, a missing or non-areal operand, or a cycle.
 * Every one of those leaves the stage a pass-through rather than emptying the
 * shape, and `booleanOperandError` reports which it was to the panel.
 */
function applyBoolean(
  subpaths: PathSubpath[],
  modifier: Extract<PathModifier, { type: "boolean" }>,
  shape: PathShape,
  fillRule: PathShape["fillRule"],
  doc: Document | undefined
): PathSubpath[] {
  if (!doc) return subpaths;
  const operand = doc.nodes[modifier.operandId];
  if (!operand || !isShape(operand) || !isAreal(operand, doc)) return subpaths;
  if (!sameGeometryScope(doc, shape.id, modifier.operandId)) return subpaths;
  const intoLocal = operandIntoLocal(doc, shape.id, modifier.operandId);
  if (!intoLocal) return subpaths;
  return booleanWithOperand(subpaths, fillRule, operand, modifier.op, intoLocal, doc);
}

function applyModifier(
  subpaths: PathSubpath[],
  modifier: PathModifier,
  fillRule: PathShape["fillRule"],
  shape: PathShape,
  doc: Document | undefined
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
    case "boolean":
      return applyBoolean(subpaths, modifier, shape, fillRule, doc);
  }
}

/**
 * One memoized evaluation. `deps` are the operand *nodes* the stack read, in
 * order: a node's own identity no longer covers its result, because moving or
 * editing an operand leaves the target node object untouched. Node objects are
 * immutable, so identity comparison is enough — and cheap, since documents with
 * no boolean stage have an empty dep list.
 */
interface ResolvedEntry {
  deps: readonly SceneNode[];
  result: PathSubpath[];
}

const resolvedCache = new WeakMap<PathShape, ResolvedEntry>();

/** The operand nodes an enabled boolean stage reads, in stack order. */
function operandDeps(shape: PathShape, doc: Document | undefined): SceneNode[] {
  if (!doc) return [];
  const deps: SceneNode[] = [];
  for (const modifier of shape.modifiers ?? []) {
    if (modifier.enabled === false || modifier.type !== "boolean") continue;
    const operand = doc.nodes[modifier.operandId];
    if (operand) deps.push(operand);
  }
  return deps;
}

/**
 * Operand edges must form a DAG, which `sceneValidation` enforces — but a
 * hand-written file reaches the evaluator before anything rejects it, and an
 * evaluator that recurses forever is a frozen tab rather than an error. A node
 * already being evaluated therefore resolves to its base geometry.
 */
const evaluating = new Set<string>();

/**
 * Evaluate a path's immutable base geometry through its modifier stack.
 *
 * `doc` is what lets a stage reach outside the node itself — the boolean stage
 * resolves its operand through it. It stays optional because most stages are
 * pure in the node, but callers on the render / hit-test / bounds / export path
 * must pass it so all of them agree; without it a boolean stage is skipped.
 */
export function resolvedSubpaths(
  shape: PathShape,
  doc?: Document
): PathSubpath[] {
  const modifiers = shape.modifiers ?? [];
  if (!modifiers.some((modifier) => modifier.enabled !== false)) {
    return shape.subpaths;
  }
  if (evaluating.has(shape.id)) return shape.subpaths;
  const deps = operandDeps(shape, doc);
  const cached = resolvedCache.get(shape);
  if (
    cached &&
    cached.deps.length === deps.length &&
    cached.deps.every((dep, index) => dep === deps[index])
  ) {
    return cached.result;
  }
  evaluating.add(shape.id);
  let result = shape.subpaths;
  try {
    for (const modifier of modifiers) {
      if (modifier.enabled === false) continue;
      result = applyModifier(result, modifier, shape.fillRule, shape, doc);
    }
  } finally {
    evaluating.delete(shape.id);
  }
  resolvedCache.set(shape, { deps, result });
  return result;
}

/**
 * Why a boolean stage is not contributing, or null when it is fine. The panel
 * shows this instead of silently rendering the un-combined geometry.
 */
export function booleanOperandError(
  shape: PathShape,
  index: number,
  doc: Document
): string | null {
  const modifier = shape.modifiers?.[index];
  if (modifier?.type !== "boolean") return null;
  if (!modifier.operandId) return "Pick a shape to combine with";
  const operand = doc.nodes[modifier.operandId];
  if (!operand) return "The other shape is gone";
  if (!isShape(operand) || !isAreal(operand, doc)) {
    return "The other shape encloses no area";
  }
  if (!sameGeometryScope(doc, shape.id, modifier.operandId)) {
    return "The other shape is inside a different symbol";
  }
  if (!operandIntoLocal(doc, shape.id, modifier.operandId)) {
    return "This shape's transform cannot be inverted";
  }
  return null;
}

/** Bake the evaluated stack into editable base geometry. */
export function applyPathModifiers(shape: PathShape, doc?: Document): PathShape {
  if (!(shape.modifiers?.length)) return shape;
  return {
    ...shape,
    subpaths: resolvedSubpaths(shape, doc),
    modifiers: [],
    generator: null,
  };
}
