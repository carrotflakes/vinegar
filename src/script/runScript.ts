import { solid, type Paint } from "../model/paint";
import {
  BLEND_MODES,
  makeId,
  type BlendMode,
  type Matrix,
  type Shape,
  type Vec2,
} from "../model/types";

export interface ScriptSnapshot {
  shapes: Shape[];
  selectionIds: string[];
}

export interface RunResult {
  created?: Shape[];
  updated?: Shape[];
  deleted?: string[];
  error?: string;
}

const CREATABLE = new Set(["rect", "ellipse", "line", "path"]);

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
/**
 * The script DSL speaks colour strings; shapes store Paint. Convert an edited
 * value back to Paint, preserving the prior alpha when only the colour changed.
 */
const scriptPaint = (v: unknown, fallback: Paint | null): Paint | null => {
  if (v === null) return null;
  if (typeof v === "string") {
    return solid(v, fallback && fallback.type === "solid" ? fallback.alpha : 1);
  }
  return fallback;
};
const blendOr = (v: unknown, fallback: BlendMode | undefined) => {
  if (v === undefined) return fallback;
  return v !== "normal" && BLEND_MODES.includes(v as BlendMode)
    ? (v as BlendMode)
    : undefined;
};
const transformOr = (v: unknown, fallback: Matrix): Matrix =>
  Array.isArray(v) && v.length === 6 && v.every(Number.isFinite)
    ? [...v] as Matrix
    : [...fallback];
const pointOrNull = (v: unknown, fallback: Vec2 | null): Vec2 | null => {
  if (v === null) return null;
  return v && Number.isFinite((v as Vec2).x) && Number.isFinite((v as Vec2).y)
    ? { x: (v as Vec2).x, y: (v as Vec2).y }
    : fallback;
};

function validPoints(v: unknown): Vec2[] | null {
  if (!Array.isArray(v)) return null;
  const pts = v
    .filter(
      (p): p is Vec2 => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
    )
    .map((p) => ({ x: p.x, y: p.y }));
  return pts.length >= 2 ? pts : null;
}

type AnchorLike = { p: Vec2; hIn: Vec2 | null; hOut: Vec2 | null };

function validAnchors(v: unknown): AnchorLike[] | null {
  if (!Array.isArray(v)) return null;
  const ok = (p: unknown): p is Vec2 =>
    !!p &&
    Number.isFinite((p as Vec2).x) &&
    Number.isFinite((p as Vec2).y);
  const anchors = v
    .filter((a) => a && ok(a.p))
    .map((a) => ({
      p: { x: a.p.x, y: a.p.y },
      hIn: ok(a.hIn) ? { x: a.hIn.x, y: a.hIn.y } : null,
      hOut: ok(a.hOut) ? { x: a.hOut.x, y: a.hOut.y } : null,
    }));
  return anchors.length >= 2 ? anchors : null;
}

function validSubpaths(
  v: unknown
): { anchors: AnchorLike[]; closed: boolean }[] | null {
  if (!Array.isArray(v)) return null;
  const subpaths = v.flatMap((sp) => {
    if (!sp || typeof sp !== "object") return [];
    const anchors = validAnchors((sp as Record<string, unknown>).anchors);
    return anchors
      ? [{ anchors, closed: !!(sp as Record<string, unknown>).closed }]
      : [];
  });
  return subpaths.length > 0 ? subpaths : null;
}

function validPolys(v: unknown): Vec2[][][] | null {
  if (!Array.isArray(v)) return null;
  const polys = v
    .map((poly) =>
      Array.isArray(poly)
        ? poly.map((ring) => validPoints(ring)).filter((r): r is Vec2[] => !!r)
        : []
    )
    .filter((poly) => poly.length > 0);
  return polys.length > 0 ? polys : null;
}

/** Build a new shape from a created spec (rect/ellipse/line/path). */
function buildCreated(spec: Record<string, unknown>): Shape | null {
  const type = spec.type as string;
  if (!CREATABLE.has(type)) return null;
  const base = {
    id: makeId(type),
    name: typeof spec.name === "string" ? spec.name : type,
    fill: scriptPaint(spec.fill, null),
    stroke: scriptPaint(spec.stroke, null),
    strokeWidth: Math.max(0, num(spec.strokeWidth, 1)),
    opacity: clamp01(num(spec.opacity, 1)),
    blendMode: blendOr(spec.blendMode, undefined),
    transform: transformOr(spec.transform, [1, 0, 0, 1, 0, 0]),
    transformOrigin: pointOrNull(spec.transformOrigin, null),
  };
  switch (type) {
    case "rect": {
      const width = Math.max(0, num(spec.width));
      const height = Math.max(0, num(spec.height));
      return {
        ...base,
        type: "rect",
        x: num(spec.x),
        y: num(spec.y),
        width,
        height,
        cornerRadius: Math.min(
          Math.max(0, num(spec.cornerRadius)),
          Math.min(width, height) / 2
        ),
      } as Shape;
    }
    case "ellipse":
      return {
        ...base,
        type: "ellipse",
        x: num(spec.x),
        y: num(spec.y),
        width: Math.max(0, num(spec.width)),
        height: Math.max(0, num(spec.height)),
      } as Shape;
    case "line":
      return {
        ...base,
        type: "line",
        fill: null,
        x1: num(spec.x1),
        y1: num(spec.y1),
        x2: num(spec.x2),
        y2: num(spec.y2),
      } as Shape;
    case "path": {
      const points = validPoints(spec.points);
      if (!points) return null;
      return { ...base, type: "path", points, closed: !!spec.closed } as Shape;
    }
    default:
      return null;
  }
}

/** Merge a script-edited copy back onto the existing shape (type/id locked). */
function reconcile(existing: Shape, edited: Record<string, unknown>): Shape {
  const base = {
    ...existing,
    name: typeof edited.name === "string" ? edited.name : existing.name,
    fill: scriptPaint(edited.fill, existing.fill),
    stroke: scriptPaint(edited.stroke, existing.stroke),
    strokeWidth: Math.max(0, num(edited.strokeWidth, existing.strokeWidth)),
    opacity: clamp01(num(edited.opacity, existing.opacity)),
    blendMode: blendOr(edited.blendMode, existing.blendMode),
    transform: transformOr(edited.transform, existing.transform),
    transformOrigin: pointOrNull(
      edited.transformOrigin,
      existing.transformOrigin
    ),
    hidden:
      typeof edited.hidden === "boolean" ? edited.hidden : existing.hidden,
    locked:
      typeof edited.locked === "boolean" ? edited.locked : existing.locked,
  } as Record<string, unknown>;

  switch (existing.type) {
    case "rect": {
      base.x = num(edited.x, existing.x);
      base.y = num(edited.y, existing.y);
      base.width = Math.max(0, num(edited.width, existing.width));
      base.height = Math.max(0, num(edited.height, existing.height));
      const maxRadius = Math.min(base.width as number, base.height as number) / 2;
      base.cornerRadius = Math.min(
        Math.max(0, num(edited.cornerRadius, existing.cornerRadius ?? 0)),
        maxRadius
      );
      break;
    }
    case "ellipse":
      base.x = num(edited.x, existing.x);
      base.y = num(edited.y, existing.y);
      base.width = Math.max(0, num(edited.width, existing.width));
      base.height = Math.max(0, num(edited.height, existing.height));
      break;
    case "line":
      base.x1 = num(edited.x1, existing.x1);
      base.y1 = num(edited.y1, existing.y1);
      base.x2 = num(edited.x2, existing.x2);
      base.y2 = num(edited.y2, existing.y2);
      break;
    case "path":
      base.points = validPoints(edited.points) ?? existing.points;
      base.closed =
        typeof edited.closed === "boolean" ? edited.closed : existing.closed;
      break;
    case "bezier":
      base.subpaths = validSubpaths(edited.subpaths) ?? existing.subpaths;
      break;
    case "polygon":
      base.polys = validPolys(edited.polys) ?? existing.polys;
      break;
  }
  return base as unknown as Shape;
}

/** Run a drawing script in a Worker and return a validated changeset. */
export function runScript(
  code: string,
  snap: ScriptSnapshot,
  timeoutMs = 2500
): Promise<RunResult> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./scriptWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      resolve({ error: "Could not start the script worker." });
      return;
    }

    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ error: `Timed out after ${timeoutMs}ms (infinite loop?)` });
    }, timeoutMs);

    const byId = new Map(snap.shapes.map((s) => [s.id, s]));

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      const data = e.data as {
        created?: unknown[];
        updated?: Record<string, unknown>[];
        deleted?: string[];
        error?: string;
      };
      if (data.error) {
        resolve({ error: data.error });
        return;
      }
      const created = (data.created ?? [])
        .map((s) => buildCreated(s as Record<string, unknown>))
        .filter((s): s is Shape => s !== null);
      const updated: Shape[] = [];
      for (const edited of data.updated ?? []) {
        const existing = byId.get(String(edited.id));
        if (existing) updated.push(reconcile(existing, edited));
      }
      const deleted = (data.deleted ?? []).filter((id) => byId.has(id));
      resolve({ created, updated, deleted });
    };

    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ error: e.message || "Script error" });
    };

    // The DSL reads/writes fill & stroke as colour strings, so present the
    // snapshot with Paint flattened to its colour. reconcile() re-wraps edits
    // as Paint (preserving alpha) against the originals kept in `byId`.
    worker.postMessage({ code, doc: flattenSnapshotForScript(snap) });
  });
}

/**
 * A snapshot copy where solid fill/stroke are flattened to colour strings for
 * the DSL. Gradients stay as objects (scripts can't author them, but must not
 * lose them): scriptPaint() leaves an untouched object as the existing paint.
 */
function flattenSnapshotForScript(snap: ScriptSnapshot): ScriptSnapshot {
  const flat = (v: unknown) => {
    const p = v as Paint | null;
    return p && p.type === "solid" ? p.color : p;
  };
  const flattenPaint = (node: Record<string, unknown>) => {
    if ("fill" in node) node.fill = flat(node.fill);
    if ("stroke" in node) node.stroke = flat(node.stroke);
    if (node.type === "compoundPath" && Array.isArray(node.components)) {
      node.components.forEach((c) => flattenPaint(c as Record<string, unknown>));
    }
  };
  const shapes = snap.shapes.map((s) => {
    const copy = structuredClone(s) as unknown as Record<string, unknown>;
    flattenPaint(copy);
    return copy as unknown as Shape;
  });
  return { shapes, selectionIds: snap.selectionIds };
}
