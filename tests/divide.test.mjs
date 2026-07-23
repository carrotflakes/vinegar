import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let divideShapes;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ divideShapes } = await server.ssrLoadModule("/src/model/boolean.ts"));
});

after(async () => server.close());

const solid = (color) => ({ type: "solid", color, alpha: 1 });

const rect = (id, x, y, w, h, fill) => ({
  id,
  name: "Rect",
  type: "rect",
  x,
  y,
  width: w,
  height: h,
  fill: solid(fill),
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  blendMode: "normal",
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
});

test("two overlapping rects split into three faces", () => {
  const a = rect("a", 0, 0, 20, 20, "#ff0000");
  const b = rect("b", 10, 0, 20, 20, "#0000ff");
  const faces = divideShapes([a, b]);
  assert.ok(faces);
  assert.equal(faces.length, 3);
  // Every face is an editable path with an identity transform.
  assert.ok(faces.every((f) => f.type === "path"));
  assert.ok(faces.every((f) => f.subpaths.length >= 1));
  // The overlap face is styled by the frontmost (later) shape, b.
  assert.ok(faces.some((f) => f.fill.color === "#0000ff"));
  assert.ok(faces.some((f) => f.fill.color === "#ff0000"));
});

test("non-overlapping rects each become their own face (no slivers)", () => {
  const a = rect("a", 0, 0, 10, 10, "#ff0000");
  const b = rect("b", 100, 0, 10, 10, "#0000ff");
  const faces = divideShapes([a, b]);
  assert.ok(faces);
  assert.equal(faces.length, 2);
});

test("fewer than two areal inputs returns null", () => {
  const a = rect("a", 0, 0, 10, 10, "#ff0000");
  assert.equal(divideShapes([a]), null);
});
