// Web Worker that runs a user drawing script in isolation. It receives a
// snapshot of the document, lets the script create / read / edit / delete
// shapes, and returns a changeset. Running off the main thread means infinite
// loops can be terminated.

import { shapeBounds } from "../model/bounds";
import { transformBounds } from "../model/matrix";
import { translateShape } from "../model/transforms";
import type { Shape, Vec2 } from "../model/types";

// 2D affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f
type Mat = [number, number, number, number, number, number];

interface Style {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  blendMode?: string;
}

interface DocSnapshot {
  shapes: Shape[];
  selectionIds: string[];
}

interface Changeset {
  created: unknown[];
  updated: Shape[];
  deleted: string[];
}

const MAX_SHAPES = 20000;

function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Mat, x: number, y: number): Vec2 {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function run(code: string, snap: DocSnapshot): Changeset {
  // ---- existing shapes: mutable copies tracked for diffing ----------------
  const copies: Shape[] = snap.shapes.map((s) => structuredClone(s));
  const idOf = new Map<Shape, string>();
  const origJson = new Map<string, string>();
  for (let i = 0; i < copies.length; i++) {
    const id = snap.shapes[i].id;
    idOf.set(copies[i], id);
    origJson.set(id, JSON.stringify(snap.shapes[i]));
  }
  const selIds = new Set(snap.selectionIds);
  const selection = copies.filter((s) => selIds.has(idOf.get(s)!));
  const removed = new Set<string>();

  // ---- new shapes ---------------------------------------------------------
  const created: unknown[] = [];
  let matrix: Mat = [1, 0, 0, 1, 0, 0];
  let style: Style = {
    fill: "#4f8cff",
    stroke: "#1b1b1b",
    strokeWidth: 2,
    opacity: 1,
  };
  const stack: { matrix: Mat; style: Style }[] = [];

  const emit = (s: Record<string, unknown>) => {
    if (created.length >= MAX_SHAPES) {
      throw new Error(`Too many shapes (limit ${MAX_SHAPES})`);
    }
    created.push({
      ...style,
      transform: [1, 0, 0, 1, 0, 0],
      transformOrigin: null,
      ...s,
    });
  };

  // Seeded PRNG (mulberry32) for reproducible scripts.
  let rngState = 0x9e3779b9 >>> 0;
  const rng = () => {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const toPoints = (pts: ([number, number] | Vec2)[]): Vec2[] =>
    pts.map((p) => {
      const x = Array.isArray(p) ? p[0] : p.x;
      const y = Array.isArray(p) ? p[1] : p.y;
      return apply(matrix, x, y);
    });

  const api = {
    PI: Math.PI,
    TAU: Math.PI * 2,
    DEG: Math.PI / 180,

    // --- reference existing shapes ---
    shapes: copies,
    selection,
    byType: (type: string) => copies.filter((s) => s.type === type),
    bounds: (shape: Shape) => {
      const b = transformBounds(shapeBounds(shape), shape.transform);
      return {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        cx: b.x + b.width / 2,
        cy: b.y + b.height / 2,
      };
    },
    localBounds: (shape: Shape) => shapeBounds(shape),
    move: (shape: Shape, dx: number, dy: number) => {
      Object.assign(shape, translateShape(shape, dx, dy));
    },
    remove: (shapeOrId: Shape | string) => {
      const id =
        typeof shapeOrId === "string" ? shapeOrId : idOf.get(shapeOrId);
      if (id) removed.add(id);
    },

    // --- transform stack ---
    push: () => stack.push({ matrix: [...matrix] as Mat, style: { ...style } }),
    pop: () => {
      const s = stack.pop();
      if (s) {
        matrix = s.matrix;
        style = s.style;
      }
    },
    translate: (x: number, y: number) => {
      matrix = multiply(matrix, [1, 0, 0, 1, x, y]);
    },
    rotate: (r: number) => {
      const c = Math.cos(r);
      const s = Math.sin(r);
      matrix = multiply(matrix, [c, s, -s, c, 0, 0]);
    },
    scale: (sx: number, sy = sx) => {
      matrix = multiply(matrix, [sx, 0, 0, sy, 0, 0]);
    },
    resetMatrix: () => {
      matrix = [1, 0, 0, 1, 0, 0];
    },

    // --- style for new shapes ---
    fill: (c: string | null) => {
      style.fill = c;
    },
    stroke: (c: string | null) => {
      style.stroke = c;
    },
    strokeWidth: (w: number) => {
      style.strokeWidth = w;
    },
    opacity: (o: number) => {
      style.opacity = o;
    },
    blendMode: (m: string) => {
      style.blendMode = m;
    },

    // --- create shapes ---
    rect: (x: number, y: number, w: number, h: number, radius = 0) => {
      emit({
        type: "rect",
        name: "Rectangle",
        x,
        y,
        width: Math.abs(w),
        height: Math.abs(h),
        cornerRadius: Math.max(0, radius),
        transform: [...matrix],
      });
    },
    ellipse: (cx: number, cy: number, rx: number, ry = rx) => {
      emit({
        type: "ellipse",
        name: "Ellipse",
        x: cx - rx,
        y: cy - ry,
        width: Math.abs(rx * 2),
        height: Math.abs(ry * 2),
        transform: [...matrix],
      });
    },
    circle: (cx: number, cy: number, r: number) => api.ellipse(cx, cy, r, r),
    line: (x1: number, y1: number, x2: number, y2: number) => {
      const a = apply(matrix, x1, y1);
      const b = apply(matrix, x2, y2);
      emit({
        type: "line",
        name: "Line",
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        fill: null,
      });
    },
    path: (pts: ([number, number] | Vec2)[], closed = false) => {
      const points = toPoints(pts);
      emit({
        type: "path",
        name: "Path",
        points,
        closed,
        fill: closed ? style.fill : null,
      });
    },
    polygon: (pts: ([number, number] | Vec2)[]) => api.path(pts, true),

    // --- utilities ---
    repeat: (n: number, fn: (i: number) => void) => {
      for (let i = 0; i < n; i++) fn(i);
    },
    seed: (n: number) => {
      rngState = (n | 0) >>> 0;
    },
    random: (a?: number, b?: number) => {
      if (a === undefined) return rng();
      if (b === undefined) return rng() * a;
      return a + rng() * (b - a);
    },
    lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  };

  const fn = new Function(...Object.keys(api), code);
  fn(...Object.values(api));

  // ---- diff edited copies into the changeset ------------------------------
  const updated: Shape[] = [];
  for (const copy of copies) {
    const id = idOf.get(copy)!;
    if (removed.has(id)) continue;
    if (JSON.stringify(copy) !== origJson.get(id)) updated.push(copy);
  }

  return { created, updated, deleted: [...removed] };
}

const worker = self as unknown as Worker;
worker.onmessage = (e: MessageEvent<{ code: string; doc: DocSnapshot }>) => {
  try {
    worker.postMessage(run(e.data.code, e.data.doc));
  } catch (err) {
    worker.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
