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

globalStyle(".swatch-chip", {
  position: "relative",
  width: "20px",
  height: "20px",
  flex: "0 0 auto",
  overflow: "hidden",
  border: `1px solid ${vars.border}`,
  borderRadius: "5px",
  cursor: "pointer",
});

// The native colour input drives the chip but stays invisible over it.
globalStyle(".swatch-chip input", {
  position: "absolute",
  inset: "0",
  width: "100%",
  height: "100%",
  padding: "0",
  margin: "0",
  border: "none",
  opacity: "0",
  cursor: "pointer",
});
