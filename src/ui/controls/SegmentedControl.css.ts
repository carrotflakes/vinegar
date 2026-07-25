import { vars } from "@/styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".segmented-control", {
  display: "flex",
  gap: "0",
});

globalStyle(".segmented-control-button", {
  position: "relative",
  flex: "1",
  minWidth: "0",
  marginLeft: "-1px",
  borderRadius: "0",
});

globalStyle(".segmented-control-button:first-child", {
  marginLeft: "0",
  borderTopLeftRadius: "6px",
  borderBottomLeftRadius: "6px",
});

globalStyle(".segmented-control-button:last-child", {
  borderTopRightRadius: "6px",
  borderBottomRightRadius: "6px",
});

globalStyle(".segmented-control-button:hover", {
  zIndex: "1",
});

globalStyle(".segmented-control-button.active", {
  zIndex: "2",
  color: vars.text,
  background: vars.bg,
});
