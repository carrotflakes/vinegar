import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let deriveAnchorType;
let effectiveAnchorType;
let moveAnchors;
let moveHandle;
let visibleHandleKeys;
let onNodeDown;
let onNodeMove;
let resizeShapeToBounds;
let reversePath;
let setAnchorType;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ moveAnchors, moveHandle, visibleHandleKeys } =
    await server.ssrLoadModule("/src/canvas/nodes.ts"));
  ({ deriveAnchorType, effectiveAnchorType, setAnchorType } =
    await server.ssrLoadModule("/src/model/path/anchorType.ts"));
  ({ reversePath } =
    await server.ssrLoadModule("/src/model/path/path.ts"));
  ({ resizeShapeToBounds } =
    await server.ssrLoadModule("/src/model/geometry/transforms.ts"));
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

const pathShape = () => ({
  id: "curve",
  name: "Curve",
  type: "path",
  ...SHAPE_BASE, fillRule: "nonzero",
  ...NODE_BASE,
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

test("derives anchor types from geometry at any scale", () => {
  assert.equal(deriveAnchorType(anchor(0, 0)), "cusp");
  assert.equal(
    deriveAnchorType(anchor(0, 0, {
      hIn: { x: -10, y: 0 },
      hOut: { x: 10, y: 0 },
    })),
    "symmetric"
  );
  assert.equal(
    deriveAnchorType(anchor(0, 0, {
      hIn: { x: -5, y: 0 },
      hOut: { x: 10, y: 0 },
    })),
    "smooth"
  );
  assert.equal(
    deriveAnchorType(anchor(0, 0, {
      hIn: { x: -5, y: 0 },
      hOut: { x: 0, y: 10 },
    })),
    "cusp"
  );
  for (const scale of [1e-9, 1e9]) {
    assert.equal(
      deriveAnchorType(anchor(0, 0, {
        hIn: { x: -5 * scale, y: 0 },
        hOut: { x: 10 * scale, y: 0 },
      })),
      "smooth"
    );
  }
});

test("smooth handle drags rotate the opposite handle without changing its length", () => {
  const shape = pathShape();
  shape.subpaths[0].anchors[0] = anchor(0, 0, {
    hIn: { x: -5, y: 0 },
    hOut: { x: 10, y: 0 },
  });

  const moved = moveHandle(shape, 0, 0, "out", { x: 0, y: 20 }, false);
  const movedAnchor = moved.subpaths[0].anchors[0];
  assert.deepEqual(movedAnchor.hOut, { x: 0, y: 20 });
  assert.deepEqual(movedAnchor.hIn, { x: 0, y: -5 });
  assert.equal(effectiveAnchorType(movedAnchor), "smooth");
});

test("breaking handle symmetry commits a cusp and keeps the opposite handle", () => {
  const shape = pathShape();
  shape.subpaths[0].anchors[0] = anchor(0, 0, {
    hIn: { x: -10, y: 0 },
    hOut: { x: 10, y: 0 },
  });

  const moved = moveHandle(shape, 0, 0, "out", { x: 0, y: 20 }, true);
  const movedAnchor = moved.subpaths[0].anchors[0];
  assert.deepEqual(movedAnchor.hIn, { x: -10, y: 0 });
  assert.deepEqual(movedAnchor.hOut, { x: 0, y: 20 });
  assert.equal(movedAnchor.t, "cusp");
});

test("a degenerate smooth drag leaves the opposite handle finite and unchanged", () => {
  const shape = pathShape();
  shape.subpaths[0].anchors[0] = anchor(0, 0, {
    hIn: { x: -5, y: 0 },
    hOut: { x: 10, y: 0 },
    t: "smooth",
  });

  const moved = moveHandle(shape, 0, 0, "out", { x: 0, y: 0 }, false);
  assert.deepEqual(moved.subpaths[0].anchors[0].hIn, { x: -5, y: 0 });
  assert.deepEqual(moved.subpaths[0].anchors[0].hOut, { x: 0, y: 0 });
});

test("anchor type normalization and path reversal preserve linkage", () => {
  const smooth = setAnchorType(
    anchor(0, 0, {
      hIn: { x: -5, y: 0 },
      hOut: { x: 10, y: 0 },
    }),
    "smooth"
  );
  const symmetric = setAnchorType(smooth, "symmetric");
  const roundTripped = setAnchorType(symmetric, "smooth");
  assert.equal(effectiveAnchorType(roundTripped), "smooth");
  assert.ok(Math.abs(
    roundTripped.hIn.x * roundTripped.hOut.y -
      roundTripped.hIn.y * roundTripped.hOut.x
  ) < 1e-9);

  const shape = pathShape();
  shape.subpaths[0].anchors[0] = roundTripped;
  const reversed = reversePath(shape);
  const reversedAnchor = reversed.subpaths[0].anchors.at(-1);
  assert.equal(reversedAnchor.t, "smooth");
  assert.deepEqual(reversedAnchor.hIn, roundTripped.hOut);
  assert.deepEqual(reversedAnchor.hOut, roundTripped.hIn);
});

test("changing the selected node type normalizes every target in one undo step", () => {
  useEditor.getState().addShape(pathShape());
  useEditor.getState().setEditNodes([
    { shapeId: "curve", sub: 0, index: 1 },
    { shapeId: "curve", sub: 0, index: 2 },
  ]);
  const beforeHistory = useEditor.getState().history.past.length;

  useEditor.getState().setEditNodeType("smooth");

  const anchors = useEditor.getState().doc.nodes.curve.subpaths[0].anchors;
  assert.equal(anchors[1].t, "smooth");
  assert.ok(anchors[1].hIn);
  assert.ok(anchors[1].hOut);
  assert.equal(anchors[2].t, "smooth");
  assert.ok(anchors[2].hIn);
  assert.equal(anchors[2].hOut, null);
  assert.equal(useEditor.getState().history.past.length, beforeHistory + 1);

  // Re-applying the type anchors is a no-op and must not pollute the history.
  const settled = useEditor.getState().doc;
  useEditor.getState().setEditNodeType("smooth");
  assert.equal(useEditor.getState().doc, settled);
  assert.equal(useEditor.getState().history.past.length, beforeHistory + 1);
});

test("non-uniform resizing demotes tagged symmetric anchors to smooth", () => {
  const shape = pathShape();
  shape.subpaths[0].anchors[0] = anchor(0, 0, {
    hIn: { x: -5, y: 0 },
    hOut: { x: 5, y: 0 },
    t: "symmetric",
  });
  const from = { x: 0, y: 0, width: 20, height: 20 };

  const uniform = resizeShapeToBounds(
    shape,
    from,
    { x: 0, y: 0, width: 40, height: 40 }
  );
  assert.equal(uniform.subpaths[0].anchors[0].t, "symmetric");

  const nonUniform = resizeShapeToBounds(
    shape,
    from,
    { x: 0, y: 0, width: 40, height: 20 }
  );
  assert.equal(nonUniform.subpaths[0].anchors[0].t, "smooth");
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
  const crowded = pathShape();
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
  useEditor.getState().addShape(pathShape());
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
  const wide = pathShape();
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

test("a compound path inserts on a non-active child path segment", () => {
  const first = pathShape();
  first.id = "first";
  first.subpaths[0].closed = true;
  first.subpaths[0].anchors = [
    anchor(0, 0),
    anchor(100, 0),
    anchor(200, 0),
  ];
  const second = structuredClone(first);
  second.id = "second";
  second.subpaths[0].anchors = second.subpaths[0].anchors.map((item) => ({
    ...item,
    p: { x: item.p.x, y: 100 },
  }));
  useEditor.getState().addShape(first);
  useEditor.getState().addShape(second);
  useEditor.getState().setSelection(["first", "second"]);
  useEditor.getState().makeCompoundPathSelected();
  const compoundId = useEditor.getState().selection[0];
  useEditor.getState().setTool("node");
  useEditor.getState().setSelection([compoundId]);
  useEditor.getState().setEditNodes([
    { shapeId: "first", sub: 0, index: 0 },
  ]);
  const ctx = context();

  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 50, y: 100 },
    { x: 50, y: 100 },
    false
  );

  assert.equal(
    useEditor.getState().doc.nodes.first.subpaths[0].anchors.length,
    3
  );
  assert.equal(
    useEditor.getState().doc.nodes.second.subpaths[0].anchors.length,
    4
  );
  assert.deepEqual(useEditor.getState().editNodes, [
    { shapeId: "second", sub: 0, index: 1 },
  ]);
});

test("dragging an already-selected anchor moves the full selection in one undo step", () => {
  useEditor.getState().addShape(pathShape());
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
    ...SHAPE_BASE,
    ...NODE_BASE,
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

test("deleting removes every selected anchor and keeps a neighbour selected", () => {
  const shape = pathShape();
  shape.subpaths[0].anchors.push(anchor(30, 0), anchor(40, 0));
  useEditor.getState().addShape(shape);
  useEditor.getState().setTool("node");
  useEditor.getState().setEditNodes([
    { shapeId: "curve", sub: 0, index: 1 },
    { shapeId: "curve", sub: 0, index: 3 },
  ]);

  useEditor.getState().deleteEditNode();

  assert.deepEqual(
    useEditor.getState().doc.nodes.curve.subpaths[0].anchors.map((item) => item.p),
    [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }]
  );
  // The neighbour before the first deleted anchor stays selected, so a run of
  // Delete presses walks the path instead of falling through to the shape.
  assert.deepEqual(useEditor.getState().editNodes, [
    { shapeId: "curve", sub: 0, index: 0 },
  ]);
});

test("deleting the last usable anchors removes the shape and clears the selection", () => {
  useEditor.getState().addShape(pathShape());
  useEditor.getState().setTool("node");
  useEditor.getState().setEditNodes([
    { shapeId: "curve", sub: 0, index: 0 },
    { shapeId: "curve", sub: 0, index: 1 },
  ]);

  useEditor.getState().deleteEditNode();

  assert.equal(useEditor.getState().doc.nodes.curve, undefined);
  assert.deepEqual(useEditor.getState().editNodes, []);
  assert.deepEqual(useEditor.getState().selection, []);
});

test("select all takes every anchor of the shape being node-edited", () => {
  useEditor.getState().addShape(pathShape());
  useEditor.getState().setTool("node");
  useEditor.getState().setSelection(["curve"]);

  useEditor.getState().selectAll();

  assert.deepEqual(useEditor.getState().editNodes, [
    { shapeId: "curve", sub: 0, index: 0 },
    { shapeId: "curve", sub: 0, index: 1 },
    { shapeId: "curve", sub: 0, index: 2 },
  ]);
  // The shape selection is what the node tool edits, so it must survive.
  assert.deepEqual(useEditor.getState().selection, ["curve"]);
});

test("nudging moves the selected anchors, and the whole shape when none are", () => {
  useEditor.getState().addShape(pathShape());
  useEditor.getState().setTool("node");
  useEditor.getState().setEditNodes([{ shapeId: "curve", sub: 0, index: 0 }]);

  useEditor.getState().nudge(0, -1);
  useEditor.getState().nudge(0, -1);

  const anchors = useEditor.getState().doc.nodes.curve.subpaths[0].anchors;
  assert.deepEqual(anchors[0].p, { x: 0, y: -2 });
  // Handles travel with their anchor; untouched anchors stay put.
  assert.deepEqual(anchors[0].hOut, { x: 0, y: 18 });
  assert.deepEqual(anchors[1].p, { x: 10, y: 0 });

  // With no anchors selected the whole node moves, through its transform —
  // the same way a select-tool drag moves it.
  useEditor.getState().setEditNodes([]);
  useEditor.getState().setSelection(["curve"]);
  useEditor.getState().nudge(5, 0);
  const moved = useEditor.getState().doc.nodes.curve;
  assert.deepEqual(moved.transform, [1, 0, 0, 1, 5, 0]);
  assert.deepEqual(moved.subpaths[0].anchors[0].p, { x: 0, y: -2 });
});

test("a run of nudges coalesces into one undo step", () => {
  useEditor.getState().addShape(pathShape());
  useEditor.getState().setSelection(["curve"]);
  const before = useEditor.getState().history.past.length;

  useEditor.getState().nudge(1, 0);
  useEditor.getState().nudge(1, 0);
  useEditor.getState().nudge(1, 0);

  assert.equal(useEditor.getState().history.past.length, before + 1);
  useEditor.getState().undo();
  assert.deepEqual(
    useEditor.getState().doc.nodes.curve.subpaths[0].anchors[0].p,
    { x: 0, y: 0 }
  );
});

test("visible handles cover the selected anchors and the neighbours facing them", () => {
  const shape = pathShape();
  const keys = visibleHandleKeys(shape, [{ sub: 0, index: 1 }]);

  assert.deepEqual([...keys].sort(), [
    "0:0:out", // the previous anchor's handle, facing the selection
    "0:1:in",
    "0:1:out",
    "0:2:in", // the next anchor's handle, facing the selection
  ]);
  // An open subpath has no wrap-around neighbour at its ends.
  assert.deepEqual([...visibleHandleKeys(shape, [{ sub: 0, index: 0 }])].sort(), [
    "0:0:in",
    "0:0:out",
    "0:1:in",
  ]);
  // Closing it makes the last anchor the first one's neighbour.
  const closed = { ...shape, subpaths: [{ ...shape.subpaths[0], closed: true }] };
  assert.deepEqual([...visibleHandleKeys(closed, [{ sub: 0, index: 0 }])].sort(), [
    "0:0:in",
    "0:0:out",
    "0:1:in",
    "0:2:out",
  ]);
  // The show-all preference opts out of the filtering entirely.
  assert.equal(visibleHandleKeys(shape, [{ sub: 0, index: 1 }], true), null);
});

test("a handle that is not drawn cannot be grabbed", () => {
  const shape = pathShape();
  shape.subpaths[0].anchors[1] = anchor(10, 0, {
    hIn: { x: 4, y: 0 },
    hOut: { x: 10, y: -20 },
  });
  useEditor.getState().addShape(shape);
  useEditor.getState().setTool("node");

  // Nothing selected: no handles are shown, so pressing on one starts a
  // marquee instead of dragging it.
  const ctx = context();
  onNodeDown(ctx, useEditor.getState(), { x: 10, y: -20 }, { x: 10, y: -20 }, false);
  assert.equal(ctx.interaction.current.kind, "node-marquee");

  // Selecting the anchor next to it reveals the facing handle only: the one
  // pointing away from the selection stays hidden and unpickable.
  useEditor.getState().setEditNodes([{ shapeId: "curve", sub: 0, index: 0 }]);
  const away = context();
  onNodeDown(away, useEditor.getState(), { x: 10, y: -20 }, { x: 10, y: -20 }, false);
  assert.equal(away.interaction.current.kind, "node-marquee");

  const facing = context();
  onNodeDown(facing, useEditor.getState(), { x: 4, y: 0 }, { x: 4, y: 0 }, false);
  assert.equal(facing.interaction.current.kind, "node-handle");
  assert.equal(facing.interaction.current.part, "in");
  assert.equal(facing.interaction.current.index, 1);
  useEditor.getState().cancelInteraction();

  // Selecting the anchor the handle belongs to makes it grabbable.
  useEditor.getState().setEditNodes([{ shapeId: "curve", sub: 0, index: 1 }]);
  const own = context();
  onNodeDown(own, useEditor.getState(), { x: 10, y: -20 }, { x: 10, y: -20 }, false);
  assert.equal(own.interaction.current.kind, "node-handle");
  assert.equal(own.interaction.current.part, "out");
});
