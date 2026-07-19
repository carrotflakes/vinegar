import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let computeBucketFill;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ computeBucketFill } = await server.ssrLoadModule("/src/model/bucketFill.ts"));
});

after(async () => {
  await server.close();
});

const IDENTITY = [1, 0, 0, 1, 0, 0];

const shape = (over) => ({
  id: over.id ?? `shape_${Math.random().toString(36).slice(2)}`,
  name: "Shape",
  transform: [...IDENTITY],
  transformOrigin: null,
  opacity: 1,
  fill: null,
  stroke: null,
  strokeWidth: 0,
  ...over,
});

const doc = (shapes) => ({
  nodes: Object.fromEntries(shapes.map((s) => [s.id, s])),
  rootIds: shapes.map((s) => s.id),
  symbols: {},
  scripts: {},
  artboards: [],
  settings: { unit: "px", dpi: 96, gridSize: 50 },
  metadata: { createdAt: "", modifiedAt: "" },
  assets: {},
  extensions: {},
});

const strokedRect = (id, x, y, w, h) =>
  shape({
    id,
    type: "rect",
    x,
    y,
    width: w,
    height: h,
    stroke: { type: "solid", color: "#000000", alpha: 1 },
    strokeWidth: 2,
  });

function polyBounds(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const p of ring) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Even-odd point-in-polys test matching how PolygonShape renders. */
function insidePolys(polys, pt) {
  let crossings = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a.y > pt.y !== b.y > pt.y) {
          const x = a.x + ((pt.y - a.y) / (b.y - a.y)) * (b.x - a.x);
          if (x > pt.x) crossings++;
        }
      }
    }
  }
  return crossings % 2 === 1;
}

test("fills the interior of a stroke-only rectangle", () => {
  const d = doc([strokedRect("r", 0, 0, 100, 100)]);
  const result = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  assert.equal(result.kind, "filled");
  assert.ok(insidePolys(result.polys, { x: 50, y: 50 }));
  // Ink covers [-1, 1] around each edge; the fill tucks under it (bleed 0.5)
  // but must stay inside the stroke band.
  const b = polyBounds(result.polys);
  assert.ok(b.minX > -1 && b.minX < 1.05, `minX ${b.minX}`);
  assert.ok(b.maxX > 99 && b.maxX < 101, `maxX ${b.maxX}`);
  assert.ok(b.minY > -1 && b.minY < 1.05, `minY ${b.minY}`);
  assert.ok(b.maxY > 99 && b.maxY < 101, `maxY ${b.maxY}`);
});

test("reports an unenclosed click as open", () => {
  const d = doc([strokedRect("r", 0, 0, 100, 100)]);
  const result = computeBucketFill(d, null, { x: -50, y: -50 }, 4);
  assert.equal(result.kind, "open");
});

test("reports a click on painted ink as inked", () => {
  const d = doc([
    shape({
      id: "r",
      type: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: { type: "solid", color: "#ff0000", alpha: 1 },
    }),
  ]);
  const result = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  assert.equal(result.kind, "inked");
});

test("gap tolerance closes small gaps and respects small tolerances", () => {
  // An open box outline with a 20-unit gap in the top edge.
  const c = shape({
    id: "c",
    type: "path",
    closed: false,
    points: [
      { x: 40, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 60, y: 0 },
    ],
    stroke: { type: "solid", color: "#000000", alpha: 1 },
    strokeWidth: 2,
  });
  const d = doc([c]);
  assert.equal(computeBucketFill(d, null, { x: 50, y: 50 }, 30).kind, "filled");
  assert.equal(computeBucketFill(d, null, { x: 50, y: 50 }, 4).kind, "open");
});

test("an island inside the region becomes a hole of the fill", () => {
  const d = doc([
    strokedRect("outer", 0, 0, 100, 100),
    strokedRect("inner", 40, 40, 20, 20),
  ]);
  const result = computeBucketFill(d, null, { x: 20, y: 50 }, 4);
  assert.equal(result.kind, "filled");
  assert.ok(insidePolys(result.polys, { x: 20, y: 50 }));
  // The inner rectangle's interior is a separate region, not painted here.
  assert.ok(!insidePolys(result.polys, { x: 50, y: 50 }));
});

test("hidden nodes do not bound the fill", () => {
  const d = doc([{ ...strokedRect("r", 0, 0, 100, 100), hidden: true }]);
  const result = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  assert.equal(result.kind, "open");
});
