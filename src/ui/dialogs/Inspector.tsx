import { useEffect, useRef, useState } from "react";
import { LuX } from "react-icons/lu";
import { useEditor } from "../../store/editorStore";
import "../Modal.css";
import "./Inspector.css";

// ===========================================================================
// Debug project inspector. Reflectively walks the whole editor store as a
// JSON-style collapsible tree. It reads whatever the store holds, so new
// state fields show up automatically — no need to touch this file when other
// features add to the store. Functions (actions) are hidden.
// ===========================================================================

interface Props {
  open: boolean;
  focusPath?: string[] | null;
  onClose: () => void;
}

export default function Inspector({ open, focusPath = null, onClose }: Props) {
  // Subscribe to the whole store so the tree stays live as state changes.
  const state = useEditor();
  const [query, setQuery] = useState("");
  const focusKey = focusPath?.join("\u0000") ?? "";

  useEffect(() => {
    if (open && focusPath?.length) setQuery("");
  }, [focusKey, open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();

  const copy = () => {
    navigator.clipboard?.writeText(safeStringify(state, 2));
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal inspector-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Inspector</span>
          <button className="modal-close" onClick={onClose} title="Close" aria-label="Close">
            <LuX aria-hidden />
          </button>
        </div>
        <input
          className="inspector-search"
          placeholder="Filter keys and values…"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inspector-tree">
          {renderChildren(state, 0, new Set(), q, false, [], focusPath ?? [])}
        </div>
        <div className="modal-foot">
          <span className="script-status">Read-only snapshot of the store</span>
          <button className="modal-primary-btn" onClick={copy}>
            Copy JSON
          </button>
        </div>
      </div>
    </div>
  );
}

interface NodeProps {
  name: string;
  value: unknown;
  depth: number;
  ancestors: Set<object>;
  /** Lowercased filter, or "" when inactive. */
  query: string;
  /** True when an ancestor key matched: show this whole subtree unfiltered. */
  forceShow: boolean;
  path: string[];
  focusPath: string[];
}

function Node({
  name,
  value,
  depth,
  ancestors,
  query,
  forceShow,
  path,
  focusPath,
}: NodeProps) {
  const expandable = isExpandable(value) && !ancestors.has(value);
  const focused = pathsEqual(path, focusPath);
  const focusInBranch =
    path.length < focusPath.length && pathIsPrefix(path, focusPath);
  const [open, setOpen] = useState(depth < 1 || focused);
  const focusKey = focusPath.join("\u0000");
  const focusedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) focusedRef.current?.scrollIntoView({ block: "center" });
  }, [focusKey, focused]);

  const active = query.length > 0;
  const keyMatch = name.toLowerCase().includes(query);
  const pad = { paddingLeft: 8 + depth * 14 };

  if (!expandable) {
    if (active && !forceShow && !keyMatch && !leafText(value).includes(query)) {
      return null;
    }
    return (
      <div
        ref={focused ? focusedRef : undefined}
        className={`ins-row${focused ? " ins-focused" : ""}`}
        style={pad}
      >
        <span className="ins-toggle ins-leaf" />
        <span className="ins-key">{name}</span>
        <span className="ins-colon">:</span>
        {renderLeaf(value, ancestors)}
      </div>
    );
  }

  const next = new Set(ancestors).add(value as object);
  if (active && !forceShow && !keyMatch && !contains(value, query, next)) {
    return null;
  }
  // When a key matches, reveal its whole subtree; otherwise keep filtering.
  const childForce = forceShow || keyMatch;
  const isOpen = active || focusInBranch ? true : open;

  return (
    <>
      <div
        ref={focused ? focusedRef : undefined}
        className={`ins-row ins-branch${focused ? " ins-focused" : ""}`}
        style={pad}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ins-toggle">{isOpen ? "▾" : "▸"}</span>
        <span className="ins-key">{name}</span>
        <span className="ins-colon">:</span>
        <span className="ins-summary">{summarize(value)}</span>
      </div>
      {isOpen &&
        renderChildren(
          value,
          depth + 1,
          next,
          query,
          childForce,
          path,
          focusPath
        )}
    </>
  );
}

function renderChildren(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  query: string,
  forceShow: boolean,
  parentPath: string[],
  focusPath: string[]
) {
  return entries(value).map(([name, child]) => {
    const path = [...parentPath, name];
    return (
      <Node
        key={name}
        name={name}
        value={child}
        depth={depth}
        ancestors={ancestors}
        query={query}
        forceShow={forceShow}
        path={path}
        focusPath={focusPath}
      />
    );
  });
}

function pathsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}

function pathIsPrefix(prefix: string[], path: string[]): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((part, i) => part === path[i])
  );
}

/** Whether a key or leaf value anywhere under `value` matches the query. */
function contains(value: unknown, query: string, ancestors: Set<object>): boolean {
  return entries(value).some(([k, v]) => {
    if (k.toLowerCase().includes(query)) return true;
    if (isExpandable(v)) {
      if (ancestors.has(v)) return false;
      return contains(v, query, new Set(ancestors).add(v));
    }
    return leafText(v).includes(query);
  });
}

/** Own enumerable members of an object/array, minus functions. */
function entries(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((v, i) => [String(i), v]);
  if (isExpandable(value)) {
    return Object.entries(value).filter(([, v]) => typeof v !== "function");
  }
  return [];
}

function isExpandable(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

/** Lowercased text a leaf is matched against. */
function leafText(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value).toLowerCase();
}

/** A one-line summary of a collapsed container. */
function summarize(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  const keys = Object.keys(value as object).filter(
    (k) => typeof (value as Record<string, unknown>)[k] !== "function"
  );
  return `{ ${keys.length} }`;
}

function renderLeaf(value: unknown, ancestors: Set<object>) {
  if (isExpandable(value) && ancestors.has(value)) {
    return <span className="ins-val ins-circular">[Circular]</span>;
  }
  if (value === null) return <span className="ins-val ins-null">null</span>;
  if (value === undefined) return <span className="ins-val ins-null">undefined</span>;
  const t = typeof value;
  if (t === "string") return <span className="ins-val ins-string">"{value as string}"</span>;
  if (t === "number") return <span className="ins-val ins-number">{String(value)}</span>;
  if (t === "boolean") return <span className="ins-val ins-boolean">{String(value)}</span>;
  return <span className="ins-val">{String(value)}</span>;
}

/** JSON.stringify that tolerates circular refs (drops the repeated node). */
function safeStringify(value: unknown, space: number) {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_k, v) => {
      if (v !== null && typeof v === "object") {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    },
    space
  );
}
