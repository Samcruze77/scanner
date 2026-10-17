// Shared helpers for the output-quality audit: drive the real app in Chrome, capture the actual
// downloaded bytes, and measure them (PDF pages, text layer, images and their effective DPI, vector
// operators, fonts) with pdf.js and pdf-lib.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { openPdf } from "../docx/pdftool.mjs";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright-core");
export const { createCanvas, loadImage } = require("@napi-rs/canvas");
export const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
export const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3117";
export const work = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
export const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));

export async function newPage(browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  await page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  return { context, page };
}
export async function visit(page, url) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("button", { name: "Reject non-essential" }).click({ timeout: 6000 });
  } catch {
    /* already chosen */
  }
}
export async function saveDownload(page, trigger, name) {
  const waiting = page.waitForEvent("download", { timeout: 180000 });
  await trigger();
  const dl = await waiting;
  const file = path.join(work, name);
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename() };
}

// ---- PDF measurement -----------------------------------------------------------------------------
const mmOf = (pt) => (pt * 25.4) / 72;
export async function pdfReport(file, markers = []) {
  const pdf = await openPdf(file);
  const { OPS } = pdfjs;
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  const pages = [];
  let allText = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const view = page.view;
    const widthPt = view[2] - view[0];
    const heightPt = view[3] - view[1];
    const text = (await page.getTextContent()).items.map((i) => i.str).join(" ");
    allText += "\n" + text;
    const ops = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const images = [];
    let pathOps = 0;
    ops.fnArray.forEach((fn, i) => {
      const a = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = mul(a, ctm);
      else if (fn === OPS.constructPath) pathOps++;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        const wIn = Math.hypot(ctm[0], ctm[1]) / 72;
        const hIn = Math.hypot(ctm[2], ctm[3]) / 72;
        const px = fn === OPS.paintImageXObject ? [a[1], a[2]] : [a[0]?.width, a[0]?.height];
        images.push({ px, wMm: +mmOf(Math.hypot(ctm[0], ctm[1])).toFixed(1), hMm: +mmOf(Math.hypot(ctm[2], ctm[3])).toFixed(1), dpi: wIn ? Math.round(px[0] / wIn) : null });
      }
    });
    pages.push({ n, widthPt: +widthPt.toFixed(1), heightPt: +heightPt.toFixed(1), widthMm: +mmOf(widthPt).toFixed(1), heightMm: +mmOf(heightPt).toFixed(1), orientation: widthPt > heightPt ? "landscape" : "portrait", textChars: text.length, images, pathOps });
  }
  const found = markers.map((m) => [m, allText.includes(m)]);
  await pdf.destroy();
  return { bytes: fs.statSync(file).size, pageCount: pages.length, pages, textChars: allText.trim().length, markersFound: found.filter(([, ok]) => ok).length, missing: found.filter(([, ok]) => !ok).map(([m]) => m), markersTotal: markers.length, allText };
}

// Raw embedded image streams (to compare bytes and pixels with the source).
export async function embeddedStreams(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  const out = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.lookup(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    out.push({ width: Number(d.lookup(PDFName.of("Width")).toString()), height: Number(d.lookup(PDFName.of("Height")).toString()), filter: d.lookup(PDFName.of("Filter"))?.toString() ?? "", hasAlpha: !!d.lookup(PDFName.of("SMask")), bytes: Buffer.from(obj.contents) });
  }
  return out;
}

export async function renderPage(file, pageNo, scale) {
  const pdf = await openPdf(file);
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  await pdf.destroy();
  return canvas;
}

// Fine-detail measure: mean absolute difference between horizontal AND vertical neighbours.
export function detail(canvas, box = { x: 0, y: 0, w: 1, h: 1 }) {
  const ctx = canvas.getContext("2d");
  const x0 = Math.round(box.x * canvas.width), y0 = Math.round(box.y * canvas.height);
  const w = Math.max(2, Math.round(box.w * canvas.width)), h = Math.max(2, Math.round(box.h * canvas.height));
  const d = ctx.getImageData(x0, y0, w, h).data;
  let sum = 0, n = 0;
  for (let y = 1; y < h; y += 2)
    for (let x = 1; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const l = i - 4, u = i - w * 4;
      sum += Math.abs(d[i] - d[l]) + Math.abs(d[i + 1] - d[l + 1]) + Math.abs(d[i + 2] - d[l + 2]) + Math.abs(d[i] - d[u]) + Math.abs(d[i + 1] - d[u + 1]) + Math.abs(d[i + 2] - d[u + 2]);
      n += 2;
    }
  return sum / n;
}

// PSNR between two canvases after scaling both to the same size (higher = closer; ~40 dB+ is visually identical).
export async function psnr(aBuf, bBuf, size = 1000) {
  const [a, b] = await Promise.all([loadImage(aBuf), loadImage(bBuf)]);
  const scale = Math.min(1, size / Math.max(a.width, a.height));
  const w = Math.max(1, Math.round(a.width * scale)), h = Math.max(1, Math.round(a.height * scale));
  const draw = (img) => {
    const c = createCanvas(w, h);
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.fillStyle = "#fff";
    x.fillRect(0, 0, w, h);
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const da = draw(a), db = draw(b);
  let se = 0;
  for (let i = 0; i < da.length; i += 4) for (let k = 0; k < 3; k++) se += (da[i + k] - db[i + k]) ** 2;
  const mse = se / ((da.length / 4) * 3);
  return mse === 0 ? 99 : +(10 * Math.log10((255 * 255) / mse)).toFixed(1);
}

export const results = [];
export function record(entry) {
  results.push(entry);
  console.log(`[${entry.status}] ${entry.feature} | ${entry.input} -> ${entry.output}\n      ${entry.summary}`);
}
