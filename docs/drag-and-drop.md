# Drag and drop

All in-app dragging is pointer-based, not HTML5 drag-and-drop. Native DnD
(`draggable` + `dragstart`/`dragover`/`drop`) never fires from touch input, so
every draggable surface — reordering lists and dragging library items onto the
canvas alike — is built on Pointer Events instead. The only remaining native
`onDrop` is the canvas handler for files dropped from the operating system.

Two hooks cover the two shapes of drag. Reach for one of them before adding a
new draggable surface; do not reintroduce `draggable`.

## `useTouchDrag` — reordering and in-panel drags

`src/ui/useTouchDrag.ts` drives drags whose drop targets live in the DOM: the
Dock tabs, and the Layers, Artboards, Assets and Symbols rows. It returns a
`startDrag(event, payload)` to wire to a draggable element's `onPointerDown`;
the `payload` is threaded back to every callback so one hook instance serves a
whole list.

Activation differs by input so a drag never steals a scroll:

- **Mouse** starts once the pointer moves past a small threshold, leaving a
  plain click free to select.
- **Touch** starts on a **long-press** (~250 ms held roughly still). A quick
  swipe stays a list scroll; panning away before the timer elapses hands the
  gesture back to the browser. While a touch drag is live the hook blocks native
  scrolling with a non-passive `touchmove` listener.

Drop targets are hit-tested from the element under the pointer
(`document.elementFromPoint` → `closest('[data-…]')`), not from per-element
`dragover` handlers. So a new drop zone must:

- expose its identity through `data-*` attributes the `onMove` callback reads
  (e.g. `data-row-index`, `data-dock-tabs`), and
- **not** set `pointer-events: none`, or `elementFromPoint` skips it.

After a drag the hook swallows the browser's trailing synthetic `click` (a short
window), so dropping a row does not also fire its select/activate handler. Pass
`capture: true` to capture the pointer on the origin element once dragging, which
keeps elements the pointer merely passes over (notably the canvas) from
receiving stray pointer events; `elementFromPoint` hit-testing is unaffected by
capture.

## `usePanelCanvasDrag` — library item onto the canvas

`src/ui/usePanelCanvasDrag.ts` wraps `useTouchDrag` (with `capture: true`) for
dragging an asset or symbol out of a panel and dropping it onto the drawing.
Because there is no native drag image, it appends a floating **ghost** to
`document.body` that follows the pointer, and on release over the canvas it
computes the world-space drop point with `canvasDropPlacement(clientX, clientY)`
from `src/canvas/canvasDrag.ts`. A release anywhere else is ignored.

## Simple pointer drags are not DnD

Gestures that only move a value or an edge — the divider resize in the Dock, the
scrub gesture in `ScrubbableNumber` — are plain Pointer Event handlers, not a
drag-and-drop concern, and need no hook. They start immediately (no long-press),
so give them `touch-action: none` to own the gesture and handle `pointercancel`
to reset. This is the opposite of a reorderable **list**, whose rows keep
`touch-action: auto` so the list still scrolls until a long-press begins a drag.

## Conventions

- New draggable UI uses one of the two hooks above; never `draggable` / native
  DnD (it is touch-dead).
- Immediate-drag elements: `touch-action: none` + handle `onPointerCancel`.
  Scrollable lists that also reorder: keep `touch-action: auto`, rely on the
  long-press.
- Do not add `preventDefault` in drag handlers — tap-to-select and
  double-tap-to-rename must keep working.
- Drop zones need `data-*` identity and must not be `pointer-events: none`.
