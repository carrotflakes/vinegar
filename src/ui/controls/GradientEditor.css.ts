import { vars } from "@/styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

/* The stop ramp: a checkerboard-backed bar the handles sit on. */
globalStyle(".gradient-track", {
  position: "relative",
  height: "26px",
  margin: "2px 0 12px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  backgroundColor: "#ffffff",
  // Ramp on top, transparency checkerboard behind it (see GradientEditor.tsx).
  backgroundSize: "auto, 10px 10px, 10px 10px",
  backgroundPosition: "0 0, 0 0, 5px 5px",
  touchAction: "none",
  cursor: "copy",
});

/* One stop: a colour chip pinned to its offset. */
globalStyle(".gradient-handle", {
  position: "absolute",
  top: "-3px",
  width: "12px",
  height: "32px",
  marginLeft: "-6px",
  border: `2px solid ${vars.panel}`,
  borderRadius: "4px",
  outline: `1px solid ${vars.border}`,
  background: "currentColor",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.35)",
  cursor: "ew-resize",
});

globalStyle(".gradient-handle.selected", {
  outlineColor: vars.accent,
  outlineWidth: "2px",
});

/* The blend midpoint between two stops (Illustrator's diamond). */
globalStyle(".gradient-midpoint", {
  position: "absolute",
  top: "8px",
  width: "9px",
  height: "9px",
  marginLeft: "-4.5px",
  border: `1px solid ${vars.border}`,
  background: vars.panel,
  transform: "rotate(45deg)",
  cursor: "ew-resize",
});
