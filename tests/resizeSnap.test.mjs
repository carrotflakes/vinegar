// Alignment feedback while resizing: which axes a handle may snap, and the
// rule that a drawn guide has to be one the committed box actually sits on.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let collectSnapTargets;
let createEmptyDocument;
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
function resizeTowards(handle, world, lockAspect = false) {
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
    frameTransform: [1, 0, 0, 1, 0, 0],
    targets: collectSnapTargets(doc, [doc.nodes.b]),
    originals: { a: doc.nodes.a },
    single: true,
    lockAspect,
  };
  const ctx = context();
  onSelectMove(ctx, useEditor.getState(), interaction, world, world, false);
  return { ctx, shape: useEditor.getState().doc.nodes.a };
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

test("a guide the aspect constraint undoes is not drawn", () => {
  // x snaps to 100, then the locked ratio rebuilds the width from the taller
  // axis and pulls the corner back off the line.
  const { ctx, shape } = resizeTowards("se", { x: 98, y: 200 }, true);
  assert.equal(shape.width, 200);
  assert.equal(shape.height, 200);
  assert.deepEqual(ctx.guides.current, []);
});
