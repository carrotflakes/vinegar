// What differs between the kinds of row the Layers panel shows — shapes,
// symbol instances, groups and frames. Everything they share (the hide/lock
// buttons, the name and its rename input, the context menu skeleton) lives in
// LayerRow; this file is only the per-kind data that fills it in.

import type { ComponentType } from "react";
import {
  LuBrush,
  LuCircle,
  LuCombine,
  LuComponent,
  LuFrame,
  LuImage,
  LuSlash,
  LuSquare,
  LuType,
  LuWaves,
} from "react-icons/lu";
import type { Shape } from "@/model/types";
import { isClippingGroup, isClippingMaskNode } from "@/model/clippingMask";
import type { MenuEntry } from "@/store/menuStore";
import { shapeIds, type Row } from "../tree";
import type { LayerRowCtx } from "./rowContext";

const TYPE_ICON: Record<Shape["type"], ComponentType> = {
  rect: LuSquare,
  ellipse: LuCircle,
  line: LuSlash,
  path: LuWaves,
  compoundPath: LuCombine,
  image: LuImage,
  text: LuType,
  brush: LuBrush,
};

export interface RowSpec {
  id: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  /** Appended to the show/hide and lock labels ("" for shapes, " group"…). */
  stateSuffix: string;
  icon: ComponentType | null;
  /** Whether the row has a fold chevron (containers only). */
  chevron: boolean;
  /** Rows styled as container headers. */
  groupHeader: boolean;
  /** The container id a drop can land inside, if this row is one. */
  dropTarget: string | undefined;
  title: string | undefined;
  /** Parenthesised suffix after the name, e.g. "(Mask)". */
  badge: string | null;
  /** Child count, shown on containers. */
  count: number | null;
  onDoubleClick: (() => void) | undefined;
  /** Menu entries inserted between "Rename" and the show/hide entries. */
  menuBefore: MenuEntry[];
}

export function rowSpec(row: Row, ctx: LayerRowCtx): RowSpec {
  const { node } = row;
  const group = node.group ?? node.frame;
  if (group) {
    const kind = node.frame ? "frame" : "group";
    return {
      id: group.id,
      name: group.name,
      hidden: group.hidden,
      locked: group.locked,
      stateSuffix: ` ${kind}`,
      icon: node.frame ? LuFrame : null,
      chevron: true,
      groupHeader: true,
      dropTarget: group.id,
      title: undefined,
      badge: node.group && isClippingGroup(node.group) ? "(Clip)" : null,
      count: shapeIds([node]).length,
      onDoubleClick: undefined,
      menuBefore: [],
    };
  }

  if (node.instance) {
    const instance = node.instance;
    const symbolName = ctx.doc.symbols[instance.symbolId]?.name ?? "Missing symbol";
    return {
      id: instance.id,
      name: instance.name,
      hidden: instance.hidden,
      locked: instance.locked,
      stateSuffix: "",
      icon: LuComponent,
      chevron: false,
      groupHeader: false,
      dropTarget: undefined,
      title: undefined,
      badge: `(${symbolName})`,
      count: null,
      onDoubleClick: () => ctx.enterSymbolInstance(instance.id),
      menuBefore: [
        { label: "Edit symbol", onSelect: () => ctx.enterSymbolInstance(instance.id) },
        { label: "Detach instance", onSelect: ctx.detachSelectedInstances },
      ],
    };
  }

  const shape = node.shape!;
  const isCompound = shape.type === "compoundPath";
  const isMask = isClippingMaskNode(ctx.doc, shape.id);
  return {
    id: shape.id,
    name: shape.name,
    hidden: shape.hidden,
    locked: shape.locked,
    stateSuffix: "",
    icon: TYPE_ICON[shape.type],
    // A compound path is a container of subpaths, so it folds and accepts drops.
    chevron: isCompound,
    groupHeader: isCompound,
    dropTarget: isCompound ? shape.id : undefined,
    title: isMask ? "Clipping mask" : undefined,
    badge: isMask ? "(Mask)" : null,
    count: null,
    onDoubleClick: undefined,
    menuBefore: [],
  };
}
