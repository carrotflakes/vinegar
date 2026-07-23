import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let pathOpShape;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ pathOpShape } = await server.ssrLoadModule("/src/model/pathOps.ts"));
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
  transform: [0, 1, -1, 0, 80, 30],
  transformOrigin: { x: 4, y: 5 },
  ...patch,
});

// A curved open subpath: two anchors with handles.
const curved = {
  closed: false,
  anchors: [
    { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 10, y: 0 } },
    { p: { x: 20, y: 20 }, hIn: { x: 10, y: 20 }, hOut: null },
  ],
};

test("reverse flips anchor order and swaps handles, preserving closed", () => {
  const shape = pathShape([curved]);
  const out = pathOpShape(shape, "reverse");
  assert.equal(out.subpaths[0].closed, false);
  assert.deepEqual(out.subpaths[0].anchors, [
    { p: { x: 20, y: 20 }, hIn: null, hOut: { x: 10, y: 20 } },
    { p: { x: 0, y: 0 }, hIn: { x: 10, y: 0 }, hOut: null },
  ]);
  // Identity and style are untouched; the generator link is dropped.
  assert.deepEqual(out.transform, shape.transform);
  assert.deepEqual(out.fill, shape.fill);
  assert.equal(out.id, shape.id);
  assert.equal(out.generator, undefined);
});

test("flatten replaces curves with straight segments (no handles)", () => {
  const out = pathOpShape(pathShape([curved]), "flatten");
  assert.equal(out.subpaths[0].closed, false);
  assert.ok(out.subpaths[0].anchors.length > 2);
  assert.ok(
    out.subpaths[0].anchors.every((a) => a.hIn === null && a.hOut === null)
  );
});

test("smooth fits handles through straight anchors", () => {
  const straight = {
    closed: false,
    anchors: [
      { p: { x: 0, y: 0 }, hIn: null, hOut: null },
      { p: { x: 10, y: 20 }, hIn: null, hOut: null },
      { p: { x: 30, y: 0 }, hIn: null, hOut: null },
    ],
  };
  const out = pathOpShape(pathShape([straight]), "smooth");
  assert.ok(
    out.subpaths[0].anchors.some((a) => a.hIn !== null || a.hOut !== null)
  );
});

test("simplify reduces a dense polyline while keeping it closed", () => {
  const anchors = [];
  for (let i = 0; i <= 40; i++) {
    anchors.push({
      p: { x: i, y: Math.round(Math.sin(i / 6) * 10) },
      hIn: null,
      hOut: null,
    });
  }
  const out = pathOpShape(pathShape([{ closed: true, anchors }]), "simplify");
  assert.equal(out.subpaths[0].closed, true);
  assert.ok(out.subpaths[0].anchors.length < anchors.length);
});

test("subpaths too short to operate on report no change", () => {
  const single = pathShape([
    { closed: false, anchors: [{ p: { x: 0, y: 0 }, hIn: null, hOut: null }] },
  ]);
  assert.equal(pathOpShape(single, "simplify"), null);
  assert.equal(pathOpShape(single, "flatten"), null);
});
