import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";

let server;
let canReadSystemClipboard;
let readSystemClipboard;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ canReadSystemClipboard, readSystemClipboard } = await server.ssrLoadModule(
    "/src/commands/pasteClipboard.ts"
  ));
});

after(async () => {
  await server.close();
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
});

const originalNavigator = globalThis.navigator;

/** Stand in for the async clipboard with one item carrying the given types. */
function stubClipboard(entries) {
  const items = entries.map((types) => ({
    types: Object.keys(types),
    getType: async (type) => {
      const value = types[type];
      if (value == null) throw new Error("unavailable");
      return new Blob([value], { type });
    },
  }));
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { read: async () => items } },
    configurable: true,
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
});

test("no async clipboard means no read", async () => {
  assert.equal(canReadSystemClipboard(), false);
  assert.equal(await readSystemClipboard(), null);
});

test("a raster image comes back as a named File", async () => {
  stubClipboard([{ "image/png": "\x89PNG" }]);
  assert.equal(canReadSystemClipboard(), true);
  const content = await readSystemClipboard();
  assert.equal(content.images.length, 1);
  assert.equal(content.images[0].name, "pasted.png");
  assert.equal(content.images[0].type, "image/png");
  assert.equal(content.svg, null);
});

test("an item offered in several flavours lands once, in the preferred one", async () => {
  stubClipboard([{ "image/tiff": "II*", "image/png": "\x89PNG" }]);
  const content = await readSystemClipboard();
  assert.equal(content.images.length, 1);
  assert.equal(content.images[0].type, "image/png");
});

test("an unretrievable flavour falls through to the next", async () => {
  stubClipboard([{ "image/png": null, "image/jpeg": "\xFF\xD8" }]);
  const content = await readSystemClipboard();
  assert.equal(content.images.length, 1);
  assert.equal(content.images[0].type, "image/jpeg");
});

test("SVG stays vector art rather than becoming an image file", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  stubClipboard([{ "image/svg+xml": svg, "text/plain": svg }]);
  const content = await readSystemClipboard();
  assert.deepEqual(content.images, []);
  assert.equal(content.svg, svg);
});

test("plain text that is not SVG yields nothing to paste", async () => {
  stubClipboard([{ "text/plain": "just words" }]);
  const content = await readSystemClipboard();
  assert.deepEqual(content.images, []);
  assert.equal(content.svg, null);
  assert.equal(content.unusableFile, false);
});

test("an image type we cannot retrieve is reported as unusable", async () => {
  stubClipboard([{ "image/heic": null }]);
  const content = await readSystemClipboard();
  assert.deepEqual(content.images, []);
  assert.equal(content.unusableFile, true);
});

test("a rejected read falls back to null rather than throwing", async () => {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        read: async () => {
          throw new Error("denied");
        },
      },
    },
    configurable: true,
  });
  assert.equal(await readSystemClipboard(), null);
});
