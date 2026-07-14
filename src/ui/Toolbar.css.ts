import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".toolbar", {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "3px",
});

globalStyle(".tool-btn", {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "38px",
  height: "38px",
  padding: "0",
  border: "1px solid transparent",
  borderRadius: "8px",
  background: "transparent",
  color: vars.muted,
});

globalStyle(".tool-btn:hover", {
  background: vars.hover,
  color: vars.text,
});

globalStyle(".tool-btn.active", {
  background: vars.accentWeak,
  borderColor: vars.accentBorder,
  color: vars.accent,
});

globalStyle(".tool-icon", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "18px",
});

globalStyle(".tool-sep", {
  width: "22px",
  height: "1px",
  margin: "4px 0",
  background: vars.border,
});
