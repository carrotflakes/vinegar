import type { ReactNode } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { useSectionFold } from "@/store/sectionFoldStore";

/**
 * One titled block inside a dock panel. "Panel" is the dock tab; "section" is
 * a division of its body — every panel body should be a stack of these rather
 * than hand-written `.section` divs.
 *
 * Giving a section an `id` makes its title a fold toggle: the Properties panel
 * stacks up to eight sections for a single selection, and folding the ones a
 * given piece of work does not touch is the only way to keep the ones it does
 * on screen together. The fold is remembered per id, outside the component.
 */
export default function Section({
  id,
  title,
  actions,
  children,
}: {
  /** Stable key that makes the section foldable and remembers its fold. */
  id?: string;
  /** Omitted for sections that continue the one above them. */
  title?: string;
  /** Rendered on the title row, right-aligned (e.g. an add button). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useSectionFold((state) =>
    id ? state.collapsed.has(id) : false
  );
  const toggle = useSectionFold((state) => state.toggle);
  // A title is what carries the toggle; a section without one cannot fold.
  const foldable = id !== undefined && title !== undefined;

  return (
    <div className={"section" + (collapsed ? " is-collapsed" : "")}>
      {(title !== undefined || actions) && (
        <div className="section-head">
          {title !== undefined &&
            (foldable ? (
              <button
                type="button"
                className="section-title section-toggle"
                aria-expanded={!collapsed}
                onClick={() => toggle(id)}
              >
                {collapsed ? (
                  <LuChevronRight aria-hidden />
                ) : (
                  <LuChevronDown aria-hidden />
                )}
                <span>{title}</span>
              </button>
            ) : (
              <div className="section-title">{title}</div>
            ))}
          {actions}
        </div>
      )}
      {!collapsed && children}
    </div>
  );
}
