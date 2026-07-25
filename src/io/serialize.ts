import { clippingMask } from "../model/clippingMask";
import { isCompoundChild } from "@/model/path/compoundPath";
import { referencedAssetIds } from "../model/scene";
import {
  BLEND_MODES,
  EFFECT_TYPES,
  STROKE_ALIGNMENTS,
  STROKE_CAPS,
  STROKE_JOINS,
  type Document,
  type ShapeType,
} from "../model/types";

/**
 * Only the current version is accepted; there is no migration from older
 * formats — pre-v28 files fail to open with a clear message.
 */
export const CURRENT_FILE_VERSION = 29 as const;

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

const NODE_TYPES = new Set<ShapeType | "group" | "instance" | "frame">([
  "group", "frame", "rect", "ellipse", "line", "path", "compoundPath", "instance", "image", "text", "brush",
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
    const modeOk = value.mode === "tile" || value.mode === "fill" ||
      value.mode === "fit" || value.mode === "stretch";
    return typeof value.assetId === "string" && modeOk &&
      isNumber(value.scale) && isNumber(value.rotation) && isPoint(value.offset) &&
      isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1;
  }
  if (value.type === "swatch") {
    return typeof value.swatchId === "string" &&
      isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1;
  }
  return false;
};
/** A concrete solid paint (a Swatch's stored value; never a reference). */
const isSolidPaint = (value: unknown): boolean =>
  isObject(value) && value.type === "solid" && typeof value.color === "string" &&
  isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1;
const isPaintOrNull = (value: unknown): boolean => value === null || isPaint(value);
const isEffect = (value: unknown): boolean => {
  if (!isObject(value) || !EFFECT_TYPES.includes(value.type as never)) return false;
  if (value.type === "blur") return isNumber(value.radius) && value.radius >= 0;
  if (value.type === "drop-shadow") {
    return typeof value.color === "string" &&
      isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1 &&
      isNumber(value.blur) && value.blur >= 0 &&
      isNumber(value.offsetX) && isNumber(value.offsetY);
  }
  if (value.type === "color-adjust") {
    return isNumber(value.brightness) && value.brightness >= 0 &&
      isNumber(value.contrast) && value.contrast >= 0 &&
      isNumber(value.saturation) && value.saturation >= 0 &&
      isNumber(value.hue);
  }
  if (value.type === "color-overlay") {
    return typeof value.color === "string" &&
      isNumber(value.alpha) && value.alpha >= 0 && value.alpha <= 1;
  }
  return false;
};
const isEffects = (value: unknown): boolean =>
  Array.isArray(value) && value.every(isEffect);
const isStrokeDash = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry) => isNumber(entry) && entry >= 0);
const isGeneratorOrNull = (value: unknown): boolean => {
  if (value === null) return true;
  if (!isObject(value) || typeof value.scriptId !== "string" || !isObject(value.args)) return false;
  return Object.values(value.args).every(isNumber);
};
// Shared node fields are all required: `undefined` is not a legal value for any
// of them, so a file that omits one is rejected rather than silently defaulted.
const isNode = (id: string, node: unknown): boolean => {
  if (!isObject(node) || node.id !== id || typeof node.name !== "string" ||
      !NODE_TYPES.has(node.type as ShapeType | "group" | "instance") ||
      !isMatrix(node.transform) || !isPointOrNull(node.transformOrigin) ||
      !isNumber(node.opacity) || node.opacity < 0 || node.opacity > 1 ||
      !BLEND_MODES.includes(node.blendMode as never) ||
      !isEffects(node.effects) ||
      !isGeneratorOrNull(node.generator) ||
      typeof node.hidden !== "boolean" ||
      typeof node.locked !== "boolean") return false;
  if (node.type === "group") {
    return typeof node.clipsToMask === "boolean" &&
      Array.isArray(node.childIds) &&
      node.childIds.every((child) => typeof child === "string");
  }
  if (node.type === "frame") {
    return typeof node.clipsContent === "boolean" &&
      isNumber(node.width) && node.width >= 0 &&
      isNumber(node.height) && node.height >= 0 &&
      (node.background === null || typeof node.background === "string") &&
      Array.isArray(node.childIds) &&
      node.childIds.every((child) => typeof child === "string");
  }
  if (node.type === "instance") {
    return typeof node.symbolId === "string";
  }
  if (!(isPaintOrNull(node.fill) && isPaintOrNull(node.stroke) &&
      isNumber(node.strokeWidth) && node.strokeWidth >= 0 &&
      isStrokeDash(node.strokeDash) &&
      isNumber(node.strokeDashOffset) &&
      STROKE_CAPS.includes(node.strokeCap as never) &&
      STROKE_JOINS.includes(node.strokeJoin as never) &&
      STROKE_ALIGNMENTS.includes(node.strokeAlignment as never))) return false;
  switch (node.type) {
    case "rect":
      return isNumber(node.x) && isNumber(node.y) && isNumber(node.width) && isNumber(node.height) &&
        isNumber(node.cornerRadius) && node.cornerRadius >= 0;
    case "ellipse":
      return isNumber(node.x) && isNumber(node.y) && isNumber(node.width) && isNumber(node.height);
    case "image":
      return typeof node.assetId === "string" &&
        isNumber(node.x) && isNumber(node.y) && isNumber(node.width) && isNumber(node.height) &&
        typeof node.lockAspect === "boolean";
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
      return (
        (node.fillRule === "nonzero" || node.fillRule === "evenodd") &&
        Array.isArray(node.subpaths) &&
        node.subpaths.every((sp) =>
          isObject(sp) && typeof sp.closed === "boolean" &&
          Array.isArray(sp.anchors) &&
          sp.anchors.every((anchor: unknown) =>
            isObject(anchor) && isPoint(anchor.p) &&
            (anchor.hIn === null || isPoint(anchor.hIn)) &&
            (anchor.hOut === null || isPoint(anchor.hOut))
          )
        )
      );
    case "brush":
      return Array.isArray(node.anchors) &&
        node.anchors.every((anchor: unknown) => isObject(anchor) && isPoint(anchor.p) &&
          (anchor.hIn === null || isPoint(anchor.hIn)) &&
          (anchor.hOut === null || isPoint(anchor.hOut)) &&
          isNumber(anchor.w) && anchor.w >= 0);
    case "compoundPath":
      return node.components === undefined && node.fillRule === undefined &&
        Array.isArray(node.childIds) && node.childIds.length > 0 &&
        node.childIds.every((child) => typeof child === "string");
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
    isObject(value.symbols) &&
    Object.entries(value.symbols).every(([id, def]) =>
      isObject(def) && def.id === id &&
      typeof def.name === "string" && typeof def.rootNodeId === "string") &&
    isObject(value.swatches) &&
    Object.entries(value.swatches).every(([id, sw]) =>
      isObject(sw) && sw.id === id &&
      typeof sw.name === "string" && isSolidPaint(sw.paint)) &&
    Array.isArray(value.swatchOrder) &&
    value.swatchOrder.every((id) => typeof id === "string") &&
    isObject(value.scripts) &&
    Object.entries(value.scripts).every(([id, def]) =>
      isObject(def) && def.id === id &&
      typeof def.name === "string" && typeof def.source === "string") &&
    Array.isArray(value.guides) &&
    value.guides.every((guide) =>
      isObject(guide) && typeof guide.id === "string" &&
      (guide.axis === "x" || guide.axis === "y") && isNumber(guide.position)) &&
    isObject(value.settings) && typeof value.settings.unit === "string" &&
    isNumber(value.settings.dpi) && isNumber(value.settings.gridSize) &&
    isObject(value.metadata) && typeof value.metadata.name === "string" &&
    typeof value.metadata.createdAt === "string" &&
    typeof value.metadata.modifiedAt === "string" &&
    isObject(value.assets) &&
    Object.entries(value.assets).every(([id, asset]) =>
      isObject(asset) && asset.id === id && asset.kind === "image" &&
      typeof asset.mimeType === "string" &&
      (asset.name === null || typeof asset.name === "string") &&
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
    if (node.type !== "group" && node.type !== "frame") {
      for (const paint of [node.fill, node.stroke]) {
        if (paint?.type === "pattern" && !doc.assets[paint.assetId]) {
          throw new Error(`Pattern references missing asset: ${paint.assetId}.`);
        }
      }
    }
    if (node.type === "compoundPath") {
      if (node.childIds.length === 0) {
        throw new Error(`Compound path has no children: ${id}.`);
      }
      for (const childId of node.childIds) {
        const child = doc.nodes[childId];
        if (!isCompoundChild(child)) {
          throw new Error(`Compound path has invalid child: ${childId}.`);
        }
      }
      visiting.add(id);
      for (const childId of node.childIds) visit(childId);
      visiting.delete(id);
      return;
    }
    if (node.type === "frame") {
      visiting.add(id);
      for (const childId of node.childIds) visit(childId);
      visiting.delete(id);
      return;
    }
    if (node.type !== "group") return;
    if (node.clipsToMask && !clippingMask(doc, node)) {
      throw new Error(`Clipping group has no valid final mask: ${id}.`);
    }
    visiting.add(id);
    for (const childId of node.childIds) visit(childId);
    visiting.delete(id);
  };
  // Guide ids address a guide for move/delete, so they must be unique.
  if (new Set(doc.guides.map((g) => g.id)).size !== doc.guides.length) {
    throw new Error("Document guides contain duplicate ids.");
  }
  // Global colours: `swatchOrder` and `swatches` must be a bijection.
  if (doc.swatchOrder.length !== Object.keys(doc.swatches).length ||
      doc.swatchOrder.some((id) => !doc.swatches[id])) {
    throw new Error("Global colors order does not match the swatch registry.");
  }
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
  // Top-level frame invariant: a frame lives only at the scene root, never
  // inside a group, symbol, or another frame. See docs/document-model.md.
  const rootSet = new Set(doc.rootIds);
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "frame" && !rootSet.has(node.id)) {
      throw new Error(`Frame is not at the top level: ${node.id}.`);
    }
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
      else if (node.type === "group" || node.type === "compoundPath") {
        node.childIds.forEach(walk);
      }
    };
    const def = doc.symbols[id];
    if (def) walk(def.rootNodeId);
    stack.delete(id);
    done.add(id);
  };
  for (const def of Object.values(doc.symbols)) visitSymbol(def.id);
}
