// Pen tool drafting: how a handle drag links (or breaks) the anchor's handles,
// and how the draft decides that the next click would close the path.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let pen;
let useEditor;

const NODE_GRAB = 8; // canvas/interaction.ts

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  pen = await server.ssrLoadModule("/src/canvas/tools/penTool.ts");
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

/** A ToolContext with a draft already in progress. */
function makeCtx(anchors, { hitScale = 1 } = {}) {
  const draft = {
    id: "path-draft",
    name: "Curve",
    type: "path",
    subpaths: [{ anchors, closed: false }],
    fillRule: "nonzero",
  };
  return {
    ctx: {
      interaction: { current: { kind: "none" } },
      preview: { current: draft },
      marquee: { current: null },
      penDraft: { current: draft },
      penExtend: { current: null },
      lastInsert: { current: null },
      hover: { current: null },
      brushHover: { current: null },
      endpointHint: { current: null },
      guides: { current: [] },
      spacings: { current: [] },
      hitScale: () => hitScale,
      scheduleDraw: () => {},
    },
    draft,
  };
}

const anchor = (x, y) => ({ p: { x, y }, hIn: null, hOut: null });

/** The live store, with an identity viewport so world == screen. */
function state() {
  const s = useEditor.getState();
  s.setViewport({ offset: { x: 0, y: 0 }, scale: 1, rotation: 0, flipX: false });
  return useEditor.getState();
}

test("a plain handle drag makes a symmetric anchor", () => {
  const { ctx, draft } = makeCtx([anchor(0, 0), anchor(10, 0)]);
  pen.onPenAnchorMove(
    ctx,
    state(),
    { kind: "pen-anchor", index: 1, keepIn: false },
    { x: 14, y: 3 },
    false,
    false
  );
  const a = draft.subpaths[0].anchors[1];
  assert.deepEqual(a.hOut, { x: 14, y: 3 });
  assert.deepEqual(a.hIn, { x: 6, y: -3 }, "the incoming handle mirrors the drag");
  assert.equal(a.t, "symmetric");
});

test("Alt breaks the linkage: only the outgoing handle moves", () => {
  const { ctx, draft } = makeCtx([anchor(0, 0), anchor(10, 0)]);
  pen.onPenAnchorMove(
    ctx,
    state(),
    { kind: "pen-anchor", index: 1, keepIn: false },
    { x: 14, y: 3 },
    false,
    true
  );
  const a = draft.subpaths[0].anchors[1];
  assert.deepEqual(a.hOut, { x: 14, y: 3 });
  assert.equal(a.hIn, null, "no incoming handle is invented");
  assert.equal(a.t, "cusp");
});

test("continuing an existing endpoint keeps its incoming handle", () => {
  const anchors = [
    anchor(0, 0),
    { p: { x: 10, y: 0 }, hIn: { x: 7, y: 0 }, hOut: null, t: "smooth" },
  ];
  const { ctx, draft } = makeCtx(anchors);
  pen.onPenAnchorMove(
    ctx,
    state(),
    { kind: "pen-anchor", index: 1, keepIn: true },
    { x: 14, y: 3 },
    false,
    false
  );
  const a = draft.subpaths[0].anchors[1];
  assert.deepEqual(a.hIn, { x: 7, y: 0 }, "the segment already drawn is untouched");
  assert.deepEqual(a.hOut, { x: 14, y: 3 });
  assert.equal(a.t, "cusp", "the stale smooth tag is dropped, not left to re-link");
});

test("hovering the first anchor flags the closing segment", () => {
  const { ctx } = makeCtx([anchor(0, 0), anchor(50, 0), anchor(50, 50)]);
  const s = state();

  pen.onPenHoverMove(ctx, s, { x: NODE_GRAB - 2, y: 0 }, false);
  assert.equal(ctx.hover.current.close, true, "within the grab radius");
  assert.deepEqual(
    ctx.hover.current.p,
    { x: 0, y: 0 },
    "the preview snaps onto the anchor the click will land on"
  );

  pen.onPenHoverMove(ctx, s, { x: NODE_GRAB + 6, y: 0 }, false);
  assert.equal(ctx.hover.current.close, false, "outside it");
});

test("the close radius follows the touch hit scale", () => {
  const anchors = [anchor(0, 0), anchor(50, 0), anchor(50, 50)];
  const world = { x: NODE_GRAB + 6, y: 0 };

  const mouse = makeCtx(anchors.map((a) => ({ ...a })));
  pen.onPenHoverMove(mouse.ctx, state(), world, false);
  assert.equal(mouse.ctx.hover.current.close, false);

  const touch = makeCtx(anchors.map((a) => ({ ...a })), { hitScale: 2 });
  pen.onPenHoverMove(touch.ctx, state(), world, false);
  assert.equal(touch.ctx.hover.current.close, true, "a finger gets the enlarged target");
});

test("a single-anchor draft has nothing to close onto", () => {
  const { ctx } = makeCtx([anchor(0, 0)]);
  pen.onPenHoverMove(ctx, state(), { x: 0, y: 0 }, false);
  assert.equal(ctx.hover.current.close, false);
});

test("the on-screen action closes a two-anchor draft like clicking its start", () => {
  useEditor.getState().newDocument();
  const { ctx, draft } = makeCtx([anchor(0, 0), anchor(50, 0)]);

  pen.closePenDraft(ctx);

  assert.equal(draft.subpaths[0].closed, true);
  assert.equal(ctx.penDraft.current, null, "closing finishes the draft");
  assert.equal(
    useEditor.getState().doc.nodes[draft.id].subpaths[0].closed,
    true,
    "the closed path is committed"
  );
});
