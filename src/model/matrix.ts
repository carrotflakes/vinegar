import type { Bounds, Document, Group, Matrix, Shape, Vec2 } from "./types";

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m: Matrix, p: Vec2): Vec2 {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

export function invertMatrix(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function rotation(angle: number): Matrix {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, -s, c, 0, 0];
}

export function rotationAbout(pivot: Vec2, angle: number): Matrix {
  return multiply(
    translation(pivot.x, pivot.y),
    multiply(rotation(angle), translation(-pivot.x, -pivot.y))
  );
}

export function matrixAngle(m: Matrix): number {
  return Math.atan2(m[1], m[0]);
}

/** Largest linear scale component; useful for world/local tolerances. */
export function matrixScale(m: Matrix): number {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]), 1e-12);
}

export function transformBounds(bounds: Bounds, matrix: Matrix): Bounds {
  const points = [
    applyMatrix(matrix, { x: bounds.x, y: bounds.y }),
    applyMatrix(matrix, { x: bounds.x + bounds.width, y: bounds.y }),
    applyMatrix(matrix, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }),
    applyMatrix(matrix, { x: bounds.x, y: bounds.y + bounds.height }),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Matrix from a group's local space to world space. */
export function groupWorldMatrix(doc: Document, groupId?: string | null): Matrix {
  const chain: Matrix[] = [];
  const seen = new Set<string>();
  let id = groupId ?? null;
  while (id && doc.groups[id] && !seen.has(id)) {
    seen.add(id);
    chain.push(doc.groups[id].transform);
    id = doc.groups[id].parentId ?? null;
  }
  return chain.reverse().reduce(multiply, IDENTITY);
}

/** Matrix from a shape's local geometry to world space. */
export function shapeWorldMatrix(doc: Document, shape: Shape): Matrix {
  return multiply(groupWorldMatrix(doc, shape.groupId), shape.transform);
}

/** Apply a world-space transform while keeping the shape parent unchanged. */
export function applyWorldTransform(
  doc: Document,
  shape: Shape,
  worldDelta: Matrix
): Shape {
  const parent = groupWorldMatrix(doc, shape.groupId);
  const inverseParent = invertMatrix(parent);
  if (!inverseParent) return shape;
  return {
    ...shape,
    transform: multiply(
      inverseParent,
      multiply(worldDelta, multiply(parent, shape.transform))
    ),
  };
}

/** Apply a world-space transform while keeping the group parent unchanged. */
export function applyWorldTransformToGroup(
  doc: Document,
  group: Group,
  worldDelta: Matrix
): Group {
  const parent = groupWorldMatrix(doc, group.parentId);
  const inverseParent = invertMatrix(parent);
  if (!inverseParent) return group;
  return {
    ...group,
    transform: multiply(
      inverseParent,
      multiply(worldDelta, multiply(parent, group.transform))
    ),
  };
}

/** Matrix mapping one axis-aligned bounds rectangle onto another. */
export function boundsTransform(from: Bounds, to: Bounds): Matrix {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy];
}

export function isIdentity(m: Matrix): boolean {
  return m.every((value, index) => value === IDENTITY[index]);
}
