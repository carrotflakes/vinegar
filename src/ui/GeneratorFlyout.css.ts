import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".gen-flyout-popover", {
  minWidth: "auto",
  padding: "8px",
  gap: "8px",
});

globalStyle(".gen-flyout-head", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 2px",
  fontSize: "12px",
  fontWeight: "600",
  color: vars.text,
});

globalStyle(".gen-flyout-badge", {
  padding: "1px 6px",
  borderRadius: "999px",
  border: `1px solid ${vars.accentBorder}`,
  background: vars.accentWeak,
  color: vars.accent,
  fontSize: "10px",
  fontWeight: "600",
  letterSpacing: "0.03em",
  textTransform: "uppercase",
});

globalStyle(".gen-flyout-grid", {
  display: "grid",
  gridTemplateColumns: "repeat(3, 64px)",
  gap: "4px",
});

globalStyle(".gen-flyout-item", {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "2px",
  padding: "5px 2px 4px",
  border: "1px solid transparent",
  borderRadius: "7px",
  background: "transparent",
  color: vars.muted,
  cursor: "pointer",
  // The tile is drag-draggable; keep touch scrolling free until the long-press
  // fires (see useTouchDrag).
  touchAction: "auto",
});

globalStyle(".gen-flyout-item:hover", {
  background: vars.hover,
  color: vars.text,
});

globalStyle(".gen-flyout-thumb", {
  width: "48px",
  height: "40px",
  // The canvas is painted at device resolution; keep the CSS box fixed so the
  // thumbnail never resizes mid-drag.
  flex: "0 0 auto",
  pointerEvents: "none",
});

globalStyle(".gen-flyout-name", {
  fontSize: "11px",
  lineHeight: "1.2",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

globalStyle(".gen-flyout-hint", {
  padding: "0 2px",
  maxWidth: "208px",
  fontSize: "11px",
  lineHeight: "1.35",
  color: vars.muted,
});
