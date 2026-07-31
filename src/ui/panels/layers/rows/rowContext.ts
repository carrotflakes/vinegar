// Everything a layer row needs from the panel, bundled so rows take one prop
// instead of a dozen. The panel builds it once per render.

import type { MouseEvent, PointerEvent } from "react";
import type { Document } from "@/model/types";
import type { RowDndProps } from "../useLayersDnd";
import type { Row } from "../tree";

export interface HoverProps {
  onPointerEnter: (e: PointerEvent) => void;
  onPointerLeave: () => void;
}

export interface LayerRowCtx {
  doc: Document;
  selection: string[];
  collapsed: Set<string>;
  /** The row being renamed, if any. */
  editing: string | null;
  /** Container the pending drop would go inside, if any. */
  dropInside: string | undefined;
  setEditing: (id: string | null) => void;
  toggleCollapsed: (id: string) => void;
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  renameNode: (id: string, name: string) => void;
  enterSymbolInstance: (id: string) => void;
  detachSelectedInstances: () => void;
  selectIds: (ids: string[], additive: boolean) => void;
  rowClick: (id: string, e: MouseEvent) => void;
  hoverProps: (id: string) => HoverProps;
  rowDnd: (id: string, row: Row, flat: number, gid?: string) => RowDndProps;
}
