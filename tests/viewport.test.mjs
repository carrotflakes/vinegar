import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let fitBoundsInViewport;
let worldToScreen;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ fitBoundsInViewport, worldToScreen } =
    await server.ssrLoadModule("/src/model/viewport.ts"));
});

after(async () => server.close());

test("fit viewport centres bounds and preserves the requested padding", () => {
  const viewport = fitBoundsInViewport(
    { x: 100, y: 50, width: 400, height: 200 },
    { width: 1000, height: 600 },
    50
  );

  assert.equal(viewport.scale, 2.25);
  assert.deepEqual(viewport.offset, { x: -175, y: -37.5 });
  assert.deepEqual(worldToScreen(viewport, { x: 100, y: 50 }), { x: 50, y: 75 });
  assert.deepEqual(worldToScreen(viewport, { x: 500, y: 250 }), { x: 950, y: 525 });
});

test("fit viewport handles lines and points without infinite zoom", () => {
  const line = fitBoundsInViewport(
    { x: 10, y: 20, width: 0, height: 100 },
    { width: 500, height: 300 },
    50
  );
  assert.equal(line.scale, 2);
  assert.deepEqual(worldToScreen(line, { x: 10, y: 70 }), { x: 250, y: 150 });

  const point = fitBoundsInViewport(
    { x: -20, y: 30, width: 0, height: 0 },
    { width: 500, height: 300 }
  );
  assert.equal(point.scale, 1);
  assert.deepEqual(worldToScreen(point, { x: -20, y: 30 }), { x: 250, y: 150 });
});

test("fit viewport respects the editor zoom limits", () => {
  const tiny = fitBoundsInViewport(
    { x: 0, y: 0, width: 0.01, height: 0.01 },
    { width: 800, height: 600 },
    40
  );
  assert.equal(tiny.scale, 64);

  const huge = fitBoundsInViewport(
    { x: 0, y: 0, width: 1_000_000, height: 1_000_000 },
    { width: 800, height: 600 },
    40
  );
  assert.equal(huge.scale, 0.05);
});
