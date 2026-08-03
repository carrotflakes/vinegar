import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let applyDocumentPatches;
let createEmptyDocument;
let diffDocument;
let documentsEqual;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ applyDocumentPatches, diffDocument, documentsEqual } = await server.ssrLoadModule("/src/store/documentPatches.ts"));
});

after(async () => server.close());

const rect = (id, x = 0) => ({
  id,
  name: id,
  type: "rect",
  ...SHAPE_BASE, cornerRadius: 0,
  ...NODE_BASE,
  x,
  y: 0,
  width: 20,
  height: 10,
  fill: { type: "solid", color: "#111111", alpha: 1 },
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
});

test("document patches round-trip every top-level collection", () => {
  const before = createEmptyDocument();
  const keptNode = rect("kept");
  const removedNode = rect("removed");
  const keptAsset = { id: "asset-kept", kind: "image", mimeType: "image/png", source: { type: "data", data: "large-unchanged-payload" } };
  const removedAsset = { id: "asset-removed", kind: "image", mimeType: "image/png", source: { type: "data", data: "removed" } };
  before.nodes = { kept: keptNode, removed: removedNode };
  before.rootIds = ["kept", "removed"];
  before.symbols = { old: { id: "old", name: "Old", rootNodeId: "kept", params: [] } };
  before.assets = { [keptAsset.id]: keptAsset, [removedAsset.id]: removedAsset };
  before.extensions = { kept: { value: 1 }, removed: true };

  const updatedNode = rect("kept", 40);
  const addedNode = rect("added", 80);
  const addedAsset = { id: "asset-added", kind: "image", mimeType: "image/png", source: { type: "data", data: "added" } };
  const after = {
    ...before,
    nodes: { kept: updatedNode, added: addedNode },
    rootIds: ["added", "kept"],
    symbols: { fresh: { id: "fresh", name: "Fresh", rootNodeId: "added", params: [] } },
    settings: { ...before.settings, gridSize: 25 },
    metadata: { ...before.metadata, modifiedAt: "2030-01-01T00:00:00.000Z" },
    assets: { [keptAsset.id]: keptAsset, [addedAsset.id]: addedAsset },
    extensions: { kept: before.extensions.kept, added: { value: 2 } },
  };

  const { patches, inversePatches } = diffDocument(before, after);
  assert.ok(patches.length);
  assert.equal(JSON.stringify({ patches, inversePatches }).includes("large-unchanged-payload"), false);

  const applied = applyDocumentPatches(before, patches);
  assert.deepEqual(applied, after);
  assert.equal(applied.assets[keptAsset.id], keptAsset);

  const restored = applyDocumentPatches(applied, inversePatches);
  assert.deepEqual(restored, before);
  assert.equal(restored.nodes.kept, keptNode);
  assert.equal(restored.assets[keptAsset.id], keptAsset);
});

test("equal documents produce no patches", () => {
  const doc = createEmptyDocument();
  assert.deepEqual(diffDocument(doc, doc), { patches: [], inversePatches: [] });
  assert.equal(applyDocumentPatches(doc, []), doc);
  assert.equal(documentsEqual(doc, structuredClone(doc)), true);
});

test("large array patches do not depend on variadic splice arguments", () => {
  const before = createEmptyDocument();
  const after = { ...before, rootIds: Array.from({ length: 200_000 }, (_, i) => `node-${i}`) };
  const { patches, inversePatches } = diffDocument(before, after);

  const applied = applyDocumentPatches(before, patches);
  assert.deepEqual(applied.rootIds, after.rootIds);
  assert.deepEqual(applyDocumentPatches(applied, inversePatches).rootIds, []);
});
