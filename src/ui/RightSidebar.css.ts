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

globalStyle(".props-pane", {
  flex: "none",
  overflowY: "auto",
});

globalStyle(".layers-pane", {
  flex: "1 1 0",
  minHeight: "0",
  display: "flex",
  flexDirection: "column",
});

globalStyle(".pane-divider", {
  flex: "none",
  height: "7px",
  cursor: "ns-resize",
  background: vars.bg,
  borderTop: `1px solid ${vars.border}`,
  borderBottom: `1px solid ${vars.border}`,
  position: "relative",
});

globalStyle(".pane-divider::after", {
  content: "\"\"",
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "26px",
  height: "2px",
  borderRadius: "2px",
  background: vars.border,
});

globalStyle(".pane-divider:hover::after", {
  background: vars.accent,
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
