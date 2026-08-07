import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let defaultMarker;
let hasMarkers;
let isMarkable;
let markerContours;
let strokeEndContours;
let suppressesStrokeCaps;
let markerOutset;
let strokeOutset;
let exportSvg;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let useEditor;
let markersFromDefaults;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({
    defaultMarker,
    hasMarkers,
    isMarkable,
    markerContours,
    markerOutset,
    strokeEndContours,
    suppressesStrokeCaps,
  } = await server.ssrLoadModule("/src/model/marker.ts"));
  ({ strokeOutset } = await server.ssrLoadModule("/src/model/stroke.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } =
    await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ markersFromDefaults, useEditor } =
    await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

const STROKE = { type: "solid", color: "#000000", alpha: 1 };

/** A horizontal line from (0,0) to (100,0), stroked 4 units wide. */
const line = (patch = {}) => ({
  id: "line-1",
  name: "Line",
  type: "line",
  ...SHAPE_BASE,
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  stroke: STROKE,
  strokeWidth: 4,
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 0,
  ...patch,
});

const pathShape = (subpaths, patch = {}) => ({
  id: "path-1",
  name: "Path",
  type: "path",
  ...SHAPE_BASE,
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  stroke: STROKE,
  strokeWidth: 4,
  fillRule: "nonzero",
  subpaths,
  ...patch,
});

const open = (points) => ({
  closed: false,
  anchors: points.map((p) => ({ p, hIn: null, hOut: null })),
});

const documentOf = (shape) => {
  const empty = createEmptyDocument();
  return { ...empty, rootIds: [shape.id], nodes: { [shape.id]: shape } };
};

test("only lines and paths can carry markers", () => {
  assert.equal(isMarkable(line()), true);
  assert.equal(isMarkable(pathShape([open([{ x: 0, y: 0 }, { x: 1, y: 0 }])])), true);
  assert.equal(isMarkable({ type: "rect" }), false);
  assert.equal(isMarkable({ type: "brush" }), false);
  assert.equal(isMarkable(null), false);
});

test("a marker sits on the end point, pointing out of the path", () => {
  const shape = line({ markerEnd: defaultMarker("triangle") });
  const [contour] = markerContours(shape);
  assert.equal(markerContours(shape).length, 1);
  assert.equal(contour.filled, true);
  // The triangle's tip is its first anchor and attaches at the line's end…
  const [tip, ...back] = contour.subpath.anchors.map((anchor) => anchor.p);
  assert.deepEqual(tip, { x: 100, y: 0 });
  // …with the body trailing back along the line, never past the end point.
  for (const p of back) assert.ok(p.x < 100, `${p.x} should trail the tip`);
});

test("the start marker points backwards, away from the path", () => {
  const shape = line({ markerStart: defaultMarker("triangle") });
  const [contour] = markerContours(shape);
  const [tip, ...back] = contour.subpath.anchors.map((anchor) => anchor.p);
  assert.deepEqual(tip, { x: 0, y: 0 });
  for (const p of back) assert.ok(p.x > 0, `${p.x} should trail the tip`);
});

test("flip turns a marker around without moving it", () => {
  const plain = markerContours(line({ markerEnd: defaultMarker("triangle") }))[0];
  const flipped = markerContours(
    line({ markerEnd: { ...defaultMarker("triangle"), flip: true } })
  )[0];
  const [tip] = flipped.subpath.anchors.map((anchor) => anchor.p);
  assert.deepEqual(tip, { x: 100, y: 0 });
  const backOf = (contour) => contour.subpath.anchors[1].p.x;
  assert.ok(backOf(plain) < 100 && backOf(flipped) > 100);
});

test("marker size scales with the stroke width and the marker's own scale", () => {
  const reach = (shape) =>
    Math.max(
      ...markerContours(shape).flatMap((contour) =>
        contour.subpath.anchors.map((anchor) => Math.abs(anchor.p.x - 100))
      )
    );
  const base = reach(line({ markerEnd: defaultMarker("triangle") }));
  const wide = reach(line({ strokeWidth: 8, markerEnd: defaultMarker("triangle") }));
  const big = reach(
    line({ markerEnd: { ...defaultMarker("triangle"), scale: 2 } })
  );
  assert.ok(Math.abs(wide - base * 2) < 1e-9);
  assert.ok(Math.abs(big - base * 2) < 1e-9);
});

test("closed contours and unstroked shapes get no markers", () => {
  const closed = pathShape(
    [{ closed: true, anchors: open([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]).anchors }],
    { markerStart: defaultMarker("arrow"), markerEnd: defaultMarker("arrow") }
  );
  assert.deepEqual(markerContours(closed), []);
  assert.deepEqual(markerContours(line({ stroke: null, markerEnd: defaultMarker("arrow") })), []);
  assert.deepEqual(markerContours(line({ strokeWidth: 0, markerEnd: defaultMarker("arrow") })), []);
  // …but the shape still *has* markers, so the panel keeps showing them.
  assert.equal(hasMarkers(line({ stroke: null, markerEnd: defaultMarker("arrow") })), true);
});

test("every open subpath of a multi-subpath path is marked", () => {
  const shape = pathShape(
    [
      open([{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      open([{ x: 0, y: 20 }, { x: 10, y: 20 }]),
      { closed: true, anchors: open([{ x: 0, y: 40 }, { x: 10, y: 40 }, { x: 10, y: 50 }]).anchors },
    ],
    { markerStart: defaultMarker("circle"), markerEnd: defaultMarker("circle") }
  );
  assert.equal(markerContours(shape).length, 4);
});

test("markers follow the modifier stack", () => {
  const shape = pathShape([open([{ x: 0, y: 0 }, { x: 100, y: 0 }])], {
    markerEnd: defaultMarker("triangle"),
    modifiers: [{ type: "reverse" }],
  });
  // Reversing swaps which end is last, so the end marker moves to the origin.
  const [tip] = markerContours(shape)[0].subpath.anchors.map((anchor) => anchor.p);
  assert.deepEqual(tip, { x: 0, y: 0 });
});

test("a marker widens the shape's paint reach", () => {
  const plain = line();
  const marked = line({ markerEnd: defaultMarker("triangle") });
  assert.equal(markerOutset(plain), 0);
  assert.ok(markerOutset(marked) > plain.strokeWidth);
  assert.equal(strokeOutset(marked), markerOutset(marked));
  // A hollow marker is traced with the pen, so it reaches half a width further.
  const hollow = line({ markerEnd: { ...defaultMarker("triangle"), filled: false } });
  assert.ok(
    Math.abs(markerOutset(hollow) - markerOutset(marked) - marked.strokeWidth / 2) < 1e-9
  );
});

test("SVG export emits markers beside the line, under one wrapper", () => {
  const shape = line({ opacity: 0.5, strokeCap: "butt", markerEnd: defaultMarker("triangle") });
  const svg = exportSvg(documentOf(shape));
  assert.match(svg, /<g opacity="0.5"><line /);
  // The marker is a sibling path filled with the stroke paint.
  const markers = svg.match(/<path d="M [^"]+" fill="#000000" stroke="none" \/>/g);
  assert.equal(markers?.length, 1);
  // The wrapper owns the opacity, so the line does not repeat it.
  assert.equal(/<line [^>]*opacity=/.test(svg), false);
});

test("a marker replaces the pen's cap on the end it claims", () => {
  const marked = line({ strokeCap: "round", markerEnd: defaultMarker("triangle") });
  assert.equal(suppressesStrokeCaps(marked), true);
  // Two contours: the arrowhead, plus the unmarked end's cap drawn as geometry.
  assert.equal(strokeEndContours(marked).length, 2);
  const svg = exportSvg(documentOf(marked));
  assert.match(svg, /<line [^>]*stroke-linecap="butt"/);

  // A dash pattern needs the pen's caps on every dash, so it opts out and the
  // ends keep them.
  const dashed = line({
    strokeCap: "round",
    strokeDash: [8, 4],
    markerEnd: defaultMarker("triangle"),
  });
  assert.equal(suppressesStrokeCaps(dashed), false);
  assert.equal(strokeEndContours(dashed).length, 1);
  assert.match(exportSvg(documentOf(dashed)), /<line [^>]*stroke-linecap="round"/);

  // Nothing changes for a shape without markers.
  assert.equal(suppressesStrokeCaps(line({ strokeCap: "round" })), false);
});

test("a hollow marker exports as a traced contour", () => {
  const shape = line({ markerEnd: { ...defaultMarker("circle"), filled: false } });
  const svg = exportSvg(documentOf(shape));
  assert.match(svg, /<path d="[^"]+" fill="none" stroke="#000000" stroke-width="4"/);
});

test("an unmarked shape still exports as a bare element", () => {
  const svg = exportSvg(documentOf(line()));
  assert.equal(/<g[^>]*><line/.test(svg), false);
});

test("markers round-trip through the file format", () => {
  const shape = line({
    markerStart: { shape: "bar", scale: 1.5, filled: false, flip: true },
    markerEnd: defaultMarker("diamond"),
  });
  const text = serializeDocument(documentOf(shape));
  const parsed = parseDocument(text).nodes[shape.id];
  assert.deepEqual(parsed.markerStart, shape.markerStart);
  assert.deepEqual(parsed.markerEnd, shape.markerEnd);
});

test("a malformed marker is rejected", () => {
  const bad = (marker) =>
    serializeDocument(documentOf(line({ markerEnd: marker })));
  assert.throws(() => parseDocument(bad({ shape: "spiral", scale: 1, filled: true, flip: false })));
  assert.throws(() => parseDocument(bad({ shape: "arrow", scale: 0, filled: true, flip: false })));
  assert.throws(() => parseDocument(bad({ shape: "arrow", scale: 1, filled: true })));
});

test("setSelectedMarkers sets and clears markers on markable shapes only", () => {
  const marked = line();
  const rect = {
    id: "rect-1",
    name: "Rect",
    type: "rect",
    ...SHAPE_BASE,
    ...NODE_BASE,
    transform: [1, 0, 0, 1, 0, 0],
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    cornerRadius: 0,
  };
  const empty = createEmptyDocument();
  useEditor.getState().loadDocument({
    ...empty,
    rootIds: [marked.id, rect.id],
    nodes: { [marked.id]: marked, [rect.id]: rect },
  });
  useEditor.getState().setSelection([marked.id, rect.id]);
  useEditor.getState().setSelectedMarkers({ end: defaultMarker("arrow") });
  assert.deepEqual(
    useEditor.getState().doc.nodes[marked.id].markerEnd,
    defaultMarker("arrow")
  );
  assert.equal("markerEnd" in useEditor.getState().doc.nodes[rect.id], false);

  // Clearing removes the field rather than storing a null.
  useEditor.getState().setSelectedMarkers({ end: null });
  assert.equal("markerEnd" in useEditor.getState().doc.nodes[marked.id], false);
});
