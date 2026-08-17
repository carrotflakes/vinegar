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

// --- what a pointer over a row means -------------------------------------
//
// nested's rows, top to bottom: g(0) / d(1) / c(1) / a(0). `x` is the pointer's
// indent within the row, in the same units the rows are indented by.

const at = (opts) =>
  tree.dropTargetAt({
    rows: tree.flattenRows(
      tree.toDisplayTree(nested, nested.rootIds),
      new Set(opts.collapsed ?? [])
    ),
    collapsed: new Set(opts.collapsed ?? []),
    flat: opts.flat,
    ratio: opts.ratio,
    x: tree.ROW_PAD + (opts.indent ?? 0) * tree.ROW_INDENT,
    canDropInto: (id) => !(opts.reject ?? []).includes(id),
  });

test("the middle of a container row drops inside it, at the front", () => {
  assert.deepEqual(at({ flat: 0, ratio: 0.5, indent: 1 }), {
    parent: "g",
    index: 0,
    inside: "g",
    line: 1,
    depth: 1,
  });
});

test("an expanded container has no band below it — that gap is its child list", () => {
  assert.deepEqual(at({ flat: 0, ratio: 0.95, indent: 1 })?.inside, "g");
});

test("a collapsed container takes a drop beside it below its middle", () => {
  assert.deepEqual(at({ flat: 0, ratio: 0.95, collapsed: ["g"] }), {
    parent: null,
    index: 1,
    line: 1,
    depth: 0,
  });
});

test("the top half of a row drops into that row's own slot", () => {
  assert.deepEqual(at({ flat: 2, ratio: 0.2, indent: 1 }), {
    parent: "g",
    index: 1,
    line: 2,
    depth: 1,
  });
});

// The bug the indent used to have: the line at flat 3 sits on row "a", which is
// at depth 0, so reading the indent off that row drew it outside the group.
test("below a container's last child the indicator stays at the child's depth", () => {
  assert.deepEqual(at({ flat: 2, ratio: 0.8, indent: 1 }), {
    parent: "g",
    index: 2,
    line: 3,
    depth: 1,
  });
});

test("the same gap pulled left drops after the container instead", () => {
  assert.deepEqual(at({ flat: 2, ratio: 0.8, indent: 0 }), {
    parent: null,
    index: 1,
    line: 3,
    depth: 0,
  });
});

test("a level the drag may not enter falls back to a shallower one", () => {
  // Dragging "g" itself: the gap below its last child can only mean "after g".
  assert.deepEqual(at({ flat: 2, ratio: 0.8, indent: 1, reject: ["g"] }), {
    parent: null,
    index: 1,
    line: 3,
    depth: 0,
  });
});

test("a row that is not in the list is no drop target", () => {
  assert.equal(at({ flat: 9, ratio: 0.5 }), null);
});

// --- search --------------------------------------------------------------

const text = (id, body, patch = {}) => ({
  id,
  name: id,
  type: "text",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  text: body,
  textMode: "point",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  fontFamily: "Inter",
  fontSize: 12,
  fontWeight: 400,
  italic: false,
  ...patch,
});

/** The row order a query leaves behind, front-most first. */
const found = (d, query) => {
  const display = tree.toDisplayTree(d, d.rootIds);
  const kept = tree.filterTree(display, tree.searchMatcher(d, query));
  return tree.visibleIds(kept, new Set());
};

test("a search keeps the matches and the containers above them", () => {
  const d = doc(
    [rect("a"), rect("logo"), group("g", ["c", "d"]), rect("c"), rect("logo mark")],
    ["a", "logo", "g"]
  );
  d.nodes.g.childIds = ["c", "logo mark"];
  assert.deepEqual(found(d, "logo"), ["g", "logo mark", "logo"]);
});

test("a matching container keeps only its matching children", () => {
  // "logo" itself matches, but its subtree must not bury the other hits.
  const d = doc(
    [group("logo", ["c", "d"]), rect("c"), rect("d"), rect("logo tail")],
    ["logo", "logo tail"]
  );
  assert.deepEqual(found(d, "logo"), ["logo tail", "logo"]);
});

test("a kind keyword is matched from its start, so short queries stay tight", () => {
  const d = doc([rect("a"), group("g", ["c"]), rect("c")], ["a", "g"]);
  // "g" is inside "rectangle" but does not begin it: only the group answers.
  assert.deepEqual(found(d, "g"), ["g"]);
  assert.deepEqual(found(d, "rec"), ["g", "c", "a"]);
});

test("a search matches a node's kind, not just its name", () => {
  const d = doc([rect("a"), group("g", ["c"]), rect("c")], ["a", "g"]);
  assert.deepEqual(found(d, "rect"), ["g", "c", "a"]);
  assert.deepEqual(found(d, "group"), ["g"]);
});

test("a compound path answers to \"path\" as well as to its own kind", () => {
  const d = doc([rect("a"), rect("c")], ["a", "cp"]);
  d.nodes.cp = {
    id: "cp",
    name: "cp",
    type: "compoundPath",
    ...NODE_BASE,
    ...SHAPE_BASE,
    transform: [1, 0, 0, 1, 0, 0],
    childIds: [],
    fillRule: "nonzero",
  };
  assert.deepEqual(found(d, "path"), ["cp"]);
  assert.deepEqual(found(d, "compound"), ["cp"]);
});

test("a text shape answers to the string it draws", () => {
  const d = doc([rect("a"), text("t", "Hello world")], ["a", "t"]);
  assert.deepEqual(found(d, "hello"), ["t"]);
});

test("an instance answers to the name of its symbol", () => {
  const d = doc([rect("a"), rect("c")], ["a", "i"]);
  d.nodes.i = {
    id: "i",
    name: "i",
    type: "instance",
    ...NODE_BASE,
    transform: [1, 0, 0, 1, 0, 0],
    symbolId: "s1",
  };
  d.rootIds = ["a", "i"];
  d.symbols = { s1: { id: "s1", name: "Bolt", rootNodeId: "c" } };
  assert.deepEqual(found(d, "bolt"), ["i"]);
});

test("a blank query filters nothing out — the caller skips the filter", () => {
  const d = doc([rect("a"), rect("b")], ["a", "b"]);
  assert.deepEqual(found(d, "   "), []);
  assert.equal(tree.searchMatcher(d, "")(tree.toDisplayTree(d, ["a"])[0]), false);
});

test("matchRange points at the hit in a name, case-insensitively", () => {
  assert.deepEqual(tree.matchRange("Logo mark", "MARK"), [5, 9]);
  assert.equal(tree.matchRange("Logo mark", "circle"), null);
  assert.equal(tree.matchRange("Logo mark", " "), null);
});
