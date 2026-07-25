import { globalStyle } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { vars } from "../styles/theme.css";

export const barButton = recipe({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 26,
    minWidth: 26,
    padding: "0 7px",
    border: "1px solid transparent",
    borderRadius: 6,
    background: "transparent",
    color: vars.text,
    fontSize: 12,
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
        width: 26,
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
  minWidth: "52px",
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

globalStyle(".zoom-menu-popover", {
  // Placement (right-aligned) is handled by Floating UI; see ZoomMenu's
  // `placement="bottom-end"`.
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

/** Scrubbable degree field; the unit sign sits inside the field's border. */
globalStyle(".zoom-menu-rotation-field", {
  flex: "1 1 auto",
  minWidth: "0",
  display: "flex",
  alignItems: "center",
  gap: "1px",
  paddingRight: "6px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: vars.field,
});

globalStyle(".zoom-menu-rotation-field:focus-within", {
  borderColor: vars.accent,
});

globalStyle(".zoom-menu-rotation-field input", {
  flex: "1 1 auto",
  minWidth: "0",
  width: "100%",
  padding: "3px 0 3px 7px",
  border: "none",
  background: "transparent",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontSize: "12px",
});

// The wrapper already shows focus; a second ring inside it would double up.
globalStyle(".zoom-menu-rotation-field input:focus-visible", {
  boxShadow: "none",
});

globalStyle(".zoom-menu-rotation-unit", {
  flex: "0 0 auto",
  color: vars.muted,
  fontSize: "12px",
});

globalStyle(".zoom-menu-rotation-step,\n.zoom-menu-rotation-reset", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
  width: "24px",
  height: "24px",
  padding: "0",
  background: "transparent",
  border: "none",
  borderRadius: "4px",
  color: vars.muted,
  fontSize: "12px",
  cursor: "pointer",
});

globalStyle(".zoom-menu-rotation-step:hover,\n.zoom-menu-rotation-reset:hover:not(:disabled)", {
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
