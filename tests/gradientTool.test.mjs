// The gradient tool's press/cancel/double-click behaviour on the canvas.
//
// Cancelling matters because Escape, a pointercancel and the hand-off to a
// pinch all funnel into `cancelActiveInteraction`, and the tool opens a history
// interaction on press: a leftover `_interaction` swallows the *next* drag's
// `beginInteraction` and commits both as one step.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let useEditor;
let onGradientDown;
let onGradientAxisMove;
let addGradientStopAt;
let finishGradient;
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
  ({ onGradientDown, onGradientAxisMove, addGradientStopAt, finishGradient } =
    await server.ssrLoadModule("/src/canvas/tools/gradientTool.ts"));
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
function dragAxis(fill) {
  useEditor.getState().addShape(rect("a"), false);
  useEditor.getState().setSelection(["a"]);
  if (fill) useEditor.getState().updateSelectedStyle({ fill });
  onGradientDown(ctx, useEditor.getState(), at(10, 10), at(10, 10), false);
  onGradientAxisMove(
    ctx,
    useEditor.getState(),
    ctx.interaction.current,
    at(90, 60),
    false
  );
}

/** Place a gradient along (10,10)→(90,60) and commit it. */
function placeGradient() {
  dragAxis();
  const inter = ctx.interaction.current;
  ctx.interaction.current = { kind: "none" };
  finishGradient(ctx, useEditor.getState(), inter);
  return useEditor.getState().doc.nodes.a.fill;
}

const stopCount = () => useEditor.getState().doc.nodes.a.fill.stops.length;

test("placing a gradient over a translucent fill keeps its transparency", () => {
  dragAxis({ type: "solid", color: "#112233", alpha: 0.4 });
  const fill = useEditor.getState().doc.nodes.a.fill;
  assert.equal(fill.type, "gradient");
  // The transparency belongs to the ramp as a whole, so the far end is not
  // suddenly opaque white.
  assert.equal(fill.alpha, 0.4);
  assert.equal(fill.stops[0].color, "#112233");
});

test("double-clicking the ramp adds a stop there", () => {
  placeGradient();
  assert.equal(stopCount(), 2);
  // Halfway along the axis.
  addGradientStopAt(ctx, useEditor.getState(), at(50, 35));
  assert.equal(stopCount(), 3);
  const added = useEditor
    .getState()
    .doc.nodes.a.fill.stops.find((s) => s.offset > 0.01 && s.offset < 0.99);
  assert.ok(Math.abs(added.offset - 0.5) < 0.02, `offset ${added.offset}`);
});

test("double-clicking away from the ramp leaves the gradient alone", () => {
  placeGradient();
  // Off the artwork entirely...
  addGradientStopAt(ctx, useEditor.getState(), at(400, 400));
  assert.equal(stopCount(), 2);
  // ...and beside the axis' midpoint, where the press still projects onto the
  // ramp but is nowhere near the line that is drawn.
  addGradientStopAt(ctx, useEditor.getState(), at(-3, 120));
  assert.equal(stopCount(), 2);
});

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
