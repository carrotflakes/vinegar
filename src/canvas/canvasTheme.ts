import { vars } from "../styles/theme.css";

export interface CanvasTheme {
  bg: string;
  grid: { minor: string; major: string; axis: string };
  /** Ruler chrome (drawn into the canvas, so it needs concrete colors too). */
  ruler: {
    bg: string;
    border: string;
    tick: string;
    text: string;
    /** Shading behind the selection extent. */
    highlight: string;
  };
}

/** Extract the custom-property name from a vanilla-extract `var(--x)` reference. */
function cssVarName(ref: string): string {
  const match = ref.match(/^var\((--[^,)]+)/);
  return match ? match[1] : ref;
}

/** Resolve the canvas 2D colors from the active theme's CSS variables. */
export function readCanvasTheme(): CanvasTheme {
  const style = getComputedStyle(document.documentElement);
  const read = (ref: string) => style.getPropertyValue(cssVarName(ref)).trim();
  return {
    bg: read(vars.canvasBg),
    grid: {
      minor: read(vars.gridMinor),
      major: read(vars.gridMajor),
      axis: read(vars.gridAxis),
    },
    ruler: {
      bg: read(vars.panel),
      border: read(vars.border),
      tick: read(vars.muted),
      text: read(vars.muted),
      highlight: read(vars.accentWeak),
    },
  };
}
