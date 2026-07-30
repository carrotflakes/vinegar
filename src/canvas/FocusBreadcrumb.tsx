import { Fragment } from "react";
import { LuChevronRight, LuComponent, LuFileText, LuFrame, LuGroup } from "react-icons/lu";
import { enclosingSymbolId, isFrame } from "../model/scene";
import { useEditor } from "../store/editorStore";
import "./FocusBreadcrumb.css";

/**
 * The only on-canvas indicator that the view is isolated to one container, and
 * the way back out of it. The whole focus stack is shown, so nested edits read
 * as a path (`Document › Button › Icon`) instead of a single anonymous
 * "editing" banner; clicking a crumb pops straight to that level.
 */
export default function FocusBreadcrumb() {
  const focusStack = useEditor((s) => s.focusStack);
  const doc = useEditor((s) => s.doc);
  const exitFocusTo = useEditor((s) => s.exitFocusTo);

  if (!focusStack.length) return null;

  return (
    <nav className="focus-crumbs" aria-label="Focus scope">
      <button
        className="focus-crumb"
        onClick={() => exitFocusTo(0)}
        title="Back to the document"
      >
        <LuFileText aria-hidden />
        <span className="focus-crumb-name">{doc.metadata.name}</span>
      </button>
      {focusStack.map((id, i) => {
        const current = i === focusStack.length - 1;
        const node = doc.nodes[id];
        // A symbol under local-view edit is its definition root, and reads as
        // the symbol rather than as the anonymous group holding its content.
        const symbol = doc.symbols[enclosingSymbolId(doc, id) ?? ""];
        const asSymbol = symbol?.rootNodeId === id;
        const name = asSymbol ? symbol.name : node?.name || "Group";
        const Icon = asSymbol ? LuComponent : isFrame(node) ? LuFrame : LuGroup;
        return (
          <Fragment key={id}>
            <LuChevronRight className="focus-crumb-sep" aria-hidden />
            {current ? (
              <span className="focus-crumb current" aria-current="page">
                <Icon aria-hidden />
                <span className="focus-crumb-name">{name}</span>
              </span>
            ) : (
              <button
                className="focus-crumb"
                onClick={() => exitFocusTo(i + 1)}
                title={`Back to ${name}`}
              >
                <Icon aria-hidden />
                <span className="focus-crumb-name">{name}</span>
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
