// What the Layers panel shows for a given query, and what a keystroke in it
// means. Split out of LayersPanel.tsx for the reason tree.ts was: the component
// itself cannot be exercised in tests (no jsdom, no browser renderer — see
// CLAUDE.md), so every decision it makes is made here instead, where
// tests/layersView.test.mjs can reach it. The component is left holding refs,
// store calls and JSX.

import type { Document } from "@/model/types";
import {
  containerIds,
  filterTree,
  flattenRows,
  searchMatcher,
  toDisplayTree,
  type DNode,
  type Row,
} from "./tree";

/** Stand-in fold state for the filtered list, which shows every row it keeps. */
const NO_FOLDS: Set<string> = new Set();

export interface LayersView {
  /** The search query, trimmed; "" when the list is not filtered. */
  query: string;
  filtering: boolean;
  /** The display tree, pruned to the matches when filtering. */
  roots: DNode[];
  /** The rows to draw, top to bottom. */
  rows: Row[];
  /** The fold state these rows were built with — empty while filtering. */
  folds: Set<string>;
  /** Every foldable container in the *whole* tree, for the fold menu. */
  foldable: string[];
  /** How many rows are hits rather than containers shown for context. */
  hitCount: number;
  /** The first hit, top to bottom; where Enter in the search field goes. */
  firstHit: string | null;
  /**
   * Row drag is off while the list is filtered: a drop index is read off the
   * *displayed* sibling list, and under a filter that list is missing rows, so
   * every index past the first hidden sibling would land somewhere else in the
   * document.
   */
  dndEnabled: boolean;
}

/**
 * Everything the panel derives from the document and its own view state.
 *
 * A search replaces the tree with the matches and the containers above them.
 * Folds are ignored while it is on: a hit inside a container the user had
 * folded shut is exactly what the search is for, and re-opening every such
 * container would leave the document unfolded once the search closes.
 */
export function layersView(opts: {
  doc: Document;
  /** The roots to show — the focus scope's children, not always the document's. */
  rootIds: string[];
  /** The search query, or `null` when the search bar is closed. */
  search: string | null;
  collapsed: Set<string>;
}): LayersView {
  const { doc, rootIds, search, collapsed } = opts;
  const fullRoots = toDisplayTree(doc, rootIds);
  const query = search?.trim() ?? "";
  const filtering = query !== "";
  const matches = searchMatcher(doc, query);
  const roots = filtering ? filterTree(fullRoots, matches) : fullRoots;
  const folds = filtering ? NO_FOLDS : collapsed;
  const rows = flattenRows(roots, folds);
  const hits = filtering ? rows.filter((row) => matches(row.node)) : [];
  return {
    query,
    filtering,
    roots,
    rows,
    folds,
    foldable: containerIds(fullRoots),
    hitCount: hits.length,
    firstHit: hits[0]?.key ?? null,
    dndEnabled: !filtering,
  };
}

/**
 * What a key pressed in the search field does. Escape clears a query first and
 * closes on a second press, so the field is never lost mid-search by one key
 * too many; Enter (and Down, which reads as "into the results") goes to the
 * first hit, because finding a layer is only half the job.
 */
export type SearchAction = "jump" | "clear" | "close" | null;

export function searchKeyAction(key: string, query: string): SearchAction {
  if (key === "Enter" || key === "ArrowDown") return "jump";
  if (key === "Escape") return query === "" ? "close" : "clear";
  return null;
}

/**
 * What a key pressed on the focused row list does. `move` carries the row to
 * land on and whether the selection extends to it (Shift); `fold` is a toggle
 * of the row it names. `null` is a key this list does not claim — except for
 * the arrows, which the component swallows either way so they never reach the
 * canvas and nudge the artwork.
 */
export type ListAction =
  | { type: "raise" }
  | { type: "lower" }
  | { type: "move"; to: string; extend: boolean }
  | { type: "fold"; id: string }
  | null;

export function listKeyAction(opts: {
  key: string;
  alt: boolean;
  shift: boolean;
  /** Row ids top to bottom. */
  order: string[];
  /** The row the cursor sits on, if any. */
  at: string | null;
  /** Folds are inert while the list is filtered — there are none to walk. */
  filtering: boolean;
  /** Whether the cursor's row is folded shut. */
  collapsed: boolean;
  /** Whether the cursor's row has children to fold at all. */
  foldable: boolean;
}): ListAction {
  const { key, alt, shift, order, at, filtering, collapsed, foldable } = opts;
  const down = key === "ArrowDown";

  // Alt+Arrow reorders the selection one slot instead of moving the cursor. Up
  // is toward the front (raise), matching the panel's front-most-first order.
  if (alt && (down || key === "ArrowUp")) return down ? { type: "lower" } : { type: "raise" };

  if (down || key === "ArrowUp") {
    const index = at ? order.indexOf(at) : -1;
    // No cursor yet: enter the list from the end the key points away from.
    const next =
      index < 0
        ? order[down ? 0 : order.length - 1]
        : order[Math.max(0, Math.min(order.length - 1, index + (down ? 1 : -1)))];
    return next === undefined ? null : { type: "move", to: next, extend: shift };
  }

  if (key === "ArrowRight" || key === "ArrowLeft") {
    if (filtering || at === null || !foldable) return null;
    const wantOpen = key === "ArrowRight";
    return wantOpen === collapsed ? { type: "fold", id: at } : null;
  }

  return null;
}
