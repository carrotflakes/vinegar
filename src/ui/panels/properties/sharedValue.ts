/**
 * Reading one value out of a multi-node selection.
 *
 * A panel field addresses every selected node at once, so it can only show a
 * number or a colour when they all agree. Showing the first node's value
 * instead reads as "they are all like this" and invites an edit that silently
 * overwrites the others — so a disagreeing field reports `mixed` and renders
 * blank, the way Figma and Illustrator do.
 */

/** Structural equality over plain paint/style data (objects, arrays, scalars). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      sameValue(left[key], right[key])
  );
}

export interface SharedValue<T> {
  /** The value to display and to edit from — the first node's when mixed. */
  value: T;
  /** True when the selected nodes disagree, so the value stands for one of them. */
  mixed: boolean;
}

/**
 * The value `read` gives for every item, or the first item's value flagged as
 * `mixed`. An empty list yields `fallback` (the new-shape defaults case).
 */
export function sharedValue<T, R>(
  items: readonly T[],
  read: (item: T) => R,
  fallback: R
): SharedValue<R> {
  const first = items[0];
  if (first === undefined) return { value: fallback, mixed: false };
  const value = read(first);
  return {
    value,
    mixed: items.some((item) => !sameValue(read(item), value)),
  };
}
