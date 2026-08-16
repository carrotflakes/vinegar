import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let applyKey;
let nudge;
let numberPadCommit;
let numberPadKeyFor;
let numberPadState;
let numberPadValue;

/** Type a sequence of keys into a pad opened on `value`. */
const type = (value, keys) =>
  keys.reduce((state, key) => applyKey(state, key), numberPadState(value));

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({
    applyKey,
    nudge,
    numberPadCommit,
    numberPadKeyFor,
    numberPadState,
    numberPadValue,
  } = await server.ssrLoadModule("/src/ui/controls/numberPad.ts"));
});

after(async () => server.close());

test("the pad opens on the current value and the first digit replaces it", () => {
  assert.deepEqual(numberPadState(42), { text: "42", pristine: true });
  assert.equal(type(42, ["7"]).text, "7");
  assert.equal(type(42, ["7", "5"]).text, "75");
});

test("backspace edits the incoming value instead of replacing it", () => {
  assert.equal(type(42, ["backspace"]).text, "4");
  assert.equal(type(42, ["backspace", "9"]).text, "49");
  assert.equal(type(4, ["backspace"]).text, "");
  // A lone minus is not worth keeping around.
  assert.equal(type(-4, ["backspace", "backspace"]).text, "");
});

test("a leading zero is a placeholder, not a digit", () => {
  assert.equal(type(0, ["backspace", "5"]).text, "5");
  assert.equal(type(0, ["sign", "5"]).text, "-5");
});

test("the decimal point never doubles and never leads", () => {
  assert.equal(type(0, ["clear", "."]).text, "0.");
  assert.equal(type(0, ["clear", ".", "5"]).text, "0.5");
  assert.equal(type(0, ["clear", "1", ".", ".", "5"]).text, "1.5");
  assert.equal(type(0, ["clear", "sign", "."]).text, "-0.");
});

test("the sign key toggles", () => {
  assert.equal(type(12, ["sign"]).text, "-12");
  assert.equal(type(12, ["sign", "sign"]).text, "12");
});

test("an incomplete entry has no value and cannot be committed", () => {
  for (const keys of [["clear"], ["clear", "sign"]]) {
    assert.equal(numberPadValue(type(5, keys)), null);
    assert.equal(numberPadCommit(type(5, keys), {}), null);
  }
  // A trailing point is still a number: 3. is 3.
  assert.equal(numberPadValue(type(0, ["clear", "3", "."])), 3);
});

test("committing clamps to the field's range", () => {
  assert.equal(numberPadCommit(type(0, ["5", "0", "0"]), { max: 100 }), 100);
  assert.equal(numberPadCommit(type(0, ["sign", "9"]), { min: 0 }), 0);
  assert.equal(numberPadCommit(type(0, ["4", "2"]), { min: 0, max: 100 }), 42);
});

test("the step keys move off the current entry and stay in range", () => {
  assert.equal(nudge(numberPadState(10), 1, {}).text, "11");
  assert.equal(nudge(numberPadState(10), -1, {}).text, "9");
  assert.equal(nudge(numberPadState(0), -1, { min: 0 }).text, "0");
  // Fractional steps commit clean values rather than 0.30000000000000004.
  assert.equal(nudge(numberPadState(0.2), 0.1, {}).text, "0.3");
  // Stepping an empty entry starts from the bottom of the range.
  assert.equal(nudge(type(5, ["clear"]), 1, { min: 4 }).text, "5");
  // Stepping is an edit, like backspace: typing after it appends.
  assert.equal(applyKey(nudge(numberPadState(10), 1, {}), "7").text, "117");
});

test("hardware keys map onto pad keys", () => {
  assert.equal(numberPadKeyFor("7"), "7");
  assert.equal(numberPadKeyFor(","), ".");
  assert.equal(numberPadKeyFor("-"), "sign");
  assert.equal(numberPadKeyFor("Backspace"), "backspace");
  assert.equal(numberPadKeyFor("Delete"), "clear");
  assert.equal(numberPadKeyFor("a"), null);
  assert.equal(numberPadKeyFor("Enter"), null);
});
