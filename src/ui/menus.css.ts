import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".menu-root", {
  position: "relative",
  display: "flex",
});

// Positioning (position/top/left) is applied inline by Floating UI (see
// ui/menu/Popover.tsx); this only styles the panel surface.
globalStyle(".menu-popover", {
  zIndex: "100",
  minWidth: "170px",
  padding: "5px",
  background: `${vars.panel2}`,
  border: `1px solid ${vars.border}`,
  borderRadius: "8px",
  boxShadow: `0 8px 28px ${vars.shadow}`,
  display: "flex",
  flexDirection: "column",
  outline: "none",
});

globalStyle(".menu-item", {
  textAlign: "left",
  padding: "7px 10px",
  border: "none",
  borderRadius: "6px",
  background: "transparent",
  color: vars.text,
  fontSize: "13px",
});

globalStyle(".menu-item:disabled", {
  color: vars.muted,
  opacity: "0.55",
  cursor: "default",
});

globalStyle(".menu-item:hover:not(:disabled)", {
  background: vars.accentWeak,
  color: vars.accent,
});

globalStyle(".menu-divider", {
  margin: "5px 6px",
  borderTop: `1px solid ${vars.border}`,
});

globalStyle(".menu-caret", {
  color: vars.muted,
  fontSize: "14px",
});
