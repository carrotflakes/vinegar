// Parametric generator nodes and the document's generator scripts: inserting
// and retuning them, and the compile/build round trips to the Worker.

import { buildGenerator, compileGenerator, type CompileResult } from "@/model/generators/generatorClient";
import { GENERATORS, defaultArgs, type ScriptMeta } from "@/model/generators/generators";
import { solid } from "../model/paint";
import { acceptsScene } from "./sceneGuard";
import { isShape } from "../model/scene";
import { baseNodeDefaults, baseShapeDefaults, makeId, type PathShape, type Vec2 } from "../model/types";
import { appendToScope, removeRoots } from "./docOps";
import {
  clearTransient,
  currentFocusRoot,
  type GeneratorActions,
  type StoreCtx,
} from "./state";

/** Shallow equality of a generator's numeric argument maps. */
function argsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

export function createGeneratorActions({ set, get, transact }: StoreCtx): GeneratorActions {
  // Create and select a new parametric path node from built geometry.
  const placeGeneratorNode = (
    generatorId: string,
    args: Record<string, number>,
    subpaths: PathShape["subpaths"],
    at: Vec2,
    name: string
  ) => {
    const s = get();
    const shape: PathShape = {
      id: makeId("path"),
      name,
      type: "path",
      fillRule: "nonzero",
      subpaths,
      ...baseNodeDefaults(),
      ...baseShapeDefaults(),
      transform: [1, 0, 0, 1, at.x, at.y],
      fill: solid("#6b7cff"),
      stroke: null,
      strokeWidth: 1,
      generator: { scriptId: generatorId, args },
    };
    const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
    const next = appendToScope(doc, currentFocusRoot(s), [shape.id]);
    if (!next) return;
    transact(next, { label: "Add generator" });
    set({ selection: [shape.id], ...clearTransient });
  };
  // In-flight target args per node while its script build is running. Kept out
  // of the document/history so an intermediate arg value never lands without
  // its matching geometry (args + subpaths are committed together, on success).
  const pendingArgs = new Map<string, Record<string, number>>();
  // Atomically commit a script build's args + geometry, unless it was
  // superseded by a newer edit, detached, or the document changed underneath.
  const commitScriptBuild = (
    id: string,
    scriptId: string,
    args: Record<string, number>,
    subpaths: PathShape["subpaths"]
  ) => {
    if (!argsEqual(pendingArgs.get(id) ?? {}, args)) return; // a newer edit won
    const doc = get().doc; const cur = doc.nodes[id];
    if (!isShape(cur) || cur.type !== "path" || !cur.generator) return;
    if (cur.generator.scriptId !== scriptId) return; // detached or re-linked
    pendingArgs.delete(id);
    transact(
      { ...doc, nodes: { ...doc.nodes, [id]: { ...cur, subpaths, generator: { ...cur.generator, args } } } },
      { label: "Edit generator", coalesceKey: `gen:${id}` }
    );
  };

  // De-duplicate concurrent compiles of the same script revision.
  const inflightCompiles = new Map<string, Promise<CompileResult>>();
  const setScriptMeta = (id: string, meta: ScriptMeta) =>
    set((s) => ({ scriptMeta: { ...s.scriptMeta, [id]: meta } }));
  // Compile a script's source in the worker and cache the result in scriptMeta.
  const compileAndCache = (scriptId: string, source: string): Promise<CompileResult> => {
    const key = `${JSON.stringify(scriptId)}${source}`;
    const running = inflightCompiles.get(key);
    if (running) return running;
    const meta = get().scriptMeta[scriptId];
    if (meta && meta.source === source && meta.status !== "compiling") {
      return Promise.resolve({ params: meta.params, error: meta.error });
    }
    setScriptMeta(scriptId, { source, status: "compiling", params: meta?.params ?? [] });
    const promise = compileGenerator(source).then((res) => {
      inflightCompiles.delete(key);
      setScriptMeta(scriptId, {
        source,
        status: res.error ? "error" : "ready",
        params: res.params,
        error: res.error,
      });
      return res;
    });
    inflightCompiles.set(key, promise);
    return promise;
  };

  return {
    // Scripts operate on the scene scope; created shapes join the scene roots.
    applyScriptChanges: ({ created, updated, deleted }) => {
      let doc = get().doc; const del = new Set(deleted);
      for (const id of deleted) if (isShape(doc.nodes[id])) doc = removeRoots(doc, [id]);
      const nodes = { ...doc.nodes };
      for (const shape of updated) if (!del.has(shape.id) && isShape(nodes[shape.id])) nodes[shape.id] = shape;
      for (const shape of created) nodes[shape.id] = shape;
      doc = { ...doc, nodes, rootIds: [...doc.rootIds, ...created.map((s) => s.id)] };
      if (!acceptsScene(doc)) return;
      transact(doc, { label: "Run script" }); set({ selection: [...updated.filter((s) => !del.has(s.id)).map((s) => s.id), ...created.map((s) => s.id)], ...clearTransient });
    },
    insertGenerator: (generatorId, at, previewArgs) => {
      const s = get();
      const builtin = GENERATORS[generatorId];
      if (builtin) {
        // Native generator: build synchronously so insertion is immediate.
        const args = { ...defaultArgs(builtin), ...previewArgs };
        const subpaths = builtin.build(args);
        if (subpaths) placeGeneratorNode(generatorId, args, subpaths, at, builtin.name);
        return;
      }
      if (!s.scriptsTrusted) return;
      const script = s.doc.scripts[generatorId];
      if (!script) return;
      // Document script: compile (for defaults) then build, both off the main
      // thread, and place the node when the geometry returns.
      return (async () => {
        const compiled = await compileAndCache(generatorId, script.source);
        if (compiled.error) return;
        const args = { ...defaultArgs({ params: compiled.params }), ...previewArgs };
        const { subpaths } = await buildGenerator(script.source, args);
        if (!subpaths) return;
        // The document may have been replaced (new/open) or the script edited
        // while building; only place if this exact script is still present.
        if (get().doc.scripts[generatorId] !== script) return;
        placeGeneratorNode(generatorId, args, subpaths, at, script.name);
      })();
    },
    ensureScriptCompiled: (scriptId) => {
      const s = get();
      if (!s.scriptsTrusted) return; // consent gate: never run untrusted code
      const script = s.doc.scripts[scriptId];
      if (!script) return;
      const meta = s.scriptMeta[scriptId];
      if (meta && meta.source === script.source) return; // current or in-flight
      return compileAndCache(scriptId, script.source).then(() => {});
    },
    setGeneratorArgs: (id, args) => {
      const doc = get().doc; const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "path" || !shape.generator) return;
      const scriptId = shape.generator.scriptId;
      const merged = { ...shape.generator.args, ...args };
      const builtin = GENERATORS[scriptId];
      if (builtin) {
        const subpaths = builtin.build(merged);
        if (!subpaths) return;
        transact(
          { ...doc, nodes: { ...doc.nodes, [id]: { ...shape, subpaths, generator: { ...shape.generator, args: merged } } } },
          { label: "Edit generator", coalesceKey: `gen:${id}` }
        );
        return;
      }
      if (!get().scriptsTrusted) return;
      const script = doc.scripts[scriptId];
      if (!script) return;
      // Don't touch the document yet: record the target args and commit them
      // together with the built geometry when the worker returns, so args and
      // shape are never out of sync in the document or the undo history. A
      // failed/timed-out build leaves the last consistent state untouched.
      pendingArgs.set(id, merged);
      return buildGenerator(script.source, merged).then(({ subpaths }) => {
        if (subpaths) commitScriptBuild(id, scriptId, merged, subpaths);
      });
    },
    detachGenerator: (id) => {
      const doc = get().doc; const shape = doc.nodes[id];
      if (!isShape(shape) || !shape.generator) return;
      transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...shape, generator: null } } }, { label: "Detach generator" });
    },
    addScript: (name, source) => {
      const id = makeId("script");
      const doc = get().doc;
      transact({ ...doc, scripts: { ...doc.scripts, [id]: { id, name, source } } }, { label: "Add script" });
      // Authoring a script implies trusting this document's generators.
      set({ scriptsTrusted: true });
      return id;
    },
    updateScript: (id, patch) => {
      const doc = get().doc; const script = doc.scripts[id];
      if (!script) return;
      transact(
        { ...doc, scripts: { ...doc.scripts, [id]: { ...script, ...patch } } },
        { label: "Edit script", coalesceKey: `script:${id}` }
      );
    },
    deleteScript: (id) => {
      const doc = get().doc; if (!doc.scripts[id]) return;
      const scripts = { ...doc.scripts }; delete scripts[id];
      transact({ ...doc, scripts }, { label: "Delete script" });
    },
    trustScripts: () => set({ scriptsTrusted: true }),
  };
}
