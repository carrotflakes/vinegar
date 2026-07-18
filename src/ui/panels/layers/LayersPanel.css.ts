import { vars } from "../../../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".layer-row.hidden .layer-name,\n.layer-row.hidden .layer-type", {
  opacity: "0.45",
});

globalStyle(".layers", {
  flex: "1 1 auto",
  minHeight: "120px",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

globalStyle(".layers-title", {
  padding: "12px 14px 6px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
});

/* Trailing header action (e.g. Artboards' "add"): don't let the 22px button
   inflate the title row past its plain-text height in other panels. */
globalStyle(".title-add", {
  flex: "none",
  marginBlock: "-6px",
});

globalStyle(".layers-list", {
  flex: "1",
  overflowY: "auto",
  padding: "0 6px 8px",
});

globalStyle(".layers-empty", {
  padding: "10px 8px",
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".layer-row", {
  display: "flex",
  alignItems: "center",
  gap: "4px",
  padding: "5px 6px",
  borderRadius: "7px",
  cursor: "default",
  userSelect: "none",
});

globalStyle(".layer-row:hover", {
  background: vars.bg,
});

globalStyle(".layer-row.selected", {
  background: vars.accentWeak,
});

globalStyle(".layer-row.drop-inside", {
  background: vars.accentWeak,
  outline: `2px solid ${vars.accent}`,
  outlineOffset: "-2px",
});

globalStyle(".layer-icon-btn", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "22px",
  height: "22px",
  padding: "0",
  border: "none",
  borderRadius: "5px",
  background: "transparent",
  color: vars.muted,
});

globalStyle(".layer-icon-btn:hover", {
  background: vars.hover,
  color: vars.text,
});

globalStyle(".layer-type", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "16px",
  color: vars.muted,
  fontSize: "14px",
});

globalStyle(".layer-name", {
  flex: "1",
  fontSize: "13px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

globalStyle(".layer-name-input", {
  flex: "1",
  fontSize: "13px",
  padding: "2px 5px",
  border: `1px solid ${vars.accent}`,
  borderRadius: "5px",
  minWidth: "0",
});

globalStyle(".layer-row.group-header .layer-name", {
  fontWeight: "600",
});

globalStyle(".layer-chevron", {
  width: "16px",
  fontSize: "10px",
  color: vars.muted,
});

globalStyle(".layer-count", {
  fontSize: "11px",
  color: vars.muted,
  paddingRight: "4px",
});

globalStyle(".drop-line-flow", {
  position: "relative",
  height: "2px",
  margin: "-1px 6px",
  background: vars.accent,
  borderRadius: "2px",
});

globalStyle(".drop-line-flow::before", {
  content: "\"\"",
  position: "absolute",
  left: "-3px",
  top: "-2px",
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: vars.accent,
});

globalStyle(".layers-scope", {
  display: "flex",
  alignItems: "center",
  gap: "4px",
  margin: "0 6px 2px",
  padding: "5px 8px",
  border: "none",
  borderRadius: "7px",
  background: "transparent",
  color: vars.accent,
  fontSize: "12.5px",
  textAlign: "left",
});

globalStyle(".layers-scope:hover", {
  background: vars.bg,
});

globalStyle(".layer-symbol-ref", {
  color: vars.muted,
  fontSize: "11px",
});

globalStyle(".symbols", {
  flex: "0 0 auto",
  maxHeight: "40%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderTop: `1px solid ${vars.border}`,
});

globalStyle(".symbols .panel-title", {
  padding: "10px 14px 6px",
});

globalStyle(".symbols-list", {
  overflowY: "auto",
  padding: "0 6px 8px",
});

globalStyle(".symbol-row", {
  display: "flex",
  alignItems: "center",
  gap: "4px",
  padding: "4px 6px",
  borderRadius: "7px",
  cursor: "grab",
});

globalStyle(".symbol-row:hover", {
  background: vars.bg,
});

globalStyle(".symbol-row.selected", {
  background: vars.accentSoft,
});

globalStyle(".symbol-row .layer-name", {
  flex: "1",
});
