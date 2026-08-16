# Pen and touch

On a tablet the canvas receives two very different kinds of contact through the
same Pointer Events, and they mean different things. Vinegar splits them by
role, the way iPad painting apps have taught people to expect:

| Contact | Role |
| --- | --- |
| Pen (`pointerType === "pen"`) | Draws and edits — the content device |
| One finger | Navigates: pans, or drives the tool when finger drawing is on |
| Two fingers | Pinch zoom / twist / pan; **tap = undo** |
| Three fingers | **Tap = redo** |
| Mouse | Unchanged desktop behaviour |

The *policy* — what a contact means — lives in `src/canvas/inputRouting.ts` as
pure functions (`routeContact`, `judgeTap`), so it can be read and tested
without a DOM (`tests/inputRouting.test.mjs`). The *mechanics* — capture,
bookkeeping, dispatch — live in `src/canvas/hooks/usePointerHandlers.ts`, with
the tap run in `useTouchTapGesture.ts` and the pinch in `useCanvasGestures.ts`.
Put new rules in `inputRouting.ts` and let the hook ask.

Tool modules never see `pointerType`: by the time a tool is called, the contact
has already been accepted, rejected or rerouted.

## One contact owns an interaction

An interaction belongs to the pointer that started it. On a tablet a palm, a
second finger and a hovering pen all deliver events into a live drag, and none
of them may steer or end it — so `usePointerHandlers` records the owning
pointer at `pointerdown` (interactions only ever begin there) and drops
`pointermove`/`pointerup`/`pointercancel` from anyone else. Interaction
variants therefore carry no pointer id of their own; ownership is not a
per-tool concern.

## Finger drawing is a preference that turns itself off

`canvas.fingerDrawing` (Preferences → Canvas & Editing) decides whether a bare finger may
paint with the brush, pencil or eraser. It starts **on**, so a device with no
stylus is usable out of the box, and turns **off by itself the first time a pen
contact is seen** — `notePenInput()` in `src/store/preferencesStore.ts`, guarded
by `canvas.penDetected` so it happens exactly once ever and a manual re-enable
is never overridden. The switch raises a toast, because silent mode changes are
worse than the problem they solve.

The switch is also on the canvas: the touch **modifier bar** grows a `Finger`
toggle while a painting tool is active, because the state is otherwise
invisible ("why does my finger not draw any more?") and is worth flipping
mid-drawing, which a trip to Preferences is not.

With it off, a one-finger drag on those tools becomes a **pan** instead of doing
nothing: in pen mode the finger is a navigation device, and making it inert
would just feel broken. Other tools (select, node, shapes, text, frame, bucket)
are unaffected — the setting is about strokes, not about all touch input.

## Palm rejection

A hand resting on the glass while the pen draws produces real touch contacts.
Two rules keep them out:

- **While the pen is down**, every touch `pointerdown` is rejected outright.
- **For `PEN_COOLDOWN_MS` (300 ms) after the pen lifts**, touch is still
  rejected — a palm leaves the glass a moment after the tip does, and that
  trailing contact would otherwise pan the canvas out from under the stroke that
  just ended.

Rejected pointer ids are remembered in a set, because a rejected contact keeps
delivering `pointermove`/`pointerup` (implicit pointer capture) and those events
must not reach a tool either. Conversely a **pen contact outranks whatever the
hand already started**: pen-down cancels a live pinch and any touch-driven drag
rather than trying to arbitrate between them.

The cooldown deliberately does *not* block the undo/redo taps — see below.

## Two- and three-finger taps

A tap "run" starts at the first touch and is judged when the last contact
lifts: it fires undo (two fingers) or redo (three) if every contact stayed
within 16 px and the whole run finished inside 300 ms. The run counts its own
contacts rather than reading the pinch handler's pointer map, so it stays
coherent for contacts the palm filter held back.

Two details make it coexist with the pinch, which begins on the second touch
long before we know whether this is a tap:

- A real pinch travels far enough to disqualify itself, and any viewport drift a
  near-still pinch applied is rolled back from the snapshot taken at the start
  of the run.
- A fired tap consumes the release, and cancels anything still in flight, so no
  tool sees the lift as the end of a drag.

Contacts rejected by the **cooldown** are still fed to the tap tracker (those
rejected while the pen is actually down are not, and reset the run). Without
that, "draw a bad stroke, immediately two-finger undo" — the most common pair of
actions in a painting app — would be swallowed by palm rejection.

A live **pen draft** claims the two-finger undo before the document's history
sees it (`undoOverride` in `useTouchTapGesture.ts`), so the gesture steps back
one anchor — the same thing ⌘Z means while a draft is open. Without that, the
finger and the keyboard would disagree: one would drop an anchor, the other
would rewind an unrelated earlier edit.

A tap that lands on an empty history stack says so ("Nothing to undo") rather
than doing nothing: silence reads as a gesture that failed to register. The
gestures themselves are advertised in the status-bar hint on coarse pointers,
and in the toast raised when a pen is first detected — nothing else on screen
suggests they exist.

## Why a second finger never gets rejected mid-stroke

A finger-drawn stroke does **not** reject the next finger. That second contact
is the only way a touch-only user can pinch or tap out of the brush tool, since
the first finger starts painting immediately: it promotes to a gesture, which
discards the stroke in progress. Only pen ownership rejects touch.

## Hover

Pens and mice report hover; fingers do not. The brush/eraser tip outline
(`drawBrushCursor` in `overlay.ts`, fed by `ToolContext.brushHover`) follows
both — the size is in world units, so how thick a stroke lands depends on the
zoom, and the ring is the only way to know before drawing. Touch simply never
sets it, so it needs no touch-side teardown. Treat hover affordances as
pen-and-mouse-only in general.

Do not confuse the hover rings with a drag's own state: `endpointHint` is the
hover affordance ("start here to continue that open path"), while `closeHint`
belongs to the live freehand stroke ("release here and it closes"). They draw
as the same ring on purpose — it means the path connects at that point — but
they are separate refs, so a pointer that leaves the canvas mid-stroke clears
the hover chrome without touching the promise the drag is still making.

## Pressure

`e.pressure` is only meaningful for `pointerType === "pen"`. Mouse and touch
report a constant 0.5, which would silently thin every stroke, so both are
mapped to full pressure (`1`) at the call site. Fast strokes drain
`getCoalescedEvents()` so sample density survives; see
[brush-strokes.md](brush-strokes.md).

## Modifiers reach beyond the canvas

Touch has no modifier keys, so `inputStore` carries sticky on-screen Shift/Alt
toggles (`ModifierBar`, shown only on coarse pointers) and every reader goes
through `readModifiers(event)` — the physical key OR the toggle.

The Layers panel reads it too: with the on-screen Shift on, tapping a row takes
a contiguous range from the last one, the same as Shift+click. Ctrl/Cmd+click
has no such shared toggle, so the panel carries its own **multi-select** button
in its title bar: while it is on, a plain tap adds or removes that row.

Both are buttons rather than gestures because the list has no gesture budget
left — tap selects, long-press drags, a vertical swipe scrolls, and a rightward
swipe opens the row's context menu (touch has no right-click; see
[drag-and-drop.md](drag-and-drop.md)). Any further touch-only affordance in the
list should be a control too.

## Not implemented

- **Apple Pencil double-tap / squeeze**: no web API exposes it. The multi-finger
  taps above are the substitute.
- **Barrel-button and eraser-end (`pointerType === "pen"` with `button` 5 /
  inverted tip)**: no special handling yet.
