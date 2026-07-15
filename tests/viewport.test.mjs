import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let fitBoundsInViewport;
let worldToScreen;
let screenToWorld;
let zoomAt;
let rotateAt;
let snapAngleToQuarter;

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const nearPoint = (a, b, eps = 1e-9) => {
  near(a.x, b.x, eps);
  near(a.y, b.y, eps);
};

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({
    fitBoundsInViewport,
    worldToScreen,
    screenToWorld,
    zoomAt,
    rotateAt,
    snapAngleToQuarter,
  } = await server.ssrLoadModule("/src/model/viewport.ts"));
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

test("screenToWorld inverts worldToScreen under rotation", () => {
  const vp = { scale: 1.5, rotation: Math.PI / 5, offset: { x: 40, y: -20 } };
  const world = { x: 12, y: 34 };
  nearPoint(screenToWorld(vp, worldToScreen(vp, world)), world);
});

test("rotateAt keeps the anchor point fixed on screen", () => {
  const vp = { scale: 2, rotation: 0.2, offset: { x: 30, y: 15 } };
  const anchor = { x: 120, y: 80 };
  const rotated = rotateAt(vp, anchor, Math.PI / 3);
  near(rotated.rotation, vp.rotation + Math.PI / 3);
  near(rotated.scale, vp.scale);
  // The world point under the anchor stays under it after the twist.
  nearPoint(
    worldToScreen(rotated, screenToWorld(vp, anchor)),
    anchor,
    1e-8
  );
});

test("zoomAt preserves rotation and pins the anchor", () => {
  const vp = { scale: 1, rotation: Math.PI / 4, offset: { x: 10, y: 10 } };
  const anchor = { x: 200, y: 150 };
  const zoomed = zoomAt(vp, anchor, 2);
  near(zoomed.rotation, vp.rotation);
  near(zoomed.scale, 2);
  nearPoint(worldToScreen(zoomed, screenToWorld(vp, anchor)), anchor, 1e-8);
});

test("snapAngleToQuarter snaps near quarter turns and passes through the rest", () => {
  const q = Math.PI / 2;
  // Within the default ~7° threshold of a quarter turn -> snaps exactly.
  near(snapAngleToQuarter(q + 0.05), q);
  near(snapAngleToQuarter(-q - 0.05), -q);
  near(snapAngleToQuarter(0.04), 0);
  // Well away from any quarter turn -> unchanged.
  const free = q * 0.5;
  near(snapAngleToQuarter(free), free);
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
