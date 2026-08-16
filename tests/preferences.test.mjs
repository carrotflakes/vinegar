import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createDefaultPreferences;
let createPreferencesStore;
let usePreferences;
let useEditor;
let applyPreferencesToRoot;
let parsePreferences;
let readPreferences;
let resolveTheme;
let storageKey;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({
    createDefaultPreferences,
    parsePreferences,
    readPreferences,
    resolveTheme,
    PREFERENCES_STORAGE_KEY: storageKey,
  } = await server.ssrLoadModule("/src/preferences/model.ts"));
  ({ applyPreferencesToRoot } =
    await server.ssrLoadModule("/src/preferences/apply.ts"));
  ({ createPreferencesStore, usePreferences } =
    await server.ssrLoadModule("/src/store/preferencesStore.ts"));
  ({ useEditor } =
    await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

function makeStorage(initial = null) {
  let value = initial;
  const writes = [];
  return {
    writes,
    get value() {
      return value;
    },
    storage: {
      getItem(key) {
        assert.equal(key, storageKey);
        return value;
      },
      setItem(key, next) {
        assert.equal(key, storageKey);
        value = next;
        writes.push(next);
      },
    },
  };
}

test("missing or malformed preferences use fresh defaults", () => {
  assert.deepEqual(parsePreferences(null), createDefaultPreferences());
  assert.deepEqual(parsePreferences("{ broken"), createDefaultPreferences());
  assert.deepEqual(parsePreferences("null"), createDefaultPreferences());
});

test("valid v1 preferences load while unknown fields are ignored", () => {
  const loaded = parsePreferences(JSON.stringify({
    version: 1,
    general: { theme: "light", locale: "en", future: true },
    recovery: { enabled: false, maxWaitMs: 12345, future: "value" },
    history: { limit: 75, future: "value" },
    futureGroup: { enabled: true },
  }));

  assert.deepEqual(loaded, {
    version: 1,
    general: { theme: "light", locale: "en" },
    canvas: {
      rotationEnabled: true,
      rotationSnap: true,
      rulerOrigin: "artboard",
      fingerDrawing: true,
      penDetected: false,
      showAllHandles: false,
    },
    input: { numberPad: "auto" },
    recovery: { enabled: false, maxWaitMs: 12345 },
    history: { limit: 75 },
  });
});

test("older v1 preferences default recovery autosave to on", () => {
  const loaded = parsePreferences(JSON.stringify({
    version: 1,
    general: { theme: "dark", locale: "en" },
    recovery: { maxWaitMs: 15000 },
  }));

  assert.deepEqual(loaded.recovery, { enabled: true, maxWaitMs: 15000 });
  assert.deepEqual(loaded.history, { limit: 100 });
});

test("invalid fields fall back independently", () => {
  const loaded = parsePreferences(JSON.stringify({
    version: 1,
    general: { theme: "dark", locale: "ja" },
    recovery: { enabled: "yes", maxWaitMs: 0 },
    history: { limit: 1.5 },
  }));

  assert.deepEqual(loaded, {
    version: 1,
    general: { theme: "dark", locale: "en" },
    canvas: {
      rotationEnabled: true,
      rotationSnap: true,
      rulerOrigin: "artboard",
      fingerDrawing: true,
      penDetected: false,
      showAllHandles: false,
    },
    input: { numberPad: "auto" },
    recovery: { enabled: true, maxWaitMs: 5000 },
    history: { limit: 100 },
  });
});

test("the number pad preference loads and falls back to auto", () => {
  const load = (input) =>
    parsePreferences(JSON.stringify({ version: 1, input })).input;

  assert.deepEqual(load({ numberPad: "always" }), { numberPad: "always" });
  assert.deepEqual(load({ numberPad: "never" }), { numberPad: "never" });
  assert.deepEqual(load({ numberPad: "sometimes" }), { numberPad: "auto" });
  assert.deepEqual(load(undefined), { numberPad: "auto" });
});

test("canvas rotation preferences load and fall back per field", () => {
  const loaded = parsePreferences(JSON.stringify({
    version: 1,
    general: { theme: "dark", locale: "en" },
    canvas: { rotationEnabled: false, rotationSnap: "nope" },
    recovery: { enabled: true, maxWaitMs: 5000 },
    history: { limit: 100 },
  }));

  assert.deepEqual(loaded.canvas, {
    rotationEnabled: false,
    rotationSnap: true,
    rulerOrigin: "artboard",
    fingerDrawing: true,
    penDetected: false,
    showAllHandles: false,
  });
});

test("the preference store updates canvas rotation toggles", () => {
  const fake = makeStorage();
  const store = createPreferencesStore(fake.storage);

  store.getState().setCanvasRotationEnabled(false);
  store.getState().setCanvasRotationSnap(false);

  const expected = {
    rotationEnabled: false,
    rotationSnap: false,
    rulerOrigin: "artboard",
    fingerDrawing: true,
    penDetected: false,
    showAllHandles: false,
  };
  assert.deepEqual(store.getState().canvas, expected);
  assert.deepEqual(JSON.parse(fake.value).canvas, expected);
});

test("the first pen contact disables finger drawing exactly once", () => {
  const fake = makeStorage();
  const store = createPreferencesStore(fake.storage);

  assert.equal(store.getState().canvas.fingerDrawing, true);
  assert.equal(store.getState().notePenInput(), true);
  assert.deepEqual(store.getState().canvas, {
    rotationEnabled: true,
    rotationSnap: true,
    rulerOrigin: "artboard",
    fingerDrawing: false,
    penDetected: true,
    showAllHandles: false,
  });

  // Later pen contacts report nothing, and never fight a manual re-enable.
  assert.equal(store.getState().notePenInput(), false);
  store.getState().setFingerDrawing(true);
  assert.equal(store.getState().notePenInput(), false);
  assert.equal(store.getState().canvas.fingerDrawing, true);
});

test("a returning user who never drew with a finger is not notified", () => {
  const fake = makeStorage(JSON.stringify({
    version: 1,
    general: { theme: "dark", locale: "en" },
    canvas: { fingerDrawing: false },
  }));
  const store = createPreferencesStore(fake.storage);

  assert.equal(store.getState().notePenInput(), false);
  assert.equal(store.getState().canvas.penDetected, true);
});

test("unsupported preference versions fall back safely", () => {
  const loaded = parsePreferences(JSON.stringify({
    version: 2,
    general: { theme: "light", locale: "en" },
    recovery: { enabled: false, maxWaitMs: 60000 },
    history: { limit: 200 },
  }));

  assert.deepEqual(loaded, createDefaultPreferences());
});

test("numeric preferences accept values outside the UI presets", () => {
  const loaded = parsePreferences(JSON.stringify({
    version: 1,
    general: { theme: "system", locale: "en" },
    recovery: { enabled: true, maxWaitMs: 4321 },
    history: { limit: 73 },
  }));

  assert.equal(loaded.recovery.maxWaitMs, 4321);
  assert.equal(loaded.history.limit, 73);
});

test("the preference store persists complete updates and resets", () => {
  const fake = makeStorage();
  const store = createPreferencesStore(fake.storage);

  store.getState().setTheme("light");
  store.getState().setRecoveryEnabled(false);
  store.getState().setRecoveryMaxWaitMs(12345);
  store.getState().setUndoHistoryLimit(75);

  assert.deepEqual(JSON.parse(fake.value), {
    version: 1,
    general: { theme: "light", locale: "en" },
    canvas: {
      rotationEnabled: true,
      rotationSnap: true,
      rulerOrigin: "artboard",
      fingerDrawing: true,
      penDetected: false,
      showAllHandles: false,
    },
    input: { numberPad: "auto" },
    recovery: { enabled: false, maxWaitMs: 12345 },
    history: { limit: 75 },
  });
  assert.equal(fake.writes.length, 4);

  store.getState().resetPreferences();
  assert.deepEqual(JSON.parse(fake.value), createDefaultPreferences());
  assert.deepEqual({
    version: store.getState().version,
    general: store.getState().general,
    canvas: store.getState().canvas,
    input: store.getState().input,
    recovery: store.getState().recovery,
    history: store.getState().history,
  }, createDefaultPreferences());
});

test("storage failures do not prevent in-memory preference changes", () => {
  const store = createPreferencesStore({
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  });

  assert.deepEqual({
    version: store.getState().version,
    general: store.getState().general,
    canvas: store.getState().canvas,
    input: store.getState().input,
    recovery: store.getState().recovery,
    history: store.getState().history,
  }, createDefaultPreferences());
  assert.doesNotThrow(() => store.getState().setTheme("dark"));
  assert.equal(store.getState().general.theme, "dark");
});

test("the preference store ignores invalid numeric updates", () => {
  const fake = makeStorage();
  const store = createPreferencesStore(fake.storage);

  store.getState().setRecoveryMaxWaitMs(0);
  store.getState().setUndoHistoryLimit(Number.NaN);

  assert.equal(store.getState().recovery.maxWaitMs, 5000);
  assert.equal(store.getState().history.limit, 100);
  assert.equal(fake.writes.length, 0);
});

test("readPreferences uses the canonical storage key", () => {
  const fake = makeStorage(JSON.stringify({
    version: 1,
    general: { theme: "light", locale: "en" },
    recovery: { enabled: false, maxWaitMs: 60001 },
    history: { limit: 125 },
  }));

  const loaded = readPreferences(fake.storage);
  assert.deepEqual(loaded.recovery, {
    enabled: false,
    maxWaitMs: 60001,
  });
  assert.deepEqual(loaded.history, { limit: 125 });
});

test("lowering the undo limit immediately trims both history stacks", () => {
  const past = Array.from({ length: 75 }, (_, id) => ({ id }));
  const future = Array.from({ length: 75 }, (_, id) => ({ id }));
  useEditor.setState({ history: { past, future } });

  usePreferences.getState().setUndoHistoryLimit(50);

  assert.equal(useEditor.getState().history.past.length, 50);
  assert.equal(useEditor.getState().history.past[0], past[25]);
  assert.equal(useEditor.getState().history.future.length, 50);
  assert.equal(useEditor.getState().history.future[0], future[0]);

  usePreferences.getState().resetPreferences();
  useEditor.setState({ history: { past: [], future: [] } });
});

test("new document edits respect the configured undo limit", () => {
  usePreferences.getState().setUndoHistoryLimit(50);
  useEditor.getState().newDocument();

  for (let i = 0; i < 55; i++) {
    useEditor.getState().addFrame({ x: i, y: 0 });
  }

  assert.equal(useEditor.getState().history.past.length, 50);

  usePreferences.getState().resetPreferences();
  useEditor.getState().newDocument();
});

test("theme resolution honors explicit and system preferences", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("global preference application sets the effective theme and language", () => {
  const root = { dataset: {}, lang: "" };
  const preferences = createDefaultPreferences();

  applyPreferencesToRoot(root, preferences, false);

  assert.equal(root.dataset.theme, "light");
  assert.equal(root.lang, "en");
});
