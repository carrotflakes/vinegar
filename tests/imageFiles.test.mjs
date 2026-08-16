import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let hasFileData;
let imageFilesFromData;
let isImageFile;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ hasFileData, imageFilesFromData, isImageFile } = await server.ssrLoadModule(
    "/src/io/importImage.ts"
  ));
});

after(async () => {
  await server.close();
});

const file = (name, type) => ({ name, type });

/** Minimal DataTransfer stand-in: only the fields the helpers read. */
const transfer = ({ items = [], files = [], types = [] } = {}) => ({
  items: items.map((f) => ({ kind: "file", getAsFile: () => f })),
  files,
  types,
});

test("any image MIME type is a candidate, not just the picker's list", () => {
  assert.equal(isImageFile(file("a.png", "image/png")), true);
  // Types no allow-list anticipated: an iPad photo, a macOS Preview copy.
  assert.equal(isImageFile(file("IMG_0001.HEIC", "image/heic")), true);
  assert.equal(isImageFile(file("a.tiff", "image/tiff")), true);
  assert.equal(isImageFile(file("a.pdf", "application/pdf")), false);
});

test("a file with no MIME type falls back to its extension", () => {
  assert.equal(isImageFile(file("art.svg", "")), true);
  assert.equal(isImageFile(file("photo.JPG", "")), true);
  assert.equal(isImageFile(file("notes.txt", "")), false);
});

test("clipboard items yield the image files", () => {
  const files = imageFilesFromData(
    transfer({ items: [file("a.png", "image/png"), file("b.txt", "text/plain")] })
  );
  assert.deepEqual(files.map((f) => f.name), ["a.png"]);
});

test("falls back to `files` when `items` carries nothing", () => {
  const files = imageFilesFromData(transfer({ files: [file("a.heic", "image/heic")] }));
  assert.deepEqual(files.map((f) => f.name), ["a.heic"]);
});

test("hasFileData sees a file the image filter rejected", () => {
  assert.equal(hasFileData(transfer({ types: ["Files"] })), true);
  assert.equal(hasFileData(transfer({ files: [file("a.pdf", "application/pdf")] })), true);
  assert.equal(hasFileData(transfer({ types: ["text/plain"] })), false);
  assert.equal(hasFileData(null), false);
});
