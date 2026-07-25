import type { ReactNode } from "react";
import "@/ui/Panel.css";
import "./SegmentedControl.css";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  value: T | null;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * A compact single-choice button row. A null value represents a mixed or
 * indeterminate selection, so no segment is pressed.
 */
export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: Props<T>) {
  return (
    <div
      className={"segmented-control" + (className ? ` ${className}` : "")}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={"ghost-btn segmented-control-button" + (active ? " active" : "")}
            aria-pressed={active}
            title={option.title}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
