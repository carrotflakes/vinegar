import { vars } from "../../../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".swatch-row", {
  display: "flex",
  alignItems: "center",
  gap: "4px",
  padding: "4px 6px",
  borderRadius: "7px",
});

globalStyle(".swatch-row:hover", {
  background: vars.bg,
});

globalStyle(".swatch-row .layer-name", {
  flex: "1",
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

