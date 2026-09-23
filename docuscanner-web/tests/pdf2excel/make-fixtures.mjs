// Builds real PDF fixtures for the PDF -> Excel pipeline, run through the
// actual browser code (not just the geometry unit tests). Mirrors
// tests/pdf2word/make-scanned.mjs's approach for the scanned fixture.
//
// Run: node tests/pdf2excel/make-fixtures.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { renderPdf } from "../docx/pdftool.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, "out");
fs.mkdirSync(outDir, { recursive: true });

const PAGE = [595, 842]; // A4 in points

// A small invoice-style table: header + 3 data rows, one row missing a cell
// (sparse-column regression), tight numeric column spacing (CELL_GAP_EM fix).
const TABLE = {
  headers: ["Item", "Qty", "Price", "Notes"],
  cols: [60, 260, 340, 430], // x positions
  rows: [
    ["Widget", "12", "9.99", ""],
    ["Gadget", "4", "", "low stock"],
    ["Sprocket", "", "29.00", "backordered"],
  ],
};

async function buildDigitalTable(rotate = 0) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage(PAGE);
  if (rotate) page.setRotation(degrees(rotate));

  let y = 780;
  const drawRow = (cells, bold = false) => {
    cells.forEach((text, i) => {
      if (!text) return;
      page.drawText(text, { x: TABLE.cols[i], y, size: 11, font });
    });
    y -= 18;
  };
  drawRow(TABLE.headers);
  for (const row of TABLE.rows) drawRow(row);

  return pdf.save();
}

async function buildScannedWithStrayText() {
  // Rasterize a real table PDF (from the docx fixture set) with no text
  // layer at all -- exactly what a phone-camera/scanner capture looks like.
  const rendered = await renderPdf(path.join(dir, "../docx/fixtures/04-tables.word.pdf"), path.join(outDir, "_stray"), 2.0);
  const canvas = rendered[0].canvas;
  const jpgBytes = canvas.toBuffer("image/jpeg", 90);
  for (const f of fs.readdirSync(outDir)) if (f.startsWith("_stray")) fs.unlinkSync(path.join(outDir, f));

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const jpg = await pdf.embedJpg(jpgBytes);
  const page = pdf.addPage(PAGE);
  page.drawImage(jpg, { x: 0, y: 0, width: PAGE[0], height: PAGE[1] });
  // The stray stamp: a handful of characters that clears the old
  // MIN_TEXT_CHARS=8 threshold on their own but covers only a sliver of the
  // page -- reproduces bug A (page wrongly classified "digital", OCR skipped,
  // the real scanned table content silently lost).
  page.drawText("Page 1 of 1", { x: 250, y: 20, size: 9, font });
  return pdf.save();
}

const digital = await buildDigitalTable(0);
fs.writeFileSync(path.join(dir, "digital-table.pdf"), digital);
console.log("digital-table.pdf", digital.length, "bytes");

const rotated = await buildDigitalTable(90);
fs.writeFileSync(path.join(dir, "rotated-table.pdf"), rotated);
console.log("rotated-table.pdf", rotated.length, "bytes");

const scanned = await buildScannedWithStrayText();
fs.writeFileSync(path.join(dir, "scanned-with-stray-text.pdf"), scanned);
console.log("scanned-with-stray-text.pdf", scanned.length, "bytes");
