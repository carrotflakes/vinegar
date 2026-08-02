// The select tool's press → drag → release cycle: a press only becomes a move
// once it leaves the click slop, and a press that never travels is a click.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let useEditor;
let onSelectDown;
let onSelectMove;
let finishToolInteraction;

let ctx;

const rect = (id, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  ...SHAPE_BASE,
  cornerRadius: 0,
  ...NODE_BASE,
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

/** Screen and world coordinates coincide: the default viewport is identity. */
const at = (x, y) => ({ x, y });

const down = (x, y, shift = false) =>
  onSelectDown(ctx, useEditor.getState(), at(x, y), at(x, y), shift);

const move = (x, y, { shift = false, alt = false } = {}) =>
  onSelectMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    at(x, y),
    at(x, y),
    shift,
    alt
  );

const up = (x, y) => {
  const inter = ctx.interaction.current;
  ctx.interaction.current = { kind: "none" };
  finishToolInteraction(ctx, useEditor.getState(), inter, {
    screen: at(x, y),
    noReparent: false,
    canvasSize: { width: 800, height: 600, dpr: 1 },
    beginTextEdit: () => {},
  });
};

/** Translation of a node, which is all these drags change. */
const offsetOf = (id) => {
  const t = useEditor.getState().doc.nodes[id].transform;
  return { x: t[4], y: t[5] };
};

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ onSelectDown } = await server.ssrLoadModule("/src/canvas/tools/selectTool.ts"));
  ({ onSelectMove } = await server.ssrLoadModule("/src/canvas/tools/selectDrag.ts"));
  ({ finishToolInteraction } = await server.ssrLoadModule("/src/canvas/toolDispatch.ts"));
});

beforeEach(() => {
  useEditor.getState().newDocument();
  // Alignment snapping would pull these deliberate offsets around.
  useEditor.setState({ snapEnabled: false, gridSnap: false });
  ctx = {
    interaction: { current: { kind: "none" } },
    marquee: { current: null },
    guides: { current: [] },
    spacings: { current: [] },
    hitScale: () => 1,
    scheduleDraw: () => {},
  };
});

after(async () => server.close());

test("pressing a shape selects it without starting a move", () => {
  useEditor.getState().addShape(rect("a"), false);
  down(50, 50);
  assert.deepEqual(useEditor.getState().selection, ["a"]);
  assert.equal(ctx.interaction.current.kind, "select-pending");
});

test("a press that stays inside the slop leaves the shape where it was", () => {
  useEditor.getState().addShape(rect("a"), false);
  down(50, 50);
  move(51, 51);
  up(51, 51);
  assert.deepEqual(offsetOf("a"), { x: 0, y: 0 });
  assert.equal(useEditor.getState().history.past.length, 1); // the addShape only
});

test("travelling past the slop moves the shape from the press point", () => {
  useEditor.getState().addShape(rect("a"), false);
  down(50, 50);
  move(70, 50);
  assert.equal(ctx.interaction.current.kind, "move");
  up(70, 50);
  assert.deepEqual(offsetOf("a"), { x: 20, y: 0 });
});

test("clicking one member of a multi-selection narrows to it on release", () => {
  useEditor.getState().addShape(rect("a"), false);
  useEditor.getState().addShape(rect("b", { x: 200 }), false);
  useEditor.getState().setSelection(["a", "b"]);
  down(50, 50);
  // The whole selection is still armed, so a drag would move both.
  assert.deepEqual(ctx.interaction.current.selection, ["a", "b"]);
  up(50, 50);
  assert.deepEqual(useEditor.getState().selection, ["a"]);
});

test("dragging a member of a multi-selection keeps the selection whole", () => {
  useEditor.getState().addShape(rect("a"), false);
  useEditor.getState().addShape(rect("b", { x: 200 }), false);
  useEditor.getState().setSelection(["a", "b"]);
  down(50, 50);
  move(80, 50);
  up(80, 50);
  assert.deepEqual(useEditor.getState().selection, ["a", "b"]);
  assert.deepEqual(offsetOf("a"), { x: 30, y: 0 });
  assert.deepEqual(offsetOf("b"), { x: 30, y: 0 });
});

test("shift-clicking a selected shape drops it and arms no move", () => {
  useEditor.getState().addShape(rect("a"), false);
  useEditor.getState().addShape(rect("b", { x: 200 }), false);
  useEditor.getState().setSelection(["a", "b"]);
  down(50, 50, true);
  assert.deepEqual(useEditor.getState().selection, ["b"]);
  assert.equal(ctx.interaction.current.kind, "none");
  // Carrying on into a drag must not walk off with the rest of the selection.
  move(90, 50);
  assert.deepEqual(offsetOf("b"), { x: 0, y: 0 });
});

test("shift-clicking an unselected shape adds it and arms a move of both", () => {
  useEditor.getState().addShape(rect("a"), false);
  useEditor.getState().addShape(rect("b", { x: 200 }), false);
  useEditor.getState().setSelection(["a"]);
  down(250, 50, true);
  assert.deepEqual(useEditor.getState().selection, ["a", "b"]);
  move(280, 50);
  up(280, 50);
  assert.deepEqual(offsetOf("a"), { x: 30, y: 0 });
  assert.deepEqual(offsetOf("b"), { x: 30, y: 0 });
});

test("shift locks the drag to the leading axis", () => {
  useEditor.getState().addShape(rect("a"), false);
  down(50, 50);
  move(90, 55, { shift: true });
  up(90, 55);
  assert.deepEqual(offsetOf("a"), { x: 40, y: 0 });
});

test("alt-dragging leaves the original behind and moves a copy", () => {
  useEditor.getState().addShape(rect("a"), false);
  down(50, 50);
  move(90, 50, { alt: true });
  up(90, 50);
  const state = useEditor.getState();
  assert.equal(state.doc.rootIds.length, 2);
  assert.deepEqual(offsetOf("a"), { x: 0, y: 0 });
  const copyId = state.doc.rootIds.find((id) => id !== "a");
  assert.deepEqual(offsetOf(copyId), { x: 40, y: 0 });
  // The copy is what stays selected, and the whole thing is one undo step.
  assert.deepEqual(state.selection, [copyId]);
  state.undo();
  assert.deepEqual(useEditor.getState().doc.rootIds, ["a"]);
});
