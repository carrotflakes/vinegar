import { useRef, useState } from "react";
import { LuLink, LuTriangleAlert, LuUnlink } from "react-icons/lu";
import { numberVars } from "@/model/vars";
import { useEditor } from "@/store/editorStore";
import ScrubbableNumber from "./ScrubbableNumber";
import { usePopoverDismiss } from "./usePopoverDismiss";
import "./BindableNumber.css";

type Props = {
  /** The node the field belongs to, and its bindable field path. */
  nodeId: string;
  path: string;
  /** Field name, used as the default name of a variable created from here. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number | undefined;
  max?: number;
  step?: number;
  defaultValue?: number;
  className?: string;
  /** When set, binding is refused and the button explains why. */
  bindDisabled?: string | undefined;
};

/**
 * A number field that can be driven by a document variable. Unbound it is a
 * plain {@link ScrubbableNumber} plus a link button offering the document's
 * number variables; bound, the same field scrubs *the variable* — every other
 * field bound to it moves too — and the button unbinds, keeping the current
 * value.
 *
 * Scrubbing a variable rewrites every node bound to it, so it batches through
 * the interaction pattern rather than by coalescing per-frame transactions.
 * See docs/parameters.md.
 */
export default function BindableNumber({
  nodeId,
  path,
  label,
  value,
  onChange,
  min,
  max,
  step,
  defaultValue,
  className = "num",
  bindDisabled,
}: Props) {
  const ref = useEditor((s) => s.doc.nodes[nodeId]?.bindings[path]);
  // Narrow selectors: this control is rendered per numeric field, so it should
  // not re-render on every unrelated document edit.
  const vars = useEditor((s) => s.doc.vars);
  const varOrder = useEditor((s) => s.doc.varOrder);
  const bindField = useEditor((s) => s.bindField);
  const unbindField = useEditor((s) => s.unbindField);
  const bindFieldToNewVar = useEditor((s) => s.bindFieldToNewVar);
  const updateVar = useEditor((s) => s.updateVar);
  const beginInteraction = useEditor((s) => s.beginInteraction);
  const endInteraction = useEditor((s) => s.endInteraction);
  const cancelInteraction = useEditor((s) => s.cancelInteraction);

  // Only number variables can drive a number field.
  const numbers = numberVars({ vars, varOrder });

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(
    open,
    (target) => !!wrapRef.current?.contains(target),
    () => setOpen(false)
  );

  const bound = ref ? vars[ref.varId] : undefined;
  const number = bound?.value.kind === "number" ? bound.value : null;
  const dangling = !!ref && !number;

  // Bound: the field drives the variable behind it, divided back out through
  // the per-use scale so "half of X" stays half of X while being scrubbed.
  const setValue = (next: number) => {
    if (!ref || !bound || !number) return onChange(next);
    const scale = ref.scale === 0 ? 1 : ref.scale;
    updateVar(ref.varId, { value: { ...number, value: next / scale } });
  };

  const title = dangling
    ? "Variable is missing — showing the last value"
    : ref && bound
      ? `Bound to “${bound.name}”${ref.scale === 1 ? "" : ` × ${ref.scale}`}`
      : bindDisabled ?? "Bind to a variable";

  return (
    <div className="bindable" ref={wrapRef}>
      <ScrubbableNumber
        className={className}
        min={min}
        value={value}
        {...(max !== undefined ? { max } : {})}
        {...(step !== undefined ? { step } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        aria-label={label}
        onChange={setValue}
        onScrubStart={() => beginInteraction(number ? "Edit variable" : `Edit ${label}`)}
        onScrubEnd={endInteraction}
        onScrubCancel={cancelInteraction}
      />
      <button
        type="button"
        className={`bind-btn${ref ? " bound" : ""}${dangling ? " dangling" : ""}`}
        title={title}
        aria-label={title}
        disabled={!ref && !!bindDisabled}
        onClick={() => setOpen((v) => !v)}
      >
        {dangling ? <LuTriangleAlert /> : ref ? <LuLink /> : <LuUnlink />}
      </button>
      {open && (
        <div className="bind-menu">
          {ref ? (
            <>
              <div className="bind-menu-head">
                {bound ? bound.name : "Missing variable"}
              </div>
              <button
                type="button"
                className="bind-menu-item"
                onClick={() => {
                  unbindField(nodeId, path);
                  setOpen(false);
                }}
              >
                Unbind (keep value)
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="bind-menu-item"
                onClick={() => {
                  bindFieldToNewVar(nodeId, path, label);
                  setOpen(false);
                }}
              >
                New variable from this value
              </button>
              {numbers.length > 0 && <div className="bind-menu-sep" />}
              {numbers.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className="bind-menu-item"
                  onClick={() => {
                    bindField(nodeId, path, entry.id);
                    setOpen(false);
                  }}
                >
                  <span className="bind-menu-name">{entry.name}</span>
                  <span className="bind-menu-value">
                    {entry.value.kind === "number" ? entry.value.value : ""}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
