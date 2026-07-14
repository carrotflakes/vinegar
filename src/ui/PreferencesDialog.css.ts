import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css";

globalStyle(".preferences-modal", {
  width: "min(460px, calc(100vw - 32px))",
});

globalStyle(".preferences-body", {
  display: "flex",
  flexDirection: "column",
  gap: "22px",
  padding: "18px 16px",
  maxHeight: "min(70vh, 560px)",
  overflowY: "auto",
});

/* --- Sections ----------------------------------------------------------- */

globalStyle(".pref-section", {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
});

globalStyle(".pref-section-title", {
  margin: "0 0 4px",
  color: vars.muted,
  fontSize: "11px",
  fontWeight: "600",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
});

/* --- Rows --------------------------------------------------------------- */

globalStyle(".pref-row", {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  minHeight: "34px",
  padding: "5px 0",
});

globalStyle(".pref-text", {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  minWidth: "0",
});

globalStyle(".pref-title", {
  color: vars.text,
  fontSize: "13px",
});

globalStyle(".pref-desc", {
  color: vars.muted,
  fontSize: "11px",
  lineHeight: "1.35",
});

globalStyle(".pref-control", {
  flexShrink: "0",
});

/* --- Select ------------------------------------------------------------- */

globalStyle(".pref-select", {
  width: "160px",
  padding: "6px 9px",
  border: `1px solid ${vars.border}`,
  borderRadius: "7px",
  outline: "none",
  color: vars.text,
  background: vars.field,
  font: "inherit",
  fontSize: "13px",
  cursor: "pointer",
});

globalStyle(".pref-select:focus-visible", {
  borderColor: vars.accent,
});

globalStyle(".pref-select:disabled", {
  color: vars.muted,
  opacity: "0.6",
  cursor: "not-allowed",
});

/* --- Segmented control -------------------------------------------------- */

globalStyle(".pref-segmented", {
  display: "inline-flex",
  padding: "2px",
  gap: "2px",
  border: `1px solid ${vars.border}`,
  borderRadius: "8px",
  background: vars.field,
});

globalStyle(".pref-seg", {
  padding: "5px 12px",
  border: "none",
  borderRadius: "6px",
  color: vars.muted,
  background: "transparent",
  font: "inherit",
  fontSize: "12px",
  cursor: "pointer",
});

globalStyle(".pref-seg:hover", {
  color: vars.text,
});

globalStyle(".pref-seg.active", {
  color: vars.text,
  background: vars.panel2,
  boxShadow: `0 1px 2px ${vars.shadow}`,
});

/* --- Toggle switch ------------------------------------------------------ */

globalStyle(".pref-switch", {
  position: "relative",
  width: "38px",
  height: "22px",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "999px",
  background: vars.field,
  cursor: "pointer",
  transition: "background 120ms ease, border-color 120ms ease",
});

globalStyle(".pref-switch.on", {
  borderColor: vars.accent,
  background: vars.accent,
});

globalStyle(".pref-switch-knob", {
  position: "absolute",
  top: "50%",
  left: "3px",
  width: "16px",
  height: "16px",
  borderRadius: "50%",
  background: vars.text,
  transform: "translateY(-50%)",
  transition: "transform 120ms ease, background 120ms ease",
});

globalStyle(".pref-switch.on .pref-switch-knob", {
  background: "#fff",
  transform: "translate(16px, -50%)",
});

/* --- Footer buttons ----------------------------------------------------- */

globalStyle(".preferences-foot", {
  justifyContent: "space-between",
});

globalStyle(".preferences-button", {
  padding: "7px 13px",
  border: `1px solid ${vars.border}`,
  borderRadius: "7px",
  color: vars.text,
  background: vars.panel2,
  fontSize: "13px",
  cursor: "pointer",
});

globalStyle(".preferences-button:hover", {
  background: vars.hover,
});

globalStyle(".preferences-button.primary", {
  borderColor: vars.accent,
  color: "#fff",
  background: vars.accent,
});

globalStyle(".preferences-button.primary:hover", {
  background: vars.accent,
  filter: "brightness(1.05)",
});
