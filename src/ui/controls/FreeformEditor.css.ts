import { vars } from "@/styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

/* The placement pad: the shape's box, with the real field drawn behind the
   point handles (a canvas, not a CSS approximation — see FreeformEditor.tsx). */
globalStyle(".freeform-pad", {
  position: "relative",
  width: "100%",
  aspectRatio: "3 / 2",
  margin: "2px 0 12px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  overflow: "hidden",
  touchAction: "none",
  cursor: "copy",
  // Transparency checkerboard behind a translucent field.
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%), " +
    "linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%)",
  backgroundSize: "10px 10px",
  backgroundPosition: "0 0, 5px 5px",
});

globalStyle(".freeform-pad canvas", {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
});

/* One colour point, centred on its position. */
globalStyle(".freeform-point", {
  position: "absolute",
  width: "14px",
  height: "14px",
  marginLeft: "-7px",
  marginTop: "-7px",
  border: `2px solid ${vars.panel}`,
  borderRadius: "50%",
  outline: `1px solid ${vars.border}`,
  background: "currentColor",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.35)",
  cursor: "move",
});

globalStyle(".freeform-point.selected", {
  outlineColor: vars.accent,
  outlineWidth: "2px",
});

/* The selected point's colour, position and weight. */
globalStyle(".freeform-point-row", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  marginBottom: "8px",
});
