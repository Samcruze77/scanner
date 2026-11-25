// PDF -> JPG / PNG: the parts that don't need a browser (utils/convert/pdfToImageCore.ts).
// Page ranges, pixel sizes (incl. the iPhone canvas cap), file names, and the resolution written
// into real JPEG and PNG files, checked with an independent reader (sharp) and by re-decoding.
//   node --no-warnings --import ./tests/scanner/register.mjs tests/convert/pdf-to-image-core.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  imageFileName,
  MAX_CANVAS_PIXELS,
  pageRenderSize,
  parsePageRange,
  setImageDpi,
  setJpegDpi,
  setPngDpi,
} from "../../utils/convert/pdfToImageCore.ts";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ok  ", name);
  } catch (e) {
    failed++;
    console.log("  FAIL", name, "\n       ", e.message.split("\n")[0]);
  }
}

console.log("Page ranges");
await check("empty means every page", () => assert.deepEqual(parsePageRange("  ", 4), { pages: [1, 2, 3, 4] }));
await check("single pages, ranges, spaces, duplicates and order", () => {
  assert.deepEqual(parsePageRange("5, 1-3 ,2", 9), { pages: [1, 2, 3, 5] });
  assert.deepEqual(parsePageRange("7-5", 9), { pages: [5, 6, 7] }, "a reversed range is accepted");
  assert.deepEqual(parsePageRange("2 – 4", 9), { pages: [2, 3, 4] }, "an en dash works like a hyphen");
  assert.deepEqual(parsePageRange("1;3", 3), { pages: [1, 3] });
});
await check("out-of-range and malformed input are refused with a clear message", () => {
  assert.match(parsePageRange("0", 5).error, /pages 1 to 5/);
  assert.match(parsePageRange("4-9", 5).error, /pages 1 to 5/);
  assert.match(parsePageRange("2", 1).error, /only 1 page/);
  assert.match(parsePageRange("abc", 5).error, /isn't a page number/);
  assert.match(parsePageRange("1-", 5).error, /isn't a page number/);
  assert.match(parsePageRange(",", 5).error, /Enter the pages/);
});

console.log("Sizes");
await check("A4 portrait at 72 / 150 / 300 DPI", () => {
  const a4 = [595.28, 841.89];
  assert.deepEqual([pageRenderSize(...a4, 72).width, pageRenderSize(...a4, 72).height], [595, 842]);
  assert.deepEqual([pageRenderSize(...a4, 150).width, pageRenderSize(...a4, 150).height], [1240, 1754]);
  const hi = pageRenderSize(...a4, 300);
  assert.deepEqual([hi.width, hi.height, hi.capped, hi.effectiveDpi], [2480, 3508, false, 300]);
});
await check("US Letter landscape keeps its orientation", () => {
  const s = pageRenderSize(792, 612, 300);
  assert.deepEqual([s.width, s.height], [3300, 2550]);
});
await check("a poster-sized page is scaled down to the canvas limit and reports the resolution it really has", () => {
  const s = pageRenderSize(3000, 2000, 300); // ~42 x 28 inches
  assert.ok(s.capped);
  assert.ok(s.width * s.height <= MAX_CANVAS_PIXELS, `${s.width}x${s.height}`);
  assert.ok(s.effectiveDpi < 300 && s.effectiveDpi > 90, `effective ${s.effectiveDpi}`);
  assert.equal(Math.round((s.width / 3000) * 72), s.effectiveDpi);
});

console.log("File names");
await check("one-page PDFs keep the plain name; longer ones are numbered and zero-padded so they sort", () => {
  assert.equal(imageFileName("Invoice", 1, 1, "jpg"), "Invoice.jpg");
  assert.equal(imageFileName("Invoice", 3, 9, "png"), "Invoice-page-03.png");
  assert.equal(imageFileName("Book", 7, 120, "jpg"), "Book-page-007.jpg");
  assert.equal(imageFileName("Résumé 名前", 2, 2, "jpg"), "Résumé 名前-page-02.jpg");
});

console.log("Resolution written into the files");
function sampleCanvas() {
  const c = createCanvas(120, 80);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 120, 80);
  g.fillStyle = "#123";
  g.fillRect(10, 10, 60, 30);
  return c;
}
await check("JPEG: JFIF density set to the chosen DPI; the image still decodes the same", async () => {
  const jpg = new Uint8Array(sampleCanvas().toBuffer("image/jpeg", 90));
  const out = setJpegDpi(jpg, 300);
  assert.equal(out.length, jpg.length, "only header bytes change");
  const meta = await sharp(Buffer.from(out)).metadata();
  assert.equal(meta.density, 300);
  const img = await loadImage(Buffer.from(out));
  assert.deepEqual([img.width, img.height], [120, 80]);
});
await check("PNG: a pHYs chunk with a valid CRC is added after IHDR; decodes unchanged; a second call replaces it", async () => {
  const png = new Uint8Array(sampleCanvas().toBuffer("image/png"));
  const once = setPngDpi(png, 150);
  const twice = setPngDpi(once, 300);
  assert.equal(once.length, png.length + 21);
  assert.equal(twice.length, png.length + 21, "replaced, not duplicated");
  assert.equal((await sharp(Buffer.from(once)).metadata()).density, 150);
  assert.equal((await sharp(Buffer.from(twice)).metadata()).density, 300);
  // sharp/libpng verify chunk CRCs: decoding the full image proves the new chunk is well formed.
  const { info } = await sharp(Buffer.from(twice)).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [120, 80]);
  const img = await loadImage(Buffer.from(twice));
  assert.deepEqual([img.width, img.height], [120, 80]);
});
await check("anything that isn't the expected JPEG/PNG is returned untouched", () => {
  const junk = new Uint8Array([1, 2, 3, 4, 5]);
  assert.equal(setJpegDpi(junk, 300), junk);
  assert.equal(setPngDpi(junk, 300), junk);
  assert.equal(setImageDpi(junk, "jpg", 300), junk);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
