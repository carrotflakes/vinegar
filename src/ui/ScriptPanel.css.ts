import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".script-modal", {
  width: "min(680px, 92vw)",
  height: "min(560px, 86vh)",
});

globalStyle(".script-editor", {
  flex: "1",
  minHeight: "0",
  resize: "none",
  border: "none",
  outline: "none",
  padding: "12px 14px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "13px",
  lineHeight: "1.5",
  color: vars.text,
  background: vars.codeBg,
  whiteSpace: "pre",
  overflow: "auto",
  tabSize: "2",
});

globalStyle(".script-status", {
  fontSize: "12px",
  color: vars.muted,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

globalStyle(".script-status.ok", {
  color: vars.ok,
});

globalStyle(".script-status.err", {
  color: vars.danger,
});

globalStyle(".run-btn", {
  flex: "none",
  padding: "7px 18px",
  border: "none",
  borderRadius: "7px",
  background: vars.accent,
  color: "#fff",
  fontSize: "13px",
  fontWeight: "600",
});

globalStyle(".run-btn:disabled", {
  opacity: "0.6",
});
