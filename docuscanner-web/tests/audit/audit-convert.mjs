// Audit part 2: converters, compression, protection and OCR, measured on the real downloaded files.
//   node tests/audit/audit-convert.mjs [baseUrl]     (needs `npm run start`)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { BASE, CHROME, chromium, embeddedStreams, newPage, pdfReport, record, results, saveDownload, visit, work } from "./lib.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const ExcelJS = require("exceljs");
const here = path.dirname(fileURLToPath(import.meta.url));
const C = (n) => path.join(here, "corpus", n);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const safe = async (feature, input, fn) => {
  try {
    await fn();
  } catch (e) {
    record({ status: "ERROR", feature, input, output: "-", summary: String(e).slice(0, 400) });
  }
};

async function docxText(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml").async("string");
  const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
  const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/"));
  return { text, paragraphs: (xml.match(/<w:p[ >]/g) ?? []).length, tables: (xml.match(/<w:tbl>/g) ?? []).length, media, headings: (xml.match(/w:pStyle w:val="(Heading|Title)/g) ?? []).length };
}

// ---------- Word -> PDF ----------
await safe("Word to PDF", "document.docx", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/convert/word-to-pdf");
  await page.locator('input[type="file"]').setInputFiles(C("document.docx"));
  const dl = await saveDownload(page, async () => page.locator('[data-assistant-id="convert-download"]').click({ timeout: 120000 }), "word.pdf");
  const markers = ["DOCX-TITLE", "DOCX-P01", "DOCX-P12", "DOCX-H1", "TBL-R0C0", "TBL-R3C2", "DOCX-P13", "DOCX-P30", "é", "ü"];
  const rep = await pdfReport(dl.file, markers);
  const img = rep.pages.flatMap((p) => p.images)[0];
  record({
    status: rep.markersFound === rep.markersTotal && rep.textChars > 0 ? "ok" : "FINDING", feature: "Word to PDF", input: "document.docx (30 paragraphs, heading, 4x3 table, 1600x1200 JPEG, page break, accents)", output: `PDF ${kb(rep.bytes)}`,
    summary: `${rep.pageCount} page(s) ${rep.pages[0].widthMm}x${rep.pages[0].heightMm} mm; selectable text ${rep.textChars} chars; markers ${rep.markersFound}/${rep.markersTotal} (missing: ${JSON.stringify(rep.missing)}); vector path ops ${rep.pages.map((p) => p.pathOps).join("/")}; image ${img ? `${img.px.join("x")} drawn ${img.wMm}x${img.hMm} mm @ ${img.dpi} dpi` : "none found"}`,
    data: { pages: rep.pageCount, text: rep.textChars, markers: `${rep.markersFound}/${rep.markersTotal}`, image: img },
  });
  await context.close();
});

// ---------- Excel -> PDF ----------
await safe("Excel to PDF", "workbook.xlsx", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/convert/excel-to-pdf");
  await page.locator('input[type="file"]').setInputFiles(C("workbook.xlsx"));
  await page.getByRole("button", { name: "Convert to PDF" }).click({ timeout: 60000 });
  const dl = await saveDownload(page, async () => page.locator('[data-assistant-id="convert-download"]').click({ timeout: 120000 }), "excel.pdf");
  const markers = ["XLSX-Item", "Item 1", "Item 15", "Merged heading", "XLSX-S2", "Second sheet value", "42", "Total"];
  const rep = await pdfReport(dl.file, markers);
  // Value check: the first formula result and the grand total as they should print.
  const expectedTotal = Array.from({ length: 15 }, (_, i) => (i + 1) * 3 * (9.99 + i + 1)).reduce((a, b) => a + b, 0);
  const hasRowTotal = rep.allText.includes((3 * 10.99).toFixed(2)) || rep.allText.includes("32.97");
  record({
    status: rep.markersFound === rep.markersTotal ? "ok" : "FINDING", feature: "Excel to PDF", input: "workbook.xlsx (formats, formulas, merged cell, 2 sheets; chart not generated)", output: `PDF ${kb(rep.bytes)}`,
    summary: `${rep.pageCount} page(s) ${rep.pages[0].widthMm}x${rep.pages[0].heightMm} mm ${rep.pages[0].orientation}; selectable text ${rep.textChars}; markers ${rep.markersFound}/${rep.markersTotal} (missing: ${JSON.stringify(rep.missing)}); first formula value printed: ${hasRowTotal}; grand total expected ${expectedTotal.toFixed(2)} found: ${rep.allText.includes(expectedTotal.toFixed(2)) || rep.allText.includes(Math.round(expectedTotal).toLocaleString("en-US"))}; vector ops p1 ${rep.pages[0].pathOps}`,
    data: { pages: rep.pageCount, text: rep.textChars, markers: `${rep.markersFound}/${rep.markersTotal}`, sample: rep.allText.replace(/\s+/g, " ").slice(0, 300) },
  });
  await context.close();
});

// ---------- PDF -> Word ----------
for (const [fixture, markers, label] of [["text.pdf", ["TXT-P1-L01", "TXT-P2-L24", "TXT-P3-L48", "R1C1"], "text PDF"], ["scan.pdf", ["SCAN-TITLE", "SCAN-L01", "SCAN-L12", "SCAN-L24"], "scanned PDF (OCR)"]]) {
  await safe("PDF to Word", fixture, async () => {
    const { context, page } = await newPage(browser);
    await visit(page, "/convert/pdf-to-word");
    await page.locator('input[type="file"]').setInputFiles(C(fixture));
    await page.getByRole("button", { name: "Convert to Word" }).click({ timeout: 60000 });
    const dl = await saveDownload(page, async () => page.locator('[data-assistant-id="convert-download"]').click({ timeout: 280000 }), `pdf2word-${fixture}.docx`);
    const d = await docxText(dl.file);
    const found = markers.filter((m) => d.text.includes(m));
    record({
      status: found.length === markers.length ? "ok" : "FINDING", feature: "PDF to Word", input: `${fixture} (${label})`, output: `DOCX ${kb(fs.statSync(dl.file).size)}`,
      summary: `text ${d.text.length} chars; markers ${found.length}/${markers.length}; paragraphs ${d.paragraphs}; tables ${d.tables}; headings ${d.headings}; embedded pictures ${d.media.length}; editable text: ${d.text.length > 0}`,
      data: { markers: `${found.length}/${markers.length}`, chars: d.text.length, paragraphs: d.paragraphs, tables: d.tables, media: d.media.length, sample: d.text.slice(0, 200) },
    });
    await context.close();
  });
}

// ---------- PDF -> Excel ----------
await safe("PDF to Excel", "table.pdf", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/convert/pdf-to-excel");
  await page.locator('input[type="file"]').setInputFiles(C("table.pdf"));
  await page.getByRole("button", { name: "Convert to Excel" }).click({ timeout: 60000 });
  const dl = await saveDownload(page, async () => page.locator('[data-assistant-id="convert-download"]').click({ timeout: 180000 }), "table.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(dl.file);
  const rows = [];
  wb.eachSheet((ws) => ws.eachRow((r) => rows.push(r.values.slice(1))));
  const flat = JSON.stringify(rows);
  const numeric = rows.flat().filter((v) => typeof v === "number").length;
  const expected = ["North", "1500", "1350", "960", "Region"];
  record({
    status: expected.every((e) => flat.includes(e)) && numeric >= 12 ? "ok" : "FINDING", feature: "PDF to Excel", input: "table.pdf (5x4 table, numbers)", output: `XLSX ${kb(fs.statSync(dl.file).size)}`,
    summary: `${rows.length} rows; numeric cells ${numeric}/16 expected; values ${flat.slice(0, 220)}`,
    data: { rows: rows.length, numeric },
  });
  await context.close();
});

// ---------- Compress PDF ----------
async function compressPdf(fixture, markers) {
  const { context, page } = await newPage(browser);
  await visit(page, "/tools/compress-pdf");
  await page.locator('input[type="file"]').setInputFiles(C(fixture));
  await page.locator('[data-assistant-id="compress-start"]').click({ timeout: 60000 });
  const dl = await saveDownload(page, async () => page.locator('[data-assistant-id="compress-download"]').click({ timeout: 280000 }), `compressed-${fixture}`);
  const src = await pdfReport(C(fixture), markers);
  const out = await pdfReport(dl.file, markers);
  const note = await page.evaluate(() => document.body.innerText.match(/Download (compressed|original) file/)?.[0]);
  await context.close();
  return { src, out, note };
}
for (const [fixture, markers] of [["text.pdf", ["TXT-P1-L01", "TXT-P3-L48"]], ["vector.pdf", ["VEC-P1", "VEC-P2"]], ["scan.pdf", []]]) {
  await safe("Compress PDF", fixture, async () => {
    const { src, out, note } = await compressPdf(fixture, markers);
    record({
      status: out.textChars < src.textChars * 0.9 || out.pages.some((p, i) => p.pathOps < src.pages[i].pathOps * 0.5) ? "FINDING" : "ok", feature: "Compress PDF (default level)", input: `${fixture} ${kb(src.bytes)}, text ${src.textChars}, vector ops p1 ${src.pages[0].pathOps}`, output: `PDF ${kb(out.bytes)} (${note})`,
      summary: `pages ${out.pageCount}/${src.pageCount}; text ${out.textChars} (markers ${out.markersFound}/${out.markersTotal}); vector ops p1 ${out.pages[0].pathOps}; page ${out.pages[0].widthMm}x${out.pages[0].heightMm} mm (source ${src.pages[0].widthMm}x${src.pages[0].heightMm}); images ${out.pages[0].images.map((i) => `${i.px.join("x")}@${i.dpi}dpi`).join(",")} (source ${src.pages[0].images.map((i) => `${i.px.join("x")}@${i.dpi}dpi`).join(",") || "none"})`,
      data: { src: { bytes: src.bytes, text: src.textChars }, out: { bytes: out.bytes, text: out.textChars, images: out.pages[0].images } },
    });
  });
}

// ---------- Compress image ----------
await safe("Compress image", "photo-hi.jpg", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/tools/compress-image");
  await page.locator('input[type="file"]').setInputFiles(C("photo-hi.jpg"));
  await page.locator('[data-assistant-id="compress-start"]').click({ timeout: 60000 });
  const dl = await saveDownload(page, async () => page.locator('[data-assistant-id="compress-download"]').click({ timeout: 180000 }), "compressed.jpg");
  const { loadImage } = await import("./lib.mjs");
  const img = await loadImage(fs.readFileSync(dl.file));
  record({ status: "info", feature: "Compress image (default level)", input: "photo-hi.jpg 4000x3000 4705 KB", output: `${dl.suggested} ${kb(fs.statSync(dl.file).size)}`, summary: `output ${img.width}x${img.height}; size ${kb(fs.statSync(dl.file).size)} (from 4705 KB)` });
  await context.close();
});

// ---------- Protect PDF ----------
await safe("Protect PDF", "text.pdf + vector.pdf", async () => {
  for (const fixture of ["text.pdf", "vector.pdf"]) {
    const { context, page } = await newPage(browser);
    await visit(page, "/tools/protect-pdf");
    await page.locator('input[type="file"]').setInputFiles(C(fixture));
    await page.getByRole("textbox", { name: "Password to open the PDF" }).fill("Audit-pass-123");
    await page.getByRole("textbox", { name: "Confirm password" }).fill("Audit-pass-123");
    await page.locator('[data-assistant-id="protect-submit"]').click();
    const dl = await saveDownload(page, async () => page.locator('[data-assistant-id="protect-download"]').click({ timeout: 120000 }), `protected-${fixture}`);
    const pdfjs = (await import("./lib.mjs")).pdfjs;
    const data = new Uint8Array(fs.readFileSync(dl.file));
    let opened = "no";
    try {
      await pdfjs.getDocument({ data: data.slice(), verbosity: 0 }).promise;
      opened = "opened without password (NOT protected)";
    } catch (e) {
      opened = `needs password (${e.name})`;
    }
    const task = pdfjs.getDocument({ data, password: "Audit-pass-123", verbosity: 0 });
    const doc = await task.promise;
    const p1 = await doc.getPage(1);
    const text = (await p1.getTextContent()).items.map((i) => i.str).join(" ");
    record({ status: opened.startsWith("needs") && text.length > 50 ? "ok" : "FINDING", feature: "Protect PDF", input: fixture, output: `PDF ${kb(fs.statSync(dl.file).size)} (source ${kb(fs.statSync(C(fixture)).size)})`, summary: `${opened}; with password: ${doc.numPages} pages, page 1 text ${text.length} chars (source keeps its text layer: ${text.length > 0})` });
    await doc.destroy();
    await context.close();
  }
});

// ---------- OCR via the Scan workspace TXT export ----------
await safe("OCR (scan export TXT)", "scan.jpg", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(C("scan.jpg"));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  const t0 = Date.now();
  const dl = await saveDownload(page, async () => page.getByRole("button", { name: "TXT", exact: true }).click(), "ocr.txt");
  const text = fs.readFileSync(dl.file, "utf8");
  const expectedLines = Array.from({ length: 24 }, (_, i) => `SCAN-L${String(i + 1).padStart(2, "0")}`);
  const ids = expectedLines.filter((id) => text.includes(id));
  const words = ["quick", "brown", "jumps", "liquor", "jugs", "amount", "November", "1234.56"];
  const wordsFound = words.filter((w) => text.includes(w));
  record({ status: ids.length >= 20 ? "ok" : "FINDING", feature: "OCR text export", input: "scan.jpg (A4 @ 200 dpi: 22 px and 30 px text, 24 lines)", output: `TXT ${text.length} chars`, summary: `line IDs recognised ${ids.length}/24; key words ${wordsFound.length}/${words.length}; ${((Date.now() - t0) / 1000).toFixed(0)}s; sample: ${text.replace(/\s+/g, " ").slice(0, 200)}`, data: { ids: ids.length, words: wordsFound.length } });
  await context.close();
});

await browser.close();
fs.writeFileSync(path.join(here, "results-convert.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length} measurements saved to tests/audit/results-convert.json`);
