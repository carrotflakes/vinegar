import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let boundsSnapTargets;
let pickFrameBorder;
let frameDropTarget;

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const frame = (id, x, y, width, height) => ({
  id,
  name: id,
  type: "frame",
  clipsContent: true,
  ...NODE_BASE,
  transform: [1, 0, 0, 1, x, y],
  transformOrigin: null,
  opacity: 1,
  width,
  height,
  background: null,
  childIds: [],
});

const frameDoc = (...frames) => ({
  nodes: Object.fromEntries(frames.map((f) => [f.id, f])),
  rootIds: frames.map((f) => f.id),
  symbols: {},
});

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ boundsSnapTargets } = await server.ssrLoadModule(
    "/src/model/geometry/snap.ts"
  ));
  ({ pickFrameBorder } = await server.ssrLoadModule("/src/canvas/picking.ts"));
  ({ frameDropTarget } = await server.ssrLoadModule(
    "/src/canvas/tools/selectTool.ts"
  ));
});

after(async () => server.close());

// ---- boundsSnapTargets ------------------------------------------------------

test("boundsSnapTargets emits left/center/right and top/middle/bottom lines", () => {
  const { x, y } = boundsSnapTargets([{ x: 10, y: 20, width: 100, height: 40 }]);
  assert.deepEqual(
    x.map((c) => c.value),
    [10, 60, 110]
  );
  assert.deepEqual(
    y.map((c) => c.value),
    [20, 40, 60]
  );
  // Each x candidate carries the box's vertical extent (and vice versa).
  for (const c of x) {
    near(c.lo, 20);
    near(c.hi, 60);
  }
  for (const c of y) {
    near(c.lo, 10);
    near(c.hi, 110);
  }
});

test("boundsSnapTargets concatenates every box's candidates", () => {
  const { x, y } = boundsSnapTargets([
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 100, y: 100, width: 20, height: 20 },
  ]);
  assert.equal(x.length, 6);
  assert.equal(y.length, 6);
});

test("boundsSnapTargets on an empty list yields no candidates", () => {
  const { x, y } = boundsSnapTargets([]);
  assert.equal(x.length, 0);
  assert.equal(y.length, 0);
});

// ---- pickFrameBorder --------------------------------------------------------

test("pickFrameBorder hits near an edge but misses the interior", () => {
  const doc = frameDoc(frame("a", 0, 0, 100, 100));
  // On the left edge, within tolerance.
  assert.equal(pickFrameBorder(doc, { x: 1, y: 50 }, 3), "a");
  // Deep interior: no border hit (falls through to marquee / picking).
  assert.equal(pickFrameBorder(doc, { x: 50, y: 50 }, 3), null);
  // Well outside the outer tolerance band.
  assert.equal(pickFrameBorder(doc, { x: 200, y: 50 }, 3), null);
});

test("pickFrameBorder accepts a point just outside the outline", () => {
  const doc = frameDoc(frame("a", 0, 0, 100, 100));
  assert.equal(pickFrameBorder(doc, { x: -2, y: 50 }, 3), "a");
  assert.equal(pickFrameBorder(doc, { x: -5, y: 50 }, 3), null);
});

test("pickFrameBorder returns the topmost overlapping frame", () => {
  const doc = frameDoc(frame("under", 0, 0, 100, 100), frame("over", 90, 0, 100, 100));
  // x=91 is interior of "under" but on the left border of "over"; the
  // front-to-back scan picks the later (topmost) frame.
  assert.equal(pickFrameBorder(doc, { x: 91, y: 50 }, 3), "over");
});

test("pickFrameBorder skips hidden and locked frames", () => {
  for (const flag of ["hidden", "locked"]) {
    const doc = frameDoc({ ...frame("a", 0, 0, 100, 100), [flag]: true });
    assert.equal(pickFrameBorder(doc, { x: 1, y: 50 }, 3), null, flag);
  }
  // An unlocked frame behind a locked one still takes the hit.
  const doc = frameDoc(
    frame("under", 0, 0, 100, 100),
    { ...frame("over", 90, 0, 100, 100), locked: true }
  );
  assert.equal(pickFrameBorder(doc, { x: 99, y: 50 }, 3), "under");
});

// ---- frameDropTarget --------------------------------------------------------

const movedRect = (id, x, y) => ({
  id,
  name: id,
  type: "rect",
  ...SHAPE_BASE, cornerRadius: 0,
  ...NODE_BASE,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  fill: { type: "solid", color: "#111111", alpha: 1 },
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  transform: [1, 0, 0, 1, x, y],
  transformOrigin: null,
});

/** A doc holding top-level frames plus one loose rect being dragged. */
const dropDoc = (rect, ...frames) => ({
  nodes: Object.fromEntries([...frames, rect].map((n) => [n.id, n])),
  rootIds: [...frames.map((f) => f.id), rect.id],
  symbols: {},
});

test("frameDropTarget finds the frame under the moved bounds' centre", () => {
  const doc = dropDoc(movedRect("r", 45, 45), frame("a", 0, 0, 100, 100));
  assert.equal(frameDropTarget(doc, ["r"]), "a");
  // Centre outside every frame: drops back out to the scene root.
  assert.equal(frameDropTarget(dropDoc(movedRect("r", 500, 500), frame("a", 0, 0, 100, 100)), ["r"]), null);
});

test("frameDropTarget refuses hidden and locked frames", () => {
  for (const flag of ["hidden", "locked"]) {
    const doc = dropDoc(movedRect("r", 45, 45), {
      ...frame("a", 0, 0, 100, 100),
      [flag]: true,
    });
    // Dropping in would make the art invisible / unselectable, so the drag
    // falls through to the frame behind — here, none.
    assert.equal(frameDropTarget(doc, ["r"]), null, flag);
  }
});
