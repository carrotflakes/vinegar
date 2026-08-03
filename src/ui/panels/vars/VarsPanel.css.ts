import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../../../styles/theme.css";

globalStyle(".swatch-row, .param-row", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 6px",
  borderRadius: "7px",
});

globalStyle(".swatch-row", {
  gap: "4px",
});

globalStyle(".swatch-row:hover, .param-row:hover", {
  background: vars.bg,
});

globalStyle(".swatch-row .layer-name, .param-row .layer-name", {
  flex: "1",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

globalStyle(".param-row .param-value", {
  flex: "0 0 auto",
  width: "68px",
});

// Overrides ColorField's default swatch size; kept specific so the rule wins
// regardless of stylesheet order.
globalStyle(".swatch-row .color-swatch", {
  width: "20px",
  height: "20px",
  flex: "0 0 auto",
  borderRadius: "5px",
  cursor: "pointer",
});

/** The kind heading inside the merged variables list. */
globalStyle(".vars-group-title", {
  padding: "6px 8px 2px",
  fontSize: "11px",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: vars.muted,
});
