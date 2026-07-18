import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".modifier-bar", {
  position: "absolute",
  left: "10px",
  bottom: "10px",
  display: "flex",
  gap: "6px",
  zIndex: "5",
});

globalStyle(".modifier-btn", {
  minWidth: "52px",
  padding: "9px 12px",
  border: `1px solid ${vars.border}`,
  borderRadius: "9px",
  background: `${vars.panel2}`,
  color: vars.text,
  fontSize: "13px",
  fontWeight: "600",
  boxShadow: `0 4px 14px ${vars.shadow}`,
  touchAction: "manipulation",
});

globalStyle(".modifier-btn.active", {
  background: vars.accent,
  borderColor: vars.accent,
  color: "#fff",
});
