// PDF inspection helpers for the fidelity tests, built on pdfjs-dist (the same
// library the app uses to read PDFs) and @napi-rs/canvas for rasterising.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { createCanvas } = require("@napi-rs/canvas");

const standardFontDataUrl = pathToFileURL(path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep).href;

export async function openPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const task = pdfjs.getDocument({ data, standardFontDataUrl, useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  // pdf.js v6 moved destroy() to the loading task.
  pdf.destroy = () => task.destroy();
  return pdf;
}

// Text items grouped into visual lines per page: { page, x, y (from the top of
// the page, at the baseline), size, font, text }.
export async function extractLines(file) {
  const pdf = await openPdf(file);
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const view = page.view;
    const height = view[3] - view[1];
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => i.str !== undefined && i.str.trim() !== "")
      .map((i) => ({
        x: i.transform[4],
        y: height - i.transform[5],
        size: Math.hypot(i.transform[0], i.transform[1]),
        font: (content.styles[i.fontName]?.fontFamily ?? i.fontName) + "",
        text: i.str,
        width: i.width,
      }));
    // Group items that share a baseline (within 1.5pt) into lines.
    const lines = [];
    for (const item of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const line = lines.find((l) => Math.abs(l.y - item.y) < 1.5);
      if (line) {
        line.items.push(item);
      } else {
        lines.push({ y: item.y, items: [item] });
      }
    }
    for (const l of lines) l.items.sort((a, b) => a.x - b.x);
    pages.push({
      number: n,
      width: view[2] - view[0],
      height,
      lines: lines
        .sort((a, b) => a.y - b.y)
        .map((l) => ({
          y: l.y,
          x: l.items[0].x,
          right: Math.max(...l.items.map((i) => i.x + i.width)),
          size: l.items[0].size,
          text: l.items.map((i) => i.text).join(" ").replace(/\s+/g, " ").trim(),
        })),
    });
  }
  await pdf.destroy();
  return pages;
}

export async function renderPdf(file, outPrefix, scale = 1.25) {
  const pdf = await openPdf(file);
  const written = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    const out = `${outPrefix}-p${n}.png`;
    fs.writeFileSync(out, canvas.toBuffer("image/png"));
    written.push({ out, canvas });
  }
  await pdf.destroy();
  return written;
}

// Side-by-side image (Word | ours) per page for visual review.
export async function sideBySide(wordPdf, oursPdf, outPrefix, scale = 1.0) {
  const a = await renderPdf(wordPdf, outPrefix + ".word", scale);
  const b = await renderPdf(oursPdf, outPrefix + ".ours", scale);
  const count = Math.max(a.length, b.length);
  const outs = [];
  for (let i = 0; i < count; i++) {
    const left = a[i]?.canvas;
    const right = b[i]?.canvas;
    const w = (left?.width ?? 0) + (right?.width ?? 0) + 30;
    const h = Math.max(left?.height ?? 0, right?.height ?? 0);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#888";
    ctx.fillRect(0, 0, w, h);
    if (left) ctx.drawImage(left, 0, 0);
    if (right) ctx.drawImage(right, (left?.width ?? 0) + 30, 0);
    const out = `${outPrefix}-cmp-p${i + 1}.png`;
    fs.writeFileSync(out, canvas.toBuffer("image/png"));
    outs.push(out);
  }
  for (const r of [...a, ...b]) fs.unlinkSync(r.out);
  return outs;
}

export function cleanup(dir, pattern) {
  for (const f of fs.readdirSync(dir)) if (pattern.test(f)) fs.unlinkSync(path.join(dir, f));
}
