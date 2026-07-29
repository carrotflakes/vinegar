import type { ReactNode } from "react";

/**
 * One titled block inside a dock panel. "Panel" is the dock tab; "section" is
 * a division of its body — every panel body should be a stack of these rather
 * than hand-written `.section` divs.
 */
export default function Section({
  title,
  actions,
  children,
}: {
  /** Omitted for sections that continue the one above them. */
  title?: string;
  /** Rendered on the title row, right-aligned (e.g. an add button). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="section">
      {(title !== undefined || actions) && (
        <div className="section-head">
          {title !== undefined && (
            <div className="section-title">{title}</div>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
