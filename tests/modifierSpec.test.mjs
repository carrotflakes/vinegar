import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let PATH_MODIFIER_TYPES;
let PATH_MODIFIER_SPECS;
let PATH_MODIFIER_LABELS;
let defaultPathModifier;
let isValidPathModifier;
let modifierNumberField;
let clampFieldValue;
let resolvedSubpaths;
let readNumField;
let writeNumField;
let createEmptyDocument;
let parseDocument;
let serializeDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ PATH_MODIFIER_TYPES, createEmptyDocument } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({
    PATH_MODIFIER_SPECS,
    PATH_MODIFIER_LABELS,
    defaultPathModifier,
    isValidPathModifier,
    modifierNumberField,
    clampFieldValue,
  } = await server.ssrLoadModule("/src/model/path/modifierSpec.ts"));
  ({ resolvedSubpaths } = await server.ssrLoadModule("/src/model/path/pathModifiers.ts"));
  ({ readNumField, writeNumField } = await server.ssrLoadModule("/src/model/params.ts"));
  ({ parseDocument, serializeDocument } =
    await server.ssrLoadModule("/src/io/serialize.ts"));
});

after(async () => server.close());

const path = (modifiers) => ({
  id: "path-1",
  name: "Path",
  type: "path",
  ...SHAPE_BASE,
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  fillRule: "nonzero",
  subpaths: [{
    closed: true,
    anchors: [
      { p: { x: 0, y: 0 }, hIn: null, hOut: null },
      { p: { x: 20, y: 0 }, hIn: null, hOut: null },
      { p: { x: 20, y: 10 }, hIn: null, hOut: null },
      { p: { x: 0, y: 10 }, hIn: null, hOut: null },
    ],
  }],
  modifiers,
});

test("every declared stage has a spec, a label and usable defaults", () => {
  for (const type of PATH_MODIFIER_TYPES) {
    const spec = PATH_MODIFIER_SPECS[type];
    assert.ok(spec, `${type} has no spec`);
    assert.equal(PATH_MODIFIER_LABELS[type], spec.label);
    const modifier = defaultPathModifier(type);
    assert.equal(modifier.type, type);
    // The defaults are what "Add modifier" writes, so they must be loadable.
    assert.ok(isValidPathModifier(modifier), `${type} defaults are rejected`);
    // …and the geometry side must know the stage: an unhandled case would
    // fall through the apply switch and return the input untouched.
    const resolved = resolvedSubpaths(path([modifier]));
    assert.ok(Array.isArray(resolved) && resolved.length > 0, type);
  }
});

test("a stage's fields are exactly the keys it persists", () => {
  const empty = createEmptyDocument();
  for (const type of PATH_MODIFIER_TYPES) {
    const shape = path([defaultPathModifier(type)]);
    const text = serializeDocument({
      ...empty,
      rootIds: [shape.id],
      nodes: { [shape.id]: shape },
    });
    const parsed = parseDocument(text).nodes[shape.id].modifiers[0];
    const keys = Object.keys(parsed).filter((key) => key !== "type" && key !== "enabled");
    assert.deepEqual(
      keys.sort(),
      PATH_MODIFIER_SPECS[type].fields.map((field) => field.key).sort(),
      `${type} persists fields its spec does not declare`
    );
  }
});

test("the field table is the file schema", () => {
  for (const type of PATH_MODIFIER_TYPES) {
    for (const field of PATH_MODIFIER_SPECS[type].fields) {
      const missing = { ...defaultPathModifier(type) };
      delete missing[field.key];
      assert.equal(isValidPathModifier(missing), false, `${type}.${field.key} optional?`);

      const wrong = { ...defaultPathModifier(type), [field.key]: "nonsense" };
      assert.equal(isValidPathModifier(wrong), false, `${type}.${field.key} untyped?`);

      if (field.kind === "number" && field.min !== undefined) {
        const under = { ...defaultPathModifier(type), [field.key]: field.min - 1 };
        assert.equal(isValidPathModifier(under), false, `${type}.${field.key} unbounded?`);
      }
    }
  }
  assert.equal(isValidPathModifier({ type: "nope" }), false);
  assert.equal(isValidPathModifier({ type: "smooth", enabled: "yes" }), false);
  // `enabled` is stored explicitly, like every other field in the table.
  assert.equal(isValidPathModifier({ type: "smooth" }), false);
});

test("bindings reach every number field and respect its floor", () => {
  for (const type of PATH_MODIFIER_TYPES) {
    const shape = path([defaultPathModifier(type)]);
    for (const field of PATH_MODIFIER_SPECS[type].fields) {
      const path_ = `modifiers.0.${field.key}`;
      if (field.kind !== "number") {
        assert.equal(readNumField(shape, path_), null, `${type}.${field.key}`);
        continue;
      }
      assert.equal(readNumField(shape, path_), field.default);
      const written = writeNumField(shape, path_, -1000);
      assert.ok(written, `${type}.${field.key} is not writable`);
      const value = written.modifiers[0][field.key];
      assert.equal(value, clampFieldValue(field, -1000));
      assert.ok(isValidPathModifier(written.modifiers[0]), `${type} left invalid`);
    }
  }
});

test("a seed stays a whole number however it is driven", () => {
  const shape = path([defaultPathModifier("roughen")]);
  const written = writeNumField(shape, "modifiers.0.seed", 12.7);
  assert.equal(written.modifiers[0].seed, 13);
  assert.equal(modifierNumberField("roughen", "seed").integer, true);
  assert.equal(modifierNumberField("roughen", "style"), null);
});
