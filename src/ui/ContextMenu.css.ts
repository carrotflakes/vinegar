import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

// Positioning (top/left/position) is applied inline by Floating UI; this only
// styles the surface and its contents.
globalStyle(".context-menu", {
  zIndex: "100",
  minWidth: "190px",
  padding: "4px",
  background: `${vars.panel2}`,
  border: `1px solid ${vars.border}`,
  borderRadius: "9px",
  boxShadow: `0 8px 28px ${vars.shadow}`,
  // The container is focusable (Floating UI focuses it on open); suppress the
  // UA focus ring so it doesn't flicker as focus moves between it and items.
  outline: "none",
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
  outline: "none",
});

// Highlight on pointer hover, keyboard focus, or while a submenu is open.
globalStyle(
  ".context-menu-item:hover:not(:disabled),\n" +
    ".context-menu-item:focus:not(:disabled),\n" +
    '.context-menu-item[aria-expanded="true"]:not(:disabled)',
  {
    background: vars.bg,
  }
);

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

globalStyle(".context-menu-caret", {
  fontSize: "14px",
  color: vars.muted,
});
