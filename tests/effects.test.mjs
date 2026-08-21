import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let defaultEffect;
let effectsMargin;
let isGeometryEffect;
let paintsGeometryEffects;
let pixelEffects;
let activeEffects;
let strokeEffectOutset;
let parseDocument;
let serializeDocument;
let assetReferenceCounts;
let referencedSwatchIds;
let bakeSwatchRefs;
let swatchUsageCounts;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({
    activeEffects,
    defaultEffect,
    effectsMargin,
    isGeometryEffect,
    paintsGeometryEffects,
    pixelEffects,
    strokeEffectOutset,
  } = await server.ssrLoadModule("/src/model/effects.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule(
    "/src/io/serialize.ts"
  ));
  ({ assetReferenceCounts, referencedSwatchIds } = await server.ssrLoadModule(
    "/src/model/scene.ts"
  ));
  ({ bakeSwatchRefs, swatchUsageCounts } = await server.ssrLoadModule(
    "/src/model/swatches.ts"
  ));
});

after(async () => server.close());

const rect = (extra = {}) => ({
  id: "rect",
  name: "Rect",
  type: "rect",
  ...SHAPE_BASE,
  cornerRadius: 0,
  ...NODE_BASE,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  transform: [1, 0, 0, 1, 0, 0],
  ...extra,
});

const text = (extra = {}) => ({
  id: "text",
  name: "Text",
  type: "text",
  ...SHAPE_BASE,
  ...NODE_BASE,
  text: "Hello",
  textMode: "point",
  x: 0,
  y: 0,
  width: 50,
  height: 28.8,
  fontFamily: "System Sans",
  fontSize: 24,
  fontWeight: 400,
  italic: false,
  lineHeight: 1.2,
  align: "left",
  transform: [1, 0, 0, 1, 0, 0],
  ...extra,
});

const strokeEffect = (extra = {}) => ({
  id: "fx_stroke",
  enabled: true,
  type: "stroke",
  paint: { type: "solid", color: "#0000ff", alpha: 1 },
  width: 4,
  alignment: "center",
  cap: "round",
  join: "round",
  blendMode: "normal",
  ...extra,
});

test("the new effects default to a visible fill and stroke", () => {
  const fill = defaultEffect("fill");
  assert.equal(fill.type, "fill");
  assert.equal(fill.paint.type, "solid");
  const stroke = defaultEffect("stroke");
  assert.equal(stroke.type, "stroke");
  assert.ok(stroke.width > 0);
  assert.equal(stroke.alignment, "center");
  // Each call owns its paint, so editing one effect never touches another.
  assert.notEqual(defaultEffect("fill").paint, fill.paint);
});

test("every effect carries a unique id", () => {
  const first = defaultEffect("blur");
  const second = defaultEffect("blur");
  assert.equal(typeof first.id, "string");
  assert.notEqual(first.id, second.id);
});

test("an effect without an id, or with a duplicated one, is rejected", () => {
  const missing = createEmptyDocument();
  const { id: _dropped, ...idless } = defaultEffect("blur");
  missing.nodes.rect = rect({ effects: [idless] });
  missing.rootIds = ["rect"];
  assert.throws(() => parseDocument(serializeDocument(missing)));

  // Ids address an entry within its node, so a repeat would be ambiguous.
  const duplicated = createEmptyDocument();
  const effect = defaultEffect("blur");
  duplicated.nodes.rect = rect({ effects: [effect, { ...effect }] });
  duplicated.rootIds = ["rect"];
  assert.throws(() => parseDocument(serializeDocument(duplicated)));
});

test("ids survive a reorder, so they can address an entry", () => {
  const doc = createEmptyDocument();
  const blur = defaultEffect("blur");
  const fill = defaultEffect("fill");
  doc.nodes.rect = rect({ effects: [blur, fill] });
  doc.rootIds = ["rect"];
  const reordered = parseDocument(
    serializeDocument({
      ...doc,
      nodes: { ...doc.nodes, rect: { ...doc.nodes.rect, effects: [fill, blur] } },
    })
  );
  // The fill moved from index 1 to index 0 while keeping its identity.
  assert.deepEqual(
    reordered.nodes.rect.effects.map((effect) => effect.id),
    [fill.id, blur.id]
  );
});

test("only fill and stroke are geometry effects", () => {
  assert.equal(isGeometryEffect(defaultEffect("fill")), true);
  assert.equal(isGeometryEffect(defaultEffect("stroke")), true);
  assert.equal(isGeometryEffect(defaultEffect("blur")), false);
  assert.equal(isGeometryEffect(defaultEffect("drop-shadow")), false);
});

test("a stroke effect widens the effect margin by its own outset", () => {
  assert.equal(effectsMargin([defaultEffect("fill")]), 0);
  // center: half the width each side; outside: the whole width.
  assert.equal(effectsMargin([strokeEffect()]), 2);
  assert.equal(effectsMargin([strokeEffect({ alignment: "outside" })]), 4);
  assert.equal(effectsMargin([strokeEffect({ alignment: "inside" })]), 0);
  // Miter joins spike further out, so they carry the conservative multiplier.
  assert.equal(strokeEffectOutset(strokeEffect({ join: "miter" })), 8);
  // Reaches accumulate with the rest of the stack.
  assert.equal(
    effectsMargin([{ id: "fx_blur", enabled: true, type: "blur", radius: 1 }, strokeEffect()]),
    5
  );
});

test("pixelEffects drops geometry entries only when there are any", () => {
  const blur = defaultEffect("blur");
  const stack = [blur];
  // Untouched (and the same array) when nothing needs removing.
  assert.equal(pixelEffects(stack), stack);
  assert.deepEqual(pixelEffects([blur, defaultEffect("fill")]), [blur]);
  assert.deepEqual(pixelEffects([defaultEffect("stroke")]), []);
});

test("a bypassed effect drops out of every reader that applies the stack", () => {
  const blur = defaultEffect("blur");
  const stack = [blur];
  // The same array back when nothing is bypassed: readers stay allocation-free.
  assert.equal(activeEffects(stack), stack);

  const off = { ...blur, radius: 10, enabled: false };
  assert.deepEqual(activeEffects([off, blur]), [blur]);
  // pixelEffects and effectsMargin fold the filter in, so a bypassed entry
  // neither renders nor pads the bounds.
  assert.deepEqual(pixelEffects([off, defaultEffect("fill")]), []);
  assert.equal(effectsMargin([off, strokeEffect({ enabled: false })]), 0);
  assert.equal(effectsMargin([off, strokeEffect()]), 2);
});

test("the bypass flag round-trips, and a non-boolean one is rejected", () => {
  const doc = createEmptyDocument();
  const effects = [strokeEffect({ enabled: false })];
  doc.nodes.rect = rect({ effects });
  doc.rootIds = ["rect"];
  assert.deepEqual(parseDocument(serializeDocument(doc)).nodes.rect.effects, effects);

  const bad = createEmptyDocument();
  bad.nodes.rect = rect({ effects: [strokeEffect({ enabled: "no" })] });
  bad.rootIds = ["rect"];
  assert.throws(() => parseDocument(serializeDocument(bad)));
});

test("geometry effects apply only to shapes with an outline", () => {
  assert.equal(paintsGeometryEffects(rect()), true);
  assert.equal(paintsGeometryEffects(text()), false);
  assert.equal(
    paintsGeometryEffects({ ...rect(), type: "image", assetId: "a" }),
    false
  );
});

test("fill and stroke effects round-trip through the file format", () => {
  const doc = createEmptyDocument();
  const effects = [
    {
      id: "fx_fill",
      enabled: true,
      type: "fill",
      paint: { type: "solid", color: "#00ff00", alpha: 0.5 },
      blendMode: "multiply",
    },
    strokeEffect({ alignment: "outside", cap: "butt", join: "miter" }),
    { id: "fx_empty", enabled: true, type: "fill", paint: null, blendMode: "normal" },
  ];
  doc.nodes.rect = rect({ effects });
  doc.rootIds = ["rect"];

  const reopened = parseDocument(serializeDocument(doc));
  assert.deepEqual(reopened.nodes.rect.effects, effects);
});

test("a malformed geometry effect is rejected", () => {
  const doc = createEmptyDocument();
  doc.nodes.rect = rect({ effects: [strokeEffect({ alignment: "middle" })] });
  doc.rootIds = ["rect"];
  assert.throws(() => parseDocument(serializeDocument(doc)));

  const negative = createEmptyDocument();
  negative.nodes.rect = rect({ effects: [strokeEffect({ width: -1 })] });
  negative.rootIds = ["rect"];
  assert.throws(() => parseDocument(serializeDocument(negative)));
});

// A 1×1 transparent PNG — a real asset without any decoding.
const PNG_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const patternPaint = {
  type: "pattern",
  assetId: "tex",
  mode: "tile",
  scale: 1,
  rotation: 0,
  offset: { x: 0, y: 0 },
  alpha: 1,
};

const group = (extra = {}) => ({
  id: "group",
  name: "Group",
  type: "group",
  clipsToMask: false,
  ...NODE_BASE,
  childIds: [],
  transform: [1, 0, 0, 1, 0, 0],
  ...extra,
});

function swatchDoc(effects, extra = {}) {
  const doc = createEmptyDocument();
  doc.swatches.brand = {
    id: "brand",
    name: "Brand",
    paint: { type: "solid", color: "#ff0000", alpha: 1 },
  };
  doc.swatchOrder = ["brand"];
  doc.nodes.rect = rect({ effects, ...extra });
  doc.rootIds = ["rect"];
  return doc;
}

const swatchRef = { type: "swatch", swatchId: "brand", alpha: 1 };

test("an asset used only by an effect survives a save", () => {
  const doc = createEmptyDocument();
  doc.assets.tex = {
    id: "tex",
    kind: "image",
    mimeType: "image/png",
    name: null,
    source: { type: "data", data: PNG_DATA },
  };
  doc.nodes.rect = rect({
    effects: [
      { id: "fx_pattern", enabled: true, type: "fill", paint: patternPaint, blendMode: "normal" },
    ],
  });
  doc.rootIds = ["rect"];

  assert.equal(assetReferenceCounts(doc).get("tex"), 1);
  // Saving prunes orphan assets; an effect's pattern is not an orphan.
  const reopened = parseDocument(serializeDocument(doc));
  assert.ok(reopened.assets.tex);
});

test("a global color used only by an effect is counted and baked", () => {
  const doc = swatchDoc([
    { id: "fx_swatch", enabled: true, type: "fill", paint: swatchRef, blendMode: "normal" },
  ]);
  assert.equal(swatchUsageCounts(doc).get("brand"), 1);
  assert.deepEqual([...referencedSwatchIds([doc.nodes.rect])], ["brand"]);

  // Deleting the swatch bakes every reference first, effects included —
  // otherwise the effect would silently stop painting.
  const nodes = bakeSwatchRefs(doc, { swatchId: "brand" });
  assert.deepEqual(nodes.rect.effects[0].paint, {
    type: "solid",
    color: "#ff0000",
    alpha: 1,
  });
});

test("unlinking a shape's own fill leaves its effect paints linked", () => {
  const doc = swatchDoc(
    [strokeEffect({ paint: swatchRef })],
    { fill: swatchRef }
  );
  const nodes = bakeSwatchRefs(doc, { nodeIds: ["rect"], target: "fill" });
  assert.equal(nodes.rect.fill.type, "solid");
  assert.deepEqual(nodes.rect.effects[0].paint, swatchRef);
});

test("an inert geometry effect on a group still holds its references", () => {
  const doc = createEmptyDocument();
  doc.swatches.brand = {
    id: "brand",
    name: "Brand",
    paint: { type: "solid", color: "#ff0000", alpha: 1 },
  };
  doc.swatchOrder = ["brand"];
  doc.nodes.rect = rect();
  doc.nodes.group = group({
    childIds: ["rect"],
    effects: [
      { id: "fx_swatch", enabled: true, type: "fill", paint: swatchRef, blendMode: "normal" },
    ],
  });
  doc.rootIds = ["group"];

  // The effect paints nothing on a group, but the reference is real document
  // data: deleting the swatch must still bake it.
  assert.equal(swatchUsageCounts(doc).get("brand"), 1);
  const nodes = bakeSwatchRefs(doc, { swatchId: "brand" });
  assert.equal(nodes.group.effects[0].paint.type, "solid");
});
