import { pruneGroups } from "../model/groups";
import {
  type Document,
  type Group,
  type Shape,
  type ShapeType,
} from "../model/types";

export const CURRENT_FILE_VERSION = 5 as const;

/** Current on-disk format. Older formats are intentionally unsupported. */
export interface VinegarFile {
  app: "vinegar";
  version: typeof CURRENT_FILE_VERSION;
  document: Document;
}

export function serializeDocument(doc: Document): string {
  const file: VinegarFile = {
    app: "vinegar",
    version: CURRENT_FILE_VERSION,
    document: {
      ...doc,
      metadata: { ...doc.metadata, modifiedAt: new Date().toISOString() },
    },
  };
  return JSON.stringify(file, null, 2);
}

const SHAPE_TYPES = new Set<ShapeType>([
  "rect",
  "ellipse",
  "line",
  "path",
  "bezier",
  "polygon",
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Parse the current format and repair only cross-reference invariants. */
export function parseDocument(text: string): Document {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }

  if (!isObject(data) || data.app !== "vinegar") {
    throw new Error("Not a Vinegar file.");
  }
  if (data.version !== CURRENT_FILE_VERSION) {
    throw new Error(`Unsupported Vinegar file version: ${String(data.version)}.`);
  }
  if (!isCurrentDocument(data.document)) {
    throw new Error("Document data is missing or malformed.");
  }

  const raw = data.document;
  const shapes: Record<string, Shape> = {};
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of raw.order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const shape = raw.shapes[id];
    if (shape?.id === id && SHAPE_TYPES.has(shape.type)) {
      shapes[id] = structuredClone(shape);
      order.push(id);
    }
  }

  const groups = structuredClone(raw.groups);
  repairGroupParents(groups);
  return pruneGroups({
    ...structuredClone(raw),
    shapes,
    order,
    groups,
  });
}

function isCurrentDocument(value: unknown): value is Document {
  if (!isObject(value)) return false;
  return (
    Array.isArray(value.order) &&
    value.order.every((id) => typeof id === "string") &&
    isObject(value.shapes) &&
    Object.values(value.shapes).every(
      (shape) =>
        isObject(shape) &&
        isMatrix(shape.transform) &&
        isPointOrNull(shape.transformOrigin)
    ) &&
    isObject(value.groups) &&
    Object.values(value.groups).every(
      (group) =>
        isObject(group) &&
        isMatrix(group.transform) &&
        isPointOrNull(group.transformOrigin)
    ) &&
    isObject(value.settings) &&
    isObject(value.metadata) &&
    isObject(value.assets) &&
    isObject(value.extensions)
  );
}

const isMatrix = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 6 &&
  value.every((entry) => typeof entry === "number" && Number.isFinite(entry));

const isPointOrNull = (value: unknown): boolean =>
  value === null ||
  (isObject(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y));

/** Remove dangling parents and break cycles in the group forest. */
function repairGroupParents(groups: Record<string, Group>): void {
  for (const [id, group] of Object.entries(groups)) {
    if (!group || group.id !== id) {
      delete groups[id];
      continue;
    }
    if (group.parentId && !groups[group.parentId]) group.parentId = null;
  }

  for (const start of Object.keys(groups)) {
    const seen = new Set<string>();
    let id: string | null = start;
    while (id && groups[id]) {
      if (seen.has(id)) {
        groups[id].parentId = null;
        break;
      }
      seen.add(id);
      id = groups[id].parentId ?? null;
    }
  }
}
