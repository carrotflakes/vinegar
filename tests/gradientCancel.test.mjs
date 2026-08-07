// Escape, a pointercancel and the hand-off to a pinch all funnel into
// `cancelActiveInteraction`. The gradient tool opens a history interaction on
// press, so those paths have to roll it back — a leftover `_interaction`
// swallows the *next* drag's `beginInteraction` and commits both as one step.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let useEditor;
let onGradientDown;
let onGradientAxisMove;
let cancelActiveInteraction;

let ctx;

const rect = (id) => ({
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
});

const at = (x, y) => ({ x, y });

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ onGradientDown, onGradientAxisMove } = await server.ssrLoadModule(
    "/src/canvas/tools/gradientTool.ts"
  ));
  ({ cancelActiveInteraction } = await server.ssrLoadModule(
    "/src/canvas/interactionLifecycle.ts"
  ));
});

beforeEach(() => {
  useEditor.getState().newDocument();
  ctx = {
    interaction: { current: { kind: "none" } },
    marquee: { current: null },
    preview: { current: null },
    guides: { current: [] },
    spacings: { current: [] },
    hitScale: () => 1,
    scheduleDraw: () => {},
  };
});

after(async () => server.close());

/** Press and drag out a gradient axis, leaving the interaction open. */
function dragAxis() {
  useEditor.getState().addShape(rect("a"), false);
  useEditor.getState().setSelection(["a"]);
  onGradientDown(ctx, useEditor.getState(), at(10, 10), at(10, 10), false);
  onGradientAxisMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    at(90, 60),
    false
  );
}

test("cancelling an axis drag rolls the fill back and closes the undo step", () => {
  dragAxis();
  assert.equal(ctx.interaction.current.kind, "gradient-axis");
  assert.equal(useEditor.getState().doc.nodes.a.fill.type, "gradient");

  cancelActiveInteraction(ctx);

  assert.equal(ctx.interaction.current.kind, "none");
  assert.equal(useEditor.getState().doc.nodes.a.fill.type, "solid");
  assert.equal(useEditor.getState()._interaction, null);
});

test("a cancelled drag does not fold into the next edit's undo step", () => {
  dragAxis();
  cancelActiveInteraction(ctx);
  const before = useEditor.getState().history.past.length;

  // A later, unrelated edit must own its own step — not inherit the abandoned
  // gradient interaction's snapshot and label.
  useEditor.getState().updateSelectedStyle({ opacity: 0.5 });
  const past = useEditor.getState().history.past;
  assert.equal(past.length, before + 1);
  assert.notEqual(past[past.length - 1].label, "Place gradient");
  // Undoing it restores the opacity without resurrecting the gradient.
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes.a.opacity, 1);
  assert.equal(useEditor.getState().doc.nodes.a.fill.type, "solid");
});
