import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".right", {
  position: "relative",
  width: "var(--dock-w, 258px)",
  flex: "none",
  background: vars.panel,
  borderLeft: `1px solid ${vars.border}`,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

/* Drag handle straddling the sidebar's left edge to resize its width. The blue
   fill fades in only after a short hover dwell, so a passing cursor stays quiet;
   it disappears quickly on leave and shows instantly while dragging. */
globalStyle(".right-resize", {
  position: "absolute",
  top: "0",
  left: "-3px",
  bottom: "0",
  width: "7px",
  zIndex: "5",
  cursor: "ew-resize",
  background: vars.accent,
  opacity: "0",
  transition: "opacity 0.12s ease",
});

globalStyle(".right-resize:hover", {
  opacity: "0.5",
  transitionDelay: "0.35s",
});

globalStyle(".right-resize.dragging", {
  opacity: "0.5",
  transitionDelay: "0s",
});

globalStyle(".right-resize", {
  "@media": {
    "(max-width: 720px)": {
      display: "none",
    },
  },
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
