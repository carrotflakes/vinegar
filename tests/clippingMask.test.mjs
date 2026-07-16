import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let clippingMask;
let clippingContentIds;
let isClippingMaskCandidate;
let isClippingMaskNode;
let canMakeClippingMaskSelection;
let canReleaseClippingMaskSelection;
let hasValidClippingMasks;
let nodeWorldBounds;
let hitTestNode;
let marqueeHitNode;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({
    clippingMask,
    clippingContentIds,
    isClippingMaskCandidate,
    isClippingMaskNode,
    canMakeClippingMaskSelection,
    canReleaseClippingMaskSelection,
    hasValidClippingMasks,
  } = await server.ssrLoadModule("/src/model/clippingMask.ts"));
  ({ nodeWorldBounds } = await server.ssrLoadModule("/src/model/bounds.ts"));
  ({ hitTestNode, marqueeHitNode } = await server.ssrLoadModule("/src/model/hitTest.ts"));
});

after(async () => server.close());

const IDENTITY = [1, 0, 0, 1, 0, 0];
const solid = { type: "solid", color: "#f00", alpha: 1 };

const rect = (id, x, y, width, height, extra = {}) => ({
  id,
  name: id,
  type: "rect",
  x,
  y,
  width,
  height,
  fill: solid,
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  transform: [...IDENTITY],
  transformOrigin: null,
  ...extra,
});

const group = (id, childIds, extra = {}) => ({
  id,
  name: id,
  type: "group",
  childIds,
  opacity: 1,
  transform: [...IDENTITY],
  transformOrigin: null,
  ...extra,
});

function clippedDocument() {
  const doc = createEmptyDocument();
  doc.nodes.content = rect("content", 0, 0, 150, 150);
  doc.nodes.mask = {
    ...rect("mask", 0, 0, 0, 0, { fill: null, hidden: true }),
    type: "polygon",
    polys: [[
      [
        { x: 20, y: 20 },
        { x: 120, y: 20 },
        { x: 120, y: 120 },
        { x: 20, y: 120 },
      ],
      [
        { x: 50, y: 50 },
        { x: 90, y: 50 },
        { x: 90, y: 90 },
        { x: 50, y: 90 },
      ],
    ]],
  };
  delete doc.nodes.mask.x;
  delete doc.nodes.mask.y;
  delete doc.nodes.mask.width;
  delete doc.nodes.mask.height;
  doc.nodes.clip = group("clip", ["content", "mask"], { clip: true });
  doc.rootIds = ["clip"];
  return doc;
}

test("clipping helpers accept only closed area shapes and preserve child order", () => {
  const doc = clippedDocument();
  const clip = doc.nodes.clip;
  assert.equal(isClippingMaskCandidate(doc.nodes.mask), true);
  assert.equal(isClippingMaskCandidate({ ...rect("line", 0, 0, 1, 1), type: "line" }), false);
  assert.equal(isClippingMaskCandidate({ ...rect("path", 0, 0, 1, 1), type: "path", points: [], closed: false }), false);
  assert.equal(isClippingMaskCandidate({ ...rect("path", 0, 0, 1, 1), type: "path", points: [], closed: true }), false);
  assert.equal(isClippingMaskCandidate({
    ...rect("path", 0, 0, 1, 1),
    type: "path",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    closed: true,
  }), true);
  assert.equal(clippingMask(doc, clip)?.id, "mask");
  assert.deepEqual(clippingContentIds(doc, clip), ["content"]);
  assert.equal(isClippingMaskNode(doc, "mask"), true);
  assert.equal(isClippingMaskNode(doc, "content"), false);
  assert.equal(hasValidClippingMasks(doc), true);

  const malformed = structuredClone(doc);
  malformed.nodes.clip.childIds = ["content"];
  assert.equal(clippingMask(malformed, malformed.nodes.clip), null);
  assert.equal(hasValidClippingMasks(malformed), false);
});

test("selection validation uses sibling paint order and protects an existing mask", () => {
  const doc = createEmptyDocument();
  doc.nodes.back = rect("back", 0, 0, 10, 10);
  doc.nodes.open = {
    ...rect("open", 0, 0, 10, 10),
    type: "path",
    points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    closed: false,
  };
  doc.nodes.front = rect("front", 0, 0, 10, 10);
  doc.rootIds = ["back", "open", "front"];

  assert.equal(canMakeClippingMaskSelection(doc, ["front", "back"]), true);
  assert.equal(canMakeClippingMaskSelection(doc, ["back", "open"]), false);

  const clipped = clippedDocument();
  assert.equal(canMakeClippingMaskSelection(clipped, ["content", "mask"]), false);
  assert.equal(canReleaseClippingMaskSelection(clipped, ["clip"]), true);
});

test("clip bounds and point/marquee hits use the mask silhouette and holes", () => {
  const doc = clippedDocument();
  const content = doc.nodes.content;
  const mask = doc.nodes.mask;

  assert.deepEqual(nodeWorldBounds(doc, "clip"), {
    x: 20,
    y: 20,
    width: 100,
    height: 100,
  });
  assert.equal(hitTestNode(doc, content, { x: 30, y: 30 }, 0), true);
  assert.equal(hitTestNode(doc, content, { x: 10, y: 10 }, 0), false);
  assert.equal(hitTestNode(doc, content, { x: 60, y: 60 }, 0), false);

  // Mask paint/visibility are ignored; its even-odd hole remains excluded.
  assert.equal(hitTestNode(doc, mask, { x: 30, y: 30 }, 0), true);
  assert.equal(hitTestNode(doc, mask, { x: 60, y: 60 }, 0), false);
  assert.equal(marqueeHitNode(doc, content, { x: 25, y: 25, width: 5, height: 5 }), true);
  assert.equal(marqueeHitNode(doc, content, { x: 0, y: 0, width: 5, height: 5 }), false);
  assert.equal(marqueeHitNode(doc, content, { x: 60, y: 60, width: 5, height: 5 }), false);
});

test("a bezier mask clips by its filled area (regression: flatten index leak)", () => {
  // A bezier rectangle mask exercises containsGeometry's `bezier` branch. A
  // `.map(flattenSubpath)` there leaked the array index into `perSegment`,
  // collapsing the first ring to one point so the mask matched nothing and its
  // whole clip group became unselectable. Polygon/rect masks never hit it.
  const doc = createEmptyDocument();
  doc.nodes.content = rect("content", 0, 0, 150, 150);
  const anchor = (x, y) => ({ p: { x, y }, hIn: null, hOut: null });
  doc.nodes.mask = {
    ...rect("mask", 0, 0, 0, 0, { fill: null }),
    type: "bezier",
    subpaths: [
      {
        anchors: [anchor(20, 20), anchor(120, 20), anchor(120, 120), anchor(20, 120)],
        closed: true,
      },
    ],
  };
  delete doc.nodes.mask.x;
  delete doc.nodes.mask.y;
  delete doc.nodes.mask.width;
  delete doc.nodes.mask.height;
  doc.nodes.clip = group("clip", ["content", "mask"], { clip: true });
  doc.rootIds = ["clip"];

  const content = doc.nodes.content;
  assert.equal(clippingMask(doc, doc.nodes.clip)?.id, "mask");
  // Inside the mask rectangle: content and the mask itself are hittable.
  assert.equal(hitTestNode(doc, content, { x: 70, y: 70 }, 0), true);
  assert.equal(hitTestNode(doc, doc.nodes.mask, { x: 70, y: 70 }, 0), true);
  // Outside the mask: clipped away.
  assert.equal(hitTestNode(doc, content, { x: 5, y: 5 }, 0), false);
});

test("a broad marquee does not select content disjoint from its mask", () => {
  const doc = createEmptyDocument();
  doc.nodes.content = rect("content", 0, 0, 10, 10);
  doc.nodes.mask = rect("mask", 100, 0, 10, 10, { fill: null });
  doc.nodes.clip = group("clip", ["content", "mask"], { clip: true });
  doc.rootIds = ["clip"];

  assert.equal(marqueeHitNode(
    doc,
    doc.nodes.content,
    { x: 0, y: 0, width: 110, height: 10 }
  ), false);
  assert.equal(marqueeHitNode(
    doc,
    doc.nodes.mask,
    { x: 0, y: 0, width: 110, height: 10 }
  ), true);
});

test("symbol recursion applies definition masks and an instance's ancestor mask", () => {
  const doc = clippedDocument();
  doc.nodes.defRoot = group("defRoot", ["clip"]);
  doc.symbols.symbol = { id: "symbol", name: "Symbol", rootNodeId: "defRoot" };
  doc.nodes.instance = {
    id: "instance",
    name: "instance",
    type: "instance",
    symbolId: "symbol",
    opacity: 1,
    transform: [1, 0, 0, 1, 200, 0],
    transformOrigin: null,
  };
  doc.nodes.sceneMask = rect("sceneMask", 220, 20, 25, 25, { fill: null });
  doc.nodes.sceneClip = group("sceneClip", ["instance", "sceneMask"], { clip: true });
  doc.rootIds = ["sceneClip"];

  assert.deepEqual(nodeWorldBounds(doc, "instance"), {
    x: 220,
    y: 20,
    width: 100,
    height: 100,
  });
  assert.equal(hitTestNode(doc, doc.nodes.instance, { x: 230, y: 30 }, 0), true);
  assert.equal(hitTestNode(doc, doc.nodes.instance, { x: 260, y: 30 }, 0), false);
  assert.equal(marqueeHitNode(doc, doc.nodes.instance, {
    x: 225,
    y: 25,
    width: 5,
    height: 5,
  }), true);
  assert.equal(marqueeHitNode(doc, doc.nodes.instance, {
    x: 260,
    y: 25,
    width: 5,
    height: 5,
  }), false);
});
