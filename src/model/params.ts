// ===========================================================================
// Document parameters ("global numbers") and the bindings that drive node
// number fields from them — the numeric counterpart of global colours.
//
// A binding lives on the node (`node.bindings`, keyed by field path) while the
// bound field itself keeps the last resolved number. Every consumer therefore
// keeps reading a plain `number`, and a dangling reference degrades to the
// literal it was showing rather than to no value at all. `syncParamBindings`
// re-derives every bound field from `doc.params`; the store runs it on every
// committed document, so the two can never drift apart.
//
// See docs/parameters.md.
// ===========================================================================

import { GENERATORS, defaultArgs } from "./generators/generators";
import { isModifiable } from "./path/pathModifiers";
import { isShape } from "./scene";
import type {
  DocParam,
  Document,
  ParamRef,
  PathModifier,
  PathShape,
  PrimitiveShape,
  SceneNode,
} from "./types";

/** The bindable numeric field of every path modifier type (empty = none). */
const MODIFIER_NUM_KEYS: Record<PathModifier["type"], readonly string[]> = {
  simplify: ["tolerance"],
  flatten: ["tolerance"],
  offset: ["distance"],
  outline: ["width"],
  smooth: [],
  reverse: [],
};

/** Field paths whose value may never go negative (the model rejects it). */
const NON_NEGATIVE = new Set(["strokeWidth", "tolerance", "width"]);

export const STROKE_WIDTH_PATH = "strokeWidth";
export const generatorArgPath = (key: string): string => `generator.args.${key}`;
export const modifierParamPath = (index: number, key: string): string =>
  `modifiers.${index}.${key}`;

type ParsedPath =
  | { kind: "strokeWidth" }
  | { kind: "generatorArg"; key: string }
  | { kind: "modifier"; index: number; key: string };

function parsePath(path: string): ParsedPath | null {
  if (path === STROKE_WIDTH_PATH) return { kind: "strokeWidth" };
  if (path.startsWith("generator.args.")) {
    const key = path.slice("generator.args.".length);
    return key ? { kind: "generatorArg", key } : null;
  }
  if (path.startsWith("modifiers.")) {
    const [index, key, ...rest] = path.slice("modifiers.".length).split(".");
    const i = Number(index);
    if (rest.length || !key || !Number.isInteger(i) || i < 0) return null;
    return { kind: "modifier", index: i, key };
  }
  return null;
}

const asModifiable = (node: SceneNode): PrimitiveShape | null =>
  isModifiable(node) ? node : null;

/**
 * The current number at `path`, or null when the path does not address a
 * bindable field on this node (a group has no stroke width; a modifier the
 * user removed no longer has an index).
 */
export function readNumField(node: SceneNode, path: string): number | null {
  const parsed = parsePath(path);
  if (!parsed) return null;
  if (parsed.kind === "strokeWidth") {
    return isShape(node) ? node.strokeWidth : null;
  }
  if (parsed.kind === "generatorArg") {
    const value = node.generator?.args[parsed.key];
    return typeof value === "number" ? value : null;
  }
  const modifier = asModifiable(node)?.modifiers?.[parsed.index];
  if (!modifier || !MODIFIER_NUM_KEYS[modifier.type].includes(parsed.key)) {
    return null;
  }
  const value = (modifier as unknown as Record<string, unknown>)[parsed.key];
  return typeof value === "number" ? value : null;
}

/**
 * Write `value` into the field at `path`, clamping it into the field's own
 * legal domain (a parameter's min/max are scrubber hints, but a negative
 * stroke width is not a document the model accepts). Returns null when the
 * path does not address a bindable field on this node.
 */
export function writeNumField(
  node: SceneNode,
  path: string,
  value: number
): SceneNode | null {
  const parsed = parsePath(path);
  if (!parsed || !Number.isFinite(value)) return null;
  if (parsed.kind === "strokeWidth") {
    if (!isShape(node)) return null;
    return { ...node, strokeWidth: Math.max(0, value) };
  }
  if (parsed.kind === "generatorArg") {
    const generator = node.generator;
    if (!generator || !(parsed.key in generator.args)) return null;
    return {
      ...node,
      generator: { ...generator, args: { ...generator.args, [parsed.key]: value } },
    };
  }
  const shape = asModifiable(node);
  const modifier = shape?.modifiers?.[parsed.index];
  if (!shape || !modifier || !MODIFIER_NUM_KEYS[modifier.type].includes(parsed.key)) {
    return null;
  }
  const clamped = NON_NEGATIVE.has(parsed.key) ? Math.max(0, value) : value;
  const modifiers = shape.modifiers!.map((entry, i) =>
    i === parsed.index ? ({ ...entry, [parsed.key]: clamped } as PathModifier) : entry
  );
  return { ...shape, modifiers };
}

/** The value a reference resolves to, or null when the parameter is gone. */
export function resolveParamRef(
  ref: ParamRef,
  params: Record<string, DocParam>
): number | null {
  const param = params[ref.paramId];
  if (!param) return null;
  const value = param.value * ref.scale;
  if (!Number.isFinite(value)) return null;
  return param.integer ? Math.round(value) : value;
}

/**
 * Rebuild a built-in generator's geometry after its args changed. Document
 * scripts run off the main thread and cannot be rebuilt from a pure helper, so
 * their args are not bindable in the first place (see `canBindGeneratorArgs`).
 */
function rebuiltGenerator(node: SceneNode): SceneNode {
  const shape: PathShape | null = node.type === "path" ? node : null;
  const scriptId = shape?.generator?.scriptId;
  if (!shape || !scriptId) return node;
  const builtin = GENERATORS[scriptId];
  if (!builtin) return node;
  const subpaths = builtin.build(shape.generator!.args);
  return subpaths?.length ? { ...shape, subpaths } : node;
}

/**
 * Whether a generator's args may be bound. Built-ins build synchronously, so a
 * parameter edit can retune them in the same document commit; a document
 * script's geometry only comes back from the worker, which a pure
 * `Document -> Document` resolution step cannot wait for. Phase 1 therefore
 * leaves script generators unbindable rather than letting their args and their
 * geometry drift apart.
 */
export function canBindGeneratorArgs(scriptId: string): boolean {
  return scriptId in GENERATORS;
}

/**
 * Make `path` addressable before binding it. A generator node only stores the
 * args it has been given, so a parameter the panel is still showing at its
 * default has no field to drive yet; fill the whole default set in so it does.
 * Every other bindable path already exists on the node.
 */
export function materializeBindable(node: SceneNode, path: string): SceneNode {
  if (readNumField(node, path) !== null) return node;
  const parsed = parsePath(path);
  const generator = node.generator;
  if (parsed?.kind !== "generatorArg" || !generator) return node;
  const builtin = GENERATORS[generator.scriptId];
  if (!builtin) return node;
  const args = { ...defaultArgs(builtin), ...generator.args };
  if (!(parsed.key in args)) return node;
  return { ...node, generator: { ...generator, args } };
}

/**
 * Re-derive one node's bound fields from `params`. Bindings whose parameter is
 * gone keep the field's current (last resolved) value; bindings whose field
 * path no longer addresses anything — a removed modifier, a detached generator
 * — are dropped, since nothing will ever resolve them again.
 */
export function syncNodeBindings(
  node: SceneNode,
  params: Record<string, DocParam>
): SceneNode {
  const entries = Object.entries(node.bindings);
  if (!entries.length) return node;
  let next = node;
  let stale: string[] | null = null;
  let generatorChanged = false;
  for (const [path, ref] of entries) {
    const current = readNumField(next, path);
    if (current === null) {
      (stale ??= []).push(path);
      continue;
    }
    const value = resolveParamRef(ref, params);
    if (value === null || value === current) continue;
    const written = writeNumField(next, path, value);
    if (!written) continue;
    next = written;
    if (path.startsWith("generator.args.")) generatorChanged = true;
  }
  if (generatorChanged) next = rebuiltGenerator(next);
  if (stale) {
    const bindings = { ...next.bindings };
    for (const path of stale) delete bindings[path];
    next = { ...next, bindings };
  }
  return next;
}

/**
 * Re-derive every bound field in the document. Returns the same document when
 * nothing changed, so callers can skip a no-op commit. Nodes that bind nothing
 * cost one property read each.
 */
export function syncParamBindings(doc: Document): Document {
  let nodes = doc.nodes;
  let changed = false;
  for (const [id, node] of Object.entries(doc.nodes)) {
    const next = syncNodeBindings(node, doc.params);
    if (next === node) continue;
    if (!changed) {
      nodes = { ...doc.nodes };
      changed = true;
    }
    nodes[id] = next;
  }
  return changed ? { ...doc, nodes } : doc;
}

/** Binding counts for every parameter, in one scan (panel display). */
export function paramUsageCounts(doc: Document): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of Object.values(doc.nodes)) {
    for (const ref of Object.values(node.bindings)) {
      counts.set(ref.paramId, (counts.get(ref.paramId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Parameter ids referenced by the given nodes (clipboard payloads). */
export function referencedParamIds(nodes: Iterable<SceneNode>): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    for (const ref of Object.values(node.bindings)) ids.add(ref.paramId);
  }
  return ids;
}

/** A node with `path` bound to `ref`, or unbound when `ref` is null. */
export function withBinding(
  node: SceneNode,
  path: string,
  ref: ParamRef | null
): SceneNode {
  if (!ref && !(path in node.bindings)) return node;
  const bindings = { ...node.bindings };
  if (ref) bindings[path] = ref;
  else delete bindings[path];
  return { ...node, bindings };
}

/**
 * Return a nodes map with matching bindings dropped. The bound fields keep the
 * number they currently show, so baking never changes the picture — it only
 * detaches it from the parameter.
 */
export function bakeParamRefs(
  doc: Document,
  opts: { paramId?: string; nodeIds?: Iterable<string>; path?: string } = {}
): Record<string, SceneNode> {
  const ids = opts.nodeIds ? [...opts.nodeIds] : Object.keys(doc.nodes);
  let nodes = doc.nodes;
  let changed = false;
  for (const nodeId of ids) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const drop = Object.entries(node.bindings).filter(
      ([path, ref]) =>
        (!opts.paramId || ref.paramId === opts.paramId) &&
        (!opts.path || path === opts.path)
    );
    if (!drop.length) continue;
    const bindings = { ...node.bindings };
    for (const [path] of drop) delete bindings[path];
    if (!changed) {
      nodes = { ...doc.nodes };
      changed = true;
    }
    nodes[nodeId] = { ...node, bindings };
  }
  return nodes;
}

/**
 * Re-key `modifiers.<index>.*` bindings after the stack was reordered or had an
 * entry removed. `moved` maps each surviving modifier's old index to its new
 * one; bindings on an index that is not in the map are dropped with it.
 */
export function remapModifierBindings(
  bindings: Record<string, ParamRef>,
  moved: ReadonlyMap<number, number>
): Record<string, ParamRef> {
  const next: Record<string, ParamRef> = {};
  for (const [path, ref] of Object.entries(bindings)) {
    const parsed = parsePath(path);
    if (!parsed || parsed.kind !== "modifier") {
      next[path] = ref;
      continue;
    }
    const index = moved.get(parsed.index);
    if (index === undefined) continue;
    next[modifierParamPath(index, parsed.key)] = ref;
  }
  return next;
}

/**
 * Global numbers' structural invariant: `paramOrder` and `params` are a
 * bijection. Reference *targets* are not checked — a dangling binding is
 * tolerated (the field keeps its last value) and surfaced by the UI.
 */
export function hasValidParams(doc: Document): boolean {
  const ids = Object.keys(doc.params);
  if (ids.length !== doc.paramOrder.length) return false;
  return !doc.paramOrder.some((id) => !doc.params[id]);
}
