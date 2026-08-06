// The Layers panel's display tree and the list arithmetic on top of it:
// Shift+click range selection and where a multi-row drop lands.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let tree;

const group = (id, childIds = [], patch = {}) => ({
  id,
  name: id,
  type: "group",
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  childIds,
  ...patch,
});

const rect = (id, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  cornerRadius: 0,
  ...patch,
});

const doc = (nodes, rootIds) => ({
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  rootIds,
  symbols: {},
});

/** rootIds ["a","b","g"] with g = ["c","d"] — g is front-most. */
const nested = doc(
  [rect("a"), rect("b"), group("g", ["c", "d"]), rect("c"), rect("d")],
  ["a", "b", "g"]
);

const order = (d, collapsed = []) =>
  tree.visibleIds(tree.toDisplayTree(d, d.rootIds), new Set(collapsed));

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  tree = await server.ssrLoadModule("/src/ui/panels/layers/tree.ts");
});

after(async () => server.close());

// --- display order -------------------------------------------------------

test("the panel lists every level front-most first", () => {
  assert.deepEqual(order(nested), ["g", "d", "c", "b", "a"]);
});

test("a collapsed container hides its children from the row order", () => {
  assert.deepEqual(order(nested, ["g"]), ["g", "b", "a"]);
});

test("flattenRows carries the indent, container slot and inherited dimming", () => {
  const d = doc(
    [rect("a"), group("g", ["c", "d"], { hidden: true }), rect("c"), rect("d")],
    ["a", "g"]
  );
  const rows = tree.flattenRows(tree.toDisplayTree(d, d.rootIds), new Set());
  assert.deepEqual(
    rows.map((r) => [r.key, r.depth, r.parent, r.index, r.dim]),
    [
      ["g", 0, null, 0, false],
      ["d", 1, "g", 0, true],
      ["c", 1, "g", 1, true],
      ["a", 0, null, 1, false],
    ]
  );
});

test("containerIds lists the foldable rows and skips empty containers", () => {
  const d = doc(
    [rect("a"), group("g", ["c", "h"]), rect("c"), group("h", ["e"]), rect("e"),
     group("empty", [])],
    ["a", "g", "empty"]
  );
  const display = tree.toDisplayTree(d, d.rootIds);
  assert.deepEqual(tree.containerIds(display), ["g", "h"]);
});

test("shapeIds counts the leaves under a container, not the container", () => {
  const display = tree.toDisplayTree(nested, ["g"]);
  assert.deepEqual(tree.shapeIds(display), ["d", "c"]);
});

// --- range selection -----------------------------------------------------

test("a range covers every row between the two endpoints, either direction", () => {
  const rows = order(nested);
  assert.deepEqual(tree.rangeIds(nested, rows, "d", "b"), ["d", "c", "b"]);
  assert.deepEqual(tree.rangeIds(nested, rows, "b", "d"), ["d", "c", "b"]);
});

test("a range that swallows a container collapses to the container", () => {
  const rows = order(nested);
  assert.deepEqual(tree.rangeIds(nested, rows, "g", "a"), ["g", "b", "a"]);
});

test("locked and hidden rows stay out of a range", () => {
  const d = doc(
    [rect("a"), rect("b", { locked: true }), rect("c", { hidden: true }), rect("e")],
    ["a", "b", "c", "e"]
  );
  const rows = order(d);
  assert.deepEqual(rows, ["e", "c", "b", "a"]);
  assert.deepEqual(tree.rangeIds(d, rows, "e", "a"), ["e", "a"]);
});

test("a row inside a hidden container stays out of a range", () => {
  const d = doc(
    [rect("a"), group("g", ["c"], { hidden: true }), rect("c")],
    ["a", "g"]
  );
  assert.deepEqual(tree.rangeIds(d, order(d), "g", "a"), ["a"]);
});

test("a range with an endpoint that is not a row is no range at all", () => {
  assert.equal(tree.rangeIds(nested, order(nested, ["g"]), "c", "a"), null);
});

// --- drop placement ------------------------------------------------------
//
// dropChildIndex maps a display slot (0 = above the front-most row) to an index
// in the canonical back-to-front child array, after the dragged rows have left.

test("dropping above every row lands at the front of the child array", () => {
  assert.equal(tree.dropChildIndex(["c", "b", "a"], ["x"], 0), 3);
});

test("dropping below every row lands at the back", () => {
  assert.equal(tree.dropChildIndex(["c", "b", "a"], ["x"], 3), 0);
});

test("rows moving inside their own container vacate their slots first", () => {
  // Display ["c","b","a"], dragging "c" down between "b" and "a" (slot 2).
  // "c" leaves first, so it lands between them: canonical ["a","c","b"].
  assert.equal(tree.dropChildIndex(["c", "b", "a"], ["c"], 2), 1);
});

test("a block of dragged rows counts every vacated slot above the drop", () => {
  // Display ["d","c","b","a"], dragging "d" and "c" to the bottom (slot 4).
  assert.equal(tree.dropChildIndex(["d", "c", "b", "a"], ["d", "c"], 4), 0);
});

test("a drop slot beyond the remaining rows is clamped", () => {
  assert.equal(tree.dropChildIndex(["b", "a"], ["b", "a"], 2), 0);
});
