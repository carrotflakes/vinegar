import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let applyPathModifiers;
let resolvedSubpaths;
let shapeBounds;
let createEmptyDocument;
let parseDocument;
let serializeDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ applyPathModifiers, resolvedSubpaths } =
    await server.ssrLoadModule("/src/model/path/pathModifiers.ts"));
  ({ shapeBounds } =
    await server.ssrLoadModule("/src/model/geometry/bounds.ts"));
  ({ createEmptyDocument } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } =
    await server.ssrLoadModule("/src/io/serialize.ts"));
});

after(async () => server.close());

const path = (modifiers = []) => ({
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

test("disabled modifiers are bypassed and enabled stages run in order", () => {
  const shape = path([
    { type: "reverse", enabled: false },
    { type: "reverse" },
  ]);
  const resolved = resolvedSubpaths(shape);
  assert.deepEqual(resolved[0].anchors.map((anchor) => anchor.p), [
    { x: 0, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.notStrictEqual(resolved, shape.subpaths);
});

test("resolved geometry is cached by immutable path identity", () => {
  const shape = path([{ type: "reverse" }]);
  assert.strictEqual(resolvedSubpaths(shape), resolvedSubpaths(shape));
  assert.notStrictEqual(
    resolvedSubpaths({ ...shape }),
    resolvedSubpaths(shape)
  );
});

test("offset changes downstream bounds without overwriting base geometry", () => {
  const shape = path([{ type: "offset", distance: 5, join: "miter" }]);
  const before = structuredClone(shape.subpaths);
  assert.deepEqual(shapeBounds(shape), { x: -5, y: -5, width: 30, height: 20 });
  assert.deepEqual(shape.subpaths, before);
});

test("apply bakes resolved geometry, clears the stack, and detaches generator", () => {
  const shape = path([{ type: "reverse" }]);
  shape.generator = { scriptId: "star", args: { points: 5 } };
  const resolved = resolvedSubpaths(shape);
  const baked = applyPathModifiers(shape);
  assert.strictEqual(baked.subpaths, resolved);
  assert.deepEqual(baked.modifiers, []);
  assert.equal(baked.generator, null);
  assert.equal(shape.modifiers.length, 1);
});

test("modifier stacks round-trip in v30 documents", () => {
  const shape = path([
    { type: "simplify", tolerance: 1.25, enabled: false },
    { type: "offset", distance: -3, join: "bevel" },
  ]);
  const empty = createEmptyDocument();
  const doc = {
    ...empty,
    rootIds: [shape.id],
    nodes: { [shape.id]: shape },
  };
  const text = serializeDocument(doc);
  assert.equal(JSON.parse(text).version, 30);
  assert.deepEqual(parseDocument(text).nodes[shape.id].modifiers, shape.modifiers);
});
