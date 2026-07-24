import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";

let server;
let useEditor;
let pickLockedShape;

// pickLockedShape only touches ctx.hitScale() (via pickTolerance).
const ctx = { hitScale: () => 1 };
const at = (x, y) => pickLockedShape(ctx, { x, y });

const rect = (id, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  fill: { type: "solid", color: "#111111", alpha: 1 },
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
  ...patch,
});

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ pickLockedShape } = await server.ssrLoadModule("/src/canvas/picking.ts"));
});

beforeEach(() => useEditor.getState().newDocument());

after(async () => server.close());

test("pickLockedShape returns a lone locked shape under the cursor", () => {
  useEditor.getState().addShape(rect("locked", { locked: true }));
  assert.equal(at(50, 50), "locked");
});

test("pickLockedShape ignores a non-locked shape (normal picking wins)", () => {
  useEditor.getState().addShape(rect("free"));
  assert.equal(at(50, 50), null);
});

test("a locked shape on top of non-locked art is the move candidate", () => {
  useEditor.getState().addShape(rect("free")); // bottom
  useEditor.getState().addShape(rect("locked", { locked: true })); // top
  assert.equal(at(50, 50), "locked");
});

test("a non-locked shape on top of locked art falls through to null", () => {
  useEditor.getState().addShape(rect("locked", { locked: true })); // bottom
  useEditor.getState().addShape(rect("free")); // top
  assert.equal(at(50, 50), null);
});

test("pickLockedShape misses empty space", () => {
  useEditor.getState().addShape(rect("locked", { locked: true }));
  assert.equal(at(500, 500), null);
});
