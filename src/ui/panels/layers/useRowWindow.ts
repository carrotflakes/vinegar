// Windowing for the Layers panel's row list. The panel owns *what* the rows
// are; this hook owns the two numbers the DOM has to answer for — how tall a
// row is and which slice of them the viewport shows.

import { useEffect, useRef, useState, type RefObject } from "react";

// Rows are uniform in height, so the list only renders the slice around the
// viewport once there are enough of them for it to matter (an SVG import can
// land thousands). Below that everything renders, which keeps small documents
// on the simple path and away from any measurement edge case.
const VIRTUALIZE_FROM = 100;
const OVERSCAN = 8;

/**
 * The element that actually scrolls the panel. Depending on the dock layout
 * that is either the list itself or an ancestor (the dock body stacks several
 * panels and scrolls them together), so the window is measured against
 * whichever one is really clipping — never assumed.
 */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (p.scrollHeight > p.clientHeight + 1) return p;
    fallback ??= p;
  }
  return fallback;
}

export interface RowWindow {
  /** Goes on the scrollable list element. */
  listRef: RefObject<HTMLDivElement | null>;
  /** Goes on the box the rows are laid out in. */
  rowsRef: RefObject<HTMLDivElement | null>;
  /** The ancestor that really scrolls; needed for reveal and edge-scrolling. */
  scrollerRef: RefObject<HTMLElement | null>;
  /** Measured from the DOM; 0 until the first row has rendered. */
  rowHeight: number;
  /** Whether the slice below is a window rather than the whole list. */
  windowed: boolean;
  first: number;
  last: number;
}

export function useRowWindow(rowCount: number): RowWindow {
  const [rowHeight, setRowHeight] = useState(0);
  const [windowBox, setWindowBox] = useState({ top: 0, height: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);

  /** The visible slice of the rows box, in pixels from its top. */
  const measureWindow = () => {
    const box = rowsRef.current;
    const scroller = scrollParentOf(listRef.current);
    scrollerRef.current = scroller;
    if (!box || !scroller) return;
    const r = box.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const next = { top: s.top - r.top, height: s.height };
    setWindowBox((prev) =>
      prev.top === next.top && prev.height === next.height ? prev : next
    );
  };

  // Windowing needs one number the DOM owns: how tall a row is. Measuring the
  // first rendered row keeps it in step with the stylesheet instead of pinning
  // a magic constant that a padding change would silently break. Both this and
  // the window run after every render — the panel's own layout can move under
  // a collapse, a rename or a dock resize just as much as under a scroll.
  useEffect(() => {
    const el = listRef.current?.querySelector(".layer-row");
    const h = el?.getBoundingClientRect().height ?? 0;
    if (h > 0 && h !== rowHeight) setRowHeight(h);
    measureWindow();
  });

  // Scroll events do not bubble, and which element scrolls depends on the dock
  // layout, so listen on the capture phase and re-measure.
  useEffect(() => {
    const onScroll = () => measureWindow();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const windowed =
    rowHeight > 0 && windowBox.height > 0 && rowCount > VIRTUALIZE_FROM;
  return {
    listRef,
    rowsRef,
    scrollerRef,
    rowHeight,
    windowed,
    first: windowed
      ? Math.max(0, Math.floor(windowBox.top / rowHeight) - OVERSCAN)
      : 0,
    last: windowed
      ? Math.min(
          rowCount,
          Math.ceil((windowBox.top + windowBox.height) / rowHeight) + OVERSCAN
        )
      : rowCount,
  };
}
