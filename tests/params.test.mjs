import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let syncParamBindings;
let varUsageCounts;
let remapModifierBindings;
let readNumField;
let createEmptyDocument;
let numberValue;
let parseDocument;
let serializeDocument;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ syncParamBindings, remapModifierBindings, readNumField } =
    await server.ssrLoadModule("/src/model/params.ts"));
  ({ varUsageCounts } = await server.ssrLoadModule("/src/model/vars.ts"));
  ({ createEmptyDocument, numberValue } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } =
    await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

const param = (id, value, patch = {}) => ({
  id,
  name: id,
  value: { ...numberValue(value), ...patch },
});

const rect = (patch = {}) => ({
  id: "rect-1",
  name: "Rect",
  type: "rect",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  cornerRadius: 0,
  transform: [1, 0, 0, 1, 0, 0],
  ...NODE_BASE,
  ...SHAPE_BASE,
  ...patch,
});

/** A one-node document carrying the given number variables. */
function docWith(node, params = []) {
  return {
    ...createEmptyDocument(),
    nodes: { [node.id]: node },
    rootIds: [node.id],
    vars: Object.fromEntries(params.map((p) => [p.id, p])),
    varOrder: params.map((p) => p.id),
  };
}

test("a bound field is re-derived from its parameter, through the per-use scale", () => {
  const doc = docWith(
    rect({ strokeWidth: 1, bindings: { strokeWidth: { varId: "w", scale: 0.5 } } }),
    [param("w", 8)]
  );
  const next = syncParamBindings(doc);
  assert.equal(next.nodes["rect-1"].strokeWidth, 4);
  // Already-resolved documents are returned unchanged, so callers can skip the
  // commit entirely.
  assert.equal(syncParamBindings(next), next);
});

test("an integer parameter rounds the value it drives", () => {
  const doc = docWith(
    rect({ strokeWidth: 0, bindings: { strokeWidth: { varId: "w", scale: 1 } } }),
    [param("w", 3.4, { integer: true })]
  );
  assert.equal(syncParamBindings(doc).nodes["rect-1"].strokeWidth, 3);
});

test("a dangling binding leaves the field at the value it was showing", () => {
  const doc = docWith(
    rect({ strokeWidth: 7, bindings: { strokeWidth: { varId: "gone", scale: 1 } } })
  );
  const next = syncParamBindings(doc);
  assert.equal(next.nodes["rect-1"].strokeWidth, 7);
  assert.deepEqual(
    next.nodes["rect-1"].bindings,
    { strokeWidth: { varId: "gone", scale: 1 } },
    "the link is kept so the parameter coming back re-attaches it"
  );
});

test("a binding whose field no longer exists is pruned", () => {
  // A group has no stroke width, and a detached generator has no args.
  const group = {
    id: "group-1",
    name: "Group",
    type: "group",
    clipsToMask: false,
    childIds: [],
    transform: [1, 0, 0, 1, 0, 0],
    ...NODE_BASE,
    bindings: {
      strokeWidth: { varId: "w", scale: 1 },
      "generator.args.radius": { varId: "w", scale: 1 },
    },
  };
  const next = syncParamBindings(docWith(group, [param("w", 5)]));
  assert.deepEqual(next.nodes["group-1"].bindings, {});
});

test("a bound generator arg retunes the built-in's geometry", () => {
  const star = {
    id: "star-1",
    name: "Star",
    type: "path",
    subpaths: [],
    fillRule: "nonzero",
    transform: [1, 0, 0, 1, 0, 0],
    ...NODE_BASE,
    ...SHAPE_BASE,
    generator: { scriptId: "star", args: { points: 5, radius: 80, innerRatio: 0.5 } },
    bindings: { "generator.args.radius": { varId: "r", scale: 1 } },
  };
  const next = syncParamBindings(docWith(star, [param("r", 40)]));
  const shape = next.nodes["star-1"];
  assert.equal(shape.generator.args.radius, 40);
  const reach = Math.max(...shape.subpaths[0].anchors.map((a) => Math.hypot(a.p.x, a.p.y)));
  assert.ok(Math.abs(reach - 40) < 1e-6, "the geometry was rebuilt at the new radius");
});

test("a bound field never goes outside its own legal domain", () => {
  // min/max on a parameter are scrubber hints, but a negative stroke width is
  // not a document the model accepts.
  const doc = docWith(
    rect({ strokeWidth: 2, bindings: { strokeWidth: { varId: "w", scale: 1 } } }),
    [param("w", -5)]
  );
  assert.equal(syncParamBindings(doc).nodes["rect-1"].strokeWidth, 0);
});

test("usage counts every bound field, not every bound node", () => {
  const doc = docWith(
    rect({
      generator: { scriptId: "star", args: { radius: 80 } },
      bindings: {
        strokeWidth: { varId: "w", scale: 1 },
        "generator.args.radius": { varId: "w", scale: 1 },
      },
    }),
    [param("w", 4)]
  );
  assert.equal(varUsageCounts(doc).get("w"), 2);
});

test("remapModifierBindings follows the modifier, not the slot", () => {
  const bindings = {
    strokeWidth: { varId: "w", scale: 1 },
    "modifiers.0.tolerance": { varId: "a", scale: 1 },
    "modifiers.2.width": { varId: "b", scale: 1 },
  };
  // Stage 1 removed: 0 stays, 2 slides down to 1.
  const removed = remapModifierBindings(bindings, new Map([[0, 0], [2, 1]]));
  assert.deepEqual(removed, {
    strokeWidth: { varId: "w", scale: 1 },
    "modifiers.0.tolerance": { varId: "a", scale: 1 },
    "modifiers.1.width": { varId: "b", scale: 1 },
  });
  // A stage that is not in the map went away with its binding.
  const dropped = remapModifierBindings(bindings, new Map([[2, 0]]));
  assert.deepEqual(dropped, {
    strokeWidth: { varId: "w", scale: 1 },
    "modifiers.0.width": { varId: "b", scale: 1 },
  });
});

test("readNumField addresses each bindable sink and nothing else", () => {
  const shape = rect({
    strokeWidth: 3,
    generator: { scriptId: "star", args: { radius: 80 } },
    modifiers: [{ type: "offset", distance: 12, join: "round" }],
    type: "path",
    subpaths: [],
    fillRule: "nonzero",
  });
  assert.equal(readNumField(shape, "strokeWidth"), 3);
  assert.equal(readNumField(shape, "generator.args.radius"), 80);
  assert.equal(readNumField(shape, "modifiers.0.distance"), 12);
  assert.equal(readNumField(shape, "modifiers.0.join"), null, "not a number field");
  assert.equal(readNumField(shape, "modifiers.1.distance"), null, "no such stage");
  assert.equal(readNumField(shape, "cornerRadius"), null, "not a phase-1 sink");
});

test("variables and bindings round-trip through the file format", () => {
  const doc = docWith(
    rect({ strokeWidth: 4, bindings: { strokeWidth: { varId: "w", scale: 2 } } }),
    [param("w", 2, { min: 0, max: 20, step: 0.5 })]
  );
  const text = serializeDocument(doc);
  assert.equal(JSON.parse(text).version, 34);
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.vars, doc.vars);
  assert.deepEqual(parsed.varOrder, ["w"]);
  assert.deepEqual(parsed.nodes["rect-1"].bindings, {
    strokeWidth: { varId: "w", scale: 2 },
  });
});

test("a v31 file without parameters still opens", () => {
  const legacy = {
    app: "vinegar",
    version: 31,
    document: (() => {
      const { vars, varOrder, ...rest } = docWith(rect());
      const { bindings, ...node } = rest.nodes["rect-1"];
      return { ...rest, swatches: {}, swatchOrder: [], nodes: { "rect-1": node } };
    })(),
  };
  const parsed = parseDocument(JSON.stringify(legacy));
  assert.deepEqual(parsed.vars, {});
  assert.deepEqual(parsed.varOrder, []);
  assert.deepEqual(parsed.nodes["rect-1"].bindings, {});
});

test("a file whose varOrder disagrees with its registry is rejected", () => {
  const doc = docWith(rect(), [param("w", 1)]);
  const text = serializeDocument({ ...doc, varOrder: ["w", "ghost"] });
  assert.throws(() => parseDocument(text), /Variable order/);
});

test("editing a variable retunes every field bound to it, in one undo step", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.loadDocument(
    docWith(
      rect({ strokeWidth: 2, bindings: { strokeWidth: { varId: "w", scale: 1 } } }),
      [param("w", 2)]
    )
  );
  const before = useEditor.getState().history.past.length;
  useEditor.getState().updateVar("w", { value: numberValue(9) });
  assert.equal(useEditor.getState().doc.nodes["rect-1"].strokeWidth, 9);
  assert.equal(useEditor.getState().history.past.length, before + 1);

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.vars.w.value.value, 2);
  assert.equal(useEditor.getState().doc.nodes["rect-1"].strokeWidth, 2);
});

test("binding a field keeps the value it is showing", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.loadDocument(docWith(rect({ strokeWidth: 6 }), [param("w", 4)]));
  useEditor.getState().bindField("rect-1", "strokeWidth", "w");
  const node = useEditor.getState().doc.nodes["rect-1"];
  assert.equal(node.strokeWidth, 6, "binding is a link, not an edit");
  assert.equal(node.bindings.strokeWidth.scale, 1.5);
  // …and the link is live from there on.
  useEditor.getState().updateVar("w", { value: numberValue(2) });
  assert.equal(useEditor.getState().doc.nodes["rect-1"].strokeWidth, 3);
});

test("deleting a variable detaches its fields instead of dangling them", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.loadDocument(
    docWith(
      rect({ strokeWidth: 5, bindings: { strokeWidth: { varId: "w", scale: 1 } } }),
      [param("w", 5)]
    )
  );
  useEditor.getState().deleteVar("w");
  const state = useEditor.getState();
  assert.deepEqual(state.doc.vars, {});
  assert.deepEqual(state.doc.varOrder, []);
  assert.deepEqual(state.doc.nodes["rect-1"].bindings, {});
  assert.equal(state.doc.nodes["rect-1"].strokeWidth, 5, "the picture never changes");
});

test("copying a bound node carries its variable to another document", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.loadDocument(
    docWith(
      rect({ strokeWidth: 4, bindings: { strokeWidth: { varId: "w", scale: 2 } } }),
      [param("w", 2)]
    )
  );
  useEditor.getState().setSelection(["rect-1"]);
  useEditor.getState().copySelected();
  const payload = useEditor.getState().clipboard;
  assert.deepEqual(Object.keys(payload.vars), ["w"]);

  // A fresh document lacks the variable; pasting brings it along.
  useEditor.getState().newDocument();
  assert.equal(useEditor.getState().pastePayload(payload), true);
  const pasted = useEditor.getState().doc;
  assert.equal(pasted.vars.w.value.value, 2);
  assert.deepEqual(pasted.varOrder, ["w"]);
  const node = Object.values(pasted.nodes)[0];
  assert.equal(node.bindings.strokeWidth.varId, "w");
  assert.equal(node.strokeWidth, 4);
});
