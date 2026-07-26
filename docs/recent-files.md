# Recent files

Status: **design proposal — not implemented, and deliberately shelved.** Kept
as a record of the design should the feature come back (most likely alongside
cloud save, which is what makes it worthwhile). File version: **no bump** — this
is session/app state, never part of a `.vinegar.json`. Related:
[document-model.md](document-model.md), `io/fileSystem.ts`, `io/recovery.ts`
(the other IndexedDB user).

## Problem / motivation

There is no way back to a document you had open yesterday. `File ▸ Open…`
always goes through the OS picker, and the app remembers nothing between
sessions except a single crash-recovery snapshot:

| mechanism | scope | purpose |
| --- | --- | --- |
| `io/recovery.ts` | **one** dirty document | survive a crash / accidental reload |
| *(missing)* | last *N* documents | get back to work you deliberately saved |

They are complementary, not overlapping: recovery holds *content* for one
document and is cleared once saved; recent files holds *references* to many
documents and never holds content.

## Constraint that shapes everything: what can we point at?

Today the only durable reference to a document is a `FileSystemFileHandle`
(`FileHandle` in `io/fileSystem.ts`), which is **structured-cloneable** — it can
be stored in IndexedDB and survives a reload, but *not* in `localStorage`
(where preferences live), because it is not JSON. Two consequences:

1. Recent files must live in IndexedDB, like recovery does.
2. A restored handle's permission drops back to `"prompt"`, so re-opening one
   must happen inside a user gesture (a click on the menu item — fine).

Non-Chromium browsers get no handle at all: opening there goes through
`<input type=file>` and saving through `io/download.ts`, so there is nothing to
remember. **Today the list is simply empty on those browsers.** That is not a
permanent hole — see the next section.

## Designing for cloud save

Cloud documents are coming, and they are exactly the case where a recent list
matters most (they work on Safari, on other devices, and never go missing).
So the list must **not** be defined in terms of file handles. Introduce a small
tagged union — `io/documentSource.ts`:

```ts
/** Where the current document lives, and how to read/write it again. */
export type DocumentSource =
  | { kind: "file"; handle: FileHandle }
  // Reserved; not implemented. Plain JSON, so it stores and syncs trivially.
  | { kind: "cloud"; docId: string; /* rev, workspace, … */ };

/** Stable identity for dedupe and display. */
export function sourceKey(s: DocumentSource): string;   // "cloud:<docId>" | "file:<name>"
export function sourceLabel(s: DocumentSource): string; // file name / cloud title
```

`file:` keys are only a *fast path* — two different files can share a name, so
file dedupe additionally confirms with `handle.isSameEntry()` (see below).
Cloud keys are exact.

`store/documentFileStore.ts` should grow into this union too (`source:
DocumentSource | null` replacing `handle`), so "which document am I editing"
has one answer regardless of backend. Do that rename **as part of this
feature** — it is small now (one store, `saveDocument.ts`, `openDocument.ts`)
and grows expensive later.

Consequences of the union for the rest of the design:

* The UI is gated on "list is non-empty", **never** on `supportsFileSystem()`.
  A Safari user with cloud documents gets a working Open Recent.
* The recent list stays **device-local** even for cloud documents. Syncing
  "recently opened" across devices is a separate, later decision; local-only is
  what every editor does by default and needs no server work.

## Storage

New database, `vinegar-files`, store `recent`, `keyPath: "id"`, plus an index
on `openedAt` (or just sort in memory — *N* ≤ 10). Deliberately **not** a new
store inside `vinegar-recovery`: that would need a `DB_VERSION` bump on the
database guarding unsaved work, and there is no upside.

`openDatabase` / `requestResult` / `transactionDone` in `io/recovery.ts` are
already generic; extract them to `io/idb.ts` and have both users import them.
Keep the injectable `IDBFactory` parameter — that is what makes
`tests/recovery.test.mjs` possible, and the same trick is wanted here.

```ts
export const RECENT_FORMAT_VERSION = 1 as const;
export const RECENT_LIMIT = 10;

export interface RecentEntry {
  id: string;                 // crypto.randomUUID()
  formatVersion: typeof RECENT_FORMAT_VERSION;
  source: DocumentSource;     // handle, or cloud ref
  /** Document name (`doc.metadata.name`) as of the last visit — what we show. */
  name: string;
  /** Secondary line: file name on disk, or cloud location. */
  detail: string;
  openedAt: string;           // ISO
}
```

Reads validate every entry and **drop malformed ones silently** (unlike
recovery, which reports: nothing is at stake here). A whole-store read failure
is likewise non-fatal — the list renders empty and the app carries on.

## Recording

One choke point already exists: `useDocumentFile.attach()` is called exactly
when a document becomes associated with a file (picker open, drop-with-handle,
Save As). Record from there, plus a *touch* on every successful `saveDocument()`
so plain Save keeps the entry at the top and picks up a renamed document.

```ts
// io/recentFiles.ts — fire-and-forget; never blocks or fails a save.
export function rememberRecent(source: DocumentSource, name: string): void;
```

All writes are `void`-returning and swallow errors into a `console.warn`. A
broken IndexedDB must never make Save fail.

Dedupe on write:

1. Read the list, partition by `sourceKey()`.
2. For `kind: "file"` candidates with a matching key, confirm with
   `await handle.isSameEntry(other)` (in parallel; treat a missing method as
   "same", matching the name-only fast path).
3. Reuse the matched entry's `id`, overwrite `name`/`detail`/`openedAt`.
4. Sort by `openedAt` desc, truncate to `RECENT_LIMIT`, write back in one
   `readwrite` transaction.

Documents saved through the download fallback record nothing — there is nothing
to point at. Correct, and it stops being the common case once cloud save lands.

## Opening

```ts
export async function openRecent(entry: RecentEntry): Promise<void>
```

1. `confirmDiscardCurrent()` — reuse the existing helper in `io/openDocument.ts`
   (export it).
2. Resolve the source to text:
   * `file` — `requestPermission({ mode: "read" })` if not already granted, then
     `handle.getFile()` → `.text()`.
   * `cloud` — fetch (later).
3. `loadDocumentText(text, handle)` — already attaches the handle so Save
   overwrites.
4. Touch the entry (it moves to the top).

**Permission mode: `read`, not `readwrite`.** This mirrors what
`showOpenFilePicker` grants, and `ensureWritePermission()` already upgrades
lazily on the first Save. The cost is a possible second prompt later; the
benefit is that browsing your history never asks for write access to files you
only wanted to look at.

Failure handling, both surfaced as toasts:

| failure | behaviour |
| --- | --- |
| file moved/deleted (`NotFoundError` from `getFile()`) | **remove the entry**, toast "… is no longer there" |
| permission denied | **keep** the entry, toast; the user may retry |
| parse error (old file version) | keep the entry; `loadDocumentText` already reports it |

## UI

`store/recentFilesStore.ts` — a zustand store mirroring the list in memory,
hydrated once at startup from an effect in `App.tsx` (next to the recovery
restore) and updated by every write in `io/recentFiles.ts`. The menu builders in
`ui/menus.ts` are synchronous, so they need a synchronous source of truth.

`fileMenu()` gains, right after `file.open`:

```
Open Recent  ▸  My sketch          my-sketch.vinegar.json
                Poster draft       poster.vinegar.json
                …
                ─────────
                Clear Recent
```

* The submenu is **omitted entirely when the list is empty** — a permanently
  disabled item teaches nothing.
* Entries are data-driven `MenuItem`s built from the store, not registered
  commands (the registry is a static array; per-entry commands would fight it).
* `MenuItem` has no secondary-text slot today; either extend it with an optional
  `hint`, or render `name` only and put the file name in `title`. Prefer the
  `hint` field — the layers/context menus will want it eventually.

Registered commands (these *are* static, so they get palette entries):

| id | label | notes |
| --- | --- | --- |
| `file.openRecent` | Reopen last document | opens entry 0; disabled when empty |
| `file.clearRecent` | Clear Recent | confirm first; clears store + IndexedDB |

No shortcut for either: `Cmd+Shift+O` is unmistakably wanted but is taken by
Save As.

## Preferences and privacy

Add to `PreferencesV1` (bumping `PREFERENCES_VERSION` is unnecessary — the
parser fills absent groups with defaults, same as any additive field; confirm
against `preferences/model.ts` when implementing):

```ts
files: { recentEnabled: boolean };   // default true
```

Disabled ⇒ nothing is recorded, the submenu is hidden, and toggling it off
clears the stored list immediately, exactly as `recovery.enabled` does with
`clearDocumentRecovery()`. The Preferences dialog gets the toggle plus a
"Clear list" button in a new *Files* section.

## Tests — `tests/recentFiles.test.mjs`

Same shape as `recovery.test.mjs`: load the module through the Vite SSR server
and pass a fake `IDBFactory`. Fake handles are plain objects with `name`,
`getFile`, and `isSameEntry`; a fake factory only needs get-all/put/delete
against a `Map`, so hand-roll it rather than adding a dependency.

Cases: MRU ordering; cap at `RECENT_LIMIT`; dedupe of the same handle under a
changed document name; two *different* files sharing a name stay separate
(`isSameEntry` false); malformed rows pruned on read; `NotFoundError` on open
removes the entry; recording is a no-op when `recentEnabled` is false; a cloud
source round-trips (constructed by hand — no backend needed).

## Phases

1. **Core** — `io/idb.ts` extraction, `DocumentSource`, storage, record/open,
   File ▸ Open Recent, clear command, preference, tests.
2. **Polish** — thumbnails (a small PNG `Blob` from `exportPng`, written on
   save; IndexedDB stores Blobs directly), a start screen for an empty
   document, pinning.
3. **Cloud** — the `cloud` variant lights up the same list on every browser;
   optionally reconcile server-side "recently edited" with the local list.

Deferred deliberately: cross-device sync of the list, and per-entry
"reveal in folder" (no such API).
