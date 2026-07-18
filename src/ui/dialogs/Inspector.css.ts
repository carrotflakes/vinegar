import { vars } from "../../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".ins-null,\n.ins-circular", {
  color: vars.muted,
  fontStyle: "italic",
});

globalStyle(".inspector-modal", {
  width: "min(560px, 92vw)",
  height: "min(600px, 86vh)",
});

globalStyle(".inspector-search", {
  border: "none",
  outline: "none",
  padding: "9px 14px",
  fontSize: "13px",
  color: vars.text,
  background: "transparent",
  borderBottom: `1px solid ${vars.border}`,
});

globalStyle(".inspector-tree", {
  flex: "1",
  minHeight: "0",
  overflow: "auto",
  padding: "8px 4px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "12px",
  lineHeight: "1.6",
  background: vars.codeBg,
});

globalStyle(".ins-row", {
  display: "flex",
  alignItems: "baseline",
  gap: "4px",
  whiteSpace: "nowrap",
  paddingRight: "8px",
});

globalStyle(".ins-branch", {
  cursor: "pointer",
});

globalStyle(".ins-branch:hover", {
  background: vars.accentWeak,
});

globalStyle(".ins-toggle", {
  flex: "none",
  width: "12px",
  color: vars.muted,
  fontSize: "10px",
});

globalStyle(".ins-leaf", {
  visibility: "hidden",
});

globalStyle(".ins-key", {
  color: vars.text,
});

globalStyle(".ins-colon", {
  color: vars.muted,
});

globalStyle(".ins-summary", {
  color: vars.muted,
});

globalStyle(".ins-val", {
  overflow: "hidden",
  textOverflow: "ellipsis",
});

globalStyle(".ins-string", {
  color: vars.ok,
});

globalStyle(".ins-number", {
  color: vars.accent,
});

globalStyle(".ins-boolean", {
  color: "#d08bff",
});
