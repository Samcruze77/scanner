// Measures whether text in a scanned page stays readable at each compression
// level: a 300 dpi A4 page of body text is turned into a scan-style JPEG PDF,
// compressed at every level, re-rendered at the resolution a person would read it
// (150 dpi) and run through OCR. The share of words recovered is the score.
//
// Run: node tests/compress/readability.mjs

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { createWorker } from "tesseract.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { createCanvas } = require("@napi-rs/canvas");
const { compressPdf } = await import("../../utils/compress/pdf.ts");
const { COMPRESSION_LEVELS, formatBytes } = await import("../../utils/compress/types.ts");
const sharp = (await import("sharp")).default;
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const codec = {
  async decode(data) {
    const meta = await sharp(data, { failOn: "none" }).metadata();
    return {
      width: meta.width,
      height: meta.height,
      hasAlpha: false,
      async encode({ maxDim, quality, format }) {
        let p = sharp(data, { failOn: "none" }).rotate();
        if (maxDim && Math.max(meta.width, meta.height) > maxDim) p = p.resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true });
        p = p.flatten({ background: "#fff" }).toColourspace("srgb").jpeg({ quality: Math.round(quality * 100) });
        const { data: out, info } = await p.toBuffer({ resolveWithObject: true });
        return { data: new Uint8Array(out), mime: `image/${format}`, width: info.width, height: info.height };
      },
      dispose() {},
    };
  },
};

const WORDS = "invoice payment total amount received account number balance statement quarterly report customer address delivery order reference contract signed approved period charge summary".split(" ");
function makePage() {
  const W = 2480;
  const H = 3508;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "44px Arial"; // about 10.5 pt at 300 dpi: ordinary body text
  const expected = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let line = 0; line < 52; line++) {
    const words = Array.from({ length: 9 }, () => WORDS[Math.floor(rnd() * WORDS.length)]);
    ctx.fillText(words.join(" "), 200, 260 + line * 62);
    expected.push(...words);
  }
  // A little scanner noise so it doesn't compress like a clean render.
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return { jpeg: canvas.toBuffer("image/jpeg", 88), expected };
}

const { jpeg, expected } = makePage();
const src = await PDFDocument.create();
const page = src.addPage([595, 842]);
page.drawImage(await src.embedJpg(jpeg), { x: 0, y: 0, width: 595, height: 842 });
const original = await src.save();

async function renderAt150(pdfBytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0 });
  const doc = await task.promise;
  const p = await doc.getPage(1);
  const viewport = p.getViewport({ scale: 150 / 72 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await p.render({ canvasContext: ctx, viewport, canvas }).promise;
  await task.destroy();
  return canvas.toBuffer("image/png");
}

const worker = await createWorker("eng", 1, {
  langPath: path.join(here, "..", "..", "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int"),
  gzip: true,
  cachePath: path.join(here, "out"),
});

function recall(text) {
  const got = new Map();
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) got.set(w, (got.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of expected) {
    const n = got.get(w) ?? 0;
    if (n > 0) {
      hit++;
      got.set(w, n - 1);
    }
  }
  return hit / expected.length;
}

console.log(`Scan-style A4 page at 300 dpi, ${expected.length} words. Original PDF ${formatBytes(original.length)}`);
const base = await worker.recognize(await renderAt150(original));
console.log(`  original           ${formatBytes(original.length).padStart(8)}  words read ${(recall(base.data.text) * 100).toFixed(1)}%`);
let worst = 1;
for (let level = 0; level < COMPRESSION_LEVELS.length; level++) {
  const r = await compressPdf({ data: original, name: "scan.pdf" }, { target: null, strong: false, level }, { codec });
  const ocr = await worker.recognize(await renderAt150(r.data));
  const score = recall(ocr.data.text);
  if (level < 3) worst = Math.min(worst, score);
  console.log(`  ${COMPRESSION_LEVELS[level].short.padEnd(9)} ${String(r.outcome).padEnd(10)} ${formatBytes(r.compressedBytes).padStart(8)}  -${String(r.reductionPct).padStart(4)}%  words read ${(score * 100).toFixed(1)}%`);
}
await worker.terminate();
process.exitCode = worst >= 0.95 ? 0 : 1;
