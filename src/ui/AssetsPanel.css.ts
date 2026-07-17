import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".assets-purge", {
  flex: "none",
  marginBlock: "-4px",
  padding: "3px 8px",
  border: "none",
  borderRadius: "6px",
  background: "transparent",
  color: vars.muted,
  fontSize: "11.5px",
});

globalStyle(".assets-purge:hover:not(:disabled)", {
  background: vars.hover,
  color: vars.text,
});

globalStyle(".assets-purge:disabled", {
  opacity: "0.4",
  cursor: "default",
});

globalStyle(".asset-row", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "4px 6px",
  borderRadius: "7px",
  cursor: "grab",
});

globalStyle(".asset-row:hover", {
  background: vars.bg,
});

globalStyle(".asset-thumb", {
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "32px",
  height: "32px",
  borderRadius: "5px",
  overflow: "hidden",
  background: vars.bg,
  border: `1px solid ${vars.border}`,
  color: vars.muted,
});

globalStyle(".asset-thumb img", {
  width: "100%",
  height: "100%",
  objectFit: "contain",
});

globalStyle(".asset-info", {
  flex: "1",
  minWidth: "0",
  display: "flex",
  flexDirection: "column",
  lineHeight: "1.3",
});

globalStyle(".asset-name", {
  fontSize: "13px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

globalStyle(".asset-meta", {
  fontSize: "11px",
  color: vars.muted,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});
