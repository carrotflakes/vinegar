import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let boundsSnapTargets;
let resizeFromCenter;
let aspectAboutCenter;
let pickArtboardBorder;

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const nearBounds = (a, b, eps = 1e-9) => {
  near(a.x, b.x, eps);
  near(a.y, b.y, eps);
  near(a.width, b.width, eps);
  near(a.height, b.height, eps);
};

const board = (id, x, y, width, height) => ({
  id,
  name: id,
  x,
  y,
  width,
  height,
  background: null,
});

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ boundsSnapTargets } = await server.ssrLoadModule(
    "/src/model/geometry/snap.ts"
  ));
  ({ resizeFromCenter, aspectAboutCenter, pickArtboardBorder } =
    await server.ssrLoadModule("/src/canvas/tools/artboardTool.ts"));
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

// ---- resizeFromCenter (Alt) -------------------------------------------------

test("resizeFromCenter keeps the centre fixed for a corner drag", () => {
  const orig = { x: 0, y: 0, width: 100, height: 100 };
  // Centre is (50, 50). Drag SE handle to (80, 90): half-extents 30 and 40.
  nearBounds(resizeFromCenter(orig, "se", { x: 80, y: 90 }), {
    x: 20,
    y: 10,
    width: 60,
    height: 80,
  });
});

test("resizeFromCenter mirrors past the centre (absolute half-extent)", () => {
  const orig = { x: 0, y: 0, width: 100, height: 100 };
  // Drag the E handle left of centre: width = 2*|x - cx|, centre stays.
  nearBounds(resizeFromCenter(orig, "e", { x: 20, y: 999 }), {
    x: 20,
    y: 0,
    width: 60,
    height: 100,
  });
});

test("resizeFromCenter only drives the axis its handle owns", () => {
  const orig = { x: 0, y: 0, width: 100, height: 100 };
  // The N edge handle changes height only; width is untouched.
  nearBounds(resizeFromCenter(orig, "n", { x: 999, y: 10 }), {
    x: 0,
    y: 10,
    width: 100,
    height: 80,
  });
});

// ---- aspectAboutCenter (Shift+Alt) -----------------------------------------

test("aspectAboutCenter restores the original ratio using the larger scale", () => {
  const orig = { x: 0, y: 0, width: 100, height: 50 }; // ratio 2:1
  // A rect scaled 1.5x wide / 3x tall snaps to the 3x (larger) uniform scale.
  const rect = { x: 0, y: 0, width: 150, height: 150 };
  nearBounds(aspectAboutCenter(rect, orig), {
    x: -100,
    y: -50,
    width: 300,
    height: 150,
  });
});

test("aspectAboutCenter preserves the original centre", () => {
  const orig = { x: 10, y: 10, width: 40, height: 20 }; // centre (30, 20)
  const out = aspectAboutCenter({ x: 0, y: 0, width: 80, height: 20 }, orig);
  near(out.x + out.width / 2, 30);
  near(out.y + out.height / 2, 20);
  // Larger scale is width 80/40 = 2x → 80 x 40, keeps 2:1.
  near(out.width / out.height, 2);
});

// ---- pickArtboardBorder -----------------------------------------------------

test("pickArtboardBorder hits near an edge but misses the interior", () => {
  const boards = [board("a", 0, 0, 100, 100)];
  // On the left edge, within tolerance.
  assert.equal(pickArtboardBorder(boards, { x: 1, y: 50 }, 3)?.id, "a");
  // Deep interior: no border hit (falls through to marquee / picking).
  assert.equal(pickArtboardBorder(boards, { x: 50, y: 50 }, 3), null);
  // Well outside the outer tolerance band.
  assert.equal(pickArtboardBorder(boards, { x: 200, y: 50 }, 3), null);
});

test("pickArtboardBorder accepts a point just outside the outline", () => {
  const boards = [board("a", 0, 0, 100, 100)];
  assert.equal(pickArtboardBorder(boards, { x: -2, y: 50 }, 3)?.id, "a");
  assert.equal(pickArtboardBorder(boards, { x: -5, y: 50 }, 3), null);
});

test("pickArtboardBorder returns the topmost overlapping board", () => {
  const boards = [
    board("under", 0, 0, 100, 100),
    board("over", 90, 0, 100, 100),
  ];
  // x=91 is interior of "under" but on the left border of "over"; the
  // front-to-back scan picks the later (topmost) board.
  assert.equal(pickArtboardBorder(boards, { x: 91, y: 50 }, 3)?.id, "over");
});
