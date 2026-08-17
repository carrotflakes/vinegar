import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let containerContents;
let containerChildIds;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ containerContents, containerChildIds } = await server.ssrLoadModule(
    "/src/model/sceneWalk.ts"
  ));
});

after(async () => server.close());

const rect = (id, extra = {}) => ({
  ...NODE_BASE,
  ...SHAPE_BASE,
  id,
  name: id,
  type: "rect",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  cornerRadius: 0,
  transform: [1, 0, 0, 1, 0, 0],
  ...extra,
});

const group = (id, childIds, extra = {}) => ({
  ...NODE_BASE,
  id,
  name: id,
  type: "group",
  childIds,
  clipsToMask: false,
  transform: [1, 0, 0, 1, 0, 0],
  ...extra,
});

const frame = (id, childIds, extra = {}) => ({
  ...NODE_BASE,
  id,
  name: id,
  type: "frame",
  childIds,
  width: 100,
  height: 100,
  background: null,
  clipsContent: false,
  transform: [1, 0, 0, 1, 0, 0],
  ...extra,
});

test("a shape has nothing to descend into", () => {
  const doc = createEmptyDocument();
  const node = rect("r");
  doc.nodes = { r: node };
  doc.rootIds = ["r"];
  assert.equal(containerContents(doc, node), null);
  assert.deepEqual(containerChildIds(doc, node), []);
});

test("a plain group expands to its children", () => {
  const doc = createEmptyDocument();
  const g = group("g", ["a", "b"]);
  doc.nodes = { g, a: rect("a"), b: rect("b") };
  doc.rootIds = ["g"];
  const contents = containerContents(doc, g);
  assert.equal(contents.kind, "group");
  assert.deepEqual(contents.childIds, ["a", "b"]);
  assert.equal(contents.mask, null);
});

test("a clipping group keeps its mask out of the painted children", () => {
  const doc = createEmptyDocument();
  // The topmost child is the mask; the rest is the clipped content.
  const g = group("g", ["content", "mask"], { clipsToMask: true });
  doc.nodes = { g, content: rect("content"), mask: rect("mask") };
  doc.rootIds = ["g"];
  const contents = containerContents(doc, g);
  assert.equal(contents.kind, "group");
  assert.equal(contents.mask?.id, "mask");
  assert.deepEqual(
    contents.childIds,
    ["content"],
    "the mask confines its siblings and must not be painted with them"
  );
});

test("a frame expands to its children and carries itself for its box", () => {
  const doc = createEmptyDocument();
  const f = frame("f", ["r"], { clipsContent: true, background: "#123456" });
  doc.nodes = { f, r: rect("r") };
  doc.rootIds = ["f"];
  const contents = containerContents(doc, f);
  assert.equal(contents.kind, "frame");
  assert.deepEqual(contents.childIds, ["r"]);
  assert.equal(contents.frame.clipsContent, true);
  assert.equal(contents.frame.background, "#123456");
});

test("an instance expands to its definition root", () => {
  const doc = createEmptyDocument();
  const instance = {
    ...NODE_BASE,
    id: "i",
    name: "i",
    type: "instance",
    symbolId: "s",
    transform: [1, 0, 0, 1, 0, 0],
  };
  doc.nodes = { i: instance, root: group("root", ["r"]), r: rect("r") };
  doc.symbols = { s: { id: "s", name: "S", rootNodeId: "root" } };
  doc.rootIds = ["i"];
  const contents = containerContents(doc, instance);
  assert.equal(contents.kind, "instance");
  assert.deepEqual(contents.childIds, ["root"]);
  assert.equal(contents.symbolId, "s");

  // A symbol already being expanded is a cycle: stop rather than recurse.
  assert.equal(containerContents(doc, instance, new Set(["s"])), null);
  // A dangling reference is not a container either.
  doc.symbols = {};
  assert.equal(containerContents(doc, instance), null);
});

test("every non-shape node type is a container the walkers can descend", () => {
  // Guards the failure this module exists to prevent: the SVG exporter used to
  // fall through on frames and silently dropped every framed node. A new
  // container type must be handled here, not discovered by a reader dropping it.
  const doc = createEmptyDocument();
  doc.symbols = { s: { id: "s", name: "S", rootNodeId: "g" } };
  const nodes = [
    group("g", []),
    frame("f", []),
    {
      ...NODE_BASE,
      id: "i",
      name: "i",
      type: "instance",
      symbolId: "s",
      transform: [1, 0, 0, 1, 0, 0],
    },
  ];
  doc.nodes = Object.fromEntries(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    assert.notEqual(
      containerContents(doc, node),
      null,
      `${node.type} must be descended into, not dropped`
    );
  }
});
