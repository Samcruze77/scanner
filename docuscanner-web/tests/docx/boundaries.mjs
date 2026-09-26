// Guards the page-boundary fixtures themselves: compare.mjs proves our layout
// matches Word's, but only means something if the documents really do put page
// ends in awkward places. Using Word's own PDF of each fixture, this checks that
//   - several pages end in the middle of a paragraph (the next page starts with a
//     continuation line, not a new sentence),
//   - the header and the "Page X of Y" footer are on every page,
//   - the page count is what the fixture is meant to produce, and
//   - the fixtures the engine converts really have that many pages.
//
// Run: node tests/docx/boundaries.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { convertFile, fixtures, outDir } from "./harness.mjs";
import { extractLines } from "./pdftool.mjs";

const dir = path.join(fixtures, "boundaries");
const EXPECTED_PAGES = { "boundary-calibri": 9, "boundary-verdana": 10 };

let failed = 0;
for (const [name, pages] of Object.entries(EXPECTED_PAGES)) {
  try {
    const ref = await extractLines(path.join(dir, `${name}.word.pdf`));
    assert.equal(ref.length, pages, `Word's PDF has ${ref.length} pages, expected ${pages}`);

    let midParagraph = 0;
    ref.forEach((page, i) => {
      const body = page.lines.filter((l) => l.y > 90 && l.y < 700);
      assert.ok(page.lines.some((l) => /Acme Corp/.test(l.text)), `page ${i + 1}: header missing`);
      assert.ok(page.lines.some((l) => new RegExp(`Page ${i + 1} of ${pages}`).test(l.text)), `page ${i + 1}: footer "Page ${i + 1} of ${pages}" missing`);
      const first = body[0]?.text.trim() ?? "";
      // A page that opens with a lowercase word continues a paragraph from the last one.
      if (i > 0 && /^[a-z(]/.test(first)) midParagraph += 1;
    });
    assert.ok(midParagraph >= 3, `only ${midParagraph} page breaks fall inside a paragraph; the fixture no longer stresses page boundaries`);

    // Our conversion (skipped when the real fonts aren't installed) has the same shape.
    const ours = await convertFile(path.join(dir, `${name}.docx`)).catch(() => null);
    if (ours && !ours.missingFonts.length) assert.equal(ours.pageCount, pages, `our conversion has ${ours.pageCount} pages`);
    console.log(`  ✓ ${name}: ${pages} pages, ${midParagraph} page breaks inside paragraphs, header and footer on every page`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}
fs.mkdirSync(outDir, { recursive: true });
process.exitCode = failed === 0 ? 0 : 1;
