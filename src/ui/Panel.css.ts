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

globalStyle(".field-row input[type=\"color\"]", {
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

globalStyle(".icon-btn", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
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

globalStyle(".btn-row", {
  display: "flex",
  gap: "6px",
});

globalStyle(".ghost-btn", {
  flex: "1",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "7px 10px",
  border: `1px solid ${vars.border}`,
  borderRadius: "7px",
  background: vars.panel,
  color: vars.text,
  fontSize: "12.5px",
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
  padding: "2px 6px",
  minWidth: "0",
  lineHeight: "1",
});
