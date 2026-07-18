// Web Worker that runs a user parametric generator's `build` off the main
// thread. Running here means a heavy or infinite-looping build can be
// terminated by the host (see generatorClient) instead of freezing the UI.
// Only trusted document scripts reach this point — the consent gate is enforced
// on the main thread before a build is ever dispatched.

import { compileScript } from "./generators";

// Defense-in-depth: drop obvious network ambient authority. The real guarantees
// are DOM isolation (workers have no document) and termination-on-hang; this
// just removes the easy exfiltration paths.
for (const key of [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "importScripts",
  "Request",
  "Response",
  "EventSource",
]) {
  try {
    (self as unknown as Record<string, unknown>)[key] = undefined;
  } catch {
    /* non-configurable globals: ignore */
  }
}

interface GeneratorRequest {
  reqId: number;
  type: "compile" | "build";
  source: string;
  args?: Record<string, number>;
}

const worker = self as unknown as Worker;
worker.onmessage = (e: MessageEvent<GeneratorRequest>) => {
  const { reqId, type, source, args } = e.data;
  // compileScript caches by source and never throws for build/validation errors
  // (they surface as `error` / a null result). Only an infinite loop in the
  // script's top level or build never returns — then the host's watchdog
  // terminates this worker.
  const compiled = compileScript(source);
  if (type === "compile") {
    worker.postMessage({ reqId, params: compiled.params, error: compiled.error });
    return;
  }
  if (compiled.error) {
    worker.postMessage({ reqId, error: compiled.error });
    return;
  }
  worker.postMessage({ reqId, subpaths: compiled.build(args ?? {}) });
};
