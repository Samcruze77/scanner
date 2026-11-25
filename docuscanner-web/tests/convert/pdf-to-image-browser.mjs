// PDF -> JPG / PNG in a real browser against a production build, with every downloaded image
// opened and measured:
//   * format, pixel size and the resolution written in the file (read independently with sharp);
//   * fidelity: each image is compared (PSNR) with an independent render of the same PDF page by
//     pdf.js in Node -- a blank, cropped, stretched or wrong page fails;
//   * page orientation (landscape pages, a page with /Rotate), page ranges, a single page vs a ZIP,
//     file names, the canvas cap for poster-sized pages, the memory limit for long documents;
//   * errors: password-protected, damaged and non-PDF files;
//   * the short redirect URLs, the PNG page's defaults, phone width, no leaked preview URLs.
//
//   node tests/convert/pdf-to-image-browser.mjs [baseUrl]   (needs `npm run build && npm run start`)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { BASE, CHROME, chromium, newPage, saveDownload, visit, work, psnr } from "../audit/lib.mjs";
import { protectPdf } from "../../utils/protect/protect.ts";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const JSZip = require("jszip");
const { PDFDocument, StandardFonts, degrees, rgb } = require("pdf-lib");
const createModule = require("@neslinesli93/qpdf-wasm");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const C = (n) => path.join(root, "tests", "audit", "corpus", n);
const createQpdf = async () => createModule({ locateFile: () => path.join(root, "node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm"), noInitialRun: true });

// ---- fixtures --------------------------------------------------------------------------------------
async function pdfWith(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const { size, rotate, label } of pages) {
    const page = doc.addPage(size);
    page.drawRectangle({ x: 20, y: 20, width: size[0] - 40, height: size[1] - 40, borderColor: rgb(0.1, 0.2, 0.6), borderWidth: 6 });
    page.drawText(label, { x: 60, y: size[1] - 120, size: Math.min(60, size[0] / 12), font, color: rgb(0, 0, 0) });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}
const fixture = (name, bytes) => {
  const f = path.join(work, name);
  fs.writeFileSync(f, bytes);
  return f;
};
const ROTATED = fixture("rotated.pdf", await pdfWith([{ size: [595.28, 841.89], rotate: 90, label: "ROTATED TOP" }]));
const POSTER = fixture("poster.pdf", await pdfWith([{ size: [3000, 2000], label: "POSTER" }]));
const LONG = fixture("long.pdf", await pdfWith(Array.from({ length: 60 }, (_, i) => ({ size: [595.28, 841.89], label: `PAGE ${i + 1}` }))));
const PROTECTED = fixture(
  "protected.pdf",
  (await protectPdf(new Uint8Array(fs.readFileSync(C("text.pdf"))), { password: "Secret-pass-123", allowPrint: true, allowCopy: true, allowEdit: false }, createQpdf)).data,
);
const CORRUPT = fixture("corrupt.pdf", Buffer.from("%PDF-1.7\nnot really a pdf\n%%EOF\n"));
const NOT_PDF = fixture("notes.txt", Buffer.from("just text"));

// ---- harness ---------------------------------------------------------------------------------------
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    const note = await fn();
    passed++;
    console.log(`  ✓ ${name}${note ? `  -- ${note}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(e.message).split("\n")[0]}`);
  }
}
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function openTool(route = "/convert/pdf-to-jpg", viewport) {
  const { context, page } = await newPage(browser, viewport);
  // Count preview/blob URLs that hold images (downloads are re-typed as octet-stream by downloadBlob).
  await context.addInitScript(() => {
    const live = new Map();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o) => { const u = create(o); live.set(u, o?.type ?? ""); return u; };
    URL.revokeObjectURL = (u) => { live.delete(u); return revoke(u); };
    window.__liveImageUrls = () => [...live.values()].filter((t) => t.startsWith("image/")).length;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await visit(page, route);
  // Choose files only once React has attached its handlers: on a deployed site hydration takes
  // longer than locally, and a file set before then is ignored (a person can't do this: the
  // button that opens the file picker needs the same JavaScript).
  await page.waitForFunction(() => {
    const zone = document.querySelector("[data-assistant-id=file-dropzone]");
    return !!zone && Object.keys(zone).some((k) => k.startsWith("__reactProps"));
  }, null, { timeout: 30000 });
  return { context, page, errors };
}
async function choose(page, file) {
  await page.locator('input[type="file"]').setInputFiles(file);
}
async function waitPages(page, n) {
  await page.getByText(`${n} page${n === 1 ? "" : "s"}`, { exact: true }).waitFor({ timeout: 30000 });
}
async function convert(page) {
  await page.locator("[data-assistant-id=convert-start]").click();
  await page.locator("[data-assistant-id=convert-download]").waitFor({ timeout: 180000 });
}
// The independent reference: pdf.js in Node with its standard fonts (without them it substitutes
// a narrow fallback font for Helvetica & co., and every comparison with a text page fails).
const { createCanvas } = require("@napi-rs/canvas");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const STANDARD_FONTS = path.join(root, "node_modules", "pdfjs-dist", "standard_fonts").split(path.sep).join("/") + "/";
// Fidelity: overlap (intersection over union) of the "ink" of two images, compared at half size.
// PSNR alone is unreliable for text pages, where Chrome and Node anti-alias small glyphs
// differently (the right page scores ~23 dB, barely above an unrelated page); ink overlap
// separates them clearly (right page ~0.8, a different page ~0.08, the same page shifted 2% ~0.10).
async function inkOverlap(a, b) {
  const meta = await sharp(a).metadata();
  const w = Math.round(meta.width / 2);
  const h = Math.round(meta.height / 2);
  const ink = async (buf) => {
    const { data } = await sharp(buf).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    return data;
  };
  const [A, B] = await Promise.all([ink(a), ink(b)]);
  let both = 0;
  let either = 0;
  for (let i = 0; i < A.length; i++) {
    const x = A[i] < 170;
    const y = B[i] < 170;
    if (x && y) both++;
    if (x || y) either++;
  }
  return either === 0 ? 1 : +(both / either).toFixed(3);
}
const MIN_OVERLAP = 0.6;

async function ref(file, pageNo, dpi) {
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), standardFontDataUrl: STANDARD_FONTS, verbosity: 0 });
  try {
    const page = await (await task.promise).getPage(pageNo);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await task.destroy();
  }
}

console.log(`PDF to JPG / PNG against ${BASE}`);

await test("all pages of a 3-page A4 PDF as JPG at 150 DPI: a ZIP of three correct, faithful images", async () => {
  const { context, page, errors } = await openTool();
  await choose(page, C("text.pdf"));
  await waitPages(page, 3);
  assert.equal(await page.locator('input[name="pdf-image-format"][value="jpg"]').isChecked(), true, "JPG is chosen on the JPG page");
  await convert(page);
  const dl = await saveDownload(page, () => page.locator("[data-assistant-id=convert-download]").click(), "text-jpg.zip");
  assert.equal(dl.suggested, "text-jpg.zip");
  const zip = await JSZip.loadAsync(fs.readFileSync(dl.file));
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ["text-page-01.jpg", "text-page-02.jpg", "text-page-03.jpg"]);
  const overlaps = [];
  for (const [i, name] of names.entries()) {
    const buf = await zip.file(name).async("nodebuffer");
    const meta = await sharp(buf).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, meta.density], ["jpeg", 1240, 1754, 150], name);
    overlaps.push(await inkOverlap(buf, await ref(C("text.pdf"), i + 1, 150)));
  }
  assert.ok(Math.min(...overlaps) >= MIN_OVERLAP, `ink overlap with an independent render: ${overlaps.join(", ")}`);
  assert.deepEqual(errors, []);
  await context.close();
  return `ink overlap ${overlaps.join(" / ")}`;
});

await test("one landscape page as PNG at 300 DPI: a single PNG at the right size, orientation and resolution", async () => {
  const { context, page } = await openTool();
  await choose(page, C("vector.pdf"));
  await waitPages(page, 2);
  await page.locator('input[name="pdf-image-format"][value="png"]').check();
  await page.locator('input[name="pdf-image-dpi"][value="300"]').check();
  await page.getByLabel("Pages to convert").fill("2");
  await convert(page);
  assert.match(await page.locator("[data-assistant-id=convert-download]").innerText(), /Download PNG/);
  const dl = await saveDownload(page, () => page.locator("[data-assistant-id=convert-download]").click(), "v2.png");
  assert.equal(dl.suggested, "vector-page-02.png");
  const buf = fs.readFileSync(dl.file);
  const meta = await sharp(buf).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.density], ["png", 3300, 2550, 300]);
  const reference = await ref(C("vector.pdf"), 2, 300);
  const overlap = await inkOverlap(buf, reference);
  assert.ok(overlap >= MIN_OVERLAP, `ink overlap ${overlap}`);
  const score = await psnr(buf, reference);
  await context.close();
  return `${(buf.length / 1024).toFixed(0)} KB, ink overlap ${overlap}, PSNR ${score} dB`;
});

await test("a page with /Rotate 90 comes out the way a PDF reader shows it (landscape)", async () => {
  const { context, page } = await openTool();
  await choose(page, ROTATED);
  await waitPages(page, 1);
  await page.locator('input[name="pdf-image-dpi"][value="72"]').check();
  await convert(page);
  const dl = await saveDownload(page, () => page.locator("[data-assistant-id=convert-download]").click(), "rot.jpg");
  assert.equal(dl.suggested, "rotated.jpg", "a one-page PDF keeps its plain name");
  const buf = fs.readFileSync(dl.file);
  const meta = await sharp(buf).metadata();
  assert.deepEqual([meta.width, meta.height], [842, 595]);
  const overlap = await inkOverlap(buf, await ref(ROTATED, 1, 72));
  assert.ok(overlap >= MIN_OVERLAP, `ink overlap ${overlap}`);
  await context.close();
  return `ink overlap ${overlap}`;
});

await test("a poster-sized page at 300 DPI is drawn within the canvas limit and records its real resolution", async () => {
  const { context, page } = await openTool();
  await choose(page, POSTER);
  await waitPages(page, 1);
  await page.locator('input[name="pdf-image-dpi"][value="300"]').check();
  assert.match(await page.locator("main").innerText(), /very large, so it is made at \d+ DPI/);
  await convert(page);
  const dl = await saveDownload(page, () => page.locator("[data-assistant-id=convert-download]").click(), "poster.jpg");
  const meta = await sharp(fs.readFileSync(dl.file)).metadata();
  assert.ok(meta.width * meta.height <= 16_000_000, `${meta.width}x${meta.height}`);
  assert.equal(meta.density, Math.round((meta.width / 3000) * 72));
  assert.ok(meta.density < 300);
  await context.close();
  return `${meta.width}x${meta.height} at ${meta.density} DPI`;
});

await test("60 A4 pages at 300 DPI is refused up front (memory); 150 DPI is allowed", async () => {
  const { context, page } = await openTool();
  await choose(page, LONG);
  await waitPages(page, 60);
  await page.locator('input[name="pdf-image-dpi"][value="300"]').check();
  assert.match(await page.locator('[role="alert"]').filter({ hasText: /too many pages/ }).innerText(), /300 DPI/);
  assert.equal(await page.locator("[data-assistant-id=convert-start]").isDisabled(), true);
  await page.locator('input[name="pdf-image-dpi"][value="150"]').check();
  assert.equal(await page.locator("[data-assistant-id=convert-start]").isDisabled(), false);
  await context.close();
});

await test("page ranges: an impossible page is explained and blocks Convert; 2-3 gives exactly those pages", async () => {
  const { context, page } = await openTool();
  await choose(page, C("text.pdf"));
  await waitPages(page, 3);
  await page.getByLabel("Pages to convert").fill("9");
  assert.match(await page.locator("#pdf-image-range-help").innerText(), /pages 1 to 3/);
  assert.equal(await page.locator("[data-assistant-id=convert-start]").isDisabled(), true);
  await page.getByLabel("Pages to convert").fill("2-3");
  await convert(page);
  assert.match(await page.locator("[data-assistant-id=convert-download]").innerText(), /2 images/);
  assert.deepEqual(await page.locator('ul[aria-label="Converted pages"] li').allInnerTexts().then((t) => t.map((s) => s.match(/Page (\d+)/)[1])), ["2", "3"]);
  await context.close();
});

for (const [label, file, expected] of [
  ["a password-protected PDF", PROTECTED, /password-protected/],
  ["a damaged PDF", CORRUPT, /valid PDF/],
  ["a file that isn't a PDF", NOT_PDF, /isn't a PDF/],
]) {
  await test(`${label} gives a clear message and no options to convert`, async () => {
    const { context, page, errors } = await openTool();
    await choose(page, file);
    const alert = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
    await alert.waitFor({ timeout: 30000 });
    assert.match(await alert.innerText(), expected);
    assert.equal(await page.locator("[data-assistant-id=convert-start]").count(), 0);
    assert.deepEqual(errors, []);
    const message = await alert.innerText();
    await context.close();
    return `"${message}"`;
  });
}

await test("the PDF to PNG page opens with PNG chosen", async () => {
  const { context, page } = await openTool("/convert/pdf-to-png");
  assert.equal(await page.locator("h1").innerText(), "Convert PDF to PNG");
  await choose(page, C("report.pdf"));
  await waitPages(page, 1);
  assert.equal(await page.locator('input[name="pdf-image-format"][value="png"]').isChecked(), true);
  assert.match(await page.locator("[data-assistant-id=convert-start]").innerText(), /Convert to PNG/);
  await context.close();
});

await test("short URLs redirect permanently to the tools", async () => {
  const got = {};
  for (const [from, to] of [["/pdf-to-jpg", "/convert/pdf-to-jpg"], ["/pdf-to-png", "/convert/pdf-to-png"], ["/pdf-to-image", "/convert/pdf-to-jpg"]]) {
    const res = await fetch(BASE + from, { redirect: "manual" });
    assert.ok([301, 308].includes(res.status), `${from} -> ${res.status}`);
    assert.equal(new URL(res.headers.get("location"), BASE).pathname, to);
    got[from] = res.status;
  }
  return JSON.stringify(got);
});

await test("phone width: no sideways scroll with results shown; previews are released when you start over", async () => {
  const { context, page, errors } = await openTool("/convert/pdf-to-jpg", { width: 375, height: 812 });
  await choose(page, C("rich.pdf"));
  await waitPages(page, 3);
  await convert(page);
  await page.locator('ul[aria-label="Converted pages"] img').first().waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
  assert.equal(await page.evaluate(() => window.__liveImageUrls()), 3, "one preview per page");
  await page.getByRole("button", { name: "Choose a different file" }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__liveImageUrls()), 0, "previews revoked");
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
