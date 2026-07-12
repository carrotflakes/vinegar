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
     - [ ] Artboards list panel (list / rename / reorder = export order / select)
     - [ ] Fit / zoom to artboard navigation
     - [ ] Duplicate artboard (and copy/paste)
     - [ ] Background: transparent checkerboard indicator on canvas; don't hide grid;
       later gradient/image board backgrounds
     - [ ] Export options dialog (scale / format / margin per board; PNG is 2x fixed)
     - [ ] Deferred by design: rotated boards, on-canvas clip-to-artboard view toggle
2. [x] **Raster image placement** — shipped (`image` node + `DocumentAsset` store,
   file v12; decode cache in `canvas/imageCache.ts`). Follow-ups:
   - [ ] Paste an image from the system clipboard
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
3. [ ] **Masking / clipping mask** — clip a group's content by one shape. Decided
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
4. [ ] **Effects (drop shadow / blur)** — per-node shadow and blur; render + SVG + serialize.
5. [ ] **Text tool** — a `text` leaf shape (file v13). Decided scope:
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
6. [ ] **Stroke detail options** — dash pattern, line cap/join (currently hard-coded
   `round` in `canvas/render.ts`), and stroke alignment (inside / center / outside).

## Next (candidates)
- [ ] Alignment guides during resize and rotate (currently move only)

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
- [ ] Status bar: unsaved-changes indicator (or autosave status)

## Known issues / polish
- [ ] Transform manual smoke test: nested rotated group → move → resize → rotate → undo/redo → SVG/PNG export
- [ ] Verify nested group transforms combined with group opacity/blend-mode compositing across browsers
- [ ] Skew-aware resize cursors (selection geometry is correct; CSS cursor currently follows rotation only)
- [ ] Decide whether dragging a resize handle across its opposite side should create a flipped/negative-scale transform
- [ ] Make Outline Stroke exactly match Canvas strokes under non-uniform scale/skew
- [ ] Boolean operations across different parent groups (currently limited to shapes sharing one immediate parent)
- [ ] Script API: create and restructure groups (currently exposes a flat leaf-shape snapshot)
- [ ] Update scripting examples/docs for matrix-based `shape.transform`; direct `shape.rotation` no longer exists

## User ideas / wishlist
- [ ] Rectangleの角丸
- [ ] 塗り機能
- [x] テクスチャ（パターン塗り／fill・stroke、SVG出力は後回し）
- [ ] スクリプティングの拡充
  - [ ] 実行後に生成物へビューを自動フィット
  - [ ] DSL に bezier() を追加
  - [ ] エディタの行番号・簡易ハイライト・エラー行表示
  - [ ] サンプル/スニペット集
  - [ ] パラメトリック生成（パラメータ変更で再生成）
- [ ] ペン入力最適化
  - [ ] 筆圧対応（線幅・不透明度）
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
- [ ] ロゴ / ファビコン
- [x] ユーザ選択不要な部分に select-none
- [x] Fileメニューの階層化（Export submenu）
