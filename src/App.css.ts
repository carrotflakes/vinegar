import { vars } from "./styles/theme.css";
import {
  createGlobalVar,
  globalKeyframes,
  globalStyle,
} from "@vanilla-extract/css";

const autosaveColor = createGlobalVar("autosave-color");

globalStyle(".app", {
  display: "flex",
  flexDirection: "column",
  height: "100%",
});

globalStyle(".appbar", {
  display: "flex",
  alignItems: "center",
  gap: "2px",
  height: "36px",
  padding: "0 6px",
  background: vars.panel,
  borderBottom: `1px solid ${vars.border}`,
  flex: "none",
});

globalStyle(".appbar-zone", {
  display: "flex",
  alignItems: "center",
  gap: "2px",
});

globalStyle(".appbar-sep", {
  width: "1px",
  alignSelf: "stretch",
  margin: "9px 5px",
  background: vars.border,
});

globalStyle(".brand", {
  fontWeight: "700",
  fontSize: "13px",
  letterSpacing: "0.2px",
  display: "flex",
  alignItems: "center",
  gap: "5px",
  padding: "0 6px 0 4px",
});

globalStyle(".brand-mark", {
  height: "17px",
  width: "auto",
  display: "block",
});

globalStyle(".appbar-spacer", {
  flex: "1",
});

// Document name — quiet until hovered, so the bar still reads as chrome.
globalStyle(".doc-title", {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  maxWidth: "min(40vw, 320px)",
  height: "26px",
  padding: "0 8px",
  border: "1px solid transparent",
  borderRadius: "6px",
  background: "transparent",
  color: vars.text,
  fontSize: "12px",
});

globalStyle(".doc-title:hover", {
  background: vars.hover,
});

globalStyle(".doc-title-name", {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

globalStyle(".doc-title-dirty", {
  flex: "none",
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: vars.muted,
});

globalStyle(".doc-title-input", {
  width: "min(40vw, 320px)",
  height: "26px",
  padding: "0 7px",
  border: `1px solid ${vars.accent}`,
  borderRadius: "6px",
  background: vars.field,
  color: vars.text,
  fontSize: "12px",
});

globalStyle(".body", {
  flex: "1",
  display: "flex",
  minHeight: "0",
  position: "relative",
});

globalStyle(".panel-backdrop", {
  display: "none",
  position: "absolute",
  inset: "0",
  zIndex: "24",
  background: "rgba(8, 10, 14, 0.5)",
});

globalStyle(".left", {
  width: "40px",
  flex: "none",
  background: vars.panel,
  borderRight: `1px solid ${vars.border}`,
  padding: "4px",
  overflowY: "auto",
});

globalStyle(".stage", {
  flex: "1",
  minWidth: "0",
  position: "relative",
  background: vars.bg,
});

globalStyle(".statusbar", {
  height: "22px",
  flex: "none",
  display: "flex",
  alignItems: "center",
  gap: "7px",
  padding: "0 10px",
  background: vars.panel,
  borderTop: `1px solid ${vars.border}`,
  fontSize: "11px",
  color: vars.muted,
});

globalStyle(".statusbar .dot", {
  opacity: "0.5",
  // Separators are `.status-hint` too; keep them from being squeezed away.
  flex: "none",
});

globalStyle(".pointer-readout", {
  minWidth: "76px",
  fontVariantNumeric: "tabular-nums",
});

globalStyle(".pointer-readout.live", {
  color: vars.accent,
  fontWeight: "600",
});

globalStyle(".status-spacer", {
  flex: "1",
});

globalStyle(".autosave", {
  vars: { [autosaveColor]: vars.muted },
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  whiteSpace: "nowrap",
  color: vars.muted,
  cursor: "default",
});

globalStyle(".autosave-dot", {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  flex: "none",
  background: "var(--autosave-color)",
  boxShadow: "0 0 0 3px color-mix(in srgb, var(--autosave-color) 22%, transparent)",
});

globalStyle(".autosave-time", {
  fontVariantNumeric: "tabular-nums",
  opacity: "0.75",
});

globalStyle(".autosave.ready", {
  vars: { [autosaveColor]: vars.muted },
});

globalStyle(".autosave.ready .autosave-dot", {
  boxShadow: "none",
});

globalStyle(".autosave.saving", {
  vars: { [autosaveColor]: vars.accent },
  color: vars.text,
});

globalStyle(".autosave.saving .autosave-dot", {
  animation: "autosave-pulse 1.1s ease-in-out infinite",
});

globalStyle(".autosave.saved", {
  vars: { [autosaveColor]: vars.ok },
});

globalStyle(".autosave.recovered", {
  vars: { [autosaveColor]: vars.accent },
  color: vars.text,
});

globalStyle(".autosave.error", {
  vars: { [autosaveColor]: vars.danger },
  color: vars.danger,
  fontWeight: "600",
});

globalKeyframes("autosave-pulse", {
  "0%, 100%": {
    boxShadow: "0 0 0 0 color-mix(in srgb, var(--autosave-color) 45%, transparent)",
  },
  "50%": {
    boxShadow: "0 0 0 4px color-mix(in srgb, var(--autosave-color) 0%, transparent)",
  },
});

globalStyle(".autosave.saving .autosave-dot", {
  "@media": {
    "(prefers-reduced-motion: reduce)": {
      animation: "none",
    },
  },
});

globalStyle(".status-sep", {
  width: "1px",
  alignSelf: "stretch",
  margin: "4px 4px",
  background: vars.border,
});

globalStyle(".grid-size-input", {
  width: "52px",
  padding: "5px 7px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  fontSize: "12px",
  cursor: "text",
});

globalStyle(".appbar", {
  "@media": {
    "(max-width: 720px)": {
      height: "auto",
      minHeight: "36px",
      gap: "4px 6px",
      padding: "4px 6px",
      flexWrap: "wrap",
    },
  },
});

globalStyle(".appbar-spacer", {
  "@media": {
    "(max-width: 720px)": {
      display: "none",
    },
  },
});

globalStyle(".body", {
  "@media": {
    "(max-width: 720px)": {
      overflow: "hidden",
    },
  },
});

// The wordmark is the first thing to go when the bar gets crowded — the logo
// mark alone still identifies the app.
globalStyle(".brand-word", {
  "@media": {
    "(max-width: 1000px)": {
      display: "none",
    },
  },
});

globalStyle(".left", {
  "@media": {
    "(max-width: 720px)": {
      position: "absolute",
      zIndex: "15",
      top: "8px",
      left: "8px",
      maxHeight: "calc(100% - 16px)",
      border: `1px solid ${vars.border}`,
      borderRadius: "12px",
      boxShadow: `0 6px 20px ${vars.shadow}`,
    },
  },
});

globalStyle(".panel-backdrop", {
  "@media": {
    "(max-width: 720px)": {
      display: "block",
    },
  },
});

globalStyle(".status-hint", {
  // The hint is the one elastic item in the bar: it absorbs the shrinking so a
  // long tool hint truncates instead of pushing the autosave state and snap
  // menu off the end.
  minWidth: "0",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  "@media": {
    "(max-width: 720px)": {
      display: "none",
    },
  },
});
