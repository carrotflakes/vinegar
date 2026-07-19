import { vars } from "../../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".generators-modal", {
  width: "min(720px, 94vw)",
  height: "min(600px, 88vh)",
});

globalStyle(".gen-list", {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  padding: "10px 14px",
  borderBottom: `1px solid ${vars.border}`,
});

globalStyle(".gen-chip", {
  padding: "4px 10px",
  borderRadius: "6px",
  border: `1px solid ${vars.border}`,
  background: vars.field,
  color: vars.text,
  fontSize: "12px",
  cursor: "pointer",
});

globalStyle(".gen-chip.active", {
  borderColor: vars.accent,
  color: vars.accent,
});

globalStyle(".gen-name-field", {
  padding: "10px 14px 0",
});

globalStyle(".gen-name-field input", {
  width: "100%",
  padding: "6px 8px",
  borderRadius: "6px",
  border: `1px solid ${vars.border}`,
  background: vars.field,
  color: vars.text,
  fontSize: "13px",
});

globalStyle(".gen-preview-split", {
  display: "flex",
  height: "170px",
  flex: "none",
  borderBottom: `1px solid ${vars.border}`,
});

globalStyle(".gen-params", {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  width: "190px",
  flex: "none",
  padding: "12px 14px",
  overflowY: "auto",
  borderRight: `1px solid ${vars.border}`,
});

globalStyle(".gen-params .num", {
  width: "72px",
});

globalStyle(".gen-params-empty", {
  margin: "auto",
  color: vars.muted,
  fontSize: "12px",
});

globalStyle(".gen-preview", {
  display: "block",
  flex: "1",
  minWidth: "0",
  height: "100%",
  background: vars.codeBg,
});

globalStyle(".gen-empty", {
  flex: "1",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: vars.muted,
  fontSize: "13px",
  padding: "24px",
  textAlign: "center",
});
