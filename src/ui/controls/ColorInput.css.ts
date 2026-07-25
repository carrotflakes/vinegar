import { vars } from "@/styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

/* Swatch button standing in for `<input type="color">`; sized like one. */
globalStyle(".color-input", {
  position: "relative",
  width: "28px",
  height: "24px",
  flex: "none",
  padding: "0",
  overflow: "hidden",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  cursor: "pointer",
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%),\n    linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 4px 4px",
});

globalStyle(".color-input:hover:not(:disabled)", {
  borderColor: vars.accent,
});

globalStyle(".color-input:disabled", {
  opacity: "0.4",
  cursor: "default",
});

globalStyle(".color-input-fill", {
  position: "absolute",
  inset: "0",
});

/* The picker popover is denser than ColorField's paint popover. */
globalStyle(".color-input-popover", {
  width: "212px",
});
