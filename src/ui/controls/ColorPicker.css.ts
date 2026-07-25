import { vars } from "@/styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

/* Checkerboard shown under anything partially transparent. */
const checker = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%),\n    linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 4px 4px",
};

globalStyle(".color-picker", {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
});

/* Saturation (x) by brightness (y), painted over the pure hue. */
globalStyle(".cp-area", {
  position: "relative",
  height: "120px",
  borderRadius: "6px",
  border: `1px solid ${vars.border}`,
  touchAction: "none",
  cursor: "crosshair",
});

globalStyle(".cp-area:focus-visible", {
  outline: `2px solid ${vars.accent}`,
  outlineOffset: "1px",
});

globalStyle(".cp-area-sat, .cp-area-val", {
  position: "absolute",
  inset: "0",
  borderRadius: "5px",
  pointerEvents: "none",
});

globalStyle(".cp-area-sat", {
  backgroundImage: "linear-gradient(to right, #ffffff, rgba(255, 255, 255, 0))",
});

globalStyle(".cp-area-val", {
  backgroundImage: "linear-gradient(to top, #000000, rgba(0, 0, 0, 0))",
});

globalStyle(".cp-sliders", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
});

/* Current colour, over a checkerboard so alpha reads. */
globalStyle(".cp-preview", {
  position: "relative",
  flex: "none",
  width: "28px",
  height: "28px",
  borderRadius: "50%",
  border: `1px solid ${vars.border}`,
  overflow: "hidden",
  ...checker,
});

globalStyle(".cp-preview-fill", {
  position: "absolute",
  inset: "0",
});

globalStyle(".cp-tracks", {
  flex: "1",
  minWidth: "0",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
});

globalStyle(".cp-hue, .cp-alpha", {
  position: "relative",
  height: "10px",
  borderRadius: "5px",
  border: `1px solid ${vars.border}`,
  touchAction: "none",
  cursor: "pointer",
});

globalStyle(".cp-hue:focus-visible, .cp-alpha:focus-visible", {
  outline: `2px solid ${vars.accent}`,
  outlineOffset: "1px",
});

globalStyle(".cp-hue", {
  backgroundImage:
    "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
});

globalStyle(".cp-alpha", checker);

globalStyle(".cp-alpha-fill", {
  position: "absolute",
  inset: "0",
  borderRadius: "4px",
  pointerEvents: "none",
});

/* Shared draggable knob for the area and both tracks. */
globalStyle(".cp-thumb", {
  position: "absolute",
  top: "50%",
  width: "14px",
  height: "14px",
  marginLeft: "-7px",
  marginTop: "-7px",
  borderRadius: "50%",
  border: "2px solid #ffffff",
  boxShadow: `0 0 0 1px ${vars.shadow}, 0 1px 3px ${vars.shadow}`,
  pointerEvents: "none",
});

globalStyle(".cp-extras", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
});

/* Trailing readout (ColorField's alpha percentage). */
globalStyle(".cp-extras .alpha-value", {
  minWidth: "34px",
  textAlign: "right",
  fontSize: "12px",
  color: vars.muted,
  fontVariantNumeric: "tabular-nums",
});
