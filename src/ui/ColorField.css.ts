import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".swatch-text", {
  fontSize: "12px",
  color: vars.muted,
  fontVariantNumeric: "tabular-nums",
});

globalStyle(".color-swatch", {
  position: "relative",
  width: "28px",
  height: "24px",
  padding: "0",
  overflow: "hidden",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  backgroundColor: "#ffffff",
  backgroundImage: "linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%),\n    linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%)",
  backgroundSize: "10px 10px",
  backgroundPosition: "0 0, 5px 5px",
});

globalStyle(".swatch-fill", {
  position: "absolute",
  inset: "0",
});

globalStyle(".color-swatch.is-none", {
  background: `linear-gradient(45deg, transparent 45%, ${vars.danger} 45%, ${vars.danger} 55%, transparent 55%),
    #ffffff`,
});

globalStyle(".color-popover", {
  zIndex: "90",
  width: "220px",
  padding: "10px",
  background: `${vars.panel2}`,
  border: `1px solid ${vars.border}`,
  borderRadius: "9px",
  boxShadow: `0 10px 30px ${vars.shadow}`,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
});

globalStyle(".color-pop-row", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
});

globalStyle(".paint-type-row", {
  display: "flex",
  gap: "4px",
});

globalStyle(".paint-type-btn", {
  flex: "1",
  padding: "5px 2px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: vars.panel,
  color: vars.muted,
  fontSize: "11px",
});

globalStyle(".paint-type-btn.active", {
  borderColor: vars.accent,
  color: vars.accent,
  background: vars.accentWeak,
});

globalStyle(".gradient-bar", {
  height: "18px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
});

/* A selectable grid of the document's images (plus an import tile). */
globalStyle(".pattern-assets", {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))",
  gap: "6px",
});

globalStyle(".pattern-asset", {
  aspectRatio: "1",
  padding: "0",
  borderRadius: "6px",
  border: `1px solid ${vars.border}`,
  backgroundColor: vars.panel,
  backgroundSize: "cover",
  backgroundPosition: "center",
  cursor: "pointer",
});

globalStyle(".pattern-asset:hover", {
  borderColor: vars.muted,
});

globalStyle(".pattern-asset.selected", {
  borderColor: vars.accent,
  boxShadow: `0 0 0 1px ${vars.accent}`,
});

globalStyle(".pattern-asset-import", {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: vars.muted,
});

globalStyle(".pattern-asset-import:hover", {
  color: vars.text,
});

globalStyle(".gradient-stop", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
});

globalStyle(".gradient-stop .stop-color", {
  width: "26px",
  height: "22px",
  flex: "none",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "5px",
  background: "none",
});

globalStyle(".gradient-stop input[type=\"range\"]", {
  flex: "1",
  minWidth: "0",
});

globalStyle(".gradient-stop .stop-remove", {
  flex: "none",
  width: "22px",
  height: "22px",
  border: `1px solid ${vars.border}`,
  borderRadius: "5px",
  background: vars.panel,
  color: vars.muted,
  lineHeight: "1",
});

globalStyle(".gradient-stop .stop-remove:disabled", {
  opacity: "0.4",
});

globalStyle(".color-pop-alpha", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".color-pop-alpha input[type=\"range\"]", {
  flex: "1",
  minWidth: "0",
});

globalStyle(".color-pop-alpha .alpha-value", {
  minWidth: "34px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
});

globalStyle(".color-spectrum", {
  width: "34px",
  height: "28px",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: "none",
});

globalStyle(".hex-input", {
  flex: "1",
  minWidth: "0",
  padding: "5px 7px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums",
});

globalStyle(".none-btn", {
  padding: "5px 8px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: vars.panel,
  color: vars.muted,
  fontSize: "12px",
});

globalStyle(".none-btn.active", {
  borderColor: vars.accent,
  color: vars.accent,
});

globalStyle(".color-pop-label", {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: "11px",
  color: vars.muted,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
});

globalStyle(".swatch-add", {
  width: "18px",
  height: "18px",
  lineHeight: "1",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "4px",
  background: vars.panel,
  color: vars.muted,
  fontSize: "13px",
});

globalStyle(".swatch-add:hover:not(:disabled)", {
  borderColor: vars.accent,
  color: vars.accent,
});

globalStyle(".swatch-add:disabled", {
  opacity: "0.4",
  cursor: "default",
});

globalStyle(".swatch-hint", {
  gridColumn: "1 / -1",
  fontSize: "11px",
  color: vars.muted,
});

globalStyle(".swatch-grid", {
  display: "grid",
  gridTemplateColumns: "repeat(8, 1fr)",
  gap: "4px",
});

globalStyle(".mini-swatch", {
  width: "100%",
  aspectRatio: "1",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "4px",
  cursor: "pointer",
});

globalStyle(".mini-swatch:hover", {
  outline: `2px solid ${vars.accent}`,
  outlineOffset: "1px",
});

globalStyle(".align-btn", {
  fontSize: "15px",
  lineHeight: "1",
});

globalStyle(".geometry-grid", {
  display: "grid",
  gridTemplateColumns: "repeat(2, max-content)",
  gap: "6px 14px",
});

globalStyle(".geo-field", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
});

globalStyle(".geo-field > span", {
  width: "12px",
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".geo-field > input", {
  width: "62px",
  flex: "none",
  padding: "4px 6px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums",
  MozAppearance: "textfield",
  appearance: "textfield",
});
