# Symbols (reusable components)

Status: **shipped (v1).** Definitions, instances, local-view editing, detach.
No per-instance overrides — that is the next step, and the reason the model
below keeps instances deliberately field-free. Related:
[focus.md](focus.md) (editing a definition *is* focus on its root group),
[../document-model.md](../document-model.md),
[../reference/scene-traversal.md](../reference/scene-traversal.md),
[parameters.md](parameters.md) (the intended route to parametrized instances).

## The model

Three pieces, all in `src/model/types.ts`:

| Piece | Where it lives | What it is |
| --- | --- | --- |
| `SymbolDef` | `doc.symbols[id]` | `{ id, name, rootNodeId }` — a name plus a pointer |
| definition content | `doc.nodes`, **outside `rootIds`** | an ordinary `Group` subtree, reachable only through the def |
| `SymbolInstance` | an ordinary scene node | `{ type: "instance", symbolId }` on top of `BaseNode` |

The key decision: **a definition is not a separate document, it is a subtree of
the same `nodes` map that nothing owns.** Every scene helper, the Scene Index,
copy/paste id remapping and `validateTree` therefore work on definition content
unchanged; the only thing that distinguishes it is that no `rootIds` entry and
no `childIds` list contains its root. This is the same trick compound paths gave
up on at v22 (see [../document-model.md](../document-model.md)): hierarchy stays
in one place.

An instance adds **no fields beyond `BaseNode`** — transform, opacity,
blend mode, effects, hidden, locked. There is no override map, no per-instance
colour, no swapped text. An instance is a transform plus a pointer, and that is
what makes "edit the definition, every instance follows" free.

### Invariants

- Every `SymbolDef.rootNodeId` resolves to a `group` in `doc.nodes`
  (`serialize.ts`: *"Symbol has no root group"*).
- Every instance's `symbolId` resolves to a definition (*"Instance references
  missing symbol"*).
- **The symbol reference graph is acyclic.** A definition may contain instances
  of *other* symbols, but never a path back to itself. `serialize.ts` walks it
  with a colour-marked DFS on load; `wouldCreateSymbolCycle` (`model/scene.ts`)
  rejects the edit that would create one.
- Frames are never inside a definition — frames are top-level only, so
  "put a frame in a symbol" is refused along with grouping and clipping one.
- Definition content is not in `rootIds`, so it is never painted directly; it
  only ever appears through an instance or while focused.

## Reading through an instance

Readers do **not** switch on `type === "instance"`. `containerContents` in
`model/sceneWalk.ts` answers "what is inside this node" for groups, frames and
instances alike, and for an instance returns the definition root plus the
`symbolId` to push:

```ts
if (isInstance(node)) {
  if (activeSymbols?.has(node.symbolId)) return null;   // cycle cutoff
  const definition = doc.symbols[node.symbolId];
  if (!definition) return null;                          // dangling ref
  return { kind: "instance", childIds: [definition.rootNodeId], symbolId };
}
```

The `activeSymbols` set is the caller's expansion stack and **maintaining it is
the reader's job** — add `symbolId` before descending, remove it after. A reader
that forgets recurses forever on a cyclic document. The renderer
(`canvas/render/scene.ts`), both render-bounds passes and the SVG exporter
(`io/exportSvg.ts`, where instances expand inline rather than becoming
`<use>`) all do this. See
[../reference/scene-traversal.md](../reference/scene-traversal.md).

Hit-testing and bounds deliberately opt out of that descent and work from a
flattened leaf list instead:

- `symbolLeafIds(doc, symbolId)` — the definition's paintable leaves, owner-based.
- `symbolContentBounds(doc, symbolId, seen)` / `instanceWorldBounds` — the
  definition's box, then through the instance's world matrix. `seen` is the
  same cycle guard in bounds clothing.

An instance is **atomic to picking**: a click inside it selects the instance,
never a leaf within the definition. Marquee selection maps the region into
symbol space as the AABB of the transformed quad, so a rotated instance can
over-select slightly.

## Operations (`src/store/symbolSlice.ts`)

| Action | Rule |
| --- | --- |
| `createSymbolFromSelection` | Selection roots must share one parent. Members keep their local transforms; the definition root and the new instance are both identity, so the drawing does not move. The instance lands at the frontmost member's slot. |
| `placeSymbolInstance(id, at?)` | Appends into the current focus scope. Cycle-checked against `enclosingSymbolId(doc, scope)` — not against the scene — because nesting is only illegal relative to the symbol being edited. With a point, centers the definition's content bounds on it. |
| `detachSelectedInstances` | Replaces the instance with a real `Group` holding a deep copy (`remapPayload` for fresh ids), inheriting the instance's transform, origin, opacity, blend mode, hidden and locked. Effects on the instance or the definition root are dropped — the user is told via `notifyEffectsRemoved`. |
| `renameSymbol` | Renames the def only; the root group's name is not kept in sync. |
| `deleteSymbol` | Refused while any instance exists, and refused while the focus stack stands inside the definition. Deletes the root and its whole subtree. |

Entering a definition is `enterSymbolInstance` (follow an instance edge, extends
the focus path) or `enterSymbolEdit` (open a definition from the panel —
*replaces* the stack, because an unrelated definition is navigation, not
nesting). Both are focus-stack operations; see [focus.md](focus.md).

## UI

The Symbols panel (`src/ui/panels/symbols/SymbolsPanel.tsx`) lists definitions:
`+` places an instance, a row can be dragged onto the canvas, and the row of the
definition currently being edited is highlighted. Properties shows a
`SymbolInstanceSection` for a selected instance. Layers shows an instance as one
atomic row — the definition's content is not a subtree of it.

## Interop

Copy/paste inside the app carries the in-memory node payload, so instances
survive with their definitions. Pasting into a document that lacks the symbol
cannot keep the instance, and the paste **falls back to the SVG mirror** —
flattened geometry rather than a dangling reference. SVG export expands each
instance inline (no `<use>`), which is why a document full of instances exports
larger than it looks.

## Not done yet

- **Per-instance overrides** — the point of the field-free instance is that
  overrides get designed once, deliberately. The likely shape is document
  parameters (see [parameters.md](parameters.md)) bound per instance rather than
  an arbitrary override map.
- **Nine-slice / responsive resize** of an instance.
- **`<use>`-based SVG export**, which needs `<symbol>` defs and a decision about
  how effects and clipping interact with them.
- **Renaming the definition root group with the symbol.**
