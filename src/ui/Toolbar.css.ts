import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".toolbar", {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "2px",
});

globalStyle(".tool-btn", {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "32px",
  height: "32px",
  padding: "0",
  border: "1px solid transparent",
  borderRadius: "7px",
  background: "transparent",
  color: vars.muted,
});

globalStyle(".tool-btn:hover", {
  background: vars.hover,
  color: vars.text,
});

globalStyle(".tool-btn.active", {
  background: vars.accentWeak,
  color: vars.accent,
});

globalStyle(".tool-icon", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "16px",
});

globalStyle(".tool-sep", {
  width: "18px",
  height: "1px",
  margin: "3px 0",
  background: vars.border,
});
