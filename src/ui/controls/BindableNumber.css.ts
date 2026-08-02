import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../../styles/theme.css";

globalStyle(".bindable", {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "2px",
  minWidth: "0",
});

// The number keeps the width it would have alone; only the link button is new.
globalStyle(".bindable > input", {
  flex: "1 1 auto",
  minWidth: "0",
});

globalStyle(".bind-btn", {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "20px",
  height: "20px",
  padding: "0",
  border: "none",
  borderRadius: "5px",
  background: "transparent",
  color: vars.muted,
  cursor: "pointer",
});

globalStyle(".bind-btn:hover:not(:disabled)", {
  background: vars.bg,
  color: vars.text,
});

globalStyle(".bind-btn:disabled", {
  opacity: "0.35",
  cursor: "default",
});

globalStyle(".bind-btn.bound", {
  color: vars.accent,
});

globalStyle(".bind-btn.dangling", {
  color: vars.danger,
});

globalStyle(".bind-menu", {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: "0",
  zIndex: "40",
  minWidth: "170px",
  maxHeight: "240px",
  overflowY: "auto",
  padding: "4px",
  borderRadius: "8px",
  border: `1px solid ${vars.border}`,
  background: vars.panel,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
});

globalStyle(".bind-menu-head", {
  padding: "4px 8px",
  fontSize: "11px",
  color: vars.muted,
});

globalStyle(".bind-menu-sep", {
  margin: "4px 6px",
  borderTop: `1px solid ${vars.border}`,
});

globalStyle(".bind-menu-item", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  width: "100%",
  padding: "5px 8px",
  border: "none",
  borderRadius: "6px",
  background: "transparent",
  color: vars.text,
  fontSize: "12px",
  textAlign: "left",
  cursor: "pointer",
});

globalStyle(".bind-menu-item:hover", {
  background: vars.bg,
});

globalStyle(".bind-menu-name", {
  flex: "1",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

globalStyle(".bind-menu-value", {
  flex: "0 0 auto",
  color: vars.muted,
  fontVariantNumeric: "tabular-nums",
});
