import { useRef, useState } from "react";
import { LuLink, LuTriangleAlert, LuUnlink } from "react-icons/lu";
import { numberVars } from "@/model/vars";
import { enclosingSymbolId } from "@/model/scene";
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
 * Inside a symbol definition the same menu also offers that symbol's numeric
 * parameters (and promoting this field into a new one). A field bound to one
 * scrubs the definition's default, while each instance may override it — the
 * per-instance value is derived, never stored on the node (phase 2b).
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
  // A field inside a symbol definition can also be driven by that symbol's own
  // parameters, which live in the same id space as the document's variables.
  const symbolId = useEditor((s) => enclosingSymbolId(s.doc, nodeId));
  const symbolParams = useEditor((s) =>
    symbolId ? s.doc.symbols[symbolId]?.params : undefined
  );
  const promoteNumberToSymbolParam = useEditor(
    (s) => s.promoteNumberToSymbolParam
  );
  const setSymbolParamDefault = useEditor((s) => s.setSymbolParamDefault);
  const bindField = useEditor((s) => s.bindField);
  const unbindField = useEditor((s) => s.unbindField);
  const bindFieldToNewVar = useEditor((s) => s.bindFieldToNewVar);
  const updateVar = useEditor((s) => s.updateVar);
  const beginInteraction = useEditor((s) => s.beginInteraction);
  const endInteraction = useEditor((s) => s.endInteraction);
  const cancelInteraction = useEditor((s) => s.cancelInteraction);

  // Only number variables can drive a number field.
  const numbers = numberVars({ vars, varOrder });
  const numberParams = (symbolParams ?? []).filter(
    (param) => param.default.kind === "number"
  );

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(
    open,
    (target) => !!wrapRef.current?.contains(target),
    () => setOpen(false)
  );

  // A reference names either a document variable or, inside a definition, one
  // of that symbol's parameters — one id space, two homes.
  const docVar = ref ? vars[ref.varId] : undefined;
  const param = ref ? numberParams.find((p) => p.key === ref.varId) : undefined;
  const boundName = docVar?.name ?? param?.label;
  const number =
    docVar?.value.kind === "number"
      ? docVar.value
      : param?.default.kind === "number"
        ? param.default
        : null;
  const dangling = !!ref && !number;

  // Bound: the field drives the value behind it, divided back out through the
  // per-use scale so "half of X" stays half of X while being scrubbed. For a
  // symbol parameter that value is the definition's default; instances that
  // override it keep their own.
  const setValue = (next: number) => {
    if (!ref || !number) return onChange(next);
    const scale = ref.scale === 0 ? 1 : ref.scale;
    const value = { ...number, value: next / scale };
    if (docVar) updateVar(ref.varId, { value });
    else if (param && symbolId) setSymbolParamDefault(symbolId, ref.varId, value);
  };

  const title = dangling
    ? "Variable is missing — showing the last value"
    : ref && boundName
      ? `Bound to “${boundName}”${ref.scale === 1 ? "" : ` × ${ref.scale}`}`
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
        onScrubStart={() =>
          beginInteraction(
            !number
              ? `Edit ${label}`
              : docVar
                ? "Edit variable"
                : "Edit symbol parameter"
          )
        }
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
                {boundName ?? "Missing variable"}
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
              {symbolId && (
                <button
                  type="button"
                  className="bind-menu-item"
                  onClick={() => {
                    promoteNumberToSymbolParam(nodeId, path, label);
                    setOpen(false);
                  }}
                >
                  New symbol parameter from this value
                </button>
              )}
              {numbers.length + numberParams.length > 0 && (
                <div className="bind-menu-sep" />
              )}
              {numberParams.map((entry) => (
                <button
                  type="button"
                  key={entry.key}
                  className="bind-menu-item"
                  onClick={() => {
                    bindField(nodeId, path, entry.key);
                    setOpen(false);
                  }}
                >
                  <span className="bind-menu-name">{entry.label}</span>
                  <span className="bind-menu-value">
                    {entry.default.kind === "number" ? entry.default.value : ""}
                  </span>
                </button>
              ))}
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
