import { vars } from "../styles/theme.css";
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

globalStyle(".artboard-name", {
  flex: "1",
  padding: "4px 6px",
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

globalStyle(".readout", {
  textAlign: "right",
  color: vars.muted,
});

globalStyle(".effect-card", {
  border: `1px solid ${vars.border}`,
  borderRadius: "8px",
  padding: "8px",
  marginBottom: "8px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
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
