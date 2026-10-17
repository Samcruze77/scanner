// Acceptance for "crop and enhance an imported PDF without losing it unnecessarily". rich.pdf (selectable text, 6 pt
// text, vector lines and circles, an embedded 1600x1200 photo, portrait + landscape pages) and a fixture whose
// pages carry /Rotate 90, 180 and 270 are opened in the real editor, edited through the real controls, exported,
// and the DOWNLOADED files are measured: text layer, vector operators, embedded image bytes and effective dpi,
// page sizes and order, and rendered pixels compared with the source.
//   node tests/audit/verify-pdf-quality.mjs [baseUrl]      (needs `npm run start`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { openPdf } from "../docx/pdftool.mjs";
import { CHROME, chromium, createCanvas, embeddedStreams, newPage, pdfjs, pdfReport, psnr, renderPage, saveDownload, visit, work } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const RICH = path.join(here, "corpus", "rich.pdf");
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};
const results = [];
const note = (k, v) => results.push([k, v]);

const src = await pdfReport(RICH, ["RICH-P1-L01", "RICH-P1-SMALL", "RICH-P2-SMALL", "RICH-P3-L20"]);
const srcImages = await embeddedStreams(RICH);
// Text-drawing operations in a page's content (counts glyph runs even when the crop hides them; pdf.js's text
// extraction leaves out glyphs that fall outside the visible page).
async function textOps(file, pageNo) {
  const pdf = await openPdf(file);
  const page = await pdf.getPage(pageNo);
  const ops = await page.getOperatorList();
  const n = ops.fnArray.filter((fn) => fn === pdfjs.OPS.showText || fn === pdfjs.OPS.showSpacedText).length;
  await pdf.destroy();
  return n;
}
// The source page drawn by pdf.js exactly as the crop would show it (no rounding of the crop edge to whole pixels).
async function renderRegion(file, pageNo, scale, f) {
  const pdf = await openPdf(file);
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale });
  const viewport = page.getViewport({ scale, offsetX: -f.l * base.width, offsetY: -f.t * base.height });
  const canvas = createCanvas(Math.round((f.r - f.l) * base.width), Math.round((f.b - f.t) * base.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  await pdf.destroy();
  return canvas;
}
const mm = (p) => [p.widthMm, p.heightMm];
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- driving the editor ------------------------------------------------------------------------------
async function openFile(file, pageCount) {
  const { context, page } = await newPage(browser);
  await visit(page, "/tools/pdf-editor");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(file);
  await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label="Pages"] li').length === n, pageCount, { timeout: 60000 });
  const ready = () => page.waitForFunction((n) => [...document.querySelectorAll("button")].some((b) => new RegExp(`Create PDF \\(${n} page`).test(b.innerText) && !b.disabled), pageCount, { timeout: 90000 });
  await ready();
  return { context, page, ready };
}
const settle = (page) => page.waitForFunction(() => !document.querySelector("[role=dialog]")?.innerText.includes("Processing"), null, { timeout: 60000 });
async function editPage(page, index, fn) {
  await page.locator('ul[aria-label="Pages"] li button').nth(index).click();
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  const editor = page.getByRole("dialog", { name: `Edit page ${index + 1}` });
  await editor.waitFor();
  await fn(editor);
  await page.waitForTimeout(500);
  await settle(page);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await editor.waitFor({ state: "detached" });
}
// Crop with the keyboard: Shift+arrows move a corner by 5% of the page. Corners start 6% in from each edge.
async function crop(page, editor, { tl = [0, 0], br = [0, 0], permanent = false }) {
  await editor.getByRole("button", { name: "Adjust crop" }).click();
  const dlg = page.getByRole("dialog", { name: "Adjust crop" });
  await dlg.waitFor();
  const press = async (label, dx, dy) => {
    const handle = dlg.getByRole("button", { name: new RegExp("^" + label) });
    await handle.focus();
    for (let i = 0; i < Math.abs(dx); i++) await page.keyboard.press(dx > 0 ? "Shift+ArrowRight" : "Shift+ArrowLeft");
    for (let i = 0; i < Math.abs(dy); i++) await page.keyboard.press(dy > 0 ? "Shift+ArrowDown" : "Shift+ArrowUp");
  };
  await press("Top-left corner", tl[0], tl[1]);
  await press("Bottom-right corner", br[0], br[1]);
  if (permanent) await dlg.getByLabel("Remove the cut-away area for good").check();
  await dlg.getByRole("button", { name: "Apply crop" }).click();
  await dlg.waitFor({ state: "detached" });
}
const fractions = ({ tl = [0, 0], br = [0, 0] }) => ({ l: 0.06 + 0.05 * tl[0], t: 0.06 + 0.05 * tl[1], r: 0.94 + 0.05 * br[0], b: 0.94 + 0.05 * br[1] });

async function exportPdf(page, ready, name) {
  await ready();
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  return (await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), name)).file;
}

// ---- pixel helpers -----------------------------------------------------------------------------------
const pixels = (canvas) => canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
function chroma(canvas) {
  const d = pixels(canvas);
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]);
  return s / (d.length / 4);
}
const luma = (canvas) => {
  const d = pixels(canvas);
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / (d.length / 4);
};
function binaryShare(canvas) {
  const d = pixels(canvas);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 25 || d[i] > 230) n++;
  return n / (d.length / 4);
}
function region(canvas, f) {
  const x = Math.round(f.l * canvas.width), y = Math.round(f.t * canvas.height);
  const w = Math.round((f.r - f.l) * canvas.width), h = Math.round((f.b - f.t) * canvas.height);
  const c = createCanvas(w, h);
  c.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return c;
}
function rotateCw(canvas) {
  const c = createCanvas(canvas.height, canvas.width);
  const x = c.getContext("2d");
  x.translate(c.width, 0);
  x.rotate(Math.PI / 2);
  x.drawImage(canvas, 0, 0);
  return c;
}
// PSNR over the area both canvases cover, pixel for pixel (a crop edge can differ by one pixel in size).
function psnrAligned(a, b) {
  const w = Math.min(a.width, b.width) - 1, h = Math.min(a.height, b.height) - 1;
  const da = a.getContext("2d").getImageData(0, 0, w, h).data, db = b.getContext("2d").getImageData(0, 0, w, h).data;
  let se = 0;
  for (let i = 0; i < da.length; i += 4) for (let k = 0; k < 3; k++) se += (da[i + k] - db[i + k]) ** 2;
  const mse = se / ((da.length / 4) * 3);
  return mse === 0 ? 99 : +(10 * Math.log10((255 * 255) / mse)).toFixed(1);
}
const png = (c) => c.toBuffer("image/png");

// ======================================================================================================
console.log("A. Rectangle crop (page 1), Grayscale (page 2), untouched page 3");
const A = {};
{
  const { context, page, ready } = await openFile(RICH, 3);
  const cropSpec = { tl: [2, 1], br: [-2, -3] }; // 16%..84% across, 11%..79% down
  await editPage(page, 0, async (editor) => {
    await crop(page, editor, cropSpec);
    await settle(page);
    const kept = editor.locator('[data-flatten-notice="kept"]');
    await kept.waitFor();
    assert.match(await kept.innerText(), /keeps its selectable text/);
    assert.match(await kept.innerText(), /still inside the PDF file/);
    assert.equal(await editor.locator('[data-flatten-notice="picture"]').count(), 0);
  });
  ok("UI: a rectangle crop says the text stays selectable and that the cut-away area is only hidden");
  await editPage(page, 1, async (editor) => {
    await editor.getByRole("button", { name: "Grayscale" }).click();
    await page.waitForTimeout(800);
    await settle(page);
    const warn = editor.locator('[data-flatten-notice="picture"]');
    await warn.waitFor();
    assert.match(await warn.innerText(), /Grayscale changes the colours of the page itself/);
    assert.match(await warn.innerText(), /text can no longer be selected/);
  });
  ok("UI: Grayscale says the page becomes a picture and its text can no longer be selected");
  await page.locator('ul[aria-label="Pages"] li button').nth(1).click();
  assert.match(await page.locator('[data-flatten-notice="picture"]').first().innerText(), /Grayscale/);
  ok("UI: the same notice is shown next to the selected page");
  A.file = await exportPdf(page, ready, "A.pdf");
  A.cropFractions = fractions(cropSpec);
  await context.close();
}
{
  const out = await pdfReport(A.file, ["RICH-P1-L01", "RICH-P1-SMALL", "RICH-P3-L20"]);
  const f = A.cropFractions;
  assert.equal(out.pageCount, 3);
  const [p1, p2, p3] = out.pages;
  const expW = (f.r - f.l) * 210, expH = (f.b - f.t) * 297;
  assert.ok(near(p1.widthMm, expW, 0.8) && near(p1.heightMm, expH, 0.8), `cropped page size ${p1.widthMm}x${p1.heightMm} vs expected ${expW.toFixed(1)}x${expH.toFixed(1)}`);
  assert.deepEqual(mm(p2), [297, 210]);
  assert.deepEqual(mm(p3), [210, 297]);
  ok(`page sizes: cropped ${p1.widthMm}x${p1.heightMm} mm (expected ${expW.toFixed(1)}x${expH.toFixed(1)}), landscape ${mm(p2)}, untouched ${mm(p3)}; order kept`);
  const ops = await textOps(A.file, 1), srcOps = await textOps(RICH, 1);
  assert.equal(ops, srcOps, "every text operation of the page is still in the file");
  assert.ok(p1.textChars >= src.pages[0].textChars * 0.5, `visible text selectable: ${p1.textChars} chars`);
  assert.ok(p1.pathOps >= src.pages[0].pathOps, "vector kept");
  const photo = p1.images.find((i) => i.px[0] === 1600);
  const srcPhoto = src.pages[0].images.find((i) => i.px[0] === 1600);
  assert.ok(photo && Math.abs(photo.dpi - srcPhoto.dpi) <= 2, "photo dpi unchanged");
  const streams = await embeddedStreams(A.file);
  assert.ok(streams.some((s) => s.bytes.equals(srcImages.find((x) => x.width === 1600).bytes)), "photo bytes identical");
  note("A page 1 (cropped)", `selectable text in view ${p1.textChars} of ${src.pages[0].textChars} chars (all ${ops}/${srcOps} text operations still in the file: the cut-away text is hidden, not deleted), path ops ${p1.pathOps} (source ${src.pages[0].pathOps}), photo ${photo.dpi} dpi (source ${srcPhoto.dpi}), bytes identical`);
  ok(`cropped page keeps selectable text (${p1.textChars} chars in view; ${ops}/${srcOps} text operations kept), vector drawing (${p1.pathOps} path ops) and the photo (${photo.dpi} dpi, identical bytes)`);
  const b = await renderPage(A.file, 1, 1.5);
  const p = psnrAligned(await renderRegion(RICH, 1, 1.5, f), b);
  assert.ok(p >= 35, `rendered crop equals the source region (PSNR ${p})`);
  note("A page 1 crop vs source region", `PSNR ${p} dB`);
  ok(`the cropped page renders like that region of the source (PSNR ${p} dB)`);
  assert.equal(p2.textChars, 0, "grayscale page is a picture");
  const im = p2.images[0];
  assert.ok(im && im.dpi >= 280 && im.dpi <= 320, `grayscale page drawn at about 300 dpi: ${im?.dpi}`);
  note("A page 2 (Grayscale, landscape)", `picture, ${im.px.join("x")} px at ${im.dpi} dpi (the on-screen picture is about 170)`);
  ok(`Grayscale page: a picture drawn from the original at ${im.dpi} dpi (on-screen picture is ~170), ${mm(p2)} mm`);
  assert.equal(p3.textChars, src.pages[2].textChars);
  assert.equal(p3.pathOps, src.pages[2].pathOps);
  assert.ok(out.allText.includes("RICH-P3-L20"));
  const c = await renderPage(RICH, 3, 1.2), d = await renderPage(A.file, 3, 1.2);
  const p3p = await psnr(png(c), png(d), 900);
  assert.ok(p3p >= 40, `untouched page 3 renders as the source (PSNR ${p3p})`);
  note("A page 3 (untouched)", `text ${p3.textChars}/${src.pages[2].textChars}, PSNR ${p3p} dB`);
  ok(`untouched page 3 is identical in content (${p3.textChars} chars, PSNR ${p3p} dB)`);
  const reopened = await PDFDocument.load(fs.readFileSync(A.file));
  assert.equal(reopened.getPageCount(), 3);
  ok("the exported PDF reopens (pdf-lib and pdf.js)");
}

// ======================================================================================================
console.log("B. Black & white (page 1), brightness and contrast (page 2), crop + rotate right (page 3)");
const B = {};
{
  const { context, page, ready } = await openFile(RICH, 3);
  await editPage(page, 0, async (editor) => {
    await editor.getByRole("button", { name: "Black & White" }).click();
    await page.waitForTimeout(800);
  });
  await editPage(page, 1, async (editor) => {
    await editor.getByLabel("Brightness").fill("-40");
    await editor.getByLabel("Brightness").blur();
    await page.waitForTimeout(800);
    await settle(page);
    await editor.getByLabel("Contrast").fill("25");
    await editor.getByLabel("Contrast").blur();
    await page.waitForTimeout(800);
    await settle(page);
    const warn = editor.locator('[data-flatten-notice="picture"]');
    await warn.waitFor();
    assert.match(await warn.innerText(), /Brightness and contrast/);
  });
  await editPage(page, 2, async (editor) => {
    await crop(page, editor, { tl: [1, 1], br: [-1, -1] });
    await settle(page);
    await editor.getByRole("button", { name: "Rotate right" }).click();
    await page.waitForTimeout(800);
    await settle(page);
    assert.equal(await editor.locator('[data-flatten-notice="picture"]').count(), 0, "crop + rotate keeps the text, so no warning");
  });
  B.file = await exportPdf(page, ready, "B.pdf");
  B.crop = fractions({ tl: [1, 1], br: [-1, -1] });
  await context.close();
}
{
  const out = await pdfReport(B.file);
  const [p1, p2, p3] = out.pages;
  assert.equal(out.pageCount, 3);
  assert.equal(p1.textChars, 0);
  const im1 = p1.images[0];
  assert.ok(im1.dpi >= 280 && im1.dpi <= 320, `B&W page at about 300 dpi: ${im1.dpi}`);
  assert.deepEqual(mm(p1), [210, 297]);
  const b1 = await renderPage(B.file, 1, 1.5);
  const share = binaryShare(b1);
  assert.ok(share >= 0.93, `black and white: ${(share * 100).toFixed(1)}% of pixels are black or white`);
  assert.ok(chroma(b1) < 2, "no colour left");
  note("B page 1 (Black & White)", `picture ${im1.px.join("x")} at ${im1.dpi} dpi, ${(share * 100).toFixed(1)}% pure black/white, chroma ${chroma(b1).toFixed(2)}`);
  ok(`Black & White page: ${im1.dpi} dpi, ${(share * 100).toFixed(1)}% of pixels pure black or white, no colour (picture; text not selectable)`);
  assert.equal(p2.textChars, 0);
  assert.deepEqual(mm(p2), [297, 210]);
  const im2 = p2.images[0];
  assert.ok(im2.dpi >= 280 && im2.dpi <= 320);
  // Reference: the same page exported as a plain picture (A.pdf, Grayscale on a black-and-white page changes nothing),
  // so both sides come from the same browser-drawn pixels. pdf.js in Node draws the vector source with substitute
  // fonts and thicker hairlines, which would otherwise dominate the comparison.
  const s2 = await renderPage(A.file, 2, 1.2), o2 = await renderPage(B.file, 2, 1.2);
  // The expected result: the app's own brightness/contrast curve (utils/scanner/enhance.ts, ADJUSTMENT_SCALE 1.5)
  // applied to the source page.
  const curve = (canvas, brightness, contrast) => {
    const c = contrast * 1.5, off = brightness * 1.5, factor = (259 * (c + 255)) / (255 * (259 - c));
    const out = createCanvas(canvas.width, canvas.height), x = out.getContext("2d");
    x.drawImage(canvas, 0, 0);
    const img = x.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, factor * (img.data[i + k] - 128) + 128 + off));
    x.putImageData(img, 0, 0);
    return out;
  };
  const expected2 = curve(s2, -40, 25);
  // At reduced size, so hairline anti-aliasing does not drown the tone change being measured.
  const pc = await psnr(png(expected2), png(o2), 900);
  const untouchedP = await psnr(png(s2), png(o2), 900);
  assert.ok(pc >= 35 && pc > untouchedP + 3, `adjusted page matches the app's curve (PSNR ${pc} dB; against the unadjusted source ${untouchedP} dB)`);
  const dl = luma(o2) - luma(s2);
  note("B page 2 (brightness -40, contrast +25)", `picture at ${im2.dpi} dpi, matches the app's own curve (PSNR ${pc} dB vs ${untouchedP} dB for no change), mean luminance ${luma(s2).toFixed(1)} -> ${luma(o2).toFixed(1)}`);
  ok(`brightness/contrast page: ${im2.dpi} dpi, matches the editor's own curve (PSNR ${pc} dB; unadjusted would be ${untouchedP} dB), size ${mm(p2)} mm`);

  // Page 3: cropped then turned right: real text, size swapped.
  const f = B.crop;
  const cw = (f.r - f.l) * 210, ch = (f.b - f.t) * 297;
  assert.ok(near(p3.widthMm, ch, 0.8) && near(p3.heightMm, cw, 0.8), `crop+rotate size ${p3.widthMm}x${p3.heightMm} vs ${ch.toFixed(1)}x${cw.toFixed(1)}`);
  assert.equal(await textOps(B.file, 3), await textOps(RICH, 3), "text operations kept");
  assert.ok(p3.textChars > 100, "text selectable");
  const o3 = await renderPage(B.file, 3, 1.5);
  const expected = rotateCw(await renderRegion(RICH, 3, 1.5, f));
  const pp = psnrAligned(expected, o3);
  assert.ok(pp >= 35, `crop then rotate renders as expected (PSNR ${pp})`);
  note("B page 3 (crop + rotate right)", `selectable text ${p3.textChars} chars, ${p3.widthMm}x${p3.heightMm} mm, PSNR vs expected ${pp} dB`);
  ok(`crop + rotate right: ${p3.widthMm}x${p3.heightMm} mm, selectable text kept (${p3.textChars} chars), matches the expected pixels (PSNR ${pp} dB)`);
}

// ======================================================================================================
console.log("C. Reverting an edit, 'remove for good', Grayscale on a coloured page");
const C = {};
{
  const { context, page, ready } = await openFile(RICH, 3);
  await editPage(page, 0, async (editor) => {
    await editor.getByRole("button", { name: "Grayscale" }).click();
    await page.waitForTimeout(800);
  });
  await editPage(page, 1, async (editor) => {
    await crop(page, editor, { tl: [1, 1], br: [-1, -1], permanent: true });
    await settle(page);
    const warn = editor.locator('[data-flatten-notice="picture"]');
    await warn.waitFor();
    assert.match(await warn.innerText(), /remove the cut-away area for good/);
  });
  // Page 3: crop + Grayscale, then Reset to original.
  await editPage(page, 2, async (editor) => {
    await crop(page, editor, { tl: [2, 2], br: [-2, -2] });
    await settle(page);
    await editor.getByRole("button", { name: "Grayscale" }).click();
    await page.waitForTimeout(800);
    await settle(page);
    await editor.locator('[data-flatten-notice="picture"]').waitFor();
    await editor.getByRole("button", { name: "Reset to original" }).click();
    await page.waitForTimeout(800);
    await settle(page);
    assert.equal(await editor.locator('[data-flatten-notice]').count(), 0, "no notice after reverting");
  });
  C.file = await exportPdf(page, ready, "C.pdf");
  await context.close();
}
{
  const out = await pdfReport(C.file);
  const [p1, p2, p3] = out.pages;
  const g1 = await renderPage(C.file, 1, 1.5), s1 = await renderPage(RICH, 1, 1.5);
  assert.equal(p1.textChars, 0);
  assert.ok(chroma(s1) > 4, "the source page is coloured");
  assert.ok(chroma(g1) < 1.5, `grayscale removed the colour (chroma ${chroma(g1).toFixed(2)})`);
  const gp = +Math.abs(luma(createGrayRef(s1)) - luma(g1)).toFixed(2);
  note("C page 1 (Grayscale)", `chroma ${chroma(s1).toFixed(1)} -> ${chroma(g1).toFixed(2)}, mean luminance differs from the source by ${gp}, ${p1.images[0].dpi} dpi`);
  assert.ok(gp < 4, `grayscale keeps the luminance of the source (mean differs by ${gp})`);
  ok(`Grayscale: chroma ${chroma(s1).toFixed(1)} -> ${chroma(g1).toFixed(2)}, mean luminance within ${gp} of the source, ${p1.images[0].dpi} dpi`);
  // Permanent crop: a picture, exact size, nothing of the cut-away area left.
  const f = fractions({ tl: [1, 1], br: [-1, -1] });
  assert.equal(p2.textChars, 0, "permanent crop leaves no text");
  assert.ok(near(p2.widthMm, (f.r - f.l) * 297, 1) && near(p2.heightMm, (f.b - f.t) * 210, 1), `permanent crop size ${p2.widthMm}x${p2.heightMm}`);
  assert.ok(p2.images[0].dpi >= 280 && p2.images[0].dpi <= 320);
  note("C page 2 (remove for good)", `picture at ${p2.images[0].dpi} dpi, ${p2.widthMm}x${p2.heightMm} mm, text ${p2.textChars}`);
  ok(`'Remove for good' crop: a picture at ${p2.images[0].dpi} dpi, ${p2.widthMm}x${p2.heightMm} mm, no text left (the cut-away text is gone)`);
  // Reverted page 3 is the original page again.
  assert.deepEqual(mm(p3), [210, 297]);
  assert.equal(p3.textChars, src.pages[2].textChars);
  assert.equal(p3.pathOps, src.pages[2].pathOps);
  const s3 = await renderPage(RICH, 3, 1.2), o3 = await renderPage(C.file, 3, 1.2);
  const rp = await psnr(png(s3), png(o3), 900);
  assert.ok(rp >= 40, `reverted page equals the source (PSNR ${rp})`);
  note("C page 3 (crop + Grayscale, then Reset)", `A4 again, text ${p3.textChars}/${src.pages[2].textChars}, PSNR ${rp} dB`);
  ok(`reverting (Reset to original) restores the page: ${mm(p3)} mm, text ${p3.textChars} chars, PSNR ${rp} dB`);
}
function createGrayRef(canvas) {
  const c = createCanvas(canvas.width, canvas.height);
  const x = c.getContext("2d");
  x.drawImage(canvas, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
  }
  x.putImageData(img, 0, 0);
  return c;
}

// ======================================================================================================
console.log("D. Pages that carry their own /Rotate (90, 180, 270): the crop lands on the right part of the page");
{
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const mk = (rot, label, w, h) => {
    const p = pdf.addPage([w, h]);
    p.setRotation(degrees(rot));
    p.drawText(`ROT${rot}-${label} top-left of the unrotated page`, { x: 20, y: h - 30, size: 14, font });
    p.drawRectangle({ x: 20, y: 20, width: 90, height: 60, color: rgb(0.9, 0.1, 0.1) }); // red block, bottom-left
    p.drawRectangle({ x: w - 110, y: h - 90, width: 80, height: 50, color: rgb(0.1, 0.2, 0.9) }); // blue block, top-right
    for (let i = 0; i < 12; i++) p.drawLine({ start: { x: 20, y: 120 + i * 14 }, end: { x: w - 20, y: 120 + i * 14 }, thickness: 0.5, color: rgb(0, 0.5, 0) });
    p.drawText(`ROT${rot}-SMALL 6 pt text 0123456789`, { x: 130, y: 60, size: 6, font });
  };
  mk(90, "A", 420, 300);
  mk(180, "B", 300, 420);
  mk(270, "C", 420, 300);
  const rotFile = path.join(work, "rotated.pdf");
  fs.writeFileSync(rotFile, await pdf.save());
  const { context, page, ready } = await openFile(rotFile, 3);
  const specs = [
    { tl: [2, 1], br: [-1, -2] },
    { tl: [1, 3], br: [-3, -1] },
    { tl: [3, 2], br: [-2, -3] },
  ];
  for (let i = 0; i < 3; i++) await editPage(page, i, async (editor) => { await crop(page, editor, specs[i]); });
  const file = await exportPdf(page, ready, "D.pdf");
  await context.close();
  const out = await pdfReport(file);
  for (let i = 0; i < 3; i++) {
    const f = fractions(specs[i]);
    const o = await renderPage(file, i + 1, 2);
    const expected = await renderRegion(rotFile, i + 1, 2, f);
    assert.ok(near(o.width, expected.width, 3) && near(o.height, expected.height, 3), `page ${i + 1} size ${o.width}x${o.height} vs ${expected.width}x${expected.height}`);
    const p = psnrAligned(expected, o);
    assert.ok(p >= 35, `rotated page ${i + 1}: crop equals the same region of the source (PSNR ${p})`);
    const ops = await textOps(file, i + 1), srcOps = await textOps(rotFile, i + 1);
    assert.equal(ops, srcOps, "text operations kept");
    assert.ok(out.pages[i].pathOps >= 5, "vector drawing kept: " + out.pages[i].pathOps);
    note(`D page ${i + 1} (/Rotate ${[90, 180, 270][i]})`, `size ${o.width}x${o.height}px matches, PSNR ${p} dB, text operations ${ops}/${srcOps}, path ops ${out.pages[i].pathOps}`);
    ok(`/Rotate ${[90, 180, 270][i]}: cropped page matches the same region of the source (PSNR ${p} dB), text and vectors kept`);
  }
}

await browser.close();
console.log("\nMeasurements");
for (const [k, v] of results) console.log(`  ${k}: ${v}`);
console.log(`\n${pass} checks passed`);
