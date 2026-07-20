// Importing Paper.js SVG items into Vinegar's editable scene model.

import * as paperNs from "paper";
import { isClippingMaskCandidate } from "../model/clippingMask";
import { applyMatrix, IDENTITY } from "../model/matrix";
import {
  linearGradient,
  radialGradient,
  solid,
  type GradientStop,
  type Paint,
} from "../model/paint";
import {
  BLEND_MODES,
  makeId,
  type PathShape,
  type PathSubpath,
  type BlendMode,
  type CompoundPathShape,
  type Group,
  type Matrix,
  type PrimitiveShape,
  type SceneNode,
  type StrokeCap,
  type StrokeJoin,
} from "../model/types";

// paper ships as CJS; depending on bundler interop it lands on the namespace
// itself or on `default`.
const paper: typeof paperNs =
  (paperNs as { default?: typeof paperNs }).default ?? paperNs;

export interface ImportedSvg {
  nodes: Record<string, SceneNode>;
  rootId: string;
}

interface ConvertedChild {
  item: paper.Item;
  id: string;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function matrixOf(item: paper.Item): Matrix {
  const { a, b, c, d, tx, ty } = item.matrix;
  const values = [a, b, c, d, tx, ty];
  return values.every(Number.isFinite)
    ? [a, b, c, d, tx, ty]
    : [...IDENTITY];
}

function nodeName(item: paper.Item, fallback: string): string {
  return item.name?.trim() || fallback;
}

function blendModeOf(item: paper.Item): BlendMode | undefined {
  const value = item.blendMode === "source-over" ? "normal" : item.blendMode;
  return (BLEND_MODES as readonly string[]).includes(value)
    ? (value as BlendMode)
    : undefined;
}

function baseNode(item: paper.Item, fallbackName: string) {
  const blendMode = blendModeOf(item);
  return {
    name: nodeName(item, fallbackName),
    transform: matrixOf(item),
    transformOrigin: null,
    opacity: clamp01(finite(item.opacity, 1)),
    blendMode: blendMode && blendMode !== "normal" ? blendMode : undefined,
    hidden: item.visible === false ? true : undefined,
    locked: item.locked ? true : undefined,
  };
}

function colorHex(color: paper.Color): string {
  const rgb = color.type === "rgb" ? color : color.convert("rgb");
  const byte = (value: number) =>
    Math.round(clamp01(finite(value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(rgb.red)}${byte(rgb.green)}${byte(rgb.blue)}`;
}

function gradientStopsOf(color: paper.Color): GradientStop[] {
  const paintAlpha = clamp01(finite(color.alpha, 1));
  return color.gradient.stops.map((stop) => ({
    offset: clamp01(finite(stop.offset)),
    color: colorHex(stop.color),
    alpha: clamp01(finite(stop.color.alpha, 1) * paintAlpha),
  }));
}

function paintOf(color: paper.Color | null): Paint | null {
  if (!color) return null;
  if (color.type === "gradient") {
    const stops = gradientStopsOf(color);
    if (!stops.length) return null;
    if (color.gradient.radial) return radialGradient(stops);
    // Paper exposes these gradient components at runtime but omits them from
    // its Color declaration (only `highlight` is declared).
    const gradientColor = color as paper.Color & {
      origin: paper.Point;
      destination: paper.Point;
    };
    const origin = gradientColor.origin;
    const destination = gradientColor.destination;
    const angle = Math.atan2(
      finite(destination.y - origin.y),
      finite(destination.x - origin.x)
    );
    return linearGradient(stops, angle);
  }
  return solid(colorHex(color), clamp01(finite(color.alpha, 1)));
}

function strokeCapOf(item: paper.Item): StrokeCap | undefined {
  return item.strokeCap === "butt" ||
    item.strokeCap === "round" ||
    item.strokeCap === "square"
    ? item.strokeCap
    : undefined;
}

function strokeJoinOf(item: paper.Item): StrokeJoin | undefined {
  return item.strokeJoin === "miter" ||
    item.strokeJoin === "round" ||
    item.strokeJoin === "bevel"
    ? item.strokeJoin
    : undefined;
}

function shapeStyle(item: paper.Item) {
  const stroke = paintOf(item.strokeColor);
  const dash = item.dashArray
    .map((value) => finite(value))
    .filter((value) => value >= 0);
  return {
    fill: paintOf(item.fillColor),
    stroke,
    strokeWidth: stroke ? Math.max(0, finite(item.strokeWidth)) : 0,
    strokeDash: dash.length ? dash : undefined,
    strokeDashOffset: item.dashOffset ? finite(item.dashOffset) : undefined,
    strokeCap: strokeCapOf(item),
    strokeJoin: strokeJoinOf(item),
  };
}

function point(value: paper.Point) {
  return { x: finite(value.x), y: finite(value.y) };
}

function pathSubpath(path: paper.Path, transform?: Matrix): PathSubpath | null {
  if (path.segments.length < 2) return null;
  const anchors = path.segments.map((segment) => {
    const p = point(segment.point);
    const hIn = segment.handleIn.isZero()
      ? null
      : {
          x: p.x + finite(segment.handleIn.x),
          y: p.y + finite(segment.handleIn.y),
        };
    const hOut = segment.handleOut.isZero()
      ? null
      : {
          x: p.x + finite(segment.handleOut.x),
          y: p.y + finite(segment.handleOut.y),
        };
    if (!transform) return { p, hIn, hOut };
    return {
      p: applyMatrix(transform, p),
      hIn: hIn ? applyMatrix(transform, hIn) : null,
      hOut: hOut ? applyMatrix(transform, hOut) : null,
    };
  });
  return { anchors, closed: path.closed };
}

function pathNode(path: paper.Path): PathShape | null {
  const subpath = pathSubpath(path);
  if (!subpath) return null;
  return {
    id: makeId("path"),
    type: "path",
    subpaths: [subpath],
    fillRule: path.fillRule === "evenodd" ? "evenodd" : undefined,
    ...shapeStyle(path),
    ...baseNode(path, "Path"),
  };
}

function compoundComponents(item: paper.CompoundPath): PrimitiveShape[] {
  const components: PrimitiveShape[] = [];
  for (const child of item.children) {
    if (child.className !== "Path") continue;
    const path = child as paper.Path;
    const subpath = pathSubpath(path);
    if (!subpath) continue;
    components.push({
      id: makeId("path"),
      name: nodeName(path, "Path"),
      type: "path",
      subpaths: [subpath],
      transform: matrixOf(path),
      transformOrigin: null,
      opacity: 1,
      fill: null,
      stroke: null,
      strokeWidth: 0,
    });
  }
  return components;
}

function compoundNode(
  item: paper.CompoundPath
): PathShape | CompoundPathShape | null {
  if (item.fillRule === "evenodd") {
    const components = compoundComponents(item);
    if (!components.length) return null;
    return {
      id: makeId("compound"),
      type: "compoundPath",
      components,
      fillRule: "evenodd",
      ...shapeStyle(item),
      ...baseNode(item, "Compound Path"),
    };
  }

  const subpaths = item.children.flatMap((child) => {
    if (child.className !== "Path") return [];
    const path = child as paper.Path;
    const subpath = pathSubpath(path, matrixOf(path));
    return subpath ? [subpath] : [];
  });
  if (!subpaths.length) return null;
  return {
    id: makeId("path"),
    type: "path",
    subpaths,
    ...shapeStyle(item),
    ...baseNode(item, "Compound Path"),
  };
}

function convertItem(
  item: paper.Item,
  nodes: Record<string, SceneNode>
): string | null {
  if (item.className === "Shape") {
    return convertItem((item as paper.Shape).toPath(false), nodes);
  }
  if (item.className === "Path") {
    const node = pathNode(item as paper.Path);
    if (!node) return null;
    nodes[node.id] = node;
    return node.id;
  }
  if (item.className === "CompoundPath") {
    const node = compoundNode(item as paper.CompoundPath);
    if (!node) return null;
    nodes[node.id] = node;
    return node.id;
  }
  if (item.className !== "Group" && item.className !== "Layer") return null;

  const children: ConvertedChild[] = [];
  for (const child of item.children) {
    const id = convertItem(child, nodes);
    if (id) children.push({ item: child, id });
  }
  if (!children.length) return null;

  let childIds = children.map((child) => child.id);
  let clip: true | undefined;
  const group = item as paper.Group;
  if (group.clipped && children.length >= 2) {
    const mask = children.find((child) => child.item.clipMask) ?? children[0];
    const maskNode = nodes[mask.id];
    if (isClippingMaskCandidate(maskNode)) {
      childIds = [
        ...children.filter((child) => child !== mask).map((child) => child.id),
        mask.id,
      ];
      clip = true;
    }
  }

  const node: Group = {
    id: makeId("group"),
    type: "group",
    childIds,
    clip,
    ...baseNode(item, "Group"),
  };
  nodes[node.id] = node;
  return node.id;
}

/**
 * Convert an already-imported Paper.js item. Kept separate from XML parsing so
 * model conversion can be covered by Node tests without a browser DOMParser.
 */
export function convertSvgItem(
  item: paper.Item,
  name = "Imported SVG"
): ImportedSvg {
  const nodes: Record<string, SceneNode> = {};
  const childId = convertItem(item, nodes);
  if (!childId) throw new Error("SVG contains no supported vector content.");

  const rootId = makeId("group");
  nodes[rootId] = {
    id: rootId,
    name: name.trim() || "Imported SVG",
    type: "group",
    childIds: [childId],
    transform: [...IDENTITY],
    transformOrigin: null,
    opacity: 1,
  };
  return { nodes, rootId };
}

/** Parse SVG text with an isolated Paper.js project and convert it to nodes. */
export function importSvg(
  svg: string,
  name = "Imported SVG"
): ImportedSvg {
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  try {
    const item = scope.project.importSVG(svg, {
      insert: false,
      expandShapes: true,
      applyMatrix: false,
    });
    return convertSvgItem(item, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid or unsupported SVG: ${message}`);
  } finally {
    scope.project.clear();
  }
}
