// Scope semantics for focus (isolation) editing: a scope is a container node
// id, and the helpers that resolve leaves, roots, the owning symbol and a
// still-valid focus stack all key off that. See docs/design/focus.md.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let scopeLeafIds;
let symbolLeafIds;
let scopeRootIds;
let isNodeInScope;
let enclosingSymbolId;
let validFocusPrefix;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({
    scopeLeafIds,
    symbolLeafIds,
    scopeRootIds,
    isNodeInScope,
    enclosingSymbolId,
    validFocusPrefix,
  } = await server.ssrLoadModule("/src/model/scene.ts"));
});

after(async () => {
  await server.close();
});

const IDENTITY = [1, 0, 0, 1, 0, 0];

const rect = (id) => ({
  id,
  name: id,
  type: "rect",
  ...SHAPE_BASE,
  cornerRadius: 0,
  ...NODE_BASE,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  transform: [...IDENTITY],
});

const group = (id, childIds) => ({
  id,
  name: id,
  type: "group",
  childIds,
  clipsToMask: false,
  ...NODE_BASE,
  transform: [...IDENTITY],
});

const instance = (id, symbolId) => ({
  id,
  name: id,
  type: "instance",
  symbolId,
  ...NODE_BASE,
  transform: [...IDENTITY],
});

const frame = (id, childIds) => ({
  id,
  name: id,
  type: "frame",
  childIds,
  ...NODE_BASE,
  ...SHAPE_BASE,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  clipsContent: true,
  transform: [...IDENTITY],
});

/**
 * frame f [ group outer [ r1, group inner [ r2 ] ] ], r3 loose at the top
 * level, plus symbol "sym" whose definition holds r4.
 */
function makeDoc() {
  return {
    metadata: { name: "t" },
    settings: { gridSize: 10 },
    nodes: {
      f: frame("f", ["outer"]),
      outer: group("outer", ["r1", "inner"]),
      inner: group("inner", ["r2"]),
      r1: rect("r1"),
      r2: rect("r2"),
      r3: rect("r3"),
      defRoot: group("defRoot", ["r4"]),
      r4: rect("r4"),
    },
    rootIds: ["f", "r3"],
    symbols: { sym: { id: "sym", name: "Sym", rootNodeId: "defRoot" } },
    guides: [],
    scripts: {},
    assets: {},
    swatches: {},
    swatchOrder: [],
  };
}

test("a scope's leaves are its descendants, and the scene scope excludes definitions", () => {
  const doc = makeDoc();
  // Scene scope: everything paintable outside any symbol definition.
  assert.deepEqual(scopeLeafIds(doc, null), ["r1", "r2", "r3"]);
  // Container scopes are subtrees, at any depth.
  assert.deepEqual(scopeLeafIds(doc, "f"), ["r1", "r2"]);
  assert.deepEqual(scopeLeafIds(doc, "outer"), ["r1", "r2"]);
  assert.deepEqual(scopeLeafIds(doc, "inner"), ["r2"]);
  // A definition root is just another container scope; its content never
  // reaches the scene scope.
  assert.deepEqual(scopeLeafIds(doc, "defRoot"), ["r4"]);
  assert.deepEqual(symbolLeafIds(doc, "sym"), ["r4"]);
});

test("scope roots are the container's children, or the scene roots", () => {
  const doc = makeDoc();
  assert.deepEqual(scopeRootIds(doc, null), ["f", "r3"]);
  assert.deepEqual(scopeRootIds(doc, "outer"), ["r1", "inner"]);
  assert.deepEqual(scopeRootIds(doc, "defRoot"), ["r4"]);
});

test("node membership follows the editing scope and excludes definition content from the scene", () => {
  const doc = makeDoc();
  assert.equal(isNodeInScope(doc, "outer", null), true);
  assert.equal(isNodeInScope(doc, "r4", null), false);
  assert.equal(isNodeInScope(doc, "r2", "outer"), true);
  assert.equal(isNodeInScope(doc, "outer", "outer"), false);
  assert.equal(isNodeInScope(doc, "r3", "outer"), false);
});

test("enclosingSymbolId recovers the symbol behind a scope", () => {
  const doc = makeDoc();
  assert.equal(enclosingSymbolId(doc, null), null);
  assert.equal(enclosingSymbolId(doc, "r1"), null);
  // Both the definition root and anything under it belong to the symbol.
  assert.equal(enclosingSymbolId(doc, "defRoot"), "sym");
  assert.equal(enclosingSymbolId(doc, "r4"), "sym");
});

test("a focus stack is truncated at the first entry the document invalidates", () => {
  const doc = makeDoc();
  assert.deepEqual(validFocusPrefix(doc, ["f", "outer", "inner"]), [
    "f",
    "outer",
    "inner",
  ]);
  // Skipped levels are fine as long as each entry is inside the one before it.
  assert.deepEqual(validFocusPrefix(doc, ["f", "inner"]), ["f", "inner"]);
  // A deleted container drops it and everything below it.
  const deleted = { ...doc, nodes: { ...doc.nodes } };
  delete deleted.nodes.outer;
  assert.deepEqual(validFocusPrefix(deleted, ["f", "outer", "inner"]), ["f"]);
  // Leaves are not containers, and sideways entries break the path.
  assert.deepEqual(validFocusPrefix(doc, ["r1"]), []);
  assert.deepEqual(validFocusPrefix(doc, ["inner", "outer"]), ["inner"]);
  assert.deepEqual(validFocusPrefix(doc, ["gone"]), []);
  // A container that became hidden or locked is no longer somewhere to stand:
  // it would show an empty canvas, or nothing selectable.
  const hidden = { ...doc, nodes: { ...doc.nodes, outer: { ...doc.nodes.outer, hidden: true } } };
  assert.deepEqual(validFocusPrefix(hidden, ["f", "outer", "inner"]), ["f"]);
  const locked = { ...doc, nodes: { ...doc.nodes, outer: { ...doc.nodes.outer, locked: true } } };
  assert.deepEqual(validFocusPrefix(locked, ["f", "outer", "inner"]), ["f"]);

  // A definition root follows an outer scope only through an actual instance
  // in that scope. Removing the reference invalidates that stack edge.
  const linked = {
    ...doc,
    nodes: {
      ...doc.nodes,
      outer: { ...doc.nodes.outer, childIds: [...doc.nodes.outer.childIds, "inst"] },
      inst: instance("inst", "sym"),
    },
  };
  assert.deepEqual(validFocusPrefix(linked, ["f", "outer", "defRoot"]), [
    "f",
    "outer",
    "defRoot",
  ]);
  assert.deepEqual(validFocusPrefix(doc, ["f", "outer", "defRoot"]), [
    "f",
    "outer",
  ]);
  const hiddenInstance = {
    ...linked,
    nodes: {
      ...linked.nodes,
      inst: { ...linked.nodes.inst, hidden: true },
    },
  };
  assert.deepEqual(validFocusPrefix(hiddenInstance, ["f", "outer", "defRoot"]), [
    "f",
    "outer",
  ]);
  const lockedInstance = {
    ...linked,
    nodes: {
      ...linked.nodes,
      inst: { ...linked.nodes.inst, locked: true },
    },
  };
  assert.deepEqual(validFocusPrefix(lockedInstance, ["f", "outer", "defRoot"]), [
    "f",
    "outer",
  ]);
  // Opening a definition directly starts a fresh path.
  assert.deepEqual(validFocusPrefix(doc, ["defRoot"]), ["defRoot"]);

  const singular = {
    ...doc,
    nodes: {
      ...doc.nodes,
      outer: { ...doc.nodes.outer, transform: [0, 0, 0, 1, 0, 0] },
    },
  };
  assert.deepEqual(validFocusPrefix(singular, ["f", "outer"]), ["f"]);
});
