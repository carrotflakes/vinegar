import assert from "node:assert/strict";
import { after, afterEach, before, mock, test } from "node:test";
import { createServer } from "vite";

let server;
let clearDocumentRecovery;
let startDocumentAutosave;
let restoreRecoveryAtStartup;
let createEmptyDocument;
let serializeDocument;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ clearDocumentRecovery, startDocumentAutosave, restoreRecoveryAtStartup } =
    await server.ssrLoadModule("/src/io/recovery.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ serializeDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

let running = null;
afterEach(() => {
  running?.stop();
  running = null;
  mock.timers.reset();
});

// A fake store exposing just the fields autosave reads, plus a `set` that
// notifies subscribers with (state, previous) like zustand does.
function makeSource(doc) {
  let state = { doc, savedDoc: doc };
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(next) {
      const previous = state;
      state = { ...state, ...next };
      for (const fn of listeners) fn(state, previous);
    },
  };
}

// Records every storage call so tests can assert write/clear ordering.
function makeStorage() {
  const calls = [];
  let stored = null;
  return {
    calls,
    get stored() {
      return stored;
    },
    async read() {
      calls.push("read");
      return stored;
    },
    async write(doc) {
      calls.push("write");
      stored = { doc, savedAt: new Date().toISOString() };
      return stored;
    },
    async clear() {
      calls.push("clear");
      stored = null;
    },
  };
}

const only = (calls, kind) => calls.filter((c) => c === kind);

// Let the queued storage promises settle; setImmediate is a real macrotask
// (only setTimeout/Date are mocked), so it drains the microtask queue.
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function trackStatus(controllerOptions) {
  const statuses = [];
  return {
    statuses,
    last: () => statuses[statuses.length - 1],
    options: { ...controllerOptions, onStatus: (s) => statuses.push(s) },
  };
}

test("trailing debounce writes once after the edits stop", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const source = makeSource({ v: 0 });
  const storage = makeStorage();
  const { statuses, options } = trackStatus({ debounceMs: 1000, maxWaitMs: 5000 });
  running = startDocumentAutosave({ source, storage, ...options });

  source.set({ doc: { v: 1 } });
  assert.equal(statuses.at(-1).phase, "saving");

  mock.timers.tick(999);
  await settle();
  assert.deepEqual(storage.calls, [], "should not write before the debounce elapses");

  mock.timers.tick(1);
  await settle();
  assert.deepEqual(only(storage.calls, "write"), ["write"]);
  assert.equal(statuses.at(-1).phase, "saved");
  assert.ok(statuses.at(-1).at, "saved status carries a timestamp");
});

test("a burst of edits coalesces into a single write of the latest doc", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const source = makeSource({ v: 0 });
  const storage = makeStorage();
  running = startDocumentAutosave({ source, storage, onStatus() {}, debounceMs: 1000, maxWaitMs: 5000 });

  const latest = { v: 3 };
  source.set({ doc: { v: 1 } });
  mock.timers.tick(400);
  source.set({ doc: { v: 2 } });
  mock.timers.tick(400);
  source.set({ doc: latest });
  mock.timers.tick(1000);
  await settle();

  assert.deepEqual(only(storage.calls, "write"), ["write"]);
  assert.equal(storage.stored.doc, latest, "writes the newest doc, not an intermediate one");
});

test("maxWait forces a write while edits keep coming", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const source = makeSource({ v: 0 });
  const storage = makeStorage();
  running = startDocumentAutosave({ source, storage, onStatus() {}, debounceMs: 1000, maxWaitMs: 3000 });

  // A change every 500ms never leaves a 1000ms idle gap, so only maxWait can
  // trigger a write. It must land by t=3000.
  for (let i = 1; i <= 6; i++) {
    source.set({ doc: { v: i } });
    mock.timers.tick(500);
    await settle();
  }
  assert.ok(only(storage.calls, "write").length >= 1, "maxWait should force at least one write");
});

test("returning to a clean state cancels the pending write and clears storage", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const clean = { v: 0 };
  const source = makeSource(clean);
  const storage = makeStorage();
  const { statuses, options } = trackStatus({ debounceMs: 1000, maxWaitMs: 5000 });
  running = startDocumentAutosave({ source, storage, ...options });

  source.set({ doc: { v: 1 } }); // dirty: schedules a write
  mock.timers.tick(500);
  source.set({ doc: clean, savedDoc: clean }); // back in sync (e.g. undo / save)
  mock.timers.tick(1000);
  await settle();

  assert.deepEqual(only(storage.calls, "write"), [], "no stale write after returning to clean");
  assert.deepEqual(only(storage.calls, "clear"), ["clear"]);
  assert.equal(statuses.at(-1).phase, "ready");
});

test("disabling recovery clears the browser snapshot", async () => {
  const storage = makeStorage();
  const statuses = [];

  const result = await clearDocumentRecovery({
    storage,
    onStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(result, { cleared: true });
  assert.deepEqual(storage.calls, ["clear"]);
  assert.deepEqual(statuses, [{ phase: "ready" }]);
});

test("a failed recovery clear reports an error", async () => {
  const statuses = [];
  const result = await clearDocumentRecovery({
    storage: {
      async clear() {
        throw new Error("blocked");
      },
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(result.cleared, false);
  assert.match(result.error, /blocked/);
  assert.equal(statuses.at(-1).phase, "error");
  assert.match(statuses.at(-1).error, /blocked/);
});

test("startup restore loads the snapshot and keeps it dirty", async () => {
  const doc = createEmptyDocument();
  const id = "rect-1";
  doc.nodes[id] = {
    id,
    name: id,
    type: "rect",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    fill: { type: "solid", color: "#f00", alpha: 1 },
    stroke: null,
    strokeWidth: 0,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
  };
  doc.rootIds = [id];

  const savedAt = new Date().toISOString();
  const snapshot = { file: serializeDocument(doc), savedAt };
  const fakeStorage = { read: async () => snapshot };
  const statuses = [];

  const result = await restoreRecoveryAtStartup({
    storage: fakeStorage,
    onStatus: (s) => statuses.push(s),
  });

  assert.equal(result.restored, true);
  assert.deepEqual(statuses.at(-1), { phase: "recovered", at: savedAt });
  const state = useEditor.getState();
  assert.deepEqual(state.doc.rootIds, [id], "recovered document is in the store");
  assert.notEqual(state.doc, state.savedDoc, "recovered work stays dirty for beforeunload/autosave");
});

test("declining the restore prompt discards the snapshot without touching the store", async () => {
  const storage = makeStorage();
  const savedAt = new Date().toISOString();
  const fakeStorage = { ...storage, read: async () => ({ file: serializeDocument(createEmptyDocument()), savedAt }) };
  const before = useEditor.getState().doc;
  const statuses = [];

  const result = await restoreRecoveryAtStartup({
    storage: fakeStorage,
    onStatus: (s) => statuses.push(s),
    confirm: () => false,
  });

  assert.equal(result.restored, false);
  assert.equal(statuses.at(-1).phase, "ready");
  assert.deepEqual(storage.calls, ["clear"], "a declined snapshot is cleared");
  assert.equal(useEditor.getState().doc, before, "the current document is left untouched");
});

test("startup restore discards a snapshot it cannot parse", async () => {
  const storage = makeStorage();
  const fakeStorage = { ...storage, read: async () => ({ file: "{ not json", savedAt: new Date().toISOString() }) };
  const statuses = [];

  const result = await restoreRecoveryAtStartup({
    storage: fakeStorage,
    onStatus: (s) => statuses.push(s),
  });

  assert.equal(result.restored, false);
  assert.equal(statuses.at(-1).phase, "error");
  assert.deepEqual(storage.calls, ["clear"], "an unparseable snapshot is cleared");
});

test("startup with no snapshot reports ready", async () => {
  const storage = makeStorage();
  const statuses = [];

  const result = await restoreRecoveryAtStartup({
    storage,
    onStatus: (s) => statuses.push(s),
  });

  assert.equal(result.restored, false);
  assert.deepEqual(statuses.at(-1), { phase: "ready" });
  assert.deepEqual(only(storage.calls, "clear"), [], "nothing to clear when empty");
});
