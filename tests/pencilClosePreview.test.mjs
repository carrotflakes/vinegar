// Pencil close preview: the ring/fill must predict the same tail settlement
// that pointer-up will commit, including at high live smoothing.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let pencil;
let useEditor;
let usePencil;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  pencil = await server.ssrLoadModule("/src/canvas/tools/shapeTools.ts");
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ usePencil } = await server.ssrLoadModule("/src/store/pencilStore.ts"));
});

after(async () => server.close());

function makeCtx() {
  return {
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
    scheduleDraw: () => {},
  };
}

function startStroke() {
  useEditor.getState().newDocument();
  useEditor.getState().setViewport({
    offset: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    flipX: false,
  });
  usePencil.getState().setPencil({ smoothing: 0.95, simplify: 0 });
  const state = useEditor.getState();
  const ctx = makeCtx();
  pencil.startPencil(ctx, state, { x: 0, y: 0 }, { x: 0, y: 0 });

  let t = performance.now();
  const move = (world, dt = 100) => {
    t += dt;
    pencil.onPencilMove(ctx, state, [{ world, pressure: 1, t }]);
  };
  const settleAt = (world) => {
    for (let i = 0; i < 20; i++) move(world);
  };
  return { ctx, state, move, settleAt };
}

function committedPath() {
  const { doc } = useEditor.getState();
  assert.equal(doc.rootIds.length, 1);
  const shape = doc.nodes[doc.rootIds[0]];
  assert.equal(shape.type, "path");
  return shape;
}

test("previews a close that release-tail settlement will commit", () => {
  const { ctx, state, move, settleAt } = startStroke();
  settleAt({ x: 60, y: 0 });
  settleAt({ x: 60, y: 60 });
  settleAt({ x: 0, y: 60 });

  // The visible smoothed tail is still far from the start, but pointer-up at
  // the raw position will settle it inside the close radius.
  move({ x: 0, y: 0 }, 1000 / 60);
  assert.deepEqual(ctx.closeHint.current, { x: 0, y: 0 });

  pencil.finishPencil(ctx, state, { x: 0, y: 0 });
  assert.equal(committedPath().subpaths[0].closed, true);
});

test("removes a stale close preview when release settlement will stay open", () => {
  const { ctx, state, move, settleAt } = startStroke();
  settleAt({ x: 60, y: 0 });
  settleAt({ x: 60, y: 60 });
  settleAt({ x: 0, y: 60 });
  settleAt({ x: 0, y: 0 });
  assert.deepEqual(ctx.closeHint.current, { x: 0, y: 0 });

  // One high-smoothing frame leaves the visible tail inside the close radius,
  // while settling toward this raw release position will make the path open.
  move({ x: 100, y: 0 }, 1000 / 60);
  assert.equal(ctx.closeHint.current, null);
  assert.equal(ctx.preview.current.fill, null);

  pencil.finishPencil(ctx, state, { x: 100, y: 0 });
  assert.equal(committedPath().subpaths[0].closed, false);
});
