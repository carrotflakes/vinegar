// A colour variable holds any *concrete* paint — solid, gradient or pattern —
// not just solids, so the demo-sized case "one gradient, edited in one place,
// repainting every use" works. See docs/global-colors.md.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let varRef;
let linearGradient;
let solid;
let resolveDocPaint;
let bakePaintRefs;
let varUsageCounts;
let hasValidVars;
let paintValue;
let createEmptyDocument;
let parseDocument;
let serializeDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ varRef, linearGradient, solid } =
    await server.ssrLoadModule("/src/model/paint.ts"));
  ({ resolveDocPaint, bakePaintRefs, varUsageCounts } =
    await server.ssrLoadModule("/src/model/vars.ts"));
  ({ hasValidVars } = await server.ssrLoadModule("/src/model/sceneValidation.ts"));
  ({ createEmptyDocument, paintValue } =
    await server.ssrLoadModule("/src/model/types.ts"));
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

/** A one-node document whose fill references the single colour variable `g`. */
function docWithGradientSwatch(paint = GRADIENT(), alpha = 1) {
  const node = rect({ fill: varRef("g", alpha) });
  return {
    ...createEmptyDocument(),
    nodes: { [node.id]: node },
    rootIds: [node.id],
    vars: { g: { id: "g", name: "Brand", value: paintValue(paint) } },
    varOrder: ["g"],
  };
}

test("a gradient variable resolves for every referencing fill", () => {
  const doc = docWithGradientSwatch();
  assert.deepEqual(resolveDocPaint(doc.nodes["rect-1"].fill, doc), GRADIENT());
  // Editing the variable is the only edit needed to repaint every use: the
  // reference itself is untouched and resolves to the new value.
  const edited = {
    ...doc,
    vars: { g: { ...doc.vars.g, value: paintValue(solid("#00ff00")) } },
  };
  assert.deepEqual(
    resolveDocPaint(doc.nodes["rect-1"].fill, edited),
    solid("#00ff00")
  );
});

test("a per-use tint scales every stop of a gradient variable", () => {
  const doc = docWithGradientSwatch(GRADIENT(), 0.5);
  const resolved = resolveDocPaint(doc.nodes["rect-1"].fill, doc);
  assert.deepEqual(
    resolved.stops.map((s) => s.alpha),
    [0.5, 0.25]
  );
  // The variable itself is not mutated by resolution.
  assert.deepEqual(doc.vars.g.value.value.stops.map((s) => s.alpha), [1, 0.5]);
});

test("a tint of 1 returns the variable's paint unchanged", () => {
  const doc = docWithGradientSwatch();
  assert.equal(
    resolveDocPaint(doc.nodes["rect-1"].fill, doc),
    doc.vars.g.value.value
  );
});

test("baking a gradient reference writes the gradient into the node", () => {
  const doc = docWithGradientSwatch();
  assert.equal(varUsageCounts(doc).get("g"), 1);
  const nodes = bakePaintRefs(doc, { varId: "g" });
  assert.deepEqual(nodes["rect-1"].fill, GRADIENT());
});

test("a document with a gradient variable validates and round-trips", () => {
  const doc = docWithGradientSwatch();
  assert.equal(hasValidVars(doc), true);
  const text = serializeDocument(doc);
  assert.equal(JSON.parse(text).version, 34);
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.vars.g.value.value, GRADIENT());
});

test("a variable that stores a reference is rejected at the file boundary", () => {
  const doc = docWithGradientSwatch();
  const file = JSON.parse(serializeDocument(doc));
  file.document.vars.g.value.value = { type: "var", varId: "g", alpha: 1 };
  assert.throws(() => parseDocument(JSON.stringify(file)));
});

test("a v33 file's swatches and params fold into one variable table", () => {
  // Ids carry over unchanged, so every reference the old file held still
  // resolves after the merge. See docs/parameters.md (phase 2a).
  const legacy = {
    app: "vinegar",
    version: 33,
    document: {
      ...(() => {
        const { vars: _v, varOrder: _o, ...rest } = createEmptyDocument();
        return rest;
      })(),
      nodes: {
        "rect-1": {
          ...rect({ fill: { type: "swatch", swatchId: "g", alpha: 1 } }),
          strokeWidth: 4,
          bindings: { strokeWidth: { paramId: "p", scale: 2 } },
        },
      },
      rootIds: ["rect-1"],
      swatches: { g: { id: "g", name: "Brand", paint: GRADIENT() } },
      swatchOrder: ["g"],
      params: {
        p: { id: "p", name: "Gap", value: 2, min: null, max: null, step: null, integer: false },
      },
      paramOrder: ["p"],
    },
  };
  const parsed = parseDocument(JSON.stringify(legacy));
  assert.deepEqual(parsed.varOrder, ["g", "p"]);
  assert.deepEqual(parsed.vars.g.value, paintValue(GRADIENT()));
  assert.equal(parsed.vars.p.value.kind, "number");
  assert.equal(parsed.vars.p.value.value, 2);
  assert.deepEqual(parsed.nodes["rect-1"].fill, { type: "var", varId: "g", alpha: 1 });
  assert.deepEqual(parsed.nodes["rect-1"].bindings.strokeWidth, { varId: "p", scale: 2 });
});
