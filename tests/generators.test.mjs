import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let resolveGenerator;
let compileScript;
let GENERATORS;
let defaultArgs;
let withSubpath;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ resolveGenerator, compileScript, GENERATORS, defaultArgs } = await server.ssrLoadModule("/src/model/generators.ts"));
  ({ withSubpath } = await server.ssrLoadModule("/src/model/path.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

test("built-in generators build valid geometry (curves, open paths, holes)", () => {
  const build = (id) => GENERATORS[id].build(defaultArgs(GENERATORS[id]));

  // Gear: outer teeth + a reverse-wound center hole => two subpaths.
  const gear = build("gear");
  assert.equal(gear.length, 2);
  assert.ok(gear.every((sp) => sp.closed));
  const solidGear = GENERATORS.gear.build({ teeth: 8, radius: 80, toothDepth: 0.2, hole: 0 });
  assert.equal(solidGear.length, 1); // no hole => single subpath

  // Spiral: one OPEN subpath with Bézier handles.
  const spiral = build("spiral");
  assert.equal(spiral.length, 1);
  assert.equal(spiral[0].closed, false);
  assert.ok(spiral[0].anchors.some((a) => a.hIn || a.hOut));

  // Flower: closed smooth curve (handles present).
  const flower = build("flower");
  assert.equal(flower[0].closed, true);
  assert.ok(flower[0].anchors.every((a) => a.hIn && a.hOut));

  // Moon: one closed 4-anchor outline; at full phase the terminator mirrors the
  // limb (a full disc), at half the terminator collapses to the vertical axis.
  const full = GENERATORS.moon.build({ phase: 0.5, radius: 80 });
  assert.equal(full.length, 1);
  assert.equal(full[0].anchors.length, 4);
  assert.equal(full[0].anchors[1].p.x, -full[0].anchors[3].p.x); // limb vs terminator
  const half = GENERATORS.moon.build({ phase: 0.25, radius: 80 });
  assert.equal(half[0].anchors[3].p.x, 0); // straight terminator at quarter-phase

  // Every generator's default args produce at least one non-empty subpath.
  for (const id of Object.keys(GENERATORS)) {
    const out = build(id);
    assert.ok(Array.isArray(out) && out.length > 0, `${id} built nothing`);
    assert.ok(out.every((sp) => sp.anchors.length >= 2), `${id} has a degenerate subpath`);
  }
});

test("the built-in star generator inserts, retunes, and detaches on edit", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.insertGenerator("star", { x: 100, y: 100 });

  const [id] = useEditor.getState().selection;
  const shape = useEditor.getState().doc.nodes[id];
  assert.equal(shape.type, "path");
  assert.equal(shape.generator.scriptId, "star");
  // Default 5-point star => 10 alternating anchors, centered on the origin.
  assert.equal(shape.subpaths[0].anchors.length, 10);
  assert.deepEqual(shape.transform, [1, 0, 0, 1, 100, 100]);

  useEditor.getState().setGeneratorArgs(id, { points: 8 });
  const retuned = useEditor.getState().doc.nodes[id];
  assert.equal(retuned.subpaths[0].anchors.length, 16);
  assert.equal(retuned.generator.args.points, 8);

  // Editing a subpath directly drops the parametric link.
  const detached = withSubpath(retuned, 0, retuned.subpaths[0]);
  assert.equal(detached.generator, undefined);
});

test("a user script compiles, builds geometry, and round-trips in the document", async () => {
  const source = `
    const params = [
      { key: "sides", label: "Sides", min: 3, max: 12, step: 1, default: 4, integer: true },
      { key: "radius", label: "Radius", min: 1, max: 400, step: 1, default: 50 },
    ];
    function build(args) {
      const anchors = [];
      for (let i = 0; i < args.sides; i++) {
        const a = (i * 2 * Math.PI) / args.sides;
        anchors.push({ p: { x: Math.cos(a) * args.radius, y: Math.sin(a) * args.radius }, hIn: null, hOut: null });
      }
      return [{ anchors, closed: true }];
    }
    return { params, build };
  `;
  const compiled = compileScript(source);
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.params.length, 2);
  assert.equal(compiled.build({ sides: 4, radius: 50 })[0].anchors.length, 4);

  const editor = useEditor.getState();
  editor.newDocument();
  const scriptId = useEditor.getState().addScript("Polygon", source);
  // resolveGenerator is read-only: it never runs code, so a script with no
  // cached metadata resolves to a "compiling" placeholder (no build here).
  const gen = resolveGenerator(scriptId, useEditor.getState().doc.scripts);
  assert.equal(gen.name, "Polygon");
  assert.equal(gen.status, "compiling");
  assert.equal(gen.build, undefined);

  // Document scripts build in a Worker (main-thread sync fallback under Node).
  await useEditor.getState().insertGenerator(scriptId, { x: 0, y: 0 });
  const [nodeId] = useEditor.getState().selection;
  assert.equal(useEditor.getState().doc.nodes[nodeId].subpaths[0].anchors.length, 4);

  const loaded = parseDocument(serializeDocument(useEditor.getState().doc));
  assert.equal(loaded.scripts[scriptId].source, source);
  assert.equal(loaded.nodes[nodeId].generator.scriptId, scriptId);
  assert.equal(loaded.nodes[nodeId].generator.args.sides, 4);
});

test("retuning a script node commits args and geometry atomically when built", async () => {
  const source = `
    const params = [{ key: "sides", label: "Sides", min: 3, max: 12, step: 1, default: 4, integer: true }];
    function build(args) {
      const anchors = [];
      for (let i = 0; i < args.sides; i++) anchors.push({ p: { x: i, y: 0 }, hIn: null, hOut: null });
      return [{ anchors, closed: true }];
    }
    return { params, build };
  `;
  const editor = useEditor.getState();
  editor.newDocument();
  const scriptId = useEditor.getState().addScript("Poly", source);
  await useEditor.getState().insertGenerator(scriptId, { x: 0, y: 0 });
  const [id] = useEditor.getState().selection;

  const pending = useEditor.getState().setGeneratorArgs(id, { sides: 7 });
  // Nothing lands until the build resolves: args and geometry stay consistent
  // (still the previous 4), so the document/undo history is never mid-edit.
  assert.equal(useEditor.getState().doc.nodes[id].generator.args.sides, 4);
  assert.equal(useEditor.getState().doc.nodes[id].subpaths[0].anchors.length, 4);
  await pending;
  // Then both update together.
  assert.equal(useEditor.getState().doc.nodes[id].generator.args.sides, 7);
  assert.equal(useEditor.getState().doc.nodes[id].subpaths[0].anchors.length, 7);
});

test("a pending script insert is discarded when the document is replaced", async () => {
  const source =
    "return { params: [], build: () => [{ anchors: [{ p: { x: 0, y: 0 }, hIn: null, hOut: null }, { p: { x: 1, y: 0 }, hIn: null, hOut: null }], closed: true }] };";
  const editor = useEditor.getState();
  editor.newDocument();
  const scriptId = useEditor.getState().addScript("S", source);
  const pending = useEditor.getState().insertGenerator(scriptId, { x: 0, y: 0 });
  // Replace the document before the (async) build settles.
  useEditor.getState().newDocument();
  await pending;
  // The stale insert must not leak a node that references a now-missing script.
  assert.deepEqual(useEditor.getState().doc.scripts, {});
  assert.equal(Object.keys(useEditor.getState().doc.nodes).length, 0);
});

test("toggling open/closed detaches a generated shape", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.insertGenerator("star", { x: 0, y: 0 }); // built-in, synchronous
  const [id] = useEditor.getState().selection;
  assert.ok(useEditor.getState().doc.nodes[id].generator);

  useEditor.getState().setClosedSelected(false); // hand-edit: open the star
  const shape = useEditor.getState().doc.nodes[id];
  assert.equal(shape.generator, undefined);
  assert.ok(shape.subpaths.every((sp) => sp.closed === false));
});

test("a broken user script errors without throwing and keeps geometry", () => {
  const bad = compileScript("return { build: 42 };");
  assert.match(bad.error, /params, build/);
  const throws = compileScript("function build() { throw new Error('x'); } return { params: [], build };");
  assert.equal(throws.build({}), null);
});

test("an opened document's scripts stay untrusted and never execute until enabled", async () => {
  // A script whose top level throws would blow up if it were ever compiled.
  const hostile = "throw new Error('should never run'); return { params: [], build: () => [] };";
  const doc = createEmptyDocument();
  doc.scripts.evil = { id: "evil", name: "Evil", source: hostile };

  const editor = useEditor.getState();
  editor.loadDocument(doc);
  assert.equal(useEditor.getState().scriptsTrusted, false);

  // resolveGenerator never runs code; an untrusted script resolves to a stub.
  const gated = resolveGenerator("evil", doc.scripts, false);
  assert.equal(gated.status, "untrusted");
  assert.match(gated.error, /disabled/i);
  assert.equal(gated.build, undefined);

  // While untrusted, ensureScriptCompiled is a no-op: no compile is dispatched,
  // so nothing runs (scriptMeta stays empty).
  await useEditor.getState().ensureScriptCompiled("evil");
  assert.equal(useEditor.getState().scriptMeta.evil, undefined);

  // Consent flips the gate: now compilation runs (in the worker / sync
  // fallback), and the hostile top-level throw is captured as an error —
  // proving it had NOT run before consent.
  useEditor.getState().trustScripts();
  await useEditor.getState().ensureScriptCompiled("evil");
  const meta = useEditor.getState().scriptMeta.evil;
  assert.equal(meta.status, "error");
  assert.match(meta.error, /should never run/);

  // Authoring a script implies trust even in an otherwise-untrusted document.
  editor.loadDocument(doc);
  assert.equal(useEditor.getState().scriptsTrusted, false);
  useEditor.getState().addScript("Mine", "return { params: [], build: () => [] };");
  assert.equal(useEditor.getState().scriptsTrusted, true);
});

test("v19 documents backfill an empty scripts registry; malformed scripts are rejected", () => {
  const doc = createEmptyDocument();
  const file = JSON.parse(serializeDocument(doc));
  // Simulate a pre-scripts (v19) file.
  file.version = 19;
  delete file.document.scripts;
  const loaded = parseDocument(JSON.stringify(file));
  assert.deepEqual(loaded.scripts, {});

  const malformed = JSON.parse(serializeDocument(doc));
  malformed.document.scripts = { s1: { id: "s1", name: "x", source: 123 } };
  assert.throws(() => parseDocument(JSON.stringify(malformed)), /missing or malformed/);
});
