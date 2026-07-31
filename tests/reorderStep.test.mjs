// raiseSelected / lowerSelected: the Layers panel's Alt+Arrow one-slot reorder.
// `childIds` is canonical back-to-front, so "raise" (toward the front) walks a
// node toward the end of the array. A contiguous block moves together and stops
// at the container edge, and nodes in different parents each reorder in place as
// a single undo step.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let useEditor;

const group = (id, childIds = []) => ({
  id,
  name: id,
  type: "group",
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
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
  cornerRadius: 0,
});

const install = (nodes, rootIds) => {
  const s = useEditor.getState();
  s.beginInteraction();
  s.setDoc({ ...s.doc, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds });
  s.endInteraction();
};

const childIds = (id) =>
  id === null ? useEditor.getState().doc.rootIds : useEditor.getState().doc.nodes[id].childIds;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

beforeEach(() => useEditor.getState().newDocument());

after(async () => server.close());

test("raise moves the selection one slot toward the front", () => {
  install([rect("a"), rect("b"), rect("c")], ["a", "b", "c"]);
  useEditor.getState().setSelection(["a"]);
  useEditor.getState().raiseSelected();
  assert.deepEqual(childIds(null), ["b", "a", "c"]);
});

test("lower moves the selection one slot toward the back", () => {
  install([rect("a"), rect("b"), rect("c")], ["a", "b", "c"]);
  useEditor.getState().setSelection(["b"]);
  useEditor.getState().lowerSelected();
  assert.deepEqual(childIds(null), ["b", "a", "c"]);
});

test("a contiguous block moves together", () => {
  install([rect("a"), rect("b"), rect("c")], ["a", "b", "c"]);
  useEditor.getState().setSelection(["a", "b"]);
  useEditor.getState().raiseSelected();
  assert.deepEqual(childIds(null), ["c", "a", "b"]);
});

test("raise is a no-op at the front edge", () => {
  install([rect("a"), rect("b"), rect("c")], ["a", "b", "c"]);
  useEditor.getState().setSelection(["b", "c"]);
  useEditor.getState().raiseSelected();
  assert.deepEqual(childIds(null), ["a", "b", "c"]);
});

test("nodes in different parents each reorder in place, one undo step", () => {
  install(
    [group("g1", ["a", "b"]), group("g2", ["c", "d"]), rect("a"), rect("b"), rect("c"), rect("d")],
    ["g1", "g2"]
  );
  useEditor.getState().setSelection(["a", "c"]);
  useEditor.getState().raiseSelected();
  assert.deepEqual(childIds("g1"), ["b", "a"]);
  assert.deepEqual(childIds("g2"), ["d", "c"]);
  useEditor.getState().undo();
  assert.deepEqual(childIds("g1"), ["a", "b"]);
  assert.deepEqual(childIds("g2"), ["c", "d"]);
});
