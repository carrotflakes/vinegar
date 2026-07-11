import { BLEND_MODES, type Document, type ShapeType } from "../model/types";

export const CURRENT_FILE_VERSION = 7 as const;

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

const NODE_TYPES = new Set<ShapeType | "group">([
  "group", "rect", "ellipse", "line", "path", "bezier", "polygon",
]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isMatrix = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 6 &&
  value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
const isPointOrNull = (value: unknown): boolean =>
  value === null ||
  (isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y));
const isPoint = (value: unknown): boolean => value !== null && isPointOrNull(value);
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isPoints = (value: unknown): boolean =>
  Array.isArray(value) && value.every(isPoint);
const isNode = (id: string, node: unknown): boolean => {
  if (!isObject(node) || node.id !== id || typeof node.name !== "string" ||
      !NODE_TYPES.has(node.type as ShapeType | "group") ||
      !isMatrix(node.transform) || !isPointOrNull(node.transformOrigin) ||
      !isNumber(node.opacity) || node.opacity < 0 || node.opacity > 1 ||
      (node.blendMode !== undefined && !BLEND_MODES.includes(node.blendMode as never)) ||
      (node.hidden !== undefined && typeof node.hidden !== "boolean") ||
      (node.locked !== undefined && typeof node.locked !== "boolean")) return false;
  if (node.type === "group") {
    return Array.isArray(node.childIds) && node.childIds.every((child) => typeof child === "string");
  }
  if (!((node.fill === null || typeof node.fill === "string") &&
      (node.stroke === null || typeof node.stroke === "string") &&
      isNumber(node.strokeWidth) && node.strokeWidth >= 0)) return false;
  switch (node.type) {
    case "rect": case "ellipse":
      return isNumber(node.x) && isNumber(node.y) && isNumber(node.width) && isNumber(node.height);
    case "line":
      return isNumber(node.x1) && isNumber(node.y1) && isNumber(node.x2) && isNumber(node.y2);
    case "path":
      return isPoints(node.points) && typeof node.closed === "boolean";
    case "bezier":
      return Array.isArray(node.subpaths) && node.subpaths.every((sp) =>
        isObject(sp) && typeof sp.closed === "boolean" &&
        Array.isArray(sp.anchors) &&
        sp.anchors.every((anchor: unknown) => isObject(anchor) && isPoint(anchor.p) &&
          (anchor.hIn === null || isPoint(anchor.hIn)) &&
          (anchor.hOut === null || isPoint(anchor.hOut))));
    case "polygon":
      return Array.isArray(node.polys) && node.polys.every((poly) =>
        Array.isArray(poly) && poly.every(isPoints));
    default:
      return false;
  }
};

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
  validateTree(data.document);
  return structuredClone(data.document);
}

function isCurrentDocument(value: unknown): value is Document {
  if (!isObject(value) || !isObject(value.nodes)) return false;
  return (
    Array.isArray(value.rootIds) &&
    value.rootIds.every((id) => typeof id === "string") &&
    Object.entries(value.nodes).every(([id, node]) => isNode(id, node)) &&
    isObject(value.settings) && typeof value.settings.unit === "string" &&
    isNumber(value.settings.dpi) && isNumber(value.settings.gridSize) &&
    isObject(value.metadata) && typeof value.metadata.createdAt === "string" &&
    typeof value.metadata.modifiedAt === "string" &&
    isObject(value.assets) && isObject(value.extensions)
  );
}

function validateTree(doc: Document): void {
  const owned = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    const node = doc.nodes[id];
    if (!node) throw new Error(`Scene references missing node: ${id}.`);
    if (visiting.has(id)) throw new Error("Scene tree contains a cycle.");
    if (owned.has(id)) throw new Error(`Scene node has multiple parents: ${id}.`);
    owned.add(id);
    if (node.type !== "group") return;
    visiting.add(id);
    for (const childId of node.childIds) visit(childId);
    visiting.delete(id);
  };
  for (const id of doc.rootIds) visit(id);
  if (owned.size !== Object.keys(doc.nodes).length) {
    throw new Error("Scene contains unreachable nodes.");
  }
}
