import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let strokeOutline;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ strokeOutline } = await server.ssrLoadModule("/src/model/outlineStroke.ts"));
});

after(async () => {
  await server.close();
});

const IDENTITY = [1, 0, 0, 1, 0, 0];

function compoundDocument(strokeAlignment) {
  const child = {
    id: "child",
    name: "Child",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    transform: [...IDENTITY],
    transformOrigin: null,
    opacity: 1,
    fill: null,
    stroke: null,
    strokeWidth: 0,
  };
  const compound = {
    id: "compound",
    name: "Compound",
    type: "compoundPath",
    childIds: [child.id],
    transform: [...IDENTITY],
    transformOrigin: null,
    opacity: 1,
    fill: null,
    stroke: { type: "solid", color: "#000000", alpha: 1 },
    strokeWidth: 10,
    strokeAlignment,
  };
  return {
    compound,
    doc: {
      nodes: {
        [child.id]: child,
        [compound.id]: compound,
      },
      rootIds: [compound.id],
      symbols: {},
      scripts: {},
      artboards: [],
      settings: { unit: "px", dpi: 96, gridSize: 50 },
      metadata: { createdAt: "", modifiedAt: "" },
      assets: {},
      extensions: {},
    },
  };
}

/** Even-odd point-in-polygons test matching the outlined path fill. */
function insidePolys(polys, point) {
  let crossings = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a.y > point.y !== b.y > point.y) {
          const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
          if (x > point.x) crossings++;
        }
      }
    }
  }
  return crossings % 2 === 1;
}

test("outlines an inside-aligned compound stroke inside its silhouette", () => {
  const { compound, doc } = compoundDocument("inside");
  const result = strokeOutline(compound, undefined, doc);

  assert.ok(result);
  assert.equal(insidePolys(result, { x: 5, y: 50 }), true);
  assert.equal(insidePolys(result, { x: -5, y: 50 }), false);
});

test("outlines an outside-aligned compound stroke outside its silhouette", () => {
  const { compound, doc } = compoundDocument("outside");
  const result = strokeOutline(compound, undefined, doc);

  assert.ok(result);
  assert.equal(insidePolys(result, { x: -5, y: 50 }), true);
  assert.equal(insidePolys(result, { x: 5, y: 50 }), false);
});
