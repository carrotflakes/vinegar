import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let UNTITLED_DOCUMENT_NAME;
let parseDocument;
let serializeDocument;
let documentFileName;
let fileSlug;
let uniqueFileSlugs;
let documentNameFromFileName;
let saveDocument;
let saveDocumentAs;
let useDocumentFile;
let useEditor;
let hasUnsavedChanges;
let loadDocumentText;
let commands;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument, UNTITLED_DOCUMENT_NAME } = await server.ssrLoadModule(
    "/src/model/types.ts"
  ));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule(
    "/src/io/serialize.ts"
  ));
  ({ documentFileName, documentNameFromFileName, saveDocument, saveDocumentAs } =
    await server.ssrLoadModule("/src/io/saveDocument.ts"));
  ({ useDocumentFile } = await server.ssrLoadModule(
    "/src/store/documentFileStore.ts"
  ));
  ({ useEditor, hasUnsavedChanges } = await server.ssrLoadModule(
    "/src/store/editorStore.ts"
  ));
  ({ fileSlug, uniqueFileSlugs } = await server.ssrLoadModule(
    "/src/io/exportFilenames.ts"
  ));
  ({ loadDocumentText } = await server.ssrLoadModule("/src/io/openDocument.ts"));
  ({ COMMANDS: commands } = await server.ssrLoadModule(
    "/src/commands/registry.ts"
  ));
});

after(async () => {
  await server?.close();
});

/** A stand-in FileSystemFileHandle that records what was written to it. */
function fakeHandle(name) {
  const handle = {
    name,
    written: [],
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () => new File([handle.written.at(-1) ?? ""], name),
    createWritable: async () => {
      let text = "";
      return {
        write: async (blob) => {
          text = typeof blob === "string" ? blob : await blob.text();
        },
        close: async () => {
          handle.written.push(text);
        },
      };
    },
  };
  return handle;
}

/** Install a File System Access API stub for the duration of `fn`. */
async function withFileSystemAccess({ save, open }, fn) {
  const previous = {
    showSaveFilePicker: globalThis.window?.showSaveFilePicker,
    showOpenFilePicker: globalThis.window?.showOpenFilePicker,
  };
  globalThis.window ??= globalThis;
  globalThis.window.showSaveFilePicker = save;
  globalThis.window.showOpenFilePicker = open;
  try {
    return await fn();
  } finally {
    globalThis.window.showSaveFilePicker = previous.showSaveFilePicker;
    globalThis.window.showOpenFilePicker = previous.showOpenFilePicker;
  }
}

test("a document carries a name that survives save and load", () => {
  const doc = createEmptyDocument();
  assert.equal(doc.metadata.name, UNTITLED_DOCUMENT_NAME);

  const named = { ...doc, metadata: { ...doc.metadata, name: "Sketch 1" } };
  const reopened = parseDocument(serializeDocument(named));
  assert.equal(reopened.metadata.name, "Sketch 1");
});

test("a document without a name is rejected as malformed", () => {
  const doc = createEmptyDocument();
  const file = JSON.parse(serializeDocument(doc));
  delete file.document.metadata.name;
  assert.throws(() => parseDocument(JSON.stringify(file)));
});

test("filenames derive from the document name and back again", () => {
  const doc = createEmptyDocument();
  assert.equal(documentFileName(doc), "untitled.vinegar.json");
  assert.equal(
    documentFileName({ ...doc, metadata: { ...doc.metadata, name: "My Sketch!" } }),
    "my-sketch.vinegar.json"
  );
  assert.equal(documentNameFromFileName("my-sketch.vinegar.json"), "my-sketch");
  assert.equal(documentNameFromFileName("plain.json"), "plain");
  assert.equal(documentNameFromFileName("no-extension"), "no-extension");
});

test("non-Latin names survive slugging instead of collapsing to a fallback", () => {
  // Regression: an ASCII-only slug turned every Japanese name into the same
  // fallback stem, so exports collided as frame, frame-2, frame-3...
  assert.equal(fileSlug("スケッチ"), "スケッチ");
  assert.equal(fileSlug("年賀状 2026"), "年賀状-2026");
  assert.equal(fileSlug("My Sketch!"), "my-sketch");
  assert.equal(fileSlug("///"), "frame");
  assert.equal(fileSlug("///", "untitled"), "untitled");
  assert.deepEqual(uniqueFileSlugs(["スケッチ", "スケッチ", "図"]), [
    "スケッチ",
    "スケッチ-2",
    "図",
  ]);

  const doc = createEmptyDocument();
  assert.equal(
    documentFileName({ ...doc, metadata: { ...doc.metadata, name: "スケッチ" } }),
    "スケッチ.vinegar.json"
  );
});

test("renaming is not undoable but does mark the document dirty", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const undoDepth = useEditor.getState().history.past.length;

  useEditor.getState().markSaved();
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);

  useEditor.getState().setDocumentName("Renamed");
  assert.equal(useEditor.getState().doc.metadata.name, "Renamed");
  assert.equal(useEditor.getState().history.past.length, undoDepth);
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);

  // Blank input falls back to Untitled rather than leaving an empty stem.
  useEditor.getState().setDocumentName("   ");
  assert.equal(useEditor.getState().doc.metadata.name, UNTITLED_DOCUMENT_NAME);
});

test("Save As picks a file, adopts its name, and Save then overwrites it", async () => {
  useEditor.getState().newDocument();
  useDocumentFile.getState().clear();

  const handle = fakeHandle("holiday-card.vinegar.json");
  await withFileSystemAccess({ save: async () => handle }, async () => {
    assert.equal(await saveDocumentAs(), true);

    // A filename the user changed becomes the document name, and lands in the
    // file.
    assert.equal(useEditor.getState().doc.metadata.name, "holiday-card");
    assert.equal(handle.written.length, 1);
    assert.equal(
      JSON.parse(handle.written[0]).document.metadata.name,
      "holiday-card"
    );
    assert.equal(useDocumentFile.getState().handle, handle);

    // A plain Save now reuses the handle instead of asking again.
    assert.equal(await saveDocument(), true);
    assert.equal(handle.written.length, 2);
  });
});

test("accepting the suggested filename keeps the document name as typed", async () => {
  useEditor.getState().newDocument();
  useDocumentFile.getState().clear();
  useEditor.getState().setDocumentName("My Sketch");

  // The picker suggests a slug of the current name; accepting it unchanged
  // must not rewrite "My Sketch" into "my-sketch".
  let suggested = null;
  const save = async (options) => {
    suggested = options.suggestedName;
    return fakeHandle(options.suggestedName);
  };
  await withFileSystemAccess({ save }, async () => {
    assert.equal(await saveDocumentAs(), true);
  });
  assert.equal(suggested, "my-sketch.vinegar.json");
  assert.equal(useEditor.getState().doc.metadata.name, "My Sketch");
});

test("Save falls back to Save As while no file is attached", async () => {
  useEditor.getState().newDocument();
  useDocumentFile.getState().clear();

  let picked = 0;
  const handle = fakeHandle("first-save.vinegar.json");
  await withFileSystemAccess(
    {
      save: async () => {
        picked += 1;
        return handle;
      },
    },
    async () => {
      assert.equal(await saveDocument(), true);
      assert.equal(picked, 1);
      assert.equal(useDocumentFile.getState().fileName, "first-save.vinegar.json");
    }
  );
});

test("a cancelled save leaves the document untouched and unsaved", async () => {
  useEditor.getState().newDocument();
  useDocumentFile.getState().clear();
  useEditor.getState().setDocumentName("Work in progress");

  const abort = () => {
    throw new DOMException("The user aborted a request.", "AbortError");
  };
  await withFileSystemAccess({ save: abort }, async () => {
    assert.equal(await saveDocumentAs(), false);
  });
  assert.equal(useDocumentFile.getState().handle, null);
  assert.equal(useEditor.getState().doc.metadata.name, "Work in progress");
});

test("New and Open detach the document from its file", async () => {
  const handle = fakeHandle("attached.vinegar.json");
  useDocumentFile.getState().attach(handle);

  // file.new prompts when the current document is dirty; accept it.
  globalThis.window ??= globalThis;
  globalThis.window.confirm = () => true;

  const run = (id) => commands.find((c) => c.id === id).run(useEditor.getState());
  run("file.new");
  assert.equal(useDocumentFile.getState().handle, null);

  // Loading text without a handle (a drop the browser gave us nothing for)
  // must not leave a stale handle behind either.
  useDocumentFile.getState().attach(handle);
  loadDocumentText(serializeDocument(createEmptyDocument()));
  assert.equal(useDocumentFile.getState().handle, null);

  // ...but loading with one attaches it, so Save can overwrite.
  loadDocumentText(serializeDocument(createEmptyDocument()), handle);
  assert.equal(useDocumentFile.getState().handle, handle);
});

test("Save As is registered with its own shortcut", () => {
  const saveAs = commands.find((c) => c.id === "file.saveAs");
  assert.ok(saveAs, "file.saveAs should be a registered command");
  assert.deepEqual(saveAs.keys, [{ key: "s", mod: true, shift: true }]);

  const save = commands.find((c) => c.id === "file.save");
  assert.deepEqual(save.keys, [{ key: "s", mod: true }]);
});
