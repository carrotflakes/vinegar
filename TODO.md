# Vinegar — TODO

A running list of what's next. Check items off as they land; prune once done.

## Priority: Illustrator / Figma parity

Ordered by agreed priority. These are the biggest gaps toward a "real" vector editor.

1. [x] **Artboards / frames** — shipped (`doc.artboards`, file v11). Remaining:
   - Rough edges (fix soon):
     - [ ] Delete key doesn't remove a selected artboard (`edit.delete` only covers
       node selection / editNode; wire in `selectedArtboardId`)
     - [ ] Boards are only selectable/movable in the Artboard tool — let the Select
       tool hit/move them too (or clarify the split)
     - [ ] No snapping or modifier keys on board create/move/resize (grid + shapes +
       other boards; Shift = square, Alt = from center)
     - [ ] "Export all artboards" fires N sequential downloads and duplicate board
       names collide — dedupe filenames (and consider a zip)
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
   - [ ] Image-specific properties (reset to natural size, aspect-ratio lock)
   - [ ] Mirroring: dragging a resize handle across the opposite side
     normalizes instead of flipping (same as rect)
   - [ ] Script API: expose image nodes
3. [ ] **Masking / clipping mask** — clip one object's paint by another's shape.
4. [ ] **Effects (drop shadow / blur)** — per-node shadow and blur; render + SVG + serialize.
5. [ ] **Text tool** — a `text` shape type (typography, editing, on-path later).
6. [ ] **Stroke detail options** — dash pattern, line cap/join (currently hard-coded
   `round` in `canvas/render.ts`), and stroke alignment (inside / center / outside).

## Next (candidates)
- [ ] Alignment guides during resize and rotate (currently move only)

## Mobile / touch
- [ ] On-screen alternatives for the remaining keyboard-only actions (delete, copy/paste, group, pen finish/cancel)

## Backlog / ideas
- [ ] Pattern/texture paint (raster fill) — the asset pipeline now exists (`canvas/imageCache.ts`)
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
- [ ] テクスチャ
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
- [ ] グループ内のオブジェクトの移動　（グループ選択に吸われてしまう）
