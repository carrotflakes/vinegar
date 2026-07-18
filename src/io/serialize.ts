import { clippingMask } from "../model/clippingMask";
import { paintFromLegacy } from "../model/paint";
import { referencedAssetIds } from "../model/scene";
import {
  BLEND_MODES,
  STROKE_ALIGNMENTS,
  STROKE_CAPS,
  STROKE_JOINS,
  type Document,
  type ShapeType,
} from "../model/types";

export const CURRENT_FILE_VERSION = 20 as const;

/**
 * v8 lacked `symbols` (added as an empty registry). v8 and v9 stored fill/
 * stroke as bare colour strings; v10 upgrades them to structured Paint. v11
 * adds `artboards` (backfilled as an empty list for older files). v12 adds
 * `image` nodes over the existing asset store (no structural change). v13 adds
 * `pattern` fills/strokes (raster fill via doc.assets). v14 adds single-style
 * text leaves with persisted measured bounds. v15 adds the optional `clip`
 * marker to groups. v16 adds the optional `effects` stack to every node. v17
 * adds optional dash/cap/join/alignment fields to shapes. v18 adds the optional
 * shared `cornerRadius` to rectangles. v19 adds the `brush` leaf shape
 * (pressure-profiled variable-width strokes). v20 adds `doc.scripts` (user
 * parametric generators, backfilled as empty) and the optional `generator`
 * link on nodes. v8-v19 documents migrate unchanged; absent optional fields
 * retain their historical behavior.
 */
const MIGRATABLE_VERSIONS = new Set<unknown>([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

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
      assets: usedAssets(doc),
      metadata: { ...doc.metadata, modifiedAt: new Date().toISOString() },
    },
  };
  return JSON.stringify(file, null, 2);
}

/** Assets still referenced by an image node or pattern paint (drops orphans). */
function usedAssets(doc: Document): Document["assets"] {
  const used = referencedAssetIds(doc);
  return Object.fromEntries(
    Object.entries(doc.assets).filter(([id]) => used.has(id))
  );
}

const NODE_TYPES = new Set<ShapeType | "group" | "instance">([
  "group", "rect", "ellipse", "line", "path", "bezier", "polygon", "compoundPath", "instance", "image", "text", "brush",
]);
const COMPOUND_COMPONENT_TYPES = new Set<ShapeType>([
  "rect", "ellipse", "path", "bezier", "polygon",
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
const isStop = (value: unknown): boolean =>
  isObject(value) && isNumber(value.offset) && value.offset >= 0 && value.offset <= 1 &&
  typeof value.color === "string" &&
  isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1;
const isStops = (value: unknown): boolean =>
  Array.isArray(value) && value.length >= 2 && value.every(isStop);
const isPaint = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.type === "solid") {
    return typeof value.color === "string" &&
      isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1;
  }
  if (value.type === "linear") return isStops(value.stops) && isNumber(value.angle);
  if (value.type === "radial") return isStops(value.stops);
  if (value.type === "pattern") {
    return typeof value.assetId === "string" &&
      isNumber(value.scale) && isNumber(value.rotation) && isPoint(value.offset) &&
      isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1;
  }
  return false;
};
const isPaintOrNull = (value: unknown): boolean => value === null || isPaint(value);
const isEffect = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (value.type === "blur") return isNumber(value.radius) && value.radius >= 0;
  if (value.type === "drop-shadow") {
    return typeof value.color === "string" &&
      isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1 &&
      isNumber(value.blur) && value.blur >= 0 &&
      isNumber(value.offsetX) && isNumber(value.offsetY);
  }
  return false;
};
const isEffectsOrUndefined = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) && value.every(isEffect));
const isStrokeDashOrUndefined = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) && value.every((entry) => isNumber(entry) && entry >= 0));
const isPoints = (value: unknown): boolean =>
  Array.isArray(value) && value.every(isPoint);
const isGeneratorOrUndefined = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!isObject(value) || typeof value.scriptId !== "string" || !isObject(value.args)) return false;
  return Object.values(value.args).every(isNumber);
};
const isNode = (id: string, node: unknown): boolean => {
  if (!isObject(node) || node.id !== id || typeof node.name !== "string" ||
      !NODE_TYPES.has(node.type as ShapeType | "group" | "instance") ||
      !isMatrix(node.transform) || !isPointOrNull(node.transformOrigin) ||
      !isNumber(node.opacity) || node.opacity < 0 || node.opacity > 1 ||
      (node.blendMode !== undefined && !BLEND_MODES.includes(node.blendMode as never)) ||
      !isEffectsOrUndefined(node.effects) ||
      !isGeneratorOrUndefined(node.generator) ||
      (node.hidden !== undefined && typeof node.hidden !== "boolean") ||
      (node.locked !== undefined && typeof node.locked !== "boolean")) return false;
  if (node.type === "group") {
    return (node.clip === undefined || node.clip === true) &&
      Array.isArray(node.childIds) &&
      node.childIds.every((child) => typeof child === "string");
  }
  if (node.type === "instance") {
    return typeof node.symbolId === "string";
  }
  if (!(isPaintOrNull(node.fill) && isPaintOrNull(node.stroke) &&
      isNumber(node.strokeWidth) && node.strokeWidth >= 0 &&
      isStrokeDashOrUndefined(node.strokeDash) &&
      (node.strokeDashOffset === undefined || isNumber(node.strokeDashOffset)) &&
      (node.strokeCap === undefined || STROKE_CAPS.includes(node.strokeCap as never)) &&
      (node.strokeJoin === undefined || STROKE_JOINS.includes(node.strokeJoin as never)) &&
      (node.strokeAlignment === undefined || STROKE_ALIGNMENTS.includes(node.strokeAlignment as never)))) return false;
  switch (node.type) {
    case "rect":
      return isNumber(node.x) && isNumber(node.y) && isNumber(node.width) && isNumber(node.height) &&
        (node.cornerRadius === undefined || (isNumber(node.cornerRadius) && node.cornerRadius >= 0));
    case "ellipse":
      return isNumber(node.x) && isNumber(node.y) && isNumber(node.width) && isNumber(node.height);
    case "image":
      return typeof node.assetId === "string" &&
        isNumber(node.x) && isNumber(node.y) && isNumber(node.width) && isNumber(node.height) &&
        (node.lockAspect === undefined || typeof node.lockAspect === "boolean");
    case "text":
      return typeof node.text === "string" &&
        (node.textMode === "point" || node.textMode === "area") &&
        isNumber(node.x) && isNumber(node.y) &&
        isNumber(node.width) && node.width > 0 &&
        isNumber(node.height) && node.height > 0 &&
        typeof node.fontFamily === "string" && node.fontFamily.trim().length > 0 &&
        isNumber(node.fontSize) && node.fontSize > 0 &&
        isNumber(node.fontWeight) && node.fontWeight >= 100 &&
        node.fontWeight <= 900 && node.fontWeight % 100 === 0 &&
        typeof node.italic === "boolean" &&
        isNumber(node.lineHeight) && node.lineHeight > 0 &&
        (node.align === "left" || node.align === "center" || node.align === "right");
    case "line":
      return isNumber(node.x1) && isNumber(node.y1) && isNumber(node.x2) && isNumber(node.y2);
    case "path":
      return isPoints(node.points) && typeof node.closed === "boolean";
    case "brush":
      return Array.isArray(node.anchors) &&
        node.anchors.every((anchor: unknown) => isObject(anchor) && isPoint(anchor.p) &&
          (anchor.hIn === null || isPoint(anchor.hIn)) &&
          (anchor.hOut === null || isPoint(anchor.hOut)) &&
          isNumber(anchor.w) && anchor.w >= 0);
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
    case "compoundPath":
      return node.fillRule === "evenodd" &&
        Array.isArray(node.components) && node.components.length > 0 &&
        node.components.every((component: unknown) =>
          isObject(component) &&
          COMPOUND_COMPONENT_TYPES.has(component.type as ShapeType) &&
          typeof component.id === "string" &&
          isNode(component.id, component) &&
          (component.type !== "path" || component.closed === true) &&
          (component.type !== "bezier" ||
            (component.subpaths as unknown[]).length > 0 &&
            (component.subpaths as Array<{ closed?: unknown }>).every((sp) => sp.closed === true)));
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
  if (data.version !== CURRENT_FILE_VERSION && !MIGRATABLE_VERSIONS.has(data.version)) {
    throw new Error(`Unsupported Vinegar file version: ${String(data.version)}.`);
  }
  if (data.version === 8 && isObject(data.document) && data.document.symbols === undefined) {
    data.document.symbols = {};
  }
  if ((data.version === 8 || data.version === 9) && isObject(data.document)) {
    migrateLegacyPaints(data.document);
  }
  if (
    data.version !== CURRENT_FILE_VERSION &&
    isObject(data.document) &&
    data.document.artboards === undefined
  ) {
    data.document.artboards = [];
  }
  if (
    data.version !== CURRENT_FILE_VERSION &&
    isObject(data.document) &&
    data.document.scripts === undefined
  ) {
    data.document.scripts = {};
  }
  if (!isCurrentDocument(data.document)) {
    throw new Error("Document data is missing or malformed.");
  }
  validateTree(data.document);
  return structuredClone(data.document);
}

/** Convert pre-v10 string fill/stroke to structured Paint, in place. */
function migrateLegacyPaints(doc: Record<string, unknown>): void {
  const nodes = doc.nodes;
  if (!isObject(nodes)) return;
  const migrate = (node: unknown) => {
    if (!isObject(node)) return;
    if ("fill" in node) node.fill = paintFromLegacy(node.fill);
    if ("stroke" in node) node.stroke = paintFromLegacy(node.stroke);
    if (node.type === "compoundPath" && Array.isArray(node.components)) {
      node.components.forEach(migrate);
    }
  };
  Object.values(nodes).forEach(migrate);
}

function isCurrentDocument(value: unknown): value is Document {
  if (!isObject(value) || !isObject(value.nodes)) return false;
  return (
    Array.isArray(value.rootIds) &&
    value.rootIds.every((id) => typeof id === "string") &&
    Object.entries(value.nodes).every(([id, node]) => isNode(id, node)) &&
    isObject(value.symbols) &&
    Object.entries(value.symbols).every(([id, def]) =>
      isObject(def) && def.id === id &&
      typeof def.name === "string" && typeof def.rootNodeId === "string") &&
    isObject(value.scripts) &&
    Object.entries(value.scripts).every(([id, def]) =>
      isObject(def) && def.id === id &&
      typeof def.name === "string" && typeof def.source === "string") &&
    Array.isArray(value.artboards) &&
    value.artboards.every((ab) =>
      isObject(ab) && typeof ab.id === "string" && typeof ab.name === "string" &&
      isNumber(ab.x) && isNumber(ab.y) && isNumber(ab.width) && isNumber(ab.height) &&
      (ab.background === null || typeof ab.background === "string")) &&
    isObject(value.settings) && typeof value.settings.unit === "string" &&
    isNumber(value.settings.dpi) && isNumber(value.settings.gridSize) &&
    isObject(value.metadata) && typeof value.metadata.createdAt === "string" &&
    typeof value.metadata.modifiedAt === "string" &&
    isObject(value.assets) &&
    Object.entries(value.assets).every(([id, asset]) =>
      isObject(asset) && asset.id === id && asset.kind === "image" &&
      typeof asset.mimeType === "string" &&
      (asset.name === undefined || typeof asset.name === "string") &&
      isObject(asset.source) && asset.source.type === "data" &&
      typeof asset.source.data === "string") &&
    isObject(value.extensions)
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
    if (node.type === "instance") {
      if (!doc.symbols[node.symbolId]) {
        throw new Error(`Instance references missing symbol: ${node.symbolId}.`);
      }
      return;
    }
    if (node.type === "image" && !doc.assets[node.assetId]) {
      throw new Error(`Image references missing asset: ${node.assetId}.`);
    }
    if (node.type !== "group") {
      for (const paint of [node.fill, node.stroke]) {
        if (paint?.type === "pattern" && !doc.assets[paint.assetId]) {
          throw new Error(`Pattern references missing asset: ${paint.assetId}.`);
        }
      }
      return;
    }
    if (node.clip === true && !clippingMask(doc, node)) {
      throw new Error(`Clipping group has no valid final mask: ${id}.`);
    }
    visiting.add(id);
    for (const childId of node.childIds) visit(childId);
    visiting.delete(id);
  };
  for (const id of doc.rootIds) visit(id);
  for (const def of Object.values(doc.symbols)) {
    const root = doc.nodes[def.rootNodeId];
    if (!root || root.type !== "group") {
      throw new Error(`Symbol has no root group: ${def.id}.`);
    }
    visit(def.rootNodeId);
  }
  if (owned.size !== Object.keys(doc.nodes).length) {
    throw new Error("Scene contains unreachable nodes.");
  }
  // The symbol reference graph must be acyclic.
  const done = new Set<string>();
  const stack = new Set<string>();
  const visitSymbol = (id: string) => {
    if (stack.has(id)) throw new Error("Symbols reference each other cyclically.");
    if (done.has(id)) return;
    stack.add(id);
    const walk = (nodeId: string) => {
      const node = doc.nodes[nodeId];
      if (!node) return;
      if (node.type === "instance") visitSymbol(node.symbolId);
      else if (node.type === "group") node.childIds.forEach(walk);
    };
    const def = doc.symbols[id];
    if (def) walk(def.rootNodeId);
    stack.delete(id);
    done.add(id);
  };
  for (const def of Object.values(doc.symbols)) visitSymbol(def.id);
}
