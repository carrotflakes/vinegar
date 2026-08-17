// settleNewFrame: what happens to the scene a newly drawn frame lands on.
// Fully enclosed top-level nodes become children (rebased into frame-local
// space); partly covered ones stay put and push the frame behind them.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let settleNewFrame;

const frame = (id, x, y, width, height, childIds = []) => ({
  id,
  name: id,
  type: "frame",
  ...NODE_BASE,
  transform: [1, 0, 0, 1, x, y],
  clipsContent: true,
  width,
  height,
  background: "#ffffff",
  childIds,
});

const rect = (id, x, y, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform: [1, 0, 0, 1, x, y],
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  cornerRadius: 0,
  ...patch,
});

const doc = (nodes) => ({
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  rootIds: nodes.map((n) => n.id),
  symbols: {},
});

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ settleNewFrame } = await server.ssrLoadModule("/src/store/docOps.ts"));
});

after(async () => {
  await server.close();
});

test("a fully enclosed node becomes a child, rebased into frame space", () => {
  const next = settleNewFrame(
    doc([rect("r", 120, 140), frame("f", 100, 100, 200, 200)]),
    "f"
  );
  assert.deepEqual(next.nodes.f.childIds, ["r"]);
  assert.deepEqual(next.rootIds, ["f"]);
  assert.deepEqual(next.nodes.r.transform, [1, 0, 0, 1, 20, 40]);
});

test("an absorbed node's old slot is where the frame lands", () => {
  // back → front: behind, inside, front. The frame takes `inside`'s slot, so it
  // still paints over `behind` and under `front`.
  const next = settleNewFrame(
    doc([
      rect("behind", 0, 0),
      rect("inside", 120, 120),
      rect("front", 400, 400),
      frame("f", 100, 100, 200, 200),
    ]),
    "f"
  );
  assert.deepEqual(next.rootIds, ["behind", "f", "front"]);
  assert.deepEqual(next.nodes.f.childIds, ["inside"]);
});

test("a partly covered node stays out and pushes the frame behind it", () => {
  // `over` straddles the frame's left edge: not absorbed, and it would be
  // hidden by the frame background if the frame stayed in front.
  const next = settleNewFrame(
    doc([rect("over", 95, 120), rect("inside", 150, 150), frame("f", 100, 100, 200, 200)]),
    "f"
  );
  assert.deepEqual(next.rootIds, ["f", "over"]);
  assert.deepEqual(next.nodes.f.childIds, ["inside"]);
});

test("a frame over empty space keeps the frontmost slot", () => {
  const next = settleNewFrame(
    doc([rect("far", 900, 900), frame("f", 100, 100, 200, 200)]),
    "f"
  );
  assert.deepEqual(next.rootIds, ["far", "f"]);
  assert.deepEqual(next.nodes.f.childIds, []);
});

test("locked nodes are not absorbed but still hold the frame back", () => {
  const next = settleNewFrame(
    doc([rect("locked", 120, 120, { locked: true }), frame("f", 100, 100, 200, 200)]),
    "f"
  );
  assert.deepEqual(next.nodes.f.childIds, []);
  assert.deepEqual(next.rootIds, ["f", "locked"]);
});

test("hidden nodes are ignored entirely", () => {
  const next = settleNewFrame(
    doc([rect("gone", 120, 120, { hidden: true }), frame("f", 100, 100, 200, 200)]),
    "f"
  );
  assert.deepEqual(next.nodes.f.childIds, []);
  assert.deepEqual(next.rootIds, ["gone", "f"]);
});

test("other frames neither move nor reorder the new one", () => {
  const next = settleNewFrame(
    doc([frame("old", 110, 110, 20, 20), frame("f", 100, 100, 200, 200)]),
    "f"
  );
  assert.deepEqual(next.nodes.f.childIds, []);
  assert.deepEqual(next.rootIds, ["old", "f"]);
});
