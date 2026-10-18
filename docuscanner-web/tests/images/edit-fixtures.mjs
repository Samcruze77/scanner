// Deterministic test pictures for the Edit Image tool. Nothing here is downloaded or random: every pixel comes
// from a seeded generator, so the fixtures (and the checks made against them) are the same on every run.
//   import { makeEditFixtures } from "./edit-fixtures.mjs"
//   const f = await makeEditFixtures(dir)   // writes the files, returns { name: { file, width, height, ... } }
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { createCanvas, loadImage } = require("@napi-rs/canvas");

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Raw RGBA of a decoded picture (PNG/JPEG/WebP/AVIF through @napi-rs/canvas).
export async function decodeRgba(fileOrBytes) {
  const img = await loadImage(fileOrBytes);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  return { width: img.width, height: img.height, data: d.data };
}

// A photo-like picture: smooth colour gradients, soft shapes and fine grain.
function paintPhoto(ctx, w, h, seed) {
  const rand = mulberry32(seed);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#1b3a5c");
  g.addColorStop(0.45, "#c98b52");
  g.addColorStop(1, "#e9dcc3");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = rand() * w, y = rand() * h, r = (0.03 + rand() * 0.12) * Math.min(w, h);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const hue = Math.floor(rand() * 360);
    rg.addColorStop(0, `hsla(${hue},70%,55%,0.85)`);
    rg.addColorStop(1, `hsla(${hue},70%,55%,0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Hard edges and thin lines, so blur or shifting would show.
  ctx.strokeStyle = "#101010";
  ctx.lineWidth = Math.max(1, Math.round(w / 1600));
  for (let i = 0; i < 25; i++) {
    ctx.beginPath();
    ctx.moveTo(rand() * w, rand() * h);
    ctx.lineTo(rand() * w, rand() * h);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(Math.round(w * 0.1), Math.round(h * 0.1), Math.round(w * 0.06), Math.round(h * 0.04));
  ctx.fillStyle = "#d01010";
  ctx.fillRect(Math.round(w * 0.82), Math.round(h * 0.82), Math.round(w * 0.06), Math.round(h * 0.04));
}

// Light grain on top of whatever is painted (kept small so JPEG sizes stay sensible).
function addGrain(ctx, w, h, seed, amp) {
  const rand = mulberry32(seed);
  const step = 512;
  for (let y = 0; y < h; y += step) {
    const rows = Math.min(step, h - y);
    const d = ctx.getImageData(0, y, w, rows);
    for (let i = 0; i < d.data.length; i += 4) {
      const n = (rand() - 0.5) * amp;
      d.data[i] += n;
      d.data[i + 1] += n;
      d.data[i + 2] += n;
    }
    ctx.putImageData(d, 0, y);
  }
}

async function save(dir, name, buffer) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return file;
}

// 24-bit BMP, written by hand (no library writes BMP).
function makeBmp(w, h, pixel) {
  const rowBytes = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowBytes * h;
  const b = Buffer.alloc(size);
  b.write("BM", 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(rowBytes * h, 34);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, bl] = pixel(x, y);
      const o = 54 + (h - 1 - y) * rowBytes + x * 3;
      b[o] = bl;
      b[o + 1] = g;
      b[o + 2] = r;
    }
  return b;
}

// Inserts an EXIF segment carrying `orientation` right after the JPEG's first (JFIF) segment.
function withExifOrientation(jpeg, orientation) {
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  return Buffer.concat([jpeg.subarray(0, at), seg, jpeg.subarray(at)]);
}

export async function makeEditFixtures(dir, { stress = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const out = {};

  // 1. A high-resolution photo, saved as JPEG.
  {
    const w = 4000, h = 3000;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    paintPhoto(ctx, w, h, 11);
    addGrain(ctx, w, h, 12, 10);
    out.photo = { file: await save(dir, "photo-4000x3000.jpg", await canvas.encode("jpeg", 92)), width: w, height: h, format: "jpeg" };
  }
  // 2. The same kind of picture, smaller and LOSSLESS (PNG), for exact pixel comparisons.
  {
    const w = 1200, h = 900;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    paintPhoto(ctx, w, h, 21);
    addGrain(ctx, w, h, 22, 8);
    out.lossless = { file: await save(dir, "lossless-1200x900.png", await canvas.encode("png")), width: w, height: h, format: "png" };
  }
  // 3. A transparent logo: opaque shapes, soft edges, a semi-transparent shadow, fully transparent surroundings.
  {
    const w = 600, h = 400;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.arc(320, 220, 130, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e63946";
    ctx.beginPath();
    ctx.arc(300, 200, 130, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1d3557";
    ctx.fillRect(220, 160, 160, 80);
    ctx.fillStyle = "#f1faee";
    ctx.font = "bold 48px sans-serif";
    ctx.fillText("LOGO", 232, 215);
    out.logo = { file: await save(dir, "logo-transparent.png", await canvas.encode("png")), width: w, height: h, format: "png", transparent: true };
  }
  // 4. A black signature on a transparent background.
  {
    const w = 800, h = 300;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(40, 220);
    for (let x = 40; x <= 760; x += 8) ctx.lineTo(x, 150 + Math.sin(x / 23) * 70 * Math.cos(x / 97));
    ctx.stroke();
    out.signature = { file: await save(dir, "signature-black-transparent.png", await canvas.encode("png")), width: w, height: h, format: "png", transparent: true };
  }
  // 5. Fine detail: 1-pixel lines, a checkerboard and a Siemens star.
  {
    const w = 2000, h = 1500;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < 400; y += 2) for (let x = 0; x < 600; x += 2) if (((x + y) >> 1) % 2 === 0) ctx.fillRect(x, y, 1, 1);
    for (let x = 700; x < 1300; x += 4) ctx.fillRect(x, 20, 1, 380);
    ctx.save();
    ctx.translate(1000, 900);
    for (let i = 0; i < 72; i++) {
      ctx.rotate((Math.PI * 2) / 72);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 450, 0, (Math.PI * 2) / 144);
      ctx.fill();
    }
    ctx.restore();
    out.detail = { file: await save(dir, "fine-detail-2000x1500.png", await canvas.encode("png")), width: w, height: h, format: "png" };
  }
  // 6. A low-resolution picture.
  {
    const w = 160, h = 120;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    paintPhoto(ctx, w, h, 31);
    out.lowres = { file: await save(dir, "lowres-160x120.png", await canvas.encode("png")), width: w, height: h, format: "png" };
  }
  // 7. A phone photo: stored 400 x 300 with EXIF orientation 6, so it must be shown upright as 300 x 400.
  //    The upright picture has a different colour in each quarter, so a wrong rotation is obvious.
  {
    const uw = 300, uh = 400;
    const sw = 400, sh = 300;
    const canvas = createCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(sw, sh);
    const upright = (u, v) => {
      if (u < 20 && v < 20) return [255, 255, 255];
      const left = u < uw / 2, top = v < uh / 2;
      return top ? (left ? [220, 30, 30] : [30, 160, 40]) : left ? [30, 50, 220] : [240, 220, 20];
    };
    // Orientation 6 means the stored picture must be turned 90 degrees clockwise to be upright, so
    // upright (u, v) comes from stored (x = v, y = sh - 1 - u).
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const u = sh - 1 - y, v = x;
        const [r, g, b] = upright(u, v);
        const o = (y * sw + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    const jpeg = withExifOrientation(Buffer.from(await canvas.encode("jpeg", 95)), 6);
    out.exif6 = { file: await save(dir, "phone-exif6.jpg", jpeg), width: uw, height: uh, storedWidth: sw, storedHeight: sh, format: "jpeg", upright };
  }
  // 8. A damaged JPEG (valid start, then garbage), an unsupported file, a text file named .png, an empty file.
  {
    const photo = fs.readFileSync(out.photo.file);
    const rand = mulberry32(99);
    const junk = Buffer.from(Array.from({ length: 4000 }, () => Math.floor(rand() * 256)));
    out.damaged = { file: await save(dir, "damaged.jpg", Buffer.concat([photo.subarray(0, 700), junk])) };
    out.unsupported = { file: await save(dir, "notes.txt", Buffer.from("This is not a picture.\n")) };
    out.fakePng = { file: await save(dir, "fake.png", Buffer.from("this is text pretending to be a png")) };
    out.empty = { file: await save(dir, "empty.png", Buffer.alloc(0)) };
    // A PNG header that claims 30000 x 30000 pixels (900 megapixels): used to check the size limit is enforced before decoding.
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write("IHDR", 4);
    ihdr.writeUInt32BE(30000, 8);
    ihdr.writeUInt32BE(30000, 12);
    ihdr[16] = 8;
    ihdr[17] = 2;
    out.hugeClaim = { file: await save(dir, "huge-claim-30000x30000.png", Buffer.concat([sig, ihdr])), width: 30000, height: 30000 };
  }
  // 9. Other input formats: WebP, AVIF, GIF, BMP.
  {
    const lossless = await decodeRgba(out.lossless.file);
    const canvas = createCanvas(lossless.width, lossless.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(await loadImage(out.lossless.file), 0, 0);
    out.webp = { file: await save(dir, "sample.webp", await canvas.encode("webp", 90)), width: lossless.width, height: lossless.height, format: "webp" };
    const small = createCanvas(320, 240);
    small.getContext("2d").drawImage(await loadImage(out.lossless.file), 0, 0, 320, 240);
    try {
      out.avif = { file: await save(dir, "sample.avif", await small.encode("avif", { quality: 80 })), width: 320, height: 240, format: "avif" };
    } catch {
      /* this build of the canvas library cannot write AVIF: the AVIF input check is then skipped */
    }
    out.bmp = { file: await save(dir, "sample.bmp", makeBmp(64, 48, (x, y) => [x * 4, y * 5, 128])), width: 64, height: 48, format: "bmp" };
    out.gif = { file: await save(dir, "sample.gif", Buffer.from("R0lGODlhAQABAIAAAP8AAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64")), width: 1, height: 1, format: "gif" };
  }
  // 10. A memory-stress picture: 8000 x 6000 (48 megapixels), smooth with a few hard marks.
  if (stress) {
    const w = 8000, h = 6000;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    paintPhoto(ctx, w, h, 41);
    out.stress = { file: await save(dir, "stress-8000x6000.jpg", await canvas.encode("jpeg", 80)), width: w, height: h, format: "jpeg" };
    // Just over the limit: 8200 x 8200 = 67 megapixels, drawn flat so the file is small.
    const big = createCanvas(8200, 8200);
    const bctx = big.getContext("2d");
    bctx.fillStyle = "#336699";
    bctx.fillRect(0, 0, 8200, 8200);
    out.overLimit = { file: await save(dir, "over-limit-8200x8200.png", await big.encode("png")), width: 8200, height: 8200, format: "png" };
  }
  return out;
}

// ---- reference pixel operations (independent of the tool's own code) ------------------------------------------

export function cropRgba(img, x, y, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { width: w, height: h, data };
}
export function rotateRgba(img, quarterTurnsClockwise) {
  let cur = img;
  for (let t = 0; t < ((quarterTurnsClockwise % 4) + 4) % 4; t++) {
    const { width: w, height: h } = cur;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const d = (x * h + (h - 1 - y)) * 4; // (x, y) -> (h - 1 - y, x) in an h-wide, w-tall picture
        data.set(cur.data.subarray(s, s + 4), d);
      }
    cur = { width: h, height: w, data };
  }
  return cur;
}
export function flipRgba(img, horizontal, vertical) {
  const { width: w, height: h } = img;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = horizontal ? w - 1 - x : x, sy = vertical ? h - 1 - y : y;
      data.set(img.data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

// Mean squared error and PSNR (dB) over RGB, optionally only where the reference is opaque.
export function compareRgba(a, b, { opaqueOnly = false } = {}) {
  if (a.width !== b.width || a.height !== b.height) return { sameSize: false };
  let se = 0, n = 0, max = 0, exact = true;
  for (let i = 0; i < a.data.length; i += 4) {
    if (opaqueOnly && a.data[i + 3] !== 255) continue;
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c];
      if (d !== 0) exact = false;
      se += d * d;
      if (Math.abs(d) > max) max = Math.abs(d);
      n++;
    }
  }
  const mse = n ? se / n : 0;
  return { sameSize: true, exact, max, mse, psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), samples: n };
}
export function alphaDiff(a, b) {
  let max = 0;
  for (let i = 3; i < a.data.length; i += 4) max = Math.max(max, Math.abs(a.data[i] - b.data[i]));
  return max;
}
// Mean absolute difference between neighbouring pixels: a simple measure of how sharp a picture is.
export function sharpness(img) {
  const { width: w, height: h, data } = img;
  let sum = 0, n = 0;
  for (let y = 1; y < h; y++)
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4, l = i - 4, u = i - w * 4;
      for (let c = 0; c < 3; c++) {
        sum += Math.abs(data[i + c] - data[l + c]) + Math.abs(data[i + c] - data[u + c]);
        n += 2;
      }
    }
  return sum / n;
}
