import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../../styles/theme.css";

globalStyle(".preferences-modal", {
  width: "min(660px, calc(100vw - 32px))",
});

/* Sidebar + one continuous panel holding every category. */
/* A definite height (rather than a min/max pair) keeps the panel a stable
 * scrollport and lets the last section size itself against it below. */
globalStyle(".preferences-layout", {
  display: "flex",
  alignItems: "stretch",
  height: "min(70vh, 560px)",
});

/* `position: relative` makes each section's offsetTop measure against the
 * scrollport, which is what the sidebar scrolls to and highlights from. */
globalStyle(".preferences-body", {
  position: "relative",
  flex: "1",
  minWidth: "0",
  display: "flex",
  flexDirection: "column",
  gap: "26px",
  padding: "0 16px 24px",
  overflowY: "auto",
});

/* --- Category navigation ------------------------------------------------ */

globalStyle(".preferences-nav", {
  flex: "none",
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  width: "168px",
  padding: "12px 8px",
  borderRight: `1px solid ${vars.border}`,
  overflowY: "auto",
});

globalStyle(".pref-nav-item", {
  display: "flex",
  alignItems: "center",
  gap: "9px",
  padding: "7px 10px",
  border: "none",
  borderRadius: "7px",
  background: "transparent",
  color: vars.muted,
  fontSize: "13px",
  textAlign: "left",
  cursor: "pointer",
});

globalStyle(".pref-nav-item svg", {
  flex: "none",
  fontSize: "15px",
});

globalStyle(".pref-nav-item:hover", {
  background: vars.bg,
  color: vars.text,
});

globalStyle(".pref-nav-item.active", {
  background: vars.bg,
  color: vars.text,
  fontWeight: "600",
});

/* Narrow screens (a phone, a split-view iPad) cannot spare the sidebar
 * column, so the categories become a scrolling strip above the panel. */
globalStyle(".preferences-layout", {
  "@media": {
    "(max-width: 620px)": {
      flexDirection: "column",
    },
  },
});

globalStyle(".preferences-nav", {
  "@media": {
    "(max-width: 620px)": {
      flexDirection: "row",
      width: "auto",
      padding: "8px",
      borderRight: "none",
      borderBottom: `1px solid ${vars.border}`,
      overflowX: "auto",
      overflowY: "hidden",
    },
  },
});

globalStyle(".pref-nav-item", {
  "@media": {
    "(max-width: 620px)": {
      flex: "none",
    },
  },
});

/* --- Sections ----------------------------------------------------------- */

globalStyle(".pref-section", {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
});

/* The last category is padded out to a full scrollport so its heading can
 * still reach the top of the panel when the sidebar scrolls to it. */
globalStyle(".pref-section:last-child", {
  minHeight: "100%",
});

/* The heading pins to the top of the scrollport so the reader always knows
 * which category the rows below belong to. */
globalStyle(".pref-section-title", {
  position: "sticky",
  top: "0",
  zIndex: "1",
  margin: "0 0 4px",
  padding: "14px 0 6px",
  background: vars.panel,
  color: vars.muted,
  fontSize: "11px",
  fontWeight: "600",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
});

globalStyle(".preferences-foot", {
  justifyContent: "space-between",
});

globalStyle(".preferences-foot-resets", {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
});
