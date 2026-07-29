import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let canGroupSelection;

const frame = (id, childIds = []) => ({
  id,
  name: id,
  type: "frame",
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  clipsContent: true,
  width: 100,
  height: 100,
  background: null,
  childIds,
});

const rect = (id) => ({
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
});

const doc = (nodes, rootIds) => ({
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  rootIds,
  symbols: {},
});

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ canGroupSelection } = await server.ssrLoadModule("/src/model/groups.ts"));
});

after(async () => server.close());

test("two siblings can be grouped", () => {
  const d = doc([rect("a"), rect("b")], ["a", "b"]);
  assert.equal(canGroupSelection(d, ["a", "b"]), true);
});

test("frames cannot be grouped — they are legal only at the top level", () => {
  const d = doc([frame("f1"), frame("f2")], ["f1", "f2"]);
  assert.equal(canGroupSelection(d, ["f1", "f2"]), false);
  const mixed = doc([frame("f1"), rect("a")], ["f1", "a"]);
  assert.equal(canGroupSelection(mixed, ["f1", "a"]), false);
});

test("nodes under different parents cannot be grouped", () => {
  const d = doc(
    [frame("f1", ["a"]), frame("f2", ["b"]), rect("a"), rect("b")],
    ["f1", "f2"]
  );
  assert.equal(canGroupSelection(d, ["a", "b"]), false);
});
