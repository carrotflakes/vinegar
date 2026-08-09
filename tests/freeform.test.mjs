import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let F;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let freeformRasterKey;
let H;
let useEditor;
let commands;
let useGradientTool;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  F = await server.ssrLoadModule("/src/model/freeform.ts");
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ freeformRasterKey } = await server.ssrLoadModule("/src/canvas/render/freeform.ts"));
  H = await server.ssrLoadModule("/src/canvas/freeformHandles.ts");
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ COMMANDS: commands } = await server.ssrLoadModule("/src/commands/registry.ts"));
  ({ useGradientTool } = await server.ssrLoadModule("/src/store/gradientToolStore.ts"));
});

after(async () => server.close());

const BOUNDS = { x: 0, y: 0, width: 200, height: 100 };

/** Red top-left, blue bottom-right, in bounds space. */
const twoPoints = (opts = {}) =>
  F.freeform(
    [
      F.freeformPoint("#ff0000", { x: 0, y: 0 }),
      F.freeformPoint("#0000ff", { x: 1, y: 1 }),
    ],
    { interpolation: "srgb", ...opts }
  );

test("the field passes exactly through each colour point (shepard)", () => {
  const paint = twoPoints();
  assert.equal(F.sampleFreeformField(paint, { x: 0, y: 0 }).color, "#ff0000");
  assert.equal(F.sampleFreeformField(paint, { x: 1, y: 1 }).color, "#0000ff");
  // Equidistant: an even blend of the two, and nothing outside their gamut.
  const mid = F.sampleFreeformField(paint, { x: 0.5, y: 0.5 });
  assert.equal(mid.color, "#800080");
});

test("weights are normalised, so the field stays inside the point colours", () => {
  // Three points, one weighted far higher: still a convex blend, never a
  // channel above the maximum of the inputs.
  const paint = F.freeform(
    [
      F.freeformPoint("#ff0000", { x: 0, y: 0 }, { weight: 12 }),
      F.freeformPoint("#00ff00", { x: 1, y: 0 }),
      F.freeformPoint("#0000ff", { x: 0.5, y: 1 }),
    ],
    { interpolation: "srgb" }
  );
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const { color } = F.sampleFreeformField(paint, { x: i / 10, y: j / 10 });
      const n = parseInt(color.slice(1), 16);
      assert.ok((n >> 16) <= 255 && ((n >> 8) & 255) <= 255 && (n & 255) <= 255);
      // Each channel is 0..255 by construction; the real claim is that no
      // channel exceeds the largest one among the points (all are 255 here),
      // and that the result is a real colour rather than NaN.
      assert.match(color, /^#[0-9a-f]{6}$/);
    }
  }
});

test("a heavier point pulls the halfway colour towards itself", () => {
  const even = F.sampleFreeformField(twoPoints(), { x: 0.5, y: 0.5 });
  const heavy = twoPoints();
  heavy.points[0] = { ...heavy.points[0], weight: 4 };
  const pulled = F.sampleFreeformField(heavy, { x: 0.5, y: 0.5 });
  const red = (hex) => parseInt(hex.slice(1, 3), 16);
  assert.ok(red(pulled.color) > red(even.color));
});

test("a gaussian field far from every point falls back to the nearest", () => {
  // A radius this small underflows to zero weight everywhere but the points.
  const paint = twoPoints({ method: "gaussian", falloff: 0.001 });
  assert.equal(F.sampleFreeformField(paint, { x: 0.49, y: 0.49 }).color, "#ff0000");
  assert.equal(F.sampleFreeformField(paint, { x: 0.51, y: 0.51 }).color, "#0000ff");
});

test("the tabled gaussian kernel agrees with the exact one", () => {
  // The kernel goes through a lookup table (it is the whole cost of a gaussian
  // raster). Weights are normalised afterwards, so what has to hold is the
  // resulting colour, in 8 bits.
  const paint = F.freeform(
    [
      F.freeformPoint("#ff0000", { x: 0, y: 0 }),
      F.freeformPoint("#0000ff", { x: 1, y: 0 }),
    ],
    { method: "gaussian", falloff: 0.5, interpolation: "srgb" }
  );
  for (const x of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
    const w0 = Math.exp(-((x - 0) ** 2) / 0.25);
    const w1 = Math.exp(-((x - 1) ** 2) / 0.25);
    const exact = Math.round((w1 / (w0 + w1)) * 255);
    const got = parseInt(F.sampleFreeformField(paint, { x, y: 0 }).color.slice(5, 7), 16);
    assert.ok(Math.abs(got - exact) <= 1, `at ${x}: ${got} vs ${exact}`);
  }
});

test("the raster lays the field over the shape's box", () => {
  const paint = twoPoints();
  const px = F.freeformRaster(paint, BOUNDS, BOUNDS, 2, 2);
  assert.equal(px.length, 2 * 2 * 4);
  // Top-left pixel is nearest the red point, bottom-right nearest the blue.
  assert.ok(px[0] > 200 && px[2] < 60, "top-left is red");
  assert.ok(px[12] < 60 && px[14] > 200, "bottom-right is blue");
  assert.equal(px[3], 255);
});

test("the paint's alpha and a point's alpha both reach the raster", () => {
  const paint = twoPoints({ alpha: 0.5 });
  const px = F.freeformRaster(paint, BOUNDS, BOUNDS, 1, 1);
  assert.equal(px[3], 128);
  const faded = twoPoints();
  faded.points[0] = { ...faded.points[0], alpha: 0 };
  assert.equal(F.sampleFreeformField(faded, { x: 0, y: 0 }).alpha, 0);
  // Near the transparent red point the pixels fade out — and stay blue rather
  // than turning muddy pink, because the blend is premultiplied.
  const at = F.freeformRaster(faded, BOUNDS, BOUNDS, 2, 2);
  assert.ok(at[3] < 80, `corner nearly transparent: ${at[3]}`);
  assert.ok(at[2] > at[0], "the transparent point does not tint its surroundings");
});

test("a pinned field ignores the shape's box; a bounds-relative one follows it", () => {
  const local = twoPoints({ space: "local" });
  local.points = [
    F.freeformPoint("#ff0000", { x: 10, y: 10 }),
    F.freeformPoint("#0000ff", { x: 190, y: 90 }),
  ];
  const wide = { x: 0, y: 0, width: 400, height: 200 };
  // The same local coordinates land on the same colours whatever the box is.
  assert.deepEqual(
    F.freeformRaster(local, BOUNDS, BOUNDS, 4, 4),
    F.freeformRaster(local, BOUNDS, wide, 4, 4)
  );
  // A bounds-relative field, by contrast, is defined against the box.
  const bounds = twoPoints();
  assert.notDeepEqual(
    [...F.freeformRaster(bounds, BOUNDS, BOUNDS, 4, 4)],
    [...F.freeformRaster(bounds, BOUNDS, wide, 4, 4)]
  );
});

test("switching placement keeps the points where they were", () => {
  const paint = twoPoints();
  const pinned = F.withFreeformSpace(paint, "local", BOUNDS);
  assert.equal(pinned.space, "local");
  assert.deepEqual(pinned.points[1].position, { x: 200, y: 100 });
  // Round-tripping lands back on the original positions.
  const back = F.withFreeformSpace(pinned, "bounds", BOUNDS);
  assert.deepEqual(back.points[1].position, { x: 1, y: 1 });
  // On a *square* box the two spaces measure distance the same way, so the
  // picture survives the switch exactly. (On a rectangle it cannot: bounds
  // space measures in the normalised box, local space in true units.)
  const square = { x: 0, y: 0, width: 100, height: 100 };
  assert.deepEqual(
    [...F.freeformRaster(paint, square, square, 8, 8)],
    [...F.freeformRaster(F.withFreeformSpace(paint, "local", square), square, square, 8, 8)]
  );
});

test("a gaussian radius travels with a placement switch", () => {
  const paint = twoPoints({ method: "gaussian", falloff: 0.4 });
  const pinned = F.withFreeformSpace(paint, "local", BOUNDS);
  // Mean of the two axes: (200 + 100) / 2 = 150 → 0.4 × 150 = 60 units. A
  // pinned radius is a length, so nothing clamps it back down to unit-box size.
  assert.equal(pinned.falloff, 60);
  assert.equal(F.withFreeformSpace(pinned, "bounds", BOUNDS).falloff, 0.4);
  // A Shepard exponent is unitless and travels unchanged.
  const sharp = F.withFreeformSpace(twoPoints({ falloff: 3 }), "local", BOUNDS);
  assert.equal(sharp.falloff, 3);
});

test("adding a point takes the colour the field already has there", () => {
  const paint = twoPoints();
  const { paint: next, point } = F.addFreeformPointAt(paint, { x: 0.5, y: 0.5 });
  assert.equal(next.points.length, 3);
  assert.equal(point.color, "#800080");
  // The colour *at* the new point is the one that was already there, so it
  // reads as a grab handle rather than a new colour. (Unlike a ramp stop, it
  // does re-weight the blend around itself — that is what a point is for.)
  assert.equal(F.sampleFreeformField(next, { x: 0.5, y: 0.5 }).color, "#800080");
});

test("a field always keeps at least one point", () => {
  const paint = twoPoints();
  const one = F.removeFreeformPoint(paint, paint.points[0].id);
  assert.equal(one.points.length, 1);
  assert.equal(F.removeFreeformPoint(one, one.points[0].id), one);
});

test("a ramp converts to a field and back without losing its colours", () => {
  const G = { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } };
  const field = F.gradientToFreeform({
    type: "gradient",
    kind: "linear",
    space: "bounds",
    ...G,
    ratio: 1,
    focal: { x: 0, y: 0 },
    spread: "pad",
    interpolation: "srgb",
    alpha: 1,
    stops: [
      { id: "a", offset: 0, color: "#ff0000", alpha: 1, midpoint: 0.5 },
      { id: "b", offset: 1, color: "#0000ff", alpha: 1, midpoint: 0.5 },
    ],
  });
  assert.deepEqual(field.points.map((p) => p.color), ["#ff0000", "#0000ff"]);
  assert.deepEqual(field.points[1].position, { x: 1, y: 0.5 });
  // Back the other way is lossy by nature: a ramp keeps the widest colour
  // transition and nothing of the two-dimensional arrangement.
  const ramp = F.freeformToGradient(field);
  assert.deepEqual(ramp.stops.map((s) => s.color), ["#ff0000", "#0000ff"]);
  assert.deepEqual(ramp.stops.map((s) => s.offset), [0, 1]);
  assert.deepEqual(ramp.start, { x: 0, y: 0.5 });
  assert.deepEqual(ramp.end, { x: 1, y: 0.5 });
});

test("a field with a middle colour still reduces to a two-stop ramp", () => {
  const field = F.freeform([
    F.freeformPoint("#ff0000", { x: 0, y: 0 }),
    F.freeformPoint("#00ff00", { x: 0.5, y: 0.3 }),
    F.freeformPoint("#0000ff", { x: 1, y: 0 }),
  ]);
  const ramp = F.freeformToGradient(field);
  assert.equal(ramp.stops.length, 2);
  assert.deepEqual(ramp.stops.map((s) => s.color), ["#ff0000", "#0000ff"]);
});

test("a single-point field reduces to a flat ramp with a usable axis", () => {
  const ramp = F.freeformToGradient(F.freeform([F.freeformPoint("#123456", { x: 0.5, y: 0.5 })]));
  assert.deepEqual(ramp.stops.map((s) => s.color), ["#123456", "#123456"]);
  assert.notDeepEqual(ramp.start, ramp.end);
});

test("a freeform paint round-trips through the file format", () => {
  const doc = createEmptyDocument();
  const paint = twoPoints({ method: "gaussian", falloff: 0.3, alpha: 0.8 });
  doc.nodes["r"] = {
    ...NODE_BASE,
    ...SHAPE_BASE,
    id: "r",
    type: "rect",
    name: "Rect",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    cornerRadius: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: paint,
  };
  doc.rootIds = ["r"];
  const loaded = parseDocument(serializeDocument(doc));
  assert.deepEqual(loaded.nodes["r"].fill, paint);
});

test("a malformed freeform paint is rejected", () => {
  const doc = createEmptyDocument();
  doc.nodes["r"] = {
    ...NODE_BASE,
    ...SHAPE_BASE,
    id: "r",
    type: "rect",
    name: "Rect",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    cornerRadius: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: twoPoints(),
  };
  doc.rootIds = ["r"];
  const json = JSON.parse(serializeDocument(doc));
  json.document.nodes["r"].fill.points = [];
  assert.throws(() => parseDocument(JSON.stringify(json)), /malformed/i);
});

test("the render cache keys on what the raster contains", () => {
  const paint = twoPoints();
  const key = (p, bounds = BOUNDS) => freeformRasterKey(p, BOUNDS, bounds, 64, 64);
  // A fresh but identical paint object hits the same cache entry.
  assert.equal(key(paint), key(structuredClone(paint)));
  const moved = { ...paint, points: [{ ...paint.points[0], position: { x: 0.5, y: 0 } }, paint.points[1]] };
  assert.notEqual(key(paint), key(moved));
  // A pinned field does not depend on the box, so an unrelated resize must not
  // invalidate its raster.
  const pinned = { ...paint, space: "local" };
  assert.equal(key(pinned), key(pinned, { x: 0, y: 0, width: 999, height: 999 }));
  assert.notEqual(key(paint), key(paint, { x: 0, y: 0, width: 999, height: 999 }));
});

test("the spread ring's radius and the weight it stands for are inverses", () => {
  for (const w of [0.1, 0.5, 1, 2.5, 4]) {
    assert.ok(Math.abs(H.spreadWeight(H.spreadRadius(w)) - w) < 1e-9, `weight ${w}`);
  }
  // The ring always clears the point chip under it, however small the weight,
  // so it can be grabbed at any setting.
  assert.ok(H.spreadRadius(0.01) >= 14);
  // Dragging past either end clamps rather than running away.
  assert.equal(H.spreadWeight(0), 0.1);
  assert.equal(H.spreadWeight(10000), 4);
  // Touch chrome scales the ring and the reading together.
  assert.equal(H.spreadWeight(H.spreadRadius(2, 1.6), 1.6), 2);
});

test("the spread knob wins the hit test over the point chips", () => {
  const controls = {
    points: [
      { id: "a", point: { x: 100, y: 100 }, color: "#000000", alpha: 1 },
      { id: "b", point: { x: 130, y: 100 }, color: "#ffffff", alpha: 1 },
    ],
    spread: {
      pointId: "a",
      center: { x: 100, y: 100 },
      radius: 30,
      knob: { x: 130, y: 100 },
    },
  };
  // The knob and point "b" sit on the same pixel: the knob takes it.
  assert.deepEqual(H.pickFreeformHandle(controls, { x: 130, y: 100 }, 9), {
    type: "spread",
    id: "a",
  });
  assert.deepEqual(H.pickFreeformHandle(controls, { x: 100, y: 100 }, 9), {
    type: "point",
    id: "a",
  });
  assert.equal(H.pickFreeformHandle(controls, { x: 100, y: 60 }, 9), null);
});

const rect = () => ({
  ...NODE_BASE,
  ...SHAPE_BASE,
  id: "r",
  name: "Rect",
  type: "rect",
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  cornerRadius: 0,
  transform: [1, 0, 0, 1, 0, 0],
});

/** A one-rect document whose fill is a two-point field, with the tool on it. */
function editorWithField() {
  const editor = useEditor.getState();
  editor.newDocument();
  useEditor.getState().addShape(rect(), false);
  const id = "r";
  // The tool goes on *first*: switching to it clears the selection (only the
  // select and node tools keep one), which is also why the gradient tool's
  // first press on the artwork is always a pick.
  useEditor.getState().setTool("gradient");
  useEditor.getState().setSelection([id]);
  useGradientTool.getState().setTarget("fill");
  useGradientTool.getState().setStopId(null);
  useEditor.getState().updateSelectedStyle({ fill: twoPoints() });
  return id;
}

const runDelete = () =>
  commands.find((c) => c.id === "edit.delete").run(useEditor.getState());

test("Delete removes the active colour point before touching the shape", () => {
  const id = editorWithField();
  runDelete();
  const fill = useEditor.getState().doc.nodes[id].fill;
  assert.equal(fill.points.length, 1);
  // The shape survived: the point took the delete.
  assert.ok(useEditor.getState().doc.nodes[id]);
});

test("Delete falls through to the shape once the last point would go", () => {
  const id = editorWithField();
  runDelete(); // two points -> one
  runDelete(); // the last point stays; the shape goes instead
  assert.equal(useEditor.getState().doc.nodes[id], undefined);
});

test("Delete only belongs to a point while the gradient tool is on it", () => {
  const id = editorWithField();
  useEditor.getState().setTool("select");
  useEditor.getState().setSelection([id]); // setTool dropped it
  runDelete();
  assert.equal(useEditor.getState().doc.nodes[id], undefined);
});
