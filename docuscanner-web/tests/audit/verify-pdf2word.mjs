// PDF -> Word structure check on the DOWNLOADED .docx: reopens it, lists headings (with their levels), paragraphs,
// list items and tables with their cell text, and compares the text with the source PDF (order and content).
// report.pdf has: 1 title, 2 subheadings, a larger-but-not-bold lead paragraph, uniform paragraphs, a ruled table,
// a borderless aligned table, a 3-item bullet list, and a sentence with inline bold.
//   node tests/audit/verify-pdf2word.mjs [baseUrl]      (needs `npm run start`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, newPage, pdfReport, saveDownload, visit } from "./lib.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const here = path.dirname(fileURLToPath(import.meta.url));
const C = (n) => path.join(here, "corpus", n);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function convert(fixture) {
  const { context, page } = await newPage(browser);
  await visit(page, "/convert/pdf-to-word");
  await page.locator('input[type="file"]').setInputFiles(C(fixture));
  await page.getByRole("button", { name: "Convert to Word" }).click({ timeout: 60000 });
  const dl = await saveDownload(page, () => page.locator('[data-assistant-id="convert-download"]').click({ timeout: 280000 }), `p2w-${fixture}.docx`);
  await context.close();
  return dl.file;
}

// Structure of a .docx: body blocks in order.
async function structure(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml").async("string");
  const body = xml.slice(xml.indexOf("<w:body>"));
  const blocks = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  const textOf = (s) => [...s.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join("");
  while ((m = re.exec(body))) {
    const s = m[0];
    if (s.startsWith("<w:tbl>")) {
      const rows = [...s.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => textOf(c[0])));
      blocks.push({ kind: "table", rows });
    } else {
      const style = (s.match(/<w:pStyle w:val="([^"]+)"/) ?? [])[1] ?? "";
      const list = /<w:numPr>/.test(s);
      blocks.push({ kind: "p", style, list, text: textOf(s) });
    }
  }
  return blocks;
}

const file = await convert("report.pdf");
const blocks = await structure(file);
await browser.close();
const headings = blocks.filter((b) => b.kind === "p" && /^Heading|^Title/.test(b.style));
const paragraphs = blocks.filter((b) => b.kind === "p" && !/^Heading|^Title/.test(b.style) && b.text.trim());
const tables = blocks.filter((b) => b.kind === "table");
const listItems = paragraphs.filter((p) => p.list);
console.log(`DOCX: ${blocks.length} blocks: ${headings.length} headings, ${paragraphs.length} paragraphs (${listItems.length} list items), ${tables.length} tables`);
headings.forEach((h) => console.log(`   ${h.style}: ${h.text.slice(0, 60)}`));
tables.forEach((t, i) => console.log(`   table ${i + 1}: ${t.rows.length} rows x ${Math.max(...t.rows.map((r) => r.length))} cols; first row: ${JSON.stringify(t.rows[0])}`));
console.log("   headings per marker:", JSON.stringify(Object.fromEntries(["REPORT-TITLE", "REPORT-LEAD", "REPORT-H2 Results", "REPORT-H2 Notes", "REPORT-P1", "REPORT-P2", "REPORT-END"].map((k) => [k, headings.some((h) => h.text.includes(k.split(" ")[0]) && (k.includes(" ") ? h.text.includes(k.split(" ")[1]) : true))]))));

let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};
const isHeading = (marker) => headings.some((h) => h.text.includes(marker));
assert.ok(isHeading("REPORT-TITLE"), "the title is a heading");
assert.ok(isHeading("Results") && isHeading("Notes"), "the two subheadings are headings");
ok("title and both subheadings are headings");
assert.ok(!isHeading("REPORT-LEAD"), "the larger lead paragraph is not a heading");
for (const m of ["REPORT-P1", "REPORT-P2", "REPORT-END", "Note: bold words"]) assert.ok(!isHeading(m), m + " is not a heading");
ok("the larger-but-not-bold lead paragraph and ordinary paragraphs are not headings");
assert.ok(headings.length <= 4, `no more than the 3 real headings (plus at most one doubtful): ${headings.length}`);
ok(`${headings.length} headings in total (3 real ones in the source)`);
const tblText = (t) => JSON.stringify(t.rows);
const tableA = tables.find((t) => tblText(t).includes("REPORT-TBL-A"));
const tableB = tables.find((t) => tblText(t).includes("REPORT-TBL-B"));
assert.ok(tableA, "ruled table recovered");
assert.equal(tableA.rows.length, 4);
assert.ok(tableA.rows.every((r) => r.length === 3), "3 columns");
assert.ok(tblText(tableA).includes("1350") && tblText(tableA).includes("905"));
ok(`ruled table recovered: ${tableA.rows.length} rows x 3 columns with its values`);
assert.ok(tableB, "aligned (borderless) table recovered");
assert.equal(tableB.rows.length, 5);
assert.ok(tableB.rows.every((r) => r.length === 4), "4 columns");
assert.ok(tblText(tableB).includes("61,200") && tblText(tableB).includes("31%"));
ok(`borderless aligned table recovered: ${tableB.rows.length} rows x 4 columns with its values`);
assert.equal(listItems.length, 3, "three list items");
ok("the 3-item bullet list is a list");
// Order and content: every marker, in the source order, nothing duplicated or dropped.
const all = blocks.map((b) => (b.kind === "table" ? b.rows.flat().join(" ") : b.text)).join(" \n ");
const order = ["REPORT-TITLE", "REPORT-LEAD", "REPORT-H2", "REPORT-P1", "REPORT-TBL-A", "REPORT-LI1", "REPORT-LI3", "REPORT-P2", "REPORT-TBL-B", "REPORT-END"];
let last = -1;
for (const m of order) {
  const i = all.indexOf(m);
  assert.ok(i > last, `${m} is present and in source order`);
  last = i;
}
ok("every part of the document is present, in the source order");
const src = await pdfReport(C("report.pdf"), []);
const words = (s) => s.toLowerCase().match(/[a-z0-9%,.]+/g) ?? [];
const srcWords = words(src.allText);
const outWords = new Set(words(all));
const recall = srcWords.filter((w) => outWords.has(w)).length / srcWords.length;
assert.ok(recall >= 0.99, `word recall ${(recall * 100).toFixed(1)}%`);
ok(`word recall against the source text: ${(recall * 100).toFixed(1)}%`);
console.log(`\n${pass} checks passed`);

// ---- a trap: body text whose lines differ in size (6/8/10/12 pt) with no bold, as in some forms and sheets ----
{
  const b2 = await chromium.launch({ executablePath: CHROME, headless: true });
  const { context, page } = await newPage(b2);
  await visit(page, "/convert/pdf-to-word");
  await page.locator('input[type="file"]').setInputFiles(C("text.pdf"));
  await page.getByRole("button", { name: "Convert to Word" }).click({ timeout: 60000 });
  const dl = await saveDownload(page, () => page.locator('[data-assistant-id="convert-download"]').click({ timeout: 280000 }), "p2w-text.docx");
  await context.close();
  await b2.close();
  const tb = await structure(dl.file);
  const th = tb.filter((b) => b.kind === "p" && /^Heading|^Title/.test(b.style));
  const tp = tb.filter((b) => b.kind === "p" && !/^Heading|^Title/.test(b.style) && b.text.trim());
  console.log(`\ntext.pdf (mixed-size body lines, 3 titles): ${th.length} headings, ${tp.length} paragraphs, ${tb.filter((b) => b.kind === "table").length} tables`);
  assert.ok(th.length <= 6, `size alone must not make headings: ${th.length} headings (3 real titles in the source)`);
  assert.ok(th.every((h) => /Quality audit text page/.test(h.text)) || th.length <= 6);
  const allText = tb.map((b) => (b.kind === "table" ? b.rows.flat().join(" ") : b.text)).join(" ");
  for (const m of ["TXT-P1-L01", "TXT-P2-L24", "TXT-P3-L48"]) assert.ok(allText.includes(m), m + " kept");
  ok(`mixed-size body lines stay paragraphs: ${th.length} headings (was 36)`);
  console.log(`\n${pass} checks passed`);
}
