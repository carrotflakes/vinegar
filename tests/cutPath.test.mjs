import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let cutPathAtNodes;
let hasCuttableNodes;
let joinShapes;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ cutPathAtNodes, hasCuttableNodes } = await server.ssrLoadModule(
    "/src/model/cutPath.ts"
  ));
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

const anchor = (x, y, hIn = null, hOut = null) => ({ p: { x, y }, hIn, hOut });
const openPath = (...pts) => ({
  closed: false,
  anchors: pts.map(([x, y]) => anchor(x, y)),
});

test("splits an open subpath at an interior anchor into two", () => {
  const shape = pathShape([openPath([0, 0], [10, 0], [20, 0])]);
  const out = cutPathAtNodes(shape, [{ sub: 0, index: 1 }]);
  assert.ok(out);
  assert.equal(out.subpaths.length, 2);
  assert.equal(out.subpaths[0].anchors.length, 2);
  assert.equal(out.subpaths[1].anchors.length, 2);
  // Both pieces share the severed anchor's position.
  assert.deepEqual(out.subpaths[0].anchors[1].p, { x: 10, y: 0 });
  assert.deepEqual(out.subpaths[1].anchors[0].p, { x: 10, y: 0 });
});

test("distributes handles so the cut preserves the drawn curve", () => {
  const mid = anchor(10, 0, { x: 8, y: -2 }, { x: 12, y: 2 });
  const shape = pathShape([
    { closed: false, anchors: [anchor(0, 0), mid, anchor(20, 0)] },
  ]);
  const out = cutPathAtNodes(shape, [{ sub: 0, index: 1 }]);
  const left = out.subpaths[0].anchors[1];
  const right = out.subpaths[1].anchors[0];
  assert.deepEqual(left.hIn, { x: 8, y: -2 });
  assert.equal(left.hOut, null);
  assert.equal(right.hIn, null);
  assert.deepEqual(right.hOut, { x: 12, y: 2 });
});

test("cut then join round-trips back to the original contour", () => {
  const mid = anchor(10, 0, { x: 8, y: -2 }, { x: 12, y: 2 });
  const shape = pathShape([
    { closed: false, anchors: [anchor(0, 0), mid, anchor(20, 0)] },
  ]);
  const cut = cutPathAtNodes(shape, [{ sub: 0, index: 1 }]);
  const rejoined = joinShapes([cut], 0.001);
  assert.ok(rejoined);
  assert.equal(rejoined.subpaths.length, 1);
  assert.equal(rejoined.subpaths[0].anchors.length, 3);
  const junction = rejoined.subpaths[0].anchors[1];
  assert.deepEqual(junction.p, { x: 10, y: 0 });
  assert.deepEqual(junction.hIn, { x: 8, y: -2 });
  assert.deepEqual(junction.hOut, { x: 12, y: 2 });
});

test("opens a closed subpath at one anchor without splitting it", () => {
  const shape = pathShape([
    { closed: true, anchors: [anchor(0, 0), anchor(10, 0), anchor(10, 10)] },
  ]);
  const out = cutPathAtNodes(shape, [{ sub: 0, index: 1 }]);
  assert.ok(out);
  assert.equal(out.subpaths.length, 1);
  assert.equal(out.subpaths[0].closed, false);
  // Reopened at the cut: starts and ends at that anchor's position.
  const anchors = out.subpaths[0].anchors;
  assert.deepEqual(anchors[0].p, { x: 10, y: 0 });
  assert.deepEqual(anchors[anchors.length - 1].p, { x: 10, y: 0 });
});

test("splits a closed subpath at two anchors into two open pieces", () => {
  const shape = pathShape([
    {
      closed: true,
      anchors: [anchor(0, 0), anchor(10, 0), anchor(10, 10), anchor(0, 10)],
    },
  ]);
  const out = cutPathAtNodes(shape, [
    { sub: 0, index: 1 },
    { sub: 0, index: 3 },
  ]);
  assert.ok(out);
  assert.equal(out.subpaths.length, 2);
  assert.ok(out.subpaths.every((sp) => !sp.closed));
});

test("ignores endpoint-only selections on an open subpath", () => {
  const shape = pathShape([openPath([0, 0], [10, 0], [20, 0])]);
  assert.equal(cutPathAtNodes(shape, [{ sub: 0, index: 0 }]), null);
  assert.equal(cutPathAtNodes(shape, [{ sub: 0, index: 2 }]), null);
  assert.equal(hasCuttableNodes(shape, [{ sub: 0, index: 0 }]), false);
  assert.equal(hasCuttableNodes(shape, [{ sub: 0, index: 1 }]), true);
});
