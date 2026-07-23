import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let joinShapes;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ joinShapes } = await server.ssrLoadModule("/src/model/joinPath.ts"));
});

after(async () => server.close());

const solid = (color) => ({ type: "solid", color, alpha: 1 });

const pathShape = (subpaths, patch = {}) => ({
  id: "p1",
  name: "Path",
  type: "path",
  subpaths,
  fill: solid("#ff6633"),
  stroke: solid("#112233"),
  strokeWidth: 3,
  opacity: 0.6,
  blendMode: "multiply",
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
  ...patch,
});

const openSeg = (a, b) => ({
  closed: false,
  anchors: [
    { p: a, hIn: null, hOut: null },
    { p: b, hIn: null, hOut: null },
  ],
});

test("welds two open subpaths that share an endpoint into one contour", () => {
  const shape = pathShape([
    openSeg({ x: 0, y: 0 }, { x: 10, y: 0 }),
    openSeg({ x: 10, y: 0 }, { x: 10, y: 10 }),
  ]);
  const out = joinShapes([shape]);
  assert.ok(out);
  assert.equal(out.subpaths.length, 1);
  assert.equal(out.subpaths[0].closed, false);
  assert.equal(out.subpaths[0].anchors.length, 3);
  // Baked into parent space with an identity transform.
  assert.deepEqual(out.transform, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(out.fill, shape.fill);
});

test("closes a subpath when the welded ends meet back at the start", () => {
  const shape = pathShape([
    openSeg({ x: 0, y: 0 }, { x: 10, y: 0 }),
    openSeg({ x: 10, y: 0 }, { x: 10, y: 10 }),
    openSeg({ x: 10, y: 10 }, { x: 0, y: 0 }),
  ]);
  const out = joinShapes([shape]);
  assert.ok(out);
  assert.equal(out.subpaths.length, 1);
  assert.equal(out.subpaths[0].closed, true);
  assert.equal(out.subpaths[0].anchors.length, 3);
});

test("joins two separate shapes across their transforms", () => {
  const a = pathShape([openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })]);
  const b = pathShape([openSeg({ x: 0, y: 0 }, { x: 0, y: 10 })], {
    id: "p2",
    // translate so b's start lands on a's end at (10, 0).
    transform: [1, 0, 0, 1, 10, 0],
  });
  const out = joinShapes([a, b]);
  assert.ok(out);
  assert.equal(out.subpaths.length, 1);
  assert.equal(out.subpaths[0].anchors.length, 3);
});

test("closed subpaths pass through untouched and lone open ends do not weld", () => {
  const closed = {
    closed: true,
    anchors: [
      { p: { x: 0, y: 0 }, hIn: null, hOut: null },
      { p: { x: 5, y: 0 }, hIn: null, hOut: null },
      { p: { x: 5, y: 5 }, hIn: null, hOut: null },
    ],
  };
  // Two open subpaths far apart: nothing to weld.
  const shape = pathShape([
    closed,
    openSeg({ x: 0, y: 0 }, { x: 1, y: 0 }),
    openSeg({ x: 100, y: 100 }, { x: 101, y: 100 }),
  ]);
  assert.equal(joinShapes([shape]), null);
});
