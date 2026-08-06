import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let G;
let movedPaint;
let rasterKey;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  G = await server.ssrLoadModule("/src/model/gradient.ts");
  ({ movedPaint } = await server.ssrLoadModule("/src/canvas/tools/gradientTool.ts"));
  ({ rasterKey } = await server.ssrLoadModule("/src/canvas/render/gradient.ts"));
});

after(async () => server.close());

const BOUNDS = { x: 0, y: 0, width: 200, height: 100 };
const ramp = () => [G.gradientStop("#000000", 0), G.gradientStop("#ffffff", 1)];
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test("a bounds-relative gradient maps the unit square onto the shape", () => {
  const paint = G.gradient(ramp());
  assert.deepEqual(G.gradientMatrix(paint, BOUNDS), [200, 0, 0, 100, 0, 50]);
  // The same gradient pinned to local units ignores the box entirely.
  const local = G.gradient(ramp(), { space: "local", start: { x: 10, y: 20 }, end: { x: 30, y: 20 } });
  assert.deepEqual(G.gradientMatrix(local, BOUNDS), [20, 0, 0, 20, 10, 20]);
});

test("a radial gradient over a non-square box is an ellipse, not a circle", () => {
  const paint = G.gradient(ramp(), { kind: "radial" });
  const m = G.gradientMatrix(paint, BOUNDS);
  assert.equal(G.isSimilarity(m), false);
  // Half the width across, half the height down, centred.
  assert.deepEqual(m, [100, 0, 0, 50, 100, 50]);
  // A square box makes it a circle again, which Canvas can draw natively.
  assert.equal(G.isSimilarity(G.gradientMatrix(paint, { x: 0, y: 0, width: 80, height: 80 })), true);
});

test("linear endpoints reproduce the ramp under a squashed matrix", () => {
  // 45° in unit space over a 2:1 box: the drawn direction is not the unit one,
  // but t must still be 0 at the start and 1 at the end.
  const paint = G.gradient(ramp(), { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
  const m = G.gradientMatrix(paint, BOUNDS);
  const { from, to } = G.linearEndpoints(m);
  const axis = { x: to.x - from.x, y: to.y - from.y };
  const len2 = axis.x * axis.x + axis.y * axis.y;
  const t = (p) => ((p.x - from.x) * axis.x + (p.y - from.y) * axis.y) / len2;
  close(t({ x: 0, y: 0 }), 0, "start of the ramp");
  close(t({ x: 200, y: 100 }), 1, "end of the ramp");
});

test("stop expansion bakes midpoints and OkLab into extra stops", () => {
  const even = G.renderStops(G.gradient(ramp()));
  assert.deepEqual(even.map((s) => s.offset), [0, 1], "sRGB with even midpoints needs no samples");

  const skewed = G.gradient([
    G.gradientStop("#000000", 0, { midpoint: 0.25 }),
    G.gradientStop("#ffffff", 1),
  ]);
  const expanded = G.renderStops(skewed);
  assert.ok(expanded.length > 2, "an off-centre midpoint is sampled");
  // The halfway colour lands at the midpoint, not at 0.5.
  const half = G.sampleRamp(expanded, 0.25);
  assert.equal(half.color, "#808080");
  assert.notEqual(G.sampleRamp(expanded, 0.5).color, "#808080");

  const oklab = G.renderStops(G.gradient(ramp(), { interpolation: "oklab" }));
  assert.ok(oklab.length > 2, "a non-sRGB space is sampled");
  // OkLab's midpoint between black and white is an even *lightness* step,
  // which is a darker grey than halving the sRGB channels.
  const mid = G.sampleRamp(oklab, 0.5).color;
  assert.match(mid, /^#(\w\w)\1\1$/, "still neutral");
  assert.ok(mid < "#808080", `${mid} is darker than the sRGB midpoint`);
});

test("the paint's own alpha multiplies every stop", () => {
  const stops = G.renderStops(G.gradient(ramp(), { alpha: 0.5 }));
  assert.deepEqual(stops.map((s) => s.alpha), [0.5, 0.5]);
});

test("repeat and reflect tile the ramp across the covered range", () => {
  const stops = [
    { offset: 0, color: "#000000", alpha: 1 },
    { offset: 1, color: "#ffffff", alpha: 1 },
  ];
  assert.deepEqual(G.cycleRange(-0.3, 1.8, "pad"), { from: 0, to: 1 });
  const range = G.cycleRange(-0.3, 1.8, "repeat");
  assert.deepEqual(range, { from: -1, to: 2 });

  const repeated = G.tiledStops(stops, "repeat", range);
  assert.deepEqual(
    repeated.map((s) => s.color),
    ["#000000", "#ffffff", "#000000", "#ffffff", "#000000", "#ffffff"]
  );
  // Reflect mirrors every odd cycle, so neighbouring cycles meet in one colour.
  const reflected = G.tiledStops(stops, "reflect", { from: 0, to: 2 });
  assert.deepEqual(
    reflected.map((s) => s.color),
    ["#000000", "#ffffff", "#000000"]
  );
});

test("reversing a ramp mirrors offsets and the midpoints between them", () => {
  const paint = G.gradient([
    G.gradientStop("#ff0000", 0, { midpoint: 0.25 }),
    G.gradientStop("#00ff00", 0.4),
    G.gradientStop("#0000ff", 1),
  ]);
  const reversed = G.reverseStops(paint);
  assert.deepEqual(
    reversed.stops.map((s) => [s.color, s.offset]),
    [["#0000ff", 0], ["#00ff00", 0.6], ["#ff0000", 1]]
  );
  // The gap that was 0.25-biased now belongs to the other neighbour, flipped.
  assert.deepEqual(reversed.stops.map((s) => s.midpoint), [0.5, 0.75, 0.5]);
});

test("switching placement converts the geometry instead of moving it", () => {
  const paint = G.gradient(ramp());
  const local = G.withGradientSpace(paint, "local", BOUNDS);
  assert.equal(local.space, "local");
  assert.deepEqual(local.start, { x: 0, y: 50 });
  assert.deepEqual(local.end, { x: 200, y: 50 });
  // And back again.
  assert.deepEqual(G.withGradientSpace(local, "bounds", BOUNDS).start, { x: 0, y: 0.5 });
  // Without bounds there is nothing to convert through, so it resets.
  assert.deepEqual(G.withGradientSpace(paint, "local", null).start, { x: 0, y: 0.5 });
});

test("spinning a linear ramp turns it about its middle", () => {
  const paint = G.gradient(ramp(), { space: "local", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  const turned = G.withGradientAngle(paint, Math.PI / 2);
  close(turned.start.x, 5, "start x");
  close(turned.start.y, -5, "start y");
  close(turned.end.x, 5, "end x");
  close(turned.end.y, 5, "end y");
  // A radial ramp keeps its centre instead.
  const radial = G.withGradientAngle({ ...paint, kind: "radial" }, Math.PI / 2);
  assert.deepEqual(radial.start, { x: 0, y: 0 });
});

test("dragging a stop handle projects the pointer onto the axis", () => {
  const paint = G.gradient(ramp(), { space: "local", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  const id = paint.stops[1].id;
  // Off the axis: only the along-axis component counts (the chips sit in a
  // gutter beside the line, so the pointer is never exactly on it).
  const moved = movedPaint(paint, { type: "stop", id }, paint, { x: 30, y: 13 }, false);
  close(moved.stops[1].offset, 0.3, "offset");
  // And it cannot leave the ramp.
  const clamped = movedPaint(paint, { type: "stop", id }, paint, { x: 500, y: 0 }, false);
  close(clamped.stops[1].offset, 1, "clamped offset");
});

test("dragging a radial centre carries its radius along", () => {
  const paint = G.gradient(ramp(), {
    kind: "radial",
    space: "local",
    start: { x: 0, y: 0 },
    end: { x: 50, y: 0 },
  });
  const moved = movedPaint(paint, { type: "start" }, paint, { x: 10, y: 20 }, false);
  assert.deepEqual(moved.start, { x: 10, y: 20 });
  assert.deepEqual(moved.end, { x: 60, y: 20 });
  // The aspect handle measures across the axis, in axis lengths.
  const squashed = movedPaint(paint, { type: "ratio" }, paint, { x: 0, y: 25 }, false);
  close(squashed.ratio, 0.5, "ratio");
  // A focal point is clamped inside the unit circle.
  const focal = movedPaint(paint, { type: "focal" }, paint, { x: 500, y: 0 }, false);
  close(focal.focal.x, 0.99, "focal x");
});

test("raster keys describe the pixels, not the paint object", () => {
  const rect = { x: -4, y: -4, width: 208, height: 108 };
  const m = [100, 0, 0, 50, 100, 50];
  const key = (paint) => rasterKey(paint, m, rect, 208, 108);
  const a = G.gradient(ramp(), { kind: "radial" });
  // A separate object with the same content must reuse the cached raster: every
  // document edit hands the renderer fresh paints for unchanged artwork.
  assert.equal(key(a), key(G.gradient(ramp(), { kind: "radial" })));
  // Stop ids are identity, not appearance, so they must not enter the key.
  assert.equal(key(a), key({ ...a, stops: a.stops.map((s) => ({ ...s, id: "x" + s.id })) }));
  // Anything that changes a pixel does.
  assert.notEqual(key(a), key({ ...a, ratio: 2 }));
  assert.notEqual(key(a), key({ ...a, spread: "repeat" }));
  assert.notEqual(key(a), key({ ...a, interpolation: "oklab" }));
  assert.notEqual(key(a), key(G.updateStop(a, a.stops[0].id, { color: "#123456" })));
  assert.notEqual(key(a), key(G.updateStop(a, a.stops[0].id, { midpoint: 0.2 })));
  assert.notEqual(key(a), rasterKey(a, [100, 0, 0, 50, 101, 50], rect, 208, 108));
  assert.notEqual(key(a), rasterKey(a, m, rect, 416, 216));
});
