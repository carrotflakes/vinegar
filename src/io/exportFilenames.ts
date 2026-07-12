/** Convert a display name to a filesystem-friendly export stem. */
export function fileSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "artboard";
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
