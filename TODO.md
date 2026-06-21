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
- [x] Rotation (handle, Shift = 15°) incl. rotated resize; rotation-aware cursors
- [x] Group / ungroup (groupId-based)
- [x] Copy / cut / paste / duplicate
- [x] Boolean ops: union / subtract / intersect / exclude (polygon-clipping)

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
- [ ] Numeric X / Y / W / H editing in the properties panel (currently read-only)
- [ ] Rotation snapping (ease toward 0/45/90° without holding Shift)
- [ ] Alignment guides during resize and rotate (currently move only)
- [ ] Rect/ellipse: Shift = square/circle, Alt = draw from center
- [ ] Align & distribute buttons (left/center/right, top/middle/bottom, spacing)

## Backlog / ideas
- [ ] Color: alpha/opacity per color; swatches saved in the document
- [ ] System clipboard integration (paste across tabs/apps)
- [ ] Text tool
- [ ] Nested groups / true group transform container
- [ ] Distribution: match an existing gap (not just centering)
- [ ] Configurable pencil smoothing strength

## Known issues / polish
- [x] Dragging the native color spectrum can add several undo steps (batch it)
- [ ] Resizing a rotated multi-selection is approximate (per-child rotation)

## User ideas / wishlist
- [ ] Rectangleの角丸
- [ ] 塗り機能
- [ ] グラデーション
- [ ] テクスチャ
- [ ] ラスタ画像
