// Parametric symbols (docs/parameters.md, phase 2a): a symbol definition
// declares typed parameters, an instance overrides them, and a `var` paint
// inside the definition resolves against the instance's args, then the
// definition's defaults, then the document's variables.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let varRef;
let solid;
let documentScope;
let symbolScope;
let symbolDefScope;
let resolvePaint;
let scopeForNode;
let createEmptyDocument;
let paintValue;
let numberValue;
let parseDocument;
let serializeDocument;
let exportSvg;
let useEditor;
let syncParamBindings;
let scopedNode;
let instanceScope;
let visualNodeWorldBounds;
let hitTestNode;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ varRef, solid } = await server.ssrLoadModule("/src/model/paint.ts"));
  ({
    documentScope,
    symbolScope,
    symbolDefScope,
    resolvePaint,
    scopeForNode,
    instanceScope,
  } = await server.ssrLoadModule("/src/model/vars.ts"));
  ({ syncParamBindings, scopedNode } =
    await server.ssrLoadModule("/src/model/params.ts"));
  ({ visualNodeWorldBounds } =
    await server.ssrLoadModule("/src/canvas/render/bounds.ts"));
  ({ hitTestNode } =
    await server.ssrLoadModule("/src/model/geometry/hitTest.ts"));
  ({ createEmptyDocument, paintValue, numberValue } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } =
    await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

const IDENTITY = [1, 0, 0, 1, 0, 0];

const rect = (id, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  cornerRadius: 0,
  transform: [...IDENTITY],
  ...NODE_BASE,
  ...SHAPE_BASE,
  ...patch,
});

const group = (id, childIds) => ({
  id,
  name: id,
  type: "group",
  childIds,
  clipsToMask: false,
  transform: [...IDENTITY],
  ...NODE_BASE,
});

const instance = (id, symbolId, args = {}) => ({
  id,
  name: id,
  type: "instance",
  symbolId,
  args,
  transform: [...IDENTITY],
  ...NODE_BASE,
});

// Built inside the tests: `solid` only exists once the module is loaded.
const RED = () => solid("#ff0000");
const BLUE = () => solid("#0000ff");

/**
 * One symbol whose leaf fill references the parameter `c` (default red), placed
 * twice: `i1` takes the default, `i2` overrides it with blue.
 */
function docWithParametricSymbol() {
  const leaf = rect("leaf", { fill: varRef("c") });
  return {
    ...createEmptyDocument(),
    nodes: {
      leaf,
      defRoot: group("defRoot", ["leaf"]),
      i1: instance("i1", "sym"),
      i2: instance("i2", "sym", { c: paintValue(BLUE()) }),
    },
    rootIds: ["i1", "i2"],
    symbols: {
      sym: {
        id: "sym",
        name: "Sym",
        rootNodeId: "defRoot",
        params: [{ key: "c", label: "Color", default: paintValue(RED()) }],
      },
    },
  };
}

test("one definition paints differently per instance", () => {
  const doc = docWithParametricSymbol();
  const fill = doc.nodes.leaf.fill;
  const at = (id) =>
    resolvePaint(
      fill,
      symbolScope(documentScope(doc), doc.symbols.sym, doc.nodes[id])
    );
  assert.deepEqual(at("i1"), RED(), "no override: the definition's default");
  assert.deepEqual(at("i2"), BLUE(), "the instance's own value wins");
  // Outside any instance the scope is the document's own variables, so a
  // reference to a symbol parameter simply has nothing to resolve against.
  assert.equal(resolvePaint(fill, documentScope(doc)), null);
  // Editing the definition's default moves every instance that has no override.
  const green = solid("#00ff00");
  const edited = {
    ...doc,
    symbols: {
      sym: {
        ...doc.symbols.sym,
        params: [{ key: "c", label: "Color", default: paintValue(green) }],
      },
    },
  };
  assert.deepEqual(
    resolvePaint(fill, symbolScope(documentScope(edited), edited.symbols.sym, edited.nodes.i1)),
    green
  );
});

test("an override of the wrong type is ignored, not honoured", () => {
  const doc = docWithParametricSymbol();
  const wrong = instance("i3", "sym", { c: numberValue(4) });
  const scope = symbolScope(documentScope(doc), doc.symbols.sym, wrong);
  assert.deepEqual(resolvePaint(doc.nodes.leaf.fill, scope), RED());
});

test("symbol-edit focus resolves against the definition's own defaults", () => {
  const doc = docWithParametricSymbol();
  // Painting the definition directly (no instance) is what focus does.
  assert.deepEqual(
    resolvePaint(doc.nodes.leaf.fill, scopeForNode(doc, "leaf")),
    RED()
  );
  assert.deepEqual(
    resolvePaint(doc.nodes.leaf.fill, symbolDefScope(doc, doc.symbols.sym)),
    RED()
  );
});

test("a definition still tracks a document variable it references", () => {
  const doc = docWithParametricSymbol();
  const brandLeaf = { ...doc.nodes.leaf, fill: varRef("brand") };
  const withBrand = {
    ...doc,
    nodes: { ...doc.nodes, leaf: brandLeaf },
    vars: { brand: { id: "brand", name: "Brand", value: paintValue(BLUE()) } },
    varOrder: ["brand"],
  };
  // The parameter frame shadows nothing here, so the chain falls through to the
  // document.
  const scope = symbolScope(
    documentScope(withBrand),
    withBrand.symbols.sym,
    withBrand.nodes.i1
  );
  assert.deepEqual(resolvePaint(brandLeaf.fill, scope), BLUE());
});

test("SVG export bakes each instance's own overrides", () => {
  const svg = exportSvg(docWithParametricSymbol());
  assert.equal((svg.match(/fill="#ff0000"/g) ?? []).length, 1);
  assert.equal((svg.match(/fill="#0000ff"/g) ?? []).length, 1);
});

test("symbol parameters and instance args round-trip through the file format", () => {
  const doc = docWithParametricSymbol();
  const text = serializeDocument(doc);
  assert.equal(JSON.parse(text).version, 36);
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.symbols.sym.params, doc.symbols.sym.params);
  assert.deepEqual(parsed.nodes.i2.args, { c: paintValue(BLUE()) });
  assert.deepEqual(parsed.nodes.i1.args, {});
});

test("promoting a fill declares a parameter without changing the picture", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const doc = createEmptyDocument();
  doc.nodes = {
    leaf: rect("leaf", { fill: RED() }),
    defRoot: group("defRoot", ["leaf"]),
    i1: instance("i1", "sym"),
  };
  doc.rootIds = ["i1"];
  doc.symbols.sym = { id: "sym", name: "Sym", rootNodeId: "defRoot", params: [] };
  editor.loadDocument(doc);

  const key = useEditor.getState().promoteToSymbolParam("leaf", "fill", "Body");
  assert.ok(key, "the node is inside a definition");
  const after = useEditor.getState().doc;
  assert.deepEqual(after.symbols.sym.params, [
    { key, label: "Body", default: paintValue(RED()) },
  ]);
  assert.deepEqual(after.nodes.leaf.fill, varRef(key));
  // Nothing moved: the instance still paints the colour it painted before.
  assert.deepEqual(
    resolvePaint(
      after.nodes.leaf.fill,
      symbolScope(documentScope(after), after.symbols.sym, after.nodes.i1)
    ),
    RED()
  );

  // Overriding is per instance; clearing falls back to the default.
  useEditor.getState().setInstanceArg("i1", key, paintValue(BLUE()));
  assert.deepEqual(useEditor.getState().doc.nodes.i1.args[key], paintValue(BLUE()));
  useEditor.getState().setInstanceArg("i1", key, null);
  assert.deepEqual(useEditor.getState().doc.nodes.i1.args, {});

  // Removing the parameter bakes the default back into the field.
  useEditor.getState().removeSymbolParam("sym", key);
  const removed = useEditor.getState().doc;
  assert.deepEqual(removed.symbols.sym.params, []);
  assert.deepEqual(removed.nodes.leaf.fill, RED());
});

test("promotion outside a symbol definition is refused", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const doc = createEmptyDocument();
  doc.nodes = { loose: rect("loose", { fill: RED() }) };
  doc.rootIds = ["loose"];
  editor.loadDocument(doc);
  assert.equal(useEditor.getState().promoteToSymbolParam("loose", "fill"), null);
});

// ---------------------------------------------------------------------------
// Phase 2b: numeric parameters. A binding inside a definition resolves through
// the instance being evaluated, so one definition draws different *geometry*
// per instance while its stored numbers stay the definition's defaults.
// ---------------------------------------------------------------------------

/**
 * One symbol whose leaf binds its stroke width to the parameter `w`
 * (default 4), placed twice: `i1` takes the default, `i2` overrides it with 20.
 */
function docWithNumericSymbol(patch = {}) {
  const leaf = rect("leaf", {
    stroke: solid("#000000"),
    strokeWidth: 4,
    bindings: { strokeWidth: { varId: "w", scale: 1 } },
    ...patch,
  });
  return {
    ...createEmptyDocument(),
    nodes: {
      leaf,
      defRoot: group("defRoot", ["leaf"]),
      i1: instance("i1", "sym"),
      i2: instance("i2", "sym", { w: numberValue(20) }),
    },
    rootIds: ["i1", "i2"],
    symbols: {
      sym: {
        id: "sym",
        name: "Sym",
        rootNodeId: "defRoot",
        params: [{ key: "w", label: "Weight", default: numberValue(4) }],
      },
    },
  };
}

test("the definition stores the default; the instance's value is derived", () => {
  const doc = syncParamBindings(docWithNumericSymbol());
  // Committing resolves the definition's own fields against its defaults, so
  // any reader that ignores scopes still sees a correct drawing.
  assert.equal(doc.nodes.leaf.strokeWidth, 4);

  const at = (id) =>
    scopedNode(doc.nodes.leaf, instanceScope(doc, doc.nodes[id])).strokeWidth;
  assert.equal(at("i1"), 4, "no override: the definition's default");
  assert.equal(at("i2"), 20, "the instance's own value wins");
  // The scoped node is memoized, so the caches downstream of it keep hitting.
  assert.equal(
    scopedNode(doc.nodes.leaf, instanceScope(doc, doc.nodes.i2)),
    scopedNode(doc.nodes.leaf, instanceScope(doc, doc.nodes.i2))
  );
  // An instance that overrides nothing reads the stored node itself, so it
  // shares every geometry cache with the definition.
  assert.equal(
    scopedNode(doc.nodes.leaf, instanceScope(doc, doc.nodes.i1)),
    doc.nodes.leaf
  );
});

test("a numeric override retunes geometry, not just a number", () => {
  // The parameter drives a generator arg, whose geometry is rebuilt per scope.
  const doc = syncParamBindings({
    ...docWithNumericSymbol(),
    nodes: {
      ...docWithNumericSymbol().nodes,
      leaf: {
        ...rect("leaf"),
        type: "path",
        subpaths: [],
        fillRule: "nonzero",
        generator: {
          scriptId: "star",
          args: { points: 5, radius: 10, innerRatio: 0.5 },
        },
        bindings: { "generator.args.radius": { varId: "w", scale: 1 } },
      },
    },
  });
  const reach = (id) => {
    const node = scopedNode(doc.nodes.leaf, instanceScope(doc, doc.nodes[id]));
    return Math.max(...node.subpaths[0].anchors.map((a) => Math.hypot(a.p.x, a.p.y)));
  };
  assert.ok(Math.abs(reach("i1") - 4) < 1e-6);
  assert.ok(Math.abs(reach("i2") - 20) < 1e-6);
});

test("bounds and hit-testing follow the instance's own numbers", () => {
  const doc = syncParamBindings(docWithNumericSymbol());
  // Stroke width widens the painted bounds, which is what culling and the
  // selection frame measure.
  const cache = new Map();
  const b1 = visualNodeWorldBounds(doc, "i1", cache);
  const b2 = visualNodeWorldBounds(doc, "i2", cache);
  assert.ok(b2.width > b1.width, "the heavier instance paints wider");

  // A point just outside the shape lands on the thick instance's stroke only.
  const outside = { x: -6, y: 5 };
  assert.equal(hitTestNode(doc, doc.nodes.i1, outside, 0), false);
  assert.equal(hitTestNode(doc, doc.nodes.i2, outside, 0), true);
});

test("SVG export bakes each instance's own numeric overrides", () => {
  const svg = exportSvg(syncParamBindings(docWithNumericSymbol()));
  assert.equal((svg.match(/stroke-width="4"/g) ?? []).length, 1);
  assert.equal((svg.match(/stroke-width="20"/g) ?? []).length, 1);
});

test("promoting a number declares a parameter without changing the picture", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const doc = createEmptyDocument();
  doc.nodes = {
    leaf: rect("leaf", { stroke: solid("#000000"), strokeWidth: 6 }),
    defRoot: group("defRoot", ["leaf"]),
    i1: instance("i1", "sym"),
  };
  doc.rootIds = ["i1"];
  doc.symbols.sym = { id: "sym", name: "Sym", rootNodeId: "defRoot", params: [] };
  editor.loadDocument(doc);

  const key = useEditor
    .getState()
    .promoteNumberToSymbolParam("leaf", "strokeWidth", "Weight");
  assert.ok(key, "the field is inside a definition");
  let after = useEditor.getState().doc;
  assert.deepEqual(after.symbols.sym.params, [
    { key, label: "Weight", default: numberValue(6, { integer: true }) },
  ]);
  assert.deepEqual(after.nodes.leaf.bindings, {
    strokeWidth: { varId: key, scale: 1 },
  });
  assert.equal(after.nodes.leaf.strokeWidth, 6, "nothing moved");

  // Overriding is per instance and never writes the definition's node.
  useEditor.getState().setInstanceArg("i1", key, numberValue(9));
  after = useEditor.getState().doc;
  assert.equal(after.nodes.leaf.strokeWidth, 6);
  assert.equal(
    scopedNode(after.nodes.leaf, instanceScope(after, after.nodes.i1)).strokeWidth,
    9
  );

  // Retuning the default moves every instance that has no override.
  useEditor.getState().setInstanceArg("i1", key, null);
  useEditor.getState().setSymbolParamDefault("sym", key, numberValue(2));
  after = useEditor.getState().doc;
  assert.equal(after.nodes.leaf.strokeWidth, 2);

  // Removing the parameter leaves the field on the number it was showing.
  useEditor.getState().removeSymbolParam("sym", key);
  after = useEditor.getState().doc;
  assert.deepEqual(after.symbols.sym.params, []);
  assert.deepEqual(after.nodes.leaf.bindings, {});
  assert.equal(after.nodes.leaf.strokeWidth, 2);
});

test("detaching an instance bakes the overrides it was showing", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const doc = createEmptyDocument();
  doc.nodes = {
    leaf: rect("leaf", {
      fill: varRef("c"),
      stroke: solid("#000000"),
      strokeWidth: 4,
      bindings: { strokeWidth: { varId: "w", scale: 1 } },
    }),
    defRoot: group("defRoot", ["leaf"]),
    i2: instance("i2", "sym", { c: paintValue(BLUE()), w: numberValue(20) }),
  };
  doc.rootIds = ["i2"];
  doc.symbols.sym = {
    id: "sym",
    name: "Sym",
    rootNodeId: "defRoot",
    params: [
      { key: "c", label: "Color", default: paintValue(RED()) },
      { key: "w", label: "Weight", default: numberValue(4) },
    ],
  };
  editor.loadDocument(doc);
  useEditor.setState({ selection: ["i2"] });
  useEditor.getState().detachSelectedInstances();

  const after = useEditor.getState().doc;
  // The definition itself is untouched; the copy is what left the scope.
  assert.deepEqual(after.nodes.leaf.fill, varRef("c"));
  const copy = Object.values(after.nodes).find(
    (node) => node.type === "rect" && node.id !== "leaf"
  );
  assert.ok(copy, "the instance became a group of copies");
  // Both references left the frame their parameter lives in, so both are baked
  // to what this instance was showing — not to the definition's defaults, and
  // not to a dangling reference (which would paint nothing).
  assert.deepEqual(copy.fill, BLUE());
  assert.equal(copy.strokeWidth, 20);
  assert.deepEqual(copy.bindings, {});
});

test("detaching keeps references to document variables live", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const doc = createEmptyDocument();
  doc.vars = { brand: { id: "brand", name: "Brand", value: paintValue(BLUE()) } };
  doc.varOrder = ["brand"];
  doc.nodes = {
    leaf: rect("leaf", { fill: varRef("brand") }),
    defRoot: group("defRoot", ["leaf"]),
    i1: instance("i1", "sym"),
  };
  doc.rootIds = ["i1"];
  doc.symbols.sym = { id: "sym", name: "Sym", rootNodeId: "defRoot", params: [] };
  editor.loadDocument(doc);
  useEditor.setState({ selection: ["i1"] });
  useEditor.getState().detachSelectedInstances();

  const after = useEditor.getState().doc;
  const copy = Object.values(after.nodes).find(
    (node) => node.type === "rect" && node.id !== "leaf"
  );
  // A document variable is still in scope after detaching, so the link stays.
  assert.deepEqual(copy.fill, varRef("brand"));
});
