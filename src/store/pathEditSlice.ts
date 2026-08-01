// Editing path and brush anchors (the node tool's selection) plus the
// whole-path properties that only apply to path shapes.

import { toggleAnchorSmooth } from "@/model/path/path";
import { setAnchorType } from "@/model/path/anchorType";
import { cutPathAtNodes } from "@/model/path/cutPath";
import { PATH_OP_LABEL, pathOpShape } from "@/model/path/pathOps";
import {
  applyPathModifiers,
  DEFAULT_PATH_MODIFIER,
} from "@/model/path/pathModifiers";
import { deleteBrushAnchor, toggleBrushAnchorSmooth } from "@/model/brush/brushEdit";
import {
  scaleBrushAnchorWidths,
  setBrushAnchorWidths,
} from "@/model/brush/brushWidth";
import { hasValidSceneContainers } from "../model/sceneValidation";
import { isShape, selectionRoots } from "../model/scene";
import type { AnchorType, PathModifier } from "../model/types";
import { removeRoots } from "./docOps";
import {
  clearTransient,
  groupEditNodesByShape,
  type PathEditActions,
  type StoreCtx,
} from "./state";

export function createPathEditActions({ set, get, transact }: StoreCtx): PathEditActions {
  return {
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
    setEditNodeType: (type: AnchorType) => {
      const { doc, editNodes } = get();
      const nodes = { ...doc.nodes };
      let changed = false;
      for (const [shapeId, targets] of groupEditNodesByShape(editNodes)) {
        const shape = doc.nodes[shapeId];
        if (!isShape(shape)) continue;
        if (shape.type === "brush") {
          const targetIndices = new Set(
            targets.filter((target) => target.sub === 0).map((target) => target.index)
          );
          const anchors = shape.anchors.map((anchor, index) => {
            if (!targetIndices.has(index)) return anchor;
            return setAnchorType(
              anchor,
              type,
              shape.anchors[index - 1] ?? null,
              shape.anchors[index + 1] ?? null
            );
          });
          if (anchors.every((anchor, index) => anchor === shape.anchors[index])) continue;
          nodes[shapeId] = { ...shape, anchors };
          changed = true;
          continue;
        }
        if (shape.type !== "path") continue;
        const bySub = new Map<number, Set<number>>();
        for (const target of targets) {
          const indices = bySub.get(target.sub) ?? new Set<number>();
          indices.add(target.index);
          bySub.set(target.sub, indices);
        }
        const subpaths = shape.subpaths.map((subpath, sub) => {
          const indices = bySub.get(sub);
          if (!indices) return subpath;
          const count = subpath.anchors.length;
          const anchors = subpath.anchors.map((anchor, index) => {
            if (!indices.has(index)) return anchor;
            const previous = index > 0
              ? subpath.anchors[index - 1]
              : subpath.closed
                ? subpath.anchors[count - 1] ?? null
                : null;
            const next = index < count - 1
              ? subpath.anchors[index + 1]
              : subpath.closed
                ? subpath.anchors[0] ?? null
                : null;
            return setAnchorType(anchor, type, previous, next);
          });
          return anchors.every((anchor, index) => anchor === subpath.anchors[index])
            ? subpath
            : { ...subpath, anchors };
        });
        if (subpaths.every((subpath, sub) => subpath === shape.subpaths[sub])) continue;
        nodes[shapeId] = { ...shape, subpaths, generator: null };
        changed = true;
      }
      if (!changed) return;
      transact({ ...doc, nodes }, { label: "Change anchor type" });
    },
    setEditNodeWidths: (change) => {
      const { doc, editNodes } = get();
      const nodes = { ...doc.nodes };
      const touched: string[] = [];
      for (const [shapeId, targets] of groupEditNodesByShape(editNodes)) {
        const shape = doc.nodes[shapeId];
        if (!isShape(shape) || shape.type !== "brush") continue;
        const indices = [
          ...new Set(
            targets.filter((t) => t.sub === 0).map((t) => t.index)
          ),
        ].sort((a, b) => a - b);
        const next = "factor" in change
          ? scaleBrushAnchorWidths(shape, indices, change.factor)
          : setBrushAnchorWidths(shape, indices, () => change.width);
        if (next === shape) continue;
        nodes[shapeId] = next;
        touched.push(`${shapeId}:${indices.join(",")}`);
      }
      if (touched.length === 0) return;
      // Coalesced so a scrub or a run of [ / ] presses is one undo step. The
      // key names the exact anchors, so retargeting the selection and editing
      // again within the coalesce window starts a new step instead of merging.
      transact({ ...doc, nodes }, {
        label: "Edit brush width",
        coalesceKey: `brush-width:${touched.join("|")}`,
      });
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
      else { const next = { ...doc, nodes: { ...doc.nodes, [shape.id]: { ...shape, subpaths, generator: null } } }; if (!hasValidSceneContainers(next)) return; transact(next, { label: "Delete path node" }); set({ editNodes: [] }); }
    },
    cutSelectedNodes: () => {
      const { doc, editNodes } = get();
      const byShape = groupEditNodesByShape(editNodes);
      const nodes = { ...doc.nodes };
      let cut = false;
      for (const [shapeId, cuts] of byShape) {
        const shape = doc.nodes[shapeId];
        if (!isShape(shape) || shape.type !== "path") continue;
        const next = cutPathAtNodes(shape, cuts);
        if (!next) continue;
        nodes[shapeId] = { ...next, generator: null };
        cut = true;
      }
      if (!cut) return;
      transact({ ...doc, nodes }, { label: "Cut path" });
      set({ editNodes: [] });
    },
    setClosedSelected: (closed) => {
      const doc = get().doc;
      const nodes = { ...doc.nodes };
      let changed = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = nodes[id];
        if (!isShape(shape) || shape.type !== "path") continue;
        if (!shape.subpaths.some((sp) => sp.closed !== closed)) continue;
        nodes[id] = {
          ...shape,
          subpaths: shape.subpaths.map((sp) => ({ ...sp, closed })),
          generator: null,
        };
        changed = true;
      }
      const next = { ...doc, nodes };
      if (changed && hasValidSceneContainers(next)) {
        transact(next, { label: closed ? "Close path" : "Open path" });
      }
    },
    setSelectedFillRule: (rule) => {
      const doc = get().doc;
      const nodes = { ...doc.nodes };
      let changed = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = nodes[id];
        if (!isShape(shape) || shape.type !== "path" || shape.fillRule === rule) continue;
        nodes[id] = { ...shape, fillRule: rule };
        changed = true;
      }
      if (changed) transact({ ...doc, nodes }, { label: "Edit fill rule" });
    },
    pathOpSelected: (op) => {
      const doc = get().doc;
      const nodes = { ...doc.nodes };
      let changed = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = nodes[id];
        if (!isShape(shape) || shape.type !== "path") continue;
        const baked = applyPathModifiers(shape);
        const result = pathOpShape(baked, op);
        if (result) {
          nodes[id] = result;
          changed = true;
        }
      }
      const next = { ...doc, nodes };
      if (changed && hasValidSceneContainers(next)) transact(next, { label: PATH_OP_LABEL[op] });
    },
    setPathModifiers: (id, modifiers) => {
      const doc = get().doc;
      const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "path") return;
      const nextShape = { ...shape, modifiers };
      if (get()._interaction) {
        get().applyShapes({ [id]: nextShape });
        return;
      }
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: nextShape } },
        { label: "Edit path modifiers", coalesceKey: "modifiers:" + id }
      );
    },
    addPathModifierSelected: (type: PathModifier["type"]) => {
      const doc = get().doc;
      const nodes = { ...doc.nodes };
      let changed = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = nodes[id];
        if (!isShape(shape) || shape.type !== "path") continue;
        nodes[id] = {
          ...shape,
          modifiers: [...(shape.modifiers ?? []), DEFAULT_PATH_MODIFIER[type]()],
        };
        changed = true;
      }
      if (changed) transact(
        { ...doc, nodes },
        { label: "Add path modifier" }
      );
    },
    applyPathModifiersSelected: () => {
      const doc = get().doc;
      const nodes = { ...doc.nodes };
      let changed = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = nodes[id];
        if (!isShape(shape) || shape.type !== "path" || !shape.modifiers?.length) continue;
        nodes[id] = applyPathModifiers(shape);
        changed = true;
      }
      if (changed) transact(
        { ...doc, nodes },
        { label: "Apply path modifiers" }
      );
    },
  };
}
