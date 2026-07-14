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

globalStyle(".zoom-menu-popover", {
  right: "0",
  left: "auto",
  minWidth: "190px",
});

globalStyle(".zoom-menu-item", {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "18px",
});

globalStyle(".menu-shortcut", {
  color: vars.muted,
  fontSize: "11px",
  whiteSpace: "nowrap",
});
