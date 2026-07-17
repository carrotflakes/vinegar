import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let useEditor;
let assetReferenceCounts;
let referencedAssetIds;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ assetReferenceCounts, referencedAssetIds } = await server.ssrLoadModule(
    "/src/model/scene.ts"
  ));
});

after(async () => {
  await server.close();
});

const IDENTITY = [1, 0, 0, 1, 0, 0];

const asset = (id) => ({
  id,
  kind: "image",
  mimeType: "image/png",
  source: { type: "data", data: "data:image/png;base64,AAAA" },
});

const imageShape = (id, assetId) => ({
  id,
  name: id,
  type: "image",
  assetId,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  transform: [...IDENTITY],
  opacity: 1,
});

function docWith(nodes, assets) {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    rootIds: nodes.map((n) => n.id),
    symbols: {},
    artboards: [],
    settings: { unit: "px", dpi: 96, gridSize: 50 },
    metadata: { createdAt: "2020-01-01", modifiedAt: "2020-01-01" },
    assets: Object.fromEntries(assets.map((a) => [a.id, a])),
    extensions: {},
  };
}

test("assetReferenceCounts counts image nodes and matches referencedAssetIds", () => {
  const doc = docWith(
    [imageShape("i1", "a1"), imageShape("i2", "a1")],
    [asset("a1"), asset("a2")]
  );
  const counts = assetReferenceCounts(doc);
  assert.equal(counts.get("a1"), 2);
  assert.equal(counts.has("a2"), false);
  assert.deepEqual([...referencedAssetIds(doc)].sort(), [...counts.keys()].sort());
});

test("deleteUnusedAssets drops orphans, keeps referenced, and is undoable", () => {
  const doc = docWith([imageShape("i1", "a1")], [asset("a1"), asset("a2")]);
  useEditor.getState().loadDocument(doc);

  const removed = useEditor.getState().deleteUnusedAssets();
  assert.equal(removed, 1);
  const after = useEditor.getState().doc.assets;
  assert.ok(after.a1, "referenced asset kept");
  assert.equal(after.a2, undefined, "orphan removed");

  useEditor.getState().undo();
  assert.ok(useEditor.getState().doc.assets.a2, "undo restores the orphan");
});

test("deleteAsset refuses a referenced asset but removes an orphan", () => {
  const doc = docWith([imageShape("i1", "a1")], [asset("a1"), asset("a2")]);
  useEditor.getState().loadDocument(doc);

  useEditor.getState().deleteAsset("a1");
  assert.ok(useEditor.getState().doc.assets.a1, "referenced asset is not deleted");

  useEditor.getState().deleteAsset("a2");
  assert.equal(useEditor.getState().doc.assets.a2, undefined, "orphan deleted");
});
