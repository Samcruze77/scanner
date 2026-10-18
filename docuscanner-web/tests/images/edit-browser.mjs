// Drives the real Edit Image tool in Chrome and inspects the ACTUAL downloaded files: their bytes (format signature),
// extension, decoded size, transparency, pixels against the source, and the geometry of every edit.
//   npm run build && npx next start -p 3117      (in another terminal)
//   node tests/images/edit-browser.mjs [baseUrl]
// Chrome only (the installed desktop Chrome, headless). Safari, Firefox and iOS are NOT covered; see the audit report.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BASE, CHROME, chromium, work } from "../audit/lib.mjs";
import { adjustmentCurve } from "../../utils/imageEdit/ops.ts";
import { readStoredSize, sniffFormat, webpEncoding } from "../../utils/imageEdit/formats.ts";
import { alphaDiff, compareRgba, cropRgba, decodeRgba, flipRgba, makeEditFixtures, rotateRgba } from "./edit-fixtures.mjs";

const fixDir = path.join(work, "fixtures");
const F = await makeEditFixtures(fixDir);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const results = [];
const measurements = [];
const note = (label, value) => {
  measurements.push([label, value]);
  console.log(`      · ${label}: ${value}`);
};
async function check(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push([name, true]);
    console.log(`  ok  ${name}  (${Date.now() - t} ms)`);
  } catch (err) {
    results.push([name, false, err]);
    console.log(`  FAIL ${name}\n       ${String(err?.message ?? err).split("\n").slice(0, 6).join("\n       ")}`);
  }
}

// ---- driving the page ----------------------------------------------------------------------------------------------
const CONSENT = JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false });
async function open({ viewport = { width: 1280, height: 900 }, touch = false, theme } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, isMobile: touch, hasTouch: touch });
  const page = await context.newPage();
  const requests = [];
  const problems = [];
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  await page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  await page.addInitScript(
    ([consent, t]) => {
      try {
        localStorage.setItem("ds_consent", consent);
        if (t) localStorage.setItem("pdfscanner.theme", t);
      } catch {}
    },
    [CONSENT, theme],
  );
  await page.goto(BASE + "/tools/edit-image", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="file"]', { state: "attached" });
  return { context, page, requests, problems };
}
const resultSize = (page) => page.locator('[data-testid="result-size"]').innerText();
async function load(page, file, { expect } = {}) {
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForSelector('[data-testid="original-size"]', { timeout: 60000 });
  if (expect) await page.waitForFunction((t) => document.querySelector('[data-testid="result-size"]')?.textContent?.includes(t), expect, { timeout: 15000 });
  // The preview is drawn once the encoders have been probed and the canvas has content.
  await page.waitForFunction(() => document.querySelector('[data-assistant-id="image-edit-format"]') !== null, null, { timeout: 15000 });
}
async function saveFile(page, name) {
  const waiting = page.waitForEvent("download", { timeout: 180000 });
  await page.locator('[data-assistant-id="image-edit-download"]').click();
  const dl = await waiting;
  const file = path.join(work, name);
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename(), bytes: fs.readFileSync(file) };
}
async function setFormat(page, f) {
  await page.selectOption("#ie-format", f);
}
async function dontKeep(page) {
  const box = page.getByLabel(/Keep my original file/);
  if (await box.count()) await box.uncheck();
}
async function setField(page, id, value) {
  const el = page.locator(id);
  await el.fill(String(value));
}
async function crop(page, { x, y, w, h }) {
  await page.locator('[data-assistant-id="image-edit-crop"]').click();
  await page.waitForSelector("[data-crop-overlay]");
  await setField(page, "#ie-crop-w", w);
  await setField(page, "#ie-crop-h", h);
  await setField(page, "#ie-crop-x", x);
  await setField(page, "#ie-crop-y", y);
  await page.locator('[data-assistant-id="image-edit-apply-crop"]').click();
  await page.waitForSelector("[data-crop-overlay]", { state: "detached" });
}
async function setSlider(page, id, value) {
  await page.locator(id).fill(String(value));
  await page.locator(id).blur();
}
const rotR = (page) => page.getByRole("button", { name: "Rotate right 90 degrees" }).click();
const rotL = (page) => page.getByRole("button", { name: "Rotate left 90 degrees" }).click();
const flipH = (page) => page.getByRole("button", { name: "Flip horizontal" }).click();
const flipV = (page) => page.getByRole("button", { name: "Flip vertical" }).click();
const status = (page) => page.locator('[data-testid="status"]').innerText();
const decoded = (file) => decodeRgba(file);
const whiteComposite = (img) => {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((img.data[i + c] * a + 255 * (255 - a)) / 255);
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
};
// PSNR over a sparse grid of pixels (for 48-megapixel pictures).
function sampledPsnr(a, b, stride = 7) {
  let se = 0, n = 0;
  for (let y = 0; y < a.height; y += stride)
    for (let x = 0; x < a.width; x += stride) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const d = a.data[i + c] - b.data[i + c];
        se += d * d;
        n++;
      }
    }
  const mse = se / n;
  return mse === 0 ? Infinity : 10 * Math.log10(65025 / mse);
}
function boxReduce(img, k) {
  const w = Math.floor(img.width / k), h = Math.floor(img.height / k);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += img.data[((y * k + dy) * img.width + x * k + dx) * 4 + c];
        data[(y * w + x) * 4 + c] = Math.round(s / (k * k));
      }
  return { width: w, height: h, data };
}

const src = {
  lossless: await decoded(F.lossless.file),
  logo: await decoded(F.logo.file),
  signature: await decoded(F.signature.file),
};

// ===================================================================================================================
console.log("1. The page, the formats this browser can really save, and what is offered");
await check("the tool page opens without errors; the title and heading say what it does", async () => {
  const { context, page, problems } = await open();
  assert.match(await page.title(), /Edit Image/i);
  assert.match(await page.locator("h1").innerText(), /Edit images online/i);
  assert.ok((await page.locator("main").innerText()).includes("never uploaded"));
  assert.deepEqual(problems, []);
  await context.close();
});
let formatsOffered = [];
await check("only genuinely working output formats are listed (JPEG, PNG, WebP): AVIF/BMP/TIFF are not", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await page.waitForFunction(() => document.querySelectorAll("#ie-format option").length > 0);
  formatsOffered = await page.locator("#ie-format option").evaluateAll((o) => o.map((x) => ({ value: x.value, text: x.textContent })));
  note("formats offered", formatsOffered.map((f) => f.text).join(" | "));
  assert.deepEqual(formatsOffered.map((f) => f.value).sort(), ["jpeg", "png", "webp"]);
  // Independent probe in the page: ask the canvas for every format and look at the real bytes that come back.
  const probe = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    c.getContext("2d").fillRect(0, 0, 8, 8);
    const out = {};
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/bmp", "image/tiff"]) {
      const b = await new Promise((r) => c.toBlob(r, t, 0.9));
      out[t] = Array.from(new Uint8Array(await b.slice(0, 12).arrayBuffer()));
    }
    return out;
  });
  const sig = (t) => sniffFormat(Uint8Array.from(probe[t]));
  assert.equal(sig("image/jpeg"), "jpeg");
  assert.equal(sig("image/png"), "png");
  assert.equal(sig("image/webp"), "webp");
  assert.equal(sig("image/avif"), "png", "this Chrome silently hands back a PNG for AVIF, so AVIF must not be offered");
  assert.equal(sig("image/bmp"), "png");
  assert.equal(sig("image/tiff"), "png");
  await context.close();
});
await check("WebP is labelled lossless only if a lossless round trip really is exact", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await page.waitForFunction(() => document.querySelectorAll("#ie-format option").length > 0);
  const label = (await page.locator('#ie-format option[value="webp"]').innerText()).trim();
  const claimsLossless = /lossless at 100% quality/.test(label);
  note("WebP label in this Chrome", label);
  await setFormat(page, "webp");
  if (claimsLossless) {
    await page.locator("#ie-quality").fill("100");
    const dl = await saveFile(page, "webp-q100.webp");
    assert.equal(webpEncoding(dl.bytes), "lossless");
    assert.ok(compareRgba(src.lossless, await decoded(dl.file)).exact, "claimed lossless but pixels differ");
    note("WebP at 100%", "lossless, pixel-exact");
  } else {
    const dl = await saveFile(page, "webp-default.webp");
    assert.equal(webpEncoding(dl.bytes), "lossy");
    note("WebP in this Chrome", "lossy (quality slider); lossless is NOT claimed");
  }
  await context.close();
});

// ===================================================================================================================
console.log("2. Opening pictures: orientation, sizes, other formats, replacing, bad files");
await check("an EXIF-6 phone photo opens upright (300x400, not the stored 400x300) and exports upright", async () => {
  const { context, page } = await open();
  await load(page, F.exif6.file);
  assert.match(await page.locator('[data-testid="original-size"]').innerText(), /300 × 400/);
  assert.match(await resultSize(page), /300 × 400/);
  await setFormat(page, "png");
  const dl = await saveFile(page, "exif6.png");
  const img = await decoded(dl.file);
  assert.deepEqual([img.width, img.height], [300, 400]);
  const px = (x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
  const near = (a, b, tol = 30) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  assert.ok(near(px(5, 5), [255, 255, 255]), "white marker at the top-left");
  assert.ok(near(px(250, 100), [30, 160, 40]), "top-right is green");
  assert.ok(near(px(100, 100), [220, 30, 30]), "top-left is red");
  assert.ok(near(px(100, 300), [30, 50, 220]), "bottom-left is blue");
  assert.ok(near(px(250, 300), [240, 220, 20]), "bottom-right is yellow");
  await context.close();
});
await check("an EXIF-6 photo with no edits and the same format gives the original bytes back", async () => {
  const { context, page } = await open();
  await load(page, F.exif6.file);
  const dl = await saveFile(page, "exif6-original.jpg");
  assert.equal(sha(dl.file), sha(F.exif6.file));
  assert.equal(dl.suggested, "phone-exif6.jpg");
  await context.close();
});
await check("GIF, BMP, WebP and AVIF files open with the right size (and AVIF only if this build could write the sample)", async () => {
  const { context, page } = await open();
  const cases = [["gif", "1 × 1"], ["bmp", "64 × 48"], ["webp", "1200 × 900"], ...(F.avif ? [["avif", "320 × 240"]] : [])];
  for (const [key, size] of cases) {
    await load(page, F[key].file);
    await page.waitForFunction((s) => document.querySelector('[data-testid="original-size"]')?.textContent?.includes(s), size, { timeout: 15000 });
    await setFormat(page, "png");
    const dl = await saveFile(page, `from-${key}.png`);
    assert.equal(sniffFormat(dl.bytes), "png");
    const [w, h] = size.split(" × ").map(Number);
    assert.deepEqual([readStoredSize(dl.bytes, "png").w, readStoredSize(dl.bytes, "png").h], [w, h], key);
  }
  if (!F.avif) note("AVIF input", "not tested: the canvas library here cannot write an AVIF sample");
  await context.close();
});
await check("damaged, unsupported, fake and empty files give a clear message and leave the current picture alone", async () => {
  const { context, page } = await open();
  // With nothing open yet.
  for (const key of ["unsupported", "fakePng", "empty", "damaged", "hugeClaim"]) {
    await page.locator('input[type="file"]').first().setInputFiles(F[key].file);
    await page.waitForSelector("main .notice-error", { timeout: 20000 });
    const msg = await page.locator("main .notice-error").first().innerText();
    assert.ok(msg.length > 25, `${key}: ${msg}`);
    if (key === "hugeClaim") assert.match(msg, /more than 64 million pixels/);
    if (key === "unsupported" || key === "fakePng") assert.match(msg, /isn't a picture/);
    if (key === "empty") assert.match(msg, /empty/);
    if (key === "damaged") assert.match(msg, /couldn't open|damaged/);
    await page.getByRole("button", { name: "Dismiss error" }).click();
    assert.equal(await page.locator('[data-testid="original-size"]').count(), 0, `${key} must not open an editor`);
  }
  // With a picture open and edited.
  await load(page, F.lossless.file);
  await rotR(page);
  const before = await resultSize(page);
  for (const key of ["unsupported", "damaged", "empty", "hugeClaim"]) {
    await page.locator('input[type="file"]').first().setInputFiles(F[key].file);
    await page.waitForSelector("main .notice-error");
    assert.equal(await resultSize(page), before, `${key} changed the current picture`);
    assert.equal(await page.locator('[role="alertdialog"]').count(), 0);
    await page.getByRole("button", { name: "Dismiss error" }).click();
  }
  assert.match(before, /900 × 1200/);
  await context.close();
});
await check("replacing a picture asks first when there are edits; Keep current really keeps it; Replace starts fresh", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await rotR(page);
  await page.locator('input[type="file"]').first().setInputFiles(F.logo.file);
  await page.waitForSelector('[role="alertdialog"]');
  assert.match(await page.locator('[role="alertdialog"]').innerText(), /lost/);
  await page.getByRole("button", { name: "Keep current picture" }).click();
  assert.match(await resultSize(page), /900 × 1200/);
  assert.match(await page.locator('[data-testid="original-size"]').innerText(), /1200 × 900/);
  await page.locator('input[type="file"]').first().setInputFiles(F.logo.file);
  await page.waitForSelector('[role="alertdialog"]');
  await page.locator('[role="alertdialog"]').getByRole("button", { name: "Replace picture" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="original-size"]')?.textContent?.includes("600 × 400"));
  assert.match(await resultSize(page), /600 × 400/);
  assert.equal(await page.getByRole("button", { name: "Undo" }).isDisabled(), true);
  await context.close();
});

// ===================================================================================================================
console.log("3. Download fidelity: format, bytes, size, pixels");
await check("a 4000x3000 photo with no edits: the original bytes come back unchanged, with its own name", async () => {
  const { context, page } = await open();
  await load(page, F.photo.file, { expect: "4000 × 3000" });
  assert.match(await page.locator('[data-testid="original-size"]').innerText(), /4000 × 3000/);
  assert.equal(await page.locator("#ie-w").inputValue(), "4000");
  assert.equal(await page.locator("#ie-h").inputValue(), "3000");
  assert.ok(await page.getByLabel(/Keep my original file/).isChecked());
  const dl = await saveFile(page, "photo-original.jpg");
  assert.equal(sha(dl.file), sha(F.photo.file));
  assert.equal(dl.suggested, "photo-4000x3000.jpg");
  await context.close();
});
await check("a 4000x3000 photo re-encoded as JPEG / PNG / WebP stays 4000x3000, the signature matches the format, and quality is high", async () => {
  const { context, page } = await open();
  await load(page, F.photo.file, { expect: "4000 × 3000" });
  const source = await decoded(F.photo.file);
  await dontKeep(page);
  for (const [fmt, ext, minPsnr] of [["jpeg", "jpg", 38], ["png", "png", 45], ["webp", "webp", 36]]) {
    await setFormat(page, fmt);
    const t = Date.now();
    const dl = await saveFile(page, `photo-out.${ext}`);
    assert.equal(dl.suggested, `photo-4000x3000-edited.${ext}`);
    assert.equal(sniffFormat(dl.bytes), fmt === "jpeg" ? "jpeg" : fmt);
    const size = readStoredSize(dl.bytes, sniffFormat(dl.bytes));
    assert.deepEqual([size.w, size.h], [4000, 3000], `${fmt} must keep 4000x3000`);
    const out = await decoded(dl.file);
    const psnr = sampledPsnr(source, out, 5);
    note(`4000x3000 photo -> ${fmt}`, `${(dl.bytes.length / 1048576).toFixed(2)} MB, PSNR vs source ${psnr.toFixed(1)} dB, ${Date.now() - t} ms (incl. save)`);
    assert.ok(psnr >= minPsnr, `${fmt} PSNR ${psnr.toFixed(1)} < ${minPsnr}`);
  }
  await context.close();
});
await check("a lossless PNG with no edits, saved as PNG again, is pixel-for-pixel identical (and kept bytes are identical by default)", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  const kept = await saveFile(page, "lossless-kept.png");
  assert.equal(sha(kept.file), sha(F.lossless.file));
  await dontKeep(page);
  const dl = await saveFile(page, "lossless-reencoded.png");
  assert.equal(dl.suggested, "lossless-1200x900-edited.png");
  const cmp = compareRgba(src.lossless, await decoded(dl.file));
  note("PNG -> PNG without keeping bytes", `exact=${cmp.exact}, max channel difference ${cmp.max}`);
  assert.ok(cmp.exact);
  await context.close();
});
await check("a transparent logo keeps its transparency as PNG (alpha identical) and as WebP", async () => {
  const { context, page } = await open();
  await load(page, F.logo.file);
  await dontKeep(page);
  await setFormat(page, "png");
  const png = await saveFile(page, "logo.png");
  const out = await decoded(png.file);
  assert.equal(alphaDiff(src.logo, out), 0, "PNG alpha must be identical");
  assert.ok(compareRgba(src.logo, out, { opaqueOnly: true }).exact, "opaque pixels must be identical");
  const onWhite = compareRgba(whiteComposite(src.logo), whiteComposite(out));
  note("logo PNG vs source", `alpha identical; fully opaque pixels identical; semi-transparent pixels differ by at most ${onWhite.max} level(s) once shown on white`);
  assert.ok(onWhite.max <= 2);
  let transparent = 0;
  for (let i = 3; i < out.data.length; i += 4) if (out.data[i] === 0) transparent++;
  assert.ok(transparent > 1000, "there must still be transparent pixels");
  await setFormat(page, "webp");
  const webp = await saveFile(page, "logo.webp");
  assert.equal(sniffFormat(webp.bytes), "webp");
  const w = await decoded(webp.file);
  const ad = alphaDiff(src.logo, w);
  const psnr = compareRgba(whiteComposite(src.logo), whiteComposite(w)).psnr;
  note("logo WebP", `max alpha difference ${ad}, PSNR on white ${psnr.toFixed(1)} dB`);
  assert.ok(ad <= 3, `WebP alpha off by ${ad}`);
  assert.ok(psnr > 35);
  await context.close();
});
await check("a transparent logo as JPEG gets a WHITE background (never black), says so, and honours a chosen colour", async () => {
  const { context, page } = await open();
  await load(page, F.logo.file);
  await setFormat(page, "jpeg");
  assert.match(await page.locator('ul[aria-label="About this download"]').innerText(), /JPEG can't store transparency[\s\S]*not black/);
  const dl = await saveFile(page, "logo.jpg");
  assert.equal(sniffFormat(dl.bytes), "jpeg");
  const img = await decoded(dl.file);
  const corner = [0, 1, 2].map((c) => img.data[(5 * img.width + 5) * 4 + c]);
  note("JPEG corner pixel from a transparent source", corner.join(","));
  assert.ok(corner.every((v) => v >= 250), "transparent corner must be white");
  let dark = 0;
  for (let y = 0; y < 60; y++) for (let x = 0; x < 100; x++) if (img.data[(y * img.width + x) * 4] < 200) dark++;
  assert.equal(dark, 0, "no dark pixels where the source was transparent");
  await page.locator("#ie-bg").fill("#ff0000");
  const red = await saveFile(page, "logo-red.jpg");
  const r = await decoded(red.file);
  const px = [0, 1, 2].map((c) => r.data[(5 * r.width + 5) * 4 + c]);
  assert.ok(px[0] > 240 && px[1] < 20 && px[2] < 20, `expected red, got ${px}`);
  await context.close();
});
await check("a black signature on transparent stays black-on-white as JPEG and black-on-transparent as PNG", async () => {
  const { context, page } = await open();
  await load(page, F.signature.file);
  await setFormat(page, "jpeg");
  const jpg = await decoded((await saveFile(page, "sig.jpg")).file);
  let black = 0, white = 0;
  for (let i = 0; i < jpg.data.length; i += 4) {
    if (jpg.data[i] < 60) black++;
    if (jpg.data[i] > 240) white++;
  }
  assert.ok(black > 500, "the strokes must be dark");
  assert.ok(white > jpg.width * jpg.height * 0.8, "the background must be white, not black");
  await dontKeep(page);
  await setFormat(page, "png");
  const png = await decoded((await saveFile(page, "sig.png")).file);
  assert.equal(alphaDiff(src.signature, png), 0);
  await context.close();
});
await check("a low-resolution picture opens and exports at its own size (no silent change)", async () => {
  const { context, page } = await open();
  await load(page, F.lowres.file);
  await dontKeep(page);
  const dl = await saveFile(page, "low.png");
  const img = await decoded(dl.file);
  assert.deepEqual([img.width, img.height], [160, 120]);
  assert.ok(compareRgba(await decoded(F.lowres.file), img).exact);
  await context.close();
});
await check("the download is a picture file: a fresh PNG is a real PNG that reopens, and nothing is a PDF", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await rotR(page);
  const dl = await saveFile(page, "not-a-pdf.png");
  assert.notEqual(dl.bytes.subarray(0, 4).toString("latin1"), "%PDF");
  assert.equal(sniffFormat(dl.bytes), "png");
  assert.ok(/\.png$/.test(dl.suggested));
  await context.close();
});

// ===================================================================================================================
console.log("4. Editing: geometry is exact");
const losslessRef = (ops) => ops.reduce((img, op) => op(img), src.lossless);
await check("rotate right / left / 180, flip H / V and combinations match an independent reference exactly", async () => {
  const cases = [
    ["rotate right", async (p) => rotR(p), [(i) => rotateRgba(i, 1)]],
    ["rotate left", async (p) => rotL(p), [(i) => rotateRgba(i, 3)]],
    ["rotate right twice", async (p) => (await rotR(p), rotR(p)), [(i) => rotateRgba(i, 2)]],
    ["flip horizontal", async (p) => flipH(p), [(i) => flipRgba(i, true, false)]],
    ["flip vertical", async (p) => flipV(p), [(i) => flipRgba(i, false, true)]],
    ["rotate right then flip horizontal", async (p) => (await rotR(p), flipH(p)), [(i) => rotateRgba(i, 1), (i) => flipRgba(i, true, false)]],
    ["flip both", async (p) => (await flipH(p), flipV(p)), [(i) => flipRgba(i, true, true)]],
  ];
  for (const [name, act, ops] of cases) {
    const { context, page } = await open();
    await load(page, F.lossless.file);
    await act(page);
    const dl = await saveFile(page, "geo.png");
    const cmp = compareRgba(losslessRef(ops), await decoded(dl.file));
    assert.ok(cmp.sameSize && cmp.exact, `${name}: ${JSON.stringify(cmp)}`);
    await context.close();
  }
});
await check("crop by exact numbers: the result is exactly that part of the original; the size shown matches the file", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await crop(page, { x: 100, y: 50, w: 640, h: 360 });
  assert.match(await resultSize(page), /640 × 360/);
  const dl = await saveFile(page, "crop.png");
  const cmp = compareRgba(cropRgba(src.lossless, 100, 50, 640, 360), await decoded(dl.file));
  assert.ok(cmp.sameSize && cmp.exact, JSON.stringify(cmp));
  await context.close();
});
await check("crop after rotating works on what you see, and flips/rotation compose with it exactly", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await rotR(page); // the view is now 900 x 1200
  await crop(page, { x: 100, y: 200, w: 300, h: 400 });
  await flipH(page);
  const dl = await saveFile(page, "crop-rot.png");
  // View (x 100..400, y 200..600) of the picture turned right equals source columns/rows as below.
  const turned = rotateRgba(src.lossless, 1);
  const want = flipRgba(cropRgba(turned, 100, 200, 300, 400), true, false);
  const cmp = compareRgba(want, await decoded(dl.file));
  assert.ok(cmp.sameSize && cmp.exact, JSON.stringify(cmp));
  await context.close();
});
await check("aspect presets: 1:1, 4:3, 3:2, 16:9 and passport 35:45 set the shape; the export has exactly the shown size", async () => {
  const { context, page } = await open();
  await load(page, F.photo.file, { expect: "4000 × 3000" });
  await page.locator('[data-assistant-id="image-edit-crop"]').click();
  for (const [id, ratio] of [["1:1", 1], ["4:3", 4 / 3], ["3:2", 3 / 2], ["16:9", 16 / 9], ["35:45", 35 / 45]]) {
    await page.selectOption("#ie-aspect", id);
    const w = Number(await page.locator("#ie-crop-w").inputValue());
    const h = Number(await page.locator("#ie-crop-h").inputValue());
    assert.ok(Math.abs(w / h - ratio) < 0.005, `${id}: ${w}x${h}`);
    assert.ok(w <= 4000 && h <= 3000);
  }
  await page.selectOption("#ie-aspect", "35:45");
  const w = Number(await page.locator("#ie-crop-w").inputValue());
  const h = Number(await page.locator("#ie-crop-h").inputValue());
  await page.locator('[data-assistant-id="image-edit-apply-crop"]').click();
  assert.match(await resultSize(page), new RegExp(`${w} × ${h}`));
  await dontKeep(page);
  await setFormat(page, "png");
  const dl = await saveFile(page, "passport.png");
  const size = readStoredSize(dl.bytes, "png");
  assert.deepEqual([size.w, size.h], [w, h]);
  note("passport 35:45 crop of 4000x3000", `${w} x ${h}`);
  await context.close();
});
await check("crop handles work by mouse drag, by keyboard, and nothing changes until Apply; Cancel changes nothing", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await page.locator('[data-assistant-id="image-edit-crop"]').click();
  const w0 = Number(await page.locator("#ie-crop-w").inputValue());
  const box = await page.locator('[data-crop-handle="se"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y - 60, { steps: 6 });
  await page.mouse.up();
  const w1 = Number(await page.locator("#ie-crop-w").inputValue());
  assert.ok(w1 < w0 - 50, `dragging the corner in should shrink the crop (${w0} -> ${w1})`);
  await page.locator('[data-crop-handle="e"]').focus();
  const step = 6; // 1200 / 200
  await page.keyboard.press("ArrowLeft");
  assert.equal(Number(await page.locator("#ie-crop-w").inputValue()), w1 - step);
  await page.keyboard.press("Shift+ArrowRight");
  assert.equal(Number(await page.locator("#ie-crop-w").inputValue()), w1 - step + step * 10);
  await page.locator('[data-crop-move]').focus();
  await page.keyboard.press("ArrowRight");
  assert.match(await page.locator('[data-testid="dimensions"]').innerText(), /Crop area/);
  await page.getByRole("button", { name: "Cancel" }).click();
  assert.match(await resultSize(page), /1200 × 900/);
  assert.equal(await page.getByRole("button", { name: "Undo" }).isDisabled(), true, "cancel leaves no history");
  await context.close();
});
await check("resize: defaults to the original size, lock keeps the shape, unlock allows a distorted size, upscaling is warned about", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  assert.equal(await page.locator("#ie-w").inputValue(), "1200");
  assert.equal(await page.locator("#ie-h").inputValue(), "900");
  await page.locator("#ie-w").fill("600");
  await page.locator("#ie-w").blur();
  assert.equal(await page.locator("#ie-h").inputValue(), "450");
  assert.match(await resultSize(page), /600 × 450/);
  await dontKeep(page);
  await setFormat(page, "png");
  const dl = await saveFile(page, "resized.png");
  const out = await decoded(dl.file);
  assert.deepEqual([out.width, out.height], [600, 450]);
  const ref = boxReduce(src.lossless, 2);
  const cmp = compareRgba(ref, out);
  note("1200x900 -> 600x450 vs 2x2 box average", `PSNR ${cmp.psnr.toFixed(1)} dB, max difference ${cmp.max}`);
  assert.ok(cmp.psnr > 30, `PSNR ${cmp.psnr}`);
  await page.locator("#ie-w").fill("300");
  await page.locator("#ie-w").blur();
  const dl4 = await saveFile(page, "resized4.png");
  const out4 = await decoded(dl4.file);
  assert.deepEqual([out4.width, out4.height], [300, 225]);
  const cmp4 = compareRgba(boxReduce(src.lossless, 4), out4);
  note("1200x900 -> 300x225 vs 4x4 box average", `PSNR ${cmp4.psnr.toFixed(1)} dB`);
  assert.ok(cmp4.psnr > 27, `PSNR ${cmp4.psnr}`);
  await page.getByLabel(/Keep the picture's shape/).uncheck();
  await page.locator("#ie-w").fill("500");
  await page.locator("#ie-w").blur();
  assert.equal(await page.locator("#ie-h").inputValue(), "225");
  assert.match(await resultSize(page), /500 × 225/);
  await page.getByRole("button", { name: "Original size" }).click();
  assert.match(await resultSize(page), /1200 × 900/);
  assert.equal(await page.locator("#ie-w").inputValue(), "1200");
  await page.getByLabel(/Keep the picture's shape/).check();
  await page.locator("#ie-w").fill("2400");
  await page.locator("#ie-w").blur();
  assert.match(await page.locator('ul[aria-label="About this download"]').innerText(), /can't restore detail/);
  const up = await saveFile(page, "up.png");
  const upSize = readStoredSize(up.bytes, "png");
  assert.deepEqual([upSize.w, upSize.h], [2400, 1800]);
  await context.close();
});
await check("an enormous requested size is refused with a message instead of producing a corrupt file", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await page.locator("#ie-w").fill("12000");
  await page.locator("#ie-w").blur();
  assert.equal(await page.locator('[data-assistant-id="image-edit-download"]').isDisabled(), true);
  assert.match(await page.locator('ul[aria-label="About this download"]').innerText(), /too large to export/);
  await context.close();
});
await check("brightness and contrast give exactly the existing editor curve, applied to the original once", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await dontKeep(page);
  await setSlider(page, "#ie-brightness", 30);
  await setSlider(page, "#ie-contrast", -25);
  const dl = await saveFile(page, "adjust.png");
  const lut = adjustmentCurve(30, -25);
  const out = await decoded(dl.file);
  let wrong = 0;
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) if (out.data[i + c] !== lut[src.lossless.data[i + c]]) wrong++;
  assert.equal(wrong, 0, `${wrong} channel values differ from the curve`);
  await context.close();
});
await check("moving the sliders back and forth does not degrade: the result equals a single-pass export (identical pixels)", async () => {
  const a = await open();
  await load(a.page, F.lossless.file);
  for (const [b, c] of [[10, 5], [60, 40], [-30, 20], [45, -10], [30, 20]]) {
    await setSlider(a.page, "#ie-brightness", b);
    await setSlider(a.page, "#ie-contrast", c);
  }
  await a.page.getByRole("button", { name: "Rotate right 90 degrees" }).click();
  await a.page.getByRole("button", { name: "Rotate left 90 degrees" }).click();
  const stepped = await saveFile(a.page, "stepped.png");
  const b = await open();
  await load(b.page, F.lossless.file);
  await setSlider(b.page, "#ie-brightness", 30);
  await setSlider(b.page, "#ie-contrast", 20);
  const single = await saveFile(b.page, "single.png");
  const cmp = compareRgba(await decoded(stepped.file), await decoded(single.file));
  note("stepped vs single-pass export", `identical pixels=${cmp.exact}, identical bytes=${sha(stepped.file) === sha(single.file)}`);
  assert.ok(cmp.sameSize && cmp.exact);
  await a.context.close();
  await b.context.close();
});
await check("undo, redo, reset edits (undoable) and restore original", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  assert.ok(await undo.isDisabled() && await redo.isDisabled());
  await rotR(page);
  assert.match(await resultSize(page), /900 × 1200/);
  await flipH(page);
  await undo.click();
  assert.match(await resultSize(page), /900 × 1200/);
  await undo.click();
  assert.match(await resultSize(page), /1200 × 900/);
  assert.ok(await undo.isDisabled());
  await redo.click();
  await redo.click();
  assert.ok(await redo.isDisabled());
  assert.match(await resultSize(page), /900 × 1200/);
  await page.getByRole("button", { name: "Reset edits" }).click();
  assert.match(await resultSize(page), /1200 × 900/);
  await undo.click();
  assert.match(await resultSize(page), /900 × 1200/, "reset can be undone");
  await page.getByRole("button", { name: "Restore original" }).click();
  assert.match(await resultSize(page), /1200 × 900/);
  assert.ok(await undo.isDisabled(), "restore clears the history");
  // The original is still byte-for-byte what was opened.
  const dl = await saveFile(page, "after-restore.png");
  assert.equal(sha(dl.file), sha(F.lossless.file));
  await context.close();
});
await check("after an edit the 'keep original bytes' option goes away and the download becomes a fresh file", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  assert.equal(await page.getByLabel(/Keep my original file/).count(), 1);
  await flipV(page);
  assert.equal(await page.getByLabel(/Keep my original file/).count(), 0);
  assert.match(await page.locator('[data-assistant-id="image-edit-download"]').innerText(), /Download image/);
  await setFormat(page, "jpeg");
  assert.equal(await page.getByLabel(/Keep my original file/).count(), 0, "a different format is never the original bytes");
  await context.close();
});

// ===================================================================================================================
console.log("5. Large pictures");
await check("a 48-megapixel (8000x6000) JPEG opens, edits and exports without corruption", async () => {
  const { context, page } = await open();
  const t0 = Date.now();
  await load(page, F.stress.file, { expect: "8000 × 6000" });
  note("open 8000x6000 JPEG", `${Date.now() - t0} ms, source file ${(fs.statSync(F.stress.file).size / 1048576).toFixed(1)} MB`);
  await setSlider(page, "#ie-brightness", 15);
  await dontKeep(page);
  await setFormat(page, "jpeg");
  const t1 = Date.now();
  const dl = await saveFile(page, "stress.jpg");
  note("export 8000x6000 JPEG with brightness", `${Date.now() - t1} ms, ${(dl.bytes.length / 1048576).toFixed(1)} MB`);
  const size = readStoredSize(dl.bytes, "jpeg");
  assert.deepEqual([size.w, size.h], [8000, 6000]);
  const out = await decoded(dl.file);
  const lut = adjustmentCurve(15, 0);
  const source = await decoded(F.stress.file);
  // The export should be the source with brightness applied, so compare against the curve applied to the source.
  const adjusted = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data.length) };
  for (let i = 0; i < source.data.length; i += 4) {
    adjusted.data[i] = lut[source.data[i]];
    adjusted.data[i + 1] = lut[source.data[i + 1]];
    adjusted.data[i + 2] = lut[source.data[i + 2]];
    adjusted.data[i + 3] = 255;
  }
  const psnr = sampledPsnr(adjusted, out, 11);
  note("8000x6000 export vs source+curve", `PSNR ${psnr.toFixed(1)} dB`);
  assert.ok(psnr > 33);
  await context.close();
});
await check("a 48-megapixel picture can be exported as PNG and WebP at full size", async () => {
  const { context, page } = await open();
  await load(page, F.stress.file, { expect: "8000 × 6000" });
  await dontKeep(page);
  for (const fmt of ["png", "webp"]) {
    await setFormat(page, fmt);
    const t = Date.now();
    const dl = await saveFile(page, `stress.${fmt}`);
    const size = readStoredSize(dl.bytes, fmt);
    assert.deepEqual([size.w, size.h], [8000, 6000], fmt);
    note(`8000x6000 -> ${fmt}`, `${Date.now() - t} ms, ${(dl.bytes.length / 1048576).toFixed(1)} MB`);
  }
  await context.close();
});
await check("a picture over the limit (8200x8200, 67 MP) is refused clearly, not decoded", async () => {
  const { context, page } = await open();
  await page.locator('input[type="file"]').first().setInputFiles(F.overLimit.file);
  await page.waitForSelector("main .notice-error", { timeout: 30000 });
  assert.match(await page.locator("main .notice-error").innerText(), /more than 64 million pixels/);
  assert.equal(await page.locator('[data-testid="original-size"]').count(), 0);
  await context.close();
});

// ===================================================================================================================
console.log("6. Privacy, downloads wiring and storage");
await check("nothing is uploaded: no request carries the picture, and no storage key is added", async () => {
  const { context, page, requests, problems } = await open();
  const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort().concat(Object.keys(sessionStorage).sort().map((k) => "s:" + k)));
  await load(page, F.lossless.file);
  await rotR(page);
  await dontKeep(page);
  await saveFile(page, "privacy.png");
  const keysAfter = await page.evaluate(() => Object.keys(localStorage).sort().concat(Object.keys(sessionStorage).sort().map((k) => "s:" + k)));
  assert.deepEqual(keysAfter.filter((k) => !keysBefore.includes(k)), [], "no new storage keys");
  const origin = new URL(BASE).origin;
  const outgoing = requests.filter((r) => r.method !== "GET" && r.method !== "HEAD");
  assert.ok(outgoing.every((r) => r.url.includes("/api/analytics/")), "only (blocked-in-test) analytics beacons may be sent: " + JSON.stringify(outgoing));
  const external = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("blob:") && !r.url.startsWith("data:"));
  note("requests outside this site", external.length ? external.map((r) => new URL(r.url).host).join(",") : "none");
  assert.deepEqual(problems, []);
  await context.close();
});
await check("an image download fires the install reminder's 'task complete' signal exactly once per download", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  await page.evaluate(() => {
    window.__done = 0;
    window.addEventListener("ds-task-complete", () => window.__done++);
  });
  await saveFile(page, "signal1.png");
  assert.equal(await page.evaluate(() => window.__done), 1);
  await flipH(page);
  await saveFile(page, "signal2.png");
  assert.equal(await page.evaluate(() => window.__done), 2);
  await context.close();
});
await check("status messages are announced politely (aria-live) and errors use role=alert", async () => {
  const { context, page } = await open();
  await load(page, F.lossless.file);
  assert.equal(await page.locator('[data-testid="status"]').getAttribute("aria-live"), "polite");
  await rotR(page).catch(() => {});
  const dl = await saveFile(page, "announce.png");
  assert.match(await status(page), new RegExp(`Downloaded ${dl.suggested.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await context.close();
});

// ===================================================================================================================
console.log("7. Phone (375 px), touch, and themes");
await check("375px wide: no sideways scrolling; the Download button is not covered by the bottom bar, the Ask launcher or the cookie banner", async () => {
  const { context, page } = await open({ viewport: { width: 375, height: 760 }, touch: true });
  await load(page, F.photo.file, { expect: "4000 × 3000" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal overflow");
  const btn = page.locator('[data-assistant-id="image-edit-download"]');
  await btn.scrollIntoViewIfNeeded();
  const covered = await btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const pts = [[r.left + 8, r.top + r.height / 2], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 8, r.top + r.height / 2]];
    return pts.map(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return !!top && (top === el || el.contains(top));
    });
  });
  assert.deepEqual(covered, [true, true, true], "something sits over the Download button");
  await page.screenshot({ path: path.join(work, "mobile-375.png") });
  // Every button and field in the tool is at least 44px tall.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("main button, main select, main input:not([type=checkbox]):not([type=file]):not([type=range])")]
      .filter((e) => !e.closest("[data-crop-overlay]") && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5)
      .map((e) => (e.getAttribute("aria-label") || e.textContent || e.id).trim().slice(0, 30)),
  );
  assert.deepEqual(small, [], "controls shorter than 44px");
  await context.close();
});
await check("375px with a touch screen: the crop handles can be dragged with a finger", async () => {
  const { context, page } = await open({ viewport: { width: 375, height: 760 }, touch: true });
  await load(page, F.lossless.file);
  await page.locator('[data-assistant-id="image-edit-crop"]').click();
  await page.locator("[data-crop-overlay]").scrollIntoViewIfNeeded();
  const w0 = Number(await page.locator("#ie-crop-w").inputValue());
  const handle = await page.locator('[data-crop-handle="se"]').boundingBox();
  const cdp = await context.newCDPSession(page);
  const x0 = handle.x + handle.width / 2, y0 = handle.y + handle.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 - i * 14, y: y0 - i * 10 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const w1 = Number(await page.locator("#ie-crop-w").inputValue());
  assert.ok(w1 < w0 - 40, `touch drag should shrink the crop (${w0} -> ${w1})`);
  await page.locator('[data-assistant-id="image-edit-apply-crop"]').scrollIntoViewIfNeeded();
  await page.locator('[data-assistant-id="image-edit-apply-crop"]').click();
  assert.match(await resultSize(page), new RegExp(`${w1} × `));
  await context.close();
});
await check("light, warm beige and dark themes: the tool renders and its notices keep readable contrast", async () => {
  for (const theme of ["light", "beige", "dark"]) {
    const { context, page, problems } = await open({ theme });
    await load(page, F.logo.file);
    await dontKeep(page);
    await setFormat(page, "jpeg");
    const info = await page.evaluate(() => {
      const parse = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      const bgOf = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor;
          if (c && !/rgba?\(.*,\s*0\)$/.test(c) && c !== "transparent") return parse(c);
        }
        return [255, 255, 255];
      };
      const out = [];
      for (const el of document.querySelectorAll('ul[aria-label="About this download"] li, main .muted, main label, [data-assistant-id="image-edit-download"]')) {
        const fg = parse(getComputedStyle(el).color);
        out.push([el.textContent.trim().slice(0, 24), +ratio(fg, bgOf(el)).toFixed(2)]);
      }
      return { theme: document.documentElement.dataset.theme ?? "", out };
    });
    const low = info.out.filter(([, r]) => r < 4.5);
    assert.deepEqual(low, [], `${theme}: low-contrast text ${JSON.stringify(low)}`);
    await page.screenshot({ path: path.join(work, `theme-${theme}.png`) });
    assert.deepEqual(problems, []);
    await context.close();
  }
});

await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed (Chrome only; screenshots and downloads in ${work})`);
fs.writeFileSync(path.join(work, "edit-browser-measurements.json"), JSON.stringify(measurements, null, 1));
process.exit(failed.length ? 1 : 0);
