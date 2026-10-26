// The page-layout rules, as pure arithmetic (no browser): where a page ends, how a paragraph is split between lines, and the constants
// the editor's CSS uses to make the browser lay text out the way Word does, checked against the font files they come from.
//   node --no-warnings --import ./tests/scanner/register.mjs tests/wordCreator/layout-rules.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { layoutPages, MIN_LINES, PITCH } from "../../utils/wordCreator/layout.ts";
import { DEFAULT_MARGINS, pageViewGeometry, sizeFix } from "../../utils/wordCreator/model.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL " + name + "\n       " + String(e?.stack ?? e).split("\n").slice(0, 8).join("\n       "));
  }
}

const g = pageViewGeometry(DEFAULT_MARGINS);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${msg ?? ""} ${a} vs ${b}`);
const LINE = 20;
// A paragraph of n lines that starts at `top`, with its line edges
const para = (top, n, extra = {}) => ({ top, bottom: top + n * LINE, lines: () => Array.from({ length: n + 1 }, (_, i) => top + i * LINE), ...extra });
// A block of one line, or any block that cannot be split
const box = (top, height, extra = {}) => ({ top, bottom: top + height, ...extra });
const breaksOf = (r) => r.breaks.map((b) => [b.block, b.line]);

console.log("Splitting a paragraph between pages");
await check("the text area is exactly 930.53 px tall, and a paragraph that crosses the end is split between two of its lines", () => {
  near(g.contentH, 930.5333);
  // 10 lines starting 70 px above the end of the text area: 3 whole lines fit (860, 880, 900 -> 920), the rest go on
  const r = layoutPages([box(0, 860), para(860, 10)]);
  assert.deepEqual(breaksOf(r), [[1, 3]]);
  near(r.breaks[0].height, PITCH - (860 + 3 * LINE), "the gap runs from the end of line 3 to the next page's text");
  assert.equal(r.pages, 2);
});
await check("orphan control: one line is never left alone at the bottom of a page, the whole paragraph moves", () => {
  // 1 line fits (900..920); two would be needed
  const r = layoutPages([box(0, 900), para(900, 10)]);
  assert.deepEqual(breaksOf(r), [[1, 0]]);
  near(r.breaks[0].height, PITCH - 900);
});
await check("widow control: one line is never carried alone to the next page, two go over with it", () => {
  // 9 of 10 lines would fit (750 + 9 * 20 = 930), but only 8 stay so that 2 are carried over
  const r = layoutPages([box(0, 750), para(750, 10)]);
  assert.deepEqual(breaksOf(r), [[1, 8]]);
});
await check("a paragraph of three lines cannot be split (2 and 1 would break the rule), one of four splits two and two", () => {
  assert.deepEqual(breaksOf(layoutPages([box(0, 880), para(880, 3)])), [[1, 0]]);
  assert.deepEqual(breaksOf(layoutPages([box(0, 870), para(870, 4)])), [[1, 2]]);
  assert.equal(MIN_LINES, 2);
});
await check("blocks that keep their lines together (headings, the title) and pictures are never split", () => {
  assert.deepEqual(breaksOf(layoutPages([box(0, 860), para(860, 10, { keepLines: true })])), [[1, 0]]);
  assert.deepEqual(breaksOf(layoutPages([box(0, 860), box(860, 300)])), [[1, 0]]);
});
await check("a paragraph longer than a whole page is split again on the pages after, with two lines left at the end", () => {
  const r = layoutPages([para(0, 100)]); // 2000 px: three pages
  assert.equal(r.pages, 3);
  assert.deepEqual(r.breaks.map((b) => b.block), [0, 0]);
  const first = Math.floor(g.contentH / LINE);
  assert.equal(r.breaks[0].line, first);
  assert.equal(r.breaks[1].line, first + Math.floor(g.contentH / LINE));
  // a very short tail is topped up so it is never a single line
  const tail = layoutPages([para(0, Math.floor(g.contentH / LINE) + 1)]);
  assert.equal(tail.breaks[0].line, Math.floor(g.contentH / LINE) - 1);
});
await check("line spacing above single hangs below the text: the extra space may run into the bottom margin", () => {
  // one line of 20 px, a third of it (1.5 spacing) extra: its text ends at 928.3 although the box ends at 935
  assert.deepEqual(layoutPages([box(0, 915), box(915, 20, { hang: 1 / 3 })]).breaks, []);
  assert.deepEqual(breaksOf(layoutPages([box(0, 915), box(915, 20)])), [[1, 0]], "without the extra it does not fit");
  // and a line is counted as fitting by its text
  const r = layoutPages([box(0, 700), para(700, 14, { hang: 1 / 3 })]);
  // lines end at 720, 740 ... 920, 940: with a third of each line hanging the line ending at 940 (text ends 933.3) still does not fit, 920 does
  assert.deepEqual(breaksOf(r), [[1, 11]]);
});

console.log("Headings stay with the text after them");
await check("a heading that would end up alone at the bottom of a page moves with the paragraph that follows it", () => {
  const blocks = [box(0, 860), box(860, 22, { keepNext: true, keepLines: true }), para(882, 10)];
  // the first two lines of the paragraph (882..922) fit: the heading stays
  assert.deepEqual(breaksOf(layoutPages(blocks)).filter((b) => b[1] === 0), []);
  // 900: heading 900..922, the paragraph's first two lines would end at 962: the heading goes to the next page with the paragraph
  const moved = layoutPages([box(0, 900), box(900, 22, { keepNext: true, keepLines: true }), para(922, 10)]);
  assert.deepEqual(breaksOf(moved), [[1, 0]]);
  assert.equal(moved.pages, 2);
});
await check("a run of headings stays together with the text after the last one", () => {
  const r = layoutPages([box(0, 880), box(880, 22, { keepNext: true, keepLines: true }), box(902, 22, { keepNext: true, keepLines: true }), para(924, 10)]);
  assert.deepEqual(breaksOf(r), [[1, 0]], "both headings move, together");
});
await check("a heading already at the top of a page stays there", () => {
  const r = layoutPages([box(0, 22, { keepNext: true, keepLines: true }), para(22, 6)]);
  assert.deepEqual(r.breaks, []);
});

console.log("Space before and after, and page breaks");
await check("the space before a block is not used at the top of a page that a break started, but the space between blocks is the larger of the two", () => {
  // block 0 has 8 px after it, block 1 has 12 before: they collapse to 12 (that is how the positions were measured: 900 -> 912)
  const r = layoutPages([box(0, 900, { marginBottom: 8 }), box(912, 28, { marginTop: 12 })]);
  assert.deepEqual(breaksOf(r), [[1, 0]]);
  // the gap is the distance moved less what overlapped (min(8, 12)); the block's own box then sits exactly at the top of the next page
  near(r.breaks[0].height, PITCH - 912 - 8);
});
await check("a page break takes no room: it ends its page even when the page is full, and two in a row leave a blank page", () => {
  assert.equal(layoutPages([box(0, 930), box(930, 22, { breakAfter: true }), box(952, 30)]).pages, 2);
  assert.equal(layoutPages([box(0, 40), box(40, 22, { breakAfter: true }), box(62, 22, { breakAfter: true }), box(84, 30)]).pages, 3);
  assert.equal(layoutPages([box(0, 40), box(40, 22, { breakAfter: true })]).pages, 2, "a break at the end opens a page to carry on typing");
});
await check("the same blocks on a wider text area need fewer pages (the geometry, not the screen, decides)", () => {
  const blocks = [];
  for (let i = 0; i < 60; i++) blocks.push(box(i * 50, 50));
  const normal = layoutPages(blocks, pageViewGeometry(DEFAULT_MARGINS));
  const narrow = layoutPages(blocks, pageViewGeometry({ top: 720, right: 720, bottom: 720, left: 720 }));
  assert.ok(narrow.pages < normal.pages);
  assert.deepEqual(layoutPages(blocks, pageViewGeometry(DEFAULT_MARGINS)), normal, "deterministic");
});

console.log("What makes the browser lay out like Word");
const css = (f) => fs.readFileSync(path.join(root, "components", "wordCreator", f), "utf8");
await check("font sizes: the sizes Chrome would cut short are asked for at the nearest hundredth of a pixel with the rest taken out of the letter spacing", () => {
  const fix = sizeFix(11);
  near(fix.fontSizePx, 14.67, "11pt");
  assert.ok(fix.askPx > fix.fontSizePx && fix.askPx - fix.fontSizePx < 0.001, "asks a hair above so the cut lands on the hundredth");
  assert.ok(fix.letterSpacingPx < 0, "14.67 is wider than 14.6667, so the letters are tightened");
  assert.ok(sizeFix(16).letterSpacingPx > 0, "21.33 is narrower than 21.3333");
  for (const whole of [9, 12, 18, 24, 36, 48, 72]) assert.equal(sizeFix(whole), null, `${whole}pt is a whole number of pixels`);
  // the correction is always under a thousandth of a pixel per letter: it only removes the rounding
  for (let half = 12; half <= 200; half++) {
    const f = sizeFix(half / 2);
    if (f) assert.ok(Math.abs(f.letterSpacingPx) < 0.003, `${half / 2}pt`);
  }
});
await check("word-sizes.css is exactly what sizeFix says for every size (regenerate with tests/wordCreator/gen-sizes.mjs)", () => {
  const text = css("word-sizes.css");
  let rules = 0;
  for (const m of text.matchAll(/\[style\*="font-size: ([\d.]+)pt"\] \{\s*font-size: ([\d.]+)px !important;\s*letter-spacing: (-?[\d.]+)px !important;/g)) {
    const fix = sizeFix(Number(m[1]));
    assert.ok(fix, m[1]);
    assert.equal(Number(m[2]), fix.askPx, `${m[1]}pt size`);
    assert.equal(Number(m[3]), fix.letterSpacingPx, `${m[1]}pt spacing`);
    rules++;
  }
  let expected = 0;
  for (let half = 12; half <= 200; half++) if (sizeFix(half / 2)) expected++;
  assert.equal(rules, expected);
  const base = /\.wc-page\.ProseMirror \{\s*font-size: ([\d.]+)px;\s*letter-spacing: (-?[\d.]+)px;/.exec(text);
  assert.equal(Number(base[1]), sizeFix(11).askPx);
});
await check("word-fonts.css: Calibri, Arial and Times New Roman use the real font when the device has it, otherwise the bundled metric twin", () => {
  const text = css("word-fonts.css");
  const faces = [...text.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(faces.length, 48, "3 families x regular, bold, italic, bold italic x 4 scripts");
  for (const face of faces) {
    const family = /font-family: "([^"]+)"/.exec(face)[1];
    assert.ok(["Calibri", "Arial", "Times New Roman"].includes(family));
    assert.match(face, /src: local\("[^"]+"\)(, local\("[^"]+"\))*, url\(\/fonts\/docx\/(carlito|arimo|tinos)-[a-z-]+-(400|700)-(normal|italic)\.woff\) format\("woff"\)/);
    assert.match(face, /unicode-range: U\+/);
    const twin = /\/fonts\/docx\/([a-z0-9-]+\.woff)/.exec(face)[1];
    const pkg = twin.split("-")[0];
    assert.ok(fs.existsSync(path.join(root, "node_modules", "@fontsource", pkg, "files", twin)), `${twin} is shipped by @fontsource/${pkg}`);
  }
});
await check("the line-height factors in the CSS are the fonts' own (hhea ascent + descent + line gap) and the twins have the same ones as the originals", () => {
  const fontkit = require("@pdf-lib/fontkit");
  const factor = (file) => {
    const f = fontkit.create(fs.readFileSync(file));
    return (f.ascent + Math.abs(f.descent) + f.lineGap) / f.unitsPerEm;
  };
  const twin = (name) => path.join(root, "public", "fonts", "docx", `${name}-latin-400-normal.woff`);
  const sheet = css("word-creator.css");
  const declared = (font) => Number(new RegExp(`\\[style\\*="${font}"\\] \\{\\s*--wc-lhf: ([\\d.]+);`).exec(sheet)[1]);
  const have = (f) => fs.existsSync(f);
  if (have(twin("carlito"))) {
    near(factor(twin("carlito")), declared("Calibri"));
    near(factor(twin("arimo")), declared("Arial"));
    near(factor(twin("tinos")), declared("Times New Roman"));
  }
  // Georgia and Verdana have no open twin: their numbers are checked against the fonts where this machine has them
  for (const [font, file] of [["Georgia", "georgia.ttf"], ["Verdana", "verdana.ttf"], ["Calibri", "calibri.ttf"], ["Arial", "arial.ttf"], ["Times New Roman", "times.ttf"]]) {
    const p = path.join("C:/Windows/Fonts", file);
    if (have(p)) near(factor(p), declared(font), font);
  }
  assert.match(sheet, /--wc-lhf: 1\.2207/); // the default (Calibri)
});
await check("the justified-text squeeze uses each font's own space width", () => {
  const fontkit = require("@pdf-lib/fontkit");
  const space = (file) => {
    const f = fontkit.create(fs.readFileSync(file));
    return f.glyphForCodePoint(32).advanceWidth / f.unitsPerEm;
  };
  const sheet = css("word-creator.css");
  const declared = (font) => Number(new RegExp(`\\[style\\*="justify"\\]\\[style\\*="${font}"\\]\\s*\\{\\s*word-spacing: calc\\(-0\\.22 \\* ([\\d.]+)em\\)`).exec(sheet)?.[1]);
  const twin = (name) => path.join(root, "public", "fonts", "docx", `${name}-latin-400-normal.woff`);
  if (fs.existsSync(twin("carlito"))) {
    near(space(twin("carlito")), declared("Calibri") , "Calibri");
    near(space(twin("arimo")), declared("Arial"), "Arial");
    near(space(twin("tinos")), declared("Times New Roman"), "Times New Roman");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
