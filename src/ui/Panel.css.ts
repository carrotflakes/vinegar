import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".geo-field > input::-webkit-outer-spin-button,\n.geo-field > input::-webkit-inner-spin-button", {
  WebkitAppearance: "none",
  margin: "0",
});

globalStyle(".panel", {
  display: "flex",
  flexDirection: "column",
});

globalStyle(".panel-section", {
  padding: "14px",
  borderBottom: `1px solid ${vars.border}`,
  display: "flex",
  flexDirection: "column",
  gap: "12px",
});

globalStyle(".panel-title", {
  fontSize: "12px",
  fontWeight: "600",
  color: vars.muted,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
});

globalStyle(".field", {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
});

globalStyle(".field > label", {
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".field-row", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
});

globalStyle(".field-row input[type=\"range\"]", {
  flex: "1",
});

/* Compact single-row field: label on the left, control on the right. Used to
 * keep the properties dock dense now that sliders are gone. */
globalStyle(".field-inline", {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
});

globalStyle(".field-inline > label", {
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".num-suffix", {
  display: "flex",
  alignItems: "center",
  gap: "4px",
});

globalStyle(".num-suffix .unit", {
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".field-row input[type=\"color\"],\n.field-inline input[type=\"color\"]", {
  width: "30px",
  height: "26px",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: "none",
});

globalStyle(".stroke-presets .ghost-btn", {
  minWidth: "0",
  paddingInline: "8px",
});

globalStyle(".btn-row", {
  display: "flex",
  gap: "6px",
});

/* Equal-width split is a property of the button row, not the button itself,
 * so a lone .ghost-btn placed elsewhere sizes to its content. */
globalStyle(".btn-row .ghost-btn", {
  flex: "1",
});

globalStyle(".ghost-btn", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "4px 8px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: vars.panel,
  color: vars.text,
  fontSize: "12px",
});

globalStyle(".ghost-btn:hover:not(:disabled)", {
  background: vars.bg,
});

globalStyle(".ghost-btn:disabled", {
  opacity: "0.45",
  cursor: "default",
});

globalStyle(".ghost-btn.danger", {
  color: vars.danger,
  borderColor: vars.dangerBorder,
});

globalStyle(".ghost-btn.danger:hover", {
  background: vars.dangerWeak,
});

globalStyle(".icon-btn", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "26px",
  height: "26px",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: vars.panel,
  color: vars.muted,
});

globalStyle(".icon-btn:hover", {
  background: vars.bg,
  color: vars.text,
});
