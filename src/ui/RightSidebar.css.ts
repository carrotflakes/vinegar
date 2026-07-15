import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".right", {
  width: "258px",
  flex: "none",
  background: vars.panel,
  borderLeft: `1px solid ${vars.border}`,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

globalStyle(".right", {
  "@media": {
    "(max-width: 720px)": {
      position: "absolute",
      top: "0",
      right: "0",
      bottom: "0",
      width: "min(86vw, 320px)",
      transform: "translateX(100%)",
      transition: "transform 0.2s ease",
      zIndex: "25",
      boxShadow: `-8px 0 28px ${vars.shadow}`,
    },
  },
});

globalStyle(".right.open", {
  "@media": {
    "(max-width: 720px)": {
      transform: "translateX(0)",
    },
  },
});
