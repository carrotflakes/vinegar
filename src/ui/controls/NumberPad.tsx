import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LuDelete } from "react-icons/lu";
import {
  applyKey,
  nudge,
  numberPadCommit,
  numberPadKeyFor,
  numberPadState,
  numberPadValue,
  type NumberPadKey,
} from "./numberPad";
import { usePopoverDismiss } from "./usePopoverDismiss";
import "@/ui/Panel.css";
import "./NumberPad.css";

interface Props {
  /** The field the pad is anchored to; presses on it count as inside. */
  anchor: HTMLElement | null;
  value: number;
  min?: number | undefined;
  max?: number | undefined;
  /** Amount the −/+ keys move by. */
  step: number;
  label?: string | undefined;
  /** Unit of the value, echoed after the entry so the pad reads like the field. */
  unit?: string | undefined;
  onCommit: (value: number) => void;
  onCancel: () => void;
}

/** The digit block, placed explicitly so the layout never depends on flow
 * order around the column of editing keys. */
const DIGIT_KEYS: readonly { key: NumberPadKey; row: number; column: number }[] =
  ["7", "8", "9", "4", "5", "6", "1", "2", "3", "sign", "0", "."].map(
    (key, index) => ({
      key: key as NumberPadKey,
      row: Math.floor(index / 3) + 1,
      column: (index % 3) + 1,
    })
  );

const DIGIT_LABELS: Partial<Record<NumberPadKey, string>> = { sign: "±" };

/**
 * An in-app number pad, shown instead of focusing a field for text entry. It
 * exists for touch: the OS keyboard shifts the whole viewport on an iPad, and
 * hitting an exact value by scrubbing is hard with a finger. The field stays
 * read-only while this is open, so no software keyboard can appear.
 *
 * The entry is committed as a whole — one `onCommit`, so one undo step — and
 * discarding it leaves the field untouched.
 */
export default function NumberPad({
  anchor,
  value,
  min,
  max,
  step,
  label,
  unit,
  onCommit,
  onCancel,
}: Props) {
  const [state, setState] = useState(() => numberPadState(value));
  const range = { min, max };
  const pending = numberPadValue(state);

  const { refs, floatingStyles } = useFloating({
    placement: "bottom-start",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    elements: { reference: anchor },
  });

  const commit = () => {
    const committed = numberPadCommit(state, range);
    if (committed === null) onCancel();
    else onCommit(committed);
  };

  usePopoverDismiss(
    true,
    (t) => !!anchor?.contains(t) || !!refs.floating.current?.contains(t),
    onCancel
  );

  // A hardware keyboard should still work while the pad is up — and its keys
  // must not fall through to the editor's global shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit();
        return;
      }
      const key = numberPadKeyFor(event.key);
      if (!key) return;
      event.preventDefault();
      event.stopPropagation();
      setState((current) => applyKey(current, key));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const press = (key: NumberPadKey) => setState((s) => applyKey(s, key));

  const rangeHint =
    min != null && max != null
      ? `${min} – ${max}`
      : min != null
        ? `≥ ${min}`
        : max != null
          ? `≤ ${max}`
          : null;

  return createPortal(
    <div
      className="number-pad"
      ref={refs.setFloating}
      style={floatingStyles}
      // The pad portals to <body>, so a popover that contains the field it
      // belongs to (a colour popover, a bind menu) would otherwise read a press
      // on these keys as a press outside itself and close — taking the pad with
      // it. See `usePopoverDismiss`.
      data-nested-popover
      role="dialog"
      aria-label={label ? `${label} number pad` : "Number pad"}
    >
      <div className="number-pad-head">
        {label && <span className="number-pad-label">{label}</span>}
        {rangeHint && <span className="number-pad-range">{rangeHint}</span>}
      </div>
      <div className="number-pad-display" aria-live="polite">
        {state.text === "" ? <span className="number-pad-empty">0</span> : state.text}
        {unit && <span className="number-pad-unit">{unit}</span>}
      </div>
      <div className="number-pad-grid">
        {DIGIT_KEYS.map(({ key, row, column }) => (
          <button
            key={key}
            type="button"
            className="number-pad-key"
            style={{ gridArea: `${row} / ${column}` }}
            {...(key === "sign" ? { "aria-label": "Toggle sign" } : {})}
            onClick={() => press(key)}
          >
            {DIGIT_LABELS[key] ?? key}
          </button>
        ))}
        <button
          type="button"
          className="number-pad-key number-pad-side"
          style={{ gridArea: "1 / 4" }}
          onClick={() => press("backspace")}
          aria-label="Backspace"
        >
          <LuDelete aria-hidden />
        </button>
        <button
          type="button"
          className="number-pad-key number-pad-side"
          style={{ gridArea: "2 / 4" }}
          onClick={() => press("clear")}
        >
          C
        </button>
        <button
          type="button"
          className="number-pad-key number-pad-side"
          style={{ gridArea: "3 / 4" }}
          onClick={() => setState((s) => nudge(s, step, range))}
          aria-label="Increase"
        >
          +
        </button>
        <button
          type="button"
          className="number-pad-key number-pad-side"
          style={{ gridArea: "4 / 4" }}
          onClick={() => setState((s) => nudge(s, -step, range))}
          aria-label="Decrease"
        >
          −
        </button>
      </div>
      <div className="number-pad-foot">
        <button type="button" className="number-pad-action" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="number-pad-action primary"
          disabled={pending === null}
          onClick={commit}
        >
          OK
        </button>
      </div>
    </div>,
    document.body
  );
}
