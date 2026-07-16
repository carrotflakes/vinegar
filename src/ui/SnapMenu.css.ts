import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

// Stretch the wrapper to the full status-bar height so the trigger can be a
// VS Code-style full-height item rather than a floating rounded button.
globalStyle(".snap-menu-root", {
  display: "flex",
  alignSelf: "stretch",
  // Extend to the bar's right edge, cancelling the status bar's right padding
  // so the hover/active fill reaches the corner like VS Code.
  marginRight: "-12px",
});

// Full-height, square, borderless status-bar item; hover/active fill the whole
// height instead of a rounded pill.
globalStyle(".snap-menu-trigger", {
  height: "100%",
  minWidth: "auto",
  padding: "0 12px",
  gap: "5px",
  fontSize: "12px",
  lineHeight: "1",
  border: "none",
  borderRadius: "0",
});

// Active snapping: tint the icon/label with the accent color only — no faint
// background fill. The popover-open state gets the plain hover fill.
globalStyle(".snap-menu-trigger.is-active", {
  color: vars.accent,
});

globalStyle(".snap-menu-trigger[aria-expanded=\"true\"]", {
  background: vars.hover,
});

// Force both the magnet and the caret to the same size so neither icon
// overhangs the row. (The caret otherwise inherits .menu-caret's 14px.)
globalStyle(".snap-menu-trigger svg", {
  width: "14px",
  height: "14px",
  flex: "0 0 auto",
});

globalStyle(".menu-popover.snap-menu-popover", {
  // Anchored in the bottom status bar, so open upward and align to the right.
  top: "auto",
  bottom: "calc(100% + 6px)",
  left: "auto",
  right: "0",
  minWidth: "190px",
});

globalStyle(".snap-menu-row", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "7px 10px",
  borderRadius: "6px",
  fontSize: "13px",
  color: vars.text,
  cursor: "pointer",
  userSelect: "none",
});

globalStyle(".snap-menu-row:hover", {
  background: vars.hover,
});

globalStyle(".snap-menu-row input[type=\"checkbox\"]", {
  cursor: "pointer",
});

globalStyle(".snap-menu-size", {
  justifyContent: "space-between",
});

globalStyle(".snap-menu-size:hover", {
  background: "transparent",
});
