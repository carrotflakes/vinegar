import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";

let server;
let moveAnchors;
let onNodeDown;
let onNodeMove;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ moveAnchors } = await server.ssrLoadModule("/src/canvas/nodes.ts"));
  ({ onNodeDown, onNodeMove } =
    await server.ssrLoadModule("/src/canvas/tools/nodeTool.ts"));
  ({ useEditor } =
    await server.ssrLoadModule("/src/store/editorStore.ts"));
});

beforeEach(() => {
  useEditor.getState().newDocument();
});

after(async () => {
  await server.close();
});

const anchor = (x, y, patch = {}) => ({
  p: { x, y },
  hIn: null,
  hOut: null,
  ...patch,
});

const bezier = () => ({
  id: "curve",
  name: "Curve",
  type: "bezier",
  subpaths: [
    {
      anchors: [
        anchor(0, 0, { hOut: { x: 0, y: 20 } }),
        anchor(10, 0),
        anchor(20, 0),
      ],
      closed: false,
    },
  ],
  fill: null,
  stroke: { type: "solid", color: "#000000", alpha: 1 },
  strokeWidth: 1,
  opacity: 1,
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
});

const context = () => ({
  interaction: { current: { kind: "none" } },
  preview: { current: null },
  marquee: { current: null },
  penDraft: { current: null },
  penExtend: { current: null },
  lastInsert: { current: null },
  hover: { current: null },
  guides: { current: [] },
  spacings: { current: [] },
  hitScale: () => 1,
  scheduleDraw() {},
});

test("Shift-click adds and removes anchors from the node selection", () => {
  const crowded = bezier();
  // This handle overlaps the next anchor's grab box. Shift-selection must
  // still prefer the anchor under the pointer.
  crowded.subpaths[0].anchors[0].hOut = { x: 2, y: 0 };
  useEditor.getState().addShape(crowded);
  useEditor.getState().setTool("node");
  useEditor.getState().setEditNodes([
    { shapeId: "curve", sub: 0, index: 0 },
  ]);
  const ctx = context();

  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 10, y: 0 },
    { x: 10, y: 0 },
    true
  );
  assert.deepEqual(useEditor.getState().editNodes, [
    { shapeId: "curve", sub: 0, index: 0 },
    { shapeId: "curve", sub: 0, index: 1 },
  ]);
  assert.equal(ctx.interaction.current.kind, "node-anchor");
  useEditor.getState().cancelInteraction();
  ctx.interaction.current = { kind: "none" };

  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 10, y: 0 },
    { x: 10, y: 0 },
    true
  );
  assert.deepEqual(useEditor.getState().editNodes, [
    { shapeId: "curve", sub: 0, index: 0 },
  ]);
  assert.equal(ctx.interaction.current.kind, "none");
});

test("cancelling a dirty node drag restores geometry and keeps the node selection", () => {
  useEditor.getState().addShape(bezier());
  useEditor.getState().setTool("node");
  const selected = [
    { shapeId: "curve", sub: 0, index: 0 },
    { shapeId: "curve", sub: 0, index: 1 },
  ];
  useEditor.getState().setEditNodes(selected);
  const before = useEditor.getState().doc;
  const ctx = context();

  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    false
  );
  onNodeMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    { x: 5, y: 5 },
    false,
    false
  );
  assert.notEqual(useEditor.getState().doc, before);

  useEditor.getState().cancelInteraction();

  assert.equal(useEditor.getState().doc, before);
  assert.deepEqual(useEditor.getState().editNodes, [
    { shapeId: "curve", sub: 0, index: 1 },
    { shapeId: "curve", sub: 0, index: 0 },
  ]);
});

test("cancelling an inserted anchor restores the prior valid node selection", () => {
  const wide = bezier();
  wide.subpaths[0].anchors = [
    anchor(0, 0),
    anchor(100, 0),
    anchor(200, 0),
  ];
  useEditor.getState().addShape(wide);
  useEditor.getState().setTool("node");
  useEditor.getState().setEditNodes([
    { shapeId: "curve", sub: 0, index: 0 },
  ]);
  const before = useEditor.getState().doc;
  const ctx = context();

  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 50, y: 0 },
    { x: 50, y: 0 },
    false
  );
  assert.equal(useEditor.getState().doc.nodes.curve.subpaths[0].anchors.length, 4);
  assert.deepEqual(useEditor.getState().editNodes, [
    { shapeId: "curve", sub: 0, index: 1 },
  ]);

  useEditor.getState().cancelInteraction();

  assert.equal(useEditor.getState().doc, before);
  assert.deepEqual(useEditor.getState().editNodes, [
    { shapeId: "curve", sub: 0, index: 0 },
  ]);
});

test("dragging an already-selected anchor moves the full selection in one undo step", () => {
  useEditor.getState().addShape(bezier());
  useEditor.getState().setTool("node");
  useEditor.getState().setEditNodes([
    { shapeId: "curve", sub: 0, index: 0 },
    { shapeId: "curve", sub: 0, index: 1 },
  ]);
  const beforeHistory = useEditor.getState().history.past.length;
  const ctx = context();

  // Plain-clicking a selected anchor keeps the group and makes that anchor the
  // active drag reference.
  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    false
  );
  assert.equal(ctx.interaction.current.kind, "node-anchor");
  assert.deepEqual(ctx.interaction.current.selected, [
    { sub: 0, index: 1 },
    { sub: 0, index: 0 },
  ]);

  onNodeMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    { x: 5, y: 5 },
    false,
    false
  );
  useEditor.getState().endInteraction();

  const moved = useEditor.getState().doc.nodes.curve;
  assert.deepEqual(
    moved.subpaths[0].anchors.map((item) => item.p),
    [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 20, y: 0 }]
  );
  assert.deepEqual(moved.subpaths[0].anchors[0].hOut, { x: 5, y: 25 });
  assert.equal(useEditor.getState().history.past.length, beforeHistory + 1);

  useEditor.getState().undo();
  assert.deepEqual(
    useEditor.getState().doc.nodes.curve.subpaths[0].anchors.map((item) => item.p),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]
  );
});

test("multi-anchor translation preserves brush widths and unselected anchors", () => {
  const brush = {
    id: "brush",
    name: "Brush",
    type: "brush",
    anchors: [
      { ...anchor(0, 0, { hOut: { x: 3, y: 0 } }), w: 0.25 },
      { ...anchor(10, 0), w: 0.75 },
      { ...anchor(20, 0), w: 1 },
    ],
    fill: null,
    stroke: { type: "solid", color: "#000000", alpha: 1 },
    strokeWidth: 10,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
  };

  const moved = moveAnchors(
    brush,
    [{ sub: 0, index: 0 }, { sub: 0, index: 2 }],
    -4,
    6
  );

  assert.deepEqual(
    moved.anchors.map((item) => item.p),
    [{ x: -4, y: 6 }, { x: 10, y: 0 }, { x: 16, y: 6 }]
  );
  assert.deepEqual(moved.anchors[0].hOut, { x: -1, y: 6 });
  assert.deepEqual(moved.anchors.map((item) => item.w), [0.25, 0.75, 1]);
});
