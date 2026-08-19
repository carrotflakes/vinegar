import { vars } from "@/styles/theme.css";
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

/* Disagreeing selection: neither a colour nor "none" would be true, so the
   swatch shows a neutral dash instead of any paint. */
globalStyle(".color-swatch.is-mixed", {
  background: vars.panel,
  color: vars.muted,
});

globalStyle(".color-swatch.is-mixed::after", {
  content: '"–"',
  position: "absolute",
  inset: "0",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "12px",
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

globalStyle(".paint-type-row", {
  display: "flex",
  gap: "4px",
  // Five paint kinds do not fit one 220 px row; they wrap rather than clip.
  flexWrap: "wrap",
});

globalStyle(".paint-type-btn", {
  flex: "1 1 52px",
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

/* Tile origin / fill pan: a label plus X and Y number inputs. */
globalStyle(".pattern-offset", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
});

globalStyle(".pattern-offset .alpha-label", {
  flex: "none",
});

globalStyle(".offset-input", {
  flex: "1",
  display: "flex",
  alignItems: "center",
  gap: "4px",
  fontSize: "11px",
  color: vars.muted,
});

globalStyle(".offset-input input", {
  width: "100%",
  minWidth: "0",
  padding: "3px 6px",
  border: `1px solid ${vars.border}`,
  borderRadius: "5px",
  background: vars.panel,
  color: vars.text,
  fontVariantNumeric: "tabular-nums",
});

globalStyle(".gradient-stop", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
});

/* Sizes ColorInput down for the stop rows; its own checkerboard is kept. */
globalStyle(".gradient-stop .stop-color", {
  width: "26px",
  height: "22px",
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

globalStyle(".swatch-link-badge", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  margin: "8px 0 4px",
  padding: "6px 8px",
  fontSize: "12px",
  color: vars.muted,
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
});

globalStyle(".swatch-link-name", {
  flex: "1",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
});

globalStyle(".swatch-unlink", {
  padding: "2px 8px",
  fontSize: "11px",
  color: vars.text,
  border: `1px solid ${vars.border}`,
  borderRadius: "4px",
  background: "transparent",
  cursor: "pointer",
});

globalStyle(".swatch-unlink:hover", {
  borderColor: vars.accent,
  color: vars.accent,
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
