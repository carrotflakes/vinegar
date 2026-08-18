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
- [ ] Snapping follow-ups — resize honours alignment lines but drops the guide
  when the aspect constraint overrides it (a ratio-preserving snap would keep
  it); rotate has angle magnetism only, by decision, and no alignment guides;
  distribution (equal-spacing) snapping is still move-only
- [ ] Save workflow follow-ups — recent files (persist handles in IndexedDB),
  reattach the handle across a reload, and a "Save a copy" that does not
  re-point the attached file
- [ ] Rulers/guides follow-ups (docs/design/rulers-and-guides.md) — numeric entry
  (double-click a guide), per-frame guides, a user-draggable ruler origin,
  activating a frame by clicking its empty background, diagonal guides, "make
  guides from selection", guides inside symbol definitions, ticks under an
  arbitrary canvas rotation (currently only multiples of 90°)

## Mobile / touch
- [ ] On-screen alternatives for the remaining keyboard-only actions (delete, copy/paste, group)
      — the pen's draft bar (Done / Close / Undo / Discard) is done
- [ ] NumberPad の詰め（docs/reference/pen-and-touch.md）。実機 iPad での確認は別途
  - [ ] ＋/− が `scale="log"` に追随しない。zoom は倍率スクラブなのに ±1% 刻みで、
    6400% で ＋を押すと 6401%。`ScrubScale` をパッドまで渡す
  - [ ] フォーカス管理がない。`role="dialog"` なのに Tab で外へ抜ける。
    `FloatingFocusManager` で囲うか、`role` を落として単なるポップオーバー扱いにするか
  - [ ] 単位（`%` / `°`）がヘッダーに出ない。`aria-label` しか手掛かりがない
  - [ ] min/max のクランプが無言。超過入力を赤くするか、丸めたことを伝える
  - [ ] `defaultValue` に届かない。ダブルクリックのリセットはパッド利用時ほぼ死ぬので、
    `defaultValue` を持つフィールドには Default キーを出す
  - [ ] 式入力（`120*2`、`64+8`）。`numberPadValue` を式パーサに差し替えて `=` キー1つ
  - [ ] 同じポップオーバー枠を数値以外へ転用（HEX 用の 0-9 A-F パッド、`HexInput.tsx`）

## Backlog / ideas

### Feature follow-ups on shipped work
- [ ] PWA follow-ups (docs/design/pwa.md) — file handlers so `.vinegar.json` can be
  opened from the OS (`launchQueue`, Chromium desktop only); shortcuts and
  screenshots in the manifest
- [ ] Clipping masks — alpha / luminance masks (soft, gradient & image masks),
  multi-object masks, mask a raw shape without a wrapping group, anti-aliased
  clip via offscreen `destination-in`
- [ ] Effects (docs/design/effects.md) — inner/outer glow, feather (needs offscreen
  `destination-in`), Fill/Stroke effects on text and images (they have no
  outline today, so those entries are inert), per-fill/stroke effects, effects
  on frames/layers, rotating drop-shadow offset with the object,
  group-effect export bounds beyond the per-leaf approximation
- [ ] End markers (docs/design/markers.md) — arbitrary nodes/symbols as markers
  (`{ kind: "builtin" } | { kind: "symbol", id }`), mid-path markers, an
  independent marker colour, SVG **import** of `marker-start`/`marker-end`,
  hit-testing the marker itself, and stroke trim-back (a translucent stroke
  reads darker under its marker, and a hollow marker shows the line stub inside;
  the same change would let a dashed stroke drop its caps at a marked end)
- [ ] Text — rich text (style runs), text on path, vertical text, letter-spacing,
  outline-on-export, fixed-height clipping boxes, Google Fonts loading
- [ ] Bucket fill (docs/design/bucket-fill.md) — hover preview of the region (needs an
  obstacle-union cache keyed on the document revision), curve re-fitting of the
  polygon boundary, frame edges as region bounds, recolor of strokes/brushes
  on click, glyph outlines instead of text line boxes as ink
- [ ] Freeform gradients (docs/design/freeform-gradients.md) — SVG **import** has no
  counterpart to read back (an exported field returns as a raster pattern);
  no interpolating RBF (thin-plate) method, which would let a point's colour
  survive the `gaussian` blend; the on-canvas pad has no marquee/multi-select
  for points, and a point cannot be bound to a document parameter
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
- [ ] **Parameters and references** (docs/design/parameters.md) — phase 1 shipped:
  document parameters (v32) drive `strokeWidth`, path-modifier params and
  built-in generator args through `node.bindings`. Remaining phases: parametric
  symbols (v33) → non-destructive boolean as a node→node operand (v34) →
  expressions (optional). Each ships alone; not before the 1.0 gates above.
  Phase-1 gap: document-script generators are not bindable (their geometry only
  rebuilds through the worker, which the pure resolution step cannot await).
- [ ] Swatches saved in the document (currently localStorage, color-only)
- [x] Distribution: match an existing gap (not just centering)
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
- [x] キー操作でアイテム移動 — Alt+↑/↓ で選択を親内で一段ずつ前面/背面へ
  （`raiseSelected`/`lowerSelected`、パネルにフォーカスがあるときのみ）
- [x] 折りたたみ状態が消える — `collapsed` は LayersPanel の useState で、ドックは
  アクティブなタブしか render しない（Dock.tsx）ため、タブを往復すると全部開き直しに
  なる。仮想化で数千行を扱う前提になったぶん実害が大きい。collapsed（と cursor /
  スクロール位置）を store か sessionStorage に持たせる
- [ ] 配線を守るテストが無い — `tree.ts` の純粋部分と `moveNodes` はカバー済みだが、
  仮想化・reveal・ドラッグは React を描画しないと検証できず、jsdom もブラウザテストも
  無い。壊れやすいのは「全行が同じ高さ」と「スクロール親の解決」で、`.layer-row` の
  padding 変更やドックのレイアウト変更が静かに仮想化を壊せる（前提は
  docs/reference/render-performance.md に明記済み）。ブラウザテストの導入是非から判断
- [x] キーボード到達性 — `tabIndex={0}` + `:focus-visible` リング、`role="tree"` /
  `role="treeitem"` / `aria-selected` / `aria-level` / `aria-expanded`、
  `aria-activedescendant` でカーソル行を通知（Tab 到達時は選択末尾をカーソルに）
- [x] 折りたたみメニュー — パネル見出しに Expand all / Collapse all /
  Collapse others（選択への道筋だけ開いたまま畳む）

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
  (`createRenderStressDocument`, docs/reference/render-performance.md).
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
  - [x] プロパティの GeneratorSection に「Edit source」ボタン（インスタンス→ソースへ
    ジャンプ、`openGenerators(scriptId)`。組み込みは読み取り専用なので "View source"）
  - [x] クリップボードが生成器スクリプトを持ち運ばない → 別ドキュメントへ貼ると
    `generator.scriptId` が宙に浮く（形状は出るがパラメータ編集不可）。payload に
    参照 `ScriptDef` を同梱してマージするか、貼り先に無ければ generator リンクを外す
    （アプリ内クリップボードのみ。SVG 経由のタブ間ペーストは下の「System clipboard」）
  - [ ] コードを変更したときに、それを使っているインスタンスのパラメータを保持した
    まま再生成する方法
  - [x] ツールバーから generator の図形挿入
  - [ ] generator の編集ロック pref へ
- [ ] パス操作
  - [x] **Path modifier stack (Blender-like, non-destructive)** — the agreed
    direction: path ops become re-editable modifiers extending the generator
    concept. Plan in `docs/design/path-modifiers.md` (model like `effects`, `subpaths`
    = base, cached `resolvedSubpaths()` feeds render/hit-test/bounds/export).
    Phase 1 = vertical slice (Simplify + live tolerance); the shipped one-shot
    ops become "Apply/bake".
  - [x] パスのオフセット (candidate first modifier once the stack lands)
  - [ ] Join (connect open paths), Average — see the path-ops proposal
  - [ ] `path.join` に線幅バグがある（ベイクして identity + 基準の `strokeWidth` を
    そのままコピーするので、スケールを持つパスを join すると線幅が変わる）。既存の
    出荷済みコマンドの挙動変更になるので未着手。`docs/reference/path-commands.md` 参照
  - [x] group を選んで統合（split の結果を 1 手で戻せるようにする）
  - [x] rect / ellipse / line を統合の入力に許す（`convertShapeToPath` の再利用）。
    brush はエンベロープ輪郭になってしまうので対象外
  - [ ] マスクの分割 — 全輪郭が閉じている場合に限り group ではなく compoundPath で
    包めば有効なマスクのまま分割できる（穴の読みまで保たれる）。開いた subpath を
    含むマスクは compound の子になれないので引き続き拒否
  - [ ] テキストのパス化
- [ ] シンボル（再利用可能部品）の拡充
  - [ ] In-place symbol editing (dimmed scene context via an instance's world transform)
  - [ ] Snapping targets inside/against instances; exact marquee for rotated instances
  - [ ] Export bounds: include stroke extents of instance content
- [ ] コンテキストメニューの拡充
  - [ ] 項目の拡充（Align / Boolean / パス操作などコンテキスト依存の項目）
  - [ ] タッチ長押しで表示（モバイル）
  - [x] キーボードナビゲーション（↑↓Enter）
- [ ] ペン入力 傾き対応（線幅・不透明度）
- [ ] アニメーション機能　パラメトリックに動かす
- [ ] MCPサーバー化
- [ ] 保存形式の検討 zip化?
- [ ] ColorField のリファクタリング（特にコンポーネントわけ。グラデーション部分は
  `GradientEditor.tsx` に分離済み）
- [ ] グラデーション（docs/design/gradients.md）の続き — フリーフォームグラデーション
  （メッシュ）、複数オブジェクトにまたがるグラデーション、スウォッチとしての
  グラデーション保存（`Swatch.paint` は今のところ solid のみ）
- [ ] ドックのフローティング、マルチカラム化
- [ ] Assetという名前は問題ないか。raster imageではないか。
- [ ] テキストってインプレイス編集しかない？
- [x] Taperのバグ（端点でCatmull-Romハンドルが行き過ぎてフックしていた。`catmullRomHandles`で各ハンドルを隣接アンカーの弦長1/3にクランプ）
- [ ] pencil 直線モード（描画中に修飾キーで直線セグメント）
- [ ] generator図形、丸角四角（四方制御）
- [ ] 各ツールについての使い勝手向上
  - [ ] ペン: 別の開いたパスの端点で描き終えて 2 本を 1 本に連結する（今は単一
    サブパスの開曲線しか拾えず、コンパウンドパス内のパスは継続できない）。
    Join コマンド（上記 path-ops）と同じ縫合処理を共有する形で設計する
  - [ ] ペン: ツールオプションがない（スナップ切替、閉じたときの塗り、既定の
    アンカー種別あたりの置き場。PencilSection/BrushSection が前例）
  - [ ] ペン: 開いたパスにも既定の塗りが乗る（`onPenDown` は
    `styleFromDefaults` をそのまま使う）。pencil は開ストロークを `fill: null`
    にし brush も常に null なので、同じ「開いた線」がツールで見た目が変わる。
    Illustrator は乗せる側なので pen が業界標準ではあるが、どちらかに寄せる
  - [ ] ペン: `commitPenDraft` の変更検知が `JSON.stringify` 比較でキー順依存。
    明示的な比較か変更フラグに置き換える
  - [ ] ペン: アンカー配置ドラッグ中に位置そのものを直す手段がない
    （Illustrator の Space ドラッグ相当）
  - [ ] pencil: 選択パスの途中をなぞって区間を差し替える（Illustrator の
    リシェイプ）。今できるのは端点からの延長だけ。パス上の最近点探索＋
    de Casteljau 分割が要る本命機能
  - [x] pencil: 延長描画（`commitPencilExtend`）が常に `closed: false`。
    既存の開パスの端点から描き始めて反対の端点に戻っても閉じられない
    → 新規ストロークと同じ Close ルール（`resolveExtendClose`）で閉じる
  - [ ] pencil: 描いたストロークの収納先が brush と非対称。brush は
    `addBrushStroke` で activeGroup（"Drawing"）に集約するのに pencil は
    スコープ直下にバラ撒く。連続スケッチでレイヤーが荒れる
  - [ ] pencil: 描き終えた直後のストロークを Esc/Backspace で取り消す
    （今の Esc はドラッグ中しか効かない）
  - [ ] pencil/brush: EMA＋最小距離フィルタ＋simplify＋オプションストア＋
    パネル UI がほぼ二重化（`pencilStore.smoothing` と
    `brushStore.stabilizer` は同一セマンティクス）。共有サンプラに抜く。
    tail settlement も両者で別実装になっている
  - [ ] brush: 既定スタイルの stroke が None だとプレビューすら出ず無反応
    （`paintBrush` が即 return）。ブラシ色が Appearance の「線」スロットに
    あること自体が非自明なので、BrushSection に色スウォッチを置きたい
  - [ ] pen/pencil/brush 共通: 描いた直後に図形が選択される（`addShape` の
    `select` 既定が true、`addBrushStroke` も同様）ため、続けて色を変えると
    「次の線の既定」ではなく直前の線が変わる。ペイント系の期待と逆なので、
    描画ツール横断でどうするか決める（描画中は選択しない案）
  - [ ] brush: プレビューと確定結果が違う（taper / simplify / フィットは離した
    瞬間に初めて適用される）。せめて taper はライブ反映したい
  - [ ] brush: 描画中のプレビューがサンプルごとに全再構築（`buildPreview` ＋
    エンベロープ O(n)）。長いストロークで重い。末尾差分のみの再構築が本命
  - [ ] brush: 開始点が guide/grid にスナップしない（pencil はする）。
    フリーハンドでも始点は狙う、という理屈が当てはまるかは要検討
  - [ ] brush: 直線モード（Shift で直線セグメント）、入り/抜きの taper 個別設定、
    ブラシプリセット、筆圧カーブのプレビュー図
  - [ ] brush: マウス/タッチは pressure=1 固定なので強弱が taper しかない。
    速度→幅シミュレーション
- [ ] PWA
- [ ] modifier部分焼き込み
- [ ] 自由変形
- [ ] Repeat コンテナ array, radial
- [x] path modifier適用対象拡張 (rect/ellipse/line, v33)
- [ ] pencil の交差トリム
- [ ] Brush はfillなのかstrokeなのか問題
- [ ] paintのコピペ
- [x] フレームにフォーカスしているときに他のフレームを選択できてしまう
- [x] パネルのタイトルバーを全パネルで sticky に（`.layers-title` → `.panel-title`)
- [ ] Layers 以外のパネル行にもコンテキストメニュー（Assets / Symbols /
  Global colors / Generators）。タッチの右スワイプは useTouchDrag 側にあるので流用できる
- [ ] 色弱シミュレーション
- [x] ScrubbableNumberの単位対応
