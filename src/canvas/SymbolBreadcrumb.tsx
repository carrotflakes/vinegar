import { Fragment } from "react";
import { LuChevronRight, LuComponent, LuFileText } from "react-icons/lu";
import { useEditor } from "../store/editorStore";
import "./SymbolBreadcrumb.css";

/**
 * The only on-canvas indicator that the view is a symbol's local edit scope,
 * and the way back out of it. The whole `editingSymbols` stack is shown, so
 * nested edits read as a path (`Document › Button › Icon`) instead of a single
 * anonymous "editing" banner; clicking a crumb pops straight to that level.
 */
export default function SymbolBreadcrumb() {
  const editingSymbols = useEditor((s) => s.editingSymbols);
  const docName = useEditor((s) => s.doc.metadata.name);
  const symbols = useEditor((s) => s.doc.symbols);
  const exitSymbolEditTo = useEditor((s) => s.exitSymbolEditTo);

  if (!editingSymbols.length) return null;

  return (
    <nav className="symbol-crumbs" aria-label="Symbol edit scope">
      <button
        className="symbol-crumb"
        onClick={() => exitSymbolEditTo(0)}
        title="Back to the document"
      >
        <LuFileText aria-hidden />
        <span className="symbol-crumb-name">{docName}</span>
      </button>
      {editingSymbols.map((id, i) => {
        const current = i === editingSymbols.length - 1;
        const name = symbols[id]?.name ?? "Symbol";
        return (
          <Fragment key={id}>
            <LuChevronRight className="symbol-crumb-sep" aria-hidden />
            {current ? (
              <span className="symbol-crumb current" aria-current="page">
                <LuComponent aria-hidden />
                <span className="symbol-crumb-name">{name}</span>
              </span>
            ) : (
              <button
                className="symbol-crumb"
                onClick={() => exitSymbolEditTo(i + 1)}
                title={`Back to ${name}`}
              >
                <LuComponent aria-hidden />
                <span className="symbol-crumb-name">{name}</span>
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
