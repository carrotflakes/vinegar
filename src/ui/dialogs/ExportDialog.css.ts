import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../../styles/theme.css";

globalStyle(".export-modal", {
  width: "min(440px, calc(100vw - 32px))",
});

globalStyle(".export-body", {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  padding: "16px",
  maxHeight: "min(76vh, 640px)",
  overflowY: "auto",
});

/* --- Preview ------------------------------------------------------------ */

globalStyle(".export-preview", {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "150px",
  maxHeight: "240px",
  padding: "12px",
  borderRadius: "8px",
  border: `1px solid ${vars.border}`,
  // Checkerboard so transparency reads clearly.
  backgroundColor: vars.field,
  backgroundImage:
    "linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.18) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.18) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.18) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
});

globalStyle(".export-preview img", {
  maxWidth: "100%",
  maxHeight: "216px",
  objectFit: "contain",
  boxShadow: `0 2px 10px ${vars.shadow}`,
});

globalStyle(".export-preview-empty", {
  color: vars.muted,
  fontSize: "12px",
});

/* --- Size row ----------------------------------------------------------- */

globalStyle(".export-size", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
});

globalStyle(".export-num", {
  width: "84px",
  padding: "6px 9px",
  border: `1px solid ${vars.border}`,
  borderRadius: "7px",
  outline: "none",
  color: vars.text,
  background: vars.field,
  font: "inherit",
  fontSize: "13px",
});

globalStyle(".export-num:focus-visible", {
  borderColor: vars.accent,
});

globalStyle(".export-dims", {
  marginLeft: "auto",
  color: vars.muted,
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums",
});

globalStyle(".export-dims.over", {
  color: vars.danger,
});

/* --- Background swatch --------------------------------------------------- */

globalStyle(".export-swatch", {
  width: "34px",
  height: "26px",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  cursor: "pointer",
  background: "transparent",
});

globalStyle(".export-swatch:disabled", {
  opacity: "0.4",
  cursor: "not-allowed",
});
