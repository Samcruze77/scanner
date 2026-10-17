// Unit checks for the optional code-format clean-up of OCR text (utils/ocr/identifiers.ts): it must fix only
// look-alike characters in words that fit the stated format, and never touch ordinary text.
//   node --no-warnings tests/ocr/identifiers.mjs
import assert from "node:assert/strict";
import { applyCodeFormat, isValidCodeFormat } from "../../utils/ocr/identifiers.ts";

let pass = 0;
const test = (name, fn) => {
  fn();
  pass++;
  console.log("  ok  " + name);
};

test("a look-alike letter at a digit position is fixed, and a code that is right is left alone", () => {
  const r = applyCodeFormat("SCAN-LO1 The quick brown fox\nSCAN-L02 Pack my box\nSCAN-LO7", "AAAA-A99");
  assert.equal(r.text, "SCAN-L01 The quick brown fox\nSCAN-L02 Pack my box\nSCAN-L07");
  assert.equal(r.matched, 3);
  assert.equal(r.changed, 2);
});
test("a digit at a letter position becomes the look-alike letter", () => {
  assert.equal(applyCodeFormat("B00K-12 and 1D-77", "AAAA-99").text, "BOOK-12 and 1D-77");
  assert.equal(applyCodeFormat("1D-77", "AA-99").text, "ID-77");
});
test("ordinary text is never changed, whatever the format", () => {
  const text = "BOOK COOL ROOM. Room 101 Floor 20, PO-0O-2O26 and the quick brown fox 1l1I O0O0.";
  assert.equal(applyCodeFormat(text, "AAAA-A99").text, text);
  assert.equal(applyCodeFormat(text, "999").text, text.replace(/\b(101)\b/, "$1"));
});
test("a word that does not fit (length, literal, impossible character) is left untouched", () => {
  assert.equal(applyCodeFormat("SCAN-LO03 SCAN_LO1 SCAN-LXY", "AAAA-A99").text, "SCAN-LO03 SCAN_LO1 SCAN-LXY");
  assert.equal(applyCodeFormat("SCAN-LO1", "AAAA-A99").text, "SCAN-L01");
});
test("punctuation after a code stays where it is", () => {
  assert.equal(applyCodeFormat("See SCAN-LO1, then SCAN-LO2.", "AAAA-A99").text, "See SCAN-L01, then SCAN-L02.");
});
test("a format must be sensible before it is used", () => {
  for (const bad of ["", "AA", "----", "A A9", "x".repeat(41)]) assert.equal(isValidCodeFormat(bad), false, JSON.stringify(bad));
  assert.equal(isValidCodeFormat("AAAA-A99"), true);
  const text = "SCAN-LO1";
  assert.equal(applyCodeFormat(text, "").text, text);
});
test("it only changes characters, never the layout", () => {
  const text = "a  b\n\nSCAN-LO1\t x";
  const out = applyCodeFormat(text, "AAAA-A99").text;
  assert.equal(out.length, text.length);
  assert.equal(out.replace(/\S/g, "x"), text.replace(/\S/g, "x"));
});
console.log(`\n${pass} checks passed`);
