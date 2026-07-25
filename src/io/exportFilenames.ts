/**
 * Convert a display name to a filesystem-friendly export stem.
 *
 * Letters and digits of *any* script are kept — a document or frame named
 * 「スケッチ」 keeps its name rather than collapsing to the fallback — while
 * separators and everything a filesystem dislikes (`/ \ : * ? " < > |`,
 * control characters) become hyphens. `fallback` names the result when nothing
 * usable survives.
 */
export function fileSlug(name: string, fallback = "frame"): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    // Keep well clear of the ~255-byte limit filesystems impose, with room for
    // a numeric suffix and an extension.
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || fallback;
}

/**
 * Return unique export stems in input order. Repeated or colliding stems gain
 * the first available numeric suffix (`board`, `board-2`, `board-3`, ...).
 */
export function uniqueFileSlugs(names: readonly string[]): string[] {
  const used = new Set<string>();

  return names.map((name) => {
    const base = fileSlug(name);
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) slug = `${base}-${suffix++}`;
    used.add(slug);
    return slug;
  });
}
