import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

/* Cursor-following preview for a panel item being dragged onto the canvas. */
globalStyle(".panel-drag-ghost", {
  position: "fixed",
  left: "0",
  top: "0",
  // Offset from the pointer so the finger/cursor doesn't cover it.
  transform: "translate(12px, 12px)",
  zIndex: "1000",
  pointerEvents: "none",
  display: "flex",
  alignItems: "center",
  gap: "6px",
  maxWidth: "200px",
  padding: "5px 9px",
  borderRadius: "7px",
  background: vars.panel,
  border: `1px solid ${vars.border}`,
  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
  color: vars.text,
  fontSize: "12px",
  whiteSpace: "nowrap",
  opacity: "0.95",
});

globalStyle(".panel-drag-ghost img", {
  width: "28px",
  height: "28px",
  objectFit: "contain",
  borderRadius: "4px",
});

globalStyle(".panel-drag-ghost span", {
  overflow: "hidden",
  textOverflow: "ellipsis",
});
