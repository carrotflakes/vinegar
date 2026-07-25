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

// Overrides ColorInput's default swatch size; kept specific so the rule wins
// regardless of stylesheet order.
globalStyle(".swatch-row .swatch-chip", {
  position: "relative",
  width: "20px",
  height: "20px",
  flex: "0 0 auto",
  overflow: "hidden",
  border: `1px solid ${vars.border}`,
  borderRadius: "5px",
  cursor: "pointer",
});

