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

/** Even-odd point-in-polys test matching bucket-result path rendering. */
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

test("reports a click on stroke ink as inked", () => {
  const d = doc([strokedRect("r", 0, 0, 100, 100)]);
  // (0, 50) sits on the centerline of the left stroke band.
  const result = computeBucketFill(d, null, { x: 0, y: 50 }, 4);
  assert.equal(result.kind, "inked");
});

test("gap tolerance closes small gaps and respects small tolerances", () => {
  // An open box outline with a 20-unit gap in the top edge.
  const c = shape({
    id: "c",
    type: "path",
    subpaths: [{
      closed: false,
      anchors: [
        { x: 40, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 60, y: 0 },
      ].map((p) => ({ p, hIn: null, hOut: null })),
    }],
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

const filledRect = (id, x, y, w, h, color = "#ff0000") =>
  shape({
    id,
    type: "rect",
    x,
    y,
    width: w,
    height: h,
    fill: { type: "solid", color, alpha: 1 },
  });

test("clicking a bare filled shape fills its whole area as a cover", () => {
  const d = doc([filledRect("bg", 0, 0, 100, 100)]);
  const result = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  assert.equal(result.kind, "filled");
  assert.equal(result.coverId, "bg");
  const b = polyBounds(result.polys);
  assert.ok(Math.abs(b.minX) < 0.01 && Math.abs(b.maxX - 100) < 0.01);
  assert.ok(Math.abs(b.minY) < 0.01 && Math.abs(b.maxY - 100) < 0.01);
});

test("filling over a background is bounded by strokes drawn on top", () => {
  const d = doc([
    filledRect("bg", 0, 0, 100, 100),
    strokedRect("square", 30, 30, 40, 40),
  ]);
  const result = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  assert.equal(result.kind, "filled");
  assert.equal(result.coverId, "bg");
  assert.ok(insidePolys(result.polys, { x: 50, y: 50 }));
  assert.ok(!insidePolys(result.polys, { x: 10, y: 10 }));
  const b = polyBounds(result.polys);
  assert.ok(b.minX > 28 && b.maxX < 72, `bounds ${b.minX}..${b.maxX}`);
});

test("filling the open part of a background stops at its edge", () => {
  const d = doc([
    filledRect("bg", 0, 0, 100, 100),
    strokedRect("square", 30, 30, 40, 40),
  ]);
  const result = computeBucketFill(d, null, { x: 10, y: 10 }, 4);
  assert.equal(result.kind, "filled");
  assert.equal(result.coverId, "bg");
  assert.ok(insidePolys(result.polys, { x: 10, y: 10 }));
  // The stroked square's interior belongs to a different region.
  assert.ok(!insidePolys(result.polys, { x: 50, y: 50 }));
  // Clipped exactly to the cover: no bleed past the background's edge.
  const b = polyBounds(result.polys);
  assert.ok(b.minX > -0.01 && b.maxX < 100.01, `bounds ${b.minX}..${b.maxX}`);
});

test("the topmost cover under the click wins", () => {
  const d = doc([
    filledRect("paper", 0, 0, 200, 200, "#ffffff"),
    filledRect("card", 50, 50, 100, 100, "#4488ff"),
  ]);
  const result = computeBucketFill(d, null, { x: 100, y: 100 }, 4);
  assert.equal(result.kind, "filled");
  assert.equal(result.coverId, "card");
  const b = polyBounds(result.polys);
  assert.ok(b.minX > 49.9 && b.maxX < 150.1, `bounds ${b.minX}..${b.maxX}`);
});

test("ink hidden under the cover does not bound the fill", () => {
  // The stroked square is painted *before* the background, so the background
  // completely hides it; the fill must span the whole cover regardless.
  const d = doc([
    strokedRect("under", 30, 30, 40, 40),
    filledRect("bg", 0, 0, 100, 100),
  ]);
  const result = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  assert.equal(result.kind, "filled");
  assert.equal(result.coverId, "bg");
  assert.ok(insidePolys(result.polys, { x: 50, y: 50 }));
  assert.ok(insidePolys(result.polys, { x: 10, y: 10 }));
  const b = polyBounds(result.polys);
  assert.ok(Math.abs(b.minX) < 0.01 && Math.abs(b.maxX - 100) < 0.01);
});

test("clicking a stroke over a background still reports inked", () => {
  const d = doc([
    filledRect("bg", 0, 0, 100, 100),
    strokedRect("square", 30, 30, 40, 40),
  ]);
  const result = computeBucketFill(d, null, { x: 30, y: 50 }, 4);
  assert.equal(result.kind, "inked");
});

test("centerline mode fills up to stroke centers", () => {
  const rect = strokedRect("r", 0, 0, 100, 100);
  rect.strokeWidth = 4; // band spans [-2, 2] around each edge
  const d = doc([rect]);
  const edge = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  const center = computeBucketFill(d, null, { x: 50, y: 50 }, 4, true);
  assert.equal(edge.kind, "filled");
  assert.equal(center.kind, "filled");
  // Default mode stays inside the painted band; centerline mode reaches the
  // geometric edge (0), overshooting only by the bleed.
  const bEdge = polyBounds(edge.polys);
  const bCenter = polyBounds(center.polys);
  assert.ok(bEdge.minX > 1 && bEdge.minX < 2.1, `edge minX ${bEdge.minX}`);
  assert.ok(
    bCenter.minX > -0.6 && bCenter.minX < 0.2,
    `center minX ${bCenter.minX}`
  );
});

test("centerline mode applies to brush strokes", () => {
  const brushStroke = (id, pts) =>
    shape({
      id,
      type: "brush",
      anchors: pts.map((p) => ({ p, hIn: null, hOut: null, w: 1 })),
      stroke: { type: "solid", color: "#000000", alpha: 1 },
      strokeWidth: 8, // envelope spans [-4, 4] around the centerline
    });
  const d = doc([
    brushStroke("top", [{ x: 0, y: 0 }, { x: 100, y: 0 }]),
    brushStroke("right", [{ x: 100, y: 0 }, { x: 100, y: 100 }]),
    brushStroke("bottom", [{ x: 100, y: 100 }, { x: 0, y: 100 }]),
    brushStroke("left", [{ x: 0, y: 100 }, { x: 0, y: 0 }]),
  ]);
  const edge = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  const center = computeBucketFill(d, null, { x: 50, y: 50 }, 4, true);
  assert.equal(edge.kind, "filled");
  assert.equal(center.kind, "filled");
  const bEdge = polyBounds(edge.polys);
  const bCenter = polyBounds(center.polys);
  assert.ok(bEdge.minX > 3 && bEdge.minX < 4.1, `edge minX ${bEdge.minX}`);
  assert.ok(
    bCenter.minX > -0.6 && bCenter.minX < 0.2,
    `center minX ${bCenter.minX}`
  );
});

test("hidden nodes do not bound the fill", () => {
  const d = doc([{ ...strokedRect("r", 0, 0, 100, 100), hidden: true }]);
  const result = computeBucketFill(d, null, { x: 50, y: 50 }, 4);
  assert.equal(result.kind, "open");
});
