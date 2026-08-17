// What the Layers panel shows and what a keystroke in it means. The component
// itself cannot be rendered here (no jsdom, no browser), so every decision it
// makes lives in view.ts and is checked directly.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let view;

const group = (id, childIds = [], patch = {}) => ({
  id,
  name: id,
  type: "group",
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  childIds,
  ...patch,
});

const rect = (id, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  cornerRadius: 0,
  ...patch,
});

/** rootIds ["a","g"] with g = ["c","logo"] — g and its contents are front-most. */
const doc = {
  nodes: Object.fromEntries(
    [rect("a"), group("g", ["c", "logo"]), rect("c"), rect("logo")].map((n) => [
      n.id,
      n,
    ])
  ),
  rootIds: ["a", "g"],
  symbols: {},
};

const shown = (search, collapsed = []) =>
  view.layersView({
    doc,
    rootIds: doc.rootIds,
    search,
    collapsed: new Set(collapsed),
  });

const keys = (opts) =>
  view.listKeyAction({
    alt: false,
    shift: false,
    order: ["g", "logo", "c", "a"],
    at: null,
    filtering: false,
    collapsed: false,
    foldable: false,
    ...opts,
  });

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  view = await server.ssrLoadModule("/src/ui/panels/layers/view.ts");
});

after(async () => server.close());

// --- what the panel shows ------------------------------------------------

test("with no query the panel is the plain tree, folds and all", () => {
  const v = shown(null, ["g"]);
  assert.equal(v.query, "");
  assert.equal(v.filtering, false);
  assert.deepEqual(v.rows.map((r) => r.key), ["g", "a"]);
  assert.equal(v.hitCount, 0);
  assert.equal(v.firstHit, null);
  assert.equal(v.dndEnabled, true);
});

test("a filtered list ignores the folds hiding its hits", () => {
  // "logo" sits inside a container the user had folded shut, which is exactly
  // the case the search exists for.
  const v = shown("logo", ["g"]);
  assert.deepEqual(v.rows.map((r) => r.key), ["g", "logo"]);
  assert.equal(v.folds.size, 0);
});

test("row drag is off while the list is filtered", () => {
  assert.equal(shown("logo").dndEnabled, false);
  assert.equal(shown("").dndEnabled, true);
});

test("the first hit skips the containers shown only for context", () => {
  const v = shown("rect");
  assert.deepEqual(v.rows.map((r) => r.key), ["g", "logo", "c", "a"]);
  // "g" heads the rows but is a group: three rects are the hits.
  assert.equal(v.hitCount, 3);
  assert.equal(v.firstHit, "logo");
});

test("a blank or whitespace query is no filter at all", () => {
  for (const search of [null, "", "   "]) {
    const v = shown(search, ["g"]);
    assert.equal(v.filtering, false, `search ${JSON.stringify(search)}`);
    assert.deepEqual(v.rows.map((r) => r.key), ["g", "a"]);
  }
});

test("the fold menu reaches containers the filter has pruned away", () => {
  // A search that matches no container still leaves "g" foldable: folds belong
  // to the document view, not to the current query.
  assert.deepEqual(shown("logo").foldable, ["g"]);
  assert.deepEqual(shown(null).foldable, ["g"]);
});

// --- keys in the search field --------------------------------------------

test("Enter and Down go to the first hit", () => {
  assert.equal(view.searchKeyAction("Enter", "log"), "jump");
  assert.equal(view.searchKeyAction("ArrowDown", "log"), "jump");
});

test("Escape clears a query first and closes the field on a second press", () => {
  assert.equal(view.searchKeyAction("Escape", "log"), "clear");
  assert.equal(view.searchKeyAction("Escape", ""), "close");
});

test("the search field leaves every other key to the input", () => {
  assert.equal(view.searchKeyAction("a", "log"), null);
  assert.equal(view.searchKeyAction("ArrowUp", "log"), null);
});

// --- keys on the row list ------------------------------------------------

test("with no cursor the arrows enter the list from the far end", () => {
  assert.deepEqual(keys({ key: "ArrowDown" }), { type: "move", to: "g", extend: false });
  assert.deepEqual(keys({ key: "ArrowUp" }), { type: "move", to: "a", extend: false });
});

test("the cursor stops at both ends rather than wrapping", () => {
  assert.deepEqual(keys({ key: "ArrowUp", at: "g" }), { type: "move", to: "g", extend: false });
  assert.deepEqual(keys({ key: "ArrowDown", at: "a" }), { type: "move", to: "a", extend: false });
});

test("Shift makes the move extend the selection", () => {
  assert.deepEqual(keys({ key: "ArrowDown", at: "g", shift: true }), {
    type: "move",
    to: "logo",
    extend: true,
  });
});

test("an empty list has nowhere to move", () => {
  assert.equal(keys({ key: "ArrowDown", order: [] }), null);
});

test("Alt+Arrow reorders instead of moving, up toward the front", () => {
  assert.deepEqual(keys({ key: "ArrowUp", alt: true }), { type: "raise" });
  assert.deepEqual(keys({ key: "ArrowDown", alt: true }), { type: "lower" });
});

test("Left and Right fold the cursor's row only in the direction it can go", () => {
  const at = { at: "g", foldable: true };
  assert.deepEqual(keys({ key: "ArrowRight", ...at, collapsed: true }), { type: "fold", id: "g" });
  assert.equal(keys({ key: "ArrowRight", ...at, collapsed: false }), null);
  assert.deepEqual(keys({ key: "ArrowLeft", ...at, collapsed: false }), { type: "fold", id: "g" });
  assert.equal(keys({ key: "ArrowLeft", ...at, collapsed: true }), null);
});

test("a row with no children has no fold state to toggle", () => {
  assert.equal(keys({ key: "ArrowRight", at: "a", collapsed: true }), null);
});

test("the filtered list has no folds to walk", () => {
  assert.equal(
    keys({ key: "ArrowRight", at: "g", foldable: true, collapsed: true, filtering: true }),
    null
  );
});
