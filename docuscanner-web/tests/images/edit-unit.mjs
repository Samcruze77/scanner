// Unit checks for the Edit Image tool's pure logic: the edit model, crop maths, size and format decisions, and the
// drawing code itself (run here on a Node canvas, so pixel results are exact and repeatable).
//   node --no-warnings --import ./tests/scanner/register.mjs tests/images/edit-unit.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ASPECT_PRESETS, fitAspect, HANDLES, moveRect, nudgeStep, normalizeRect, resizeRect } from "../../utils/imageEdit/crop.ts";
import {
  availableFormats,
  checkInput,
  encoderQuality,
  exportFileName,
  isHexColour,
  LOAD_MESSAGES,
  planExport,
  readStoredSize,
  sniffFormat,
  sniffOutput,
  webpEncoding,
} from "../../utils/imageEdit/formats.ts";
import {
  adjustmentCurve,
  flipHorizontal,
  flipVertical,
  geometry,
  IDENTITY_STATE,
  isIdentity,
  isUpscaled,
  LIMITS,
  outputProblem,
  rotateBy,
  sourceRectToView,
  viewRectToSource,
  withAdjustments,
  withCrop,
  withResize,
} from "../../utils/imageEdit/ops.ts";
import { makeProxy, renderEdited } from "../../utils/imageEdit/render.ts";
import { applyAdjustments } from "../../utils/scanner/enhance.ts";
import { compareRgba, createCanvas, cropRgba, decodeRgba, flipRgba, makeEditFixtures, mulberry32, rotateRgba } from "./edit-fixtures.mjs";

let pass = 0;
const test = async (name, fn) => {
  await fn();
  pass++;
  console.log("  ok  " + name);
};
const factory = (w, h) => createCanvas(w, h);
const rgbaOf = (canvas) => ({ width: canvas.width, height: canvas.height, data: canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data });
const S = (over = {}) => ({ ...IDENTITY_STATE, ...over });

// A small picture whose every pixel is different, so any shift, flip or turn shows up.
function pattern(w, h, alpha = false) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const rand = mulberry32(7);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = Math.floor(rand() * 256);
    img.data[i * 4 + 1] = Math.floor(rand() * 256);
    img.data[i * 4 + 2] = Math.floor(rand() * 256);
    img.data[i * 4 + 3] = alpha ? (i % 3 === 0 ? 0 : 255) : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

console.log("Edit model");
await test("a fresh state changes nothing and keeps the natural size", () => {
  assert.ok(isIdentity(IDENTITY_STATE, 4000, 3000));
  const g = geometry(4000, 3000, IDENTITY_STATE);
  assert.deepEqual([g.outW, g.outH], [4000, 3000]);
});
await test("crop, rotation and resize give the final size in the documented order", () => {
  const crop = withCrop(IDENTITY_STATE, { x: 100, y: 50, w: 1000, h: 500 }, 4000, 3000);
  let g = geometry(4000, 3000, crop);
  assert.deepEqual([g.outW, g.outH], [1000, 500]);
  g = geometry(4000, 3000, rotateBy(crop, 1));
  assert.deepEqual([g.outW, g.outH], [500, 1000]);
  const sized = withResize(rotateBy(crop, 1), 4000, 3000, { w: 250 }, true);
  g = geometry(4000, 3000, sized);
  assert.deepEqual([g.outW, g.outH], [250, 500]);
});
await test("a crop is kept inside the picture and the size restarts from the new shape", () => {
  const sized = withResize(IDENTITY_STATE, 100, 80, { w: 50 }, true);
  assert.deepEqual(sized.resize, { w: 50, h: 40 });
  const c = withCrop(sized, { x: -5, y: 70, w: 500, h: 500 }, 100, 80);
  assert.equal(c.resize, null);
  assert.deepEqual(c.crop, { x: 0, y: 70, w: 100, h: 10 });
  assert.equal(withCrop(IDENTITY_STATE, { x: 0, y: 0, w: 100, h: 80 }, 100, 80).crop, null);
});
await test("rotating a chosen size swaps its sides; four turns come back", () => {
  let s = withResize(IDENTITY_STATE, 400, 300, { w: 200 }, true);
  s = rotateBy(s, 1);
  assert.deepEqual(s.resize, { w: 150, h: 200 });
  for (let i = 0; i < 3; i++) s = rotateBy(s, 1);
  assert.equal(s.rotation, 0);
  assert.deepEqual(s.resize, { w: 200, h: 150 });
  assert.equal(rotateBy(S(), -1).rotation, 270);
});
await test("resize: width/height lock follows the shape; unlocked changes one side; the natural size clears it", () => {
  const locked = withResize(IDENTITY_STATE, 4000, 3000, { w: 1000 }, true);
  assert.deepEqual(locked.resize, { w: 1000, h: 750 });
  const byHeight = withResize(IDENTITY_STATE, 4000, 3000, { h: 600 }, true);
  assert.deepEqual(byHeight.resize, { w: 800, h: 600 });
  const free = withResize(IDENTITY_STATE, 4000, 3000, { w: 1000 }, false);
  assert.deepEqual(free.resize, { w: 1000, h: 3000 });
  assert.equal(withResize(free, 4000, 3000, { w: 4000, h: 3000 }, false).resize, null);
  assert.equal(withResize(IDENTITY_STATE, 100, 100, { w: 99999 }, false).resize.w, LIMITS.maxSide);
});
await test("upscaling is detected only when pixels are added", () => {
  assert.equal(isUpscaled(400, 300, IDENTITY_STATE), false);
  assert.equal(isUpscaled(400, 300, withResize(IDENTITY_STATE, 400, 300, { w: 200 }, true)), false);
  assert.equal(isUpscaled(400, 300, withResize(IDENTITY_STATE, 400, 300, { w: 800 }, true)), true);
  assert.equal(isUpscaled(400, 300, withCrop(withResize(IDENTITY_STATE, 400, 300, { w: 400 }, true), { x: 0, y: 0, w: 100, h: 100 }, 400, 300)), false);
});
await test("the output size limit is enforced", () => {
  assert.equal(outputProblem(8000, 6000), null);
  assert.equal(outputProblem(16385, 10), "too_large");
  assert.equal(outputProblem(9000, 8000), "too_large");
});
await test("brightness and contrast are clamped to the editor's range", () => {
  const s = withAdjustments(IDENTITY_STATE, 500, -500);
  assert.deepEqual([s.brightness, s.contrast], [100, -100]);
});

console.log("Mapping between the rotated view and the original");
await test("a rectangle round-trips through every rotation and flip", () => {
  const r = { x: 12, y: 7, w: 40, h: 21 };
  for (const rotation of [0, 90, 180, 270])
    for (const flipH of [false, true])
      for (const flipV of [false, true]) {
        const o = { rotation, flipH, flipV };
        const view = sourceRectToView(r, 100, 60, o);
        assert.deepEqual(viewRectToSource(view, 100, 60, o), r, JSON.stringify(o));
        const full = sourceRectToView({ x: 0, y: 0, w: 100, h: 60 }, 100, 60, o);
        assert.deepEqual([full.x, full.y], [0, 0]);
        assert.deepEqual([full.w, full.h], rotation % 180 ? [60, 100] : [100, 60]);
      }
});

console.log("Drawing: every orientation is an exact pixel permutation (no blur, no shift)");
await test("rotate and flip match an independent reference, pixel for pixel", () => {
  const src = pattern(37, 23);
  const ref = rgbaOf(src);
  for (const rotation of [0, 90, 180, 270])
    for (const flipH of [false, true])
      for (const flipV of [false, true]) {
        const out = rgbaOf(renderEdited(src, S({ rotation, flipH, flipV }), factory));
        const want = flipRgba(rotateRgba(ref, rotation / 90), flipH, flipV);
        assert.equal(out.width, want.width);
        assert.equal(out.height, want.height);
        assert.ok(compareRgba(want, out).exact, `rotation ${rotation} flipH ${flipH} flipV ${flipV}`);
      }
});
await test("a crop is exactly that part of the original, also with rotation", () => {
  const src = pattern(60, 40);
  const ref = rgbaOf(src);
  const crop = { x: 11, y: 5, w: 30, h: 22 };
  const plain = rgbaOf(renderEdited(src, S({ crop }), factory));
  assert.ok(compareRgba(cropRgba(ref, 11, 5, 30, 22), plain).exact);
  const turned = rgbaOf(renderEdited(src, S({ crop, rotation: 90, flipH: true }), factory));
  assert.ok(compareRgba(flipRgba(rotateRgba(cropRgba(ref, 11, 5, 30, 22), 1), true, false), turned).exact);
});
await test("transparency survives drawing untouched when no background is asked for", () => {
  const src = pattern(40, 30, true);
  const out = rgbaOf(renderEdited(src, S({ rotation: 270 }), factory));
  const want = rotateRgba(rgbaOf(src), 3);
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], want.data[i]);
  assert.ok(out.data.some((v, i) => i % 4 === 3 && v === 0));
});
await test("a background fills transparent areas (JPEG needs this) and never turns them black", () => {
  const src = pattern(40, 30, true);
  const out = rgbaOf(renderEdited(src, S(), factory, { background: "#ffffff" }));
  const ref = rgbaOf(src);
  for (let i = 0; i < out.data.length; i += 4) {
    assert.equal(out.data[i + 3], 255);
    if (ref.data[i + 3] === 0) assert.deepEqual([...out.data.subarray(i, i + 3)], [255, 255, 255]);
    else assert.deepEqual([...out.data.subarray(i, i + 3)], [...ref.data.subarray(i, i + 3)]);
  }
});

console.log("Brightness and contrast");
await test("the lookup curve equals the scanner editor's applyAdjustments for every value", () => {
  for (const [b, c] of [[0, 0], [30, 0], [0, 30], [-40, 60], [100, 100], [-100, -100], [17, -63]]) {
    const lut = adjustmentCurve(b, c);
    const probe = { data: new Uint8ClampedArray(256 * 4) };
    for (let v = 0; v < 256; v++) probe.data.set([v, v, v, 255], v * 4);
    applyAdjustments(probe, b, c);
    for (let v = 0; v < 256; v++) assert.equal(probe.data[v * 4], lut[v], `b${b} c${c} v${v}`);
  }
});
await test("an export applies that curve once to the original's pixels, in strips, without touching alpha", () => {
  const src = pattern(50, 700, true); // taller than one strip
  const ref = rgbaOf(src);
  const out = rgbaOf(renderEdited(src, S({ brightness: 25, contrast: -35 }), factory));
  const lut = adjustmentCurve(25, -35);
  for (let i = 0; i < ref.data.length; i += 4) {
    assert.equal(out.data[i + 3], ref.data[i + 3]);
    if (ref.data[i + 3] === 255) for (let c = 0; c < 3; c++) assert.equal(out.data[i + c], lut[ref.data[i + c]]);
  }
});
await test("changing a slider several times ends exactly where one change would (no stacking)", () => {
  const src = pattern(64, 48);
  let s = S();
  for (const [b, c] of [[10, 5], [50, 40], [-20, 20], [30, 20]]) s = withAdjustments(s, b, c);
  const stepped = rgbaOf(renderEdited(src, s, factory));
  const single = rgbaOf(renderEdited(src, S({ brightness: 30, contrast: 20 }), factory));
  assert.ok(compareRgba(stepped, single).exact);
});

console.log("Resizing");
await test("a size change draws from the original once; the size is exact", () => {
  const src = pattern(200, 150);
  for (const [w, h] of [[100, 75], [400, 300], [123, 77], [1, 1]]) {
    const out = renderEdited(src, S({ resize: { w, h } }), factory);
    assert.deepEqual([out.width, out.height], [w, h]);
  }
});
await test("a big reduction is averaged, not skipped: close to a box average of the original", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-unit-"));
  const f = await makeEditFixtures(dir, { stress: false });
  const detail = await decodeRgba(f.detail.file);
  const canvas = createCanvas(detail.width, detail.height);
  canvas.getContext("2d").putImageData(canvas.getContext("2d").createImageData(detail.width, detail.height), 0, 0);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(detail.width, detail.height);
  img.data.set(detail.data);
  ctx.putImageData(img, 0, 0);
  const tw = 250, th = 188; // 8x smaller
  const out = rgbaOf(renderEdited(canvas, S({ resize: { w: tw, h: th } }), factory));
  // Reference: an exact box average of each 8x8 block (rounded size, so compare on the common area).
  const bw = Math.floor(detail.width / 8), bh = Math.floor(detail.height / 8);
  let se = 0, n = 0;
  for (let y = 0; y < Math.min(bh, th) - 2; y++)
    for (let x = 0; x < Math.min(bw, tw) - 2; x++) {
      let sum = 0;
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) sum += detail.data[((y * 8 + dy) * detail.width + x * 8 + dx) * 4];
      const d = sum / 64 - out.data[(y * tw + x) * 4];
      se += d * d;
      n++;
    }
  const rmse = Math.sqrt(se / n);
  assert.ok(rmse < 28, `rmse against a box average was ${rmse.toFixed(1)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
await test("a preview made from a smaller copy of a large original still honours the original's coordinates", () => {
  const big = pattern(600, 400);
  const proxy = makeProxy(big, 300, factory);
  assert.equal(proxy.width, 300);
  assert.equal(proxy.height, 200);
  const crop = { x: 200, y: 100, w: 200, h: 200 };
  const viaProxy = renderEdited(proxy, S({ crop }), factory, { width: 100, height: 100, originalWidth: 600, originalHeight: 400 });
  assert.deepEqual([viaProxy.width, viaProxy.height], [100, 100]);
  const direct = rgbaOf(renderEdited(big, S({ crop }), factory, { width: 100, height: 100 }));
  const cmp = compareRgba(direct, rgbaOf(viaProxy));
  assert.ok(cmp.psnr > 18, `psnr ${cmp.psnr}`);
});

console.log("Crop maths");
const bounds = { w: 1000, h: 800 };
await test("aspect presets include the requested shapes", () => {
  const ids = ASPECT_PRESETS.map((p) => p.id);
  for (const id of ["free", "1:1", "4:3", "3:2", "16:9", "35:45"]) assert.ok(ids.includes(id), id);
});
await test("fitAspect gives the biggest centred rectangle of the shape inside the area", () => {
  for (const p of ASPECT_PRESETS.filter((x) => x.ratio)) {
    const r = fitAspect({ x: 0, y: 0, w: 1000, h: 800 }, p.ratio, bounds);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1000 && r.y + r.h <= 800, p.id);
    assert.ok(Math.abs(r.w / r.h - p.ratio) < 0.01, `${p.id} ${r.w}x${r.h}`);
    assert.ok(r.w === 1000 || r.h === 800, `${p.id} should touch two sides`);
  }
  assert.deepEqual(fitAspect({ x: 0, y: 0, w: 1000, h: 800 }, 1, bounds), { x: 100, y: 0, w: 800, h: 800 });
});
await test("dragging any handle keeps the rectangle inside the picture and at least the minimum size", () => {
  const start = { x: 300, y: 200, w: 400, h: 300 };
  for (const h of HANDLES)
    for (const [dx, dy] of [[-5000, -5000], [5000, 5000], [-5000, 5000], [40, -25], [0, 0], [-390, 290]]) {
      for (const ratio of [null, 1, 16 / 9, 35 / 45]) {
        const r = resizeRect(start, h, dx, dy, bounds, ratio);
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= bounds.w && r.y + r.h <= bounds.h, `${h} ${dx},${dy} ${ratio}: ${JSON.stringify(r)}`);
        assert.ok(r.w >= 1 && r.h >= 1);
        if (ratio !== null) assert.ok(Math.abs(r.w / r.h - ratio) < 0.06, `${h} ratio ${ratio} got ${r.w}x${r.h}`);
      }
    }
});
await test("a free drag moves only the grabbed sides; the opposite side stays fixed", () => {
  const start = { x: 300, y: 200, w: 400, h: 300 };
  assert.deepEqual(resizeRect(start, "e", 50, 99, bounds, null), { x: 300, y: 200, w: 450, h: 300 });
  assert.deepEqual(resizeRect(start, "nw", -30, -20, bounds, null), { x: 270, y: 180, w: 430, h: 320 });
  assert.deepEqual(resizeRect(start, "s", 0, -100, bounds, null), { x: 300, y: 200, w: 400, h: 200 });
});
await test("a locked-shape corner drag anchors the opposite corner", () => {
  const start = { x: 300, y: 200, w: 400, h: 300 };
  const r = resizeRect(start, "se", 100, 0, bounds, 4 / 3);
  assert.deepEqual([r.x, r.y], [300, 200]);
  assert.ok(Math.abs(r.w / r.h - 4 / 3) < 0.01);
  const q = resizeRect(start, "nw", -100, 0, bounds, 4 / 3);
  assert.equal(q.x + q.w, 700);
  assert.equal(q.y + q.h, 500);
});
await test("moving never leaves the picture; keyboard steps scale with the picture and Shift is bigger", () => {
  assert.deepEqual(moveRect({ x: 10, y: 10, w: 100, h: 100 }, -50, 5000, bounds), { x: 0, y: 700, w: 100, h: 100 });
  assert.equal(nudgeStep({ w: 100, h: 80 }, false), 1);
  assert.equal(nudgeStep({ w: 4000, h: 3000 }, false), 20);
  assert.equal(nudgeStep({ w: 4000, h: 3000 }, true), 200);
});
await test("typed crop numbers are kept inside the picture; a locked shape follows the typed side", () => {
  assert.deepEqual(normalizeRect({ x: 900, y: 700, w: 500, h: 500 }, bounds, null), { x: 500, y: 300, w: 500, h: 500 });
  const r = normalizeRect({ x: 0, y: 0, w: 400, h: 999 }, bounds, 16 / 9, "w");
  assert.deepEqual([r.w, r.h], [400, 225]);
  const t = normalizeRect({ x: 0, y: 0, w: 5000, h: 100 }, bounds, 1, "w");
  assert.ok(t.w <= 800 && t.h <= 800 && t.w === t.h);
});

console.log("Formats, sizes and download choices");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-unit-fx-"));
const fx = await makeEditFixtures(dir, { stress: false });
await test("files are recognised by their bytes, not their names", () => {
  for (const [key, format] of [["photo", "jpeg"], ["lossless", "png"], ["webp", "webp"], ["bmp", "bmp"], ["gif", "gif"], ["avif", "avif"]]) {
    if (!fx[key]) continue;
    assert.equal(sniffFormat(new Uint8Array(fs.readFileSync(fx[key].file).subarray(0, 64))), format, key);
  }
  assert.equal(sniffFormat(new Uint8Array(fs.readFileSync(fx.fakePng.file))), null);
  assert.equal(sniffFormat(new Uint8Array(0)), null);
  assert.equal(sniffOutput(new Uint8Array(fs.readFileSync(fx.bmp.file).subarray(0, 64))), null);
});
await test("the stored size is read from the header for every format without decoding", () => {
  for (const key of ["lossless", "logo", "webp", "bmp", "gif", "avif", "lowres"]) {
    if (!fx[key]) continue;
    const bytes = new Uint8Array(fs.readFileSync(fx[key].file));
    const size = readStoredSize(bytes, sniffFormat(bytes));
    assert.deepEqual(size, { w: fx[key].width, h: fx[key].height }, key);
  }
  const jpeg = new Uint8Array(fs.readFileSync(fx.photo.file));
  assert.deepEqual(readStoredSize(jpeg, "jpeg"), { w: 4000, h: 3000 });
  const exif = new Uint8Array(fs.readFileSync(fx.exif6.file));
  assert.deepEqual(readStoredSize(exif, "jpeg"), { w: 400, h: 300 }, "the stored (sideways) size; the browser applies the rotation");
});
await test("bad files are refused before decoding, with a plain reason", () => {
  const read = (key) => new Uint8Array(fs.readFileSync(fx[key].file));
  assert.equal(checkInput(read("empty"), 0).problem, "empty");
  assert.equal(checkInput(read("unsupported"), 22).problem, "unsupported");
  assert.equal(checkInput(read("fakePng"), 35).problem, "unsupported");
  assert.equal(checkInput(read("hugeClaim"), 33).problem, "too_many_pixels");
  assert.equal(checkInput(read("photo").subarray(0, 4096), LIMITS.maxFileBytes + 1).problem, "too_big_file");
  assert.equal(checkInput(read("photo").subarray(0, 100000), 5_000_000).ok, true);
  for (const m of Object.values(LOAD_MESSAGES)) assert.ok(m.length > 20);
});
await test("only formats the browser can really write are offered (simulated browser capabilities)", () => {
  const chromeLike = availableFormats({ jpeg: true, png: true, webp: true, webpLossless: false, avif: false });
  assert.deepEqual(chromeLike.map((f) => f.format), ["png", "jpeg", "webp"]);
  assert.equal(chromeLike.find((f) => f.format === "webp").kind, "lossy", "WebP is not called lossless unless it was verified");
  assert.equal(chromeLike.find((f) => f.format === "png").kind, "lossless");
  assert.equal(chromeLike.find((f) => f.format === "jpeg").alpha, false);
  const webpEither = availableFormats({ jpeg: true, png: true, webp: true, webpLossless: true, avif: false }).find((f) => f.format === "webp");
  assert.equal(webpEither.kind, "either");
  assert.match(webpEither.optionLabel, /lossless at 100% quality/);
  assert.equal(chromeLike.find((f) => f.format === "webp").optionLabel.startsWith("WebP (lossy, "), true);
  assert.deepEqual(availableFormats({ jpeg: true, png: true, webp: false, webpLossless: false, avif: false }).map((f) => f.format), ["png", "jpeg"]);
  assert.ok(!availableFormats({ jpeg: true, png: true, webp: true, webpLossless: false, avif: true }).some((f) => f.format === "avif"), "AVIF output is not offered");
  assert.deepEqual(availableFormats({ jpeg: false, png: false, webp: false, webpLossless: false, avif: false }), []);
});
await test("an encoder's real output is judged by its bytes (a browser that ignores 'image/avif' hands back a PNG)", () => {
  const png = new Uint8Array(fs.readFileSync(fx.lossless.file).subarray(0, 32));
  assert.equal(sniffOutput(png), "png");
  assert.notEqual(sniffOutput(png), "jpeg");
});
await test("WebP lossless or lossy is read from the chunks, including the extended header", () => {
  const riff = (chunks) => {
    const body = Buffer.concat(chunks);
    const head = Buffer.alloc(12);
    head.write("RIFF", 0);
    head.writeUInt32LE(body.length + 4, 4);
    head.write("WEBP", 8);
    return new Uint8Array(Buffer.concat([head, body]));
  };
  const chunk = (name, size) => {
    const b = Buffer.alloc(8 + size + (size & 1));
    b.write(name, 0);
    b.writeUInt32LE(size, 4);
    return b;
  };
  assert.equal(webpEncoding(riff([chunk("VP8L", 20)])), "lossless");
  assert.equal(webpEncoding(riff([chunk("VP8 ", 20)])), "lossy");
  assert.equal(webpEncoding(riff([chunk("VP8X", 10), chunk("ALPH", 7), chunk("VP8 ", 20)])), "lossy");
  assert.equal(webpEncoding(riff([chunk("VP8X", 10), chunk("VP8L", 9)])), "lossless");
  assert.equal(webpEncoding(new Uint8Array(20)), null);
  assert.equal(webpEncoding(new Uint8Array(fs.readFileSync(fx.webp.file))), "lossy");
});
await test("quality numbers: PNG has none, JPEG is clamped, WebP is lossless only at 100% where verified", () => {
  assert.equal(encoderQuality("png", 95, false), undefined);
  assert.equal(encoderQuality("jpeg", 95, false), 0.95);
  assert.equal(encoderQuality("jpeg", 1, false), 0.05);
  assert.equal(encoderQuality("webp", 100, true), 1);
  assert.equal(encoderQuality("webp", 90, true), 0.9);
});
await test("export planning: lossy and transparency warnings, and when the original bytes may be kept", () => {
  const base = { source: "png", sourceHasAlpha: true, unchanged: false, webpLossless: false, qualityPercent: 95 };
  const jpeg = planExport({ ...base, target: "jpeg" });
  assert.deepEqual([jpeg.lossy, jpeg.dropsTransparency, jpeg.canKeepOriginal, jpeg.ext, jpeg.mime], [true, true, false, "jpg", "image/jpeg"]);
  const png = planExport({ ...base, target: "png" });
  assert.deepEqual([png.lossy, png.dropsTransparency, png.ext, png.mime], [false, false, "png", "image/png"]);
  assert.equal(planExport({ ...base, target: "webp" }).lossy, true);
  assert.equal(planExport({ ...base, target: "webp", webpLossless: true, qualityPercent: 100 }).lossy, false);
  assert.equal(planExport({ ...base, unchanged: true, target: "png" }).canKeepOriginal, true);
  assert.equal(planExport({ ...base, unchanged: true, target: "jpeg" }).canKeepOriginal, false, "a different format is never 'the original bytes'");
  assert.equal(planExport({ ...base, unchanged: false, target: "png" }).canKeepOriginal, false);
  assert.equal(planExport({ ...base, sourceHasAlpha: false, target: "jpeg" }).dropsTransparency, false);
});
await test("download names come from the original and match the format", () => {
  assert.equal(exportFileName("photo.jpeg", "png"), "photo-edited.png");
  assert.equal(exportFileName("My photo.final.JPG", "webp"), "My photo.final-edited.webp");
  assert.equal(exportFileName("C:\\pics\\a:b?.png", "jpg"), "a_b_-edited.jpg");
  assert.equal(exportFileName("", "png"), "image-edited.png");
  assert.equal(exportFileName("日本語 写真.png", "jpg"), "日本語 写真-edited.jpg");
  assert.equal(exportFileName("x.png", "png", false), "x.png");
  assert.ok(exportFileName("a".repeat(500) + ".png", "png").length < 140);
});
await test("hex colours", () => {
  assert.ok(isHexColour("#ffffff") && isHexColour("#A0b1C2"));
  assert.ok(!isHexColour("white") && !isHexColour("#fff") && !isHexColour("#ggg000"));
});
await test("the sixteen-megapixel-or-more reality: a 4000 x 3000 photo exports at 4000 x 3000 unless resized", () => {
  assert.deepEqual([geometry(4000, 3000, IDENTITY_STATE).outW, geometry(4000, 3000, IDENTITY_STATE).outH], [4000, 3000]);
  assert.ok(isIdentity(flipVertical(flipVertical(flipHorizontal(flipHorizontal(IDENTITY_STATE)))), 4000, 3000));
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} checks passed`);
