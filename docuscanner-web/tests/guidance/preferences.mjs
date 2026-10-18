// Unit checks for the one-time "show me tips" preference and the dismissed-tip memory.
//   node --no-warnings tests/guidance/preferences.mjs
import assert from "node:assert/strict";
import {
  dismissTipId,
  EMPTY_GUIDANCE,
  GUIDANCE_KEY,
  MAX_ASKS,
  noteAsked,
  parseGuidance,
  readGuidanceRaw,
  resetTips,
  setTipsChoice,
  shouldAskTips,
  shouldShowTip,
} from "../../utils/guidance/preferences.ts";

let pass = 0;
const test = (name, fn) => {
  fn();
  pass++;
  console.log("  ok  " + name);
};
const fakeStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map };
};

test("a first-time visitor is asked once and tips are not blocked", () => {
  const s = fakeStorage();
  const state = parseGuidance(readGuidanceRaw(s));
  assert.deepEqual(state, EMPTY_GUIDANCE);
  assert.equal(shouldAskTips(state), true);
  assert.equal(shouldShowTip(state, "editor-pan-tip"), true);
});
test("Yes turns tips on and the question is not asked again", () => {
  const s = fakeStorage();
  const state = setTipsChoice(s, "on");
  assert.equal(state.tips, "on");
  assert.equal(shouldAskTips(parseGuidance(readGuidanceRaw(s))), false);
  assert.equal(shouldShowTip(state, "workflow-edit"), true);
});
test("No thanks is final: no tips, no more questions", () => {
  const s = fakeStorage();
  const state = setTipsChoice(s, "off");
  assert.equal(shouldAskTips(parseGuidance(readGuidanceRaw(s))), false);
  assert.equal(shouldShowTip(state, "workflow-edit"), false);
  assert.equal(shouldShowTip(state, "editor-pan-tip"), false);
});
test("a dismissed tip stays dismissed; others are unaffected", () => {
  const s = fakeStorage();
  setTipsChoice(s, "on");
  const state = dismissTipId(s, "editor-pan-tip");
  assert.equal(shouldShowTip(state, "editor-pan-tip"), false);
  assert.equal(shouldShowTip(state, "editor-next-step"), true);
  assert.equal(dismissTipId(s, "editor-pan-tip").dismissed.length, 1, "no duplicates");
  const reread = parseGuidance(readGuidanceRaw(s));
  assert.equal(shouldShowTip(reread, "editor-pan-tip"), false);
});
test("turning tips on again forgets what was dismissed", () => {
  const s = fakeStorage();
  setTipsChoice(s, "on");
  dismissTipId(s, "workflow-edit");
  setTipsChoice(s, "off");
  const state = resetTips(s);
  assert.equal(state.tips, "on");
  assert.equal(shouldShowTip(state, "workflow-edit"), true);
});
test("an ignored question is asked again later, but only a few times; tips stay available", () => {
  const s = fakeStorage();
  for (let i = 0; i < MAX_ASKS - 1; i++) assert.equal(shouldAskTips(noteAsked(s)), true, "still asked after " + (i + 1) + " ignored visits");
  const state = noteAsked(s);
  assert.equal(shouldAskTips(state), false, "stops asking after " + MAX_ASKS + " ignored visits");
  assert.equal(shouldShowTip(state, "editor-pan-tip"), true, "ignoring the question is not a 'no': the essential tips still show");
  assert.equal(resetTips(s).asked, MAX_ASKS, "turning tips on keeps the count (it is only a count)");
});
test("damaged or blocked storage never breaks the page", () => {
  assert.deepEqual(parseGuidance("{not json"), EMPTY_GUIDANCE);
  assert.deepEqual(parseGuidance('{"tips":"maybe","dismissed":[1,"a",null]}'), { tips: "unset", dismissed: ["a"], asked: 0 });
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readGuidanceRaw(blocked), null);
  assert.equal(setTipsChoice(blocked, "off").tips, "off");
  assert.equal(readGuidanceRaw(null), null);
  assert.equal(setTipsChoice(null, "on").tips, "on");
});
test("only this preference is stored, under one key, with no identifiers", () => {
  const s = fakeStorage();
  setTipsChoice(s, "on");
  dismissTipId(s, "x");
  assert.deepEqual([...s.map.keys()], [GUIDANCE_KEY]);
  assert.deepEqual(Object.keys(JSON.parse(s.map.get(GUIDANCE_KEY))).sort(), ["asked", "dismissed", "tips"]);
});
console.log(`\n${pass} checks passed`);
