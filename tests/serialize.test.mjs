import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let worldShapeBounds;
let hitTestShape;
let marqueeHitShape;
let applyMatrix;
let rotationAbout;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule(
    "/src/io/serialize.ts"
  ));
  ({ worldShapeBounds } = await server.ssrLoadModule("/src/model/bounds.ts"));
  ({ hitTestShape, marqueeHitShape } = await server.ssrLoadModule(
    "/src/model/hitTest.ts"
  ));
  ({ applyMatrix, rotationAbout } = await server.ssrLoadModule(
    "/src/model/matrix.ts"
  ));
});

after(async () => server.close());

test("a representative document survives save and load", () => {
  const doc = createEmptyDocument();
  doc.groups.group = {
    id: "group", name: "Group", opacity: 0.8,
    transform: [1, 0, 0, 1, 100, 50],
    transformOrigin: { x: 15, y: 25 },
  };
  doc.shapes.rect = {
    id: "rect", type: "rect", name: "Rectangle", groupId: "group",
    x: 10, y: 20, width: 30, height: 40,
    transform: [2, 0, 0, 2, 0, 0],
    transformOrigin: { x: 12, y: 22 },
    fill: "#123456", stroke: "#000000", strokeWidth: 2, opacity: 0.9,
  };
  doc.order = ["rect"];
  doc.settings.gridSize = 24;
  doc.extensions["vinegar.test"] = { enabled: true };

  const saved = serializeDocument(doc);
  const expected = JSON.parse(saved).document;

  const loaded = parseDocument(saved);
  assert.deepEqual(loaded, expected);
  assert.deepEqual(worldShapeBounds(loaded, loaded.shapes.rect), {
    x: 120, y: 90, width: 60, height: 80,
  });
  assert.equal(hitTestShape(loaded, loaded.shapes.rect, { x: 150, y: 130 }, 1), true);
  const ellipse = { ...loaded.shapes.rect, type: "ellipse" };
  const ellipseDoc = {
    ...loaded,
    shapes: { ...loaded.shapes, rect: ellipse },
  };
  assert.equal(
    marqueeHitShape(ellipseDoc, ellipse, { x: 120, y: 90, width: 2, height: 2 }),
    false
  );
  const pivot = applyMatrix(
    rotationAbout({ x: 12, y: 22 }, 0.7),
    { x: 12, y: 22 }
  );
  assert.ok(Math.hypot(pivot.x - 12, pivot.y - 22) < 1e-9);
});
