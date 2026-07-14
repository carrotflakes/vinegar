import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".menu-root", {
  position: "relative",
});

globalStyle(".menu-popover", {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: "0",
  zIndex: "20",
  minWidth: "170px",
  padding: "5px",
  background: `${vars.panel2}`,
  border: `1px solid ${vars.border}`,
  borderRadius: "8px",
  boxShadow: `0 8px 28px ${vars.shadow}`,
  display: "flex",
  flexDirection: "column",
});

globalStyle(".menu-item", {
  textAlign: "left",
  padding: "7px 10px",
  border: "none",
  borderRadius: "6px",
  background: "transparent",
  color: vars.text,
  fontSize: "13px",
});

globalStyle(".menu-item:disabled", {
  color: vars.muted,
  opacity: "0.55",
  cursor: "default",
});

globalStyle(".menu-item:hover:not(:disabled),\n.menu-item.active", {
  background: vars.accentWeak,
  color: vars.accent,
});

globalStyle(".menu-divider", {
  margin: "5px 6px",
  borderTop: `1px solid ${vars.border}`,
});

globalStyle(".menu-sub", {
  position: "relative",
  display: "flex",
  flexDirection: "column",
});

globalStyle(".submenu-trigger", {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
});

globalStyle(".menu-popover-sub", {
  top: "-6px",
  left: "100%",
});

globalStyle(".menu-caret", {
  color: vars.muted,
  fontSize: "14px",
});
