import type {
  AnchorType,
  BrushAnchor,
  PathAnchor,
  Vec2,
} from "../types";

type AnchorLike = PathAnchor | BrushAnchor;

const RELATIVE_EPSILON = 1e-6;

function vector(from: Vec2, to: Vec2): Vec2 {
  return { x: to.x - from.x, y: to.y - from.y };
}

function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function unit(v: Vec2): Vec2 | null {
  const len = length(v);
  return len > 0 ? { x: v.x / len, y: v.y / len } : null;
}

function isAnchorType(value: unknown): value is AnchorType {
  return value === "cusp" || value === "smooth" || value === "symmetric";
}

/**
 * Infer linkage from untagged handle geometry. Tolerances are relative to the
 * two handle lengths so the result does not change when the path is scaled.
 */
export function deriveAnchorType(anchor: AnchorLike): AnchorType {
  if (!anchor.hIn && !anchor.hOut) return "cusp";
  if (!anchor.hIn || !anchor.hOut) return "cusp";

  const incoming = vector(anchor.p, anchor.hIn);
  const outgoing = vector(anchor.p, anchor.hOut);
  const inLength = length(incoming);
  const outLength = length(outgoing);
  if (inLength === 0 || outLength === 0) return "cusp";

  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  const collinear =
    dot < 0 &&
    Math.abs(cross) <= RELATIVE_EPSILON * inLength * outLength;
  if (!collinear) return "cusp";

  const equalLength =
    Math.abs(inLength - outLength) <=
    RELATIVE_EPSILON * Math.max(inLength, outLength);
  return equalLength ? "symmetric" : "smooth";
}

/** Explicit tags win; old documents derive the effective type from geometry. */
export function effectiveAnchorType(anchor: AnchorLike): AnchorType {
  return isAnchorType(anchor.t) ? anchor.t : deriveAnchorType(anchor);
}

function neighbourTangent(
  anchor: AnchorLike,
  previous: AnchorLike | null,
  next: AnchorLike | null
): Vec2 | null {
  if (previous && next) return unit(vector(previous.p, next.p));
  if (next) return unit(vector(anchor.p, next.p));
  if (previous) return unit(vector(previous.p, anchor.p));
  return null;
}

function samePoint(a: Vec2 | null, b: Vec2 | null): boolean {
  if (!a || !b) return a === b;
  const scale = Math.max(1, length(a), length(b));
  return (
    Math.abs(a.x - b.x) <= RELATIVE_EPSILON * scale &&
    Math.abs(a.y - b.y) <= RELATIVE_EPSILON * scale
  );
}

/**
 * Whether retyping produced no meaningful change, so callers can keep the
 * original anchor and avoid an empty document revision.
 */
function unchanged(before: AnchorLike, after: AnchorLike): boolean {
  return (
    before.t === after.t &&
    samePoint(before.hIn, after.hIn) &&
    samePoint(before.hOut, after.hOut)
  );
}

/**
 * Change an anchor's linkage and normalize its handles to agree with the tag.
 * Extra anchor fields (notably a brush anchor's width) are preserved. Returns
 * the original object when nothing moves and the tag already matches.
 */
export function setAnchorType<T extends AnchorLike>(
  anchor: T,
  type: AnchorType,
  previous: AnchorLike | null = null,
  next: AnchorLike | null = null
): T {
  const retyped = retype(anchor, type, previous, next);
  return unchanged(anchor, retyped) ? anchor : retyped;
}

function retype<T extends AnchorLike>(
  anchor: T,
  type: AnchorType,
  previous: AnchorLike | null,
  next: AnchorLike | null
): T {
  if (type === "cusp") return { ...anchor, t: type };

  const incomingLength = anchor.hIn
    ? length(vector(anchor.p, anchor.hIn))
    : previous
      ? length(vector(anchor.p, previous.p)) / 3
      : null;
  const outgoingLength = anchor.hOut
    ? length(vector(anchor.p, anchor.hOut))
    : next
      ? length(vector(anchor.p, next.p)) / 3
      : null;

  const incomingDirection = anchor.hIn
    ? unit(vector(anchor.hIn, anchor.p))
    : null;
  const outgoingDirection = anchor.hOut
    ? unit(vector(anchor.p, anchor.hOut))
    : null;
  let direction: Vec2 | null = null;
  if (incomingDirection && outgoingDirection) {
    direction = unit({
      x: incomingDirection.x + outgoingDirection.x,
      y: incomingDirection.y + outgoingDirection.y,
    });
  }
  direction ??= outgoingDirection;
  direction ??= incomingDirection;
  direction ??= neighbourTangent(anchor, previous, next);

  if (!direction) return { ...anchor, t: type };

  let inLength = incomingLength;
  let outLength = outgoingLength;
  if (type === "symmetric") {
    const lengths = [inLength, outLength].filter(
      (value): value is number => value !== null
    );
    const mean = lengths.length
      ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length
      : 0;
    if (inLength !== null) inLength = mean;
    if (outLength !== null) outLength = mean;
  }

  return {
    ...anchor,
    t: type,
    hIn: inLength === null
      ? null
      : {
          x: anchor.p.x - direction.x * inLength,
          y: anchor.p.y - direction.y * inLength,
        },
    hOut: outLength === null
      ? null
      : {
          x: anchor.p.x + direction.x * outLength,
          y: anchor.p.y + direction.y * outLength,
        },
  };
}
