// The shared BaseNode fields every scene node must carry. Spread this first in
// a fixture literal, then override what the fixture is actually about.
//
// Deliberately a literal rather than an import of `baseNodeDefaults()`: a test
// fixture should state the expected shape of a node independently of the code
// under test, so a wrong default in src fails a test instead of following it.
export const NODE_BASE = {
  transformOrigin: null,
  opacity: 1,
  blendMode: "normal",
  effects: [],
  hidden: false,
  locked: false,
  generator: null,
};
