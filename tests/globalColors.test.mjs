// Global colours hold any *concrete* paint — solid, gradient or pattern — not
// just solids, so the demo-sized case "one gradient, edited in one place,
// repainting every use" works. See docs/global-colors.md.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let resolvePaintRef;
let swatchRef;
let linearGradient;
let solid;
let bakeSwatchRefs;
let swatchUsageCounts;
let hasValidSwatches;
let createEmptyDocument;
let parseDocument;
let serializeDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ resolvePaintRef, swatchRef, linearGradient, solid } =
    await server.ssrLoadModule("/src/model/paint.ts"));
  ({ bakeSwatchRefs, swatchUsageCounts } =
    await server.ssrLoadModule("/src/model/swatches.ts"));
  ({ hasValidSwatches } = await server.ssrLoadModule("/src/model/sceneValidation.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } =
    await server.ssrLoadModule("/src/io/serialize.ts"));
});

after(async () => server.close());

const GRADIENT = () =>
  linearGradient(
    [
      { offset: 0, color: "#ff0000", alpha: 1 },
      { offset: 1, color: "#0000ff", alpha: 0.5 },
    ],
    Math.PI / 2
  );

const rect = (patch = {}) => ({
  id: "rect-1",
  name: "Rect",
  type: "rect",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  cornerRadius: 0,
  transform: [1, 0, 0, 1, 0, 0],
  ...NODE_BASE,
  ...SHAPE_BASE,
  ...patch,
});

/** A one-node document whose fill references the single swatch `g`. */
function docWithGradientSwatch(paint = GRADIENT(), alpha = 1) {
  const node = rect({ fill: swatchRef("g", alpha) });
  return {
    ...createEmptyDocument(),
    nodes: { [node.id]: node },
    rootIds: [node.id],
    swatches: { g: { id: "g", name: "Brand", paint } },
    swatchOrder: ["g"],
  };
}

test("a gradient swatch resolves for every referencing fill", () => {
  const doc = docWithGradientSwatch();
  const resolved = resolvePaintRef(doc.nodes["rect-1"].fill, doc.swatches);
  assert.deepEqual(resolved, GRADIENT());
  // Editing the swatch is the only edit needed to repaint every use: the
  // reference itself is untouched and resolves to the new value.
  const edited = { ...doc.swatches, g: { ...doc.swatches.g, paint: solid("#00ff00") } };
  assert.deepEqual(resolvePaintRef(doc.nodes["rect-1"].fill, edited), solid("#00ff00"));
});

test("a per-use tint scales every stop of a gradient swatch", () => {
  const doc = docWithGradientSwatch(GRADIENT(), 0.5);
  const resolved = resolvePaintRef(doc.nodes["rect-1"].fill, doc.swatches);
  assert.deepEqual(
    resolved.stops.map((s) => s.alpha),
    [0.5, 0.25]
  );
  // The swatch itself is not mutated by resolution.
  assert.deepEqual(doc.swatches.g.paint.stops.map((s) => s.alpha), [1, 0.5]);
});

test("a tint of 1 returns the swatch's paint unchanged", () => {
  const doc = docWithGradientSwatch();
  assert.equal(
    resolvePaintRef(doc.nodes["rect-1"].fill, doc.swatches),
    doc.swatches.g.paint
  );
});

test("baking a gradient swatch reference writes the gradient into the node", () => {
  const doc = docWithGradientSwatch();
  assert.equal(swatchUsageCounts(doc).get("g"), 1);
  const nodes = bakeSwatchRefs(doc, { swatchId: "g" });
  assert.deepEqual(nodes["rect-1"].fill, GRADIENT());
});

test("a document with a gradient swatch validates and round-trips", () => {
  const doc = docWithGradientSwatch();
  assert.equal(hasValidSwatches(doc), true);
  const text = serializeDocument(doc);
  assert.equal(JSON.parse(text).version, 33);
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.swatches.g.paint, GRADIENT());
});

test("a swatch that stores a reference is rejected at the file boundary", () => {
  const doc = docWithGradientSwatch();
  const file = JSON.parse(serializeDocument(doc));
  file.document.swatches.g.paint = { type: "swatch", swatchId: "g", alpha: 1 };
  assert.throws(() => parseDocument(JSON.stringify(file)));
});
