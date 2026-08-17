// Where a bucket fill lands in the tree. The region itself is covered by
// bucketFill.test.mjs; this is about which container receives the result.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let useEditor;
let bucketFillAt;
let parentIdOf;
let nodeWorldBounds;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ bucketFillAt } = await server.ssrLoadModule(
    "/src/canvas/tools/bucketTool.ts"
  ));
  ({ parentIdOf } = await server.ssrLoadModule("/src/model/scene.ts"));
  ({ nodeWorldBounds } = await server.ssrLoadModule(
    "/src/model/geometry/bounds.ts"
  ));
});

after(async () => server.close());

const IDENTITY = [1, 0, 0, 1, 0, 0];
const RED = { type: "solid", color: "#ff0000", alpha: 1 };

const strokedRect = (id, x, y, w, h) => ({
  ...NODE_BASE,
  ...SHAPE_BASE,
  id,
  name: id,
  type: "rect",
  x,
  y,
  width: w,
  height: h,
  cornerRadius: 0,
  stroke: { type: "solid", color: "#000000", alpha: 1 },
  strokeWidth: 2,
  transform: [...IDENTITY],
});

const filledRect = (id, x, y, w, h) => ({
  ...strokedRect(id, x, y, w, h),
  stroke: null,
  strokeWidth: 0,
  fill: { type: "solid", color: "#00ff00", alpha: 1 },
});

const frame = (id, childIds, over = {}) => ({
  ...NODE_BASE,
  id,
  name: id,
  type: "frame",
  childIds,
  width: 200,
  height: 200,
  background: null,
  clipsContent: true,
  transform: [...IDENTITY],
  ...over,
});

/** Load `nodes`/`rootIds` into the store with a fill colour ready to paint. */
function load(nodes, rootIds) {
  const base = useEditor.getState().doc;
  useEditor.getState().loadDocument({
    ...base,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    rootIds,
  });
  useEditor.setState({
    style: { ...useEditor.getState().style, fill: RED },
  });
}

/** The one node the fill added. */
function addedId(before) {
  const after = Object.keys(useEditor.getState().doc.nodes);
  const added = after.filter((id) => !before.includes(id));
  assert.equal(added.length, 1, `expected one new node, got ${added.length}`);
  return added[0];
}

test("a fill lands in the frame whose ink enclosed it, behind that ink", () => {
  load([frame("f", ["sq"]), strokedRect("sq", 20, 20, 100, 100)], ["f"]);
  const before = Object.keys(useEditor.getState().doc.nodes);
  bucketFillAt(useEditor.getState(), { x: 70, y: 70 });

  const id = addedId(before);
  const doc = useEditor.getState().doc;
  assert.equal(parentIdOf(doc, id), "f");
  // Backmost inside the frame, so the square's stroke keeps painting over it.
  assert.deepEqual(doc.nodes.f.childIds, [id, "sq"]);
  assert.deepEqual(doc.rootIds, ["f"]);
});

test("a frame transform is baked out, so the fill stays where it was clicked", () => {
  load(
    [
      frame("f", ["sq"], { transform: [1, 0, 0, 1, 500, 300] }),
      strokedRect("sq", 20, 20, 100, 100),
    ],
    ["f"]
  );
  const before = Object.keys(useEditor.getState().doc.nodes);
  // Frame-local (20..120) is world (520..420+…): click the middle of the square.
  bucketFillAt(useEditor.getState(), { x: 570, y: 370 });

  const id = addedId(before);
  const doc = useEditor.getState().doc;
  assert.equal(parentIdOf(doc, id), "f");
  const b = nodeWorldBounds(doc, id);
  assert.ok(b.x > 519 && b.x < 522, `world x ${b.x} should sit at the square`);
  assert.ok(b.y > 319 && b.y < 322, `world y ${b.y} should sit at the square`);
});

test("without a frame the fill still goes to the back of the scene", () => {
  load([strokedRect("sq", 20, 20, 100, 100)], ["sq"]);
  const before = Object.keys(useEditor.getState().doc.nodes);
  bucketFillAt(useEditor.getState(), { x: 70, y: 70 });

  const id = addedId(before);
  assert.equal(parentIdOf(useEditor.getState().doc, id), null);
  assert.deepEqual(useEditor.getState().doc.rootIds, [id, "sq"]);
});

test("a cover inside a frame still places the fill just above it", () => {
  load([frame("f", ["bg"]), filledRect("bg", 20, 20, 100, 100)], ["f"]);
  const before = Object.keys(useEditor.getState().doc.nodes);
  bucketFillAt(useEditor.getState(), { x: 70, y: 70 });

  const id = addedId(before);
  const doc = useEditor.getState().doc;
  assert.equal(parentIdOf(doc, id), "f");
  assert.deepEqual(doc.nodes.f.childIds, ["bg", id]);
});

test("a locked frame does not take the fill", () => {
  // Locked means not editable, so it cannot receive new children either. The
  // fill still happens — it just lands in the scene, as it did before frames.
  load(
    [frame("f", ["sq"], { locked: true }), strokedRect("sq", 20, 20, 100, 100)],
    ["f"]
  );
  const before = Object.keys(useEditor.getState().doc.nodes);
  bucketFillAt(useEditor.getState(), { x: 70, y: 70 });

  const id = addedId(before);
  const doc = useEditor.getState().doc;
  assert.equal(parentIdOf(doc, id), null);
  assert.deepEqual(doc.nodes.f.childIds, ["sq"]);
});

test("an empty frame fills to its own edges, inside itself", () => {
  load([frame("f", [])], ["f"]);
  const before = Object.keys(useEditor.getState().doc.nodes);
  bucketFillAt(useEditor.getState(), { x: 100, y: 100 });

  const id = addedId(before);
  const doc = useEditor.getState().doc;
  assert.equal(parentIdOf(doc, id), "f");
  const b = nodeWorldBounds(doc, id);
  assert.ok(Math.abs(b.x) < 1 && Math.abs(b.y) < 1, `origin ${b.x},${b.y}`);
  assert.ok(
    Math.abs(b.width - 200) < 1 && Math.abs(b.height - 200) < 1,
    `size ${b.width}x${b.height}`
  );
});
