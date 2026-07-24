import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let copySelectionToSystemClipboard;
let svgTextFromClipboard;
let isOwnCopy;

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
  ({ copySelectionToSystemClipboard, svgTextFromClipboard, isOwnCopy } =
    await server.ssrLoadModule("/src/io/systemClipboard.ts"));
});

after(async () => server.close());

test("copy writes tagged SVG that the same tab recognises as its own", async () => {
  await copySelectionToSystemClipboard(rectDoc(), ["rect"]);
  const svg = await writtenSvg();

  assert.match(svg, /^<svg /);
  assert.match(svg, /data-vinegar-copy="[a-z0-9]+"/);
  assert.ok(isOwnCopy(svg), "own copy should be recognised");
});

test("a foreign SVG is not mistaken for our own copy", async () => {
  await copySelectionToSystemClipboard(rectDoc(), ["rect"]);
  const foreign = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

  assert.equal(isOwnCopy(foreign), false);
});

test("only the most recent copy is recognised as own", async () => {
  const doc = rectDoc();
  await copySelectionToSystemClipboard(doc, ["rect"]);
  const first = await writtenSvg();
  await copySelectionToSystemClipboard(doc, ["rect"]);
  const second = await writtenSvg();

  assert.ok(isOwnCopy(second), "latest copy is own");
  assert.equal(isOwnCopy(first), false, "a superseded copy is no longer own");
});

test("copying nothing does not touch the system clipboard", async () => {
  written = undefined;
  await copySelectionToSystemClipboard(rectDoc(), []);

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
