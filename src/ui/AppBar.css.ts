import { globalStyle } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { vars } from "../styles/theme.css";

export const barButton = recipe({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 30,
    minWidth: 30,
    padding: "0 9px",
    border: "1px solid transparent",
    borderRadius: 7,
    background: "transparent",
    color: vars.text,
    fontSize: 13,
    selectors: {
      "&:hover:not(:disabled)": {
        background: vars.hover,
      },
      "&:disabled": {
        opacity: 0.4,
        cursor: "default",
      },
    },
  },
  variants: {
    icon: {
      true: {
        padding: 0,
        width: 30,
      },
    },
    active: {
      true: {
        background: vars.accentWeak,
        color: vars.accent,
      },
    },
    panelToggle: {
      true: {
        display: "none",
        "@media": {
          "(max-width: 720px)": {
            display: "inline-flex",
          },
        },
      },
    },
  },
});

globalStyle(".zoom-readout", {
  minWidth: "64px",
  fontVariantNumeric: "tabular-nums",
});

globalStyle(".zoom-menu-trigger", {
  paddingRight: "6px",
});

/** Fixed-size rotation indicator; its constant width keeps the popover anchored. */
globalStyle(".zoom-menu-knob", {
  flex: "0 0 auto",
  color: vars.muted,
});

globalStyle(".zoom-menu-knob.is-rotated", {
  color: vars.accent,
});

globalStyle(".zoom-menu-knob circle", {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.25",
  opacity: "0.55",
});

globalStyle(".zoom-menu-knob line", {
  stroke: "currentColor",
  strokeWidth: "1.5",
  strokeLinecap: "round",
});

globalStyle(".menu-popover.zoom-menu-popover", {
  right: "0",
  left: "auto",
  minWidth: "260px",
});

globalStyle(".zoom-menu-item", {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "18px",
});

globalStyle(".zoom-menu-rotation", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 10px",
  borderBottom: `1px solid ${vars.border}`,
  marginBottom: "4px",
});

globalStyle(".zoom-menu-rotation-label", {
  color: vars.muted,
  fontSize: "12px",
});

globalStyle(".zoom-menu-rotation-slider", {
  flex: "1 1 auto",
  minWidth: "0",
  accentColor: vars.accent,
});

globalStyle(".zoom-menu-rotation-value", {
  flex: "0 0 auto",
  width: "44px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontSize: "12px",
});

globalStyle(".zoom-menu-rotation-reset", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px",
  background: "transparent",
  border: "none",
  borderRadius: "4px",
  color: vars.muted,
  cursor: "pointer",
});

globalStyle(".zoom-menu-rotation-reset:hover:not(:disabled)", {
  background: vars.accentWeak,
  color: vars.accent,
});

globalStyle(".zoom-menu-rotation-reset:disabled", {
  opacity: "0.4",
  cursor: "default",
});

globalStyle(".menu-shortcut", {
  color: vars.muted,
  fontSize: "11px",
  whiteSpace: "nowrap",
});
