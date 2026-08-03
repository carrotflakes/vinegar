// The boolean path modifier (docs/parameters.md phase 3, docs/path-modifiers.md):
// the first stage that reads another node's geometry. Resolution follows the
// operand live, a cycle is refused, and a dangling operand disables the stage
// instead of emptying the shape.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let resolvedSubpaths;
let booleanOperandError;
let hasAcyclicModifierOperands;
let wouldCycleThroughOperand;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let exportSvg;
let worldShapeBounds;
let hitTestShape;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ resolvedSubpaths, booleanOperandError } =
    await server.ssrLoadModule("/src/model/path/pathModifiers.ts"));
  ({ hasAcyclicModifierOperands, wouldCycleThroughOperand } =
    await server.ssrLoadModule("/src/model/sceneValidation.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } =
    await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ worldShapeBounds } = await server.ssrLoadModule("/src/model/geometry/bounds.ts"));
  ({ hitTestShape } = await server.ssrLoadModule("/src/model/geometry/hitTest.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** A closed rectangle contour as a path shape, at `x` with size `w`×`h`. */
const boxPath = (id, x, y, w, h, patch = {}) => ({
  id,
  name: id,
  type: "path",
  fillRule: "nonzero",
  subpaths: [
    {
      closed: true,
      anchors: [
        { p: { x, y }, hIn: null, hOut: null },
        { p: { x: x + w, y }, hIn: null, hOut: null },
        { p: { x: x + w, y: y + h }, hIn: null, hOut: null },
        { p: { x, y: y + h }, hIn: null, hOut: null },
      ],
    },
  ],
  transform: [...IDENTITY],
  ...NODE_BASE,
  ...SHAPE_BASE,
  ...patch,
});

/** Axis-aligned bounds of a resolved subpath set. */
function boundsOf(subpaths) {
  const xs = subpaths.flatMap((sp) => sp.anchors.map((a) => a.p.x));
  const ys = subpaths.flatMap((sp) => sp.anchors.map((a) => a.p.y));
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * A 0..100 square that subtracts a square covering its right half, so the
 * combined outline is the left half alone.
 */
function docWithBoolean(op = "subtract") {
  const target = boxPath("target", 0, 0, 100, 100, {
    // Filled, so hit-testing has an interior to pick.
    fill: { type: "solid", color: "#000000", alpha: 1 },
    modifiers: [{ type: "boolean", op, operandId: "cutter" }],
  });
  const cutter = boxPath("cutter", 50, 0, 100, 100, { hidden: true });
  return {
    ...createEmptyDocument(),
    nodes: { target, cutter },
    rootIds: ["target", "cutter"],
  };
}

test("a boolean stage combines with the operand's live geometry", () => {
  const doc = docWithBoolean();
  const resolved = resolvedSubpaths(doc.nodes.target, doc);
  const b = boundsOf(resolved);
  assert.ok(Math.abs(b.x - 0) < 1e-6);
  assert.ok(Math.abs(b.right - 50) < 1e-6, "the right half was subtracted");

  // Moving the operand re-resolves the target, even though the target node
  // object is untouched — the identity memo keys on the operand too.
  const moved = {
    ...doc,
    nodes: { ...doc.nodes, cutter: { ...doc.nodes.cutter, transform: [1, 0, 0, 1, 25, 0] } },
  };
  assert.ok(
    Math.abs(boundsOf(resolvedSubpaths(moved.nodes.target, moved)).right - 75) < 1e-6,
    "the cut follows the operand's transform"
  );
  // The same node in the same document resolves to the identical array, so the
  // Path2D and geometry caches downstream stay valid.
  assert.equal(
    resolvedSubpaths(doc.nodes.target, doc),
    resolvedSubpaths(doc.nodes.target, doc)
  );
});

test("an intersect keeps only the shared area", () => {
  const doc = docWithBoolean("intersect");
  const b = boundsOf(resolvedSubpaths(doc.nodes.target, doc));
  assert.ok(Math.abs(b.x - 50) < 1e-6 && Math.abs(b.right - 100) < 1e-6);
});

test("without a document the stage is skipped, not applied", () => {
  // Every reader on the render / hit-test / export path passes the document;
  // a caller that cannot degrades to the un-combined base geometry rather than
  // to an empty shape.
  const doc = docWithBoolean();
  assert.deepEqual(
    resolvedSubpaths(doc.nodes.target),
    doc.nodes.target.subpaths
  );
});

test("a dangling or empty operand disables the stage and says why", () => {
  const doc = docWithBoolean();
  const orphaned = { ...doc, nodes: { target: doc.nodes.target }, rootIds: ["target"] };
  assert.deepEqual(
    resolvedSubpaths(orphaned.nodes.target, orphaned),
    orphaned.nodes.target.subpaths,
    "the shape keeps its own geometry"
  );
  assert.match(booleanOperandError(orphaned.nodes.target, 0, orphaned), /gone/);

  const unset = boxPath("target", 0, 0, 10, 10, {
    modifiers: [{ type: "boolean", op: "subtract", operandId: "" }],
  });
  const pending = { ...doc, nodes: { target: unset }, rootIds: ["target"] };
  assert.match(booleanOperandError(unset, 0, pending), /Pick a shape/);
  assert.equal(booleanOperandError(doc.nodes.target, 0, doc), null);
});

test("a disabled stage contributes nothing", () => {
  const doc = docWithBoolean();
  const off = {
    ...doc,
    nodes: {
      ...doc.nodes,
      target: {
        ...doc.nodes.target,
        modifiers: [{ ...doc.nodes.target.modifiers[0], enabled: false }],
      },
    },
  };
  assert.deepEqual(
    resolvedSubpaths(off.nodes.target, off),
    off.nodes.target.subpaths
  );
});

test("operand edges must form a DAG", () => {
  const doc = docWithBoolean();
  assert.equal(hasAcyclicModifierOperands(doc), true);
  assert.equal(wouldCycleThroughOperand(doc, "cutter", "target"), true);
  assert.equal(wouldCycleThroughOperand(doc, "target", "cutter"), false);

  const cyclic = {
    ...doc,
    nodes: {
      ...doc.nodes,
      cutter: {
        ...doc.nodes.cutter,
        modifiers: [{ type: "boolean", op: "union", operandId: "target" }],
      },
    },
  };
  assert.equal(hasAcyclicModifierOperands(cyclic), false);
  // Even so, evaluating one must terminate rather than hang the tab.
  assert.ok(Array.isArray(resolvedSubpaths(cyclic.nodes.target, cyclic)));
  const file = JSON.parse(serializeDocument(doc));
  file.document.nodes.cutter.modifiers = [
    { type: "boolean", op: "union", operandId: "target" },
  ];
  assert.throws(() => parseDocument(JSON.stringify(file)), /cyclic/);
});

test("bounds, hit-testing and SVG export all follow the combined outline", () => {
  const doc = docWithBoolean();
  // Bounds stop at the cut.
  const bounds = worldShapeBounds(doc, doc.nodes.target);
  assert.ok(Math.abs(bounds.width - 50) < 1e-6, `width ${bounds.width}`);
  // A point in the removed half is no longer inside the shape.
  assert.equal(hitTestShape(doc, doc.nodes.target, { x: 25, y: 50 }, 1), true);
  assert.equal(hitTestShape(doc, doc.nodes.target, { x: 75, y: 50 }, 1), false);
  // And the emitted path data ends at the cut too (the hidden operand is not
  // painted at all, so its own 150 never appears).
  const svg = exportSvg(doc);
  const d = /<path d="([^"]+)"/.exec(svg)?.[1] ?? "";
  const xs = d.match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 0);
  assert.ok(Math.max(...xs) <= 50 + 1e-6, `max x ${Math.max(...xs)}`);
});

test("boolean modifiers round-trip through the file format", () => {
  const doc = docWithBoolean();
  const text = serializeDocument(doc);
  assert.equal(JSON.parse(text).version, 35);
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.nodes.target.modifiers, [
    { type: "boolean", op: "subtract", operandId: "cutter" },
  ]);
  // An unknown op is not a document this build accepts.
  const file = JSON.parse(text);
  file.document.nodes.target.modifiers[0].op = "nope";
  assert.throws(() => parseDocument(JSON.stringify(file)));
});

test("duplicating a combined pair rewires the copy to the copy", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const doc = createEmptyDocument();
  doc.nodes = { a: boxPath("a", 0, 0, 100, 100), b: boxPath("b", 50, 0, 100, 100) };
  doc.rootIds = ["a", "b"];
  editor.loadDocument(doc);
  useEditor.getState().setSelection(["a", "b"]);
  useEditor.getState().combineSelectedLive("subtract");

  useEditor.getState().setSelection(["a", "b"]);
  useEditor.getState().duplicateSelected();
  const after = useEditor.getState().doc;
  const copies = useEditor.getState().selection;
  const copy = copies
    .map((id) => after.nodes[id])
    .find((node) => node.modifiers?.length);
  const operandId = copy.modifiers[0].operandId;
  assert.ok(
    copies.includes(operandId),
    "the copy cuts against its own copy, not the original"
  );
  assert.notEqual(operandId, "b");
});

test("an operand across a symbol boundary is refused and reported", () => {
  // A definition's content has no single world placement, so there is no
  // well-defined offset between it and a node outside the symbol.
  const editor = useEditor.getState();
  editor.newDocument();
  const doc = createEmptyDocument();
  doc.nodes = {
    inner: boxPath("inner", 0, 0, 100, 100, {
      modifiers: [{ type: "boolean", op: "subtract", operandId: "outside" }],
    }),
    defRoot: {
      id: "defRoot",
      name: "defRoot",
      type: "group",
      childIds: ["inner"],
      clipsToMask: false,
      transform: [...IDENTITY],
      ...NODE_BASE,
    },
    inst: {
      id: "inst",
      name: "inst",
      type: "instance",
      symbolId: "sym",
      args: {},
      transform: [...IDENTITY],
      ...NODE_BASE,
    },
    outside: boxPath("outside", 50, 0, 100, 100),
  };
  doc.rootIds = ["inst", "outside"];
  doc.symbols.sym = { id: "sym", name: "Sym", rootNodeId: "defRoot", params: [] };
  editor.loadDocument(doc);
  const loaded = useEditor.getState().doc;
  assert.deepEqual(
    resolvedSubpaths(loaded.nodes.inner, loaded),
    loaded.nodes.inner.subpaths,
    "the stage contributes nothing across the boundary"
  );
  assert.match(booleanOperandError(loaded.nodes.inner, 0, loaded), /different symbol/);
});

test("combine (live) keeps the operand editable and refuses a cycle", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const doc = createEmptyDocument();
  doc.nodes = {
    a: boxPath("a", 0, 0, 100, 100),
    b: boxPath("b", 50, 0, 100, 100),
  };
  doc.rootIds = ["a", "b"];
  editor.loadDocument(doc);

  useEditor.getState().setSelection(["a", "b"]);
  useEditor.getState().combineSelectedLive("subtract");
  const after = useEditor.getState().doc;
  assert.deepEqual(after.nodes.a.modifiers, [
    { type: "boolean", op: "subtract", operandId: "b" },
  ]);
  assert.equal(after.nodes.b.hidden, true, "the operand stays in the scene");
  assert.ok(
    Math.abs(boundsOf(resolvedSubpaths(after.nodes.a, after)).right - 50) < 1e-6
  );

  // Pointing the operand back at its consumer would close a cycle.
  useEditor.getState().setModifierOperand("a", 0, "a");
  assert.equal(useEditor.getState().doc.nodes.a.modifiers[0].operandId, "b");

  // Applying bakes the combined geometry into the base.
  useEditor.getState().setSelection(["a"]);
  useEditor.getState().applyPathModifiersSelected();
  const baked = useEditor.getState().doc.nodes.a;
  assert.deepEqual(baked.modifiers, []);
  assert.ok(Math.abs(boundsOf(baked.subpaths).right - 50) < 1e-6);
});
