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
import { toggleBrushAnchorSmooth } from "@/model/brush/brushEdit";
import {
  scaleBrushAnchorWidths,
  setBrushAnchorWidths,
} from "@/model/brush/brushWidth";
import {
  hasValidSceneContainers,
  wouldCycleThroughOperand,
} from "../model/sceneValidation";
import { canConvertShapeToPath, convertShapeToPath } from "@/model/path/convertToPath";
import { isAreal } from "@/model/path/boolean";
import {
  childIdsOf,
  enclosingSymbolId,
  isShape,
  parentIdOf,
  selectionRoots,
} from "../model/scene";
import type { AnchorType, PathModifier } from "../model/types";
import { removeRoots } from "./docOps";
import { notify } from "./toastStore";
import {
  groupEditNodesByShape,
  type EditNode,
  type PathEditActions,
  type StoreCtx,
} from "./state";

/**
 * The anchor that stays selected after `dropped` is removed from a run that now
 * holds `remaining` anchors: the neighbour before the first deleted one, so a
 * run of Delete presses walks backwards along the path.
 */
function neighbourAfterDelete(dropped: Set<number>, remaining: number): number {
  const first = Math.min(...dropped);
  return Math.max(0, Math.min(first - 1, remaining - 1));
}

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
      const { doc, editNodes, selection } = get();
      if (editNodes.length === 0) return;
      const nodes = { ...doc.nodes };
      // Shapes left with nothing drawable go away entirely, in one removal so a
      // compound path emptied by the last of its children collapses with them.
      const emptied: string[] = [];
      const survivors: EditNode[] = [];
      let changed = false;
      for (const [shapeId, targets] of groupEditNodesByShape(editNodes)) {
        const shape = doc.nodes[shapeId];
        if (!isShape(shape)) continue;
        if (shape.type === "brush") {
          const dropped = new Set(
            targets.filter((target) => target.sub === 0).map((target) => target.index)
          );
          if (dropped.size === 0) continue;
          const anchors = shape.anchors.filter((_, index) => !dropped.has(index));
          changed = true;
          if (anchors.length < 2) { emptied.push(shapeId); continue; }
          nodes[shapeId] = { ...shape, anchors };
          survivors.push({ shapeId, sub: 0, index: neighbourAfterDelete(dropped, anchors.length) });
          continue;
        }
        if (shape.type !== "path") continue;
        const bySub = new Map<number, Set<number>>();
        for (const target of targets) {
          const indices = bySub.get(target.sub) ?? new Set<number>();
          indices.add(target.index);
          bySub.set(target.sub, indices);
        }
        const subpaths: typeof shape.subpaths = [];
        const kept: EditNode[] = [];
        let touched = false;
        shape.subpaths.forEach((subpath, sub) => {
          const dropped = bySub.get(sub);
          if (!dropped) { subpaths.push(subpath); return; }
          const anchors = subpath.anchors.filter((_, index) => !dropped.has(index));
          touched = true;
          // A subpath that can no longer form a segment disappears with its
          // anchors; the surviving ones renumber, so the kept selection is
          // recorded against the new index.
          if (anchors.length < 2) return;
          kept.push({
            shapeId,
            sub: subpaths.length,
            index: neighbourAfterDelete(dropped, anchors.length),
          });
          subpaths.push({ ...subpath, anchors });
        });
        if (!touched) continue;
        changed = true;
        if (subpaths.length === 0) { emptied.push(shapeId); continue; }
        nodes[shapeId] = { ...shape, subpaths, generator: null };
        survivors.push(...kept);
      }
      if (!changed) return;
      let next = { ...doc, nodes };
      if (emptied.length > 0) next = removeRoots(next, emptied);
      if (!hasValidSceneContainers(next)) return;
      transact(next, { label: "Delete path node" });
      // Keeping a neighbour selected lets Delete be pressed repeatedly to walk
      // back along a path, and stops the next press from falling through to
      // "delete the whole shape".
      set({
        selection: selection.filter((id) => next.nodes[id]),
        editNodes: survivors.filter((node) => next.nodes[node.shapeId]),
      });
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
        const baked = applyPathModifiers(shape, doc);
        const result = pathOpShape(baked, op);
        if (result) {
          nodes[id] = result;
          changed = true;
        }
      }
      const next = { ...doc, nodes };
      if (changed && hasValidSceneContainers(next)) transact(next, { label: PATH_OP_LABEL[op] });
    },
    setPathModifiers: (id, modifiers, bindings) => {
      const doc = get().doc;
      const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "path") return;
      const nextShape = { ...shape, modifiers, ...(bindings ? { bindings } : {}) };
      if (get()._interaction) {
        get().applyShapes({ [id]: nextShape });
        return;
      }
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: nextShape } },
        { label: "Edit path modifiers", coalesceKey: "modifiers:" + id }
      );
    },
    combineSelectedLive: (op) => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (roots.length < 2) return;
      const parent = parentIdOf(doc, roots[0]);
      if (!roots.every((id) => parentIdOf(doc, id) === parent)) return;
      const selected = new Set(roots);
      // Paint order decides which shape survives, matching `booleanSelected`:
      // the bottom-most is the one the others are combined into.
      const ordered = childIdsOf(doc, parent).filter((id) => selected.has(id));
      const [targetId, ...operandIds] = ordered;
      const target = doc.nodes[targetId];
      if (!isShape(target)) return;
      if (!operandIds.every((id) => {
        const operand = doc.nodes[id];
        return isShape(operand) && isAreal(operand, doc);
      })) return;
      // Modifiers live on path nodes, so a rect/ellipse/compound target is
      // converted first — it keeps its id, style and place in the stack.
      const base = target.type === "path"
        ? target
        : canConvertShapeToPath(target)
          ? convertShapeToPath(target, doc)
          : null;
      if (!base) return;
      const nodes = { ...doc.nodes };
      nodes[targetId] = {
        ...base,
        modifiers: [
          ...(base.modifiers ?? []),
          ...operandIds.map((operandId) => ({
            type: "boolean" as const,
            op,
            operandId,
          })),
        ],
      };
      // The operands stay in the scene — selectable, movable, editable — but
      // hidden, since their contribution is now the combined outline.
      for (const id of operandIds) {
        const operand = nodes[id];
        if (operand) nodes[id] = { ...operand, hidden: true };
      }
      const next = { ...doc, nodes };
      if (!hasValidSceneContainers(next)) return;
      transact(next, { label: `Combine ${op}` });
      set({ selection: [targetId] });
    },
    setModifierOperand: (nodeId, index, operandId) => {
      const doc = get().doc;
      const shape = doc.nodes[nodeId];
      if (!isShape(shape) || shape.type !== "path") return;
      const modifier = shape.modifiers?.[index];
      if (modifier?.type !== "boolean") return;
      if (operandId) {
        if (operandId === nodeId) {
          notify.error("A shape cannot be combined with itself.");
          return;
        }
        if (!doc.nodes[operandId]) return;
        if (
          enclosingSymbolId(doc, nodeId) !== enclosingSymbolId(doc, operandId)
        ) {
          notify.error("Both shapes must be inside the same symbol.");
          return;
        }
        // `transact` can only reject a cyclic document silently, so the cycle
        // is caught here, where there is someone to tell.
        if (wouldCycleThroughOperand(doc, nodeId, operandId)) {
          notify.error("That shape already depends on this one.");
          return;
        }
      }
      const modifiers = shape.modifiers!.map((entry, i) =>
        i === index ? { ...modifier, operandId: operandId ?? "" } : entry
      );
      transact(
        { ...doc, nodes: { ...doc.nodes, [nodeId]: { ...shape, modifiers } } },
        { label: "Set boolean operand" }
      );
    },
    beginOperandPick: (target) => set({ operandPick: target }),
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
        nodes[id] = applyPathModifiers(shape, doc);
        changed = true;
      }
      if (changed) transact(
        { ...doc, nodes },
        { label: "Apply path modifiers" }
      );
    },
  };
}
