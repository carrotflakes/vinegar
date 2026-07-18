import { vars } from "./theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle("*", {
  boxSizing: "border-box",
});

globalStyle("html,\nbody,\n#root", {
  height: "100%",
  margin: "0",
  overflow: "hidden",
  overscrollBehavior: "none",
  touchAction: "pan-x pan-y",
});

globalStyle("body", {
  position: "fixed",
  inset: "0",
  background: vars.bg,
  color: vars.text,
  WebkitFontSmoothing: "antialiased",
  userSelect: "none",
  WebkitUserSelect: "none",
});

globalStyle("input,\ntextarea,\n[contenteditable=\"true\"],\n[contenteditable=\"\"],\n.selectable", {
  userSelect: "text",
  WebkitUserSelect: "text",
});

globalStyle("button", {
  fontFamily: "inherit",
  cursor: "pointer",
});

globalStyle("input:not([type=\"range\"]):not([type=\"checkbox\"]):not([type=\"color\"]),\nselect,\ntextarea", {
  backgroundColor: vars.field,
  color: vars.text,
});

globalStyle("input::placeholder", {
  color: vars.muted,
});

globalStyle("input:focus-visible:not([type=\"range\"]):not([type=\"checkbox\"]):not([type=\"color\"]),\nselect:focus-visible,\ntextarea:focus-visible", {
  outline: "none",
  borderColor: vars.accent,
  boxShadow: `0 0 0 2px ${vars.accentWeak}`,
});

globalStyle("input[type=\"number\"]", {
  appearance: "textfield",
  MozAppearance: "textfield",
});

globalStyle("input[type=\"number\"]::-webkit-outer-spin-button,\ninput[type=\"number\"]::-webkit-inner-spin-button", {
  WebkitAppearance: "none",
  margin: "0",
});

globalStyle("select", {
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23888c94' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 7px center",
  backgroundSize: "12px",
  paddingRight: "24px",
});

globalStyle("input[type=\"range\"]", {
  appearance: "none",
  WebkitAppearance: "none",
  width: "100%",
  height: "18px",
  margin: "0",
  background: "transparent",
  cursor: "pointer",
});

globalStyle("input[type=\"range\"]::-webkit-slider-runnable-track", {
  height: "4px",
  borderRadius: "3px",
  background: vars.track,
});

globalStyle("input[type=\"range\"]::-moz-range-track", {
  height: "4px",
  borderRadius: "3px",
  background: vars.track,
});

globalStyle("input[type=\"range\"]::-webkit-slider-thumb", {
  WebkitAppearance: "none",
  width: "14px",
  height: "14px",
  marginTop: "-5px",
  borderRadius: "50%",
  background: vars.thumb,
  border: `1px solid ${vars.thumbBorder}`,
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.3)",
  transition: "background-color 0.1s ease, border-color 0.1s ease",
});

globalStyle("input[type=\"range\"]::-moz-range-thumb", {
  width: "14px",
  height: "14px",
  borderRadius: "50%",
  background: vars.thumb,
  border: `1px solid ${vars.thumbBorder}`,
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.3)",
});

globalStyle("input[type=\"range\"]:hover::-webkit-slider-thumb,\ninput[type=\"range\"]:active::-webkit-slider-thumb", {
  background: vars.accent,
  borderColor: vars.accent,
});

globalStyle("input[type=\"range\"]:hover::-moz-range-thumb,\ninput[type=\"range\"]:active::-moz-range-thumb", {
  background: vars.accent,
  borderColor: vars.accent,
});

globalStyle("input[type=\"range\"]:focus-visible", {
  outline: "none",
});

globalStyle("input[type=\"range\"]:focus-visible::-webkit-slider-thumb", {
  boxShadow: `0 0 0 3px ${vars.accentWeak}`,
});

globalStyle("input[type=\"range\"]:focus-visible::-moz-range-thumb", {
  boxShadow: `0 0 0 3px ${vars.accentWeak}`,
});

globalStyle("input[type=\"checkbox\"]", {
  appearance: "none",
  WebkitAppearance: "none",
  width: "15px",
  height: "15px",
  margin: "0",
  border: `1px solid ${vars.borderStrong}`,
  borderRadius: "4px",
  background: `${vars.field} no-repeat center`,
  cursor: "pointer",
  transition: "background-color 0.1s ease, border-color 0.1s ease",
});

globalStyle("input[type=\"checkbox\"]:checked", {
  backgroundColor: vars.accent,
  borderColor: vars.accent,
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2.5 6.2 5 8.7l4.5-5.4'/%3E%3C/svg%3E\")",
});

globalStyle("input[type=\"checkbox\"]:focus-visible", {
  outline: "none",
  boxShadow: `0 0 0 2px ${vars.accentWeak}`,
});

globalStyle("input[type=\"color\"]", {
  WebkitAppearance: "none",
  appearance: "none",
  cursor: "pointer",
});

globalStyle("input[type=\"color\"]::-webkit-color-swatch-wrapper", {
  padding: "0",
});

globalStyle("input[type=\"color\"]::-webkit-color-swatch", {
  border: "none",
  borderRadius: "4px",
});

globalStyle("input[type=\"color\"]::-moz-color-swatch", {
  border: "none",
  borderRadius: "4px",
});

globalStyle(".ghost-btn,\n.tool-btn,\n.icon-btn,\n.menu-item,\n.layer-row,\n.symbol-row,\n.palette-item,\n.context-menu-item,\n.paint-type-btn,\n.none-btn,\n.layer-icon-btn,\n.modal-primary-btn,\n.mini-swatch", {
  transition: "background-color 0.12s ease, color 0.12s ease,\n    border-color 0.12s ease",
});
