import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css";

globalStyle(".symbol-crumbs", {
  position: "absolute",
  top: "10px",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: "5",
  display: "flex",
  alignItems: "center",
  gap: "2px",
  maxWidth: "min(70%, 560px)",
  padding: "4px 6px",
  background: `${vars.panel2}`,
  border: `1px solid ${vars.border}`,
  borderRadius: "999px",
  boxShadow: `0 4px 18px ${vars.shadow}`,
  fontSize: "12.5px",
});

globalStyle(".symbol-crumb", {
  display: "flex",
  alignItems: "center",
  gap: "5px",
  minWidth: "0",
  padding: "4px 10px",
  border: "none",
  borderRadius: "999px",
  background: "transparent",
  color: vars.muted,
  fontSize: "12.5px",
});

globalStyle(".symbol-crumb svg", {
  flex: "0 0 auto",
  fontSize: "13px",
  opacity: "0.85",
});

globalStyle("button.symbol-crumb:hover", {
  background: vars.hover,
  color: vars.text,
});

globalStyle(".symbol-crumb.current", {
  background: vars.accentSoft,
  color: vars.accent,
  fontWeight: "600",
});

globalStyle(".symbol-crumb-name", {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

globalStyle(".symbol-crumb-sep", {
  flex: "0 0 auto",
  color: vars.muted,
  fontSize: "13px",
  opacity: "0.5",
});
