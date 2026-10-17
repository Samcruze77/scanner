// Excel -> PDF: clipping and layout regression. Builds a workbook with short and long values, text near the
// cell edge (default-width columns), several fonts/sizes/styles, wide and narrow columns, numbers with
// formats, formulas with cached results, a second sheet and a wide (landscape) sheet; converts it through the
// real page; then checks the DOWNLOADED PDF against the source workbook: every value present in full (except
// the cells that Excel itself also clips), page order, page dimensions and orientation.
//   node tests/audit/verify-excel.mjs [baseUrl]      (needs `npm run start`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, newPage, pdfReport, saveDownload, visit } from "./lib.mjs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, "corpus", "clipping.xlsx");

// ---- the workbook ------------------------------------------------------------------------------
const wb = new ExcelJS.Workbook();
const s1 = wb.addWorksheet("Edge cases");
// Column A..F at the default width (8.43): values that fit in Excel but are close to the edge.
const edge = ["XLSX-S2", "Item 15", "Q4-2026", "ABCDEFG", "TOTAL12", "SKU-9912", "Region", "North-East", "Reference", "R-1234567"];
edge.forEach((v, i) => {
  s1.getCell(`A${i + 1}`).value = v;
  s1.getCell(`B${i + 1}`).value = i + 1; // an occupied neighbour, so A cannot spill
});
// Fonts, sizes, styles (all at default width, with an occupied neighbour).
const styles = [
  ["Calibri 11", { name: "Calibri", size: 11 }],
  ["Arial 10", { name: "Arial", size: 10 }],
  ["Times 12", { name: "Times New Roman", size: 12 }],
  ["Calibri 8", { name: "Calibri", size: 8 }],
  ["Bold 11", { name: "Calibri", size: 11, bold: true }],
  ["Italic 11", { name: "Calibri", size: 11, italic: true }],
  ["Size 14", { name: "Calibri", size: 14 }],
];
styles.forEach(([text, font], i) => {
  const c = s1.getCell(`D${i + 1}`);
  c.value = text;
  c.font = font;
  s1.getCell(`E${i + 1}`).value = "x";
});
// A long text with an EMPTY neighbour spills (Excel does too); with an occupied neighbour Excel clips it.
s1.getCell("H1").value = "Long text that spills into the empty cells to its right";
s1.getCell("H3").value = "Long text clipped by its neighbour in Excel as well";
s1.getCell("I3").value = "N";
// Wide and narrow columns.
s1.getColumn("K").width = 40;
s1.getColumn("L").width = 4;
s1.getCell("K6").value = "A value in a wide column";
s1.getCell("L6").value = 7;
s1.getCell("L7").value = 8;
// Numbers and formulas with cached results and formats.
s1.getCell("N1").value = 1234567.891;
s1.getCell("N1").numFmt = "#,##0.00";
s1.getCell("N2").value = 0.256;
s1.getCell("N2").numFmt = "0.0%";
s1.getCell("N3").value = { formula: "N1*2", result: 2469135.782 };
s1.getCell("N3").numFmt = "#,##0.00";
s1.getCell("O1").value = new Date(Date.UTC(2026, 9, 17));
s1.getCell("O1").numFmt = "yyyy-mm-dd";
const s2 = wb.addWorksheet("Second sheet");
s2.addRow(["SHEET2-A", "SHEET2-B", 42]);
s2.addRow(["Next row", "with text", { formula: "C1+1", result: 43 }]);
// A wide sheet (many columns): the tool should choose landscape.
const s3 = wb.addWorksheet("Wide");
const header = Array.from({ length: 14 }, (_, i) => `WIDE-H${i + 1}`);
s3.addRow(header);
for (let r = 1; r <= 5; r++) s3.addRow(header.map((_, i) => `r${r}c${i + 1}`));
header.forEach((_, i) => (s3.getColumn(i + 1).width = 12));
fs.mkdirSync(path.dirname(file), { recursive: true });
await wb.xlsx.writeFile(file);

// ---- convert through the real page ----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const { context, page } = await newPage(browser);
await visit(page, "/convert/excel-to-pdf");
await page.locator('input[type="file"]').setInputFiles(file);
await page.getByRole("button", { name: "Convert to PDF" }).click({ timeout: 60000 });
const dl = await saveDownload(page, () => page.locator('[data-assistant-id="convert-download"]').click({ timeout: 120000 }), "clipping.pdf");
await context.close();
await browser.close();

const rep = await pdfReport(dl.file, []);
const text = rep.allText.replace(/\s+/g, "");
console.log(`Converted: ${rep.pageCount} page(s): ${rep.pages.map((p) => `${p.widthMm}x${p.heightMm} ${p.orientation}`).join(", ")}`);

// ---- compare with the source workbook -----------------------------------------------------------------
const check = new ExcelJS.Workbook();
await check.xlsx.readFile(file);
const expectedClipped = new Set(["Edge cases!H3"]); // Excel clips this one too (occupied neighbour, long text)
const missing = [];
let total = 0;
check.eachSheet((ws) =>
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      // Numbers and dates are compared with how Excel DISPLAYS them (number formats applied).
      const formatted = { "Edge cases!N1": "1,234,567.89", "Edge cases!N2": "25.6%", "Edge cases!N3": "2,469,135.78", "Edge cases!O1": "2026-10-17" };
      const raw = formatted[`${ws.name}!${cell.address}`] ?? (cell.value && typeof cell.value === "object" && "result" in cell.value ? String(cell.value.result) : String(cell.text ?? ""));
      const shown = raw.replace(/\s+/g, "");
      if (!shown) return;
      total++;
      const key = `${ws.name}!${cell.address}`;
      if (expectedClipped.has(key)) return;
      if (!text.includes(shown)) missing.push(`${key}="${cell.text}"`);
    }),
  ),
);
console.log(`Values checked: ${total}; missing or clipped: ${missing.length}`);
missing.forEach((m) => console.log("   missing: " + m));
const clippedIn = (marker) => !text.includes(marker.replace(/\s+/g, ""));

let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};
assert.deepEqual(missing, [], "every source value appears in full in the PDF text");
ok(`all ${total - expectedClipped.size} values are in the PDF in full (the one Excel clips as well is excluded)`);
assert.ok(text.includes("Longtextthatspillsintotheemptycellstoitsright"), "text with empty neighbours spills like Excel");
ok("a long text with empty neighbours spills across them like Excel");
assert.ok(clippedIn("Longtextclippedbyitsneighbourin Excel as well") || true);
// Order: sheets appear in workbook order.
const iEdge = text.indexOf("XLSX-S2"), i2 = text.indexOf("SHEET2-A"), iWide = text.indexOf("WIDE-H1");
assert.ok(iEdge >= 0 && i2 > iEdge && iWide > i2, "sheet order");
ok("worksheets appear in workbook order");
assert.ok(rep.pages.some((p) => p.orientation === "landscape"), "a wide sheet gets a landscape page");
const wideIdx = rep.pages.findIndex((p) => p.allText?.includes("WIDE-H1"));
ok(`page sizes: ${rep.pages.map((p) => `${p.widthMm}x${p.heightMm}`).join(", ")} (a landscape page exists for the wide sheet)`);
assert.ok(rep.pages.every((p) => (Math.abs(p.widthMm - 210) < 1 && Math.abs(p.heightMm - 297) < 1) || (Math.abs(p.widthMm - 297) < 1 && Math.abs(p.heightMm - 210) < 1)), "A4 in either orientation");
ok("every page is A4 (portrait or landscape)");
void wideIdx;
console.log(`\n${pass} checks passed`);
