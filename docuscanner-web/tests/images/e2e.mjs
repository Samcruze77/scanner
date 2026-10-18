// End-to-end check of "Add image" in a real browser against a running production build, with a
// REAL export: a two-page PDF is opened, pictures are inserted (a passport-style photo at a stated
// size, and a transparent logo), moved, resized, removed and undone with real mouse input, the PDF
// is created and downloaded, and the downloaded file is rendered and measured.
//
//   npm run build && npm run start          (in another terminal)
//   node tests/images/e2e.mjs [baseUrl]      default http://localhost:3000
// Set CHROME to a browser executable to override auto-detection. Desktop and phone layouts both run.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { renderPdf } from "../docx/pdftool.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { createCanvas } = require("@napi-rs/canvas");
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "image-e2e-"));
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found. Set CHROME to a browser executable.");

let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};

// ---- fixtures ---------------------------------------------------------------------------------
// Page 1 has a BLUE banner, page 2 a GREEN banner; both pages are pale yellow so a white box
// around a transparent picture would show.
async function makeDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const [label, colour] of [["PAGE ONE", rgb(0.1, 0.2, 0.85)], ["PAGE TWO", rgb(0.05, 0.6, 0.15)]]) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 0.97, 0.8) });
    page.drawRectangle({ x: 0, y: 760, width: 595.28, height: 82, color: colour });
    page.drawText(label, { x: 60, y: 700, size: 36, font, color: rgb(0.1, 0.1, 0.1) });
  }
  const file = path.join(work, "form.pdf");
  fs.writeFileSync(file, await pdf.save());
  return file;
}

// A wide photo: the middle half is RED (the "face"), the outer parts BLUE. Cropping it to a
// portrait passport shape must keep only red.
function makePhoto() {
  const c = createCanvas(3000, 2000);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0000d0";
  ctx.fillRect(0, 0, 3000, 2000);
  ctx.fillStyle = "#d00000";
  ctx.fillRect(700, 0, 1600, 2000);
  const file = path.join(work, "passport.jpg");
  fs.writeFileSync(file, c.toBuffer("image/jpeg", 92));
  return file;
}

// A transparent PNG logo: a solid purple disc and nothing else.
function makeLogo() {
  const c = createCanvas(600, 600);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#8000c0";
  ctx.beginPath();
  ctx.arc(300, 300, 280, 0, Math.PI * 2);
  ctx.fill();
  const file = path.join(work, "logo.png");
  fs.writeFileSync(file, c.toBuffer("image/png"));
  return file;
}

const files = {
  pdf: await makeDocument(),
  photo: makePhoto(),
  logo: makeLogo(),
  notImage: path.join(work, "notes.txt"),
  renamedPdf: path.join(work, "fake.jpg"),
  corrupt: path.join(work, "broken.png"),
  gif: path.join(work, "anim.gif"),
  huge: path.join(work, "huge.png"),
};
fs.writeFileSync(files.notImage, "just some text");
fs.copyFileSync(files.pdf, files.renamedPdf);
fs.writeFileSync(files.corrupt, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a png at all")]));
fs.writeFileSync(files.gif, Buffer.from("GIF89a\x01\x00\x01\x00", "binary"));
{
  // A large (but valid) picture: 6000 x 4500 pixels. It must be scaled down, not crash the editor.
  const c = createCanvas(6000, 4500);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e08000";
  ctx.fillRect(0, 0, 6000, 4500);
  fs.writeFileSync(files.huge, c.toBuffer("image/png"));
}

// ---- measuring the exported PDF ----------------------------------------------------------------
function boxOf(canvas, predicate) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      if (predicate(d[j], d[j + 1], d[j + 2])) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  return count === 0 ? null : { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h, count, wPx: w, hPx: h };
}
const isRed = (r, g, b) => r > 170 && g < 60 && b < 60;
const isBlue = (r, g, b) => b > 150 && r < 60 && g < 60;
const isPurple = (r, g, b) => r > 100 && r < 160 && g < 40 && b > 160;
const isGreenBanner = (r, g, b) => g > 120 && r < 40 && b < 60;
const isBlueBanner = (r, g, b) => b > 190 && r < 60 && g < 90;
const isWhite = (r, g, b) => r > 250 && g > 250 && b > 250;

// ---- driving the editor --------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

async function session(viewport, isMobile = false) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text()) && consoleErrors.push(m.text()));
  // Nothing should be uploaded anywhere; also keep analytics quiet.
  const outbound = [];
  await page.route("**/api/analytics/**", (route) => route.fulfill({ status: 202, json: { ok: true } }));
  page.on("request", (r) => {
    if (r.method() === "POST" && !r.url().includes("/api/analytics/")) outbound.push(r.url());
  });
  return { context, page, outbound };
}

// The cookie banner is a fixed bar at the bottom; choose the privacy-preserving option like a visitor would.
async function rejectCookies(page) {
  const button = page.getByRole("button", { name: "Reject non-essential" });
  try {
    await button.click({ timeout: 8000 });
  } catch {
    // Already decided on this browser profile.
  }
}

async function openEditorOnPage(page, pageNumber) {
  await page.goto(BASE + "/tools/pdf-editor", { waitUntil: "domcontentloaded" });
  await rejectCookies(page);
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(files.pdf);
  await page.locator('ul[aria-label="Pages"] li').nth(1).waitFor({ timeout: 30000 });
  // Wait until both pages are ready (processing finished).
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Pages"] li').length === 2);
  await page.locator('ul[aria-label="Pages"] li button').nth(pageNumber - 1).click();
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  await page.locator('[data-assistant-id="page-annotate"]').click();
  await page.getByRole("dialog", { name: /Annotate page/ }).waitFor();
}

const frame = (page) => page.locator('[role="application"][aria-label="Page annotation area"]');
async function frameBox(page) {
  const box = await frame(page).boundingBox();
  assert.ok(box && box.width > 50, "page surface has a size");
  return box;
}
async function selectionFraction(page) {
  // The dashed selection box, as fractions of the page.
  const f = await frameBox(page);
  const b = await page.locator('[role="application"] .border-dashed').first().boundingBox();
  assert.ok(b, "a picture is selected");
  return { x: (b.x - f.x) / f.width, y: (b.y - f.y) / f.height, w: b.width / f.width, h: b.height / f.height };
}
async function addImage(page, file, { preset } = {}) {
  await page.locator('[data-assistant-id="annotation-tool-image"]').click();
  await page.locator('[data-assistant-id="image-file-input"]').setInputFiles(file);
  await page.getByAltText("Your picture, ready to place on the page").waitFor({ timeout: 20000 });
  if (preset) await page.locator("#image-size").selectOption(preset);
  await page.getByRole("button", { name: "Place on page" }).click();
  await page.locator('[role="application"] .border-dashed').first().waitFor();
}
async function dragSelection(page, dxFrac, dyFrac) {
  const f = await frameBox(page);
  const sel = await selectionFraction(page);
  const startX = f.x + (sel.x + sel.w / 2) * f.width;
  const startY = f.y + (sel.y + sel.h / 2) * f.height;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dxFrac * f.width * 0.5, startY + dyFrac * f.height * 0.5, { steps: 4 });
  await page.mouse.move(startX + dxFrac * f.width, startY + dyFrac * f.height, { steps: 6 });
  await page.mouse.up();
}
const annotationCount = (page) => page.evaluate(() => document.querySelectorAll('[role="application"] .border-dashed').length);

async function exportPdf(page, name) {
  await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  await page.getByRole("button", { name: "Done editing", exact: true }).click(); // the page editor underneath
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  const download = page.waitForEvent("download", { timeout: 60000 });
  await page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 60000 });
  const file = path.join(work, name);
  await (await download).saveAs(file);
  return file;
}

async function runLayout(label, viewport, isMobile) {
  console.log(`\n${label}`);
  const { context, page, outbound } = await session(viewport, isMobile);

  // Baseline: how the untouched pages render.
  await openEditorOnPage(page, 2);

  // 1. Insert a passport photograph with a stated size.
  await addImage(page, files.photo, { preset: "35x45mm" });
  let sel = await selectionFraction(page);
  assert.ok(Math.abs(sel.w * 210 - 35) < 1.2, `photo is ~35 mm wide on screen (got ${(sel.w * 210).toFixed(1)})`);
  assert.ok(Math.abs(sel.h * 297 - 45) < 1.2, `photo is ~45 mm tall on screen (got ${(sel.h * 297).toFixed(1)})`);
  ok("a passport photograph can be inserted at a stated 35 x 45 mm size");

  // 2. Move it, and check the page stays in bounds.
  const before = await selectionFraction(page);
  await dragSelection(page, 0.2, 0.3);
  const moved = await selectionFraction(page);
  assert.ok(moved.x > before.x + 0.12 && moved.y > before.y + 0.18, "the picture moved");
  await dragSelection(page, 3, 3); // far past the edge
  const edge = await selectionFraction(page);
  assert.ok(edge.x + edge.w <= 1.005 && edge.y + edge.h <= 1.005 && edge.x >= -0.005 && edge.y >= -0.005, "stays inside the page");
  await dragSelection(page, -0.55, -0.45);
  const placed1 = await selectionFraction(page);
  ok("the picture can be dragged and stays inside the page");

  // 3. Undo and redo the move.
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Redo" }).click();
  ok("undo and redo work for placing and moving");

  // 4. Add a second picture (transparent logo), resize it by its handle, move it.
  await page.mouse.click((await frameBox(page)).x + 5, (await frameBox(page)).y + 5); // deselect
  await addImage(page, files.logo);
  const logoStart = await selectionFraction(page);
  const handle = page.getByRole("button", { name: "Resize" });
  const hb = await handle.boundingBox();
  const f = await frameBox(page);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + f.width * 0.08, hb.y + hb.height / 2 + 4, { steps: 8 });
  await page.mouse.up();
  const logoResized = await selectionFraction(page);
  assert.ok(logoResized.w > logoStart.w + 0.04, "resize made it bigger");
  assert.ok(Math.abs((logoResized.w * f.width) / (logoResized.h * f.height) - 1) < 0.03, "resize kept the logo round (aspect ratio)");
  await dragSelection(page, 0.25, 0.35);
  const placed2 = await selectionFraction(page);
  ok("several pictures can be added; one can be resized without stretching");

  // 5. A third picture can be removed again.
  await page.mouse.click((await frameBox(page)).x + 5, (await frameBox(page)).y + 5);
  await addImage(page, files.huge);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(150);
  assert.equal(await annotationCount(page), 0, "deleted picture is gone (nothing selected)");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click(); // undo the add of the huge picture too
  ok("a picture can be removed, and a large (6000 x 4500) picture is handled");

  // 6. Cancel keeps existing work.
  await page.locator('[data-assistant-id="annotation-tool-image"]').click();
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await page.waitForTimeout(100);
  await page.mouse.click(f.x + f.width * (placed1.x + placed1.w / 2), f.y + f.height * (placed1.y + placed1.h / 2));
  assert.equal((await selectionFraction(page)).w > 0, true, "the photo is still there after cancelling");
  ok("cancelling the picture chooser leaves existing work alone");

  // 7. Export and measure the real PDF.
  const exported = await exportPdf(page, `export-${label.split(" ")[0].toLowerCase()}.pdf`);
  assert.ok(fs.statSync(exported).size > 5000);
  const pages = await renderPdf(exported, path.join(work, `render-${label.split(" ")[0]}`), 1.5);
  assert.equal(pages.length, 2, "page count unchanged");
  const [p1, p2] = pages;
  assert.ok(boxOf(p1.canvas, isBlueBanner), "page 1 still has its blue banner (order intact)");
  assert.equal(boxOf(p1.canvas, isGreenBanner), null, "page 1 is not page 2");
  assert.ok(boxOf(p2.canvas, isGreenBanner), "page 2 still has its green banner");
  assert.equal(boxOf(p1.canvas, isRed), null, "no picture leaked onto page 1");
  assert.equal(boxOf(p1.canvas, isPurple), null, "no logo leaked onto page 1");
  ok("existing page content and page order stay intact");

  const photo = boxOf(p2.canvas, isRed);
  assert.ok(photo, "the photograph is in the exported PDF");
  assert.equal(boxOf(p2.canvas, isBlue) === null || boxOf(p2.canvas, isBlue).y > 0.2 ? true : false, true);
  // The blue sides of the wide photo were cropped away: no blue below the banner.
  const body = createCanvas(p2.canvas.width, Math.round(p2.canvas.height * 0.8));
  body.getContext("2d").drawImage(p2.canvas, 0, Math.round(p2.canvas.height * 0.2), p2.canvas.width, Math.round(p2.canvas.height * 0.8), 0, 0, p2.canvas.width, Math.round(p2.canvas.height * 0.8));
  assert.equal(boxOf(body, isBlue), null, "the crop to a passport shape removed the blue sides");
  assert.ok(Math.abs(photo.w - placed1.w) < 0.012 && Math.abs(photo.h - placed1.h) < 0.012, `photo size matches the editor (export ${photo.w.toFixed(3)}x${photo.h.toFixed(3)} vs ${placed1.w.toFixed(3)}x${placed1.h.toFixed(3)})`);
  assert.ok(Math.abs(photo.x - placed1.x) < 0.012 && Math.abs(photo.y - placed1.y) < 0.012, `photo position matches the editor (export ${photo.x.toFixed(3)},${photo.y.toFixed(3)} vs ${placed1.x.toFixed(3)},${placed1.y.toFixed(3)})`);
  assert.ok(Math.abs(photo.w * 210 - 35) < 1.5 && Math.abs(photo.h * 297 - 45) < 1.5, `printed size is 35 x 45 mm (got ${(photo.w * 210).toFixed(1)} x ${(photo.h * 297).toFixed(1)})`);
  ok("the exported PDF has the photograph at the intended position and a true 35 x 45 mm size");

  const logo = boxOf(p2.canvas, isPurple);
  assert.ok(logo, "the logo is in the exported PDF");
  assert.ok(Math.abs(logo.x - placed2.x) < 0.015 && Math.abs(logo.y - placed2.y) < 0.015, "logo position matches the editor");
  assert.ok(Math.abs(logo.w - logo.h * (p2.canvas.height / p2.canvas.width)) < 0.012, "logo was not stretched in the export");
  // The area just inside the logo's box corner must still be the pale-yellow page, not a white box.
  const c = p2.canvas.getContext("2d");
  const px = Math.round((placed2.x + 0.004) * p2.canvas.width);
  const py = Math.round((placed2.y + 0.004) * p2.canvas.height);
  const [r, g, b] = c.getImageData(px, py, 1, 1).data;
  assert.ok(!isWhite(r, g, b) && r > 240 && g > 220 && b < 215, `transparent corner shows the page, not a white box (${r},${g},${b})`);
  ok("several pictures are in the export; transparency and proportions are preserved");

  assert.deepEqual(outbound, [], "no document or picture was uploaded: " + outbound.join(", "));
  ok("nothing was uploaded to any server");

  await context.close();
  return exported;
}

async function checkRejections() {
  console.log("\nUnsupported and damaged files");
  const { context, page } = await session({ width: 1280, height: 900 });
  await openEditorOnPage(page, 1);
  await page.locator('[data-assistant-id="annotation-tool-image"]').click();
  const input = page.locator('[data-assistant-id="image-file-input"]');
  const alertText = async () => (await page.getByRole("alert").first().innerText()).trim();

  await input.setInputFiles(files.notImage);
  await page.getByRole("alert").first().waitFor();
  assert.match(await alertText(), /not a picture/);
  ok("a text file gets an honest explanation");

  await input.setInputFiles(files.renamedPdf);
  await page.waitForFunction(() => /PDF, not a picture/.test(document.querySelector('[role="alert"]')?.textContent ?? ""));
  ok("a PDF renamed to .jpg is detected by its content");

  await input.setInputFiles(files.gif);
  await page.waitForFunction(() => /GIF/.test(document.querySelector('[role="alert"]')?.textContent ?? ""));
  ok("GIF is explained as unsupported");

  await input.setInputFiles(files.corrupt);
  await page.waitForFunction(() => /couldn.t be read|damaged/.test(document.querySelector('[role="alert"]')?.textContent ?? ""));
  ok("a damaged PNG is refused without crashing the editor");

  // The editor still works afterwards.
  await input.setInputFiles(files.logo);
  await page.getByAltText("Your picture, ready to place on the page").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Place on page" }).click();
  await page.locator('[role="application"] .border-dashed').first().waitFor();
  ok("the editor keeps working after rejected files");
  await context.close();
}

async function checkOtherDocumentTypes() {
  console.log("\nWord and Excel files become PDFs first");
  const { context, page } = await session({ width: 1280, height: 900 });
  await page.goto(BASE + "/tools/pdf-editor", { waitUntil: "domcontentloaded" });
  await rejectCookies(page);
  const docx = path.join(here, "..", "compress", "out", "survey.docx");
  if (!fs.existsSync(docx)) {
    console.log("      (no sample .docx found: skipped)");
    await context.close();
    return;
  }
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(docx);
  await page.locator('ul[aria-label="Pages"] li').first().waitFor({ timeout: 90000 });
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  await page.locator('[data-assistant-id="page-annotate"]').click();
  await addImage(page, files.logo);
  const exported = await exportPdf(page, "export-docx.pdf");
  const [p1] = await renderPdf(exported, path.join(work, "render-docx"), 1.2);
  assert.ok(boxOf(p1.canvas, isPurple), "the logo is in the PDF made from a Word document");
  ok("a Word document is converted to PDF and a picture is inserted into it (output is PDF)");
  await context.close();
}

try {
  await runLayout("Desktop layout (1280x900)", { width: 1280, height: 900 }, false);
  await runLayout("Phone layout (390x844, touch)", { width: 390, height: 844 }, true);
  await checkRejections();
  await checkOtherDocumentTypes();
  assert.deepEqual(consoleErrors, [], "no console errors: " + consoleErrors.join(" | "));
  ok("no console or page errors during any of the above");
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`\n${pass} checks passed`);
