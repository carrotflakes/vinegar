import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuPipette } from "react-icons/lu";
import ColorPicker from "./ColorPicker";
import HexInput from "./HexInput";
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
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    placement: "bottom-start",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  usePopoverDismiss(
    open,
    (t) =>
      !!buttonRef.current?.contains(t) || !!refs.floating.current?.contains(t),
    () => setOpen(false)
  );

  const hasEyeDropper = typeof window !== "undefined" && !!window.EyeDropper;
  const pickFromScreen = async () => {
    if (!window.EyeDropper) return;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      onChange(sRGBHex.toLowerCase());
    } catch {
      // user cancelled
    }
  };

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
        onClick={() => setOpen((o) => !o)}
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
            >
              {hasEyeDropper && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Pick color from screen"
                  onClick={pickFromScreen}
                >
                  <LuPipette aria-hidden />
                </button>
              )}
              <HexInput value={value} onChange={onChange} />
            </ColorPicker>
          </div>,
          document.body
        )}
    </>
  );
}
