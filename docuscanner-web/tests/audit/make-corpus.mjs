// Synthetic, non-sensitive test files with known, measurable properties for the output-quality
// audit (tests/audit/audit.mjs). Everything is generated here; nothing is downloaded.
//   node tests/audit/make-corpus.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas");
const docx = require("docx");
const ExcelJS = require("exceljs");
const here = path.dirname(fileURLToPath(import.meta.url));
export const dir = path.join(here, "corpus");
fs.mkdirSync(dir, { recursive: true });
const out = (name) => path.join(dir, name);

// A small deterministic random generator so every run builds identical files.
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---- images -------------------------------------------------------------------------------------
function detailedPhoto(w, h, type, quality) {
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#d9c7a8");
  g.addColorStop(1, "#6f8fb5");
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  // Fine vertical bars (detail that blur destroys).
  const bar = Math.max(2, Math.round(w / 400));
  for (let px = 0; px < w; px += bar * 2) {
    x.fillStyle = "rgba(20,30,70,0.55)";
    x.fillRect(px, h * 0.55, bar, h * 0.4);
  }
  // A "face": ellipse, eyes, hair lines.
  x.fillStyle = "#e6b28c";
  x.beginPath();
  x.ellipse(w / 2, h * 0.38, w * 0.16, h * 0.26, 0, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#2b1d12";
  for (let i = 0; i < 40; i++) x.fillRect(w * 0.36 + i * (w * 0.0017), h * 0.2, Math.max(1, bar / 2), h * 0.06);
  x.fillRect(w * 0.45, h * 0.36, w * 0.02, h * 0.01);
  x.fillRect(w * 0.53, h * 0.36, w * 0.02, h * 0.01);
  // Speckle noise like sensor grain.
  const img = x.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  return type === "png" ? c.toBuffer("image/png") : c.toBuffer("image/jpeg", quality);
}
fs.writeFileSync(out("photo-hi.jpg"), detailedPhoto(4000, 3000, "jpeg", 95));
fs.writeFileSync(out("photo-std.jpg"), detailedPhoto(1600, 1200, "jpeg", 90));
fs.writeFileSync(out("photo-low.jpg"), detailedPhoto(400, 300, "jpeg", 85));
fs.writeFileSync(out("photo-large.png"), detailedPhoto(8000, 6000, "png"));
fs.writeFileSync(out("photo-large.jpg"), detailedPhoto(8000, 6000, "jpeg", 90));

function transparentPng(name, w, h, draw) {
  const c = createCanvas(w, h);
  draw(c.getContext("2d"), w, h);
  fs.writeFileSync(out(name), c.toBuffer("image/png"));
}
transparentPng("logo.png", 1200, 1200, (x, w) => {
  x.strokeStyle = "#8000c0";
  x.lineWidth = w / 40;
  for (let r = w * 0.1; r < w * 0.48; r += w / 20) {
    x.beginPath();
    x.arc(w / 2, w / 2, r, 0, Math.PI * 2);
    x.stroke();
  }
});
transparentPng("signature.png", 900, 300, (x, w, h) => {
  x.strokeStyle = "#1a3fa8";
  x.lineWidth = 4;
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(30, h * 0.7);
  for (let t = 0; t <= 1; t += 0.01) x.lineTo(30 + t * (w - 60), h * 0.55 + Math.sin(t * 22) * h * 0.22 * (1 - t * 0.5));
  x.stroke();
});

// ---- PDFs ---------------------------------------------------------------------------------------
async function textPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let p = 1; p <= 3; p++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(`TXT-P${p} Quality audit text page`, { x: 50, y: 790, size: 18, font: bold });
    let y = 760;
    for (let line = 1; line <= 48; line++) {
      const size = [6, 8, 10, 12][line % 4];
      page.drawText(`TXT-P${p}-L${String(line).padStart(2, "0")} The quick brown fox jumps over the lazy dog 0123456789`, { x: 50, y, size, font });
      y -= size + 6.5;
    }
    // A small table made of hairlines.
    for (let r = 0; r <= 4; r++) page.drawLine({ start: { x: 50, y: 120 - r * 18 }, end: { x: 400, y: 120 - r * 18 }, thickness: 0.25, color: rgb(0, 0, 0) });
    for (let c = 0; c <= 4; c++) page.drawLine({ start: { x: 50 + c * 87.5, y: 120 }, end: { x: 50 + c * 87.5, y: 48 }, thickness: 0.25, color: rgb(0, 0, 0) });
    page.drawText(`R1C1`, { x: 54, y: 106, size: 7, font });
  }
  fs.writeFileSync(out("text.pdf"), await pdf.save());
}
async function vectorPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const photo = await pdf.embedJpg(fs.readFileSync(out("photo-std.jpg")));
  // Page 1: US Letter portrait with diagrams, a photo and small text.
  const a = pdf.addPage([612, 792]);
  a.drawText("VEC-P1 Letter page: hairline diagram, circles, embedded photo", { x: 40, y: 760, size: 11, font });
  for (let i = 0; i < 60; i++) a.drawLine({ start: { x: 40 + i * 9, y: 500 }, end: { x: 40 + i * 9, y: 700 }, thickness: 0.25, color: rgb(0, 0, 0.6) });
  for (let r = 10; r < 90; r += 6) a.drawCircle({ x: 300, y: 600, size: r, borderWidth: 0.3, borderColor: rgb(0.7, 0, 0) });
  a.drawImage(photo, { x: 40, y: 150, width: 240, height: 180 });
  a.drawText("Caption in 6 pt: VEC-P1-CAPTION 0123456789", { x: 300, y: 200, size: 6, font });
  // Page 2: landscape.
  const b = pdf.addPage([792, 612]);
  b.drawText("VEC-P2 Landscape page", { x: 40, y: 570, size: 14, font });
  b.drawRectangle({ x: 40, y: 40, width: 712, height: 500, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
  fs.writeFileSync(out("vector.pdf"), await pdf.save());
}
async function scanPdfAndJpeg() {
  const w = 1654, h = 2339; // A4 at 200 dpi
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  x.fillStyle = "#f7f5ef";
  x.fillRect(0, 0, w, h);
  x.fillStyle = "#111";
  x.font = "bold 44px Arial";
  x.fillText("SCAN-TITLE Invoice 2026-0042", 140, 200);
  const lines = ["The quick brown fox jumps over the lazy dog", "Pack my box with five dozen liquor jugs", "Total amount due 1234.56 EUR by 30 November"];
  for (let i = 0; i < 24; i++) {
    x.font = i % 3 === 0 ? "22px Arial" : "30px Arial";
    x.fillText(`SCAN-L${String(i + 1).padStart(2, "0")} ${lines[i % 3]}`, 140, 300 + i * 70);
  }
  fs.writeFileSync(out("scan.jpg"), c.toBuffer("image/jpeg", 85));
  const pdf = await PDFDocument.create();
  const img = await pdf.embedJpg(c.toBuffer("image/jpeg", 85));
  const page = pdf.addPage([595.28, 841.89]);
  page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  fs.writeFileSync(out("scan.pdf"), await pdf.save());
}
// A text PDF that is also a table, for PDF -> Excel.
async function tablePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  page.drawText("TBL Quarterly sales", { x: 50, y: 790, size: 16, font });
  const rows = [["Region", "Q1", "Q2", "Q3"], ["North", "1200", "1350", "1500"], ["South", "980", "1020", "1110"], ["East", "1500", "1475", "1620"], ["West", "870", "905", "960"]];
  rows.forEach((r, i) => r.forEach((cell, j) => page.drawText(cell, { x: 50 + j * 100, y: 740 - i * 24, size: 11, font })));
  fs.writeFileSync(out("table.pdf"), await pdf.save());
}

// ---- DOCX / XLSX ------------------------------------------------------------------------------------
async function makeDocx() {
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, TextRun, PageBreak } = docx;
  const photo = fs.readFileSync(out("photo-std.jpg"));
  const para = (t) => new Paragraph({ children: [new TextRun({ text: t, font: "Arial", size: 22 })] });
  const children = [new Paragraph({ text: "DOCX-TITLE Quality audit document", heading: HeadingLevel.TITLE })];
  for (let i = 1; i <= 12; i++) children.push(para(`DOCX-P${String(i).padStart(2, "0")} The quick brown fox jumps over the lazy dog, again and again, to make this paragraph wrap across lines of the page.`));
  children.push(new Paragraph({ text: "DOCX-H1 Heading one", heading: HeadingLevel.HEADING_1 }));
  children.push(
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      rows: [0, 1, 2, 3].map((r) => new TableRow({ children: [0, 1, 2].map((c) => new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [para(`TBL-R${r}C${c}`)] })) })),
    }),
  );
  children.push(new Paragraph({ children: [new ImageRun({ data: photo, transformation: { width: 480, height: 360 }, type: "jpg" })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));
  for (let i = 13; i <= 30; i++) children.push(para(`DOCX-P${String(i).padStart(2, "0")} Second page content with 0123456789 and symbols & < > " ' accents é é ü.`));
  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(out("document.docx"), await Packer.toBuffer(doc));
}
async function makeXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.addRow(["XLSX-Item", "Qty", "Price", "Total"]).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
  for (let i = 1; i <= 15; i++) {
    const r = ws.addRow([`Item ${i}`, i * 3, 9.99 + i, null]);
    r.getCell(4).value = { formula: `B${i + 1}*C${i + 1}`, result: i * 3 * (9.99 + i) };
    r.getCell(3).numFmt = "#,##0.00";
  }
  ws.addRow(["Total", null, null, { formula: "SUM(D2:D16)", result: Array.from({ length: 15 }, (_, i) => (i + 1) * 3 * (9.99 + i + 1)).reduce((s, v) => s + v, 0) }]);
  ws.mergeCells("F1:H1");
  ws.getCell("F1").value = "Merged heading";
  ws.getColumn(1).width = 18;
  ws.getCell("A1").border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  wb.addWorksheet("Second").addRow(["XLSX-S2", "Second sheet value", 42]);
  await wb.xlsx.writeFile(out("workbook.xlsx"));
}

await textPdf();
await vectorPdf();
await scanPdfAndJpeg();
await tablePdf();
await makeDocx();
await makeXlsx();
console.log(fs.readdirSync(dir).map((f) => `${f} ${(fs.statSync(path.join(dir, f)).size / 1024).toFixed(0)} KB`).join("\n"));

// ---- extra fixtures for the Phase 1-3 fix tests --------------------------------------------------
{
  // A portrait photograph with a face and detail running to every edge.
  const w = 3000, h = 4000;
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#c9b79a");
  g.addColorStop(1, "#5d7fa8");
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  x.fillStyle = "#e6b28c";
  x.beginPath();
  x.ellipse(w / 2, h * 0.4, w * 0.25, h * 0.2, 0, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#2b1d12";
  x.fillRect(w * 0.4, h * 0.38, w * 0.04, h * 0.01);
  x.fillRect(w * 0.56, h * 0.38, w * 0.04, h * 0.01);
  x.fillStyle = "#222";
  x.fillRect(0, h * 0.7, w, h * 0.3); // dark shirt reaching all edges
  x.fillStyle = "#f33";
  x.fillRect(0, 0, 60, 60); // corner markers: any crop that loses a corner is visible
  x.fillRect(w - 60, 0, 60, 60);
  x.fillRect(0, h - 60, 60, 60);
  x.fillRect(w - 60, h - 60, 60, 60);
  fs.writeFileSync(out("portrait-photo.jpg"), c.toBuffer("image/jpeg", 92));
  const l = createCanvas(3000, 2000);
  const lx = l.getContext("2d");
  lx.drawImage(c, 0, 0, 3000, 2000);
  fs.writeFileSync(out("photo-landscape.jpg"), l.toBuffer("image/jpeg", 92));
}
{
  // A page of text that runs right up to the right-hand edge.
  const w = 1654, h = 2339;
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  x.fillStyle = "#f7f5ef";
  x.fillRect(0, 0, w, h);
  x.fillStyle = "#111";
  x.font = "26px Arial";
  for (let i = 0; i < 30; i++) x.fillText(`EDGE-L${String(i + 1).padStart(2, "0")} ${"word ".repeat(26)}END${i + 1}`, 24, 120 + i * 70);
  fs.writeFileSync(out("text-edge.jpg"), c.toBuffer("image/jpeg", 90));
}
{
  // A coloured logo with soft, partly transparent edges (radial alpha fade) and a black signature.
  const s = 800;
  const c = createCanvas(s, s);
  const x = c.getContext("2d");
  const rg = x.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.48);
  rg.addColorStop(0, "rgba(220,30,60,1)");
  rg.addColorStop(0.7, "rgba(30,90,220,0.9)");
  rg.addColorStop(1, "rgba(30,90,220,0)");
  x.fillStyle = rg;
  x.beginPath();
  x.arc(s / 2, s / 2, s * 0.48, 0, Math.PI * 2);
  x.fill();
  fs.writeFileSync(out("logo-soft.png"), c.toBuffer("image/png"));
  const o = createCanvas(900, 600);
  const ox = o.getContext("2d");
  const og = ox.createLinearGradient(0, 0, 900, 600);
  og.addColorStop(0, "#2a7");
  og.addColorStop(1, "#a27");
  ox.fillStyle = og;
  ox.fillRect(0, 0, 900, 600);
  ox.fillStyle = "#fff";
  ox.font = "bold 90px Arial";
  ox.fillText("OPAQUE PNG", 90, 330);
  fs.writeFileSync(out("opaque.png"), o.toBuffer("image/png"));
  const sig = createCanvas(900, 300);
  const sx = sig.getContext("2d");
  sx.strokeStyle = "#000";
  sx.lineWidth = 5;
  sx.lineCap = "round";
  sx.beginPath();
  sx.moveTo(20, 210);
  for (let t = 0; t <= 1; t += 0.01) sx.lineTo(20 + t * 860, 150 + Math.sin(t * 20) * 60 * (1 - t * 0.4));
  sx.stroke();
  fs.writeFileSync(out("signature-black.png"), sig.toBuffer("image/png"));
}
{
  async function pdfOf(name, sizes) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    sizes.forEach(([w, h, label], i) => {
      const page = pdf.addPage([w, h]);
      page.drawRectangle({ x: 20, y: 20, width: w - 40, height: h - 40, borderWidth: 2, borderColor: rgb(0.1, 0.2, 0.8) });
      page.drawText(`${label} page ${i + 1}: ${w}x${h} pt`, { x: 40, y: h - 60, size: 20, font });
    });
    fs.writeFileSync(out(name), await pdf.save());
  }
  await pdfOf("a4-portrait.pdf", [[595.28, 841.89, "A4P"]]);
  await pdfOf("a4-landscape.pdf", [[841.89, 595.28, "A4L"]]);
  await pdfOf("letter.pdf", [[612, 792, "LETTER"]]);
  await pdfOf("mixed.pdf", [[595.28, 841.89, "A4P"], [841.89, 595.28, "A4L"], [612, 792, "LETTER"], [792, 612, "LETTERL"]]);
}

// ---- rich.pdf: the Phase 5 acceptance fixture (text, vectors, small text, embedded photo, landscape page) ----
{
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const photo = await pdf.embedJpg(fs.readFileSync(out("photo-std.jpg")));
  const p1 = pdf.addPage([595.28, 841.89]);
  p1.drawText("RICH-P1 Edit-preservation fixture", { x: 50, y: 800, size: 16, font });
  for (let i = 1; i <= 14; i++) p1.drawText(`RICH-P1-L${String(i).padStart(2, "0")} The quick brown fox jumps over the lazy dog 0123456789`, { x: 50, y: 780 - i * 13, size: [7, 9, 11][i % 3], font });
  for (let i = 0; i < 40; i++) p1.drawLine({ start: { x: 50 + i * 12, y: 560 }, end: { x: 50 + i * 12, y: 620 }, thickness: 0.25, color: rgb(0, 0, 0.6) });
  for (let r = 8; r < 56; r += 5) p1.drawCircle({ x: 400, y: 590, size: r, borderWidth: 0.3, borderColor: rgb(0.7, 0, 0) });
  p1.drawImage(photo, { x: 50, y: 300, width: 283, height: 212 });
  p1.drawText("RICH-P1-SMALL six point caption 0123456789", { x: 50, y: 280, size: 6, font });
  const p2 = pdf.addPage([841.89, 595.28]);
  p2.drawText("RICH-P2 landscape page", { x: 50, y: 550, size: 16, font });
  for (let r = 0; r <= 8; r++) p2.drawLine({ start: { x: 50, y: 500 - r * 25 }, end: { x: 790, y: 500 - r * 25 }, thickness: 0.4, color: rgb(0, 0, 0) });
  p2.drawText("RICH-P2-SMALL 6 pt text in the table 0123456789", { x: 54, y: 480, size: 6, font });
  const p3 = pdf.addPage([595.28, 841.89]);
  p3.drawText("RICH-P3 third page", { x: 50, y: 800, size: 16, font });
  for (let i = 1; i <= 20; i++) p3.drawText(`RICH-P3-L${String(i).padStart(2, "0")} Pack my box with five dozen liquor jugs`, { x: 50, y: 780 - i * 16, size: 10, font });
  fs.writeFileSync(out("rich.pdf"), await pdf.save());
}
