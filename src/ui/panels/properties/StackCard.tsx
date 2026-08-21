import { LuChevronDown, LuChevronUp, LuX } from "react-icons/lu";
import type { ReactNode } from "react";

/**
 * One entry of an ordered stack — an effect or a path modifier. The head
 * carries the entry's name and the operations every stack shares (bypass,
 * reorder, remove); `actions` takes stack-specific buttons and `children` the
 * entry's own parameter fields.
 */
export default function StackCard({
  name,
  index,
  count,
  onMove,
  onRemove,
  enabled,
  actions,
  children,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  /** Present when the entry can be bypassed instead of removed. */
  enabled?: { value: boolean; onChange: () => void };
  /** Extra head buttons, placed just before Remove. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="stack-card">
      <div className="field-row stack-head">
        {enabled && (
          <input
            type="checkbox"
            checked={enabled.value}
            title={enabled.value ? "Disable" : "Enable"}
            aria-label={`${name} enabled`}
            onChange={enabled.onChange}
          />
        )}
        <span className="stack-name">{name}</span>
        <button
          className="ghost-btn icon-btn"
          title="Move up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <LuChevronUp aria-hidden />
        </button>
        <button
          className="ghost-btn icon-btn"
          title="Move down"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <LuChevronDown aria-hidden />
        </button>
        {actions}
        <button
          className="ghost-btn icon-btn danger"
          title="Remove"
          onClick={onRemove}
        >
          <LuX aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}
