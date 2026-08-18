// The snapping rule: a snap may only act along the freedom a constraint leaves,
// and a drawn guide has to be one the committed geometry actually sits on.
// Covers resize handles and the rect/ellipse creation drag.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let collectSnapTargets;
let createEmptyDocument;
let onCreateMove;
let onSelectMove;
let server;
let useEditor;

const rect = (id, x, y, width, height) => ({
  id,
  name: id,
  type: "rect",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  x,
  y,
  width,
  height,
  cornerRadius: 0,
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

/**
 * Resize "a" (a 10x10 box at the origin) by `handle` towards `world`, with the
 * neighbour "b" as the only alignment target — its left edge sits at x = 100
 * and its top edge at y = 100.
 */
function resizeTowards(handle, world, opts = {}) {
  const { lockAspect = false, shift = false, frameTransform = [1, 0, 0, 1, 0, 0] } =
    opts;
  const empty = createEmptyDocument();
  const nodes = [rect("a", 0, 0, 10, 10), rect("b", 100, 100, 10, 10)];
  useEditor.getState().loadDocument({
    ...empty,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootIds: ["a", "b"],
  });
  const editor = useEditor.getState();
  editor.setSelection(["a"]);
  editor.beginInteraction("Resize selection");
  const doc = useEditor.getState().doc;
  const interaction = {
    kind: "resize",
    handle,
    from: { x: 0, y: 0, width: 10, height: 10 },
    frameTransform,
    targets: collectSnapTargets(doc, [doc.nodes.b]),
    originals: { a: doc.nodes.a },
    single: true,
    lockAspect,
  };
  const ctx = context();
  onSelectMove(ctx, useEditor.getState(), interaction, world, world, shift);
  return { ctx, shape: useEditor.getState().doc.nodes.a };
}

/** Drag out a rect from the origin towards `world`, with "b" as the only target. */
function createTowards(world, shift) {
  const empty = createEmptyDocument();
  useEditor.getState().loadDocument({
    ...empty,
    nodes: { b: rect("b", 100, 100, 10, 10) },
    rootIds: ["b"],
  });
  useEditor.setState({ tool: "rect" });
  const ctx = context();
  onCreateMove(
    ctx,
    useEditor.getState(),
    { x: 0, y: 0 },
    world,
    shift,
    false
  );
  return { ctx, shape: ctx.preview.current };
}

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ collectSnapTargets } = await server.ssrLoadModule(
    "/src/model/geometry/snap.ts"
  ));
  ({ onSelectMove } = await server.ssrLoadModule(
    "/src/canvas/tools/selectDrag.ts"
  ));
  ({ onCreateMove } = await server.ssrLoadModule(
    "/src/canvas/tools/shapeTools.ts"
  ));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => {
  await server.close();
});

test("a corner handle snaps to a neighbour's edge and draws that line", () => {
  const { ctx, shape } = resizeTowards("se", { x: 98, y: 40 });
  assert.equal(shape.width, 100);
  assert.equal(shape.height, 40);
  assert.deepEqual(
    ctx.guides.current.map((g) => [g.axis, g.value]),
    [["x", 100]]
  );
});

test("a side handle leaves the axis it cannot move alone", () => {
  // The pointer's y sits on b's top edge, but an east handle discards y: a
  // horizontal line here would promise an alignment the resize cannot make.
  const { ctx, shape } = resizeTowards("e", { x: 40, y: 98 });
  assert.equal(shape.width, 40);
  assert.equal(shape.height, 10);
  assert.deepEqual(ctx.guides.current, []);
});

test("an aspect-locked corner snaps only the axis driving the scale", () => {
  // x grew fractionally more, so the ratio is rebuilt from x: y must not snap,
  // even though the pointer sits within reach of b's top edge as well.
  const { ctx, shape } = resizeTowards("se", { x: 98, y: 96 }, { shift: true });
  assert.equal(shape.width, 100);
  assert.equal(shape.height, 100);
  assert.deepEqual(
    ctx.guides.current.map((g) => [g.axis, g.value]),
    [["x", 100]]
  );
});

test("a side handle on a rotated selection cannot align to a world line", () => {
  // At 45° the east handle moves its corner diagonally, so no world line is
  // reachable — snapping there would nudge the box with nothing to show for it.
  const c = Math.SQRT1_2;
  const { ctx, shape } = resizeTowards(
    "e",
    { x: 98, y: 98 },
    { frameTransform: [c, c, -c, c, 0, 0] }
  );
  assert.equal(Math.round(shape.width * 1e6) / 1e6, Math.round(98 * Math.SQRT2 * 1e6) / 1e6);
  assert.deepEqual(ctx.guides.current, []);
});

test("Shift squares a new rect off the free axis only", () => {
  const { ctx, shape } = createTowards({ x: 98, y: 40 }, true);
  assert.equal(shape.width, 100);
  assert.equal(shape.height, 100);
  assert.deepEqual(
    ctx.guides.current.map((g) => [g.axis, g.value]),
    [["x", 100]]
  );
});

test("without Shift a new rect snaps both axes independently", () => {
  const { ctx, shape } = createTowards({ x: 98, y: 40 }, false);
  assert.equal(shape.width, 100);
  assert.equal(shape.height, 40);
  assert.deepEqual(
    ctx.guides.current.map((g) => [g.axis, g.value]),
    [["x", 100]]
  );
});
