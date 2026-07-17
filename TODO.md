# Vinegar — TODO

A running list of what's next. Check items off as they land; prune once done.

## Priority: Illustrator / Figma parity

Ordered by agreed priority. These are the biggest gaps toward a "real" vector editor.

1. [x] **Artboards / frames** — shipped (`doc.artboards`, file v11). Remaining:
   - Rough edges (fix soon):
     - [x] Delete key removes a selected artboard (`edit.delete` handles
       `selectedArtboardId`)
     - [ ] Boards are only selectable/movable in the Artboard tool — let the Select
       tool hit/move them too (or clarify the split)
     - [ ] No snapping or modifier keys on board create/move/resize (grid + shapes +
       other boards; Shift = square, Alt = from center)
     - [ ] "Export all artboards" fires N sequential downloads (filenames are
       deduplicated); consider a zip
   - Follow-ups:
     - [x] Artboards list panel (list / rename / reorder = export order / select)
     - [x] Fit / zoom to artboard navigation
     - [ ] Duplicate artboard (and copy/paste)
     - [ ] Background: transparent checkerboard indicator on canvas; don't hide grid;
       later gradient/image board backgrounds
     - [x] Export options dialog (scale / format / margin per board; PNG is 2x fixed)
     - [ ] Deferred by design: rotated boards, on-canvas clip-to-artboard view toggle
2. [x] **Raster image placement** — shipped (`image` node + `DocumentAsset` store,
   file v12; decode cache in `canvas/imageCache.ts`). Follow-ups:
   - [x] Paste an image from the system clipboard (⌘V routes through the native
     `paste` event; images become image nodes, else in-memory vector paste)
   - [x] Image-specific properties — Image panel section with "Reset to natural
     size" + "Reset aspect ratio" buttons (read natural size from the decoded
     asset) and a persistent "Lock aspect ratio" toggle (`ImageShape.lockAspect`,
     optional so no file-version bump). The lock constrains both the numeric
     W/H fields and interactive handle dragging (`constrainAspectRatio` in
     `canvas/handles.ts`); holding Shift constrains any resize the same way.
   - [x] Design fix (root cause of the above): **single-shape resize folds the
     scale into geometry (w/h / points), not `transform`** (`selectTool` resize
     `soloLeaf` branch). Provably identical visuals (`S' = S · localDelta`), but
     `transform` stays rotation-only so the numeric size fields, aspect lock,
     and reset buttons all read the true size — no special-case needed. Applies
     to every leaf shape (rect / ellipse / image / paths), not just images.
     - [ ] Known gap: resizing a shape *inside a multi-selection* still writes
       scale to its `transform` (the shared frame isn't axis-aligned to a
       rotated child; genuine shear can't fold into intrinsic w/h). Fold the
       axis-aligned case on commit; leave sheared cases in the transform.
   - [ ] Mirroring: dragging a resize handle across the opposite side
     normalizes instead of flipping (same as rect)
   - [ ] Script API: expose image nodes
3. [x] **Masking / clipping mask** — clip a group's content by one shape. Decided
   scope: **clip group** = a normal `Group` with `clip?: true` (no new node type,
   so ungroup / layers / childIds machinery keep working; file version bump,
   absent `clip` ⇒ normal group so migration is a no-op). The **frontmost child**
   (last in `childIds`) is the mask; the rest are the clipped content. The mask
   defines a **vector clip** — its filled silhouette only (fill/stroke/opacity
   ignored), via `ctx.clip()` in `canvas/render.ts` and SVG `<clipPath>`
   (`clip-rule` = the mask's fill rule; aliased edges are the accepted Canvas
   limitation). Mask geometry must be areal (same test as fillable — lines /
   open paths rejected). Hit-test & bounds use the **mask-clipped** region: a
   point hits only inside the mask silhouette, and the clip group's world bounds
   are the mask's bounds (matches Illustrator; drives handles + export bounds).
   Create/Release act on a multi-selection (topmost = mask), reusing the
   compound-path style structure ops; double-click descends to edit mask/content
   like any group. Nested clip groups fall out for free (recursive group render).
   - [ ] Deferred: alpha / luminance masks (soft, gradient & image masks),
     multi-object masks, mask a raw shape without a wrapping group,
     anti-aliased clip via offscreen `destination-in`
4. [x] **Effects (drop shadow / blur)** — shipped. Illustrator-style non-destructive
   appearance effects as an **ordered stack** (`BaseNode.effects?: Effect[]`, file
   v16; absent ⇒ no effects, additive migration) on any node (shape / group /
   instance). v1 set: **Drop Shadow** (color / opacity / blur / offset) and
   **Gaussian Blur** (radius). Lengths are in node-local units (like stroke
   width), so they scale with the transform chain and zoom. Composite order =
   content → effects → opacity/blend: an effected node renders to an offscreen
   layer (reusing the opacity/blend layer path in `canvas/render.ts`), each
   effect is a filtered `drawImage` step (`ctx.filter` blur / `ctx.shadow*`),
   then the result draws with the node's opacity+blend. SVG export emits a
   `<filter>` (`feGaussianBlur` / `feDropShadow`, `shadowBlur ≈ 2×stdDeviation`
   conversion) per effected node; PNG reuses the canvas. Export bounds inflate
   by an effect margin (leaf + ancestor effects) so shadows/blur aren't cropped;
   selection handles stay on geometry (Illustrator default). UI: an Effects
   section in the properties panel (add / reorder / remove, per-effect fields).
   - [ ] Deferred: inner/outer glow, feather (needs offscreen `destination-in`),
     per-fill/stroke effects (finer appearance granularity), effects on
     artboards/layers, rotating drop-shadow offset with the object,
     group-effect export bounds beyond the per-leaf approximation.
5. [x] **Text tool** — a `text` leaf shape (file v14). Shipped scope:
   point text (click; auto-size) + area text (drag; fixed `width`, auto height,
   greedy wrap incl. per-character CJK breaks in `canvas/textLayout.ts`); one
   style per node (family / size / weight / italic / lineHeight / align);
   measured bbox stored on the node so bounds/hit-test stay pure and files open
   without the font; overlay `textarea` editing in place (world×viewport matrix
   as a CSS transform — rotated editing expected to work, horizontal fallback
   if not); fonts from a web-safe list in `ui/fonts.ts` (name → CSS stack;
   re-measure on `document.fonts` load so Google Fonts can slot in later);
   SVG `<text>`/`<tspan>` per laid-out line, PNG awaits `document.fonts.ready`.
   - [ ] Deferred: rich text (style runs), text on path, vertical text,
     letter-spacing, outline-on-export, fixed-height clipping boxes,
     Google Fonts loading
6. [x] **Stroke detail options** — shipped in file v17: custom dash pattern +
   offset, butt/round/square caps, miter/round/bevel joins, and inside/center/
   outside alignment for closed vector shapes and live text. Open paths remain
   center-aligned; Canvas/PNG, SVG export, bounds/hit-testing and Outline Stroke
   share the same appearance fields.

## Next (candidates)
The 1.0 productization order is: interoperability (SVG import + system
clipboard) → document save workflow → faithful/configurable export → quality
and performance work. Treat these as release gates ahead of animation, MCP,
additional effects, or other feature expansion.

- [ ] Alignment guides during resize and rotate (currently move only)
- [x] **SVG import / placement** — open or place existing vector artwork while
  preserving paths, transforms, groups, fills/strokes and gradients where possible
- [ ] **Rulers and draggable guides** — horizontal/vertical rulers, persistent
  document guides, snapping, lock/hide/clear actions
- [x] **Fit navigation** — zoom to selection and fit all drawing content in the
  viewport (in addition to the planned fit-to-artboard action)
- [x] **Document recovery** — autosave a local recovery snapshot, restore after a
  crash/reload, and warn before closing or replacing a document with unsaved changes
  - [x] Unsaved-changes warning — `savedDoc` reference on the store (`doc !==
    savedDoc` ⇒ dirty, since edits are immutable); `beforeunload` warns on
    close/reload, and New / Open / Open demo confirm only when dirty. Save marks
    clean (`markSaved`). Undo back to the saved state stays "dirty" (history
    holds clones) — conservative, acceptable for a safety valve.
  - [x] Autosave a local recovery snapshot + restore after crash/reload
- [ ] **Document identity and save workflow** — editable document name, Save As,
  recent files, and overwrite the opened file where the File System Access API permits
- [ ] **Document settings UI** — edit unit and DPI as well as grid size; show the
  selected unit consistently in coordinates, dimensions and export settings
- [ ] **Layer search / filtering** — find nodes by name/type and quickly reveal the
  selected result in deeply nested documents

## Mobile / touch
- [ ] On-screen alternatives for the remaining keyboard-only actions (delete, copy/paste, group, pen finish/cancel)

## Backlog / ideas
- [x] Pattern/texture paint (raster fill) — shipped (`PatternPaint` in the fill/
  stroke `Paint` union, file v13). A pattern tiles a `doc.assets` image in the
  shape's **local** space via `ctx.createPattern(img, "repeat")` +
  `pattern.setTransform` (scale / rotation / offset); a decoding/missing asset
  paints nothing that frame (the cache repaints on load). Both fill and stroke.
  Asset lifetime uses `referencedAssetIds` (image nodes + pattern paints) so
  save-time orphan pruning and export pre-decode both retain texture assets.
  - [ ] Deferred: **SVG export** (currently a neutral `#8a9099` placeholder) —
    needs `<pattern>` + embedded `<image>` sized from the decoded asset;
    fit-to-bounds (stretch) mode; per-axis repeat / no-repeat; interactive
    on-canvas placement; Script API for pattern paints.
- [ ] Swatches saved in the document (currently localStorage, color-only)
- [ ] System clipboard integration (paste across tabs/apps)
- [ ] Distribution: match an existing gap (not just centering)
- [ ] Configurable pencil smoothing strength
- [ ] Status bar: color swatch under the cursor (eyedropper-style; watch getImageData cost)
- [x] Status bar: unsaved-changes indicator (or autosave status)

## Known issues / polish
- [ ] Transform manual smoke test: nested rotated group → move → resize → rotate → undo/redo → SVG/PNG export
- [ ] Verify nested group transforms combined with group opacity/blend-mode compositing across browsers
- [ ] Skew-aware resize cursors (selection geometry is correct; CSS cursor currently follows rotation only)
- [ ] Decide whether dragging a resize handle across its opposite side should create a flipped/negative-scale transform
- [ ] Make Outline Stroke exactly match Canvas strokes under non-uniform scale/skew
- [ ] Boolean operations across different parent groups (currently limited to shapes sharing one immediate parent)
- [ ] Script API: create and restructure groups (currently exposes a flat leaf-shape snapshot)
- [ ] Update scripting examples/docs for matrix-based `shape.transform`; direct `shape.rotation` no longer exists

## Quality / scale / accessibility
- [ ] **Browser E2E coverage** — automate the critical editing journeys with a
  real browser: draw → select → move/resize/rotate → node edit → undo/redo →
  save/reopen → PNG/SVG export. Include nested rotated groups, text editing,
  clipping masks, images, effects, symbols, drag/drop and touch gestures.
- [ ] **Visual regression coverage** — keep representative Canvas, PNG and SVG
  golden outputs and compare them for rendering parity. Run the suite in at
  least Chromium, Firefox and WebKit for blend modes, filters, fonts and nested
  group compositing.
- [ ] **Define performance budgets and representative stress documents** —
  measure interaction FPS, redraw time, hit-testing, save/load, export time and
  memory at 1k / 10k nodes plus image/effect-heavy scenes.
  - [ ] Replace full-document undo/interaction clones with patches or structural
    sharing once profiling confirms the memory/latency cost.
  - [ ] Add spatial indexing and viewport culling for picking, snapping and
    rendering instead of scanning every paintable leaf.
  - [ ] Reuse or bound offscreen effect/compositing layers instead of allocating
    full-canvas buffers for every affected node/group.
- [ ] **Accessibility pass** — provide accessible names for icon-only controls,
  focus management for every modal/menu/popover, arrow-key menu navigation,
  keyboard alternatives for layer reordering, and a usable non-canvas scene
  representation for assistive technology.
- [ ] **Localization infrastructure** — move user-facing strings out of
  components and add Japanese UI before enabling the language preference; the
  current preference intentionally exposes English only.
- [ ] **Documentation parity audit** — keep README claims aligned with actual
  interaction behavior and known limitations (especially snapping, export
  fidelity and browser/touch support).

## User ideas / wishlist
- [ ] 塗り機能
- [ ] スクリプティングの拡充
  - [ ] 実行後に生成物へビューを自動フィット
  - [ ] DSL に bezier() を追加
  - [ ] エディタの行番号・簡易ハイライト・エラー行表示
  - [ ] サンプル/スニペット集
  - [ ] パラメトリック生成（パラメータ変更で再生成）
- [ ] ペン入力最適化 — `docs/brush-strokes.md` (brush shape, file v19)
  - [x] 筆圧対応（線幅）— Brush tool (B): variable-width envelope stroke with
    pressure→width curve, coalesced sampling, EMA stabilizer, taper, palm
    rejection. Strokes collect into an active drawing group (reuses
    `activeGroupId`). Deferred: pressure→opacity; node-tool width editing;
    Outline Stroke → polygon; incremental preview envelope
  - [x] ベクター消しゴム（E）— centerline-split eraser: drag splits/trims brush
    strokes at their centerline into new brush pieces (stays variable-width
    editable), one undo step. Deferred: erasing plain paths/beziers; area
    (boolean) erase; brush-radius-aware cut instead of pure centerline
  - [ ] 傾き対応（線幅・不透明度）
- [ ] アニメーション機能　パラメトリックに動かす
- [ ] コンテキストメニューの拡充
  - [ ] 項目の拡充（Align / Boolean / パス操作などコンテキスト依存の項目）
  - [ ] タッチ長押しで表示（モバイル）
  - [ ] キーボードナビゲーション（↑↓Enter）
- [ ] シンボル（再利用可能部品）の拡充
  - [ ] In-place symbol editing (dimmed scene context via an instance's world transform)
  - [ ] Snapping targets inside/against instances; exact marquee for rotated instances
  - [ ] Script API: expose instances (currently scene shapes only)
  - [ ] Export bounds: include stroke extents of instance content
- [ ] MCPサーバー化
- [x] assetを確認できるビュー — Assets dock panel (`AssetsPanel`, hidden by
  default; thumbnail + name + format/size + reference count)
- [ ] テキストのパス化
- [ ] 保存形式の検討 zip化?
- [ ] タッチ操作、ちょっと選択するだけで移動となってしまう問題
- [ ] パフォーマンス改善
- [ ] 単純図形生成　多角形、星など
