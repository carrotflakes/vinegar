// Web Worker that runs a user drawing script in isolation and returns plain
// shape specs. Runs off the main thread so infinite loops can be terminated.

type Vec = { x: number; y: number };
// 2D affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f
type Mat = [number, number, number, number, number, number];

interface Style {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
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

function apply(m: Mat, x: number, y: number): Vec {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Run one script, returning the collected shape specs (or throwing). */
function run(code: string): unknown[] {
  let matrix: Mat = [1, 0, 0, 1, 0, 0];
  let style: Style = {
    fill: "#4f8cff",
    stroke: "#1b1b1b",
    strokeWidth: 2,
    opacity: 1,
  };
  const stack: { matrix: Mat; style: Style }[] = [];
  const shapes: unknown[] = [];

  const emit = (s: Record<string, unknown>) => {
    if (shapes.length >= MAX_SHAPES) {
      throw new Error(`Too many shapes (limit ${MAX_SHAPES})`);
    }
    shapes.push({ ...style, rotation: 0, groupId: null, ...s });
  };

  // Seeded PRNG (mulberry32) so scripts are reproducible.
  let rngState = 0x9e3779b9 >>> 0;
  const rng = () => {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const decompose = (m: Mat) => ({
    rotation: Math.atan2(m[1], m[0]),
    sx: Math.hypot(m[0], m[1]),
    sy: Math.hypot(m[2], m[3]),
  });

  const toPoints = (pts: ([number, number] | Vec)[]): Vec[] =>
    pts.map((p) => {
      const x = Array.isArray(p) ? p[0] : p.x;
      const y = Array.isArray(p) ? p[1] : p.y;
      return apply(matrix, x, y);
    });

  const api = {
    PI: Math.PI,
    TAU: Math.PI * 2,
    DEG: Math.PI / 180,

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

    rect: (x: number, y: number, w: number, h: number) => {
      const { rotation, sx, sy } = decompose(matrix);
      const c = apply(matrix, x + w / 2, y + h / 2);
      const W = Math.abs(w * sx);
      const H = Math.abs(h * sy);
      emit({
        type: "rect",
        name: "Rectangle",
        x: c.x - W / 2,
        y: c.y - H / 2,
        width: W,
        height: H,
        rotation,
      });
    },
    ellipse: (cx: number, cy: number, rx: number, ry = rx) => {
      const { rotation, sx, sy } = decompose(matrix);
      const c = apply(matrix, cx, cy);
      const W = Math.abs(rx * 2 * sx);
      const H = Math.abs(ry * 2 * sy);
      emit({
        type: "ellipse",
        name: "Ellipse",
        x: c.x - W / 2,
        y: c.y - H / 2,
        width: W,
        height: H,
        rotation,
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
    path: (pts: ([number, number] | Vec)[], closed = false) => {
      const points = toPoints(pts);
      emit({
        type: "path",
        name: "Path",
        points,
        closed,
        fill: closed ? style.fill : null,
      });
    },
    polygon: (pts: ([number, number] | Vec)[]) => api.path(pts, true),

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
  return shapes;
}

const worker = self as unknown as Worker;
worker.onmessage = (e: MessageEvent<{ code: string }>) => {
  try {
    const shapes = run(e.data.code);
    worker.postMessage({ shapes });
  } catch (err) {
    worker.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
