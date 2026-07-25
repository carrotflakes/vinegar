import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let buildCreated;
let normalizeStrokeDash;
let createEmptyDocument;
let serializeDocument;
let parseDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ buildCreated } = await server.ssrLoadModule("/src/script/runScript.ts"));
  ({ normalizeStrokeDash } = await server.ssrLoadModule("/src/model/stroke.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ serializeDocument, parseDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
});

after(async () => server.close());

// A script spec carries only what the user wrote, so every model field the spec
// omits has to be filled in here. Missing stroke fields used to reach
// normalizeStrokeDash as undefined and throw on the first render.
const SPECS = [
  { type: "rect", x: 0, y: 0, width: 10, height: 10 },
  { type: "ellipse", x: 0, y: 0, width: 10, height: 10 },
  { type: "line", x1: 0, y1: 0, x2: 10, y2: 10 },
  {
    type: "path",
    subpaths: [{
      anchors: [
        { p: { x: 0, y: 0 }, hIn: null, hOut: null },
        { p: { x: 10, y: 10 }, hIn: null, hOut: null },
      ],
      closed: false,
    }],
  },
];

test("a minimal script spec produces a fully-formed shape", () => {
  for (const spec of SPECS) {
    const shape = buildCreated(spec);
    assert.ok(shape, spec.type);
    for (const key of [
      "blendMode", "effects", "hidden", "locked", "generator",
      "strokeDash", "strokeDashOffset", "strokeCap", "strokeJoin", "strokeAlignment",
    ]) {
      assert.notEqual(shape[key], undefined, `${spec.type}.${key}`);
    }
    // The renderer's first move on any stroked shape.
    assert.deepEqual(normalizeStrokeDash(shape.strokeDash), []);
  }
  assert.equal(buildCreated({ type: "rect", x: 0, y: 0, width: 10, height: 10 }).cornerRadius, 0);
  assert.equal(buildCreated(SPECS[3]).fillRule, "nonzero");
});

test("script-created shapes survive save/load", () => {
  const doc = createEmptyDocument();
  for (const spec of SPECS) {
    const shape = buildCreated(spec);
    doc.nodes[shape.id] = shape;
    doc.rootIds.push(shape.id);
  }
  const loaded = parseDocument(serializeDocument(doc));
  assert.equal(loaded.rootIds.length, SPECS.length);
});

test("an unknown spec type is rejected", () => {
  assert.equal(buildCreated({ type: "brush" }), null);
  assert.equal(buildCreated({ type: "nope" }), null);
});
