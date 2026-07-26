import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "@/store/editorStore";
import ColorPicker from "./ColorPicker";
import { usePopoverDismiss } from "./usePopoverDismiss";
import "./ColorInput.css";
import "./ColorField.css";

interface Props {
  /** Current colour as `#rrggbb`. */
  value: string;
  onChange: (hex: string) => void;
  /** Opacity track; omitted when the caller has no alpha to edit. */
  alpha?: number;
  onAlphaChange?: (alpha: number) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  "aria-label"?: string;
}

/** Swatch button that opens the app's own colour picker in a popover — the
 * drop-in replacement for `<input type="color">`, whose native dialog is
 * unstyleable and (on some platforms) modal. */
export default function ColorInput({
  value,
  onChange,
  alpha,
  onAlphaChange,
  disabled,
  className,
  title,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const addRecentColor = useEditor((s) => s.addRecentColor);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    placement: "bottom-start",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const close = () => {
    setOpen(false);
    addRecentColor(value);
  };

  usePopoverDismiss(
    open,
    (t) =>
      !!buttonRef.current?.contains(t) || !!refs.floating.current?.contains(t),
    close
  );

  return (
    <>
      <button
        type="button"
        ref={(el) => {
          buttonRef.current = el;
          refs.setReference(el);
        }}
        className={"color-input" + (className ? " " + className : "")}
        disabled={disabled}
        title={title ?? "Edit color"}
        aria-label={ariaLabel ?? title ?? "Edit color"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span
          className="color-input-fill"
          style={{ backgroundColor: value, opacity: alpha ?? 1 }}
        />
      </button>
      {open &&
        createPortal(
          <div
            className="color-popover color-input-popover"
            data-color-popover
            ref={refs.setFloating}
            style={floatingStyles}
          >
            <ColorPicker
              value={value}
              onChange={onChange}
              {...(alpha != null && onAlphaChange ? { alpha, onAlphaChange } : {})}
            />
          </div>,
          document.body
        )}
    </>
  );
}
