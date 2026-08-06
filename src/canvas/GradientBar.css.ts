import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css";

// Bottom centre, like the pen's draft bar (see PenDraftBar.css.ts); only one
// of the two is ever on screen, since they belong to different tools.
globalStyle(".gradient-tool-bar", {
  position: "absolute",
  left: "50%",
  bottom: "10px",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: "4px",
  padding: "4px",
  background: vars.panel2,
  border: `1px solid ${vars.border}`,
  borderRadius: "10px",
  boxShadow: `0 4px 18px ${vars.shadow}`,
  zIndex: "5",
});

globalStyle(".gradient-tool-bar", {
  "@media": {
    "(pointer: coarse)": {
      bottom: "60px",
    },
  },
});

globalStyle(".gradient-tool-btn", {
  minWidth: "44px",
  padding: "8px 10px",
  border: "none",
  borderRadius: "7px",
  background: "transparent",
  color: vars.text,
  fontSize: "13px",
  fontWeight: "600",
  touchAction: "manipulation",
});

globalStyle(".gradient-tool-btn:hover:not(:disabled)", {
  background: vars.hover,
});

globalStyle(".gradient-tool-btn.active", {
  background: vars.accentWeak,
  color: vars.accent,
});

globalStyle(".gradient-tool-btn:disabled", {
  color: vars.muted,
  opacity: "0.5",
});

globalStyle(".gradient-tool-sep", {
  width: "1px",
  alignSelf: "stretch",
  margin: "2px",
  background: vars.border,
});

globalStyle(".gradient-tool-color", {
  width: "28px",
  height: "26px",
});

globalStyle(".gradient-tool-hint", {
  padding: "0 8px",
  color: vars.muted,
  fontSize: "12px",
});
