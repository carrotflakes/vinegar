import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let createRenderStressDocument;
let renderScene;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ createRenderStressDocument } = await server.ssrLoadModule(
    "/src/demo/createRenderStressDocument.ts"
  ));
  ({ renderScene } = await server.ssrLoadModule("/src/canvas/render.ts"));
});

after(async () => server.close());

const rect = (id, x, y, width, height, extra = {}) => ({
  id,
  name: id,
  type: "rect",
  ...SHAPE_BASE,
  ...NODE_BASE,
  x,
  y,
  width,
  height,
  cornerRadius: 0,
  fill: { type: "solid", color: "#123456", alpha: 1 },
  transform: [1, 0, 0, 1, 0, 0],
  ...extra,
});

function mockContext(
  canvas = { width: 100, height: 100 },
  calls = []
) {
  return {
    canvas,
    calls,
    setTransform() {},
    getTransform() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    },
    fillRect() {},
    clearRect() {},
    drawImage(image, ...args) {
      calls.push(["drawImage", image.width, image.height, ...args]);
    },
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    beginPath() {},
    rect(x, y, width, height) {
      calls.push(["rect", x, y, width, height]);
    },
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    closePath() {},
    ellipse() {},
    fill() {},
    stroke() {},
    clip() {},
    setLineDash() {},
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "round",
    lineJoin: "round",
    miterLimit: 4,
    lineDashOffset: 0,
    filter: "none",
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
}

function render(doc, extra = {}) {
  const ctx = mockContext();
  let sample;
  renderScene(ctx, {
    width: 100,
    height: 100,
    dpr: 1,
    viewport: {
      scale: 1,
      rotation: 0,
      offset: { x: 0, y: 0 },
    },
    doc,
    onPerformanceSample: (value) => {
      sample = value;
    },
    ...extra,
  });
  return { ctx, sample };
}

test("render stress documents provide deterministic 1k and 10k workloads", () => {
  for (const nodeCount of [1_000, 10_000]) {
    const doc = createRenderStressDocument(nodeCount);
    const leaves = Object.values(doc.nodes).filter(
      (node) => !["group", "frame", "instance"].includes(node.type)
    );
    assert.equal(leaves.length, nodeCount);
    assert.equal(doc.rootIds.length, nodeCount / 100);
    assert.equal(
      doc.extensions["vinegar.render-stress"].leafNodeCount,
      nodeCount
    );
    assert.equal(doc.nodes.stress_shape_0.type, "text");
    assert.equal(doc.nodes.stress_shape_4.type, "path");
    assert.equal(doc.nodes.stress_shape_53.strokeAlignment, "outside");
    assert.equal(doc.nodes.stress_shape_211.effects[0].type, "drop-shadow");
    assert.equal(doc.nodes.stress_group_0.effects[0].type, "drop-shadow");
  }
});

test("renderScene culls shapes outside the visible world bounds", () => {
  const doc = createEmptyDocument();
  doc.nodes.visible = rect("visible", 10, 10, 20, 20);
  doc.nodes.far = rect("far", 1000, 1000, 20, 20);
  doc.rootIds = ["visible", "far"];

  const { ctx, sample } = render(doc);
  assert.deepEqual(ctx.calls, [["rect", 10, 10, 20, 20]]);
  assert.equal(sample.paintedNodes, 1);
  assert.equal(sample.culledNodes, 1);
  assert.equal(sample.acquireLayerCalls, 0);
  assert.ok(sample.paintNodeMs >= 0);
});

test("culling keeps thick strokes that can reach into the viewport", () => {
  const doc = createEmptyDocument();
  doc.nodes.edge = rect("edge", 110, 20, 10, 10, {
    fill: null,
    stroke: { type: "solid", color: "#123456", alpha: 1 },
    strokeWidth: 40,
    strokeAlignment: "center",
    strokeJoin: "miter",
  });
  doc.rootIds = ["edge"];

  const { ctx, sample } = render(doc);
  assert.deepEqual(ctx.calls, [["rect", 110, 20, 10, 10]]);
  assert.equal(sample.paintedNodes, 1);
  assert.equal(sample.culledNodes, 0);
});

test("a transient preview is not culled using its stale stored bounds", () => {
  const doc = createEmptyDocument();
  doc.nodes.moving = rect("moving", 1000, 1000, 20, 20);
  doc.rootIds = ["moving"];
  const preview = rect("moving", 5, 6, 20, 20);

  const { ctx, sample } = render(doc, { preview });
  assert.deepEqual(ctx.calls, [["rect", 5, 6, 20, 20]]);
  assert.equal(sample.paintedNodes, 1);
  assert.equal(sample.culledNodes, 0);
});

test("Path2D geometry is reused until the shape reference changes", () => {
  const previousPath2D = globalThis.Path2D;
  const previousDOMMatrix = globalThis.DOMMatrix;
  let constructions = 0;
  class MockPath2D {
    constructor() {
      constructions += 1;
    }
    rect() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    closePath() {}
    ellipse() {}
    addPath() {}
  }
  class MockDOMMatrix {
    constructor(values) {
      this.values = values;
    }
  }
  globalThis.Path2D = MockPath2D;
  globalThis.DOMMatrix = MockDOMMatrix;
  try {
    let doc = createEmptyDocument();
    doc.nodes.shape = rect("shape", 10, 10, 20, 20);
    doc.rootIds = ["shape"];
    render(doc);
    render(doc);
    assert.equal(constructions, 1);

    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        shape: { ...doc.nodes.shape, width: 30 },
      },
    };
    render(doc);
    assert.equal(constructions, 2);

    const previewDoc = createEmptyDocument();
    const preview = rect("preview", 5, 6, 20, 20);
    assert.deepEqual(
      render(previewDoc, { preview }).ctx.calls,
      [["rect", 5, 6, 20, 20]]
    );
    preview.x = 15;
    assert.deepEqual(
      render(previewDoc, { preview }).ctx.calls,
      [["rect", 15, 6, 20, 20]]
    );
    assert.equal(constructions, 2);
  } finally {
    if (previousPath2D === undefined) delete globalThis.Path2D;
    else globalThis.Path2D = previousPath2D;
    if (previousDOMMatrix === undefined) delete globalThis.DOMMatrix;
    else globalThis.DOMMatrix = previousDOMMatrix;
  }
});

/** Run `body` with `document.createElement("canvas")` producing mock canvases,
 *  collecting each one so layer sizes can be asserted. */
function withCanvasFactory(body) {
  const previousDocument = globalThis.document;
  const createdCanvases = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = {
        width: 300,
        height: 150,
        getContext() {
          this.context ??= mockContext(this);
          return this.context;
        },
      };
      createdCanvases.push(canvas);
      return canvas;
    },
  };
  try {
    body(createdCanvases);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test("effect compositing borrows tight bucketed layers", () => {
  withCanvasFactory((createdCanvases) => {
    const doc = createEmptyDocument();
    doc.nodes.effect = rect("effect", 40, 40, 20, 20, {
      effects: [{ type: "blur", radius: 4 }],
    });
    doc.rootIds = ["effect"];

    const { ctx, sample } = render(doc);
    assert.equal(sample.acquireLayerCalls, 2);
    assert.equal(sample.acquiredLayerPixels, 64 * 64 * 2);
    assert.deepEqual(
      createdCanvases.map((canvas) => [canvas.width, canvas.height]),
      [
        [64, 64],
        [64, 64],
      ]
    );
    assert.deepEqual(ctx.calls, [["drawImage", 64, 64, 27, 27]]);
    assert.ok(sample.acquiredLayerPixels < 100 * 100 * 2);
  });
});

test("an effect layer covers the halo under a non-uniform shape transform", () => {
  withCanvasFactory((createdCanvases) => {
    const doc = createEmptyDocument();
    // Squashed to a tenth vertically: the blur radius scales by sqrt(|det|)
    // ≈ 0.32, so the halo reaches ~28px in *device* space on every side. A
    // margin added in the shape's local space would only survive as ~2.8px
    // vertically and clip the halo.
    doc.nodes.effect = rect("effect", 20, 200, 40, 100, {
      transform: [1, 0, 0, 0.1, 0, 0],
      effects: [{ type: "blur", radius: 30 }],
    });
    doc.rootIds = ["effect"];

    const { ctx, sample } = render(doc);
    // Painted content spans y 20..30; the layer has to reach y ≈ 59.
    assert.deepEqual(
      createdCanvases.map((canvas) => [canvas.width, canvas.height]),
      [
        [100, 64],
        [100, 64],
      ]
    );
    assert.deepEqual(ctx.calls, [["drawImage", 100, 64, 0, 0]]);
    assert.equal(sample.acquiredLayerPixels, 100 * 64 * 2);
  });
});
