import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".canvas-wrap", {
  position: "absolute",
  inset: "0",
  overflow: "hidden",
});

globalStyle(".canvas", {
  display: "block",
  touchAction: "none",
});

globalStyle(".symbol-edit-bar", {
  position: "absolute",
  top: "10px",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "6px 8px 6px 14px",
  background: `${vars.panel2}`,
  border: `1px solid ${vars.border}`,
  borderRadius: "10px",
  boxShadow: `0 4px 18px ${vars.shadow}`,
  fontSize: "12.5px",
});

globalStyle(".symbol-edit-label", {
  color: vars.text,
  whiteSpace: "nowrap",
});

globalStyle(".symbol-edit-done", {
  padding: "4px 12px",
  border: "none",
  borderRadius: "7px",
  background: vars.accent,
  color: "#fff",
  fontSize: "12px",
});
