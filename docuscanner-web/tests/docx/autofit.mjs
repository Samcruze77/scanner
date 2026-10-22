// Regression test for Word's table auto-fit (utils/convert/docx/flow.ts autofitColumns).
//
// A table whose cells declare no width is sized by Word from its content, not from the placeholder grid. The fixture
// (autofit-fixture.mjs) is a set of such tables: content that fits (stated width, percentage width, content-sized),
// content that overflows (one long column, several, an unbreakable word), merged cells, borders and several rows. Each is
// converted by the real engine and compared, line by line, with Microsoft Word's own PDF of the same file
// (fixtures/autofit/autofit.word.pdf, exported from Word).
//
//   node --no-warnings tests/docx/autofit.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertFile, outDir } from "./harness.mjs";
import { extractLines } from "./pdftool.mjs";
import { writeAutofitFixture } from "./autofit-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(outDir, { recursive: true });
const docx = path.join(outDir, "autofit.docx");
await writeAutofitFixture(docx);
const result = await convertFile(docx);
const ours = path.join(outDir, "autofit.pdf");
fs.writeFileSync(ours, result.bytes);

const mine = await extractLines(ours);
const word = await extractLines(path.join(here, "fixtures", "autofit", "autofit.word.pdf"));

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL " + name + "\n       " + String(e.message).split("\n").slice(0, 6).join("\n       "));
  }
};

check("same number of pages", () => assert.equal(mine.length, word.length));

// Table by table: the label paragraph before each table names it, so a failure says which rule broke.
const labelled = (pages) => {
  const out = new Map();
  let current = "(start)";
  for (const p of pages) {
    for (const l of p.lines) {
      const m = /^([A-Z]\d?_[A-Za-z0-9_]+)$/.exec(l.text);
      if (m) {
        current = m[1];
        out.set(current, []);
      } else out.get(current)?.push({ ...l, page: p.number });
    }
  }
  return out;
};
const a = labelled(mine);
const b = labelled(word);
for (const [name, wordLines] of b) {
  check(`${name}: text, wrapping and column positions match Word (within 1 pt)`, () => {
    const ourLines = a.get(name) ?? [];
    assert.equal(ourLines.length, wordLines.length, `${ourLines.length} lines, Word has ${wordLines.length}`);
    ourLines.forEach((l, i) => {
      const w = wordLines[i];
      // Spaces between cells are not compared: PDF text extraction joins touching cells with or without one.
      assert.equal(l.text.replace(/\s+/g, ""), w.text.replace(/\s+/g, ""), `line ${i} text`);
      assert.ok(Math.abs(l.right - w.right) <= 1.5, `line ${i} "${w.text.slice(0, 24)}": right edge ${l.right.toFixed(1)} vs Word ${w.right.toFixed(1)}`);
      assert.ok(Math.abs(l.x - w.x) <= 1, `line ${i} "${w.text.slice(0, 24)}": x ${l.x.toFixed(1)} vs Word ${w.x.toFixed(1)}`);
      assert.ok(Math.abs(l.y - w.y) <= 1.5, `line ${i} "${w.text.slice(0, 24)}": y ${l.y.toFixed(1)} vs Word ${w.y.toFixed(1)}`);
    });
  });
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll auto-fit checks passed");
process.exit(failed ? 1 : 0);
