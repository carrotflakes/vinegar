// moveNodes: the Layers panel drag reparenting several rows at once. One undo
// step, all-or-nothing validation, and world position preserved across the move.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let useEditor;

const group = (id, childIds = [], transform = [1, 0, 0, 1, 0, 0]) => ({
  id,
  name: id,
  type: "group",
  ...NODE_BASE,
  transform,
  childIds,
});

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

// The store exposes no direct document setter outside history, so fixtures go
// in as one interaction (exactly like a canvas drag does).
const install = (nodes, rootIds) => {
  const s = useEditor.getState();
  s.beginInteraction();
  s.setDoc({
    ...s.doc,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    rootIds,
  });
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

test("several roots move into a group in the given order", () => {
  install([rect("a"), rect("b"), group("g")], ["a", "b", "g"]);
  useEditor.getState().moveNodes(["a", "b"], "g", 0);
  assert.deepEqual(childIds("g"), ["a", "b"]);
  assert.deepEqual(childIds(null), ["g"]);
});

test("nodes from different containers gather into one target", () => {
  install(
    [group("g1", ["a"]), group("g2", ["b"]), group("g3"), rect("a"), rect("b")],
    ["g1", "g2", "g3"]
  );
  useEditor.getState().moveNodes(["a", "b"], "g3", 0);
  assert.deepEqual(childIds("g3"), ["a", "b"]);
  assert.deepEqual(childIds("g1"), []);
  assert.deepEqual(childIds("g2"), []);
});

test("a multi-node move is a single undo step", () => {
  install([rect("a"), rect("b"), group("g")], ["a", "b", "g"]);
  useEditor.getState().moveNodes(["a", "b"], "g", 0);
  useEditor.getState().undo();
  assert.deepEqual(childIds(null), ["a", "b", "g"]);
  assert.deepEqual(childIds("g"), []);
});

test("reordering inside a container skips the moved nodes' old slots", () => {
  install([group("g", ["a", "b", "c"]), rect("a"), rect("b"), rect("c")], ["g"]);
  // Move "a" (index 0) to the very back of its own container.
  useEditor.getState().moveNodes(["a"], "g", 2);
  assert.deepEqual(childIds("g"), ["b", "c", "a"]);
});

test("a move into a container keeps the node's world position", () => {
  install(
    [group("g", [], [1, 0, 0, 1, 40, 25]), rect("a")],
    ["a", "g"]
  );
  useEditor.getState().moveNodes(["a"], "g", 0);
  assert.deepEqual(useEditor.getState().doc.nodes.a.transform, [1, 0, 0, 1, -40, -25]);
});

test("nothing moves when one of the nodes cannot make the move", () => {
  install([frame("f"), rect("a"), group("g")], ["f", "a", "g"]);
  // Frames are legal only at the top level, so the whole move is refused.
  useEditor.getState().moveNodes(["a", "f"], "g", 0);
  assert.deepEqual(childIds("g"), []);
  assert.deepEqual(childIds(null), ["f", "a", "g"]);
});

test("a node cannot be moved into its own descendant", () => {
  install([group("g", ["inner"]), group("inner", ["a"]), rect("a")], ["g"]);
  useEditor.getState().moveNodes(["g"], "inner", 0);
  assert.deepEqual(childIds(null), ["g"]);
  assert.deepEqual(childIds("inner"), ["a"]);
});

test("moveNode still works and is the single-node case", () => {
  install([rect("a"), group("g")], ["a", "g"]);
  useEditor.getState().moveNode("a", "g", 0);
  assert.deepEqual(childIds("g"), ["a"]);
});
