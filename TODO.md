# Vinegar — TODO

A running list of what's next. Check items off as they land; prune once done —
shipped work lives in git history and `docs/`, not here.

## Next (release gates)
The 1.0 productization order is: interoperability (SVG import + system
clipboard) → document save workflow → faithful/configurable export → quality
and performance work. Treat these as release gates ahead of animation, MCP,
additional effects, or other feature expansion.

- [ ] **Document settings UI** — edit unit and DPI as well as grid size; show the
  selected unit consistently in coordinates, dimensions and export settings
- [ ] **Layer search / filtering** — find nodes by name/type and quickly reveal the
  selected result in deeply nested documents
- [ ] Alignment guides during resize and rotate (currently move only)
- [ ] Save workflow follow-ups — recent files (persist handles in IndexedDB),
  reattach the handle across a reload, and a "Save a copy" that does not
  re-point the attached file
- [ ] Rulers/guides follow-ups (docs/rulers-and-guides.md) — numeric entry
  (double-click a guide), per-artboard guides, a user-draggable ruler origin,
  activating a frame by clicking its empty background, diagonal guides, "make
  guides from selection", guides inside symbol definitions, ticks under an
  arbitrary canvas rotation (currently only multiples of 90°)

## Mobile / touch
- [ ] On-screen alternatives for the remaining keyboard-only actions (delete, copy/paste, group, pen finish/cancel)

## Backlog / ideas

### Feature follow-ups on shipped work
- [ ] Clipping masks — alpha / luminance masks (soft, gradient & image masks),
  multi-object masks, mask a raw shape without a wrapping group, anti-aliased
  clip via offscreen `destination-in`
- [ ] Effects — inner/outer glow, feather (needs offscreen `destination-in`),
  per-fill/stroke effects, effects on artboards/layers, rotating drop-shadow
  offset with the object, group-effect export bounds beyond the per-leaf
  approximation
- [ ] Text — rich text (style runs), text on path, vertical text, letter-spacing,
  outline-on-export, fixed-height clipping boxes, Google Fonts loading
- [ ] Bucket fill (docs/bucket-fill.md) — hover preview of the region (needs an
  obstacle-union cache keyed on the document revision), curve re-fitting of the
  polygon boundary, artboard edges as region bounds, recolor of strokes/brushes
  on click, glyph outlines instead of text line boxes as ink
- [ ] Pattern paint — rotation for `fill`/`fit` (tile-only today); `scale` means
  "×natural" for tile but "×cover/contain baseline" for fill/fit, so switching
  modes changes the visual basis (consider resetting scale to 1 on mode change);
  verify canvas ↔ SVG-export parity for the fit modes in a browser; SVG **import**
  of `<pattern>`; interactive on-canvas placement (drag to pan the crop / tile
  origin); Script API for pattern paints; new patterns default to `tile` —
  consider `fill` to match Figma-style image fills
- [ ] System clipboard — the native payload now rides in the copied SVG's
  `<metadata>` (generator links + scripts, effects, images/assets, global
  colours survive a cross-tab paste). Still open: **symbol definitions** are
  serialized into the payload but not merged on paste, so pasting an instance
  into a document that lacks the symbol falls back to flattened SVG geometry
  (needs symbol-id remapping + cycle checks); payloads above the 8 MB cap in
  `systemClipboard.ts` degrade to plain SVG

### New ideas
- [ ] Swatches saved in the document (currently localStorage, color-only)
- [ ] Distribution: match an existing gap (not just centering)
- [ ] Configurable pencil smoothing strength
- [ ] Status bar: color swatch under the cursor (eyedropper-style; watch getImageData cost)

## Known issues / polish
- [ ] Resizing a shape *inside a multi-selection* still writes scale to its
  `transform` (single-shape resize folds it into geometry instead). The shared
  frame isn't axis-aligned to a rotated child and genuine shear can't fold into
  intrinsic w/h — fold the axis-aligned case on commit, leave sheared cases in
  the transform
- [ ] Decide whether dragging a resize handle across its opposite side should
  flip (negative scale) instead of normalizing — currently normalizes for every
  shape type, images included
- [ ] Transform manual smoke test: nested rotated group → move → resize → rotate → undo/redo → SVG/PNG export
- [ ] Verify nested group transforms combined with group opacity/blend-mode compositing across browsers
- [ ] Skew-aware resize cursors (selection geometry is correct; CSS cursor currently follows rotation only)
- [ ] Make Outline Stroke exactly match Canvas strokes under non-uniform scale/skew
- [ ] Boolean operations across different parent groups (currently limited to shapes sharing one immediate parent)
- [ ] Script API: create and restructure groups (currently exposes a flat leaf-shape snapshot); expose image nodes and symbol instances
- [ ] Update scripting examples/docs for matrix-based `shape.transform`; direct `shape.rotation` no longer exists

### Layers パネル
- [ ] キー操作でアイテム移動
- [x] 折りたたみ状態が消える — `collapsed` は LayersPanel の useState で、ドックは
  アクティブなタブしか render しない（Dock.tsx）ため、タブを往復すると全部開き直しに
  なる。仮想化で数千行を扱う前提になったぶん実害が大きい。collapsed（と cursor /
  スクロール位置）を store か sessionStorage に持たせる
- [ ] 配線を守るテストが無い — `tree.ts` の純粋部分と `moveNodes` はカバー済みだが、
  仮想化・reveal・ドラッグは React を描画しないと検証できず、jsdom もブラウザテストも
  無い。壊れやすいのは「全行が同じ高さ」と「スクロール親の解決」で、`.layer-row` の
  padding 変更やドックのレイアウト変更が静かに仮想化を壊せる（前提は
  docs/render-performance.md に明記済み）。ブラウザテストの導入是非から判断
- [ ] キーボード到達性 — リストは `tabIndex={-1}` でフォーカスリングも消してあるので、
  一度クリックするまで矢印キーが使えない。行に `role="treeitem"` / `aria-selected` も
  無い。矢印キーを入れた分ここが中途半端

### Properties パネルのリファイン
- [ ] UIの統一感
- [ ] ツールオプションが Properties の先頭にあるのは変
- [ ] frame + 何かの選択で他の操作

## Quality / scale / accessibility
- [ ] **Browser E2E coverage** — automate the critical editing journeys with a
  real browser: draw → select → move/resize/rotate → node edit → undo/redo →
  save/reopen → PNG/SVG export. Include nested rotated groups, text editing,
  clipping masks, images, effects, symbols, drag/drop and touch gestures.
- [ ] **Visual regression coverage** — keep representative Canvas, PNG and SVG
  golden outputs and compare them for rendering parity. Run the suite in at
  least Chromium, Firefox and WebKit for blend modes, filters, fonts and nested
  group compositing.
- [ ] **Performance budgets** — the harness today covers redraw only
  (`createRenderStressDocument`, docs/render-performance.md).
  - [ ] Set budgets and add workloads for interaction, picking/snapping,
    save/load, export and memory
  - [ ] Replace full-document undo/interaction clones with patches or structural
    sharing once profiling confirms the memory/latency cost
  - [ ] Add spatial indexing and viewport culling for picking and snapping
    (hierarchical render culling is implemented; a true spatial index remains)
  - [ ] Reuse or bound offscreen effect/compositing layers instead of allocating
    full-canvas buffers for every affected node/group
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
- [ ] スクリプティングの拡充
  - [ ] 実行後に生成物へビューを自動フィット
  - [ ] DSL に bezier() を追加
  - [ ] エディタの行番号・簡易ハイライト・エラー行表示
  - [ ] サンプル/スニペット集
  - [ ] パラメトリック生成（パラメータ変更で再生成）
- [ ] 生成器（generator）の拡充
  - [ ] パラメータ型の拡張（bool=チェックボックス、enum=セレクト。今は number のみ）
  - [ ] プロパティの GeneratorSection に「Edit source」ボタン（インスタンス→ソースへ
    ジャンプ、`openGenerators(scriptId)`）
  - [x] クリップボードが生成器スクリプトを持ち運ばない → 別ドキュメントへ貼ると
    `generator.scriptId` が宙に浮く（形状は出るがパラメータ編集不可）。payload に
    参照 `ScriptDef` を同梱してマージするか、貼り先に無ければ generator リンクを外す
    （アプリ内クリップボードのみ。SVG 経由のタブ間ペーストは下の「System clipboard」）
  - [ ] コードを変更したときに、それを使っているインスタンスのパラメータを保持した
    まま再生成する方法
  - [ ] ツールバーから generator の図形挿入
  - [ ] generator の編集ロック pref へ
- [ ] パス操作
  - [ ] **Path modifier stack (Blender-like, non-destructive)** — the agreed
    direction: path ops become re-editable modifiers extending the generator
    concept. Plan in `docs/path-modifiers.md` (model like `effects`, `subpaths`
    = base, cached `resolvedSubpaths()` feeds render/hit-test/bounds/export).
    Phase 1 = vertical slice (Simplify + live tolerance); the shipped one-shot
    ops become "Apply/bake".
  - [ ] パスのオフセット (candidate first modifier once the stack lands)
  - [ ] Join (connect open paths), Average — see the path-ops proposal
  - [ ] `path.join` に線幅バグがある（ベイクして identity + 基準の `strokeWidth` を
    そのままコピーするので、スケールを持つパスを join すると線幅が変わる）。既存の
    出荷済みコマンドの挙動変更になるので未着手。`docs/path-commands.md` 参照
  - [ ] group を選んで統合（split の結果を 1 手で戻せるようにする）。今は
    グループ内のピースを選び直す必要がある
  - [ ] rect / ellipse / line を統合の入力に許す（`convertShapeToPath` の再利用で
    済む）。brush はエンベロープ輪郭になってしまうので対象外が妥当
  - [ ] マスクの分割 — 全輪郭が閉じている場合に限り group ではなく compoundPath で
    包めば有効なマスクのまま分割できる（穴の読みまで保たれる）。開いた subpath を
    含むマスクは compound の子になれないので引き続き拒否
  - [ ] `path.outlineStroke` / `path.divide` は結果を group に包むため、マスクに対して
    実行すると `hasValidSceneContainers` で落ちて**無言で何も起きない**（破壊はしない）。
    同じ `maskMultiNodeError` を出して理由を伝えるべき
  - [ ] brush <-> path 相互変換
  - [ ] テキストのパス化
- [ ] シンボル（再利用可能部品）の拡充
  - [ ] In-place symbol editing (dimmed scene context via an instance's world transform)
  - [ ] Snapping targets inside/against instances; exact marquee for rotated instances
  - [ ] Export bounds: include stroke extents of instance content
- [ ] コンテキストメニューの拡充
  - [ ] 項目の拡充（Align / Boolean / パス操作などコンテキスト依存の項目）
  - [ ] タッチ長押しで表示（モバイル）
  - [ ] キーボードナビゲーション（↑↓Enter）
- [ ] ペン入力 傾き対応（線幅・不透明度）
- [ ] アニメーション機能　パラメトリックに動かす
- [ ] MCPサーバー化
- [ ] 保存形式の検討 zip化?
- [ ] 左右反転のUIリファイン
- [ ] ソロ編集
- [ ] ColorField のリファクタリング（特にコンポーネントわけ）
- [ ] ドックのフローティング、マルチカラム化
- [ ] Assetという名前は問題ないか。raster imageではないか。
- [ ] Toast メッセージをコピー可能に
