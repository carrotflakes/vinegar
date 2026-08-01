// pickupOpenPath: the shared preparation behind "continue this open path",
// used by the pen (any path) and the pencil (a selected one only).

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let useEditor;
let pickupOpenPath;

// Identity viewport, so screen coordinates are world coordinates.
const ctx = { hitScale: () => 1 };

const path = (id, patch = {}) => ({
  id,
  name: id,
  type: "path",
  ...SHAPE_BASE,
  ...NODE_BASE,
  subpaths: [
    {
      anchors: [
        { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 3, y: 0 } },
        { p: { x: 100, y: 0 }, hIn: { x: 97, y: 0 }, hOut: null },
      ],
      closed: false,
    },
  ],
  fillRule: "nonzero",
  opacity: 1,
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
  ...patch,
});

const pickup = (screen, requireSelected) =>
  pickupOpenPath(ctx, useEditor.getState(), screen, { requireSelected });

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ pickupOpenPath } = await server.ssrLoadModule(
    "/src/canvas/tools/openPathPickup.ts"
  ));
});

beforeEach(() => {
  useEditor.getState().newDocument();
  useEditor
    .getState()
    .setViewport({ offset: { x: 0, y: 0 }, scale: 1, rotation: 0, flipX: false });
});

after(async () => server.close());

test("picking up the end appends to the path as it stands", () => {
  useEditor.getState().addShape(path("p"));
  const got = pickup({ x: 100, y: 0 }, false);
  assert.equal(got.base.id, "p");
  assert.deepEqual(got.base.subpaths[0].anchors[1].p, { x: 100, y: 0 });
});

test("picking up the start reverses the path, so both tools only append", () => {
  useEditor.getState().addShape(path("p"));
  const got = pickup({ x: 0, y: 0 }, false);
  const anchors = got.base.subpaths[0].anchors;
  assert.deepEqual(anchors[0].p, { x: 100, y: 0 }, "the old end leads");
  assert.deepEqual(
    anchors[anchors.length - 1].p,
    { x: 0, y: 0 },
    "the picked-up point is now the endpoint"
  );
});

test("the generator link is dropped — drawing by hand overrides the geometry", () => {
  useEditor
    .getState()
    .addShape(path("p", { generator: { scriptId: "s", params: {} } }));
  assert.equal(pickup({ x: 100, y: 0 }, false).base.generator, null);
});

test("requireSelected is the pencil's deliberateness rule", () => {
  useEditor.getState().addShape(path("p"), false);
  useEditor.getState().setSelection([]);
  assert.equal(pickup({ x: 100, y: 0 }, true), null, "not selected: no pickup");
  assert.ok(pickup({ x: 100, y: 0 }, false), "the pen takes it anyway");
  useEditor.getState().setSelection(["p"]);
  assert.ok(pickup({ x: 100, y: 0 }, true), "selected: the pencil takes it too");
});

test("nothing within the grab radius means no pickup", () => {
  useEditor.getState().addShape(path("p"));
  assert.equal(pickup({ x: 50, y: 0 }, false), null, "mid-path is not an end");
  assert.equal(pickup({ x: 300, y: 300 }, false), null);
});

test("the world/inverse pair maps the path's space both ways", () => {
  useEditor.getState().addShape(path("p", { transform: [2, 0, 0, 2, 5, 3] }));
  // Local (100, 0) -> world (205, 3).
  const got = pickup({ x: 205, y: 3 }, false);
  assert.ok(got, "the endpoint is found at its transformed position");
  assert.deepEqual(got.world, [2, 0, 0, 2, 5, 3]);
  // `+ 0` normalises the -0 the inversion produces, which strict equality
  // (Object.is) would otherwise reject.
  const expected = [0.5, 0, 0, 0.5, -2.5, -1.5];
  got.inverse.forEach((v, i) => assert.equal(v + 0, expected[i]));
});
