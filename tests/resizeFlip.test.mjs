import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let constrainAspectRatio;
let createEmptyDocument;
let hitFrameHandle;
let matrixDeterminant;
let nodeWorldBounds;
let onSelectMove;
let resizeBounds;
let server;
let useEditor;
let worldToScreen;

const rect = (id, x, y, width, height, transform = [1, 0, 0, 1, 0, 0]) => ({
  id,
  name: id,
  type: "rect",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform,
  x,
  y,
  width,
  height,
  cornerRadius: 0,
});

const frame = (id) => ({
  id,
  name: id,
  type: "frame",
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  clipsContent: true,
  width: 10,
  height: 10,
  background: null,
  childIds: [],
});

const context = () => ({
  interaction: { current: { kind: "none" } },
  preview: { current: null },
  marquee: { current: null },
  penDraft: { current: null },
  penExtend: { current: null },
  lastInsert: { current: null },
  hover: { current: null },
  brushHover: { current: null },
  endpointHint: { current: null },
  closeHint: { current: null },
  guides: { current: [] },
  spacings: { current: [] },
  hitScale: () => 1,
  scheduleDraw() {},
});

function load(nodes, rootIds) {
  const empty = createEmptyDocument();
  useEditor.getState().loadDocument({
    ...empty,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootIds,
  });
}

function beginResize({
  ids,
  handle,
  from,
  frameTransform = [1, 0, 0, 1, 0, 0],
  lockAspect = false,
  frameChildren,
  selectionPivot,
  selectionTransform,
}) {
  const editor = useEditor.getState();
  editor.setSelection(ids);
  editor.beginInteraction("Resize selection");
  return {
    kind: "resize",
    handle,
    from,
    frameTransform,
    // selectTool collects these at drag start with the selection's own content
    // left out; these tests care about flip geometry, not alignment.
    targets: { x: [], y: [] },
    originals: Object.fromEntries(
      ids.map((id) => [id, useEditor.getState().doc.nodes[id]])
    ),
    single: ids.length === 1,
    lockAspect,
    frameChildren,
    selectionPivot,
    selectionTransform,
  };
}

function move(interaction, world, shift = false) {
  onSelectMove(
    context(),
    useEditor.getState(),
    interaction,
    world,
    world,
    shift
  );
}

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ nodeWorldBounds } = await server.ssrLoadModule(
    "/src/model/geometry/bounds.ts"
  ));
  ({ matrixDeterminant } = await server.ssrLoadModule(
    "/src/model/geometry/matrix.ts"
  ));
  ({ constrainAspectRatio, resizeBounds } = await server.ssrLoadModule(
    "/src/canvas/handles.ts"
  ));
  ({ onSelectMove } = await server.ssrLoadModule(
    "/src/canvas/tools/selectDrag.ts"
  ));
  ({ hitFrameHandle } = await server.ssrLoadModule("/src/canvas/picking.ts"));
  ({ worldToScreen } = await server.ssrLoadModule(
    "/src/model/geometry/viewport.ts"
  ));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

beforeEach(() => useEditor.getState().newDocument());

after(async () => server.close());

test("resize bounds retain the sign after crossing the fixed edge", () => {
  const from = { x: 0, y: 0, width: 10, height: 20 };
  assert.deepEqual(resizeBounds(from, "e", { x: -5, y: 10 }), {
    x: 0,
    y: 0,
    width: -5,
    height: 20,
  });
  assert.deepEqual(resizeBounds(from, "nw", { x: 15, y: 25 }), {
    x: 15,
    y: 25,
    width: -5,
    height: -5,
  });
});

test("aspect constraint preserves crossed axes", () => {
  const from = { x: 0, y: 0, width: 10, height: 10 };
  const freeCorner = resizeBounds(from, "se", { x: -20, y: 15 });
  assert.deepEqual(constrainAspectRatio(from, "se", freeCorner, 1), {
    x: 0,
    y: 0,
    width: -20,
    height: 20,
  });
  const freeEdge = resizeBounds(from, "e", { x: -20, y: 5 });
  assert.deepEqual(constrainAspectRatio(from, "e", freeEdge, 1), {
    x: 0,
    y: -5,
    width: -20,
    height: 20,
  });
});

test("a leaf flips at crossover and can cross back during the same drag", () => {
  load([rect("a", 0, 0, 10, 10)], ["a"]);
  const interaction = beginResize({
    ids: ["a"],
    handle: "e",
    from: { x: 0, y: 0, width: 10, height: 10 },
  });

  move(interaction, { x: -5, y: 5 });
  let shape = useEditor.getState().doc.nodes.a;
  assert.equal(shape.x, -5);
  assert.equal(shape.width, 5);
  assert.deepEqual(shape.transform, [-1, 0, 0, 1, -5, 0]);
  assert.equal(matrixDeterminant(shape.transform) < 0, true);
  assert.deepEqual(nodeWorldBounds(useEditor.getState().doc, "a"), {
    x: -5,
    y: 0,
    width: 5,
    height: 10,
  });

  move(interaction, { x: 20, y: 5 });
  shape = useEditor.getState().doc.nodes.a;
  assert.equal(shape.x, 0);
  assert.equal(shape.width, 20);
  assert.deepEqual(shape.transform, [1, 0, 0, 1, 0, 0]);

  move(interaction, { x: -5, y: 5 });
  useEditor.getState().endInteraction();
  assert.equal(
    useEditor.getState().history.past.at(-1)?.label,
    "Resize selection"
  );
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.nodes.a.transform, [1, 0, 0, 1, 0, 0]);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc.nodes.a.transform, [-1, 0, 0, 1, -5, 0]);
});

test("crossing a rotated leaf flips in its local resize axis", () => {
  const rotation = [0, 1, -1, 0, 100, 20];
  load([rect("a", 0, 0, 10, 10, rotation)], ["a"]);
  const interaction = beginResize({
    ids: ["a"],
    handle: "e",
    from: { x: 0, y: 0, width: 10, height: 10 },
    frameTransform: rotation,
  });

  move(interaction, { x: 95, y: 15 });
  useEditor.getState().endInteraction();

  const shape = useEditor.getState().doc.nodes.a;
  assert.deepEqual(
    shape.transform.map((value) => Object.is(value, -0) ? 0 : value),
    [0, -1, -1, 0, 100, 15]
  );
  assert.equal(matrixDeterminant(shape.transform) < 0, true);
  assert.deepEqual(nodeWorldBounds(useEditor.getState().doc, "a"), {
    x: 90,
    y: 15,
    width: 10,
    height: 5,
  });
});

test("crossing the opposite edge with a vertical handle flips vertically", () => {
  load([rect("a", 0, 0, 10, 10)], ["a"]);
  const interaction = beginResize({
    ids: ["a"],
    handle: "n",
    from: { x: 0, y: 0, width: 10, height: 10 },
  });

  move(interaction, { x: 5, y: 15 });
  useEditor.getState().endInteraction();

  const shape = useEditor.getState().doc.nodes.a;
  assert.equal(shape.y, 10);
  assert.equal(shape.height, 5);
  assert.deepEqual(shape.transform, [1, 0, 0, -1, 0, 25]);
  assert.deepEqual(nodeWorldBounds(useEditor.getState().doc, "a"), {
    x: 0,
    y: 10,
    width: 10,
    height: 5,
  });
});

test("multiple roots flip as one selection", () => {
  load(
    [rect("left", 0, 0, 10, 10), rect("right", 20, 0, 10, 10)],
    ["left", "right"]
  );
  const interaction = beginResize({
    ids: ["left", "right"],
    handle: "e",
    from: { x: 0, y: 0, width: 30, height: 10 },
    selectionPivot: { x: 15, y: 5 },
    selectionTransform: [1, 0, 0, 1, 0, 0],
  });

  move(interaction, { x: -15, y: 5 });
  useEditor.getState().endInteraction();

  assert.deepEqual(nodeWorldBounds(useEditor.getState().doc, "left"), {
    x: -5,
    y: 0,
    width: 5,
    height: 10,
  });
  assert.deepEqual(nodeWorldBounds(useEditor.getState().doc, "right"), {
    x: -15,
    y: 0,
    width: 5,
    height: 10,
  });
  assert.deepEqual(useEditor.getState().selectionPivot, { x: -7.5, y: 5 });
  assert.deepEqual(
    useEditor.getState().selectionTransform,
    [-0.5, 0, 0, 1, 0, 0]
  );
});

test("frames keep positive dimensions instead of flipping", () => {
  load([frame("f")], ["f"]);
  const interaction = beginResize({
    ids: ["f"],
    handle: "e",
    from: { x: 0, y: 0, width: 10, height: 10 },
    frameChildren: {},
  });

  move(interaction, { x: -20, y: 5 }, true);
  let resized = useEditor.getState().doc.nodes.f;
  assert.equal(resized.width, 20);
  assert.equal(resized.height, 20);
  assert.deepEqual(resized.transform, [1, 0, 0, 1, -20, -5]);

  move(interaction, { x: -5, y: 5 });
  useEditor.getState().endInteraction();

  resized = useEditor.getState().doc.nodes.f;
  assert.equal(resized.width, 5);
  assert.equal(resized.height, 10);
  assert.deepEqual(resized.transform, [1, 0, 0, 1, -5, 0]);
  assert.equal(matrixDeterminant(resized.transform) > 0, true);
});

test("a frame mixed with artwork has no shared transform handles", () => {
  load([frame("f"), rect("a", 0, 0, 100, 100)], ["f", "a"]);
  useEditor.getState().setSelection(["a"]);
  const east = worldToScreen(useEditor.getState().viewport, { x: 100, y: 50 });
  assert.deepEqual(hitFrameHandle(context(), east), { type: "resize", id: "e" });

  useEditor.getState().setSelection(["f", "a"]);
  assert.equal(hitFrameHandle(context(), east), null);
});
