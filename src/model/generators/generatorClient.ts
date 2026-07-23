// Main-thread client for running user generator code (compile + build) in a
// Worker with a watchdog timeout, so the main thread never executes document
// scripts and a hang can't freeze the UI. Built-in generators run natively and
// never come here; only trusted document scripts do. Where Workers are
// unavailable (SSR / tests) it falls back to a synchronous main-thread call —
// same result, without the isolation.

import { compileScript } from "./generators";
import type { GeneratorParam } from "./generators";
import type { PathSubpath } from "../types";

export interface CompileResult {
  params: GeneratorParam[];
  error?: string;
}

export interface BuildResult {
  subpaths: PathSubpath[] | null;
  /** Populated on compile error, a build failure, or a timeout. */
  error?: string;
}

/** A compile/build slower than this is treated as a hang; the worker is killed. */
const TIMEOUT_MS = 1500;

interface Request {
  type: "compile" | "build";
  source: string;
  args?: Record<string, number>;
}
type Response = Record<string, unknown>;

let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 1;
const pending = new Map<number, (data: Response) => void>();

/** Whether a real Worker sandbox exists here (false only in SSR / tests). */
const hasWorkerRuntime = typeof Worker !== "undefined";

/** Get (or lazily create) the sandbox worker; null once creation has failed. */
function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable) return null;
  try {
    const w = new Worker(new URL("./generatorWorker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<Response & { reqId: number }>) => {
      const resolve = pending.get(e.data.reqId);
      if (!resolve) return;
      pending.delete(e.data.reqId);
      resolve(e.data);
    };
    w.onerror = () => reset("Generator worker crashed.");
    worker = w;
    return w;
  } catch {
    // Blocked (e.g. CSP): don't silently run user code on the main thread.
    workerUnavailable = true;
    return null;
  }
}

/** Terminate the worker and fail every in-flight request (used on hang/crash). */
function reset(error: string) {
  if (worker) worker.terminate();
  worker = null;
  const resolvers = [...pending.values()];
  pending.clear();
  for (const resolve of resolvers) resolve({ error });
}

/**
 * Synchronous fallback used ONLY where no Worker runtime exists (SSR / tests).
 * It is never used in a browser: if a browser's Worker is blocked, we surface
 * an error instead, so untrusted/looping user code never runs on the UI thread.
 */
function runLocally(req: Request): Response {
  const compiled = compileScript(req.source);
  if (req.type === "compile") return { params: compiled.params, error: compiled.error };
  if (compiled.error) return { error: compiled.error };
  return { subpaths: compiled.build(req.args ?? {}) };
}

function call(req: Request): Promise<Response> {
  if (!hasWorkerRuntime) return Promise.resolve(runLocally(req));
  const w = getWorker();
  if (!w) {
    return Promise.resolve({
      error:
        "Generators are unavailable: the sandbox worker could not start (blocked by the browser?).",
    });
  }
  return new Promise((resolve) => {
    const reqId = nextId++;
    const timer = setTimeout(
      () => reset(`Generator timed out after ${TIMEOUT_MS}ms (infinite loop?).`),
      TIMEOUT_MS
    );
    pending.set(reqId, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
    w.postMessage({ ...req, reqId });
  });
}

/** Compile a document script to its parameter schema (or a compile error). */
export function compileGenerator(source: string): Promise<CompileResult> {
  return call({ type: "compile", source }).then((d) => ({
    params: (d.params as GeneratorParam[]) ?? [],
    error: d.error as string | undefined,
  }));
}

/** Build a document generator's geometry from args (or a build error). */
export function buildGenerator(
  source: string,
  args: Record<string, number>
): Promise<BuildResult> {
  return call({ type: "build", source, args }).then((d) => ({
    subpaths: (d.subpaths as PathSubpath[] | null) ?? null,
    error: d.error as string | undefined,
  }));
}
