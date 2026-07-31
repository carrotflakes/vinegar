// buildExtendedAnchors: the Pencil tool continuing a selected open path. The
// drawn tail is fitted in world space and mapped back into the path's local
// space; the original anchors up to the endpoint are preserved and the seam
// anchor keeps the endpoint's incoming handle.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let buildExtendedAnchors;
let invertMatrix;

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ buildExtendedAnchors } = await server.ssrLoadModule("/src/canvas/tools/shapeTools.ts"));
  ({ invertMatrix } = await server.ssrLoadModule("/src/model/geometry/matrix.ts"));
});

after(async () => server.close());

const anchor = (x, y) => ({ p: { x, y }, hIn: null, hOut: null });

test("appends the tail in local space, preserving the original anchors", () => {
  const orig = [anchor(0, 0), anchor(10, 0)]; // endpoint at (10, 0)
  const world = [1, 0, 0, 1, 0, 0];
  const inverse = invertMatrix(world);
  // Draw upward from the endpoint (world == local under identity).
  const tail = [{ x: 10, y: 10 }, { x: 10, y: 20 }];
  const out = buildExtendedAnchors(orig, tail, world, inverse, 0.5);

  assert.deepEqual(out[0], orig[0], "the first original anchor is untouched");
  // A seam anchor lands on the old endpoint.
  assert.ok(near(out[1].p.x, 10) && near(out[1].p.y, 0), "seam anchor sits on the endpoint");
  const lastPt = out[out.length - 1].p;
  assert.ok(near(lastPt.x, 10) && near(lastPt.y, 20), "the path now ends at the last drawn point");
  assert.ok(out.length >= orig.length, "the path did not shrink");
});

test("maps world tail back through the path's transform", () => {
  const orig = [anchor(0, 0), anchor(10, 0)];
  // Scale 2, translate (5, 3): local (10,0) -> world (25, 3).
  const world = [2, 0, 0, 2, 5, 3];
  const inverse = invertMatrix(world);
  // Draw in world space straight up from the endpoint's world position.
  const tail = [{ x: 25, y: 23 }, { x: 25, y: 43 }];
  const out = buildExtendedAnchors(orig, tail, world, inverse, 0.5);

  assert.deepEqual(out[0], orig[0]);
  const lastPt = out[out.length - 1].p;
  // world (25, 43) -> local ((25-5)/2, (43-3)/2) = (10, 20).
  assert.ok(near(lastPt.x, 10) && near(lastPt.y, 20), "last point mapped to local coords");
});

test("keeps the endpoint's incoming handle at the seam", () => {
  const orig = [
    { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 3, y: 0 } },
    { p: { x: 10, y: 0 }, hIn: { x: 7, y: 0 }, hOut: null }, // endpoint with an incoming handle
  ];
  const world = [1, 0, 0, 1, 0, 0];
  const inverse = invertMatrix(world);
  const tail = [{ x: 10, y: 10 }, { x: 10, y: 20 }];
  const out = buildExtendedAnchors(orig, tail, world, inverse, 0.5);
  assert.deepEqual(out[1].hIn, { x: 7, y: 0 }, "seam anchor inherits the original incoming handle");
});
