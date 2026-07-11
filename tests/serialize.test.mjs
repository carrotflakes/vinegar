import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let nodeWorldBounds;
let hitTestShape;
let parentIdOf;
let createDemoDocument;
let useEditor;
let nodeWorldMatrix;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ nodeWorldBounds } = await server.ssrLoadModule("/src/model/bounds.ts"));
  ({ hitTestShape } = await server.ssrLoadModule("/src/model/hitTest.ts"));
  ({ parentIdOf } = await server.ssrLoadModule("/src/model/scene.ts"));
  ({ createDemoDocument } = await server.ssrLoadModule("/src/demo/createDemoDocument.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ nodeWorldMatrix } = await server.ssrLoadModule("/src/model/matrix.ts"));
});

after(async () => server.close());

test("a nested v6 scene tree survives save/load and remains usable", () => {
  const doc = createEmptyDocument();
  doc.nodes.empty = {
    id: "empty", type: "group", name: "Empty", childIds: [], opacity: 1,
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  doc.nodes.outer = {
    id: "outer", type: "group", name: "Outer", childIds: ["rect", "inner"], opacity: 0.8,
    transform: [1, 0, 0, 1, 100, 50], transformOrigin: { x: 15, y: 25 },
  };
  doc.nodes.inner = {
    id: "inner", type: "group", name: "Inner", childIds: ["ellipse"], opacity: 1,
    transform: [1, 0, 0, 1, 10, 5], transformOrigin: null,
  };
  doc.nodes.rect = {
    id: "rect", type: "rect", name: "Rectangle",
    x: 10, y: 20, width: 30, height: 40,
    transform: [2, 0, 0, 2, 0, 0], transformOrigin: { x: 12, y: 22 },
    fill: "#123456", stroke: "#000000", strokeWidth: 2, opacity: 0.9,
  };
  doc.nodes.ellipse = {
    id: "ellipse", type: "ellipse", name: "Ellipse",
    x: 0, y: 0, width: 20, height: 10,
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
    fill: "#abcdef", stroke: null, strokeWidth: 0, opacity: 1,
  };
  doc.rootIds = ["empty", "outer"];
  doc.settings.gridSize = 24;

  const loaded = parseDocument(serializeDocument(doc));
  assert.deepEqual(loaded.rootIds, ["empty", "outer"]);
  assert.deepEqual(loaded.nodes.outer.childIds, ["rect", "inner"]);
  assert.deepEqual(loaded.nodes.empty.childIds, []);
  assert.equal(parentIdOf(loaded, "ellipse"), "inner");
  assert.deepEqual(nodeWorldBounds(loaded, "rect"), { x: 120, y: 90, width: 60, height: 80 });
  assert.deepEqual(nodeWorldBounds(loaded, "ellipse"), { x: 110, y: 55, width: 20, height: 10 });
  assert.equal(hitTestShape(loaded, loaded.nodes.ellipse, { x: 120, y: 60 }, 1), true);

  const malformed = JSON.parse(serializeDocument(doc));
  malformed.document.rootIds.push("rect");
  assert.throws(() => parseDocument(JSON.stringify(malformed)), /multiple parents/);
  malformed.version = 5;
  assert.throws(() => parseDocument(JSON.stringify(malformed)), /Unsupported/);

  const demo = parseDocument(serializeDocument(createDemoDocument()));
  assert.deepEqual(
    new Set(Object.values(demo.nodes).map((node) => node.type)),
    new Set(["group", "rect", "ellipse", "line", "path", "bezier", "polygon"])
  );
  assert.ok(Object.values(demo.nodes).some((node) => node.type === "group" && node.childIds.length === 0));

  const editor = useEditor.getState();
  editor.loadDocument(demo);
  const beforeMove = nodeWorldMatrix(demo, "demo_skew_rect");
  useEditor.getState().moveNode("demo_skew_rect", "demo_card_paths", 1);
  const moved = useEditor.getState().doc;
  assert.equal(parentIdOf(moved, "demo_skew_rect"), "demo_card_paths");
  nodeWorldMatrix(moved, "demo_skew_rect").forEach((value, i) =>
    assert.ok(Math.abs(value - beforeMove[i]) < 1e-9)
  );
  useEditor.getState().moveNode("demo_cards", "demo_card_paths", 0);
  assert.equal(parentIdOf(useEditor.getState().doc, "demo_cards"), null);
  useEditor.getState().undo();
  assert.equal(parentIdOf(useEditor.getState().doc, "demo_skew_rect"), "demo_card_shapes");
});
