import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let brushAnchorNormal;
let brushWidthKnobs;
let onNodeDown;
let onNodeWidthMove;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ brushAnchorNormal } = await server.ssrLoadModule(
    "/src/model/brush/brushWidth.ts"
  ));
  ({ brushWidthKnobs } = await server.ssrLoadModule("/src/canvas/nodes.ts"));
  ({ onNodeDown, onNodeWidthMove } = await server.ssrLoadModule(
    "/src/canvas/tools/nodeTool.ts"
  ));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

beforeEach(() => {
  useEditor.getState().newDocument();
});

after(async () => {
  await server.close();
});

/** A horizontal stroke of three anchors, base width 10, tapering 0.5 → 1 → 0.5. */
const brushShape = () => ({
  id: "stroke",
  name: "Stroke",
  type: "brush",
  ...SHAPE_BASE,
  ...NODE_BASE,
  anchors: [
    { p: { x: 0, y: 0 }, hIn: null, hOut: null, w: 0.5 },
    { p: { x: 20, y: 0 }, hIn: null, hOut: null, w: 1 },
    { p: { x: 40, y: 0 }, hIn: null, hOut: null, w: 0.5 },
  ],
  stroke: { type: "solid", color: "#000000", alpha: 1 },
  strokeWidth: 10,
  transform: [1, 0, 0, 1, 0, 0],
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

const identityViewport = { scale: 1, rotation: 0, offset: { x: 0, y: 0 } };
const anchorWidths = () =>
  useEditor.getState().doc.nodes.stroke.anchors.map((a) => a.w);

/** Widths that survive a distance round-trip carry float noise; compare loosely. */
function assertWidths(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((w, i) =>
    assert.ok(
      Math.abs(w - expected[i]) < 1e-9,
      `anchor ${i}: ${w} != ${expected[i]}`
    )
  );
}

/** Put the node tool on `indices` of the fixture stroke. */
function selectAnchors(indices) {
  useEditor.getState().addShape(brushShape());
  useEditor.getState().setTool("node");
  useEditor.getState().setEditNodes(
    indices.map((index) => ({ shapeId: "stroke", sub: 0, index }))
  );
}

test("the anchor normal is perpendicular to the centerline", () => {
  const shape = brushShape();
  const normal = brushAnchorNormal(shape, 1);
  assert.ok(Math.abs(normal.x) < 1e-9);
  assert.equal(Math.abs(normal.y), 1);
});

test("knobs appear only on selected anchors, on both sides at the half-width", () => {
  selectAnchors([1]);
  const knobs = brushWidthKnobs(
    useEditor.getState().doc.nodes.stroke,
    [1, 0, 0, 1, 0, 0],
    // Zoomed in, so the true half-width clears the minimum knob offset.
    { ...identityViewport, scale: 3 },
    [1]
  );
  assert.equal(knobs.length, 2);
  // w 1 of a base width 10 is 5 units off the centerline, ×3 zoom = 15px.
  assert.deepEqual(
    knobs.map((k) => Math.round(k.screen.y)).sort((a, b) => a - b),
    [-15, 15]
  );
  assert.deepEqual(new Set(knobs.map((k) => k.index)), new Set([1]));
});

test("a zero-width anchor still gets a grabbable knob", () => {
  selectAnchors([0]);
  useEditor.getState().setEditNodeWidths({ width: 0 });
  const knobs = brushWidthKnobs(
    useEditor.getState().doc.nodes.stroke,
    [1, 0, 0, 1, 0, 0],
    identityViewport,
    [0]
  );
  assert.ok(knobs.every((k) => Math.abs(k.screen.y) > 1));
});

test("dragging a knob scales the whole node selection by one ratio", () => {
  selectAnchors([0, 1, 2]);
  const ctx = context();
  const state = useEditor.getState();
  // Grab the knob of anchor 1: 5 units above the centerline at (20, 0).
  onNodeDown(ctx, state, { x: 20, y: -5 }, { x: 20, y: -5 }, false);
  assert.equal(ctx.interaction.current.kind, "node-width");

  // Out to a half-width of 10, i.e. w 2 on the grabbed anchor: ×2 for all.
  onNodeWidthMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    { x: 20, y: -10 },
    false
  );
  assert.deepEqual(anchorWidths(), [1, 2, 1]);

  // Repeated moves read from the drag's starting shape, never compounding.
  onNodeWidthMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    { x: 20, y: -10 },
    false
  );
  assert.deepEqual(anchorWidths(), [1, 2, 1]);
  useEditor.getState().endInteraction();
});

test("Alt levels the selected anchors to one width instead of scaling", () => {
  selectAnchors([0, 1, 2]);
  const ctx = context();
  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 20, y: -5 },
    { x: 20, y: -5 },
    false
  );
  onNodeWidthMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    { x: 20, y: -10 },
    true
  );
  assert.deepEqual(anchorWidths(), [2, 2, 2]);
  useEditor.getState().endInteraction();
});

test("dragging past the centerline mirrors the width rather than inverting it", () => {
  selectAnchors([1]);
  const ctx = context();
  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 20, y: -5 },
    { x: 20, y: -5 },
    false
  );
  onNodeWidthMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    { x: 20, y: 15 },
    false
  );
  assert.deepEqual(anchorWidths(), [0.5, 3, 0.5]);
  useEditor.getState().endInteraction();
});

test("a Bézier handle still wins the pick over an overlapping width knob", () => {
  const shape = brushShape();
  // Park anchor 1's outgoing handle exactly on its upper width knob.
  shape.anchors[1].hOut = { x: 20, y: -5 };
  useEditor.getState().addShape(shape);
  useEditor.getState().setTool("node");
  useEditor
    .getState()
    .setEditNodes([{ shapeId: "stroke", sub: 0, index: 1 }]);
  const ctx = context();
  onNodeDown(
    ctx,
    useEditor.getState(),
    { x: 20, y: -5 },
    { x: 20, y: -5 },
    false
  );
  assert.equal(ctx.interaction.current.kind, "node-handle");
  useEditor.getState().cancelInteraction();
});

test("grabbing a knob that was nudged out does not jump the width", () => {
  selectAnchors([1]);
  // Thin the apex so its true half-width (1 unit) is inside the minimum knob
  // offset: the knob is drawn at 7px, well past where the stroke edge is.
  useEditor.getState().setEditNodeWidths({ width: 0.2 });
  const ctx = context();
  const state = useEditor.getState();
  const knob = brushWidthKnobs(
    state.doc.nodes.stroke,
    [1, 0, 0, 1, 0, 0],
    identityViewport,
    [1]
  ).find((k) => k.side === 1);
  assert.equal(Math.round(knob.screen.y), -7);

  onNodeDown(ctx, state, knob.screen, knob.screen, false);
  assert.equal(ctx.interaction.current.kind, "node-width");

  // Pointer-down alone, then a move back to the same point: the width has to
  // still be what it was, not snap out to the knob's drawn distance.
  onNodeWidthMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    { x: 20, y: knob.screen.y },
    false
  );
  assertWidths(anchorWidths(), [0.5, 0.2, 0.5]);

  // From there the drag is relative: 10 further units out adds 10 to the
  // half-width, i.e. w 0.2 + 2.0.
  onNodeWidthMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    { x: 20, y: knob.screen.y - 10 },
    false
  );
  assertWidths(anchorWidths(), [0.5, 2.2, 0.5]);
  useEditor.getState().endInteraction();
});

test("width edits on different anchors are separate undo steps", () => {
  selectAnchors([0]);
  const undo = () => useEditor.getState().undo();

  useEditor.getState().setEditNodeWidths({ factor: 2 });
  useEditor
    .getState()
    .setEditNodes([{ shapeId: "stroke", sub: 0, index: 2 }]);
  useEditor.getState().setEditNodeWidths({ factor: 2 });
  assert.deepEqual(anchorWidths(), [1, 1, 1]);

  // Back-to-back inside the coalesce window, but on different anchors: the
  // second edit must not have swallowed the first.
  undo();
  assert.deepEqual(anchorWidths(), [1, 1, 0.5]);
  undo();
  assert.deepEqual(anchorWidths(), [0.5, 1, 0.5]);
});

test("repeated width steps on one selection coalesce into a single undo", () => {
  selectAnchors([0]);
  useEditor.getState().setEditNodeWidths({ factor: 2 });
  useEditor.getState().setEditNodeWidths({ factor: 2 });
  assert.deepEqual(anchorWidths(), [2, 1, 0.5]);
  useEditor.getState().undo();
  assert.deepEqual(anchorWidths(), [0.5, 1, 0.5]);
});

test("setEditNodeWidths ignores anchors that are not on a brush", () => {
  selectAnchors([0]);
  useEditor
    .getState()
    .setEditNodes([{ shapeId: "missing", sub: 0, index: 0 }]);
  useEditor.getState().setEditNodeWidths({ factor: 4 });
  assert.deepEqual(anchorWidths(), [0.5, 1, 0.5]);
});
