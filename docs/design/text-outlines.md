# Text outlines

Status: shipped — bundled fonts, glyph geometry for live text, and "Convert to
path" on a text node. No file format change: a text node is unchanged, and an
outlined one is an ordinary `path`. Related: [effects.md](effects.md),
[bucket-fill.md](bucket-fill.md), [../architecture.md](../architecture.md).

## Why fonts had to be bundled first

The browser gives no way to read glyph outlines back out of `fillText`, and a
system font's binary is not readable either (the Local Font Access API is
Chromium-desktop-only and needs a permission prompt). So the only way text can
have geometry is to ship the font file and parse it ourselves.

That is also why the catalogue in `src/fonts.ts` is the pivot of the feature.
Every family listed there is one of two kinds:

| | source | outlines | measured / painted with |
| --- | --- | --- | --- |
| **bundled** | a WOFF in `public/fonts/`, registered as an `@font-face` by `fontFaces.ts` and parsed by `fontCache.ts` | yes | the same file, so the two cannot disagree |
| **system** | a CSS stack only | no | whatever the browser resolves |

The system stacks stay in the list, and a `fontFamily` naming one keeps working
exactly as before — it simply has no geometry. Arimo, Tinos, Cousine and Gelasio
are metric-compatible with Arial, Times New Roman, Courier New and Georgia, so a
document can move onto an outlineable family without relaying out.

`public/fonts/LICENSES.md` records the licence of every bundled file (all SIL
OFL 1.1 or Apache 2.0, both of which allow bundling and embedding).

Noto Sans JP is bundled but deliberately **not** precached by the service worker
(`FontOption.precached: false`, matched by `globIgnores` in `vite.config.ts`):
1.4 MB per weight is too much to push into every install, so it is fetched on
first use and is the one family that needs the network before it can be
outlined.

## Loading is asynchronous, geometry is not

Painting is synchronous, so `fontCache.ts` is shaped exactly like
`imageCache.ts`: it answers from memory, starts a background fetch on a miss,
and notifies subscribers when the font arrives. `textSubpaths` therefore
returns `null` a lot, and **null is never an error** — every consumer keeps the
behaviour it had before text had geometry:

- a system font, or one still loading,
- an italic shape in a family that ships no italic face — the browser
  synthesises the slant, and a sheared outline would not be the same shape,
- a character the font has no glyph for, where painting falls back to a system
  font we cannot read (this is what stops a Japanese string in Inter from
  outlining half its characters and boxing the rest).

Everything that caches derived geometry — the outline cache itself, the
renderer's `Path2D` cache — is cleared when a font settles, or a shape drawn
during the load would keep its empty path forever.

## What glyph geometry changed

`shapeSubpaths` answering for text is the whole integration; the readers were
already routed through it:

- **Rendering** — outlined text is filled and stroked as ordinary geometry, so
  inside/outside stroke alignment works instead of the glyph-bounds alpha-layer
  approximation. Text without outlines still goes through `fillText`.
- **Effects** — `paintsGeometryEffects` is `shapeSubpaths(shape) !== null`, so
  Fill and Stroke effects stopped being inert on text.
- **Bucket fill** — a region can be bounded by the glyphs instead of by the
  line box around them; the box is still the fallback.
- **Convert to path** — one command (`structure.convertToPath`) outlines a
  text node, enabled only while the glyphs are actually available.

Two readers deliberately stay on the line box:

- **Bounds** (`model/geometry/bounds.ts`) — the persisted measured box is what
  selection, transforms and area-text wrapping are defined against; ink bounds
  would make the selection frame jump around as the string changes.
- **Hit testing** — selecting text by its box is friendlier than requiring a
  click on a stem, and clicking the counter of an "O" should still select it.

## Conversion is one-way

"Convert to path" replaces the text node with a `path` holding every glyph
contour under the nonzero rule (a counter is a counter-wound contour, not an
even-odd hole), keeping the node's id, name, transform, paint and effects. The
string, the font and the wrapping are gone — undo is the only way back, exactly
as in every other editor.

## Not done

- **SVG export** still writes `<text>`, so an exported file relies on the
  viewer having the font. An outline-on-export option is the natural next step
  now that the geometry exists.
- **Path modifiers on text** would need `TextShape` to join `PrimitiveShape`;
  today a text node has geometry but no modifier stack.
- **Shaping** is per-glyph with kerning only (opentype.js has no HarfBuzz), so
  scripts that need real shaping — Arabic, Indic — must not be outlined; today
  they are only safe because no bundled family covers them.
- **Text as a clipping mask** is still refused, though the geometry now exists.
