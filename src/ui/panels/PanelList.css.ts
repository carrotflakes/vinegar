import { vars } from "../../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".layer-row.hidden .layer-name,\n.layer-row.hidden .layer-type", {
  opacity: "0.45",
});

globalStyle(".layers", {
  flex: "1 1 auto",
  // Fill the dock body even when the rows do not: the space under the last row
  // is then part of the list, which is what lets a drag drop there (bottom of
  // the root) instead of falling outside the panel onto nothing.
  minHeight: "100%",
  display: "flex",
  flexDirection: "column",
  // Deliberately not a scroll container: the dock body is what scrolls the
  // panel, and clipping here would make the sticky header stick to this box
  // (which never scrolls) instead of to the viewport it scrolls out of.
  overflow: "visible",
});

// The title and the focus breadcrumb stay put while the rows scroll past: the
// panel's actions, and which container the tree is showing, are needed most in
// a long list — exactly when they would otherwise be scrolled away.
globalStyle(".layers-header", {
  position: "sticky",
  top: "0",
  zIndex: "1",
  background: vars.panel,
});

globalStyle(".layers-title", {
  padding: "12px 14px 6px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
});

/* Trailing header action (e.g. Swatches' "add"): don't let the 22px button
   inflate the title row past its plain-text height in other panels. */
globalStyle(".title-add", {
  flex: "none",
  marginBlock: "-6px",
});

/* Several trailing actions: they keep the title's plain-text height the same
   way `title-add` does, but stay grouped at the end rather than being spread
   out by the title's space-between. */
globalStyle(".title-actions", {
  flex: "none",
  display: "flex",
  alignItems: "center",
  gap: "2px",
  marginBlock: "-6px",
});

globalStyle(".layers-list", {
  flex: "1",
  overflowY: "auto",
  // A row swiped right would otherwise count as horizontal overflow and give
  // the list a scrollbar; clipping it is also what hides the swipe hint until
  // the row has actually moved.
  overflowX: "hidden",
  padding: "0 6px 8px",
});

// The list takes focus on pointerdown so arrow keys can walk its rows; a ring
// around the whole panel would only be noise there. Keyboard focus (Tab) gets a
// visible ring instead, and the cursor row is marked while the list holds focus
// so arrow navigation is followable even when it diverges from the selection.
globalStyle(".layers-list:focus", {
  outline: "none",
});
globalStyle(".layers-list:focus-visible", {
  outline: `2px solid ${vars.accent}`,
  outlineOffset: "-2px",
  borderRadius: "8px",
});
globalStyle(".layers-list:focus-visible .layer-row.cursor", {
  boxShadow: `inset 0 0 0 1px ${vars.accent}`,
});

globalStyle(".layers-empty", {
  padding: "10px 8px",
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".layer-row", {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "4px",
  padding: "5px 6px",
  borderRadius: "7px",
  cursor: "default",
  userSelect: "none",
  // Vertical panning stays the browser's; the horizontal axis is the row's own
  // swipe-to-menu gesture, which iOS would otherwise read as a navigation.
  touchAction: "pan-y",
});

// The row springs back once the finger lifts, but follows it 1:1 while the
// swipe is live — a transition there would lag behind the finger.
globalStyle(".layer-row:not(.swiping)", {
  transition: "transform 140ms ease-out",
});

globalStyle(".layer-swipe-hint", {
  position: "absolute",
  right: "100%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "24px",
  color: vars.muted,
  pointerEvents: "none",
});

// Past the trigger distance: releasing now opens the menu.
globalStyle(".layer-swipe-hint.armed", {
  color: vars.accent,
});

globalStyle(".generator-row:not(.disabled)", {
  cursor: "grab",
});

globalStyle(".layers:not(.dragging) .layer-row:hover", {
  background: vars.bg,
});

globalStyle(".layer-row.selected", {
  background: vars.accentWeak,
});

// Hovering a selected row deepens its accent rather than falling back to the
// plain hover grey — that rule carries the higher specificity, so without this
// the pointer would paint over the very state the row is reporting.
globalStyle(".layers:not(.dragging) .layer-row.selected:hover", {
  background: vars.accentSoft,
});

globalStyle(".layer-row.drop-inside", {
  background: vars.accentWeak,
  outline: `2px solid ${vars.accent}`,
  outlineOffset: "-2px",
});

globalStyle(".layer-icon-btn", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "22px",
  height: "22px",
  padding: "0",
  border: "none",
  borderRadius: "5px",
  background: "transparent",
  color: vars.muted,
});

globalStyle(".layer-icon-btn:hover", {
  background: vars.hover,
  color: vars.text,
});

// A latched toggle (the title bar's multi-select), as opposed to the momentary
// buttons around it.
globalStyle(".layer-icon-btn.active", {
  background: vars.accentWeak,
  color: vars.accent,
});

globalStyle(".layer-state-btn.state-idle", {
  opacity: "0.4",
});

globalStyle(".layer-state-btn.state-set", {
  color: vars.text,
});

globalStyle(".layer-state-btn:hover", {
  opacity: "1",
});

globalStyle(".layer-type", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "16px",
  color: vars.muted,
  fontSize: "14px",
});

globalStyle(".layer-name", {
  flex: "1",
  fontSize: "13px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

globalStyle(".layer-name-input", {
  flex: "1",
  fontSize: "13px",
  padding: "2px 5px",
  border: `1px solid ${vars.accent}`,
  borderRadius: "5px",
  minWidth: "0",
});

globalStyle(".layer-row.group-header .layer-name", {
  fontWeight: "600",
});

globalStyle(".layer-chevron", {
  width: "16px",
  fontSize: "10px",
  color: vars.muted,
});

globalStyle(".layer-count", {
  fontSize: "11px",
  color: vars.muted,
  paddingRight: "4px",
});

// Rows are uniform, so the drop indicator is placed by row index rather than
// inserted between rows — inserting one would shift every offset the windowed
// list computes from that index.
globalStyle(".layers-rows", {
  position: "relative",
  // The list windows itself: rows enter and leave the DOM as it scrolls, and a
  // collapse or a hide rewrites the rows above the viewport. Browser scroll
  // anchoring would answer each of those by nudging scrollTop, which both
  // fights the windowing (its own re-measure then picks another slice) and
  // makes a fold jump the view. The panel decides its own scrolling.
  overflowAnchor: "none",
});

globalStyle(".drop-line", {
  position: "absolute",
  left: 0,
  right: "6px",
  height: "2px",
  marginTop: "-1px",
  background: vars.accent,
  borderRadius: "2px",
  // The line sits directly under the pointer. Keep it transparent to
  // elementFromPoint so the Layers drag continues to hit the adjacent row
  // instead of briefly treating the pointer as being over the list itself.
  pointerEvents: "none",
});

globalStyle(".drop-line::before", {
  content: "\"\"",
  position: "absolute",
  left: "-3px",
  top: "-2px",
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: vars.accent,
});

globalStyle(".layers-scope", {
  display: "flex",
  alignItems: "center",
  gap: "4px",
  margin: "0 6px 2px",
  padding: "5px 8px",
  border: "none",
  borderRadius: "7px",
  background: "transparent",
  color: vars.accent,
  fontSize: "12.5px",
  textAlign: "left",
});

globalStyle(".layers-scope:hover", {
  background: vars.bg,
});

globalStyle(".layer-symbol-ref", {
  color: vars.muted,
  fontSize: "11px",
});

globalStyle(".symbols", {
  flex: "0 0 auto",
  maxHeight: "40%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderTop: `1px solid ${vars.border}`,
});

globalStyle(".symbols .section-title", {
  padding: "10px 14px 6px",
});

globalStyle(".symbols-list", {
  overflowY: "auto",
  padding: "0 6px 8px",
});

globalStyle(".symbol-row", {
  display: "flex",
  alignItems: "center",
  gap: "4px",
  padding: "4px 6px",
  borderRadius: "7px",
  cursor: "grab",
});

globalStyle(".symbol-row:hover", {
  background: vars.bg,
});

globalStyle(".symbol-row.selected", {
  background: vars.accentSoft,
});

globalStyle(".symbol-row .layer-name", {
  flex: "1",
});
