import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".modal-overlay:has(.palette-modal)", {
  alignItems: "flex-start",
});

globalStyle(".palette-modal", {
  width: "min(560px, 92vw)",
  maxHeight: "min(60vh, 520px)",
  marginTop: "12vh",
  overflow: "hidden",
});

globalStyle(".palette-input", {
  border: "none",
  outline: "none",
  padding: "14px 16px",
  fontSize: "15px",
  color: vars.text,
  background: "transparent",
  borderBottom: `1px solid ${vars.border}`,
});

globalStyle(".palette-list", {
  flex: "1",
  minHeight: "0",
  overflowY: "auto",
  padding: "6px",
  display: "flex",
  flexDirection: "column",
});

globalStyle(".palette-empty", {
  padding: "16px",
  textAlign: "center",
  color: vars.muted,
  fontSize: "13px",
});

globalStyle(".palette-item", {
  display: "flex",
  alignItems: "baseline",
  gap: "10px",
  textAlign: "left",
  padding: "8px 10px",
  border: "none",
  borderRadius: "7px",
  background: "transparent",
  color: vars.text,
  fontSize: "13px",
});

globalStyle(".palette-item.active", {
  background: vars.accentWeak,
  color: vars.accent,
});

globalStyle(".palette-item.disabled", {
  opacity: "0.4",
});

globalStyle(".palette-group", {
  flex: "none",
  width: "68px",
  fontSize: "11px",
  color: vars.muted,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
});

globalStyle(".palette-label", {
  flex: "1",
});

globalStyle(".palette-shortcut", {
  flex: "none",
  fontSize: "12px",
  color: vars.muted,
  fontVariantNumeric: "tabular-nums",
});
