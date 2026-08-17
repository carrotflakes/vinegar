# Focus mode (isolation editing)

Status: **shipped.** Session state only — no file-format impact. Everything here
describes current behaviour, though parts of the "State model" and "Model
helpers" sections are still phrased as the migration that produced them.
Related: [symbols.md](symbols.md) — focus is how a symbol definition is edited.

## What it is

Focus mode lets the user isolate one container node — a **frame**, a **group**,
or a **symbol definition** — and edit only its content. Everything outside the
focused container disappears from the canvas entirely (Affinity-style isolation,
not Illustrator's dimming). It is a strict generalization of the existing symbol
edit mode: symbol editing becomes "focus on the symbol's definition root", and
the two modes are unified into one mechanism with one breadcrumb, one stack and
one set of scope rules.

Focus is **session state only** — nothing is persisted, so the file format is
untouched.

## UX

- **Enter**: `Cmd/Ctrl+Enter` with a single frame or group selected focuses it.
  With a symbol instance selected, it enters the instance's symbol definition
  through that instance (`enterSymbolInstance`). Also available from the
  context menu and the command palette ("Focus on selection"). Double-clicking
  an instance keeps entering its definition, as it does today; double-clicking
  a group keeps meaning drill (`activeGroupId`), *not* focus.
- **Exit**: `Esc` pops one focus level when the canvas is idle (no drag in
  progress, no pen draft — both already consume Esc first, see
  `useCanvasKeyboard.ts`). The breadcrumb pops to any level directly.
- **Nesting**: the stack allows focus-within-focus, e.g. focusing a group
  inside a symbol definition. The breadcrumb shows the whole path
  (`Document › Button › icon group`).
- **Coordinates**: focused content renders **in place**, at its world position.
  The viewport does not jump on enter/exit; rulers, guides, grid and
  `activeFrameId` keep meaning what they meant. (Symbol definitions live
  outside the scene at their own coordinates, so their behaviour is unchanged.)
- **What disappears**: everything not inside the focused container — other
  art, other frames, frame labels. Document guides stay visible.
- New shapes (draw tools, paste, place image, brush, generators) land inside
  the focused container, at the world position they were drawn at.
- **Frames cannot be created inside a focus scope** (`onFrameDown`, `addFrame`
  both refuse): frames are only legal at the top level, so one created here
  would land outside the view that created it.

## State model

`src/store/state.ts`:

```ts
// replaces: editingSymbols: string[]  (symbol ids)
/** Focus stack (isolation editing); entries are container node ids.
 *  A symbol being edited is represented by its definition root group. */
focusStack: string[];
```

```ts
// replaces currentSymbolScope(s): string | null  (symbol id)
/** Innermost focused container node id, or null for the whole scene. */
export function currentFocusRoot(s: Pick<EditorData, "focusStack">): string | null;
```

The scope value that flows through the codebase changes meaning from
"symbol id | null" to "**scope root node id** | null". This is a simplification:
today every consumer immediately resolves the symbol id through
`scopeRootGroupId`; with node-id scopes that resolution step disappears.

`activeGroupId` (drill) resets whenever the focus stack changes, exactly as it
does today on symbol scope changes.

**Migration hazard**: the scope's type stays `string | null` while its meaning
changes from symbol id to node id, so **typecheck cannot catch a missed call
site** — a leftover `doc.symbols[scope]` would fail silently. The migration is
therefore driven by renames, not types: delete `currentSymbolScope` and
`scopeRootGroupId` outright and introduce new names (`currentFocusRoot`,
scope-as-node-id helpers). Every stale reference then becomes a compile error,
and the error list is the migration checklist. Do not keep compatibility
aliases.

## Model helpers (`src/model/scene.ts`)

- `scopeRootGroupId(doc, scope)` — delete. The scope *is* the root node id;
  callers use the scope value directly (null = scene).
- `scopeLeafIds(doc, scope)` — reimplement using the `ancestors` map that
  `sceneIndex` already builds: for a non-null scope, a paintable leaf is in
  scope iff `ancestors.get(id)` contains the scope root (works uniformly for
  in-scene containers and symbol definition roots). For a null scope keep the
  current `owner.get(id) === null` filter so other definitions' content stays
  excluded.
- `scopeRootIds(doc, scope)` — `null` → `doc.rootIds`, else the container's
  `childIds`.
- New: `enclosingSymbolId(doc, nodeId): string | null` — the symbol whose
  definition contains `nodeId` (reverse lookup via the `owner` map, plus the
  def-root itself). Needed because `wouldCreateSymbolCycle` and the
  SymbolsPanel's cycle guard take a symbol id: when focused on a group *inside*
  a definition, placing an instance must still be cycle-checked against that
  symbol.

## Store (`src/store/`)

- `symbolSlice.ts` → the enter/exit actions move to focus semantics:
  - `enterFocus(nodeId)` — validates: node exists, is a frame/group, is not
    hidden/locked, is not already on the stack, and is a descendant of the
    current focus root (you can only focus deeper, not sideways).
  - `exitFocus()` / `exitFocusTo(depth)` — today's `exitSymbolEdit(To)`.
  - `enterSymbolInstance(instanceId)` follows a visible, unlocked instance in
    the current scope and pushes its definition root. This is the only way a
    symbol definition extends an existing focus path.
  - `enterSymbolEdit(symbolId)` opens a definition directly from SymbolsPanel.
    It replaces the stack with that definition root; an unrelated definition is
    navigation, not imaginary nesting.
  All clear `activeGroupId`, `selection` and transient state, as today.
- `appendToScope` (`docOps.ts`) — parent is now the scope value itself.
  **Coordinate conversion required**: today's append targets (scene root,
  definition root) are effectively identity, so new shapes are created with
  world-space transforms and it works out. A focused nested group generally has
  a non-identity world matrix, so every add path — pen, brush, place image,
  paste, generators (`shapeSlice`, `clipboardSlice`) — must premultiply new
  nodes by `inverse(parentWorldMatrix(focusRoot))` or the content lands in the
  wrong place the moment it is created. Do this once inside `appendToScope`
  (take the world-space payload, reparent into scope coordinates) rather than
  at each call site. It returns `null` when the scope cannot be inverted, and
  callers must not transact or select the unattached payload in that case.
- `historySlice.ts` `restoredEditorState` — validate the stack against the
  restored doc: keep the longest valid prefix. Ordinary entries must descend
  from the previous root; a definition-root entry must still be referenced by
  a visible, unlocked instance in the previous scope. Selection and
  `activeGroupId` are then restricted to the restored innermost scope.
- `clipboardSlice`, `shapeSlice`, `selectionSlice`, `structureSlice` consume the
  scope through the helpers above.

### Coordinates when adding content

Every add path builds its nodes in **world space** — tools work from world
pointer coordinates, and clipboard payload roots carry world transforms — so
`appendToScope` bakes the scope container's inverse world matrix into each
appended root. Without it, anything drawn inside a moved container would jump by
that container's transform the instant it was committed. Scene roots and symbol
definition roots are identity, so this is a no-op for them.

Two paths bypass `appendToScope` and do the same conversion themselves, because
they append somewhere other than the scope root: `addFillShape` (parents under
the clicked cover shape) and `addBrushStroke` (parents under the drilled-into
`activeGroupId`). Any future code that parents world-space geometry under an
arbitrary container has to do this too.

## Rendering (`canvas/paint.ts`, `canvas/render/scene.ts`)

`paint.ts` passes `rootIds: [focusRoot]` to `renderScene`. Root nodes carry only
a *parent-relative* transform, so painting a nested container from the plain
world context would drop its ancestors' matrices and the art would jump. The fix
is one option, `rootBaseMatrix`: the focus root's parent world matrix
(`nodeWorldMatrix(doc, parentIdOf(doc, focusRoot))`), applied to the context
around the root loop.

This stays **in place** — the focused subtree paints at its true world position
— which is what makes the rest of the pipeline need no changes at all:

- Culling and layer sizing (`render/bounds.ts`) already work in real world
  space via `sceneIndex`, so they agree with what is drawn.
- Picking, hit-testing and snapping likewise read world matrices from
  `sceneIndex`, so their coordinates agree with rendering. Point and marquee
  hit-testing stop ancestor-mask traversal at the focus root: clipping owned by
  the focused subtree remains active, while clipping outside it is ignored just
  as it is by focused rendering. Frame borders (`pickFrameBorder`) take the
  scope too — frames are top-level only, so inside any focus scope none of them
  is grabbable, including the focused frame itself.
- Guides, rulers, the grid and `activeFrameId` keep meaning what they meant,
  because the world origin never moves.
- Export is unaffected: it renders the whole scene and never sets the option.

Symbol definition roots have no parent, so their base matrix is identity and
their rendering is bit-for-bit what it was before focus existed.

The rejected alternative was **re-rooting** — handing the renderer a document
where the focus root is promoted to a root with an identity transform, the way
symbol definitions already sit in `sceneIndex`. It needs no renderer change at
all, but it moves the world origin, which costs: a `doc` vs `viewDoc` split
across the ~20 files that consume world matrices (a `Document`-vs-`Document`
mix-up the compiler cannot catch, whose failure mode is silently misplaced
geometry); guides/rulers/grid becoming meaningless inside focus; and no way to
keep the view from jumping, since `Viewport` has only scale/rotation/offset/flip
and cannot absorb a container's skew or non-uniform scale. In-place was measured
to cost one matrix multiply in `renderScene`, so it won on both counts.

The preview shape (a rubber-band draw in progress) is painted *outside* the base
matrix: tools build preview geometry in world space, so it must not be shifted
by the focus root. Committing it converts it — see below — which is what makes
the preview and the committed shape land in the same place.

Frame chrome (labels, background) for non-focused frames is skipped because
they are simply not in `rootIds`; when the focus root is itself a frame it
paints as usual.

## Commands (`src/commands/registry.ts`)

- `focus.enter` — "Focus on selection", `Cmd/Ctrl+Enter`. Enabled when the
  selection is exactly one frame/group (→ `enterFocus`) or one instance
  (→ `enterSymbolInstance`).
- `focus.exit` — "Exit focus", palette/menu only (no key of its own). Esc is
  handled in `App.tsx`'s keydown, which already orders the escapes: clear
  selection → exit drill (`activeGroupId`) → exit focus, and returns before the
  command layer. Pen draft and interaction cancels stop the same keyboard event
  before it reaches that handler, so one Esc performs exactly one action.
- Frame creation refuses inside a focus scope, in both `addFrame` (the command)
  and `onFrameDown` (the tool drag).
- The context menu offers `focus.enter`, except for a symbol instance where
  `symbol.editSelected` ("Edit symbol") is the clearer label for the same act.

## Breadcrumb (`canvas/FocusBreadcrumb.tsx`)

Crumbs walk `focusStack`; each entry shows the symbol name + symbol icon when
the node is a definition root (via `enclosingSymbolId`), else the node's name
with a frame/group icon. Clicking a crumb calls `exitFocusTo`.

## Panels

- **LayersPanel** shows the subtree under the focus root (`scopeRootIds`), and
  a drop at the panel root targets the focused container. Its scope bar names
  the container the same way the breadcrumb does.
- **SymbolsPanel** opens a definition directly via `enterSymbolEdit`, replacing
  any unrelated focus path; its "editing" highlight
  compares `enclosingSymbolId(doc, currentFocusRoot(s))` against the row.

## Edge cases / invariants

- `sceneValidation` is untouched: focus is view state, never persisted.
- Deleting/undoing away the focus root → stack truncation in
  `restoredEditorState` (see above).
- A locked or hidden container cannot be entered, and `validFocusPrefix` drops
  one that *became* hidden or locked (undo, file load) — standing inside a
  hidden container shows an empty canvas, and inside a locked one nothing is
  selectable.
- `enterFocus` also requires the target to sit in the same symbol as the
  current scope (`enclosingSymbolId` equality), which is what the ancestor
  check cannot express from the scene scope: a definition's content is only
  ever reachable through its symbol.
- `enterFocus` only ever goes **deeper** through the scene tree.
  `enterSymbolInstance` crosses into a definition only through an actual
  instance in the current scope. The stack is therefore a real editing path;
  opening an arbitrary definition from SymbolsPanel starts a new path instead.
- Compound paths are **not** focusable (node-level editing already covers
  them); `enterFocus` accepts groups and frames only. Revisit if needed.
- Cycle guard: placing instances while focused inside a definition checks
  `wouldCreateSymbolCycle(doc, enclosingSymbolId(doc, focusRoot), ...)`.
- Reparent-on-drag (`selectTool.ts:207`) currently only runs at scene scope
  (`scope === null`); keep that check as "scope is null", i.e. no cross-frame
  reparenting while focused — content cannot leave the focused container.

## Out of scope (v1)

- Dimming/ghosting the surrounding context instead of hiding it.
- Zoom-to-fit on enter.
- Focusing compound paths.
- Any persistence of the focus state.
