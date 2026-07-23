import type { PathAnchor, PathShape, PathSubpath } from "./types";

/**
 * Split the anchor at `index` into two coincident endpoints, severing the
 * contour there without changing the drawn curve. The left copy keeps its
 * incoming handle (`hIn`) and drops `hOut`; the right copy keeps its outgoing
 * handle (`hOut`) and drops `hIn`. This is the exact inverse of the weld that
 * {@link joinShapes} performs (junction keeps `first.hIn` / `second.hOut`).
 */
function severAnchor(a: PathAnchor): [PathAnchor, PathAnchor] {
  return [
    { p: a.p, hIn: a.hIn, hOut: null },
    { p: a.p, hIn: null, hOut: a.hOut },
  ];
}

/**
 * Cut a single subpath at the given anchor indices, returning the resulting
 * open contours. Cutting an open subpath at k interior anchors yields k+1
 * subpaths; endpoints are ignored. Cutting a closed subpath opens it, rolling
 * the anchor order so it starts at the first cut, then severs the rest.
 */
function cutSubpath(sp: PathSubpath, indices: number[]): PathSubpath[] {
  const n = sp.anchors.length;
  if (n < 2) return [sp];

  if (sp.closed) {
    const cuts = [...new Set(indices)].sort((a, b) => a - b);
    if (!cuts.length) return [sp];
    // Reopen the loop at the first cut: rotate so it becomes the shared start
    // and end. The start keeps hOut, the end keeps hIn.
    const start = cuts[0];
    const rolled = [
      ...sp.anchors.slice(start),
      ...sp.anchors.slice(0, start),
    ];
    const [, head] = severAnchor(rolled[0]);
    const [tail] = severAnchor(rolled[0]);
    const opened: PathAnchor[] = [head, ...rolled.slice(1), tail];
    // Remaining cuts, expressed as offsets in the rolled/opened array.
    const rest = cuts.slice(1).map((i) => (i - start + n) % n);
    return cutOpen(opened, rest);
  }

  const interior = [...new Set(indices)]
    .filter((i) => i > 0 && i < n - 1)
    .sort((a, b) => a - b);
  if (!interior.length) return [sp];
  return cutOpen(sp.anchors, interior);
}

/** Split an open anchor run at the given interior indices into open subpaths. */
function cutOpen(anchors: PathAnchor[], cuts: number[]): PathSubpath[] {
  const out: PathSubpath[] = [];
  let start = 0;
  for (const k of cuts) {
    const [left, right] = severAnchor(anchors[k]);
    out.push({
      anchors: [...anchors.slice(start, k), left],
      closed: false,
    });
    // Continue the next run from the right copy of the severed anchor.
    anchors = [...anchors.slice(0, k), right, ...anchors.slice(k + 1)];
    start = k;
  }
  out.push({ anchors: anchors.slice(start), closed: false });
  return out;
}

/**
 * Cut the given path shape's subpaths at the selected anchors, breaking each
 * contour into open pieces. `cuts` names anchors by their subpath index and
 * anchor index. Returns a new shape (transform preserved, generator cleared by
 * the caller) or null when no cut applies — e.g. only endpoints were selected.
 */
export function cutPathAtNodes(
  shape: PathShape,
  cuts: { sub: number; index: number }[]
): PathShape | null {
  const bySub = new Map<number, number[]>();
  for (const { sub, index } of cuts) {
    const list = bySub.get(sub);
    if (list) list.push(index);
    else bySub.set(sub, [index]);
  }

  let changed = false;
  const subpaths: PathSubpath[] = [];
  shape.subpaths.forEach((sp, i) => {
    const indices = bySub.get(i);
    if (!indices) {
      subpaths.push(sp);
      return;
    }
    const pieces = cutSubpath(sp, indices);
    if (pieces.length !== 1 || pieces[0] !== sp) changed = true;
    subpaths.push(...pieces);
  });

  if (!changed) return null;
  return { ...shape, subpaths };
}

/** Whether any of the given anchors would actually cut the shape's contours. */
export function hasCuttableNodes(
  shape: PathShape,
  cuts: { sub: number; index: number }[]
): boolean {
  return cuts.some(({ sub, index }) => {
    const sp = shape.subpaths[sub];
    if (!sp || sp.anchors.length < 2) return false;
    return sp.closed || (index > 0 && index < sp.anchors.length - 1);
  });
}
