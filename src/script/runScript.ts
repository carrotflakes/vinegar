import { makeId, type Shape } from "../model/types";

export interface RunResult {
  shapes?: Shape[];
  error?: string;
}

const ALLOWED = new Set(["rect", "ellipse", "line", "path"]);

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Convert a plain spec from the worker into a validated Shape with an id. */
function toShape(spec: Record<string, unknown>): Shape | null {
  if (!spec || typeof spec !== "object" || !ALLOWED.has(spec.type as string)) {
    return null;
  }
  const base = {
    id: makeId(String(spec.type)),
    name: typeof spec.name === "string" ? spec.name : String(spec.type),
    fill: typeof spec.fill === "string" ? spec.fill : null,
    stroke: typeof spec.stroke === "string" ? spec.stroke : null,
    strokeWidth: Math.max(0, num(spec.strokeWidth, 1)),
    opacity: clamp01(num(spec.opacity, 1)),
    rotation: num(spec.rotation, 0),
    groupId: null,
  };

  switch (spec.type) {
    case "rect":
    case "ellipse":
      return {
        ...base,
        type: spec.type,
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
      const raw = Array.isArray(spec.points) ? spec.points : [];
      const points = raw
        .filter(
          (p): p is { x: number; y: number } =>
            !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
        )
        .map((p) => ({ x: p.x, y: p.y }));
      if (points.length < 2) return null;
      return { ...base, type: "path", points, closed: !!spec.closed } as Shape;
    }
    default:
      return null;
  }
}

/** Run a drawing script in a Worker and return validated shapes (or an error). */
export function runScript(code: string, timeoutMs = 2500): Promise<RunResult> {
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

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      const data = e.data as { shapes?: unknown[]; error?: string };
      if (data.error) {
        resolve({ error: data.error });
        return;
      }
      const specs = Array.isArray(data.shapes) ? data.shapes : [];
      const shapes = specs
        .map((s) => toShape(s as Record<string, unknown>))
        .filter((s): s is Shape => s !== null);
      resolve({ shapes });
    };

    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ error: e.message || "Script error" });
    };

    worker.postMessage({ code });
  });
}
