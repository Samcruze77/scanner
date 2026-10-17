// Regression test for Word -> PDF table column widths (tests/docx/fixtures/tables/*.docx).
//
// Fixtures: tables whose `w:tblGrid` is a placeholder (100 twips per column, as written by docx.js and
// other producers) while the cells carry real widths; a correct-grid control; merged cells; long wrapping
// text; unequal column proportions; and a table that runs over several pages. Each is converted by the
// real engine and compared with Microsoft Word's own PDF export of the same file (<name>.word.pdf, made
// with `tests/docx/word-export-tables.ps1` when Word is installed).
//
//   node tests/docx/table-widths.mjs            (regenerates the fixtures, then converts and checks)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { convertFile, outDir } from "./harness.mjs";
import { openPdf } from "./pdftool.mjs";

// Text items with their x/y (points from the left / top of the page), per page.
async function extractLines(file) {
  const pdf = await openPdf(file);
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const height = page.view[3] - page.view[1];
    const content = await page.getTextContent();
    pages.push({ number: n, items: content.items.filter((i) => i.str.trim() !== "").map((i) => ({ text: i.str, x: i.transform[4], y: height - i.transform[5] })) });
  }
  await pdf.destroy();
  return pages;
}
import { reconcileGrid } from "../../utils/convert/docx/tableGrid.ts";

const require = createRequire(import.meta.url);
const docx = require("docx");
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, TextRun } = docx;
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "fixtures", "tables");
fs.mkdirSync(dir, { recursive: true });

let pass = 0;
const test = async (name, fn) => {
  await fn();
  pass++;
  console.log("  ok  " + name);
};

// ---- unit checks on the grid repair ------------------------------------------------------------
console.log("Grid repair");
await test("a placeholder grid is replaced by the cells' widths", () => {
  const rows = [{ cells: [0, 1, 2].map((i) => ({ gridStart: i, gridSpan: 1, preferredWidth: 3000 })) }];
  assert.deepEqual(reconcileGrid([100, 100, 100], rows), [3000, 3000, 3000]);
});
await test("a correct grid is left exactly as it is", () => {
  const grid = [2000, 5000, 2000];
  const rows = [{ cells: [2000, 5000, 2000].map((w, i) => ({ gridStart: i, gridSpan: 1, preferredWidth: w })) }];
  assert.equal(reconcileGrid(grid, rows), grid);
  // Slightly different but sane (Word's own rounding): unchanged.
  assert.equal(reconcileGrid([2010, 4990, 2000], rows).join(), [2010, 4990, 2000].join());
});
await test("cells without widths leave the grid alone", () => {
  const grid = [100, 100];
  assert.equal(reconcileGrid(grid, [{ cells: [{ gridStart: 0, gridSpan: 1 }, { gridStart: 1, gridSpan: 1 }] }]), grid);
});
await test("a merged cell fills in columns nothing else describes", () => {
  const rows = [
    { cells: [{ gridStart: 0, gridSpan: 2, preferredWidth: 6000 }, { gridStart: 2, gridSpan: 1, preferredWidth: 3000 }] },
    { cells: [{ gridStart: 0, gridSpan: 1, preferredWidth: 2000 }, { gridStart: 1, gridSpan: 1, preferredWidth: 4000 }, { gridStart: 2, gridSpan: 1, preferredWidth: 3000 }] },
  ];
  assert.deepEqual(reconcileGrid([100, 100, 100], rows), [2000, 4000, 3000]);
});

// ---- fixtures ------------------------------------------------------------------------------------
const para = (t) => new Paragraph({ children: [new TextRun({ text: t, font: "Arial", size: 22 })] });
const cell = (text, w, extra = {}) => new TableCell({ width: { size: w, type: WidthType.DXA }, children: [para(text)], ...extra });
async function write(name, children) {
  const file = path.join(dir, name + ".docx");
  // Written once: the committed fixtures stay byte-identical to the ones Word exported the reference PDFs from.
  if (!fs.existsSync(file)) fs.writeFileSync(file, await Packer.toBuffer(new Document({ sections: [{ children }] })));
  return file;
}
const intro = [para("INTRO table follows.")];
const fixtures = {
  "grid-correct": () =>
    write("grid-correct", [...intro, new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [3000, 3000, 3000], rows: [0, 1, 2].map((r) => new TableRow({ children: [0, 1, 2].map((c) => cell(`GC-R${r}C${c}`, 3000)) })) })]),
  "grid-placeholder": () =>
    write("grid-placeholder", [...intro, new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [0, 1, 2].map((r) => new TableRow({ children: [0, 1, 2].map((c) => cell(`GP-R${r}C${c}`, 3000)) })) })]),
  "unequal-proportions": () =>
    write("unequal-proportions", [...intro, new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [0, 1].map((r) => new TableRow({ children: [cell(`UP-R${r}C0`, 1500), cell(`UP-R${r}C1 a much longer cell of text that has to wrap across several lines inside its wide column`, 6000), cell(`UP-R${r}C2`, 1500)] })) })]),
  "merged-cells": () =>
    write("merged-cells", [...intro, new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [
      new TableRow({ children: [cell("MC-HEAD merged across two", 6000, { columnSpan: 2 }), cell("MC-R0C2", 3000)] }),
      new TableRow({ children: [cell("MC-R1C0", 2000), cell("MC-R1C1", 4000), cell("MC-R1C2", 3000)] }),
    ] })]),
  "multi-page": () =>
    write("multi-page", [...intro, new Table({ width: { size: 9000, type: WidthType.DXA }, rows: Array.from({ length: 70 }, (_, r) => new TableRow({ children: [0, 1, 2].map((c) => cell(`MP-R${String(r).padStart(2, "0")}C${c} some text`, 3000)) })) })]),
};
const files = {};
for (const [name, make] of Object.entries(fixtures)) files[name] = await make();

// ---- convert and compare with Word ---------------------------------------------------------------------
console.log("\nConverted PDFs vs Word's own export");
const firstX = (pages, text) => {
  for (const p of pages) for (const it of p.items) if (it.text.includes(text)) return { x: it.x, page: p.number, y: it.y };
  return null;
};
async function ours(name) {
  const result = await convertFile(files[name]);
  const pdf = path.join(outDir, `table-${name}.pdf`);
  fs.writeFileSync(pdf, result.bytes);
  return { pdf, pages: await extractLines(pdf), pageCount: result.pageCount };
}
for (const name of Object.keys(fixtures)) {
  await test(`${name}: columns are usable and match Word`, async () => {
    const o = await ours(name);
    const prefix = { "grid-correct": "GC", "grid-placeholder": "GP", "unequal-proportions": "UP", "merged-cells": "MC", "multi-page": "MP" }[name];
    const id = (r, c) => (name === "multi-page" ? `${prefix}-R${String(r).padStart(2, "0")}C${c}` : `${prefix}-R${r}C${c}`);
    // No text is lost or split into one-letter columns.
    const all = o.pages.flatMap((p) => p.items.map((i) => i.text)).join(" ");
    for (const t of name === "merged-cells" ? ["MC-HEAD", "MC-R0C2", "MC-R1C0", "MC-R1C1", "MC-R1C2"] : [id(0, 0), id(0, 1), id(0, 2), ...(name === "multi-page" ? [id(69, 2)] : [])]) assert.ok(all.includes(t), `${name}: "${t}" is in the PDF text`);
    const a = firstX(o.pages, name === "merged-cells" ? "MC-R1C0" : id(0, 0));
    const b = firstX(o.pages, name === "merged-cells" ? "MC-R1C1" : id(0, 1));
    const c = firstX(o.pages, name === "merged-cells" ? "MC-R1C2" : id(0, 2));
    assert.ok(a && b && c, "cells found");
    // Columns are real columns: each at least 30 pt wide (the collapsed bug gave about 5 pt).
    assert.ok(b.x - a.x > 30 && c.x - b.x > 30, `${name}: column gaps ${(b.x - a.x).toFixed(0)} / ${(c.x - b.x).toFixed(0)} pt`);
    const wordPdf = path.join(dir, name + ".word.pdf");
    if (fs.existsSync(wordPdf)) {
      const w = await extractLines(wordPdf);
      const wa = firstX(w, name === "merged-cells" ? "MC-R1C0" : id(0, 0));
      const wb = firstX(w, name === "merged-cells" ? "MC-R1C1" : id(0, 1));
      const wc = firstX(w, name === "merged-cells" ? "MC-R1C2" : id(0, 2));
      assert.ok(wa && wb && wc, "Word reference has the cells");
      for (const [mine, theirs, label] of [[b.x - a.x, wb.x - wa.x, "column 1 width"], [c.x - b.x, wc.x - wb.x, "column 2 width"]]) {
        assert.ok(Math.abs(mine - theirs) <= Math.max(4, theirs * 0.05), `${name}: ${label} ${mine.toFixed(1)} pt vs Word ${theirs.toFixed(1)} pt`);
      }
      assert.ok(Math.abs(o.pageCount - w.length) <= (name === "multi-page" ? 1 : 0), `${name}: ${o.pageCount} pages vs Word ${w.length}`);
      console.log(`      ${name}: gaps ${(b.x - a.x).toFixed(1)}/${(c.x - b.x).toFixed(1)} pt (Word ${(wb.x - wa.x).toFixed(1)}/${(wc.x - wb.x).toFixed(1)}), pages ${o.pageCount} (Word ${w.length})`);
    } else {
      console.log(`      ${name}: gaps ${(b.x - a.x).toFixed(1)}/${(c.x - b.x).toFixed(1)} pt (no Word reference file)`);
    }
  });
}

console.log(`\n${pass} checks passed`);
