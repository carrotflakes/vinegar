import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".context-menu", {
  position: "fixed",
  zIndex: "100",
  minWidth: "190px",
  padding: "4px",
  background: `${vars.panel2}`,
  border: `1px solid ${vars.border}`,
  borderRadius: "9px",
  boxShadow: `0 8px 28px ${vars.shadow}`,
});

globalStyle(".context-menu-item", {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  width: "100%",
  padding: "6px 10px",
  border: "none",
  borderRadius: "6px",
  background: "transparent",
  color: vars.text,
  fontSize: "13px",
  textAlign: "left",
  cursor: "default",
});

globalStyle(".context-menu-item:hover:not(:disabled)", {
  background: vars.bg,
});

globalStyle(".context-menu-item:disabled", {
  opacity: "0.4",
});

globalStyle(".context-menu-item.danger", {
  color: vars.danger,
});

globalStyle(".context-menu-label", {
  flex: "1",
  whiteSpace: "nowrap",
});

globalStyle(".context-menu-shortcut", {
  fontSize: "11px",
  color: vars.muted,
  whiteSpace: "nowrap",
});

globalStyle(".context-menu-sep", {
  height: "1px",
  margin: "4px 6px",
  background: vars.border,
});

globalStyle(".context-menu-subitem", {
  position: "relative",
});

// Highlight the parent row while its submenu is open (hover covers the rest).
globalStyle(".context-menu-subitem:hover > .context-menu-item:not(:disabled)", {
  background: vars.bg,
});

globalStyle(".context-menu-caret", {
  fontSize: "10px",
  color: vars.muted,
});

globalStyle(".context-menu-nested", {
  position: "absolute",
  top: "-5px",
});
