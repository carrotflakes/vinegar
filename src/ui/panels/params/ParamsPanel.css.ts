import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../../../styles/theme.css";

globalStyle(".param-row", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 6px",
  borderRadius: "7px",
});

globalStyle(".param-row:hover", {
  background: vars.bg,
});

globalStyle(".param-row .layer-name", {
  flex: "1",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

globalStyle(".param-row .param-value", {
  flex: "0 0 auto",
  width: "68px",
});
