import { globalStyle } from "@vanilla-extract/css";

globalStyle(".canvas-wrap", {
  position: "absolute",
  inset: "0",
  overflow: "hidden",
  // Focusable (tabIndex=-1) for the Apple Pencil touch-draw fix; hide the ring.
  outline: "none",
});

globalStyle(".canvas", {
  display: "block",
  touchAction: "none",
});
