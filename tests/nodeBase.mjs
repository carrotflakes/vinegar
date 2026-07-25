// The shared fields every scene node / shape must carry. Spread these first in
// a fixture literal, then override what the fixture is actually about.
//
// Deliberately literals rather than imports of baseNodeDefaults()/
// baseShapeDefaults(): a test fixture should state the expected shape of a node
// independently of the code under test, so a wrong default in src fails a test
// instead of following it.
export const NODE_BASE = {
  transformOrigin: null,
  opacity: 1,
  blendMode: "normal",
  effects: [],
  hidden: false,
  locked: false,
  generator: null,
};

/** Paint/stroke fields shared by every leaf shape and compound path. */
export const SHAPE_BASE = {
  fill: null,
  stroke: null,
  strokeWidth: 0,
  strokeDash: [],
  strokeDashOffset: 0,
  strokeCap: "round",
  strokeJoin: "round",
  strokeAlignment: "center",
};
