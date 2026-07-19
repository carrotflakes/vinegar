import { vars } from "../../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".dock", {
  flex: "1 1 0",
  minHeight: "0",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

globalStyle(".dock-group", {
  position: "relative",
  minHeight: "0",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

/* Tab bar ------------------------------------------------------------------ */

globalStyle(".dock-tabs", {
  flex: "none",
  display: "flex",
  alignItems: "stretch",
  gap: "2px",
  padding: "4px 4px 0",
  background: vars.panel,
  borderBottom: `1px solid ${vars.border}`,
  overflowX: "auto",
  scrollbarWidth: "none",
});

globalStyle(".dock-tabs::-webkit-scrollbar", {
  display: "none",
});

globalStyle(".dock-tab", {
  display: "inline-flex",
  alignItems: "center",
  gap: "2px",
  flex: "none",
  maxWidth: "140px",
  padding: "5px 8px",
  borderRadius: "6px",
  border: "none",
  color: vars.muted,
  fontSize: "12px",
  cursor: "pointer",
  userSelect: "none",
});

globalStyle(".dock-tab:hover", {
  color: vars.text,
});

/* Active tab reads by weight + text colour alone — no border box or fill, to
   keep the bar quiet when several panels are stacked. */
globalStyle(".dock-tab.active", {
  color: vars.text,
  fontWeight: "600",
});

globalStyle(".dock-tab-label", {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

/* Close affordance is hidden until the tab is hovered, but always reserves its
   width so revealing it never nudges the layout. */
globalStyle(".dock-tab-close", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "15px",
  height: "15px",
  padding: "0",
  border: "none",
  borderRadius: "4px",
  background: "none",
  color: "inherit",
  opacity: "0",
  transition: "opacity 0.1s ease",
  cursor: "pointer",
});

globalStyle(".dock-tab:hover .dock-tab-close", {
  opacity: "0.5",
});

globalStyle(".dock-tab-close:hover", {
  opacity: "1",
  background: vars.border,
});

/* Add button stays a faint ghost, brightening on hover of the bar. */
globalStyle(".dock-add", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  width: "20px",
  padding: "0",
  margin: "1px 0 3px",
  border: "none",
  borderRadius: "5px",
  background: "none",
  color: vars.muted,
  opacity: "0",
  transition: "opacity 0.1s ease",
  cursor: "pointer",
});

globalStyle(".dock-tabs:hover .dock-add", {
  opacity: "0.6",
});

globalStyle(".dock-add:hover", {
  opacity: "1",
  color: vars.text,
});

/* Insertion marker between tabs while dragging. */
globalStyle(".dock-tab-drop", {
  flex: "none",
  alignSelf: "center",
  width: "2px",
  height: "20px",
  borderRadius: "2px",
  background: vars.accent,
});

/* Panel body --------------------------------------------------------------- */

globalStyle(".dock-body", {
  position: "relative",
  flex: "1 1 0",
  minHeight: "0",
  overflowY: "auto",
});

/* Split indicator: a bar at the group edge the panel would detach to. */
globalStyle(".dock-split-drop", {
  position: "absolute",
  left: "0",
  right: "0",
  height: "3px",
  background: vars.accent,
  zIndex: "2",
  pointerEvents: "none",
});

globalStyle(".dock-split-drop.top", { top: "0" });
globalStyle(".dock-split-drop.bottom", { bottom: "0" });

/* Divider between groups --------------------------------------------------- */

globalStyle(".dock-divider", {
  flex: "none",
  height: "7px",
  cursor: "ns-resize",
  background: vars.bg,
  borderTop: `1px solid ${vars.border}`,
  borderBottom: `1px solid ${vars.border}`,
  position: "relative",
  // Own the vertical gesture so a touch-drag resizes instead of scrolling.
  touchAction: "none",
});

globalStyle(".dock-divider::after", {
  content: "\"\"",
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "26px",
  height: "2px",
  borderRadius: "2px",
  background: vars.border,
});

globalStyle(".dock-divider:hover::after", {
  background: vars.accent,
});
