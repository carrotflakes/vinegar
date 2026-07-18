import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".modal-head,\n.modal-foot", {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 14px",
});

globalStyle(".modal-overlay", {
  position: "fixed",
  inset: "0",
  zIndex: "50",
  background: "rgba(8, 10, 14, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});

globalStyle(".modal", {
  background: vars.panel,
  border: `1px solid ${vars.border}`,
  borderRadius: "12px",
  boxShadow: `0 16px 48px ${vars.shadow}`,
  display: "flex",
  flexDirection: "column",
});

globalStyle(".modal-head", {
  borderBottom: `1px solid ${vars.border}`,
  fontWeight: "600",
});

globalStyle(".modal-foot", {
  borderTop: `1px solid ${vars.border}`,
});

globalStyle(".modal-close", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "26px",
  height: "26px",
  border: "none",
  borderRadius: "6px",
  background: "transparent",
  color: vars.muted,
  fontSize: "16px",
  cursor: "pointer",
});

globalStyle(".modal-close:hover", {
  background: vars.bg,
  color: vars.text,
});

globalStyle(".modal-primary-btn", {
  flex: "none",
  padding: "7px 18px",
  border: "none",
  borderRadius: "7px",
  background: vars.accent,
  color: "#fff",
  fontSize: "13px",
  fontWeight: "600",
});

globalStyle(".modal-primary-btn:disabled", {
  opacity: "0.6",
});
