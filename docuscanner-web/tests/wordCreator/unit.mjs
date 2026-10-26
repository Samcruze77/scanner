// Unit tests for the Word document creator: helpers, page layout maths, and -- above all -- the .docx
// writer, checked by unzipping and parsing the real file it produces.
//   node --no-warnings --import ./tests/scanner/register.mjs tests/wordCreator/unit.mjs
import assert from "node:assert/strict";
import { exportDocx, ExportError } from "../../utils/wordCreator/docxExport.ts";
import { sniffImage, bytesFromDataUrl } from "../../utils/wordCreator/imageData.ts";
import { layoutPages, PITCH } from "../../utils/wordCreator/layout.ts";
import {
  CONTENT_HEIGHT_PX,
  DEFAULT_MARGINS,
  MARGIN_PRESETS,
  EMPTY_DOC,
  inchesToTwips,
  marginPreset,
  pageViewGeometry,
  sanitizeMargins,
  twipsToInches,
  validateMargins,
  colorToHex,
  countWords,
  isDocumentEmpty,
  normalizeLinkInput,
  primaryFont,
  safeLinkHref,
  sanitizeFileName,
  sizeToPt,
} from "../../utils/wordCreator/model.ts";
import { readDocx, sha } from "./docx-read.mjs";
import { expectedParagraphs, makePicture, p, SPECIAL, syntheticDocument, text, UNICODE } from "./fixtures.mjs";

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL " + name + "\n       " + String(e?.message ?? e).split("\n").slice(0, 8).join("\n       "));
  }
}

// ---- file names ---------------------------------------------------------------------------------------------------
await check("file names: plain title gets .docx", () => assert.equal(sanitizeFileName("My Report"), "My Report.docx"));
await check("file names: forbidden characters are removed", () => assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j.docx"));
await check("file names: control characters and zero-width characters are removed", () => assert.equal(sanitizeFileName("a\u0000b\u200bc\n d"), "a bc d.docx"));
await check("file names: empty / blank / dots fall back to Untitled Document", () => {
  for (const t of ["", "   ", "...", " . ", "///"]) assert.equal(sanitizeFileName(t), "Untitled Document.docx", JSON.stringify(t));
});
await check("file names: Windows reserved names are not used as they are", () => {
  assert.equal(sanitizeFileName("CON"), "CON document.docx");
  assert.equal(sanitizeFileName("nul"), "nul document.docx");
  assert.equal(sanitizeFileName("com1"), "com1 document.docx");
});
await check("file names: unicode kept, trailing dots/spaces trimmed, length capped", () => {
  assert.equal(sanitizeFileName("Caf\u00e9 \u65e5\u672c\u8a9e. "), "Caf\u00e9 \u65e5\u672c\u8a9e.docx");
  const long = sanitizeFileName("x".repeat(500));
  assert.ok(long.length <= 125 && long.endsWith(".docx"), long.length);
  assert.ok(!sanitizeFileName("../../etc/passwd").includes("/"));
});

// ---- links / colours / sizes ----------------------------------------------------------------------------------------
await check("links: only web, mail and phone addresses are safe", () => {
  assert.equal(safeLinkHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeLinkHref("mailto:a@b.co"), "mailto:a@b.co");
  assert.equal(safeLinkHref("tel:+441234"), "tel:+441234");
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///c:/x", "//evil.com", "/relative", "", null, 5]) {
    assert.equal(safeLinkHref(bad), null, String(bad));
  }
});
await check("links: typed addresses get a scheme; scripts stay rejected", () => {
  assert.equal(normalizeLinkInput("example.com"), "https://example.com");
  assert.equal(normalizeLinkInput("me@example.com"), "mailto:me@example.com");
  assert.equal(normalizeLinkInput("javascript:alert(1)"), null);
  assert.equal(normalizeLinkInput("   "), null);
});
await check("colours, sizes and fonts are normalised or rejected", () => {
  assert.equal(colorToHex("#ff0000"), "FF0000");
  assert.equal(colorToHex("#f00"), "FF0000");
  assert.equal(colorToHex("rgb(1, 2, 255)"), "0102FF");
  assert.equal(colorToHex("red"), null);
  assert.equal(colorToHex("url(javascript:1)"), null);
  assert.equal(sizeToPt("14pt"), 14);
  assert.equal(sizeToPt("16px"), 12);
  assert.equal(sizeToPt("abc"), null);
  assert.equal(sizeToPt("9999pt"), null);
  assert.equal(primaryFont('"Times New Roman", serif'), "Times New Roman");
  assert.equal(primaryFont("Arial, sans-serif"), "Arial");
  assert.equal(primaryFont("a;b{c}"), null);
});
await check("empty-document detection and word count", () => {
  assert.ok(isDocumentEmpty(EMPTY_DOC));
  assert.ok(!isDocumentEmpty({ type: "doc", content: [p("x")] }));
  assert.ok(!isDocumentEmpty({ type: "doc", content: [{ type: "horizontalRule" }] }));
  assert.ok(!isDocumentEmpty({ type: "doc", content: [{ type: "pageBreak" }, p()] }), "a page break is content");
  assert.equal(countWords({ type: "doc", content: [p("one two  three"), p("four")] }), 4);
});

// ---- page layout ---------------------------------------------------------------------------------------------------------
await check("layout: a short document is one page with no gaps", () => {
  const r = layoutPages([{ top: 0, bottom: 100 }, { top: 100, bottom: 200 }]);
  assert.deepEqual(r, { breaks: [], pages: 1 });
  assert.equal(layoutPages([]).pages, 1);
});
await check("layout: a block that would straddle the page end moves whole to the next page", () => {
  // Three 400px blocks: the third would span 800-1200, past the 931px page.
  const r = layoutPages([{ top: 0, bottom: 400 }, { top: 400, bottom: 800 }, { top: 800, bottom: 1200 }]);
  assert.equal(r.pages, 2);
  assert.equal(r.breaks.length, 1);
  assert.deepEqual([r.breaks[0].block, r.breaks[0].line], [2, 0]);
  assert.ok(Math.abs(r.breaks[0].height - (PITCH - 800)) < 0.01); // from where it began to the next page's top (heights are kept to 0.01 px)
});
await check("layout: pages keep counting across a long document (every page has the same pitch)", () => {
  const blocks = Array.from({ length: 200 }, (_, i) => ({ top: i * 50, bottom: i * 50 + 50 }));
  const r = layoutPages(blocks);
  const perPage = Math.floor(CONTENT_HEIGHT_PX / 50);
  assert.equal(r.pages, Math.ceil(200 / perPage));
  assert.equal(r.breaks.length, r.pages - 1);
});
await check("layout: a block taller than a page is left to cross it, and one that begins in the gap is moved to the next page", () => {
  const r = layoutPages([{ top: 0, bottom: 2000 }, { top: 2000, bottom: 2050 }]);
  assert.deepEqual(r, { breaks: [], pages: 2 });
  const r2 = layoutPages([{ top: 0, bottom: 1000 }, { top: 1000, bottom: 1050 }]);
  assert.equal(r2.breaks.length, 1);
  assert.equal(r2.breaks[0].block, 1);
  assert.ok(Math.abs(r2.breaks[0].height - (PITCH - 1000)) < 0.01);
  assert.equal(r2.pages, 2);
});

// ---- picture bytes -----------------------------------------------------------------------------------------------------------
const png = makePicture("png", 320, 160);
const jpeg = makePicture("jpeg", 400, 300, "#007040");
await check("picture sniffing reads real PNG and JPEG sizes", () => {
  assert.deepEqual(sniffImage(png.buf), { mime: "image/png", width: 320, height: 160 });
  assert.deepEqual(sniffImage(jpeg.buf), { mime: "image/jpeg", width: 400, height: 300 });
  assert.equal(sniffImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])), null);
  assert.equal(bytesFromDataUrl("data:image/svg+xml;base64,AAAA"), null);
  assert.equal(bytesFromDataUrl("https://example.com/a.png"), null);
  assert.equal(sha(bytesFromDataUrl(png.dataUrl)), sha(png.buf));
});

// ---- the .docx ---------------------------------------------------------------------------------------------------------------
const doc = syntheticDocument(png, jpeg);
const bytes = await exportDocx(doc, { title: "My Report" });
const d = await readDocx(bytes);

await check("docx: is a real zip with the Office Open XML parts, and every part parses", () => {
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels"]) assert.ok(d.names.includes(part), "missing " + part);
  assert.deepEqual(d.errors, []);
  assert.ok(d.types.some((t) => t.startsWith("png=image/png")) && d.types.some((t) => t.startsWith("jpeg=image/jpeg") || t.startsWith("jpg=image/jpeg")));
});
await check("docx: every relationship resolves (internal targets exist, external ones are web/mail links)", () => {
  for (const [id, r] of Object.entries(d.rels)) {
    if (r.external) assert.match(r.target, /^(https?:|mailto:)/, id);
    else assert.ok(d.names.includes("word/" + r.target.replace(/^\//, "").replace(/^word\//, "")), `${id} -> ${r.target}`);
  }
});
await check("docx: text and order match the source EXACTLY (paragraph by paragraph)", () => {
  assert.deepEqual(d.paragraphs.map((x) => x.text), expectedParagraphs());
});
await check("docx: unicode, emoji, right-to-left text, markup characters and tabs survive byte for byte", () => {
  const texts = d.paragraphs.map((x) => x.text);
  assert.ok(texts.includes(UNICODE));
  assert.ok(texts.includes(SPECIAL));
  assert.ok(texts.includes("Tab\tseparated"));
});
await check("docx: title, subtitle and heading levels are real Word styles", () => {
  const byText = (t) => d.paragraphs.find((x) => x.text === t);
  assert.equal(byText("My Report").style, "Title");
  assert.equal(byText("A subtitle line").style, "Subtitle");
  assert.equal(byText("Chapter one").style, "Heading1");
  assert.equal(byText("Section 1.1").style, "Heading2");
  assert.equal(byText("Subsection 1.1.1").style, "Heading3");
  const styles = d.zip.file("word/styles.xml") && d.parts["word/styles.xml"].toString();
  for (const id of ["Heading1", "Heading2", "Heading3", "Title", "Subtitle", "Hyperlink"]) assert.match(styles, new RegExp(`w:styleId="${id}"`));
  assert.match(styles, /w:outlineLvl w:val="0"/);
});
await check("docx: bold, italic, underline, strike, super/subscript are real run properties", () => {
  const mixed = d.paragraphs.find((x) => x.text.startsWith("Plain,"));
  const run = (t) => mixed.runs.find((r) => r.text === t);
  assert.ok(run("bold").bold && !run("bold").italic);
  assert.ok(run("italic").italic && !run("italic").bold);
  assert.ok(run("underline").underline);
  assert.ok(run("strike").strike);
  assert.ok(run("both").bold && run("both").italic);
  assert.ok(mixed.runs.filter((r) => r.sub).map((r) => r.text).join("") === "2");
  assert.ok(mixed.runs.filter((r) => r.sup).map((r) => r.text).join("") === "2");
  assert.ok(!run("Plain, ").bold && !run("Plain, ").italic);
});
await check("docx: font, size, text colour and highlight are kept", () => {
  const row = d.paragraphs.find((x) => x.text.startsWith("Styled"));
  const styled = row.runs.find((r) => r.text === "Styled");
  assert.equal(styled.font, "Times New Roman");
  assert.equal(styled.sizePt, 18);
  assert.equal(styled.color, "C00000");
  assert.equal(row.runs.find((r) => r.text === "highlighted").fill, "FFFF00");
  const v = row.runs.find((r) => r.text === "Verdana 9");
  assert.equal(v.font, "Verdana");
  assert.equal(v.sizePt, 9);
});
await check("docx: alignment, line spacing, spacing before/after and indent are paragraph properties", () => {
  const by = (t) => d.paragraphs.find((x) => x.text === t);
  assert.equal(by("Centered paragraph").align, "center");
  assert.equal(by("Right aligned paragraph").align, "right");
  assert.equal(by(d.paragraphs.find((x) => x.text.startsWith("Justified")).text).align, "both");
  const sp = by("Spaced paragraph");
  assert.equal(sp.line, 360);
  assert.equal(sp.lineRule, "auto");
  assert.equal(sp.before, 240);
  assert.equal(sp.after, 480);
  assert.equal(sp.indentLeft, 1440);
});
await check("docx: links are real external hyperlinks with the exact addresses", () => {
  const para = d.paragraphs.find((x) => x.text.startsWith("Visit"));
  const links = para.runs.filter((r) => r.link);
  assert.deepEqual(links.map((r) => [r.text, r.link.target, r.link.external]), [["our site", "https://example.com/path?a=1&b=2", true], ["write to us", "mailto:hi@example.com", true]]);
});
await check("docx: line breaks inside a paragraph stay breaks", () => {
  assert.ok(d.paragraphs.some((x) => x.text === "Line one\nLine two after a break"));
});
await check("docx: bullet and numbered lists use real Word numbering with levels, and numbering restarts per list", () => {
  const by = (t) => d.paragraphs.find((x) => x.text === t);
  const numbering = d.parts["word/numbering.xml"].toString();
  assert.match(numbering, /w:numFmt w:val="bullet"/);
  assert.match(numbering, /w:numFmt w:val="decimal"/);
  assert.equal(by("Bullet A").ilvl, 0);
  assert.equal(by("Nested bullet A1").ilvl, 1);
  assert.equal(by("Bullet A").numId, by("Bullet B").numId);
  assert.equal(by("Nested bullet A1").numId, by("Bullet A").numId);
  assert.equal(by("First").ilvl, 0);
  assert.equal(by("First-a").ilvl, 1);
  assert.notEqual(by("First").numId, by("Bullet A").numId);
  // The second ordered list is its own list (starts at 1 again), not a continuation.
  assert.notEqual(by("Restarts at one").numId, by("First").numId);
});
await check("docx: horizontal line is a bordered paragraph", () => {
  assert.equal(d.paragraphs.filter((x) => x.border).length, 1);
});
await check("docx: pictures are embedded with their original bytes, correct proportions and alt text", () => {
  const pics = d.paragraphs.flatMap((x) => x.runs.filter((r) => r.image).map((r) => ({ ...r.image, align: x.align })));
  assert.equal(pics.length, 2);
  const [a, b] = pics;
  assert.equal(sha(d.media["word/" + a.target]), sha(png.buf));
  assert.equal(sha(d.media["word/" + b.target]), sha(jpeg.buf));
  assert.equal(a.widthPx, 240);
  assert.equal(a.heightPx, 120); // 320x160 keeps 2:1
  assert.equal(b.widthPx, 300);
  assert.equal(b.heightPx, 225); // 400x300 keeps 4:3
  assert.equal(a.descr, "Purple box");
  assert.equal(a.align, "center");
  assert.equal(b.align, "right");
});
await check("docx: page is A4 portrait with 2.54 cm margins", () => {
  assert.deepEqual(d.page, { width: 11906, height: 16838, margins: [1440, 1440, 1440, 1440] });
});
await check("docx: title is stored in the document properties", () => {
  assert.match(d.parts["docProps/core.xml"].toString(), /My Report/);
});
await check("docx: an empty document is still a valid file with one empty paragraph", async () => {
  const e = await readDocx(await exportDocx(EMPTY_DOC));
  assert.deepEqual(e.errors, []);
  assert.deepEqual(e.paragraphs.map((x) => x.text), [""]);
  const e2 = await readDocx(await exportDocx({ type: "doc", content: [] }));
  assert.equal(e2.paragraphs.length, 1);
});
await check("docx: unsafe link addresses never become hyperlinks, but the words stay", async () => {
  const bad = { type: "doc", content: [p([text("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]), text(" me")])] };
  const r = await readDocx(await exportDocx(bad));
  assert.equal(r.paragraphs[0].text, "click me");
  assert.ok(r.paragraphs[0].runs.every((x) => !x.link));
  assert.ok(!Object.values(r.rels).some((x) => /javascript/i.test(x.target)));
});
await check("docx: characters XML cannot hold are the only thing removed", async () => {
  const r = await readDocx(await exportDocx({ type: "doc", content: [p("a\u0000b\u0008c\u000bd e")] }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.paragraphs[0].text, "abcd e");
});
await check("docx: a picture that cannot be read stops the export with a clear message", async () => {
  await assert.rejects(() => exportDocx({ type: "doc", content: [{ type: "image", attrs: { src: "https://example.com/x.png" } }] }), (e) => e instanceof ExportError && /picture/i.test(e.message));
});
await check("docx: a very large document exports (2,000 paragraphs, 20 pictures)", async () => {
  const content = [];
  for (let i = 0; i < 2000; i++) content.push(p(`Paragraph number ${i} with some words in it`));
  for (let i = 0; i < 20; i++) content.push({ type: "image", attrs: { src: png.dataUrl, width: 100, align: "left" } });
  const t = Date.now();
  const r = await readDocx(await exportDocx({ type: "doc", content }));
  assert.equal(r.paragraphs.length, 2020);
  assert.equal(r.paragraphs[1999].text, "Paragraph number 1999 with some words in it");
  assert.ok(Date.now() - t < 20000, "took " + (Date.now() - t));
});
await check("docx: the same document exports to identical content twice (deterministic text and structure)", async () => {
  const a = await readDocx(await exportDocx(doc));
  const b = await readDocx(await exportDocx(doc));
  assert.deepEqual(a.paragraphs, b.paragraphs);
});

// ---- page margins, geometry, page breaks, indents (new) ---------------------------------------------------------------
await check("margins: presets are valid and recognised; custom values are checked", () => {
  for (const p of MARGIN_PRESETS) {
    const c = validateMargins(p.margins);
    assert.equal(c.ok, true, p.id);
    assert.equal(marginPreset(p.margins), p.id);
  }
  assert.equal(marginPreset({ top: 1000, right: 1440, bottom: 1440, left: 1440 }), "custom");
  assert.equal(twipsToInches(1440), 1);
  assert.equal(inchesToTwips(0.5), 720);
  assert.deepEqual(MARGIN_PRESETS.map((p) => p.label), ["Normal", "Narrow", "Moderate", "Wide"]);
  const ok = { top: 1440, right: 1440, bottom: 1440, left: 1440 };
  for (const [bad, why] of [
    [{ ...ok, left: -1 }, /negative/],
    [{ ...ok, top: 0 }, /at least 0.25/],
    [{ ...ok, bottom: 100 }, /at least 0.25/],
    [{ ...ok, right: 9999 }, /at most 4/],
    [{ ...ok, left: NaN }, /number/],
    [{ ...ok, left: "1in" }, /number/],
    [{ ...ok, left: undefined }, /number/],
    [{ top: 1440, bottom: 1440, left: 5000, right: 5000 }, /left and right/],
    [null, /number/],
  ]) {
    const c = validateMargins(bad);
    assert.equal(c.ok, false, JSON.stringify(bad));
    assert.match(c.error, why);
  }
  assert.deepEqual(sanitizeMargins({ ...ok, left: -5 }), ok, "damaged saved margins fall back to the defaults");
  assert.deepEqual(sanitizeMargins(undefined), ok);
});
await check("geometry: the sheet is exactly A4 (210 x 297 mm) and its text area is exactly what Word uses; margins change it, the screen never does", () => {
  const g = pageViewGeometry(DEFAULT_MARGINS);
  // The sizes in CSS pixels are the exact conversions of Word's twips (15 twips to a pixel), not rounded
  assert.equal(g.pageW * 15, 11906);
  assert.equal(g.pageH * 15, 16838);
  assert.equal(g.contentW * 15, 11906 - 2880);
  assert.equal(g.contentH * 15, 16838 - 2880);
  assert.ok(Math.abs((g.pageW * 25.4) / 96 - 210) < 0.05 && Math.abs((g.pageH * 25.4) / 96 - 297) < 0.05, "210 x 297 mm");
  assert.equal(g.pitch, g.contentH + g.gapTotal);
  const narrow = pageViewGeometry(MARGIN_PRESETS[1].margins);
  assert.equal(narrow.contentW, g.pageW - 96);
  assert.ok(narrow.contentH > g.contentH);
  // Nothing about the viewport takes part: the same margins always give the same sheet
  assert.deepEqual(pageViewGeometry({ ...DEFAULT_MARGINS }), g);
  assert.equal(typeof globalThis.window, "undefined", "model.ts uses no browser API");
});
await check("layout: a page break starts the next block on a new page even when the page is nearly empty", () => {
  const blocks = [{ top: 0, bottom: 30 }, { top: 30, bottom: 52, breakAfter: true }, { top: 52, bottom: 82 }];
  const r = layoutPages(blocks);
  assert.equal(r.pages, 2);
  assert.equal(r.breaks.length, 1);
  assert.deepEqual([r.breaks[0].block, r.breaks[0].line], [2, 0]);
  assert.ok(Math.abs(r.breaks[0].height - (PITCH - 52)) < 0.01);
});
await check("layout: several breaks, a break at the end, and a break already at the top of a page", () => {
  assert.equal(layoutPages([{ top: 0, bottom: 20, breakAfter: true }, { top: 20, bottom: 40, breakAfter: true }, { top: 40, bottom: 60 }]).pages, 3);
  assert.equal(layoutPages([{ top: 0, bottom: 30 }, { top: 30, bottom: 52, breakAfter: true }]).pages, 2, "a trailing break opens a page to carry on typing");
  // The marker is the last thing on the page: the next block still goes to the next page, once.
  const tight = layoutPages([{ top: 0, bottom: 900 }, { top: 900, bottom: 922, breakAfter: true }, { top: 922, bottom: 952 }]);
  assert.equal(tight.pages, 2);
  assert.deepEqual(tight.breaks.map((x) => x.block), [2]);
  // A page break takes no room, as in Word: on a page that is already full it still ends that page, and the text after it opens the next
  // one (the file has "page break before" on that paragraph, and Word adds no blank page for it).
  const full = layoutPages([{ top: 0, bottom: 930 }, { top: 930, bottom: 952, breakAfter: true }, { top: 952, bottom: 982 }]);
  assert.equal(full.pages, 2);
  assert.deepEqual(full.breaks.map((x) => x.block), [2]);
  // Two in a row make a blank page, three make two
  assert.equal(layoutPages([{ top: 0, bottom: 20 }, { top: 20, bottom: 42, breakAfter: true }, { top: 42, bottom: 64, breakAfter: true }, { top: 64, bottom: 84 }]).pages, 3);
});
await check("layout: margins change how much fits on a page", () => {
  const blocks = Array.from({ length: 80 }, (_, i) => ({ top: i * 50, bottom: i * 50 + 50 }));
  const normal = layoutPages(blocks, pageViewGeometry(DEFAULT_MARGINS));
  const narrow = layoutPages(blocks, pageViewGeometry(MARGIN_PRESETS[1].margins));
  const wide = layoutPages(blocks, pageViewGeometry({ top: 2880, right: 1440, bottom: 2880, left: 1440 }));
  assert.ok(narrow.pages < normal.pages && normal.pages < wide.pages, `${narrow.pages} < ${normal.pages} < ${wide.pages}`);
});
await check("docx: the chosen margins are the page margins in the file, and pictures stay inside them", async () => {
  const margins = { top: 720, right: 2880, bottom: 1080, left: 2160 };
  const big = makePicture("png", 1200, 600);
  const r = await readDocx(await exportDocx({ type: "doc", content: [p("x"), { type: "image", attrs: { src: big.dataUrl, width: 1200, align: "left" } }] }, { margins }));
  assert.deepEqual(r.page, { width: 11906, height: 16838, margins: [720, 2880, 1080, 2160] });
  const pic = r.paragraphs.flatMap((x) => x.runs.filter((y) => y.image))[0].image;
  assert.equal(pic.widthPx, Math.round((11906 - 2880 - 2160) / 15), "as wide as the text area, not wider");
  assert.equal(pic.heightPx, Math.round(pic.widthPx / 2));
  // Bad margins never reach the file.
  const bad = await readDocx(await exportDocx(EMPTY_DOC, { margins: { top: -5, right: 1, bottom: 1, left: 1 } }));
  assert.deepEqual(bad.page.margins, [1440, 1440, 1440, 1440]);
});
await check("docx: a page break puts the next paragraph on a new page (page break before), and blank pages keep their place", async () => {
  const doc = { type: "doc", content: [p("Page one"), { type: "pageBreak" }, p("Page two"), { type: "pageBreak" }, { type: "pageBreak" }, p("Page four"), { type: "pageBreak" }] };
  const r = await readDocx(await exportDocx(doc));
  assert.deepEqual(r.paragraphs.map((x) => [x.text, x.pageBreakBefore]), [["Page one", false], ["Page two", true], ["", true], ["Page four", true], ["", true]]);
  assert.ok(!r.paragraphs.some((x) => x.pageBreakRuns), "no stray breaks inside paragraphs");
  // Before any text: page one is a blank page of its own.
  const first = await readDocx(await exportDocx({ type: "doc", content: [{ type: "pageBreak" }, p("Second page")] }));
  assert.deepEqual(first.paragraphs.map((x) => [x.text, x.pageBreakBefore]), [["", false], ["Second page", true]]);
  // After a heading, a list, a picture and a rule the break still lands on the next block.
  const mixed = { type: "doc", content: [{ type: "pageBreak" }, { type: "heading", attrs: { level: 1 }, content: [text("H")] }, { type: "pageBreak" }, { type: "bulletList", content: [{ type: "listItem", content: [p("item")] }] }, { type: "pageBreak" }, { type: "horizontalRule" }] };
  const m = await readDocx(await exportDocx(mixed));
  assert.deepEqual(m.paragraphs.map((x) => x.pageBreakBefore), [false, true, true, true]);
});
await check("docx: left, right and first-line indents, hanging indents, and the older indent steps", async () => {
  const doc = {
    type: "doc",
    content: [
      p("A", { indentLeft: 36, indentRight: 18, firstLine: 36 }),
      p("B", { indentLeft: 72, firstLine: -36 }),
      p("C", { indent: 2 }),
      p("D", { indent: 1, indentLeft: 54 }),
      p("E", { firstLine: -100 }),
      { type: "bulletList", content: [{ type: "listItem", content: [p("L", { indentLeft: 200, indentRight: 50 })] }] },
    ],
  };
  const r = await readDocx(await exportDocx(doc));
  const by = (t) => r.paragraphs.find((x) => x.text === t);
  assert.deepEqual([by("A").indentLeft, by("A").indentRight, by("A").firstLine, by("A").hanging], [720, 360, 720, null]);
  assert.deepEqual([by("B").indentLeft, by("B").firstLine, by("B").hanging], [1440, null, 720]);
  assert.equal(by("C").indentLeft, 1440, "the indent buttons' steps are half an inch each");
  assert.equal(by("D").indentLeft, 1080, "an exact left indent wins over the steps");
  assert.equal(by("E").hanging, null, "a hanging indent cannot pull text off the page (no left indent to hang from)");
  assert.notEqual(by("L").indentRight, 1000, "list items take their indent from the list");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
