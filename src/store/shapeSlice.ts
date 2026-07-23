// Creating and mutating individual shapes (geometry, style, path anchors).

import { toggleAnchorSmooth } from "../model/path";
import { PATH_OP_LABEL, pathOpShape } from "../model/pathOps";
import { buildGenerator, compileGenerator, type CompileResult } from "../model/generatorClient";
import { GENERATORS, defaultArgs, type ScriptMeta } from "../model/generators";
import { solid } from "../model/paint";
import { deleteBrushAnchor, toggleBrushAnchorSmooth } from "../model/brushEdit";
import { expandBounds, instanceWorldBounds, intersectBounds, shapeBounds, unionNodeWorldBounds, worldShapeBounds } from "../model/bounds";
import { hasValidSceneContainers } from "../model/sceneValidation";
import { eraseBrush } from "../model/eraser";
import { applyWorldTransformToNode, boundsTransform, IDENTITY, invertMatrix, multiply, nodeWorldMatrix, shapeWorldMatrix, translation } from "../model/matrix";
import { childIdsOf, descendantShapeIds, isGroup, isInstance, isNodeHidden, isNodeLocked, isShape, parentIdOf, referencedAssetIds, scopeLeafIds, scopeRootGroupId, selectionRoots, withChildIds } from "../model/scene";
import { clampRectCornerRadius } from "../model/roundedRect";
import { resizeShapeToBounds, translateShape } from "../model/transforms";
import { makeId, type PathShape, type Bounds, type ImageShape, type SceneNode, type Shape, type Vec2 } from "../model/types";
import { importImageFile, importImageFiles, isImageFile } from "../io/importImage";
import { notify } from "./toastStore";
import { measureTextShape } from "../canvas/textLayout";
import { loadAssetImage } from "../imageCache";
import { appendToScope, groupNode, removeRoots } from "./docOps";
import {
  clearTransient,
  currentSymbolScope,
  type ShapeActions,
  type StoreCtx,
} from "./state";

/** Shown when picked/dropped image files can't be read or decoded. */
const IMAGE_LOAD_ERROR =
  "Could not load the image. It may be corrupt or an unsupported format.";

/** Axis-aligned bounds of a point list (eraser path). */
function pathBounds(pts: Vec2[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Shallow equality of a generator's numeric argument maps. */
function argsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

export function createShapeActions({ set, get, transact, replaceDocumentWithoutHistory }: StoreCtx): ShapeActions {
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
      subpaths,
      transform: [1, 0, 0, 1, at.x, at.y],
      transformOrigin: null,
      opacity: 1,
      fill: solid("#6b7cff"),
      stroke: null,
      strokeWidth: 1,
      generator: { scriptId: generatorId, args },
    };
    const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
    transact(appendToScope(doc, currentSymbolScope(s), [shape.id]), { label: "Add generator" });
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
    addShape: (shape, select = true) => { const s = get(); const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } }; transact(appendToScope(doc, currentSymbolScope(s), [shape.id]), { label: "Add shape" }); if (select) set({ selection: [shape.id], ...clearTransient }); },
    addShapes: (shapes, select = true) => { if (!shapes.length) return; const s = get(); const doc = { ...s.doc, nodes: { ...s.doc.nodes, ...Object.fromEntries(shapes.map((sh) => [sh.id, sh])) } }; transact(appendToScope(doc, currentSymbolScope(s), shapes.map((sh) => sh.id)), { label: `Add ${shapes.length} shapes` }); if (select) set({ selection: shapes.map((sh) => sh.id), ...clearTransient }); },
    addBrushStroke: (shape) => {
      const s = get();
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
      const active =
        s.activeGroupId && isGroup(doc.nodes[s.activeGroupId]) ? s.activeGroupId : null;
      if (active) {
        transact(withChildIds(doc, active, [...childIdsOf(doc, active), shape.id]), { label: "Draw brush stroke" });
        set({ selection: [shape.id], ...clearTransient });
        return;
      }
      // Wrap the first stroke in a fresh drawing group and make it active so
      // subsequent strokes collect into it until the user exits the group.
      const groupId = makeId("group");
      const group = { ...groupNode(groupId, [shape.id]), name: "Drawing" };
      const withGroup = { ...doc, nodes: { ...doc.nodes, [groupId]: group } };
      transact(appendToScope(withGroup, currentSymbolScope(s), [groupId]), { label: "Draw brush stroke" });
      set({ selection: [shape.id], activeGroupId: groupId, ...clearTransient });
    },
    addFillShape: (shape, aboveId) => {
      const s = get();
      const above = aboveId ? s.doc.nodes[aboveId] : undefined;
      let parentId: string | null;
      let index: number;
      if (above) {
        // Right above the cover the fill was clicked on: over its color but
        // still under the line art painted later.
        parentId = parentIdOf(s.doc, above.id);
        index = childIdsOf(s.doc, parentId).indexOf(above.id) + 1;
      } else {
        const active =
          s.activeGroupId && isGroup(s.doc.nodes[s.activeGroupId]) ? s.activeGroupId : null;
        parentId = active ?? scopeRootGroupId(s.doc, currentSymbolScope(s));
        index = 0;
      }
      // The fill's geometry is in scope-view space; parenting it under the
      // container needs the inverse of the container's world matrix baked into
      // its transform so it lands exactly where it was computed.
      const world = parentId ? nodeWorldMatrix(s.doc, parentId) : IDENTITY;
      const placed = { ...shape, transform: invertMatrix(world) ?? [...IDENTITY] };
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [placed.id]: placed } };
      const siblings = childIdsOf(doc, parentId);
      transact(
        withChildIds(doc, parentId, [
          ...siblings.slice(0, index),
          placed.id,
          ...siblings.slice(index),
        ]),
        { label: "Fill area" }
      );
      set({ selection: [placed.id], ...clearTransient });
    },
    eraseBrushStrokes: (pathWorld, radiusWorld) => {
      if (pathWorld.length === 0 || radiusWorld <= 0) return;
      const state = get();
      const doc = state.doc;
      const eraserBounds = expandBounds(pathBounds(pathWorld), radiusWorld);
      const replacements = new Map<string, string[]>();
      const newNodes: Record<string, SceneNode> = {};
      const removeIds = new Set<string>();
      for (const id of scopeLeafIds(doc, currentSymbolScope(state))) {
        const node = doc.nodes[id];
        if (
          !isShape(node) ||
          node.type !== "brush" ||
          node.stroke === null ||
          node.strokeWidth <= 0 ||
          isNodeHidden(doc, id) ||
          isNodeLocked(doc, id)
        )
          continue;
        if (!intersectBounds(worldShapeBounds(doc, node), eraserBounds)) continue;
        const wm = shapeWorldMatrix(doc, node);
        const pieces = eraseBrush(node, pathWorld, radiusWorld, wm);
        if (pieces === null) continue; // untouched by the eraser
        removeIds.add(node.id);
        const ids = pieces.map((pc) => {
          newNodes[pc.id] = pc;
          return pc.id;
        });
        replacements.set(node.id, ids);
      }
      if (replacements.size === 0) return;
      let next = { ...doc, nodes: { ...doc.nodes, ...newNodes } };
      for (const id of removeIds) delete next.nodes[id];
      // Substitute each erased brush's pieces in place within its parent.
      const parents = new Set<string | null>();
      for (const id of replacements.keys()) parents.add(parentIdOf(doc, id));
      for (const parent of parents) {
        const children = childIdsOf(doc, parent).flatMap((id) =>
          replacements.has(id) ? replacements.get(id)! : [id]
        );
        next = withChildIds(next, parent, children);
      }
      transact(next, { label: "Erase brush strokes" });
      set({ selection: get().selection.filter((id) => next.nodes[id]), ...clearTransient });
    },
    updateShape: (shape, select = true) => { const doc = get().doc; if (!isShape(doc.nodes[shape.id])) return; const next = { ...doc, nodes: { ...doc.nodes, [shape.id]: shape } }; if (!hasValidSceneContainers(next)) return; transact(next, { label: "Edit shape" }); if (select) set({ selection: [shape.id], ...clearTransient }); },
    updateTextShape: (id, patch) => {
      const doc = get().doc; const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "text") return;
      const next = measureTextShape({ ...shape, ...patch });
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: next } },
        {
          label: "Edit text",
          coalesceKey: `text:${id}:${Object.keys(patch).sort().join(",")}`,
        }
      );
    },
    remeasureTextShapes: () => {
      const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false;
      for (const [id, node] of Object.entries(nodes)) {
        if (!isShape(node) || node.type !== "text") continue;
        const next = measureTextShape(node);
        if (next.width !== node.width || next.height !== node.height) {
          nodes[id] = next; changed = true;
        }
      }
      if (changed) replaceDocumentWithoutHistory({ ...doc, nodes });
    },
    toggleNodeSmooth: (id, sub, index) => {
      const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape)) return;
      const next = shape.type === "path"
        ? toggleAnchorSmooth(shape, sub, index)
        : shape.type === "brush"
          ? toggleBrushAnchorSmooth(shape, index)
          : null;
      if (!next) return;
      transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, { label: "Toggle smooth node" });
    },
    deleteEditNode: () => {
      const { doc, editNodes } = get();
      const editNode = editNodes[editNodes.length - 1];
      if (!editNode) return;
      const shape = doc.nodes[editNode.shapeId]; if (!isShape(shape)) return;
      if (shape.type === "brush") {
        const next = deleteBrushAnchor(shape, editNode.index);
        if (next === null) {
          const removed = removeRoots(doc, [shape.id]);
          if (!hasValidSceneContainers(removed)) return;
          transact(removed, { label: "Delete path node" }); set({ selection: [], ...clearTransient });
        } else {
          transact({ ...doc, nodes: { ...doc.nodes, [shape.id]: next } }, { label: "Delete path node" }); set({ editNodes: [] });
        }
        return;
      }
      if (shape.type !== "path") return;
      const sp = shape.subpaths[editNode.sub]; if (!sp) return;
      const anchors = sp.anchors.filter((_, i) => i !== editNode.index);
      // A subpath that can no longer form a segment disappears with its anchor.
      const subpaths = anchors.length < 2
        ? shape.subpaths.filter((_, i) => i !== editNode.sub)
        : shape.subpaths.map((s, i) => (i === editNode.sub ? { ...s, anchors } : s));
      if (subpaths.length === 0) { const next = removeRoots(doc, [shape.id]); if (!hasValidSceneContainers(next)) return; transact(next, { label: "Delete path node" }); set({ selection: [], ...clearTransient }); }
      else { const next = { ...doc, nodes: { ...doc.nodes, [shape.id]: { ...shape, subpaths, generator: undefined } } }; if (!hasValidSceneContainers(next)) return; transact(next, { label: "Delete path node" }); set({ editNodes: [] }); }
    },
    placeImageFiles: async (files, at, fitWithin) => {
      const images = await importImageFiles(files);
      if (!images.length) {
        if (files.some(isImageFile)) notify.error(IMAGE_LOAD_ERROR);
        return;
      }
      const s = get();
      const nodes = { ...s.doc.nodes };
      const assets = { ...s.doc.assets };
      const ids: string[] = [];
      // Multiple files land as a small cascade so none hides the others.
      images.forEach((img, i) => {
        const scale = fitWithin
          ? Math.min(1, fitWithin.width / img.naturalWidth, fitWithin.height / img.naturalHeight)
          : 1;
        const width = img.naturalWidth * scale;
        const height = img.naturalHeight * scale;
        const shape: ImageShape = {
          id: makeId("image"),
          name: img.asset.name?.replace(/\.[^.]+$/, "") || "Image",
          type: "image",
          assetId: img.asset.id,
          x: at.x - width / 2 + i * 24,
          y: at.y - height / 2 + i * 24,
          width,
          height,
          transform: [1, 0, 0, 1, 0, 0],
          transformOrigin: null,
          opacity: 1,
          fill: null,
          stroke: null,
          strokeWidth: 0,
        };
        assets[img.asset.id] = img.asset;
        nodes[shape.id] = shape;
        ids.push(shape.id);
      });
      const doc = { ...s.doc, nodes, assets };
      transact(appendToScope(doc, currentSymbolScope(s), ids), { label: ids.length === 1 ? "Place image" : `Place ${ids.length} images` });
      set({ selection: ids, ...clearTransient });
    },
    placeImportedSvg: (imported, at, fitWithin) => {
      const s = get();
      const root = imported.nodes[imported.rootId];
      if (!root) return;
      const preview = {
        ...s.doc,
        nodes: { ...s.doc.nodes, ...imported.nodes },
        rootIds: [imported.rootId],
      };
      const bounds = unionNodeWorldBounds(preview, [imported.rootId]);
      if (!bounds) return;
      const scale = fitWithin
        ? Math.min(
            1,
            bounds.width > 0 ? fitWithin.width / bounds.width : 1,
            bounds.height > 0 ? fitWithin.height / bounds.height : 1
          )
        : 1;
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const placement = multiply(
        translation(at.x, at.y),
        multiply(
          [scale, 0, 0, scale, 0, 0],
          translation(-centerX, -centerY)
        )
      );
      const nodes = {
        ...s.doc.nodes,
        ...imported.nodes,
        [root.id]: {
          ...root,
          transform: multiply(placement, root.transform),
        },
      };
      const doc = appendToScope(
        { ...s.doc, nodes },
        currentSymbolScope(s),
        [root.id]
      );
      transact(doc, { label: "Place SVG" });
      set({ selection: [root.id], ...clearTransient });
    },
    addPatternImage: async (file) => {
      if (!isImageFile(file)) return null;
      const img = await importImageFile(file);
      if (!img) {
        notify.error(IMAGE_LOAD_ERROR);
        return null;
      }
      const s = get();
      transact({ ...s.doc, assets: { ...s.doc.assets, [img.asset.id]: img.asset } }, { label: "Add image asset" });
      return img.asset.id;
    },
    importImageAssets: async (files) => {
      const images = await importImageFiles(files);
      if (!images.length) {
        if (files.some(isImageFile)) notify.error(IMAGE_LOAD_ERROR);
        return [];
      }
      const s = get();
      const assets = { ...s.doc.assets };
      const ids: string[] = [];
      images.forEach((img) => {
        assets[img.asset.id] = img.asset;
        ids.push(img.asset.id);
      });
      transact({ ...s.doc, assets }, { label: images.length === 1 ? "Import image asset" : `Import ${images.length} image assets` });
      return ids;
    },
    placeAssetImage: async (assetId, at, fitWithin) => {
      const asset = get().doc.assets[assetId];
      if (!asset) return;
      // Natural size drives the placed box; await a decode so it isn't guessed.
      const img = await loadAssetImage(asset);
      const natW = img && img.naturalWidth > 0 ? img.naturalWidth : 100;
      const natH = img && img.naturalHeight > 0 ? img.naturalHeight : 100;
      const scale = fitWithin
        ? Math.min(1, fitWithin.width / natW, fitWithin.height / natH)
        : 1;
      const width = natW * scale;
      const height = natH * scale;
      const s = get();
      if (!s.doc.assets[assetId]) return; // deleted while decoding
      const shape: ImageShape = {
        id: makeId("image"),
        name: asset.name?.replace(/\.[^.]+$/, "") || "Image",
        type: "image",
        assetId,
        x: at.x - width / 2,
        y: at.y - height / 2,
        width,
        height,
        transform: [1, 0, 0, 1, 0, 0],
        transformOrigin: null,
        opacity: 1,
        fill: null,
        stroke: null,
        strokeWidth: 0,
      };
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
      transact(appendToScope(doc, currentSymbolScope(s), [shape.id]), { label: "Place image" });
      set({ selection: [shape.id], ...clearTransient });
    },
    deleteAsset: (assetId) => {
      const doc = get().doc;
      if (!doc.assets[assetId] || referencedAssetIds(doc).has(assetId)) return;
      const assets = { ...doc.assets }; delete assets[assetId];
      transact({ ...doc, assets }, { label: "Delete asset" });
    },
    deleteUnusedAssets: () => {
      const doc = get().doc;
      const used = referencedAssetIds(doc);
      const assets = { ...doc.assets };
      let removed = 0;
      for (const id of Object.keys(assets)) if (!used.has(id)) { delete assets[id]; removed++; }
      if (removed) transact({ ...doc, assets }, { label: removed === 1 ? "Delete unused asset" : `Delete ${removed} unused assets` });
      return removed;
    },
    // Scripts operate on the scene scope; created shapes join the scene roots.
    applyScriptChanges: ({ created, updated, deleted }) => {
      let doc = get().doc; const del = new Set(deleted);
      for (const id of deleted) if (isShape(doc.nodes[id])) doc = removeRoots(doc, [id]);
      const nodes = { ...doc.nodes };
      for (const shape of updated) if (!del.has(shape.id) && isShape(nodes[shape.id])) nodes[shape.id] = shape;
      for (const shape of created) nodes[shape.id] = shape;
      doc = { ...doc, nodes, rootIds: [...doc.rootIds, ...created.map((s) => s.id)] };
      if (!hasValidSceneContainers(doc)) return;
      transact(doc, { label: "Run script" }); set({ selection: [...updated.filter((s) => !del.has(s.id)).map((s) => s.id), ...created.map((s) => s.id)], ...clearTransient });
    },
    updateSelectedStyle: (patch) => {
      const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false;
      const roots = selectionRoots(doc, get().selection);
      for (const root of roots) {
        const ids = isShape(nodes[root]) ? [root] : descendantShapeIds(doc, root);
        for (const id of ids) { nodes[id] = { ...(nodes[id] as Shape), ...patch } as Shape; changed = true; }
      }
      if (changed) transact({ ...doc, nodes }, { label: "Edit style", coalesceKey: `style:${roots.join(",")}:${Object.keys(patch).sort().join(",")}` });
    },
    setShapeGeometry: (id, patch) => {
      const doc = get().doc;
      const shape = doc.nodes[id];
      const options = { label: "Edit geometry", coalesceKey: "geom:" + id };
      if (isInstance(shape)) {
        const wf = instanceWorldBounds(doc, shape);
        if (!wf) return;
        const to = {
          x: patch.x ?? wf.x,
          y: patch.y ?? wf.y,
          width: Math.max(1, patch.width ?? wf.width),
          height: Math.max(1, patch.height ?? wf.height),
        };
        const next = applyWorldTransformToNode(doc, shape, boundsTransform(wf, to));
        transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, options);
        return;
      }
      if (!isShape(shape)) return;
      if (shape.generator || shape.type === "compoundPath") {
        const wf = worldShapeBounds(doc, shape);
        const to = {
          x: patch.x ?? wf.x,
          y: patch.y ?? wf.y,
          width: Math.max(1, patch.width ?? wf.width),
          height: Math.max(1, patch.height ?? wf.height),
        };
        const next = applyWorldTransformToNode(doc, shape, boundsTransform(wf, to));
        transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, options);
        return;
      }
      const b = shapeBounds(shape, doc);
      if (shape.type === "text") {
        const moved = translateShape(
          shape,
          (patch.x ?? b.x) - b.x,
          (patch.y ?? b.y) - b.y
        );
        if (moved.type !== "text") return;
        const next = measureTextShape({
          ...moved,
          width:
            shape.textMode === "area"
              ? Math.max(1, patch.width ?? shape.width)
              : shape.width,
        });
        transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, options);
        return;
      }
      let next = resizeShapeToBounds(shape, b, {
        x: b.x,
        y: b.y,
        width: Math.max(1, patch.width ?? b.width),
        height: Math.max(1, patch.height ?? b.height),
      });
      next = translateShape(
        next,
        (patch.x ?? b.x) - b.x,
        (patch.y ?? b.y) - b.y
      );
      transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, options);
    },
    insertGenerator: (generatorId, at) => {
      const s = get();
      const builtin = GENERATORS[generatorId];
      if (builtin) {
        // Native generator: build synchronously so insertion is immediate.
        const args = defaultArgs(builtin);
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
        const args = defaultArgs({ params: compiled.params });
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
      transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...shape, generator: undefined } } }, { label: "Detach generator" });
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
    setRectCornerRadius: (id, radius) => {
      const doc = get().doc; const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "rect" || !Number.isFinite(radius)) return;
      const next = { ...shape, cornerRadius: clampRectCornerRadius(shape, radius) };
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: next } },
        { label: "Edit corner radius", coalesceKey: "radius:" + id }
      );
    },
    setImageLockAspect: (id, lock) => { const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape) || shape.type !== "image") return; const next = { ...shape, lockAspect: lock || undefined }; transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, { label: lock ? "Lock aspect ratio" : "Unlock aspect ratio", coalesceKey: "lockAspect:" + id }); },
    setClosedSelected: (closed) => { const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false; for (const id of selectionRoots(doc, get().selection)) { const shape = nodes[id]; if (!isShape(shape) || shape.type !== "path") continue; if (shape.subpaths.some((sp) => sp.closed !== closed)) { nodes[id] = { ...shape, subpaths: shape.subpaths.map((sp) => ({ ...sp, closed })), generator: undefined }; changed = true; } } const next = { ...doc, nodes }; if (changed && hasValidSceneContainers(next)) transact(next, { label: closed ? "Close path" : "Open path" }); },
    pathOpSelected: (op) => { const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false; for (const id of selectionRoots(doc, get().selection)) { const shape = nodes[id]; if (!isShape(shape) || shape.type !== "path") continue; const result = pathOpShape(shape, op); if (result) { nodes[id] = result; changed = true; } } const next = { ...doc, nodes }; if (changed && hasValidSceneContainers(next)) transact(next, { label: PATH_OP_LABEL[op] }); },
  };
}
