import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let copySelectionToSystemClipboard;
let svgTextFromClipboard;
let isOwnCopy;
let payloadFromSvg;
let copyPayload;
let useEditor;
let unionNodeWorldBounds;

// Captures the ClipboardItem array handed to navigator.clipboard.write.
let written;

async function writtenSvg() {
  return await written[0].items["text/plain"].text();
}

function rectDoc() {
  const doc = createEmptyDocument();
  doc.nodes.rect = {
    id: "rect",
    name: "R",
    type: "rect",
    ...SHAPE_BASE, cornerRadius: 0,
    ...NODE_BASE,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    fill: null,
    stroke: null,
    strokeWidth: 0,
  };
  doc.rootIds = ["rect"];
  return doc;
}

before(async () => {
  // Stub the browser Clipboard API the module writes through.
  globalThis.ClipboardItem = class {
    constructor(items) {
      this.items = items;
    }
  };
  const nav = { clipboard: { write: async (items) => { written = items; } } };
  Object.defineProperty(globalThis, "navigator", {
    value: nav,
    configurable: true,
    writable: true,
  });

  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ copySelectionToSystemClipboard, svgTextFromClipboard, isOwnCopy, payloadFromSvg } =
    await server.ssrLoadModule("/src/io/systemClipboard.ts"));
  ({ copyPayload } = await server.ssrLoadModule("/src/store/docOps.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ unionNodeWorldBounds } = await server.ssrLoadModule("/src/model/geometry/bounds.ts"));
});

after(async () => server.close());

/** Copy a selection the way the store does: snapshot a payload, then mirror it. */
const copySelection = (doc, ids) =>
  copySelectionToSystemClipboard(doc, copyPayload(doc, ids));

test("copy writes tagged SVG that the same tab recognises as its own", async () => {
  await copySelection(rectDoc(), ["rect"]);
  const svg = await writtenSvg();

  assert.match(svg, /^<svg /);
  assert.match(svg, /data-vinegar-copy="[a-z0-9]+"/);
  assert.ok(isOwnCopy(svg), "own copy should be recognised");
});

test("a foreign SVG is not mistaken for our own copy", async () => {
  await copySelection(rectDoc(), ["rect"]);
  const foreign = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

  assert.equal(isOwnCopy(foreign), false);
});

test("only the most recent copy is recognised as own", async () => {
  const doc = rectDoc();
  await copySelection(doc, ["rect"]);
  const first = await writtenSvg();
  await copySelection(doc, ["rect"]);
  const second = await writtenSvg();

  assert.ok(isOwnCopy(second), "latest copy is own");
  assert.equal(isOwnCopy(first), false, "a superseded copy is no longer own");
});

test("copying nothing does not touch the system clipboard", async () => {
  written = undefined;
  const doc = rectDoc();
  await copySelectionToSystemClipboard(doc, { nodes: {}, rootIds: [], scripts: {}, assets: {}, vars: {}, scriptsTrusted: true });

  assert.equal(written, undefined);
});

test("svgTextFromClipboard extracts SVG and ignores non-SVG text", () => {
  const data = (map) => ({ getData: (type) => map[type] ?? "" });
  const svg = "<svg><rect/></svg>";

  assert.equal(svgTextFromClipboard(data({ "text/plain": svg })), svg);
  assert.equal(svgTextFromClipboard(data({ "image/svg+xml": svg })), svg);
  assert.equal(svgTextFromClipboard(data({ "text/plain": "hello world" })), null);
  assert.equal(svgTextFromClipboard(null), null);
});

// A 1×1 transparent PNG — enough to be a real asset without any decoding.
const PNG_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const SCRIPT_SOURCE = "return { params: [], build: () => [] };";

/** A document whose single path is generator-driven and variable-filled. */
function generatorDoc() {
  const doc = rectDoc();
  doc.scripts.poly = { id: "poly", name: "Poly", source: SCRIPT_SOURCE };
  doc.vars.brand = {
    id: "brand",
    name: "Brand",
    value: { kind: "paint", value: { type: "solid", color: "#ff0000", alpha: 1 } },
  };
  doc.varOrder = ["brand"];
  doc.nodes.gen = {
    ...NODE_BASE,
    ...SHAPE_BASE,
    id: "gen",
    name: "Gen",
    type: "path",
    transform: [1, 0, 0, 1, 0, 0],
    fillRule: "nonzero",
    fill: { type: "var", varId: "brand", alpha: 1 },
    subpaths: [
      {
        closed: true,
        anchors: [
          { p: { x: 0, y: 0 }, hIn: null, hOut: null },
          { p: { x: 20, y: 0 }, hIn: null, hOut: null },
          { p: { x: 20, y: 20 }, hIn: null, hOut: null },
        ],
      },
    ],
    generator: { scriptId: "poly", args: { sides: 3 } },
  };
  doc.rootIds = ["gen"];
  return doc;
}

test("the copied SVG embeds a payload another tab can restore", async () => {
  const doc = generatorDoc();
  await copySelection(doc, ["gen"]);
  const svg = await writtenSvg();

  // The payload rides inside <metadata>, leaving the SVG itself importable.
  assert.match(svg, /<metadata data-vinegar-payload="[A-Za-z0-9+/=]+"><\/metadata>/);

  const payload = payloadFromSvg(svg);
  assert.deepEqual(payload.rootIds, ["gen"]);
  assert.equal(payload.nodes.gen.generator.scriptId, "poly");
  assert.deepEqual(payload.nodes.gen.generator.args, { sides: 3 });
  assert.equal(payload.scripts.poly.source, SCRIPT_SOURCE);
  assert.equal(payload.vars.brand.name, "Brand");
  // Code from outside this tab is never trusted, whatever the copy claimed.
  assert.equal(payload.scriptsTrusted, false);
});

test("an image copy carries its asset through the system clipboard", async () => {
  const doc = rectDoc();
  doc.assets.pic = {
    id: "pic",
    kind: "image",
    mimeType: "image/png",
    name: "pic.png",
    source: { type: "data", data: PNG_DATA },
  };
  doc.nodes.img = {
    ...NODE_BASE,
    ...SHAPE_BASE,
    id: "img",
    name: "Image",
    type: "image",
    assetId: "pic",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    lockAspect: true,
    transform: [1, 0, 0, 1, 0, 0],
  };
  doc.rootIds = ["img"];

  await copySelection(doc, ["img"]);
  const payload = payloadFromSvg(await writtenSvg());
  assert.equal(payload.assets.pic.source.data, PNG_DATA);
});

test("foreign SVG carries no payload", () => {
  assert.equal(payloadFromSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), null);
  // A tampered/garbage payload is rejected rather than half-applied.
  assert.equal(payloadFromSvg('<svg><metadata data-vinegar-payload="Zm9v"></metadata></svg>'), null);
});

test("another tab's payload pastes with its generator link, script and variable", async () => {
  await copySelection(generatorDoc(), ["gen"]);
  const payload = payloadFromSvg(await writtenSvg());

  // A different document — as if this were a second tab.
  useEditor.getState().loadDocument(createEmptyDocument());
  assert.equal(useEditor.getState().pastePayload(payload), true);

  const state = useEditor.getState();
  const pasted = state.doc.nodes[state.selection[0]];
  assert.equal(pasted.generator.scriptId, "poly");
  assert.deepEqual(pasted.generator.args, { sides: 3 });
  assert.equal(state.doc.scripts.poly.source, SCRIPT_SOURCE);
  assert.equal(state.doc.vars.brand.name, "Brand");
  assert.deepEqual(state.doc.varOrder, ["brand"]);
  // Scripts that arrived from outside await consent before they can run.
  assert.equal(state.scriptsTrusted, false);
});

test("a payload this document cannot take is refused, not half-applied", async () => {
  // Symbol definitions are not merged yet: an instance needs the symbol here.
  const doc = rectDoc();
  doc.nodes.sroot = {
    ...NODE_BASE,
    id: "sroot",
    name: "Symbol",
    type: "group",
    childIds: ["rect"],
    clipsToMask: false,
    transform: [1, 0, 0, 1, 0, 0],
  };
  doc.symbols.s1 = { id: "s1", name: "Sym", rootNodeId: "sroot", params: [] };
  doc.nodes.inst = {
    ...NODE_BASE,
    id: "inst",
    name: "Instance",
    type: "instance",
    args: {},
    symbolId: "s1",
    transform: [1, 0, 0, 1, 0, 0],
  };
  doc.rootIds = ["inst"];

  await copySelection(doc, ["inst"]);
  const payload = payloadFromSvg(await writtenSvg());
  useEditor.getState().loadDocument(createEmptyDocument());
  assert.equal(useEditor.getState().pastePayload(payload), false);
  assert.deepEqual(useEditor.getState().doc.rootIds, []);
});

test("an image payload without its asset is refused", () => {
  const doc = rectDoc();
  doc.nodes.img = {
    ...NODE_BASE,
    ...SHAPE_BASE,
    id: "img",
    name: "Image",
    type: "image",
    assetId: "pic",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    lockAspect: true,
    transform: [1, 0, 0, 1, 0, 0],
  };
  doc.rootIds = ["img"];
  const payload = copyPayload(doc, ["img"]); // the document has no such asset

  useEditor.getState().loadDocument(createEmptyDocument());
  assert.equal(useEditor.getState().pastePayload(payload), false);
  assert.deepEqual(useEditor.getState().doc.rootIds, []);
});

test("a payload pasted at a point is centered there, wherever it came from", async () => {
  // Art copied far from this document's origin: App pastes a foreign payload
  // at the viewport center so it can never land off-screen.
  const doc = generatorDoc();
  doc.nodes.gen.transform = [1, 0, 0, 1, 5000, 3000];
  await copySelection(doc, ["gen"]);
  const payload = payloadFromSvg(await writtenSvg());

  useEditor.getState().loadDocument(createEmptyDocument());
  assert.equal(useEditor.getState().pastePayload(payload, { x: 40, y: 60 }), true);

  const state = useEditor.getState();
  const bounds = unionNodeWorldBounds(state.doc, state.selection);
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - 40) < 1e-6);
  assert.ok(Math.abs(bounds.y + bounds.height / 2 - 60) < 1e-6);
});
