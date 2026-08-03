// ===========================================================================
// Document variables — one named-value table for both reference edges.
//
// A variable holds a number or a concrete paint (`VarValue`). Paint uses point
// *at* it from inside the field (a `var` Paint), numbers point at it from
// *beside* the field (`node.bindings`, see model/params.ts). The two mechanisms
// stay split because their sinks differ; the table, the panel, the commands and
// the scope chain are shared.
//
// Scope: a reference inside a symbol definition resolves against, in order,
// the args of the instance being evaluated, the definition's parameter
// defaults, then the document's variables. Outside any instance the scope is
// just `doc.vars`. See docs/parameters.md.
// ===========================================================================

import { isVarRef, tintPaint } from "./paint";
import { enclosingSymbolId, isShape } from "./scene";
import type { ConcretePaint, Paint } from "./paint";
import type {
  DocVar,
  Document,
  NumberVarValue,
  SceneNode,
  Shape,
  SymbolDef,
  SymbolInstance,
  VarValue,
} from "./types";

/** The two paint slots every shape carries. */
export type PaintTarget = "fill" | "stroke";

/**
 * A lookup chain, innermost first. Every frame is a flat id -> value map; the
 * document's own variables are the outermost frame.
 */
export interface VarScope {
  readonly values: Record<string, VarValue>;
  readonly parent: VarScope | null;
}

const docScopes = new WeakMap<Record<string, DocVar>, VarScope>();

/** The document-level scope (no instance overrides). Memoized on `doc.vars`. */
export function documentScope(doc: Document): VarScope {
  const cached = docScopes.get(doc.vars);
  if (cached) return cached;
  const values: Record<string, VarValue> = {};
  for (const [id, entry] of Object.entries(doc.vars)) values[id] = entry.value;
  const scope: VarScope = { values, parent: null };
  docScopes.set(doc.vars, scope);
  return scope;
}

/**
 * The scope inside `instance`'s definition: the instance's args over the
 * definition's parameter defaults, stacked on the enclosing scope. Nested
 * instances therefore stack and the innermost wins.
 */
export function symbolScope(
  parent: VarScope,
  def: SymbolDef,
  instance: SymbolInstance
): VarScope {
  if (!def.params.length) return parent;
  const values: Record<string, VarValue> = {};
  for (const param of def.params) {
    // An override of the wrong type is ignored: `default` fixes the type.
    const arg = instance.args[param.key];
    values[param.key] =
      arg && arg.kind === param.default.kind ? arg : param.default;
  }
  return { values, parent };
}

/**
 * The scope inside a definition that is *not* being evaluated through an
 * instance: its parameter defaults over the document's variables. This is what
 * symbol-edit focus paints with, and what a promotion reads the current paint
 * through.
 */
export function symbolDefScope(doc: Document, def: SymbolDef): VarScope {
  const parent = documentScope(doc);
  if (!def.params.length) return parent;
  const values: Record<string, VarValue> = {};
  for (const param of def.params) values[param.key] = param.default;
  return { values, parent };
}

/**
 * The scope a node paints in when it is reached directly rather than through
 * an instance — the defaults of the definition it lives in, if any.
 */
export function scopeForNode(doc: Document, nodeId: string | null): VarScope {
  const symbolId = nodeId === null ? null : enclosingSymbolId(doc, nodeId);
  const def = symbolId ? doc.symbols[symbolId] : null;
  return def ? symbolDefScope(doc, def) : documentScope(doc);
}

/** The value `id` resolves to in `scope`, or null when nothing defines it. */
export function lookupVar(scope: VarScope | null, id: string): VarValue | null {
  for (let s = scope; s; s = s.parent) {
    const value = s.values[id];
    if (value) return value;
  }
  return null;
}

/**
 * Resolve a possibly-referential paint to a concrete one. Returns null for a
 * dangling reference (or one that names a number variable) so callers can fall
 * back the way they already do for "no paint" — render: skip; export: omit.
 * A non-referential paint is returned unchanged.
 */
export function resolvePaint(
  paint: Paint | null,
  scope: VarScope | null
): ConcretePaint | null {
  if (paint == null) return null;
  if (!isVarRef(paint)) return paint;
  const value = lookupVar(scope, paint.varId);
  if (!value || value.kind !== "paint") return null;
  return tintPaint(value.value, paint.alpha);
}

/** Resolve a paint against the document scope only (no instance overrides). */
export function resolveDocPaint(
  paint: Paint | null,
  doc: Document
): ConcretePaint | null {
  return resolvePaint(paint, documentScope(doc));
}

/** The document's variable table, as the listing helpers below need it. Taken
 *  apart from `Document` so a panel can subscribe to just these two fields. */
export type VarTable = Pick<Document, "vars" | "varOrder">;

const varsOfKind = (table: VarTable, kind: VarValue["kind"]): DocVar[] =>
  table.varOrder
    .map((id) => table.vars[id])
    .filter((entry): entry is DocVar => !!entry && entry.value.kind === kind);

/** The number variables, in `varOrder`. */
export const numberVars = (table: VarTable): DocVar[] =>
  varsOfKind(table, "number");

/** The paint variables, in `varOrder`. */
export const paintVars = (table: VarTable): DocVar[] =>
  varsOfKind(table, "paint");

/** The stored number of a number variable, or null for anything else. */
export function numberOf(value: VarValue | null): NumberVarValue | null {
  return value && value.kind === "number" ? value : null;
}

/** Whether a node's `target` paint references variable `id`. */
function refsVar(node: SceneNode, target: PaintTarget, id: string): boolean {
  if (!isShape(node)) return false;
  const paint = node[target];
  return isVarRef(paint) && paint.varId === id;
}

/** Fill/stroke references to a single variable across all nodes. */
export function paintUsageCount(doc: Document, id: string): number {
  let n = 0;
  for (const node of Object.values(doc.nodes)) {
    if (refsVar(node, "fill", id)) n++;
    if (refsVar(node, "stroke", id)) n++;
  }
  return n;
}

/**
 * How many uses each variable has, in one scan: paint references from
 * fills/strokes plus numeric bindings. The merged panel shows one count per
 * row whichever kind the variable is.
 */
export function varUsageCounts(doc: Document): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const node of Object.values(doc.nodes)) {
    for (const ref of Object.values(node.bindings)) bump(ref.varId);
    if (!isShape(node)) continue;
    for (const paint of [node.fill, node.stroke]) {
      if (isVarRef(paint)) bump(paint.varId);
    }
  }
  return counts;
}

/**
 * Return a nodes map with every `var` paint reference (optionally limited to
 * one variable id, and/or a set of node ids and target) baked to its concrete
 * paint. A dangling reference resolves to `null` (no paint). Returns the same
 * map when nothing changed so callers can skip a no-op transaction.
 */
export function bakePaintRefs(
  doc: Document,
  opts: { varId?: string; nodeIds?: Iterable<string>; target?: PaintTarget } = {}
): Record<string, SceneNode> {
  const ids = opts.nodeIds ? [...opts.nodeIds] : Object.keys(doc.nodes);
  const targets: PaintTarget[] = opts.target ? [opts.target] : ["fill", "stroke"];
  const scope = documentScope(doc);
  let nodes = doc.nodes;
  let changed = false;
  for (const nodeId of ids) {
    const node = doc.nodes[nodeId];
    if (!isShape(node)) continue;
    let next = node;
    for (const target of targets) {
      const paint = next[target];
      if (!isVarRef(paint)) continue;
      if (opts.varId && paint.varId !== opts.varId) continue;
      next = { ...next, [target]: resolvePaint(paint, scope) } as Shape;
    }
    if (next !== node) {
      if (!changed) {
        nodes = { ...doc.nodes };
        changed = true;
      }
      nodes[nodeId] = next;
    }
  }
  return nodes;
}

/** Variable ids the given nodes reference, through paint or through bindings. */
export function referencedVarIds(nodes: Iterable<SceneNode>): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) {
    for (const ref of Object.values(node.bindings)) out.add(ref.varId);
    if (!isShape(node)) continue;
    for (const paint of [node.fill, node.stroke]) {
      if (isVarRef(paint)) out.add(paint.varId);
    }
  }
  return out;
}

/**
 * Document variables' structural invariant: `varOrder` and `vars` are a
 * bijection. Reference *targets* are not checked — a dangling paint reference
 * paints nothing and a dangling binding keeps its last value, both of which the
 * UI surfaces rather than the model rejecting.
 */
export function hasValidVars(doc: Document): boolean {
  const ids = Object.keys(doc.vars);
  if (ids.length !== doc.varOrder.length) return false;
  return !doc.varOrder.some((id) => !doc.vars[id]);
}
