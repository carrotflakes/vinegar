// ===========================================================================
// Numeric bindings: the edge that drives node number fields from a document
// variable's number (`kind: "number"`, see model/vars.ts).
//
// A binding lives on the node (`node.bindings`, keyed by field path) while the
// bound field itself keeps the last resolved number. Every consumer therefore
// keeps reading a plain `number`, and a dangling reference degrades to the
// literal it was showing rather than to no value at all. `syncParamBindings`
// re-derives every bound field from the scope the node lives in — the document's
// variables, or a symbol definition's parameter defaults; the store runs it on
// every committed document, so the two can never drift apart.
//
// One node, one stored value — which is not enough for a symbol instance that
// overrides a numeric parameter. That reading is *derived* rather than stored,
// by `scopedNode`, at the traversals that already descend through an instance.
//
// See docs/parameters.md.
// ===========================================================================

import { GENERATORS, defaultArgs } from "./generators/generators";
import { enclosingSymbolId, isShape } from "./scene";
import {
  documentScope,
  lookupVar,
  symbolDefScope,
  type VarScope,
} from "./vars";
import type {
  Document,
  ParamRef,
  PathModifier,
  PathShape,
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
  boolean: [],
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

const asPath = (node: SceneNode): PathShape | null =>
  node.type === "path" ? node : null;

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
  const modifier = asPath(node)?.modifiers?.[parsed.index];
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
  const shape = asPath(node);
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

/**
 * The value a reference resolves to in `scope`, or null when nothing defines
 * it (or it names a paint — a binding never follows a paint variable). The
 * scope is what makes the same binding resolve differently per symbol
 * instance; outside any instance it is just the document's variables.
 */
export function resolveParamRef(
  ref: ParamRef,
  scope: VarScope | null
): number | null {
  const entry = lookupVar(scope, ref.varId);
  if (!entry || entry.kind !== "number") return null;
  const value = entry.value * ref.scale;
  if (!Number.isFinite(value)) return null;
  return entry.integer ? Math.round(value) : value;
}

/**
 * Rebuild a built-in generator's geometry after its args changed. Document
 * scripts run off the main thread and cannot be rebuilt from a pure helper, so
 * their args are not bindable in the first place (see `canBindGeneratorArgs`).
 */
function rebuiltGenerator(node: SceneNode): SceneNode {
  const shape = asPath(node);
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
 * Re-derive one node's bound fields from `vars`. Bindings whose variable is
 * gone keep the field's current (last resolved) value; bindings whose field
 * path no longer addresses anything — a removed modifier, a detached generator
 * — are dropped, since nothing will ever resolve them again.
 */
export function syncNodeBindings(
  node: SceneNode,
  scope: VarScope | null,
  { prune = true }: { prune?: boolean } = {}
): SceneNode {
  const entries = Object.entries(node.bindings);
  if (!entries.length) return node;
  let next = node;
  let stale: string[] | null = null;
  let generatorChanged = false;
  for (const [path, ref] of entries) {
    const current = readNumField(next, path);
    if (current === null) {
      if (prune) (stale ??= []).push(path);
      continue;
    }
    const value = resolveParamRef(ref, scope);
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
 *
 * A node inside a symbol definition is resolved against that definition's own
 * parameter defaults (over the document's variables), which is the value every
 * reader that ignores scopes will show — including an older build. What an
 * instance's overrides make of it is derived later and never stored; see
 * {@link scopedNode}.
 */
export function syncParamBindings(doc: Document): Document {
  let nodes = doc.nodes;
  let changed = false;
  const scopes = new Map<string | null, VarScope>();
  // Only a document with symbols needs the scene index to tell which
  // definition a node belongs to; without them every node is in scene scope.
  const hasSymbols = Object.keys(doc.symbols).length > 0;
  const scopeOf = (nodeId: string): VarScope => {
    const symbolId = hasSymbols ? enclosingSymbolId(doc, nodeId) : null;
    let scope = scopes.get(symbolId);
    if (!scope) {
      const def = symbolId ? doc.symbols[symbolId] : null;
      scope = def ? symbolDefScope(doc, def) : documentScope(doc);
      scopes.set(symbolId, scope);
    }
    return scope;
  };
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!Object.keys(node.bindings).length) continue;
    const next = syncNodeBindings(node, scopeOf(id));
    if (next === node) continue;
    if (!changed) {
      nodes = { ...doc.nodes };
      changed = true;
    }
    nodes[id] = next;
  }
  return changed ? { ...doc, nodes } : doc;
}

/**
 * The node as it reads under `scope` — phase 2b's derived layer.
 *
 * Outside a symbol instance a bound field already holds its resolved number,
 * so this is the identity function and the whole mechanism costs one string
 * check (`scope.numberKey`). Inside an instance that overrides a numeric
 * parameter it returns a copy with the bound fields re-derived (and a built-in
 * generator rebuilt from them), which every geometry helper then reads as the
 * plain node it has always taken. This is the one place in the design where a
 * node's stored field is not, on its own, the truth: it stays correct for the
 * definition's own defaults, and the per-instance reading is derived here.
 *
 * Results are memoized per (node, scope key), so a scoped node keeps a stable
 * identity across frames and the caches downstream of it — `resolvedSubpaths`,
 * the Path2D cache, culling bounds — keep hitting. Stale binding paths are
 * *not* pruned here: that is a document edit, and this layer never writes one.
 *
 * The memo is an LRU per node, because scrubbing an instance's override mints
 * a fresh key every frame while the *definition's* node object stays the same
 * one — without a bound, one drag would leave hundreds of resolved copies
 * (with rebuilt generator geometry) alive until that node is next edited.
 * Recency is refreshed on a hit, so the instances actually on screen — which
 * every frame reads — outlive a scrub's discarded intermediates.
 */
const scopedCache = new WeakMap<SceneNode, Map<string, SceneNode>>();
const SCOPED_MEMO_LIMIT = 32;

export function scopedNode<T extends SceneNode>(
  node: T,
  scope: VarScope | null | undefined
): T {
  if (!scope?.numberKey) return node;
  if (!Object.keys(node.bindings).length) return node;
  const key = scope.numberKey;
  let byKey = scopedCache.get(node);
  const cached = byKey?.get(key);
  if (cached) {
    // Re-insert to make this the most recently used entry.
    byKey!.delete(key);
    byKey!.set(key, cached);
    return cached as T;
  }
  const resolved = syncNodeBindings(node, scope, { prune: false }) as T;
  if (!byKey) {
    byKey = new Map();
    scopedCache.set(node, byKey);
  }
  byKey.set(key, resolved);
  if (byKey.size > SCOPED_MEMO_LIMIT) {
    // Map iterates in insertion order, so the first key is the oldest use.
    const oldest = byKey.keys().next().value;
    if (oldest !== undefined) byKey.delete(oldest);
  }
  return resolved;
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
  opts: { varId?: string; nodeIds?: Iterable<string>; path?: string } = {}
): Record<string, SceneNode> {
  const ids = opts.nodeIds ? [...opts.nodeIds] : Object.keys(doc.nodes);
  let nodes = doc.nodes;
  let changed = false;
  for (const nodeId of ids) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const drop = Object.entries(node.bindings).filter(
      ([path, ref]) =>
        (!opts.varId || ref.varId === opts.varId) &&
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
