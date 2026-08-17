import { useRef, useState } from "react";
import { LuLink, LuTriangleAlert, LuUnlink } from "react-icons/lu";
import { useEditor } from "@/store/editorStore";
import ScrubbableNumber from "./ScrubbableNumber";
import { usePopoverDismiss } from "./usePopoverDismiss";
import "./BindableNumber.css";

type Props = {
  /** The node the field belongs to, and its bindable field path. */
  nodeId: string;
  path: string;
  /** Field name, used as the default name of a parameter created from here. */
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
 * A number field that can be driven by a document parameter. Unbound it is a
 * plain {@link ScrubbableNumber} plus a link button offering the document's
 * parameters; bound, the same field scrubs *the parameter* — every other field
 * bound to it moves too — and the button unbinds, keeping the current value.
 *
 * Scrubbing a parameter rewrites every node bound to it, so it batches through
 * the interaction pattern rather than by coalescing per-frame transactions.
 * See docs/design/parameters.md.
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
  const params = useEditor((s) => s.doc.params);
  const paramOrder = useEditor((s) => s.doc.paramOrder);
  const bindField = useEditor((s) => s.bindField);
  const unbindField = useEditor((s) => s.unbindField);
  const bindFieldToNewParam = useEditor((s) => s.bindFieldToNewParam);
  const updateParam = useEditor((s) => s.updateParam);
  const beginInteraction = useEditor((s) => s.beginInteraction);
  const endInteraction = useEditor((s) => s.endInteraction);
  const cancelInteraction = useEditor((s) => s.cancelInteraction);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(
    open,
    (target) =>
      !!wrapRef.current?.contains(target) ||
      // The number pad portals to <body> but belongs to the field in here.
      (target instanceof Element && !!target.closest("[data-nested-popover]")),
    () => setOpen(false)
  );

  const param = ref ? params[ref.paramId] : undefined;
  const dangling = !!ref && !param;

  // Bound: the field drives the parameter behind it, divided back out through
  // the per-use scale so "half of X" stays half of X while being scrubbed.
  const setValue = (next: number) => {
    if (!ref || !param) return onChange(next);
    const scale = ref.scale === 0 ? 1 : ref.scale;
    updateParam(ref.paramId, { value: next / scale });
  };

  const title = dangling
    ? "Parameter is missing — showing the last value"
    : ref && param
      ? `Bound to “${param.name}”${ref.scale === 1 ? "" : ` × ${ref.scale}`}`
      : bindDisabled ?? "Bind to a parameter";

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
        onScrubStart={() => beginInteraction(param ? "Edit parameter" : `Edit ${label}`)}
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
                {param ? param.name : "Missing parameter"}
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
                  bindFieldToNewParam(nodeId, path, label);
                  setOpen(false);
                }}
              >
                New parameter from this value
              </button>
              {paramOrder.length > 0 && <div className="bind-menu-sep" />}
              {paramOrder.map((id) => {
                const p = params[id];
                if (!p) return null;
                return (
                  <button
                    type="button"
                    key={id}
                    className="bind-menu-item"
                    onClick={() => {
                      bindField(nodeId, path, id);
                      setOpen(false);
                    }}
                  >
                    <span className="bind-menu-name">{p.name}</span>
                    <span className="bind-menu-value">{p.value}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
