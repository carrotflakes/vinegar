import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let makeFrame;
let sceneContainerViolation;
let hasValidSceneContainers;
let acceptsScene;
let usePreferences;
let useToasts;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument, makeFrame } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ sceneContainerViolation, hasValidSceneContainers } =
    await server.ssrLoadModule("/src/model/sceneValidation.ts"));
  ({ acceptsScene } = await server.ssrLoadModule("/src/store/sceneGuard.ts"));
  ({ usePreferences } =
    await server.ssrLoadModule("/src/store/preferencesStore.ts"));
  ({ useToasts } = await server.ssrLoadModule("/src/store/toastStore.ts"));
});

after(async () => server.close());

beforeEach(() => {
  usePreferences.getState().resetPreferences();
  useToasts.setState({ toasts: [] });
});

const IDENTITY = [1, 0, 0, 1, 0, 0];

const rect = (id) => ({
  id,
  name: id,
  type: "rect",
  ...SHAPE_BASE,
  cornerRadius: 0,
  ...NODE_BASE,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  transform: [...IDENTITY],
});

const group = (id, childIds) => ({
  id,
  name: id,
  type: "group",
  ...NODE_BASE,
  transform: [...IDENTITY],
  childIds,
  clipsToMask: false,
});

const compound = (id, childIds) => ({
  id,
  name: id,
  type: "compoundPath",
  ...SHAPE_BASE,
  fillRule: "nonzero",
  ...NODE_BASE,
  transform: [...IDENTITY],
  childIds,
});

/** A document whose root holds exactly the given nodes. */
function docOf(...nodes) {
  const doc = createEmptyDocument();
  for (const node of nodes) doc.nodes[node.id] = node;
  doc.rootIds = nodes.map((n) => n.id);
  return doc;
}

test("a well-formed scene reports no violation", () => {
  const doc = docOf(group("g", ["r"]), rect("r"));
  doc.rootIds = ["g"];

  assert.equal(sceneContainerViolation(doc), null);
  assert.equal(hasValidSceneContainers(doc), true);
});

test("each broken container invariant is named", () => {
  const frame = makeFrame(0, 0, 100, 100);
  const nested = docOf(group("g", [frame.id]), frame);
  nested.rootIds = ["g"];
  assert.match(sceneContainerViolation(nested), /frame is nested/);

  const empty = docOf(compound("c", []));
  assert.match(sceneContainerViolation(empty), /compound path/);

  // A group has no outline of its own, so it can never be a compound member.
  const badChild = docOf(compound("c", ["g"]), group("g", []));
  badChild.rootIds = ["c"];
  assert.match(sceneContainerViolation(badChild), /compound path/);
});

test("a rejected document is silent unless developer mode is on", () => {
  const doc = docOf(compound("c", []));

  assert.equal(acceptsScene(doc, "Group selection"), false);
  assert.equal(useToasts.getState().toasts.length, 0);

  usePreferences.getState().setDeveloperMode(true);
  assert.equal(acceptsScene(doc, "Group selection"), false);
  const toasts = useToasts.getState().toasts;
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].kind, "error");
  assert.match(toasts[0].message, /Group selection/);
  assert.match(toasts[0].message, /compound path/);
});

test("a caller with its own message suppresses the guard's toast", () => {
  const doc = docOf(compound("c", []));

  usePreferences.getState().setDeveloperMode(true);
  assert.equal(acceptsScene(doc, "Move layer", { toast: false }), false);
  assert.equal(useToasts.getState().toasts.length, 0);
});

test("an accepted document never notifies, developer mode or not", () => {
  const doc = docOf(rect("r"));

  usePreferences.getState().setDeveloperMode(true);
  assert.equal(acceptsScene(doc, "Edit shape"), true);
  assert.equal(useToasts.getState().toasts.length, 0);
});
