import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let textSubpaths;
let hasOutlineFace;
let commandsToSubpaths;
let provideFontBinary;
let getOutlineFont;
let fontFileFor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ textSubpaths, hasOutlineFace, commandsToSubpaths } =
    await server.ssrLoadModule("/src/model/text/glyphOutlines.ts"));
  ({ provideFontBinary, getOutlineFont } =
    await server.ssrLoadModule("/src/fontCache.ts"));
  ({ fontFileFor } = await server.ssrLoadModule("/src/fonts.ts"));
  // Node has no origin to fetch `/fonts/…` from, so hand the cache the bytes.
  for (const file of ["inter-400.woff", "inter-400i.woff", "inter-700.woff", "noto-sans-jp-400.woff"]) {
    const bytes = await readFile(new URL(`../public/fonts/${file}`, import.meta.url));
    provideFontBinary(
      file,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
  }
});

after(async () => server.close());

const textShape = (patch = {}) => ({
  ...NODE_BASE,
  ...SHAPE_BASE,
  id: "t1",
  name: "Text",
  type: "text",
  transform: [1, 0, 0, 1, 0, 0],
  text: "o",
  textMode: "point",
  x: 0,
  y: 0,
  width: 40,
  height: 48,
  fontFamily: "Inter",
  fontSize: 40,
  fontWeight: 400,
  italic: false,
  lineHeight: 1.2,
  align: "left",
  ...patch,
});

const boundsOf = (subpaths) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const subpath of subpaths) {
    for (const anchor of subpath.anchors) {
      minX = Math.min(minX, anchor.p.x);
      minY = Math.min(minY, anchor.p.y);
      maxX = Math.max(maxX, anchor.p.x);
      maxY = Math.max(maxY, anchor.p.y);
    }
  }
  return { minX, minY, maxX, maxY };
};

test("a bundled font resolves to the face the style asks for", () => {
  assert.equal(fontFileFor("Inter", 400, false).file, "inter-400.woff");
  assert.equal(fontFileFor("Inter", 700, true).file, "inter-700i.woff");
  // CSS matching: 500 prefers the heavier-or-equal side, 300 the lighter.
  assert.equal(fontFileFor("Inter", 500, false).file, "inter-700.woff");
  assert.equal(fontFileFor("Inter", 300, false).file, "inter-400.woff");
  assert.equal(fontFileFor("System Sans", 400, false), null);
});

test("outlines are only offered for a face that is really bundled", () => {
  assert.equal(hasOutlineFace("Inter", 400, false), true);
  assert.equal(hasOutlineFace("Inter", 400, true), true);
  // Noto Sans JP ships upright only; italic would be a synthesised slant.
  assert.equal(hasOutlineFace("Noto Sans JP", 400, false), true);
  assert.equal(hasOutlineFace("Noto Sans JP", 400, true), false);
  assert.equal(hasOutlineFace("System Sans", 400, false), false);
});

test("a system font has no glyph geometry", () => {
  assert.equal(textSubpaths(textShape({ fontFamily: "System Sans" })), null);
  assert.equal(textSubpaths(textShape({ fontFamily: "Inter", italic: true, fontWeight: 400 })) !== null, true);
});

test("'o' outlines to two closed contours, the counter inside the bowl", () => {
  const subpaths = textSubpaths(textShape({ text: "o" }));
  assert.equal(subpaths.length, 2);
  assert.ok(subpaths.every((subpath) => subpath.closed));
  const [outer, inner] = subpaths.map((subpath) => boundsOf([subpath]));
  assert.ok(outer.minX < inner.minX && outer.maxX > inner.maxX);
  assert.ok(outer.minY < inner.minY && outer.maxY > inner.maxY);
});

test("glyphs sit on the baseline, above it and inside the advance", () => {
  const shape = textShape({ text: "on", fontSize: 40 });
  const bounds = boundsOf(textSubpaths(shape));
  const font = getOutlineFont("Inter", 400, false);
  const advance = Array.from("on").reduce(
    (total, char) => total + font.charToGlyph(char).advanceWidth,
    0
  ) * (shape.fontSize / font.unitsPerEm);
  // x-height glyphs sit on the baseline of the first line box, with no
  // descender below it and nothing above the ascender.
  const baseline = (shape.fontSize * shape.lineHeight - shape.fontSize) / 2 +
    shape.fontSize * 0.8;
  assert.ok(Math.abs(bounds.maxY - baseline) < 0.5, `baseline ${bounds.maxY}`);
  assert.ok(bounds.minY > baseline - shape.fontSize);
  assert.ok(bounds.minX >= -0.5 && bounds.maxX <= advance + 0.5);
});

test("the shape's own origin and line box place the outlines", () => {
  const at = (patch) => boundsOf(textSubpaths(textShape(patch)));
  const origin = at({ text: "o" });
  const moved = at({ text: "o", x: 100, y: 50 });
  assert.ok(Math.abs(moved.minX - origin.minX - 100) < 1e-6);
  assert.ok(Math.abs(moved.minY - origin.minY - 50) < 1e-6);
  // A second line sits one line box lower and nothing else moves.
  const twoLines = textSubpaths(textShape({ text: "o\no" }));
  assert.equal(twoLines.length, 4);
  const lineBox = 40 * 1.2;
  const first = boundsOf(twoLines.slice(0, 2));
  const second = boundsOf(twoLines.slice(2));
  assert.ok(Math.abs(second.minY - first.minY - lineBox) < 1e-6);
});

test("a character the font has no glyph for gives up on the whole shape", () => {
  assert.equal(textSubpaths(textShape({ text: "Aあ" })), null);
  const jp = textSubpaths(textShape({ text: "あ", fontFamily: "Noto Sans JP" }));
  assert.ok(jp && jp.length > 0);
});

test("quadratics are raised to cubics and contours are not left open", () => {
  const subpaths = commandsToSubpaths([
    { type: "M", x: 0, y: 0 },
    { type: "L", x: 0, y: 0 },
    { type: "Q", x1: 10, y1: 0, x: 10, y: 10 },
    { type: "L", x: 0, y: 10 },
    { type: "L", x: 0, y: 0 },
  ]);
  assert.equal(subpaths.length, 1);
  const { anchors, closed } = subpaths[0];
  assert.equal(closed, true);
  // The restated start point is folded away, not kept as a fourth anchor.
  assert.equal(anchors.length, 3);
  assert.deepEqual(anchors[0].p, { x: 0, y: 0 });
  // Quadratic control (10,0) raised: 2/3 of the way from each end point.
  const near = (point, x, y) =>
    assert.ok(Math.abs(point.x - x) < 1e-9 && Math.abs(point.y - y) < 1e-9,
      `${JSON.stringify(point)} != (${x}, ${y})`);
  near(anchors[0].hOut, 20 / 3, 0);
  near(anchors[1].hIn, 10, 10 / 3);
});
