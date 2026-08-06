import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let computeSnap;

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const box = (x, y, width, height) => ({ x, y, width, height });

const ctx = (boxes) => ({
  targets: { x: [], y: [] },
  boxes,
  gridSize: null,
  guideLines: { x: [], y: [] },
});

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ computeSnap } = await server.ssrLoadModule("/src/model/geometry/snap.ts"));
});

after(async () => {
  await server.close();
});

// Two boxes 20 apart; dragging a third past the row's end snaps to the same gap.
test("continues an existing gap past the end of a row", () => {
  const row = [box(0, 0, 40, 40), box(60, 0, 40, 40)];
  const result = computeSnap(box(123, 0, 40, 40), ctx(row), 8);
  near(result.dx, -3); // 100 + 20 = 120
  near(result.dy, 0);
  // The new gap plus the source gap it repeats.
  assert.equal(result.spacings.length, 2);
  assert.deepEqual(
    result.spacings.map((s) => [s.a, s.b, s.horizontal]),
    [
      [100, 120, true],
      [40, 60, true],
    ]
  );
});

test("matches a gap on the near side of a row too", () => {
  const row = [box(0, 0, 40, 40), box(60, 0, 40, 40)];
  const result = computeSnap(box(-63, 0, 40, 40), ctx(row), 8);
  near(result.dx, 3); // 0 - 20 - 40 = -60
});

test("matches an existing gap on the vertical axis", () => {
  const column = [box(0, 0, 40, 40), box(0, 60, 40, 40)];
  const result = computeSnap(box(0, 118, 40, 40), ctx(column), 8);
  near(result.dx, 0);
  near(result.dy, 2);
  assert.ok(result.spacings.every((s) => !s.horizontal));
});

test("still centres between two neighbours", () => {
  const pair = [box(0, 0, 40, 40), box(160, 0, 40, 40)];
  const result = computeSnap(box(78, 0, 40, 40), ctx(pair), 8);
  near(result.dx, 2); // centred: 40 + (120 - 40) / 2 = 80
  assert.equal(result.spacings.length, 2);
});

test("does not squeeze a gap match into an occupied slot", () => {
  // Gap of 20 exists, but the slot right after box A is filled by box B.
  const row = [box(0, 0, 40, 40), box(60, 0, 40, 40), box(120, 0, 40, 40)];
  // 40 + 20 = 60 would land on B; no snap should pull it there.
  const result = computeSnap(box(58, 200, 40, 40), ctx(row), 8);
  near(result.dx, 0);
});

test("ignores boxes that do not overlap on the cross axis", () => {
  const row = [box(0, 0, 40, 40), box(60, 0, 40, 40)];
  const result = computeSnap(box(123, 500, 40, 40), ctx(row), 8);
  near(result.dx, 0);
  assert.equal(result.spacings.length, 0);
});

test("prefers the nearer of two candidate gaps", () => {
  // Gaps of 20 and 60 both exist in the band.
  const row = [box(0, 0, 40, 40), box(60, 0, 40, 40), box(160, 0, 40, 40)];
  // After the last box: 200 + 20 = 220 or 200 + 60 = 260. 218 is nearest 220.
  const result = computeSnap(box(218, 0, 40, 40), ctx(row), 8);
  near(result.dx, 2);
});
