// Tests the compression algorithms on real files. The app uses a canvas codec in
// the browser; here `sharp` stands in, so the size-targeting, PDF image
// recompression and Word/Excel package rewriting are checked automatically.
//
// Run: node tests/compress/run.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import sharp from "sharp";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as docxLib from "docx";

globalThis.DOMParser = DOMParser;
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });

const { compressImage, analyzeImage } = await import("../../utils/compress/image.ts");
const { compressPdf, analyzePdf } = await import("../../utils/compress/pdf.ts");
const { compressOoxml, analyzeOoxml } = await import("../../utils/compress/ooxml.ts");
const { CompressError, COMPRESSION_LEVELS, formatBytes } = await import("../../utils/compress/types.ts");
const { PDFName, PDFRawStream, PDFString } = await import("pdf-lib");
const { extractLines, openPdf } = await import("../docx/pdftool.mjs");
const { createCanvas } = require("@napi-rs/canvas");

// ---- codec ------------------------------------------------------------------------------

const codec = {
  async decode(data) {
    let meta;
    try {
      meta = await sharp(data, { failOn: "none" }).metadata();
    } catch {
      return null;
    }
    if (!meta.width || !meta.height) return null;
    return {
      width: meta.width,
      height: meta.height,
      hasAlpha: Boolean(meta.hasAlpha),
      async encode({ maxDim, quality, format }) {
        let pipeline = sharp(data, { failOn: "none" }).rotate();
        if (maxDim && Math.max(meta.width, meta.height) > maxDim) pipeline = pipeline.resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true });
        if (format === "jpeg") pipeline = pipeline.flatten({ background: "#ffffff" }).toColourspace("srgb").jpeg({ quality: Math.round(quality * 100) });
        else if (format === "webp") pipeline = pipeline.webp({ quality: Math.round(quality * 100) });
        else pipeline = pipeline.png({ compressionLevel: 9 });
        const { data: out, info } = await pipeline.toBuffer({ resolveWithObject: true });
        return { data: new Uint8Array(out), mime: `image/${format}`, width: info.width, height: info.height };
      },
      dispose() {},
    };
  },
};

// Renders PDF pages with pdf.js + napi-canvas, like the browser renderer does with a real canvas.
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
async function openRenderer(data) {
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  return {
    pageCount: doc.numPages,
    async render(index, scale, quality) {
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const base = page.getViewport({ scale: 1 });
      return { data: new Uint8Array(canvas.toBuffer("image/jpeg", Math.round(quality * 100))), widthPt: base.width, heightPt: base.height };
    },
    async dispose() {
      await task.destroy();
    },
  };
}
const deps = { codec, openRenderer };

// ---- fixture builders ------------------------------------------------------------------

// A photo-like image: smooth colour fields plus fine noise, so JPEG size behaves
// like a real camera picture.
async function photo(width, height, seed = 1, format = "jpeg") {
  const raw = Buffer.alloc(width * height * 3);
  let s = seed * 9301;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = (s % 41) - 20;
      raw[i] = Math.max(0, Math.min(255, 128 + 90 * Math.sin(x / 130 + seed) + n));
      raw[i + 1] = Math.max(0, Math.min(255, 128 + 90 * Math.sin(y / 110 + seed * 2) + n));
      raw[i + 2] = Math.max(0, Math.min(255, 128 + 90 * Math.sin((x + y) / 170) + n));
    }
  }
  const img = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === "png" ? img.png().toBuffer() : img.jpeg({ quality: 92 }).toBuffer();
}

async function photoPdf(pages = 3) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Scanned page ${i + 1} - invoice INV-0042 total 1,284.50`, { x: 40, y: 800, size: 14, font });
    const jpg = await pdf.embedJpg(await photo(2400, 1800, i + 1));
    page.drawImage(jpg, { x: 30, y: 250, width: 535, height: 401 });
  }
  return pdf.save();
}

async function screenshot(width, height, seed = 1) {
  let rows = "";
  for (let i = 0; i < 40; i++) rows += `<rect x="40" y="${60 + i * (height / 45)}" width="${width - 80}" height="${height / 60}" fill="hsl(${(seed * 40 + i * 9) % 360},45%,${80 - (i % 4) * 4}%)"/><text x="60" y="${60 + i * (height / 45) + height / 80}" font-size="${Math.round(height / 90)}" font-family="Arial" fill="#222">Row ${i} - quarterly figure ${seed * 1000 + i * 37}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef3fb"/><stop offset="1" stop-color="#cfe0f7"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${rows}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.stack?.split("\n").slice(0, 4).join("\n      ")}`);
  }
}
const KB = 1024;
const MB = 1024 * 1024;
const report = (r) => `${formatBytes(r.originalBytes)} -> ${formatBytes(r.compressedBytes)} (${r.reductionPct}%)`;

// ================================================================================================
console.log("Image");
const bigJpeg = await photo(4000, 3000, 3);
const bigPng = await photo(1600, 1200, 5, "png");
console.log(`  (fixtures: JPEG ${formatBytes(bigJpeg.length)}, PNG ${formatBytes(bigPng.length)})`);
// Kept on disk so the same files can be fed to the app UI in a browser.
fs.writeFileSync(path.join(outDir, "photo.jpg"), bigJpeg);
fs.writeFileSync(path.join(outDir, "photo.png"), bigPng);

await test("quality-only compression makes a large JPEG meaningfully smaller", async () => {
  const r = await compressImage({ data: bigJpeg, mime: "image/jpeg", name: "photo.jpg" }, { level: 3, maxDim: null, target: null, format: "auto" }, deps);
  console.log("      " + report(r));
  assert.ok(r.meaningful && r.compressedBytes < r.originalBytes * 0.8);
  assert.match(r.filename, /photo-compressed\.jpg$/);
});
await test("dimension reduction shrinks pixel size and file", async () => {
  const r = await compressImage({ data: bigJpeg, mime: "image/jpeg", name: "photo.jpg" }, { level: 1, maxDim: 1200, target: null, format: "auto" }, deps);
  const meta = await sharp(r.data).metadata();
  console.log(`      ${report(r)}, ${meta.width}x${meta.height}`);
  assert.equal(Math.max(meta.width, meta.height), 1200);
  assert.ok(r.compressedBytes < r.originalBytes * 0.3);
});
for (const [label, target] of [["500 KB", 500 * KB], ["1 MB", MB], ["2 MB", 2 * MB]]) {
  await test(`target ${label} is reached`, async () => {
    const r = await compressImage({ data: bigJpeg, mime: "image/jpeg", name: "photo.jpg" }, { quality: 0.8, maxDim: null, target, format: "auto" }, deps);
    console.log("      " + report(r));
    assert.equal(r.targetMet, true);
    assert.ok(r.compressedBytes <= target, `${r.compressedBytes} > ${target}`);
    // It should use the room it was given, not crush the image far below the target.
    assert.ok(r.compressedBytes > target * 0.45, "result is much smaller than the target allows");
  });
}
await test("an unreachable target is reported honestly, with the smallest acceptable result", async () => {
  const r = await compressImage({ data: bigJpeg, mime: "image/jpeg", name: "photo.jpg" }, { level: 1, maxDim: null, target: 30 * KB, format: "auto" }, deps);
  console.log("      " + report(r) + " | " + r.notes.join(" | "));
  assert.equal(r.targetMet, false);
  assert.ok(r.compressedBytes > 30 * KB);
});
await test("an already-optimised image is NOT reported as compressed", async () => {
  const once = await compressImage({ data: bigJpeg, mime: "image/jpeg", name: "photo.jpg" }, { level: 3, maxDim: 1400, target: null, format: "auto" }, deps);
  const twice = await compressImage({ data: once.data, mime: "image/jpeg", name: "photo-compressed.jpg" }, { level: 1, maxDim: null, target: null, format: "auto" }, deps);
  console.log("      second pass: " + report(twice) + " meaningful=" + twice.meaningful);
  assert.equal(twice.meaningful, false);
});
await test("PNG with transparency keeps its alpha channel", async () => {
  const alpha = await sharp({ create: { width: 1200, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await photo(600, 450, 7, "png"), left: 300, top: 225 }])
    .png()
    .toBuffer();
  const r = await compressImage({ data: alpha, mime: "image/png", name: "sig.png" }, { level: 2, maxDim: 800, target: null, format: "auto" }, deps);
  const meta = await sharp(r.data).metadata();
  console.log(`      ${report(r)} format=${meta.format} alpha=${meta.hasAlpha}`);
  assert.equal(meta.hasAlpha, true);
  assert.ok(["png", "webp"].includes(meta.format));
});
await test("an invalid image throws a clear error", async () => {
  await assert.rejects(compressImage({ data: new Uint8Array([1, 2, 3, 4]), mime: "image/jpeg", name: "x.jpg" }, { level: 2, maxDim: null, target: null, format: "auto" }, deps), (e) => e instanceof CompressError && e.code === "compress_invalid");
});

// ================================================================================================
console.log("PDF");
const scanPdf = await photoPdf(3);
console.log(`  (fixture: 3-page photo PDF ${formatBytes(scanPdf.length)})`);
fs.writeFileSync(path.join(outDir, "scan.pdf"), scanPdf);

await test("standard compression shrinks a photo-heavy PDF and keeps its text selectable", async () => {
  const r = await compressPdf({ data: scanPdf, name: "scan.pdf" }, { target: null, strong: false, level: 1 }, deps);
  console.log("      " + report(r));
  assert.ok(r.meaningful && r.reductionPct >= 40, `only ${r.reductionPct}%`);
  const file = path.join(outDir, "scan-compressed.pdf");
  fs.writeFileSync(file, r.data);
  const pages = await extractLines(file);
  assert.equal(pages.length, 3, "page count changed");
  assert.match(pages[0].lines.map((l) => l.text).join(" "), /Scanned page 1 - invoice INV-0042 total 1,284\.50/);
});
for (const [label, target] of [["1 MB", MB], ["500 KB", 500 * KB]]) {
  await test(`standard PDF target ${label}`, async () => {
    const r = await compressPdf({ data: scanPdf, name: "scan.pdf" }, { target: target, strong: false, level: 1 }, deps);
    console.log("      " + report(r) + ` targetMet=${r.targetMet}`);
    assert.equal(r.targetMet, true);
    assert.ok(r.compressedBytes <= target);
  });
}
await test("an impossible PDF target is reported, and the stronger option is offered", async () => {
  const r = await compressPdf({ data: scanPdf, name: "scan.pdf" }, { target: 20 * KB, strong: false, level: 1 }, deps);
  console.log("      " + report(r) + ` targetMet=${r.targetMet} strongAvailable=${r.strongAvailable}`);
  assert.equal(r.targetMet, false);
  assert.equal(r.strongAvailable, true);
});
await test("stronger compression reaches a small target and says text is no longer selectable", async () => {
  const r = await compressPdf({ data: scanPdf, name: "scan.pdf" }, { target: 300 * KB, strong: true, level: 1 }, deps);
  console.log("      " + report(r) + ` targetMet=${r.targetMet}`);
  assert.equal(r.targetMet, true);
  assert.ok(r.notes.some((n) => /no longer be selected/i.test(n)));
  const pdf = await PDFDocument.load(r.data);
  assert.equal(pdf.getPageCount(), 3);
});
await test("a text-only PDF is reported as already compact, not 'compressed'", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  page.drawText("Just a little text.", { x: 50, y: 700, size: 14, font });
  const data = await pdf.save();
  const r = await compressPdf({ data, name: "text.pdf" }, { target: null, strong: false, level: 1 }, deps);
  console.log("      " + report(r) + " meaningful=" + r.meaningful);
  assert.equal(r.meaningful, false);
  assert.equal(r.outcome, "negligible");
});
await test("a file that is not a PDF is rejected", async () => {
  await assert.rejects(compressPdf({ data: new TextEncoder().encode("hello, not a pdf"), name: "x.pdf" }, { target: null, strong: false, level: 1 }, deps), (e) => e instanceof CompressError && e.code === "compress_invalid");
});

// ================================================================================================
console.log("Word");
const docxImages = [await photo(3000, 2000, 11), await screenshot(2600, 1800, 12), await photo(2800, 2100, 13)];
const docxBuffer = await docxLib.Packer.toBuffer(
  new docxLib.Document({
    sections: [
      {
        children: [
          new docxLib.Paragraph({ heading: docxLib.HeadingLevel.HEADING_1, children: [new docxLib.TextRun("Site survey report")] }),
          new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: "Formatted text must survive compression untouched.", bold: true, size: 26 })] }),
          new docxLib.Paragraph({ children: [new docxLib.ImageRun({ type: "jpg", data: docxImages[0], transformation: { width: 460, height: 307 } })] }),
          new docxLib.Paragraph({ children: [new docxLib.ImageRun({ type: "png", data: docxImages[1], transformation: { width: 400, height: 277 } })] }),
          new docxLib.Table({
            rows: [new docxLib.TableRow({ children: [new docxLib.TableCell({ children: [new docxLib.Paragraph("Cell A")] }), new docxLib.TableCell({ children: [new docxLib.Paragraph("Cell B")] })] })],
          }),
          new docxLib.Paragraph({ children: [new docxLib.ImageRun({ type: "jpg", data: docxImages[2], transformation: { width: 430, height: 322 } })] }),
        ],
      },
    ],
  }),
);
fs.writeFileSync(path.join(outDir, "survey.docx"), docxBuffer);
console.log(`  (fixture: ${formatBytes(docxBuffer.length)})`);

async function readXml(zipData, name) {
  const z = await JSZip.loadAsync(zipData);
  return z.file(name).async("string");
}

await test("Word: pictures shrink; document.xml and every other XML part are byte-identical", async () => {
  const r = await compressOoxml({ data: new Uint8Array(docxBuffer), name: "survey.docx" }, "word", { target: null, level: 1 }, deps);
  console.log("      " + report(r) + " | " + r.notes[0]);
  assert.ok(r.meaningful && r.reductionPct >= 30);
  const a = await JSZip.loadAsync(docxBuffer);
  const b = await JSZip.loadAsync(r.data);
  assert.deepEqual(Object.keys(b.files), Object.keys(a.files), "the package has different entries or order");
  for (const name of Object.keys(a.files)) {
    if (a.files[name].dir || /\.(png|jpe?g)$/i.test(name)) continue;
    assert.equal(await b.file(name).async("string"), await a.file(name).async("string"), `${name} changed`);
  }
  // Pictures keep their names and formats.
  for (const name of Object.keys(a.files).filter((n) => /media\//.test(n) && !a.files[n].dir)) {
    const before = await sharp(await a.file(name).async("nodebuffer")).metadata();
    const after = await sharp(await b.file(name).async("nodebuffer")).metadata();
    assert.equal(after.format, before.format, `${name} changed format`);
  }
  fs.writeFileSync(path.join(outDir, "survey-compressed.docx"), r.data);
});
await test("Word: target 500 KB / 1 MB", async () => {
  for (const target of [500 * KB, MB]) {
    const r = await compressOoxml({ data: new Uint8Array(docxBuffer), name: "survey.docx" }, "word", { target }, deps);
    console.log(`      target ${formatBytes(target)}: ${report(r)} targetMet=${r.targetMet}`);
    assert.equal(r.targetMet, true);
  }
});
await test("Word: a text-only document is reported as already compact", async () => {
  const data = await docxLib.Packer.toBuffer(new docxLib.Document({ sections: [{ children: [new docxLib.Paragraph("Hello")] }] }));
  const r = await compressOoxml({ data: new Uint8Array(data), name: "hello.docx" }, "word", { target: null, level: 1 }, deps);
  console.log("      " + report(r) + " meaningful=" + r.meaningful + " | " + r.notes[0]);
  assert.equal(r.meaningful, false);
  assert.match(r.notes[0], /no pictures/);
});
await test("Word: a zip that is not a Word document is rejected", async () => {
  const z = new JSZip();
  z.file("hello.txt", "hi");
  const data = await z.generateAsync({ type: "uint8array" });
  await assert.rejects(compressOoxml({ data, name: "x.docx" }, "word", { target: null, level: 1 }, deps), (e) => e instanceof CompressError && e.code === "compress_invalid");
  await assert.rejects(compressOoxml({ data: new TextEncoder().encode("not a zip"), name: "x.docx" }, "word", { target: null, level: 1 }, deps), (e) => e instanceof CompressError);
});

// ================================================================================================
console.log("Excel");
const wb = new ExcelJS.Workbook();
const s1 = wb.addWorksheet("Sales");
s1.columns = [{ header: "Item", key: "i", width: 18 }, { header: "Qty", key: "q", width: 10 }, { header: "Price", key: "p", width: 12 }, { header: "Total", key: "t", width: 14 }];
for (let r = 2; r <= 9; r++) {
  s1.addRow({ i: `Item ${r}`, q: r * 3, p: 9.5 + r });
  s1.getCell(`D${r}`).value = { formula: `B${r}*C${r}`, result: r * 3 * (9.5 + r) };
}
s1.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" } };
s1.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
s1.mergeCells("F1:H1");
s1.getCell("F1").value = "Merged title";
s1.getCell("D2").numFmt = "#,##0.00";
const s2 = wb.addWorksheet("Notes");
s2.getCell("A1").value = "Second sheet";
for (const [idx, [w, h, seed, fmt]] of [[2400, 1600, 21, "jpeg"], [2000, 1400, 22, "png"]].entries()) {
  const id = wb.addImage({ buffer: fmt === "jpeg" ? await photo(w, h, seed, fmt) : await screenshot(w, h, seed), extension: fmt === "jpeg" ? "jpeg" : "png" });
  s1.addImage(id, { tl: { col: 5, row: 3 + idx * 20 }, ext: { width: 480, height: 320 } });
}
const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());
fs.writeFileSync(path.join(outDir, "sales.xlsx"), xlsxBuffer);
console.log(`  (fixture: ${formatBytes(xlsxBuffer.length)})`);

await test("Excel: pictures shrink; formulas, values, styles, merges and sheets are preserved", async () => {
  const r = await compressOoxml({ data: new Uint8Array(xlsxBuffer), name: "sales.xlsx" }, "excel", { target: null, level: 1 }, deps);
  console.log("      " + report(r) + " | " + r.notes[0]);
  assert.ok(r.meaningful && r.reductionPct >= 30);
  const before = new ExcelJS.Workbook();
  await before.xlsx.load(xlsxBuffer);
  const after = new ExcelJS.Workbook();
  await after.xlsx.load(Buffer.from(r.data));
  assert.deepEqual(after.worksheets.map((w) => w.name), before.worksheets.map((w) => w.name));
  const a = before.getWorksheet("Sales");
  const b = after.getWorksheet("Sales");
  for (let row = 1; row <= 9; row++) {
    for (let col = 1; col <= 4; col++) {
      const ca = a.getCell(row, col);
      const cb = b.getCell(row, col);
      assert.deepEqual(cb.value, ca.value, `cell ${ca.address} value/formula changed`);
      assert.deepEqual(cb.style, ca.style, `cell ${ca.address} style changed`);
    }
  }
  assert.equal(b.getCell("D3").value.formula, "B3*C3");
  assert.equal(b.getCell("D2").numFmt, "#,##0.00");
  assert.deepEqual(Object.keys(b._merges), Object.keys(a._merges));
  assert.equal(b.getImages().length, a.getImages().length, "picture count changed");
  fs.writeFileSync(path.join(outDir, "sales-compressed.xlsx"), r.data);
});
await test("Excel: target 500 KB", async () => {
  const r = await compressOoxml({ data: new Uint8Array(xlsxBuffer), name: "sales.xlsx" }, "excel", { target: 500 * KB, level: 1 }, deps);
  console.log("      " + report(r) + ` targetMet=${r.targetMet}`);
  assert.equal(r.targetMet, true);
});
await test("Excel: a workbook without pictures is reported as already compact", async () => {
  const plain = new ExcelJS.Workbook();
  plain.addWorksheet("A").getCell("A1").value = "x";
  const data = new Uint8Array(await plain.xlsx.writeBuffer());
  const r = await compressOoxml({ data, name: "plain.xlsx" }, "excel", { target: null, level: 1 }, deps);
  assert.equal(r.meaningful, false);
});

// ================================================================================================
console.log("Levels: each slider step must do what it says");

// The percentage on screen must equal (original - compressed) / original.
function assertMath(r) {
  const exact = (100 * (r.originalBytes - r.compressedBytes)) / r.originalBytes;
  assert.ok(Math.abs(r.reductionPct - Math.max(0, exact)) <= 0.05, `shows ${r.reductionPct}% but the sizes give ${exact.toFixed(2)}%`);
}
const sizes = (rs) => rs.map((r) => r.compressedBytes);
const nonIncreasing = (xs) => xs.every((x, i) => i === 0 || x <= xs[i - 1]);
const LEVELS = COMPRESSION_LEVELS.map((_, i) => i);
const row = (rs) => rs.map((r, i) => `${COMPRESSION_LEVELS[i].short} ${formatBytes(r.compressedBytes)}`).join(" | ");

// Longest side of every picture inside a PDF.
async function pdfPictureSides(data) {
  const pdf = await PDFDocument.load(data);
  const sides = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    sides.push(Math.max(obj.dict.get(PDFName.of("Width")).asNumber(), obj.dict.get(PDFName.of("Height")).asNumber()));
  }
  return sides;
}

await test("image: five levels give a smaller file each step, with the caps each level promises", async () => {
  const rs = [];
  for (const level of LEVELS) rs.push(await compressImage({ data: bigJpeg, mime: "image/jpeg", name: "photo.jpg" }, { level, maxDim: null, target: null, format: "auto" }, deps));
  console.log("      " + row(rs));
  for (const r of rs) assertMath(r);
  assert.ok(nonIncreasing(sizes(rs)), "sizes must not grow as compression increases");
  assert.ok(sizes(rs)[0] > sizes(rs)[4] * 1.5, "Low and Maximum should be clearly different");
  for (const [i, r] of rs.entries()) {
    const meta = await sharp(r.data).metadata();
    const cap = COMPRESSION_LEVELS[i].image.maxDim;
    const side = Math.max(meta.width, meta.height);
    assert.equal(side, cap === null ? 4000 : Math.min(cap, 4000), `level ${i} long side`);
    assert.equal(r.levelIndex, i);
    assert.equal(r.mode, "level");
  }
});

await test("PDF: sizes fall with each level, picture caps hold, text stays selectable, page count is kept", async () => {
  const rs = [];
  for (const level of LEVELS) rs.push(await compressPdf({ data: scanPdf, name: "scan.pdf" }, { target: null, strong: false, level }, deps));
  console.log("      " + row(rs));
  assert.ok(nonIncreasing(sizes(rs)));
  for (const [i, r] of rs.entries()) {
    assertMath(r);
    assert.equal(r.levelIndex, i);
    const sides = await pdfPictureSides(r.data);
    assert.ok(sides.length === 3 && sides.every((s) => s <= COMPRESSION_LEVELS[i].embedded.maxDim), `level ${i}: pictures ${sides}`);
    const file = path.join(outDir, `scan-level${i + 1}.pdf`);
    fs.writeFileSync(file, r.data);
    const pages = await extractLines(file);
    assert.equal(pages.length, 3, `level ${i} page count`);
    assert.match(pages[2].lines.map((l) => l.text).join(" "), /Scanned page 3 - invoice INV-0042/);
  }
});

await test("Word: sizes fall with each level and the XML stays byte-identical at every level", async () => {
  const a = await JSZip.loadAsync(docxBuffer);
  const rs = [];
  for (const level of LEVELS) {
    const r = await compressOoxml({ data: new Uint8Array(docxBuffer), name: "survey.docx" }, "word", { target: null, level }, deps);
    rs.push(r);
    const b = await JSZip.loadAsync(r.data);
    for (const name of Object.keys(a.files)) {
      if (a.files[name].dir || /\.(png|jpe?g)$/i.test(name)) continue;
      assert.equal(await b.file(name).async("string"), await a.file(name).async("string"), `level ${level}: ${name} changed`);
    }
    fs.writeFileSync(path.join(outDir, `survey-level${level + 1}.docx`), r.data);
  }
  console.log("      " + row(rs));
  rs.forEach(assertMath);
  assert.ok(nonIncreasing(sizes(rs)));
});

await test("Excel: sizes fall with each level", async () => {
  const rs = [];
  for (const level of LEVELS) {
    const r = await compressOoxml({ data: new Uint8Array(xlsxBuffer), name: "sales.xlsx" }, "excel", { target: null, level }, deps);
    rs.push(r);
    fs.writeFileSync(path.join(outDir, `sales-level${level + 1}.xlsx`), r.data);
  }
  console.log("      " + row(rs));
  rs.forEach(assertMath);
  assert.ok(nonIncreasing(sizes(rs)));
});

console.log("Estimates: shown before compressing, then replaced by the exact figure");

function checkEstimates(label, analysis, actuals, tolerance) {
  assert.equal(analysis.estimates.length, 5);
  const rows = analysis.estimates.map((est, i) => {
    const err = (est - actuals[i]) / actuals[i];
    return `${COMPRESSION_LEVELS[i].short}: est ${formatBytes(est)} vs ${formatBytes(actuals[i])} (${err >= 0 ? "+" : ""}${(err * 100).toFixed(1)}%)`;
  });
  console.log(`      ${label}: ${rows.join(" | ")}`);
  analysis.estimates.forEach((est, i) => assert.ok(Math.abs(est - actuals[i]) / actuals[i] <= tolerance, `${label} level ${i} estimate is off by more than ${tolerance * 100}%`));
  assert.ok(nonIncreasing(analysis.estimates), "estimates must not grow with the level");
}

await test("image estimate matches the real result", async () => {
  const analysis = await analyzeImage({ data: bigJpeg, mime: "image/jpeg" }, { maxDim: null, format: "auto" }, deps);
  const actual = [];
  for (const level of LEVELS) actual.push((await compressImage({ data: bigJpeg, mime: "image/jpeg", name: "p.jpg" }, { level, maxDim: null, target: null, format: "auto" }, deps)).compressedBytes);
  checkEstimates("image", analysis, actual, 0.02);
});

await test("PDF estimate is within 15% of the real result", async () => {
  const analysis = await analyzePdf(scanPdf, deps);
  const actual = [];
  for (const level of LEVELS) actual.push((await compressPdf({ data: scanPdf, name: "s.pdf" }, { target: null, strong: false, level }, deps)).compressedBytes);
  assert.equal(analysis.pictureCount, 3);
  checkEstimates("pdf", analysis, actual, 0.15);
});

await test("PDF with many pictures: the sampled estimate stays close", async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 12; i++) {
    const page = pdf.addPage([595, 842]);
    const jpg = await pdf.embedJpg(await photo(1800 + (i % 4) * 200, 1300 + (i % 3) * 150, 40 + i));
    page.drawImage(jpg, { x: 20, y: 200, width: 555, height: 420 });
  }
  const data = await pdf.save();
  const analysis = await analyzePdf(data, deps);
  const actual = [];
  for (const level of LEVELS) actual.push((await compressPdf({ data, name: "m.pdf" }, { target: null, strong: false, level }, deps)).compressedBytes);
  assert.equal(analysis.pictureCount, 12);
  checkEstimates("12 pictures", analysis, actual, 0.15);
});

await test("Word estimate is within 15%", async () => {
  const analysis = await analyzeOoxml(new Uint8Array(docxBuffer), "word", deps);
  const actual = [];
  for (const level of LEVELS) actual.push((await compressOoxml({ data: new Uint8Array(docxBuffer), name: "s.docx" }, "word", { target: null, level }, deps)).compressedBytes);
  checkEstimates("word", analysis, actual, 0.15);
});

await test("Excel estimate is within 15%", async () => {
  const analysis = await analyzeOoxml(new Uint8Array(xlsxBuffer), "excel", deps);
  const actual = [];
  for (const level of LEVELS) actual.push((await compressOoxml({ data: new Uint8Array(xlsxBuffer), name: "s.xlsx" }, "excel", { target: null, level }, deps)).compressedBytes);
  checkEstimates("excel", analysis, actual, 0.15);
});

await test("a mostly-text PDF: no pictures found, every level gives the same size, text intact", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 8; p++) {
    const page = pdf.addPage();
    for (let l = 0; l < 40; l++) page.drawText(`Line ${l} of page ${p}: the quick brown fox jumps over the lazy dog ${p * l}`, { x: 40, y: 800 - l * 18, size: 10, font });
  }
  const data = await pdf.save({ useObjectStreams: false });
  const analysis = await analyzePdf(data, deps);
  const real = await compressPdf({ data, name: "text.pdf" }, { target: null, strong: false, level: 4 }, deps);
  console.log(`      ${formatBytes(data.length)} -> est ${formatBytes(analysis.estimates[4])}, real ${formatBytes(real.compressedBytes)}, pictures ${analysis.pictureCount}`);
  assert.equal(analysis.pictureCount, 0);
  assert.ok(new Set(analysis.estimates).size === 1, "no pictures means every level is the same");
  assert.equal(analysis.estimates[4], real.compressedBytes);
  const file = path.join(outDir, "text-out.pdf");
  fs.writeFileSync(file, real.data);
  const pages = await extractLines(file);
  assert.equal(pages.length, 8);
  assert.match(pages[7].lines[0].text, /Line 0 of page 7/);
});

console.log("Edge cases");

await test("a result larger than the original is refused: the original comes back and no reduction is claimed", async () => {
  // Already squeezed hard, so re-encoding at Low (90% quality) can only grow it.
  const squeezed = await sharp(await photo(1600, 1200, 9)).jpeg({ quality: 30 }).toBuffer();
  const r = await compressImage({ data: squeezed, mime: "image/jpeg", name: "small.jpg" }, { level: 0, maxDim: null, target: null, format: "auto" }, deps);
  console.log(`      original ${formatBytes(squeezed.length)}, attempt ${formatBytes(r.compressedBytes)}, outcome=${r.outcome}`);
  assert.equal(r.outcome, "larger");
  assert.equal(r.meaningful, false);
  assert.equal(r.reductionPct, 0);
  assert.equal(Buffer.compare(Buffer.from(r.data), squeezed), 0, "the original bytes are returned");
  assert.equal(r.filename, "small.jpg");
  assert.ok(r.compressedBytes > squeezed.length, "the attempt's real (larger) size is reported");
});

await test("an already well-compressed PDF is not reported as reduced, and its own bytes come back", async () => {
  const once = await compressPdf({ data: scanPdf, name: "scan.pdf" }, { target: null, strong: false, level: 4 }, deps);
  const again = await compressPdf({ data: once.data, name: "scan-compressed.pdf" }, { target: null, strong: false, level: 4 }, deps);
  console.log(`      second pass ${formatBytes(again.originalBytes)} -> ${formatBytes(again.compressedBytes)} outcome=${again.outcome}`);
  assert.notEqual(again.outcome, "reduced");
  assert.equal(again.data.length, once.data.length);
});

await test("a tiny file is not presented as compressed", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("hi");
  const data = await pdf.save();
  const r = await compressPdf({ data, name: "tiny.pdf" }, { target: null, strong: false, level: 4 }, deps);
  assert.equal(r.meaningful, false);
  assert.equal(r.data.length, data.length);
});

await test("a password-protected PDF is refused with the password error, by analysis and by compression", async () => {
  // pdf-lib can't encrypt, but it refuses any file whose trailer has /Encrypt,
  // which is exactly what a protected PDF looks like to it.
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("secret");
  const encrypt = pdf.context.register(pdf.context.obj({ Filter: "Standard", V: 1, R: 2, O: PDFString.of("x".repeat(32)), U: PDFString.of("y".repeat(32)), P: -4 }));
  pdf.context.trailerInfo.Encrypt = encrypt;
  const data = await pdf.save({ useObjectStreams: false });
  await assert.rejects(analyzePdf(data, deps), (e) => e instanceof CompressError && e.code === "compress_password");
  await assert.rejects(compressPdf({ data, name: "locked.pdf" }, { target: null, strong: false, level: 1 }, deps), (e) => e instanceof CompressError && e.code === "compress_password");
});

await test("hidden extras (XMP metadata, thumbnails, private data) are dropped; pages, text and document info survive", async () => {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Quarterly report");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText("Visible page text", { x: 50, y: 700, size: 14, font });
  const jpg = await pdf.embedJpg(await photo(2000, 1500, 60));
  page.drawImage(jpg, { x: 30, y: 200, width: 535, height: 401 });
  const xmp = pdf.context.stream("<?xpacket begin='x'?><x:xmpmeta>" + "metadata ".repeat(400) + "</x:xmpmeta>", { Type: "Metadata", Subtype: "XML" });
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(xmp));
  const thumb = pdf.context.stream(new Uint8Array(20000).fill(7), { Width: 100, Height: 100 });
  page.node.set(PDFName.of("Thumb"), pdf.context.register(thumb));
  pdf.catalog.set(PDFName.of("PieceInfo"), pdf.context.obj({ App: { LastModified: PDFString.of("D:2020") } }));
  const data = await pdf.save({ useObjectStreams: false });
  const r = await compressPdf({ data, name: "meta.pdf" }, { target: null, strong: false, level: 1 }, deps);
  const out = await PDFDocument.load(r.data);
  assert.equal(out.catalog.get(PDFName.of("Metadata")), undefined);
  assert.equal(out.catalog.get(PDFName.of("PieceInfo")), undefined);
  assert.equal(out.getPage(0).node.get(PDFName.of("Thumb")), undefined);
  assert.equal(out.getTitle(), "Quarterly report");
  assert.equal(out.getPageCount(), 1);
  assert.ok(![...out.context.enumerateIndirectObjects()].some(([, o]) => o.contents?.length === 20000), "the thumbnail stream is gone, not just unlinked");
  const file = path.join(outDir, "meta-out.pdf");
  fs.writeFileSync(file, r.data);
  const pages = await extractLines(file);
  assert.match(pages[0].lines.map((l) => l.text).join(" "), /Visible page text/);
  assert.ok(r.notes.some((n) => /hidden extras/i.test(n)));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
