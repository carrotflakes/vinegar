import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".text-editor-overlay", {
  position: "absolute",
  left: "0",
  top: "0",
  zIndex: "8",
  boxSizing: "border-box",
  minWidth: "1px",
  minHeight: "1px",
  margin: "0",
  padding: "0",
  border: "0",
  borderRadius: "0",
  outline: `1px solid ${vars.accent}`,
  outlineOffset: "1px",
  background: "transparent",
  overflow: "hidden",
  resize: "none",
  transformOrigin: "0 0",
  whiteSpace: "pre-wrap",
  overflowWrap: "normal",
});

globalStyle(".text-editor-overlay:focus-visible", {
  outline: `1px solid ${vars.accent}`,
  outlineOffset: "1px",
  boxShadow: "none",
});
