import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let parseDocument;
let serializeDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule(
    "/src/io/serialize.ts"
  ));
});

after(async () => server.close());

test("a representative document survives save and load", () => {
  const doc = createEmptyDocument();
  doc.groups.group = { id: "group", name: "Group", opacity: 0.8 };
  doc.shapes.rect = {
    id: "rect", type: "rect", name: "Rectangle", groupId: "group",
    x: 10, y: 20, width: 30, height: 40, rotation: 0.2,
    fill: "#123456", stroke: "#000000", strokeWidth: 2, opacity: 0.9,
  };
  doc.order = ["rect"];
  doc.settings.gridSize = 24;
  doc.extensions["vinegar.test"] = { enabled: true };

  const saved = serializeDocument(doc);
  const expected = JSON.parse(saved).document;

  assert.deepEqual(parseDocument(saved), expected);
});
