// Shared helpers for the editor browser tests (tests/editor/*.mjs, tests/guidance/browser.mjs):
// fixtures made on the fly, a real Chrome/Edge driven with playwright-core, and readers for the
// PDF that comes out of the real download (so results are measured in the file, not the preview).
//
// Needs the app running: npm run build && npm run start -- -p 3117, then pass the base URL.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, PDFName, PDFRawStream, rgb, StandardFonts } from "pdf-lib";
import { renderPdf } from "../docx/pdftool.mjs";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright-core");
export const { createCanvas } = require("@napi-rs/canvas");
export { assert, fs, path, renderPdf, PDFDocument };

export const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3117";
export const work = fs.mkdtempSync(path.join(os.tmpdir(), "editor-ux-"));
export const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found. Set CHROME to a browser executable.");

export const LAYOUTS = [
  { label: "Phone (390x844, touch)", viewport: { width: 390, height: 844 }, mobile: true },
  { label: "Tablet (820x1180, touch)", viewport: { width: 820, height: 1180 }, mobile: true },
  { label: "Desktop (1440x900)", viewport: { width: 1440, height: 900 }, mobile: false },
  { label: "Wide desktop (2200x1100)", viewport: { width: 2200, height: 1100 }, mobile: false },
];

let pass = 0;
export const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};
export const passed = () => pass;

// ---- fixtures ------------------------------------------------------------------------------------
// A4 pages, pale yellow, with a coloured banner so page order is visible in the output.
export async function makePdf(name = "form.pdf", pages = 2) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colours = [rgb(0.1, 0.2, 0.85), rgb(0.05, 0.6, 0.15), rgb(0.7, 0.2, 0.6)];
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 0.97, 0.8) });
    page.drawRectangle({ x: 0, y: 760, width: 595.28, height: 82, color: colours[i % 3] });
    page.drawText(`PAGE ${i + 1}`, { x: 60, y: 700, size: 36, font, color: rgb(0.1, 0.1, 0.1) });
  }
  const file = path.join(work, name);
  fs.writeFileSync(file, await pdf.save());
  return file;
}

// A wide JPEG: blue sides and a red middle. Cropping it square keeps only red.
export function makePhoto(name = "photo.jpg", w = 3000, h = 2000, quality = 92) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0000d0";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d00000";
  ctx.fillRect(Math.round(w * 0.23), 0, Math.round(w * 0.54), h);
  const file = path.join(work, name);
  fs.writeFileSync(file, c.toBuffer("image/jpeg", quality));
  return file;
}

// A transparent PNG: a solid purple disc and nothing else.
export function makeLogo(name = "logo.png", size = 600) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#8000c0";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
  ctx.fill();
  const file = path.join(work, name);
  fs.writeFileSync(file, c.toBuffer("image/png"));
  return file;
}

// A signature: a thick blue stroke on a transparent background.
export function makeSignature(name = "signature.png") {
  const c = createCanvas(600, 200);
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "#0000ff";
  ctx.lineWidth = 22;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(40, 150);
  ctx.bezierCurveTo(150, 10, 250, 190, 360, 60);
  ctx.lineTo(560, 140);
  ctx.stroke();
  const file = path.join(work, name);
  fs.writeFileSync(file, c.toBuffer("image/png"));
  return file;
}

// ---- measuring a rendered page --------------------------------------------------------------------
export function boxOf(canvas, predicate) {
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
export const isRed = (r, g, b) => r > 170 && g < 60 && b < 60;
export const isBlue = (r, g, b) => b > 190 && r < 60 && g < 60;
export const isSignatureBlue = (r, g, b) => b > 200 && r < 70 && g < 70;
export const isPurple = (r, g, b) => r > 100 && r < 160 && g < 40 && b > 160;
export const isTextRed = (r, g, b) => r > 170 && g < 90 && b < 90;

// The images embedded in a PDF page: pixel size, filter (DCTDecode = JPEG), whether it has an alpha
// mask, the raw stream length, and where/how big it is drawn (from the page's content stream).
export async function embeddedImages(file, pageIndex = 0) {
  const pdf = await PDFDocument.load(fs.readFileSync(file));
  const page = pdf.getPage(pageIndex);
  const { width: pageW, height: pageH } = page.getSize();
  const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"));
  const found = new Map();
  if (xobjects) {
    for (const [name, ref] of xobjects.dict) {
      const obj = pdf.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) continue;
      const d = obj.dict;
      if (d.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
      const filter = d.get(PDFName.of("Filter"))?.toString();
      found.set(name.toString(), {
        name: name.toString(),
        width: Number(d.get(PDFName.of("Width"))?.toString()),
        height: Number(d.get(PDFName.of("Height"))?.toString()),
        filter,
        hasAlpha: !!d.get(PDFName.of("SMask")),
        bytes: obj.contents.length,
        contents: obj.contents,
      });
    }
  }
  // Where each is drawn: "q w 0 0 h x y cm /Name Do Q".
  const content = pdf.context.lookup(page.node.Contents());
  const streams = content?.asArray ? content.asArray().map((r) => pdf.context.lookup(r)) : [content];
  const { decodePDFRawStream } = await import("pdf-lib");
  let text = "";
  for (const s of streams) if (s) text += Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") + "\n";
  const placed = [];
  // Each drawn picture is a block "q <cm> <cm> ... /Name Do Q"; the transforms multiply into one matrix.
  for (const block of text.matchAll(/q([\s\S]*?)\/(\S+)\s+Do\s+Q/g)) {
    const img = found.get("/" + block[2]);
    if (!img) continue;
    let m = [1, 0, 0, 1, 0, 0];
    for (const cm of block[1].matchAll(/([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm/g)) {
      const [a, b, c, d, e, f] = cm.slice(1).map(Number);
      // CTM' = cm x CTM
      m = [a * m[0] + b * m[2], a * m[1] + b * m[3], c * m[0] + d * m[2], c * m[1] + d * m[3], e * m[0] + f * m[2] + m[4], e * m[1] + f * m[3] + m[5]];
    }
    const w = Math.hypot(m[0], m[1]);
    const h = Math.hypot(m[2], m[3]);
    placed.push({ ...img, drawnWidthPt: w, drawnHeightPt: h, xPt: m[4], yPt: m[5], dpiX: (img.width / w) * 72, dpiY: (img.height / h) * 72, pageW, pageH });
  }
  return placed;
}

// ---- driving the app -----------------------------------------------------------------------------
export async function launch() {
  return chromium.launch({ executablePath: CHROME, headless: true });
}

export async function session(browser, { viewport, mobile = false, storage } = {}) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, acceptDownloads: true, deviceScaleFactor: mobile ? 2 : 1 });
  if (storage) await context.addInitScript((entries) => { for (const [k, v] of Object.entries(entries)) { try { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } catch {} } }, storage);
  const page = await context.newPage();
  const errors = [];
  page.__errors = errors;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text()) && errors.push(m.text()));
  const outbound = [];
  await page.route("**/api/analytics/**", (route) => route.fulfill({ status: 202, json: { ok: true } }));
  page.on("request", (r) => {
    if (r.method() === "POST" && !r.url().includes("/api/analytics/")) outbound.push(r.url());
  });
  return { context, page, errors, outbound };
}

export async function rejectCookies(page) {
  try {
    await page.getByRole("button", { name: "Reject non-essential" }).click({ timeout: 8000 });
  } catch {
    // Already decided in this profile.
  }
}

export async function ready(page, count) {
  await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label="Pages"] li').length === n, count, { timeout: 40000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Detecting document") && !document.body.innerText.includes("Importing PDF"), null, { timeout: 40000 });
}

export async function openWorkspace(page, file, pages = 2, route = "/tools/pdf-editor") {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await rejectCookies(page);
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(file);
  await ready(page, pages);
}

export async function openAnnotator(page, pageNumber = 1) {
  await page.locator('ul[aria-label="Pages"] li button').nth(pageNumber - 1).click();
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  await page.locator('[data-assistant-id="page-annotate"]').click();
  await page.getByRole("dialog", { name: /Annotate page/ }).waitFor();
}

export const surface = (page) => page.locator('[role="application"][aria-label="Page annotation area"]');
export async function surfaceBox(page) {
  const box = await surface(page).boundingBox();
  assert.ok(box && box.width > 50, "the page surface has a size");
  return box;
}
// The dashed selection box as fractions of the page.
export async function selection(page) {
  const f = await surfaceBox(page);
  const b = await page.locator('[role="application"] .border-dashed').first().boundingBox();
  assert.ok(b, "something is selected");
  return { x: (b.x - f.x) / f.width, y: (b.y - f.y) / f.height, w: b.width / f.width, h: b.height / f.height };
}
export async function atFraction(page, fx, fy) {
  const f = await surfaceBox(page);
  return { x: f.x + f.width * fx, y: f.y + f.height * fy };
}

export async function addText(page, fx, fy, text, colour = "#d32f2f") {
  await page.locator('[data-assistant-id="annotation-tool-text"]').click();
  await page.getByRole("button", { name: `Colour ${colour}` }).click();
  const p = await atFraction(page, fx, fy);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type(text);
  await page.locator('[data-assistant-id="annotation-tool-select"]').click();
  await page.waitForTimeout(100);
}

export async function addSignature(page, file) {
  await page.locator('[data-assistant-id="annotation-tool-signature"]').click();
  await page.getByRole("tab", { name: "Upload Signature" }).click();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(file);
  await page.getByAltText("Uploaded signature preview").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.locator('[role="application"] .border-dashed').first().waitFor();
}

export async function addImage(page, file, { preset } = {}) {
  await page.locator('[data-assistant-id="annotation-tool-image"]').click();
  await page.locator('[data-assistant-id="image-file-input"]').setInputFiles(file);
  await page.getByAltText("Your picture, ready to place on the page").waitFor({ timeout: 20000 });
  if (preset) await page.locator("#image-size").selectOption(preset);
  await page.getByRole("button", { name: "Place on page" }).click();
  await page.locator('[role="application"] .border-dashed').first().waitFor();
}

export async function selectAt(page, fx, fy) {
  await page.locator('[data-assistant-id="annotation-tool-select"]').click();
  const p = await atFraction(page, fx, fy);
  await page.mouse.click(p.x, p.y);
}

export async function finishEditing(page) {
  await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  await page.getByRole("dialog", { name: /Edit page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
}

export async function exportPdf(page, name) {
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  const download = page.waitForEvent("download", { timeout: 90000 });
  await page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 90000 });
  const file = path.join(work, name);
  await (await download).saveAs(file);
  return file;
}

export async function renderPages(file, tag, scale = 1.5) {
  return renderPdf(file, path.join(work, "render-" + tag), scale);
}

// A real finger, through the browser's own touch pipeline (pointer events with pointerType "touch").
export async function touchDrag(page, from, to, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

export const viewportScroll = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-editor-stage] > div");
    return el ? { left: el.scrollLeft, top: el.scrollTop, maxLeft: el.scrollWidth - el.clientWidth, maxTop: el.scrollHeight - el.clientHeight } : null;
  });
