import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let useEditor;
let currentSymbolScope;
let nodeWorldBounds;
let instanceWorldBounds;
let symbolContentBounds;
let hitTestNode;
let scopeLeafIds;
let parentIdOf;
let isInstance;
let serializeDocument;
let parseDocument;
let exportSvg;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor, currentSymbolScope } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ nodeWorldBounds, instanceWorldBounds, symbolContentBounds } =
    await server.ssrLoadModule("/src/model/bounds.ts"));
  ({ hitTestNode } = await server.ssrLoadModule("/src/model/hitTest.ts"));
  ({ scopeLeafIds, parentIdOf, isInstance } = await server.ssrLoadModule("/src/model/scene.ts"));
  ({ serializeDocument, parseDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
});

after(async () => {
  await server.close();
});

const IDENTITY = [1, 0, 0, 1, 0, 0];

const rect = (id, x, y, width, height) => ({
  id,
  name: id,
  type: "rect",
  x,
  y,
  width,
  height,
  fill: "#ff0000",
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  transform: [...IDENTITY],
  transformOrigin: null,
});

function makeSymbolFromTwoRects() {
  const s = useEditor.getState();
  s.newDocument();
  s.addShape(rect("r1", 10, 10, 30, 20));
  s.addShape(rect("r2", 50, 10, 10, 10));
  useEditor.getState().setSelection(["r1", "r2"]);
  useEditor.getState().createSymbolFromSelection();
  const state = useEditor.getState();
  const instanceId = state.doc.rootIds[0];
  const symbolId = Object.keys(state.doc.symbols)[0];
  return { instanceId, symbolId };
}

test("create symbol replaces the selection with an equivalent instance", () => {
  const { instanceId, symbolId } = makeSymbolFromTwoRects();
  const state = useEditor.getState();
  const doc = state.doc;

  assert.equal(doc.rootIds.length, 1);
  assert.equal(doc.nodes[instanceId].type, "instance");
  assert.equal(doc.nodes[instanceId].symbolId, symbolId);
  assert.equal(Object.keys(doc.symbols).length, 1);

  // The drawing is visually unchanged: instance bounds equal the old union.
  const bounds = nodeWorldBounds(doc, instanceId);
  assert.deepEqual(bounds, { x: 10, y: 10, width: 50, height: 20 });

  // Members moved under the definition root, outside the scene roots.
  const defRoot = doc.symbols[symbolId].rootNodeId;
  assert.equal(parentIdOf(doc, "r1"), defRoot);
  assert.deepEqual(scopeLeafIds(doc, null), [instanceId]);
  assert.deepEqual(scopeLeafIds(doc, symbolId), ["r1", "r2"]);

  // The instance hit-tests through its content, holes excluded.
  assert.ok(hitTestNode(doc, doc.nodes[instanceId], { x: 15, y: 15 }, 1));
  assert.ok(!hitTestNode(doc, doc.nodes[instanceId], { x: 45, y: 15 }, 1));

  // Undo restores the pre-symbol document.
  useEditor.getState().undo();
  const prev = useEditor.getState().doc;
  assert.deepEqual(prev.rootIds, ["r1", "r2"]);
  assert.equal(Object.keys(prev.symbols).length, 0);
  useEditor.getState().redo();
});

test("editing a symbol updates every instance and scopes new shapes", () => {
  const { instanceId, symbolId } = makeSymbolFromTwoRects();
  let s = useEditor.getState();

  // A second instance placed at a point is centred on it.
  s.placeSymbolInstance(symbolId, { x: 200, y: 200 });
  s = useEditor.getState();
  const secondId = s.selection[0];
  assert.notEqual(secondId, instanceId);
  const placed = nodeWorldBounds(s.doc, secondId);
  assert.equal(placed.x + placed.width / 2, 200);
  assert.equal(placed.y + placed.height / 2, 200);

  // Local view: new shapes land inside the definition, not the scene.
  s.enterSymbolEdit(symbolId);
  assert.equal(currentSymbolScope(useEditor.getState()), symbolId);
  useEditor.getState().addShape(rect("r3", 0, 0, 5, 5));
  s = useEditor.getState();
  const defRoot = s.doc.symbols[symbolId].rootNodeId;
  assert.equal(parentIdOf(s.doc, "r3"), defRoot);
  assert.equal(s.doc.rootIds.includes("r3"), false);

  // Both instances now include the new shape (content grew to x=0).
  assert.equal(symbolContentBounds(s.doc, symbolId).x, 0);
  assert.equal(nodeWorldBounds(s.doc, instanceId).x, 0);

  // Placing a symbol inside its own definition is refused (cycle).
  const nodeCount = Object.keys(s.doc.nodes).length;
  s.placeSymbolInstance(symbolId);
  assert.equal(Object.keys(useEditor.getState().doc.nodes).length, nodeCount);

  useEditor.getState().exitSymbolEdit();
  assert.equal(currentSymbolScope(useEditor.getState()), null);
});

test("detach expands an instance into an equivalent group", () => {
  const { instanceId, symbolId } = makeSymbolFromTwoRects();
  let s = useEditor.getState();
  const before = nodeWorldBounds(s.doc, instanceId);

  s.setSelection([instanceId]);
  useEditor.getState().detachSelectedInstances();
  s = useEditor.getState();

  const groupId = s.selection[0];
  assert.equal(s.doc.nodes[groupId].type, "group");
  assert.equal(s.doc.nodes[instanceId], undefined);
  assert.deepEqual(nodeWorldBounds(s.doc, groupId), before);
  // The definition itself is untouched.
  assert.equal(Object.keys(s.doc.symbols).length, 1);

  // With no instances left the symbol can be deleted; its nodes go with it.
  const defRoot = s.doc.symbols[symbolId].rootNodeId;
  useEditor.getState().deleteSymbol(symbolId);
  s = useEditor.getState();
  assert.equal(Object.keys(s.doc.symbols).length, 0);
  assert.equal(s.doc.nodes[defRoot], undefined);
});

test("delete symbol is refused while instances exist", () => {
  const { instanceId, symbolId } = makeSymbolFromTwoRects();
  useEditor.getState().deleteSymbol(symbolId);
  let s = useEditor.getState();
  assert.equal(Object.keys(s.doc.symbols).length, 1);

  s.setSelection([instanceId]);
  useEditor.getState().deleteSelected();
  useEditor.getState().deleteSymbol(symbolId);
  s = useEditor.getState();
  assert.equal(Object.keys(s.doc.symbols).length, 0);
});

test("documents with symbols survive save/load; broken refs are rejected", () => {
  makeSymbolFromTwoRects();
  const doc = useEditor.getState().doc;

  const restored = parseDocument(serializeDocument(doc));
  assert.deepEqual(restored.symbols, doc.symbols);
  assert.deepEqual(restored.rootIds, doc.rootIds);
  assert.deepEqual(restored.nodes, doc.nodes);

  // An instance pointing at a missing symbol must not load.
  const broken = structuredClone(doc);
  broken.symbols = {};
  const brokenText = serializeDocument(broken);
  assert.throws(() => parseDocument(brokenText), /missing symbol|unreachable/i);
});

test("SVG export expands instances inline", () => {
  makeSymbolFromTwoRects();
  const doc = useEditor.getState().doc;
  const svg = exportSvg(doc);
  // Two rects from the definition content, painted through the instance.
  assert.equal((svg.match(/<rect /g) ?? []).length, 2);
});
