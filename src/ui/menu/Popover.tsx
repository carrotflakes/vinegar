// ===========================================================================
// Small Floating UI popover primitive for the AppBar/status-bar dropdowns that
// hold custom controls (checkboxes, sliders) rather than a MenuEntry[] list —
// e.g. SnapMenu and ZoomMenu. It owns open state, anchored positioning with
// flip/shift, touch-friendly dismissal and focus management; callers supply the
// trigger and the panel contents.
// ===========================================================================

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  type Placement,
} from "@floating-ui/react";
import { setDropdownOpen } from "../../store/menuStore";
import "../menus.css";

export function Popover({
  placement = "bottom-start",
  className,
  renderTrigger,
  children,
}: {
  placement?: Placement;
  /** Extra class(es) appended to the `.menu-popover` panel. */
  className?: string;
  renderTrigger: (p: {
    ref: (node: HTMLElement | null) => void;
    open: boolean;
    props: Record<string, unknown>;
  }) => ReactNode;
  /** Panel contents; `close` dismisses the popover (e.g. from an action item). */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  // Track open state so the app's global Escape handler yields to the popover.
  useEffect(() => {
    if (!open) return;
    setDropdownOpen(true);
    return () => setDropdownOpen(false);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      {renderTrigger({ ref: refs.setReference, open, props: getReferenceProps() })}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div
              ref={refs.setFloating}
              className={"menu-popover" + (className ? " " + className : "")}
              style={floatingStyles}
              {...getFloatingProps()}
            >
              {children(close)}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
