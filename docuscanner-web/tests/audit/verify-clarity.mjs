// Output clarity of edited documents, measured on the DOWNLOADED PDF.
//
//  A. A picture page (an uploaded photo of a document, phone-message sized) with typed text and a signature:
//     the page picture must stay the original bytes (no extra JPEG generation), the typed text must be real
//     PDF text and the signature must be embedded at its own resolution, not painted into the page picture.
//  B. A PDF that carries restrictions (encrypted with an empty open password, as bank statements and
//     official forms often are): the page must not come out as the ~170 dpi on-screen picture.
//  C. A photographed signature on greyish paper: the paper must become fully transparent and the ink solid.
//
//   node tests/audit/verify-clarity.mjs [baseUrl] [--measure]     (needs `npm run start`)
//   --measure prints the numbers without asserting (used to record the state before a fix).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CHROME, chromium, createCanvas, embeddedStreams, loadImage, newPage, pdfReport, renderPage, saveDownload, visit, work } from "./lib.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const MEASURE = process.argv.includes("--measure");
let pass = 0;
let failed = 0;
function check(condition, name) {
  if (condition) {
    pass++;
    console.log("  ok  " + name);
  } else if (MEASURE) {
    console.log("  --  " + name);
  } else {
    failed++;
    console.log("  FAIL " + name);
  }
}

// ---- fixtures --------------------------------------------------------------------------------------
// A photographed document as a messaging app delivers it: 1000 x 1414 px, JPEG.
function makeDocPhoto() {
  const c = createCanvas(1000, 1414);
  const x = c.getContext("2d");
  x.fillStyle = "#f4f1ea";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#1c1c1c";
  x.font = "bold 34px Arial";
  x.fillText("TENANCY AGREEMENT", 80, 110);
  x.font = "19px Arial";
  for (let i = 0; i < 9; i++) x.fillText(`Clause ${i + 1}. The tenant shall keep the premises in good and clean condition at all times.`, 80, 180 + i * 30);
  x.fillRect(80, 1180, 380, 2);
  x.fillText("Signature", 80, 1210);
  const file = path.join(work, "doc-photo.jpg");
  fs.writeFileSync(file, c.toBuffer("image/jpeg", 88));
  return file;
}

// A signature pen stroke path, reused for the drawn and the photographed signature.
function strokeSignature(x, scale, colour, width) {
  x.strokeStyle = colour;
  x.lineWidth = width;
  x.lineCap = "round";
  x.lineJoin = "round";
  x.beginPath();
  x.moveTo(40 * scale, 150 * scale);
  x.bezierCurveTo(110 * scale, 10 * scale, 150 * scale, 190 * scale, 220 * scale, 70 * scale);
  x.bezierCurveTo(260 * scale, 10 * scale, 300 * scale, 180 * scale, 360 * scale, 90 * scale);
  x.bezierCurveTo(420 * scale, 20 * scale, 470 * scale, 170 * scale, 560 * scale, 60 * scale);
  x.stroke();
}
function makeSignaturePng() {
  const c = createCanvas(1200, 400);
  strokeSignature(c.getContext("2d"), 2, "#1a3fa8", 9);
  const file = path.join(work, "signature.png");
  fs.writeFileSync(file, c.toBuffer("image/png"));
  return file;
}
// A phone photo of a signature on paper indoors: the paper is grey (about 185) with a brightness
// gradient, the ballpoint ink is dark blue but not black.
function makePhotographedSignature() {
  const c = createCanvas(1200, 400);
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, "#c6c2ba");
  g.addColorStop(1, "#aeaaa2");
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  strokeSignature(x, 2, "#3a4a80", 7);
  const file = path.join(work, "signature-photo.jpg");
  fs.writeFileSync(file, c.toBuffer("image/jpeg", 85));
  return file;
}
async function makeRestrictedPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  page.drawText("STATEMENT OF ACCOUNT", { x: 60, y: 770, size: 22, font });
  for (let i = 0; i < 40; i++) page.drawText(`RESTRICTED-LINE-${String(i + 1).padStart(2, "0")}  12 Oct 2026  POS purchase  4,250.00  balance 118,400.55`, { x: 60, y: 730 - i * 15, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
  const plain = await pdf.save({ useObjectStreams: false });
  const createModule = require("@neslinesli93/qpdf-wasm");
  const qpdf = await createModule({ locateFile: () => path.join(root, "node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm"), print: () => {}, printErr: () => {} });
  qpdf.FS.writeFile("/in.pdf", plain);
  // No password to open, an owner password, printing and editing restricted.
  qpdf.callMain(["--encrypt", "", "owner-secret", "256", "--modify=none", "--", "/in.pdf", "/out.pdf"]);
  const file = path.join(work, "restricted.pdf");
  fs.writeFileSync(file, qpdf.FS.readFile("/out.pdf"));
  return file;
}

// ---- measures --------------------------------------------------------------------------------------
// Share of "in between" pixels among the pixels that are not background, inside a box of a rendered page:
// a crisp edge has few, a soft or blocky one has many. `ink` says what counts as full ink.
function softness(canvas, box, isInk, isPaper) {
  const x0 = Math.round(box[0] * canvas.width), y0 = Math.round(box[1] * canvas.height);
  const w = Math.round((box[2] - box[0]) * canvas.width), h = Math.round((box[3] - box[1]) * canvas.height);
  const d = canvas.getContext("2d").getImageData(x0, y0, w, h).data;
  let ink = 0, between = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (isInk(d[i], d[i + 1], d[i + 2])) ink++;
    else if (!isPaper(d[i], d[i + 1], d[i + 2])) between++;
  }
  return { ink, between, share: ink + between ? +(between / (ink + between)).toFixed(3) : 1 };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const frame = (page) => page.locator('[role="application"][aria-label="Page annotation area"]');
async function at(page, fx, fy) {
  const b = await frame(page).boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
async function openAnnotator(page) {
  await page.locator('ul[aria-label="Pages"] li button').nth(0).click();
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  await page.locator('[data-assistant-id="page-annotate"]').click();
  await page.getByRole("dialog", { name: /Annotate page/ }).waitFor();
}
async function addText(page, fx, fy, text) {
  await page.locator('[data-assistant-id="annotation-tool-text"]').click();
  const p = await at(page, fx, fy);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type(text);
  await page.locator('[data-assistant-id="annotation-tool-select"]').click();
  await page.waitForTimeout(150);
}
async function addUploadedSignature(page, file) {
  await page.locator('[data-assistant-id="annotation-tool-signature"]').click();
  await page.getByRole("tab", { name: "Upload Signature" }).click();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(file);
  await page.getByAltText("Uploaded signature preview").waitFor({ timeout: 20000 });
  const preview = await page.getByAltText("Uploaded signature preview").getAttribute("src");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.locator('[role="application"] .border-dashed').first().waitFor();
  return preview;
}
async function finishAndExport(page, name) {
  await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 60000 });
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  return saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), name);
}
async function upload(page, route, file) {
  await visit(page, route);
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(file);
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Pages"] li').length === 1, null, { timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 60000 });
}

// ---- A: a photographed page with text and a signature -----------------------------------------------
console.log("A. Photo of a document (1000x1414) + typed text + signature");
{
  const photo = makeDocPhoto();
  const { context, page } = await newPage(browser);
  await upload(page, "/scan", photo);
  await openAnnotator(page);
  await addText(page, 0.5, 0.86, "CLARITY-TEXT Adewale Okon 14 Nov 2026");
  await addUploadedSignature(page, makeSignaturePng());
  const dl = await finishAndExport(page, "A-photo-signed.pdf");
  await context.close();

  const report = await pdfReport(dl.file, ["CLARITY-TEXT"]);
  const streams = await embeddedStreams(dl.file);
  const p1 = report.pages[0];
  console.log(`     ${(report.bytes / 1024).toFixed(0)} KB; images ${JSON.stringify(p1.images.map((i) => `${i.px[0]}x${i.px[1]}@${i.dpi}dpi`))}; text chars ${p1.textChars}; path ops ${p1.pathOps}`);
  // The uploaded photo is re-encoded once on upload (the page original); that picture must be what is embedded.
  const pagePicture = streams.find((s) => s.width === 1000 && s.height === 1414);
  check(!!pagePicture, "the page picture is embedded at its own 1000x1414 px");
  check(report.markersFound === 1, "the typed text is real PDF text (selectable, sharp at any zoom)");
  const sig = streams.find((s) => s.hasAlpha && s.width > 600);
  check(!!sig, `the signature is embedded on its own at full resolution${sig ? ` (${sig.width}x${sig.height} px, with transparency)` : ""}`);
  // Crispness of the typed text at 400% zoom (a 300 dpi-equivalent look at an A4 page is scale ~4).
  const zoom = await renderPage(dl.file, 1, 4);
  fs.writeFileSync(path.join(work, "A-zoom.png"), zoom.toBuffer("image/png"));
  const text = softness(zoom, [0.4, 0.84, 0.98, 0.9], (r, g, b) => r < 70 && g < 70 && b < 70, (r, g, b) => r > 215 && g > 210 && b > 200);
  const sigBox = softness(zoom, [0.15, 0.36, 0.85, 0.64], (r, g, b) => b > 130 && r < 70 && g < 100, (r, g, b) => r > 200 && g > 195 && b > 185);
  console.log(`     typed text: ${text.ink} ink px, soft-edge share ${text.share}; signature: ${sigBox.ink} ink px, soft-edge share ${sigBox.share}`);
  check(text.share < 0.3, `typed text edges are crisp at 400% (soft-edge share ${text.share}, limit 0.30)`);
  check(sigBox.share < 0.3, `signature edges are crisp at 400% (soft-edge share ${sigBox.share}, limit 0.30)`);
}

// ---- B: a PDF with restrictions ---------------------------------------------------------------------
console.log("B. PDF with restrictions (no password to open) + signature");
{
  const file = await makeRestrictedPdf();
  const { context, page } = await newPage(browser);
  await upload(page, "/tools/pdf-editor", file);
  await openAnnotator(page);
  await addUploadedSignature(page, makeSignaturePng());
  const dl = await finishAndExport(page, "B-restricted-signed.pdf");
  await context.close();
  const report = await pdfReport(dl.file, ["RESTRICTED-LINE-01", "RESTRICTED-LINE-40"]);
  const p1 = report.pages[0];
  const pageImage = p1.images.find((i) => i.wMm > 200);
  console.log(`     ${(report.bytes / 1024).toFixed(0)} KB; ${p1.widthMm}x${p1.heightMm} mm; text chars ${p1.textChars}; images ${JSON.stringify(p1.images.map((i) => `${i.px[0]}x${i.px[1]}@${i.dpi}dpi`))}`);
  check(p1.widthMm === 210 && p1.heightMm === 297, "the page keeps its A4 size");
  check(report.markersFound === 2 || (pageImage && pageImage.dpi >= 290), report.markersFound === 2 ? "the original text is kept" : `the page is drawn at ${pageImage?.dpi ?? "?"} dpi (at least 290 needed when the text cannot be kept)`);
  const zoom = await renderPage(dl.file, 1, 4);
  fs.writeFileSync(path.join(work, "B-zoom.png"), zoom.toBuffer("image/png"));
  const text = softness(zoom, [0.08, 0.14, 0.9, 0.5], (r, g, b) => r < 90 && g < 90 && b < 90, (r, g, b) => r > 225 && g > 225 && b > 225);
  console.log(`     8 pt statement text at 400%: ${text.ink} ink px, soft-edge share ${text.share}`);
  check(text.share < 0.6, `8 pt text is readable at 400% (soft-edge share ${text.share}, limit 0.60)`);
}

// ---- C: a photographed signature ---------------------------------------------------------------------
console.log("C. Photographed signature on grey paper");
{
  const { context, page } = await newPage(browser);
  await upload(page, "/scan", makeDocPhoto());
  await openAnnotator(page);
  const preview = await addUploadedSignature(page, makePhotographedSignature());
  await context.close();
  const img = await loadImage(Buffer.from(preview.split(",")[1], "base64"));
  const c = createCanvas(img.width, img.height);
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let clear = 0, solid = 0, haze = 0, inkLum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a <= 8) clear++;
    else if (a >= 235) {
      solid++;
      inkLum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    } else haze++;
  }
  const total = d.length / 4;
  const hazeShare = +(haze / total).toFixed(3);
  const solidShare = +(solid / total).toFixed(3);
  console.log(`     ${c.width}x${c.height}; transparent ${(clear / total * 100).toFixed(1)}%, solid ink ${(solidShare * 100).toFixed(1)}%, half-transparent ${(hazeShare * 100).toFixed(1)}%; mean ink brightness ${solid ? (inkLum / solid).toFixed(0) : "-"}`);
  // The stroke covers roughly 2.5% of the picture; everything else is paper and must vanish.
  check(hazeShare < 0.03, `the paper is removed cleanly (half-transparent pixels ${(hazeShare * 100).toFixed(1)}%, limit 3%)`);
  check(solidShare > 0.012, `the ink is solid, not washed out (solid pixels ${(solidShare * 100).toFixed(1)}%, at least 1.2%)`);
  check(solid > 0 && inkLum / solid < 110, `the ink is dark (mean brightness ${solid ? (inkLum / solid).toFixed(0) : "-"}, limit 110)`);
}

// ---- D: additions land where they were put when the picture does not fill the sheet -------------------
console.log("D. Wide photo (2000x800) on an A4 landscape sheet + check mark");
{
  const c = createCanvas(2000, 800);
  const x = c.getContext("2d");
  x.fillStyle = "#cfe3f5";
  x.fillRect(0, 0, c.width, c.height);
  const photo = path.join(work, "wide.jpg");
  fs.writeFileSync(photo, c.toBuffer("image/jpeg", 90));
  const { context, page } = await newPage(browser);
  await upload(page, "/scan", photo);
  await openAnnotator(page);
  await page.locator('[data-assistant-id="annotation-tool-check"]').click();
  const p = await at(page, 0.25, 0.25);
  await page.mouse.click(p.x, p.y);
  // Where the editor shows the mark, as fractions of the picture.
  await page.locator('[role="application"] .border-dashed').first().waitFor();
  const f = await frame(page).boundingBox();
  const b = await page.locator('[role="application"] .border-dashed').first().boundingBox();
  const shown = { x: (b.x + b.width / 2 - f.x) / f.width, y: (b.y + b.height / 2 - f.y) / f.height };
  const dl = await finishAndExport(page, "D-wide-marked.pdf");
  await context.close();
  const report = await pdfReport(dl.file);
  const p1 = report.pages[0];
  const picture = p1.images[0];
  console.log(`     sheet ${p1.widthMm}x${p1.heightMm} mm; picture ${picture.wMm}x${picture.hMm} mm; path ops ${p1.pathOps}`);
  check(p1.pathOps > 0, "the check mark is vector drawing, not painted into the picture");
  const render = await renderPage(dl.file, 1, 2);
  const d = render.getContext("2d").getImageData(0, 0, render.width, render.height).data;
  let minX = render.width, minY = render.height, maxX = -1, maxY = -1;
  for (let yy = 0; yy < render.height; yy++)
    for (let xx = 0; xx < render.width; xx++) {
      const i = (yy * render.width + xx) * 4;
      if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) {
        minX = Math.min(minX, xx);
        maxX = Math.max(maxX, xx);
        minY = Math.min(minY, yy);
        maxY = Math.max(maxY, yy);
      }
    }
  // The picture is centred on the sheet: its top edge sits (sheet - picture) / 2 down.
  const top = (p1.heightMm - picture.hMm) / 2;
  const expected = { x: (shown.x * picture.wMm) / p1.widthMm, y: (top + shown.y * picture.hMm) / p1.heightMm };
  const found = maxX < 0 ? null : { x: (minX + maxX) / 2 / render.width, y: (minY + maxY) / 2 / render.height };
  console.log(`     mark shown at ${shown.x.toFixed(3)}, ${shown.y.toFixed(3)} of the picture; expected on the sheet ${expected.x.toFixed(3)}, ${expected.y.toFixed(3)}; found ${found ? `${found.x.toFixed(3)}, ${found.y.toFixed(3)}` : "nothing"}`);
  check(!!found && Math.abs(found.x - expected.x) < 0.01 && Math.abs(found.y - expected.y) < 0.01, "the mark is where the editor showed it (within 1% of the sheet)");
}

await browser.close();
console.log(`\n${pass} checks passed${failed ? `, ${failed} FAILED` : ""}   (files in ${work})`);
if (failed) process.exit(1);
