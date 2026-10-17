// Picture QUALITY in the downloaded PDF, measured on the real file rather than the editor preview.
// For each real image the editor places it, exports a PDF, then:
//   - reads the PDF's embedded images (pixel size, filter, alpha) and compares them with the source,
//   - for an untouched JPEG checks the embedded bytes ARE the original file,
//   - renders the PDF at 300 dpi and compares fine detail in the picture's area with the source
//     scaled to the same physical size (a blurry export scores far lower),
//   - checks transparency, rotation without loss, large-image handling and the low-resolution warning.
//
//   npm run build && npm run start         (another terminal)
//   node tests/images/quality.mjs [baseUrl]    default http://localhost:3000
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, PDFName, PDFRawStream, PDFRef, rgb } from "pdf-lib";
import { renderPdf } from "../docx/pdftool.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const BASE = process.argv[2] ?? "http://localhost:3000";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "image-quality-"));
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found.");

let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};

// ---- fixtures: real image files with fine detail ----------------------------------------------
// Fine vertical bars and a pale face: blur shows up as lost contrast between neighbouring pixels.
function detailImage(w, h, { quality = 95, type = "jpeg", bar = Math.round(w / 250) } = {}) {
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  x.fillStyle = "#f4efe6";
  x.fillRect(0, 0, w, h);
  for (let px = 0; px < w; px += bar * 2) {
    x.fillStyle = "#202a5a";
    x.fillRect(px, 0, bar, h);
  }
  x.fillStyle = "#e6b28c";
  x.beginPath();
  x.ellipse(w / 2, h * 0.45, w * 0.28, h * 0.3, 0, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#2b1d12";
  for (let i = 0; i < 6; i++) x.fillRect(w * 0.38, h * (0.36 + i * 0.012), w * 0.24, Math.max(2, bar / 3));
  return type === "jpeg" ? c.toBuffer("image/jpeg", quality) : c.toBuffer("image/png");
}
function logoPng(size) {
  const c = createCanvas(size, size);
  const x = c.getContext("2d");
  x.strokeStyle = "#8000c0";
  x.lineWidth = size / 40;
  for (let r = size * 0.1; r < size * 0.48; r += size / 20) {
    x.beginPath();
    x.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    x.stroke();
  }
  return c.toBuffer("image/png");
}
const files = {
  passport: path.join(work, "passport-hi.jpg"), // 3000 x 4000
  standard: path.join(work, "standard.jpg"), // 1200 x 1600
  logo: path.join(work, "logo.png"), // 1200 x 1200, transparent
  huge: path.join(work, "huge.png"), // 6000 x 4500
  tiny: path.join(work, "tiny.jpg"), // 200 x 260
  doc: path.join(work, "form.pdf"),
};
fs.writeFileSync(files.passport, detailImage(3000, 4000));
fs.writeFileSync(files.standard, detailImage(1200, 1600, { bar: 5 }));
fs.writeFileSync(files.logo, logoPng(1200));
fs.writeFileSync(files.huge, detailImage(6000, 4500, { type: "png", bar: 48 }));
fs.writeFileSync(files.tiny, detailImage(200, 260, { bar: 2 }));
{
  const pdf = await PDFDocument.create();
  for (const colour of [rgb(0.1, 0.2, 0.85), rgb(0.05, 0.6, 0.15)]) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 0.97, 0.8) });
    page.drawRectangle({ x: 0, y: 760, width: 595.28, height: 82, color: colour });
  }
  fs.writeFileSync(files.doc, await pdf.save());
}

// ---- reading the exported PDF -------------------------------------------------------------------
async function embeddedImages(pdfFile, pageIndex) {
  const doc = await PDFDocument.load(fs.readFileSync(pdfFile));
  const page = doc.getPage(pageIndex);
  const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"));
  const out = [];
  if (!xobjects) return out;
  for (const [, ref] of xobjects.entries()) {
    const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.lookup(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    out.push({
      width: Number(d.lookup(PDFName.of("Width")).toString()),
      height: Number(d.lookup(PDFName.of("Height")).toString()),
      filter: d.lookup(PDFName.of("Filter"))?.toString() ?? "",
      hasAlpha: !!d.lookup(PDFName.of("SMask")),
      bytes: Buffer.from(obj.contents),
    });
  }
  return out;
}

// Page 2's images without the page's own background image (which is the same size as page 1's).
async function pictures(pdfFile) {
  const base = (await embeddedImages(pdfFile, 0))[0];
  return (await embeddedImages(pdfFile, 1)).filter((i) => !(i.width === base.width && i.height === base.height));
}

// Mean absolute difference between horizontal neighbours: a measure of fine detail.
function detail(canvas, box) {
  const ctx = canvas.getContext("2d");
  const x0 = Math.round(box.x * canvas.width), y0 = Math.round(box.y * canvas.height);
  const w = Math.round(box.w * canvas.width), h = Math.round(box.h * canvas.height);
  const d = ctx.getImageData(x0, y0, w, h).data;
  let sum = 0, n = 0;
  for (let y = 0; y < h; y += 2)
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4, j = i - 4;
      sum += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
      n++;
    }
  return sum / n;
}

// The source picture drawn at the size and shape it has on the page (what a perfect export looks like).
async function reference(file, box, pageW, pageH, crop) {
  const img = await loadImage(file);
  const w = Math.round(box.w * pageW), h = Math.round(box.h * pageH);
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  x.imageSmoothingQuality = "high";
  const s = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  x.drawImage(img, s.x * img.width, s.y * img.height, s.w * img.width, s.h * img.height, 0, 0, w, h);
  return { canvas: c, box: { x: 0, y: 0, w: 1, h: 1 } };
}

// ---- driving the editor ----------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];
const SCALE_300DPI = 300 / 72;

async function openEditor() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text()) && consoleErrors.push(m.text()));
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: { ok: true } }));
  await page.goto(BASE + "/tools/pdf-editor", { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("button", { name: "Reject non-essential" }).click({ timeout: 8000 });
  } catch {
    /* already chosen */
  }
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(files.doc);
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Pages"] li').length === 2, null, { timeout: 30000 });
  await page.locator('ul[aria-label="Pages"] li button').nth(1).click();
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  await page.locator('[data-assistant-id="page-annotate"]').click();
  await page.getByRole("dialog", { name: /Annotate page/ }).waitFor();
  return { context, page };
}
async function addImage(page, file, preset) {
  await page.locator('[data-assistant-id="annotation-tool-image"]').click();
  await page.locator('[data-assistant-id="image-file-input"]').setInputFiles(file);
  await page.getByAltText("Your picture, ready to place on the page").waitFor({ timeout: 30000 });
  if (preset) await page.locator("#image-size").selectOption(preset);
  await page.getByRole("button", { name: "Place on page" }).click();
  await page.locator('[role="application"] .border-dashed').first().waitFor({ timeout: 30000 });
}
async function selection(page) {
  const f = await page.locator('[role="application"][aria-label="Page annotation area"]').boundingBox();
  const b = await page.locator('[role="application"] .border-dashed').first().boundingBox();
  return { x: (b.x - f.x) / f.width, y: (b.y - f.y) / f.height, w: b.width / f.width, h: b.height / f.height };
}
async function exportPdf(page, name) {
  await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  const download = page.waitForEvent("download", { timeout: 90000 });
  await page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 90000 });
  const file = path.join(work, name);
  await (await download).saveAs(file);
  return file;
}
async function renderPage2(pdfFile) {
  const pages = await renderPdf(pdfFile, path.join(work, "r-" + path.basename(pdfFile, ".pdf")), SCALE_300DPI);
  assert.equal(pages.length, 2, "page count unchanged");
  return pages[1].canvas;
}
const sharpness = async (canvas, box, file, crop) => {
  const ref = await reference(file, box, canvas.width, canvas.height, crop);
  return { exported: detail(canvas, box), source: detail(ref.canvas, ref.box) };
};

try {
  console.log("High-resolution passport photograph (3000 x 4000 JPEG) at 35 x 45 mm");
  {
    const { context, page } = await openEditor();
    await addImage(page, files.passport, "35x45mm");
    const box = await selection(page);
    assert.equal(await page.getByText(/Soft when printed|Low resolution/).count(), 0, "no warning for a sharp picture");
    const pdf = await exportPdf(page, "passport.pdf");
    const imgs = await pictures(pdf);
    const photo = imgs[0];
    assert.ok(photo, "the photograph is embedded as its own image: " + JSON.stringify(imgs.map((i) => [i.width, i.height])));
    // 35:45 centred crop of 3000 x 4000 keeps the full width: 3000 x 3857.
    assert.ok(photo.width >= 2990 && photo.height >= 3800, `no pixels thrown away: embedded ${photo.width}x${photo.height} from 3000x4000`);
    assert.match(photo.filter, /DCT/, "kept as JPEG, not converted");
    const canvas = await renderPage2(pdf);
    const crop = { x: 0, y: (1 - 3857 / 4000) / 2, w: 1, h: 3857 / 4000 };
    const { exported, source } = await sharpness(canvas, box, files.passport, crop);
    assert.ok(exported >= source * 0.93, `300 dpi render keeps the detail (export ${exported.toFixed(1)} vs source ${source.toFixed(1)})`);
    // jsPDF lists every image in each page's resources, so count the whole document: two page
    // images plus the one photograph, nothing else.
    assert.equal((await embeddedImages(pdf, 0)).length, 3, "two page images and the photograph");
    ok(`embedded at ${photo.width}x${photo.height} (source 3000x4000) as JPEG; rendered detail ${(exported / source * 100).toFixed(0)}% of the source's`);
    await context.close();
  }

  console.log("\nUntouched JPEG is embedded byte for byte");
  {
    const { context, page } = await openEditor();
    await addImage(page, files.standard);
    const box = await selection(page);
    const pdf = await exportPdf(page, "standard.pdf");
    const imgs = await pictures(pdf);
    const original = fs.readFileSync(files.standard);
    const same = imgs.find((i) => i.bytes.equals(original));
    assert.ok(same, "the original JPEG data is inside the PDF unchanged: " + JSON.stringify(imgs.map((i) => [i.width, i.height, i.bytes.length])));
    assert.equal(same.width, 1200);
    assert.equal(same.height, 1600);
    const canvas = await renderPage2(pdf);
    const { exported, source } = await sharpness(canvas, box, files.standard);
    assert.ok(exported >= source * 0.93, `detail ${exported.toFixed(1)} vs ${source.toFixed(1)}`);
    ok(`the PDF holds the exact ${original.length}-byte original (no JPEG re-encoding); detail ${(exported / source * 100).toFixed(0)}%`);

    await context.close();
  }

  console.log("\nTurning and turning back loses nothing");
  {
    const { context, page } = await openEditor();
    await addImage(page, files.standard);
    await page.getByRole("button", { name: "Rotate picture right" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Rotate picture left" }).click();
    await page.waitForTimeout(500);
    const pdf = await exportPdf(page, "standard-rot.pdf");
    const original = fs.readFileSync(files.standard);
    assert.ok((await pictures(pdf)).some((i) => i.bytes.equals(original)), "right then left leaves the original bytes exported (no generation loss)");
    ok("rotate right then left costs nothing: the original bytes are still what is exported");
    await context.close();
  }

  console.log("\nRotation and crop keep full resolution");
  {
    const { context, page } = await openEditor();
    await addImage(page, files.passport);
    await page.getByRole("button", { name: "Rotate picture right" }).click();
    await page.waitForTimeout(600);
    const pdf = await exportPdf(page, "rotated.pdf");
    const imgs = await pictures(pdf);
    const photo = imgs[0];
    assert.ok(photo && photo.width === 4000 && photo.height === 3000, `turned a quarter: ${photo?.width}x${photo?.height} (expected 4000x3000, nothing shrunk)`);
    ok(`a quarter turn exports 4000x3000 (all 12 megapixels kept)`);
    await context.close();
  }

  console.log("\nTransparent PNG logo");
  {
    const { context, page } = await openEditor();
    await addImage(page, files.logo);
    const box = await selection(page);
    const pdf = await exportPdf(page, "logo.pdf");
    const imgs = await pictures(pdf);
    const logo = imgs.find((i) => i.width === 1200 && i.height === 1200);
    assert.ok(logo, "the logo is embedded at its full 1200 x 1200: " + JSON.stringify(imgs.map((i) => [i.width, i.height, i.hasAlpha])));
    assert.ok(logo.hasAlpha, "it keeps its alpha channel");
    const canvas = await renderPage2(pdf);
    const px = canvas.getContext("2d").getImageData(Math.round((box.x + 0.003) * canvas.width), Math.round((box.y + 0.003) * canvas.height), 1, 1).data;
    assert.ok(px[0] > 240 && px[1] > 225 && px[2] < 215, `transparent corner shows the pale page, not white (${px[0]},${px[1]},${px[2]})`);
    ok("PNG logo embedded at 1200x1200 with alpha; no white box");
    await context.close();
  }

  console.log("\nLarge image");
  {
    const { context, page } = await openEditor();
    const t0 = Date.now();
    await addImage(page, files.huge);
    const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const pdf = await exportPdf(page, "huge.pdf");
    const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const imgs = await pictures(pdf);
    const big = imgs.find((i) => i.width >= 3000);
    assert.ok(big && big.width <= 4000 && big.height <= 4000, `scaled once to the 4000 px limit: ${big?.width}x${big?.height}`);
    assert.ok(heapAfter < 700 * 1024 * 1024, `JS heap stays reasonable (${Math.round(heapAfter / 1048576)} MB)`);
    assert.ok(fs.statSync(pdf).size < 40 * 1024 * 1024, "PDF size is sane: " + fs.statSync(pdf).size);
    ok(`6000x4500 PNG: embedded ${big.width}x${big.height}, heap ${Math.round(heapBefore / 1048576)}->${Math.round(heapAfter / 1048576)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s, PDF ${(fs.statSync(pdf).size / 1048576).toFixed(1)} MB`);
    await context.close();
  }

  console.log("\nLow-resolution picture");
  {
    const { context, page } = await openEditor();
    await addImage(page, files.tiny, "35x45mm");
    const warning = await page.getByText(/(Soft when printed|Low resolution): about \d+ dpi/).first().innerText();
    assert.match(warning, /dpi/);
    ok(`warns instead of pretending: "${warning.slice(0, 60)}..."`);
    await context.close();
  }

  assert.deepEqual(consoleErrors, [], "no console errors: " + consoleErrors.join(" | "));
  ok("no console or page errors");
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`\n${pass} checks passed`);
