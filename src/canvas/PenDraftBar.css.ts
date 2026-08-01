import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css";

// Bottom centre, clear of the bottom-left modifier bar (see ModifierBar.css.ts).
globalStyle(".pen-bar", {
  position: "absolute",
  left: "50%",
  bottom: "10px",
  transform: "translateX(-50%)",
  display: "flex",
  gap: "4px",
  padding: "4px",
  background: `${vars.panel2}`,
  border: `1px solid ${vars.border}`,
  borderRadius: "10px",
  boxShadow: `0 4px 18px ${vars.shadow}`,
  zIndex: "5",
});

// On touch the modifier bar occupies the bottom-left corner; on a phone-width
// screen the two would overlap, so this one sits above it.
globalStyle(".pen-bar", {
  "@media": {
    "(pointer: coarse)": {
      bottom: "60px",
    },
  },
});

globalStyle(".pen-bar-btn", {
  minWidth: "56px",
  padding: "8px 12px",
  border: "none",
  borderRadius: "7px",
  background: "transparent",
  color: vars.text,
  fontSize: "13px",
  fontWeight: "600",
  touchAction: "manipulation",
});

globalStyle(".pen-bar-btn:hover:not(:disabled)", {
  background: vars.hover,
});

globalStyle(".pen-bar-btn:disabled", {
  color: vars.muted,
  opacity: "0.5",
});
