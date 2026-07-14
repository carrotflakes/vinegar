# Undo history

Undo history records persisted `Document` changes. Selection, viewport, tool
state and other editor-only values are not part of an undo entry.

## Update boundaries

Document writes fall into three categories:

1. Regular undoable commands construct a new `Document` and commit it through
   `transact(next, coalesceKey?)`.
2. Pointer interactions call `beginInteraction`, publish immutable intermediate
   documents through `applyShapes` or `setDoc`, and finish with exactly one
   `endInteraction` or `cancelInteraction` call.
3. Automatic or preference-driven writes may deliberately bypass history. The
   current cases are text-bound remeasurement and the document grid setting.
   They use `replaceDocumentWithoutHistory`; new bypasses should be rare and
   documented here because each one needs an explicit policy across undo,
   redo and active interactions.

Document lifecycle operations (`newDocument`, `loadDocument` and
`recoverDocument`) reset both history stacks instead of creating entries.
Undo or redo during an interaction first cancels that interaction and stops.
A regular transaction during an interaction terminates the gesture and records
the gesture and command as separate linear entries. Later pointer updates are
ignored because their interaction boundary is no longer active.

## Immutability contract

History entries retain changed values by shared reference. Code must not mutate
a document, node, symbol, artboard, asset or nested value after it has been put
in the editor Store. A change replaces every affected object or array on the
path to the root while retaining references to unchanged values.

This is already the convention used by the Store slices. It is also a required
precondition for efficient patch generation: identity equality can skip
unchanged branches without scanning their geometry or image data.

Deep copies remain appropriate where an independent mutable payload is needed,
such as clipboard duplication. Dirty checks go through `hasUnsavedChanges` and
compare document revisions; recovered work has no saved revision until the user
saves it explicitly.

## Patch representation

Each history entry contains forward and inverse patches plus unique revision
ids for its endpoints:

```typescript
interface HistoryEntry {
  patches: DocumentPatch[];
  inversePatches: DocumentPatch[];
  beforeRevision: number;
  afterRevision: number;
}
```

Map-like fields (`nodes`, `symbols`, `assets` and `extensions`) are patched by
key. `rootIds` and `artboards` use a single changed-range splice. Small
`settings` and `metadata` objects are replaced atomically. Values are retained
by immutable reference, so unchanged geometry, image data and extension values
never enter an entry.

The existing `transact(next, coalesceKey?)` action API remains unchanged. With
that API, diffing a changed map still requires a shallow key scan; avoiding that
scan later would require actions to provide changed-key hints or patches.

## History behavior

History preserves these observable rules:

- a regular transaction creates one undo step and clears redo history;
- equal coalesce keys within the coalescing window represent one net change;
- an interaction stores only its start-to-finish change, never pointer-move
  intermediates;
- cancel restores the interaction start without creating history;
- undo and redo keep selection, symbol-edit and artboard state valid for the
  resulting document;
- returning to the manually saved revision is clean, while recovered work
  remains dirty;
- history limits trim complete entries from the same ends as today.

Coalescing keeps one transient base document and repeatedly replaces the last
entry with the net base-to-current patches. The base is released when the 600ms
window closes or another history boundary is reached, so intermediate slider
values are not retained.

Document maintenance performed through `replaceDocumentWithoutHistory` gets a
separate maintenance revision and is not added to either history stack. Undo
and redo therefore preserve disjoint maintenance changes such as the document
grid. Disjoint maintenance during a pointer interaction is also applied to the
interaction baseline, so it neither terminates the gesture nor becomes part of
its undo entry. Maintenance that touches the same patch target is included in
the interaction instead and is cancelled with it. Because scene nodes are
atomic patch values, an automatic text remeasurement can still be superseded by
undoing a patch to that same text node; the saved-document check keeps dirty
state accurate if this happens. Finer node-field patches would be a separate
change.
