# Vinegar — TODO

A running list of what's built and what's next. Check items off as they land.

## Done

### Core
- [x] Canvas 2D scene graph, hit-testing, selection (hand-rolled)
- [x] Tools: Select, Rectangle, Ellipse, Line, Pencil, Pen (Bézier), Edit Nodes
- [x] Move / resize (8 handles) / rotate; multi-select (shift-click & marquee)
- [x] Undo / redo; pan (Space/middle) & zoom (Ctrl/⌘+wheel)
- [x] Properties panel; layers panel (reorder / hide / lock / rename)

### Editing
- [x] Bézier pen + node editing (anchors & handles, Alt breaks symmetry)
- [x] Pencil → simplified + smoothed editable Bézier; close by ending near start
- [x] Open / close a path after creation
- [x] Node tool: click a segment to insert an anchor (curve-preserving split) and drag it in one gesture
- [x] Node tool: double-click an anchor to toggle smooth ↔ corner
- [x] Pen: click an endpoint of an existing open path to continue it (commit replaces the original)
- [x] Shift = 45° constraint for pen anchors/handles and node-anchor drags
- [x] Rotation (handle, Shift = 15°) incl. rotated resize; rotation-aware cursors
- [x] Group / ungroup (groupId-based)
- [x] Copy / cut / paste / duplicate
- [x] Boolean ops: union / subtract / intersect / exclude (polygon-clipping)
- [x] Outline stroke: convert a shape's stroke to a filled path (clipper-lib)
- [x] Script generator: one-shot drawing DSL run in a sandboxed Worker

### Snapping
- [x] Alignment guides (edges/centers to other shapes)
- [x] Equal-spacing distribution guides (centering between neighbours)
- [x] Optional grid snapping
- [x] Snapping in move, drawing, resize, pen & node editing

### Color
- [x] Color swatch popover: preset palette, recent colors (persisted), hex, none
- [x] Saved swatches (persisted, add/Alt-click remove) + eyedropper (EyeDropper API)
- [x] History coalescing for color/slider drags (one undo per drag)

### File / IO
- [x] New / Open / Save (.json)
- [x] Export PNG (2x, transparent) / SVG

### UI
- [x] Draggable divider between Properties and Layers (persisted)

## Next (candidates)
- [x] Numeric X / Y / W / H editing in the properties panel
- [x] Rect/ellipse: Shift = square/circle, Alt = draw from center (line: Shift = 45°)
- [x] Align & distribute buttons (left/center/right, top/middle/bottom, spacing)
- [x] Rotation snapping (ease toward 0/45/90° without holding Shift)
- [ ] Alignment guides during resize and rotate (currently move only)
- [x] Status bar: live numbers during interactions (W×H while creating, ΔX/ΔY while moving, angle while rotating, new size while resizing)
- [x] Status bar: selection info (count; type + name for a single selection) instead of always showing the total shape count
- [x] Status bar: per-tool hints (pen: Enter to finish / Esc to cancel / click near start to close; select: Shift+click to add)

## Mobile / touch
- [x] Responsive layout: icon-only toolbar rail + slide-in Properties/Layers drawer; reflowed app bar / status bar on narrow screens
- [x] Enlarged hit targets & selection/node chrome for coarse (touch) pointers
- [ ] Pinch-to-zoom & two-finger pan (multi-pointer gestures)
- [ ] On-screen alternatives for keyboard-only actions (delete, copy/paste, group, pen finish/cancel, modifier keys)

## Backlog / ideas
- [ ] Color: alpha/opacity per color; swatches saved in the document
- [ ] System clipboard integration (paste across tabs/apps)
- [ ] Text tool
- [x] Nested groups: real group entities (name/opacity/blend/hide/lock, nesting) rendered as composited layers; layers-panel tree + group section in properties. Current file format is v4; older formats are intentionally unsupported.
  - [x] True affine transform matrices on shapes and groups
- [ ] Distribution: match an existing gap (not just centering)
- [ ] Configurable pencil smoothing strength
- [ ] Status bar: color swatch under the cursor (eyedropper-style; watch getImageData cost)
- [ ] Status bar: unsaved-changes indicator (or autosave status)

## Known issues / polish
- [x] Dragging the native color spectrum can add several undo steps (batch it)
- [x] Accurate resize for rotated shapes, groups and multi-selection via affine transforms
- [ ] Transform manual smoke test: nested rotated group → move → resize → rotate → undo/redo → SVG/PNG export
- [ ] Verify nested group transforms combined with group opacity/blend-mode compositing across browsers
- [ ] Skew-aware resize cursors (selection geometry is correct; CSS cursor currently follows rotation only)
- [ ] Decide whether dragging a resize handle across its opposite side should create a flipped/negative-scale transform
- [ ] Make Outline Stroke exactly match Canvas strokes under non-uniform scale/skew
- [ ] Boolean operations across different parent groups (currently limited to shapes sharing one immediate parent)
- [ ] Update scripting examples/docs for matrix-based `shape.transform`; direct `shape.rotation` no longer exists

## User ideas / wishlist
- [ ] Rectangleの角丸
- [ ] 塗り機能
- [ ] グラデーション
- [ ] テクスチャ
- [ ] ラスタ画像
- [x] スクリプティング（one-shot 生成）
  - [x] 既存図形を参照、編集（shapes/selection/bounds/move/remove・直接編集→diff）
  - [ ] 実行後に生成物へビューを自動フィット
  - [ ] DSL に bezier() を追加
  - [ ] エディタの行番号・簡易ハイライト・エラー行表示
  - [ ] サンプル/スニペット集
  - [ ] パラメトリック生成（パラメータ変更で再生成）
- [x] change grid size
- [x] 合成モード（blend mode: multiply / screen など。図形単位。グループ単位は Nested groups とセットで）
- [x] レイヤーパネルでグループをツリー表示（折りたたみ・グループ単位の表示/ロック切替・ドラッグ並べ替え）
- [ ] ペン入力最適化
  - [ ] 筆圧対応（線幅・不透明度）
  - [ ] 傾き対応（線幅・不透明度）
- [ ] アニメーション機能　パラメトリックに動かす
- [x] コンテキストメニュー（土台: 汎用メニュー基盤＋キャンバス/レイヤーパネル右クリック。Paste here・Select all(Ctrl+A)追加）
  - [ ] 項目の拡充（Align / Boolean / パス操作などコンテキスト依存の項目）
  - [ ] タッチ長押しで表示（モバイル）
  - [ ] キーボードナビゲーション（↑↓Enter）
