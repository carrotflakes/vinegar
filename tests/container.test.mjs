import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let encodeDocument;
let decodeDocument;
let isContainer;
let parseDocument;
let serializeDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ encodeDocument, decodeDocument, isContainer } = await server.ssrLoadModule(
    "/src/io/container.ts"
  ));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule(
    "/src/io/serialize.ts"
  ));
});

after(async () => {
  await server?.close();
});

/** The demo drawing: a real document with nodes, symbols and image assets. */
async function demoDocument() {
  return parseDocument(await readFile("src/demo/demo.vinegar.json", "utf8"));
}

test("a document survives an encode/decode round trip", async () => {
  const doc = await demoDocument();
  const decoded = await decodeDocument(await encodeDocument(doc));

  // `modifiedAt` is stamped by the writer, so compare everything else.
  assert.deepEqual(
    { ...decoded, metadata: { ...decoded.metadata, modifiedAt: "" } },
    { ...doc, metadata: { ...doc.metadata, modifiedAt: "" } }
  );
});

test("an empty document round trips too", async () => {
  const doc = createEmptyDocument();
  const decoded = await decodeDocument(await encodeDocument(doc));
  assert.deepEqual(decoded.rootIds, doc.rootIds);
  assert.deepEqual(decoded.nodes, doc.nodes);
});

test("the container is far smaller than the JSON form", async () => {
  const doc = await demoDocument();
  const bytes = await encodeDocument(doc);
  const json = new TextEncoder().encode(serializeDocument(doc)).length;
  assert.ok(
    bytes.length * 4 < json,
    `expected the container (${bytes.length}) to be well under a quarter of the JSON (${json})`
  );
});

test("a container is recognisable by its magic, and JSON text is not", async () => {
  const doc = createEmptyDocument();
  assert.equal(isContainer(await encodeDocument(doc)), true);
  assert.equal(
    isContainer(new TextEncoder().encode(serializeDocument(doc))),
    false
  );
  assert.equal(isContainer(new Uint8Array(3)), false);
});

test("base64 image assets ride outside the JSON body as raw bytes", async () => {
  const doc = createEmptyDocument();
  // 1×1 transparent GIF.
  const base64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const data = `data:image/gif;base64,${base64}`;
  const withAsset = {
    ...doc,
    assets: {
      asset_gif: {
        id: "asset_gif",
        kind: "image",
        mimeType: "image/gif",
        name: "dot.gif",
        source: { type: "data", data },
      },
    },
    nodes: {
      ...doc.nodes,
      ...imageNode(),
    },
    rootIds: [...doc.rootIds, "img"],
  };

  const bytes = await encodeDocument(withAsset);
  // The base64 text must not appear anywhere in the file: the body is deflated
  // and the payload itself is stored decoded.
  const asLatin1 = Buffer.from(bytes).toString("latin1");
  assert.equal(asLatin1.includes(base64), false);
  // ...but the decoded bytes do, GIF header and all.
  assert.equal(asLatin1.includes("GIF89a"), true);

  const decoded = await decodeDocument(bytes);
  assert.equal(decoded.assets.asset_gif.source.data, data);
});

test("a percent-encoded data URL survives byte for byte", async () => {
  const doc = createEmptyDocument();
  const data = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22x%22%2F%3E";
  const withAsset = {
    ...doc,
    assets: {
      asset_svg: {
        id: "asset_svg",
        kind: "image",
        mimeType: "image/svg+xml",
        name: null,
        source: { type: "data", data },
      },
    },
    nodes: { ...doc.nodes, ...imageNode("asset_svg") },
    rootIds: [...doc.rootIds, "img"],
  };
  const decoded = await decodeDocument(await encodeDocument(withAsset));
  assert.equal(decoded.assets.asset_svg.source.data, data);
});

test("a truncated or foreign file is rejected rather than half-loaded", async () => {
  const bytes = await encodeDocument(createEmptyDocument());
  await assert.rejects(
    () => decodeDocument(bytes.subarray(0, bytes.length - 4)),
    /truncated or corrupt/
  );
  await assert.rejects(
    () => decodeDocument(new TextEncoder().encode("{}")),
    /Not a Vinegar file/
  );

  const wrongVersion = bytes.slice();
  new DataView(wrongVersion.buffer).setUint16(4, 99, true);
  await assert.rejects(() => decodeDocument(wrongVersion), /container version/);
});

/** An image node referencing `assetId`, so the asset survives `usedAssets`. */
function imageNode(assetId = "asset_gif") {
  return {
    img: {
      id: "img",
      name: "Image",
      type: "image",
      transform: [1, 0, 0, 1, 0, 0],
      transformOrigin: null,
      opacity: 1,
      blendMode: "normal",
      effects: [],
      generator: null,
      bindings: {},
      hidden: false,
      locked: false,
      fill: null,
      stroke: null,
      strokeWidth: 1,
      strokeDash: [],
      strokeDashOffset: 0,
      strokeCap: "butt",
      strokeJoin: "miter",
      strokeAlignment: "center",
      assetId,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      lockAspect: true,
    },
  };
}
