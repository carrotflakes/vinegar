import { vars } from "../../../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".stroke-detail-grid select,\n.stroke-offset", {
  width: "100%",
});

globalStyle(".num", {
  width: "56px",
  padding: "4px 6px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  fontSize: "12px",
});

/* Identity row at the top of the properties panel: what is selected, and its
 * name. Tighter than a normal section — it is a caption, not a control group. */
globalStyle(".section.selection-header", {
  gap: "8px",
  paddingBlock: "10px",
});

globalStyle(".selection-name", {
  width: "100%",
  boxSizing: "border-box",
  padding: "4px 6px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  fontSize: "12px",
});

globalStyle(".checkbox-row", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".blend-select", {
  padding: "4px 24px 4px 8px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  fontSize: "12px",
});

globalStyle(".stroke-details", {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
});

globalStyle(".stroke-detail-grid", {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px",
});

globalStyle(".stroke-detail-grid label", {
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  minWidth: "0",
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".brush-options-grid", {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px",
});

globalStyle(".brush-options-grid label", {
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  minWidth: "0",
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".brush-options-grid .num", {
  boxSizing: "border-box",
  width: "100%",
});

globalStyle(".dash-input", {
  width: "100%",
  padding: "5px 7px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  fontSize: "12px",
});

globalStyle(".dash-input.invalid", {
  borderColor: vars.danger,
  outlineColor: vars.danger,
});

/* One row per end of the path: which marker, how big, and its two toggles. */
globalStyle(".marker-rows", {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
});

globalStyle(".marker-row", {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto auto auto",
  alignItems: "center",
  gap: "6px",
});

globalStyle(".marker-end-label", {
  minWidth: "34px",
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".marker-shape-select", {
  width: "100%",
  minWidth: "0",
});

globalStyle(".marker-scale", {
  width: "48px",
});

globalStyle(".marker-toggle", {
  padding: "4px 7px",
  fontSize: "11px",
});

globalStyle(".marker-toggle.active", {
  background: vars.accentSoft,
  borderColor: vars.accent,
  color: vars.text,
});

/* .ghost-btn already dims when disabled; the native controls do not. */
globalStyle(".marker-row select:disabled,\n.marker-row input:disabled", {
  opacity: "0.45",
});

globalStyle(".readout", {
  textAlign: "right",
  color: vars.muted,
});

globalStyle(".effect-card", {
  // Filled recessed card instead of an outlined box: reads as a group without
  // the heavy border, and the section gap handles spacing between cards.
  background: vars.bg,
  borderRadius: "8px",
  padding: "8px 10px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
});

globalStyle(".effect-head", {
  alignItems: "center",
});

globalStyle(".effect-name", {
  flex: "1 1 auto",
  fontSize: "12px",
  fontWeight: "600",
});

globalStyle(".effect-card .geo-field > span", {
  width: "auto",
  minWidth: "12px",
});

globalStyle(".instance-symbol-name", {
  fontSize: "12.5px",
});
