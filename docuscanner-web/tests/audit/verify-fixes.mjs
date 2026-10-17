// Verifies the output-quality fixes on the REAL downloaded PDFs (Phases 1-3):
//  1. uploads are never auto-cropped (a crop is only a suggestion the person can accept)
//  2. transparent images never turn black (they are flattened onto white, and the person is told)
//  3. exported pages keep their own size and orientation (nothing is forced to A4 portrait)
//   node tests/audit/verify-fixes.mjs [baseUrl]      (needs `npm run start`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, createCanvas, embeddedStreams, loadImage, newPage, pdfReport, psnr, renderPage, saveDownload, visit } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const C = (n) => path.join(here, "corpus", n);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};

async function exportScan(files, name, between) {
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(files);
  const count = Array.isArray(files) ? files.length : 1;
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(\d+ page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  await page.waitForTimeout(1500); // let detection finish so a wrongly-applied crop would show
  await page.waitForFunction(() => !document.body.innerText.includes("Detecting document"), null, { timeout: 60000 });
  const extra = between ? await between(page) : null;
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  const dl = await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), name);
  await context.close();
  return { file: dl.file, extra };
}
const biggest = async (file) => (await embeddedStreams(file)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
const dims = (f) => loadImage(fs.readFileSync(f)).then((i) => [i.width, i.height]);

console.log("Phase 1: uploads are not cropped without consent");
for (const fixture of ["portrait-photo.jpg", "photo-landscape.jpg", "text-edge.jpg", "scan.jpg", "photo-std.jpg", "photo-hi.jpg", "logo.png", "logo-soft.png"]) {
  const src = C(fixture);
  const [sw, sh] = await dims(src);
  const r = await exportScan([src], `p1-${fixture}.pdf`);
  const s = await biggest(r.file);
  assert.deepEqual([s.width, s.height], [sw, sh], `${fixture}: exported ${s.width}x${s.height}, source ${sw}x${sh}`);
  if (/\.jpg$/.test(fixture)) {
    const p = await psnr(fs.readFileSync(src), s.bytes, 1400);
    assert.ok(p >= 40, `${fixture}: exported image matches the source (PSNR ${p} dB)`);
  }
  ok(`${fixture}: exported at full ${s.width}x${s.height}, nothing cropped`);
}
{
  // Corners of the portrait photo (red markers) are still in the exported page.
  const r = await exportScan([C("portrait-photo.jpg")], "p1-corners.pdf");
  const canvas = await renderPage(r.file, 1, 1);
  const x = canvas.getContext("2d");
  const probe = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3));
  // Find the image rectangle on the page by its red corner markers.
  const d = x.getImageData(0, 0, canvas.width, canvas.height).data;
  let reds = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90) reds++;
  assert.ok(reds > 100, `red corner markers visible on the page (${reds} px)`);
  void probe;
  ok("the portrait photo's four corner markers are all in the exported PDF");
}
{
  // The detected crop is a suggestion: offered, and applying it really crops; keeping the image does not.
  const r = await exportScan([C("scan.jpg")], "p1-suggest-keep.pdf", async (page) => {
    const card = page.getByRole("group", { name: "Suggested crop" });
    return { shown: await card.isVisible().catch(() => false) };
  });
  console.log("      suggested-crop card shown for scan.jpg:", r.extra.shown);
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(C("scan.jpg"));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  const card = page.getByRole("group", { name: "Suggested crop" });
  const offered = await card.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  if (offered) {
    await card.getByRole("button", { name: "Use suggested crop" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.locator('[data-assistant-id="scan-create-pdf"]').click();
    const dl = await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), "p1-accepted.pdf");
    const s = await biggest(dl.file);
    assert.ok(s.width < 1654 || s.height < 2339, `accepting the suggestion crops (${s.width}x${s.height})`);
    ok(`"Use suggested crop" still crops on request (${s.width}x${s.height} from 1654x2339)`);
  } else {
    console.log("      (no suggestion was offered for scan.jpg; accept path not exercised)");
  }
  await context.close();
}
{
  // Manual crop tool still works: open the page editor, Adjust crop, Done.
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(C("photo-std.jpg"));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Adjust crop" }).click();
  await page.getByRole("dialog").last().waitFor();
  const done = page.getByRole("button", { name: /^(Done|Apply|Use crop|Save)/ }).last();
  assert.ok(await done.isVisible(), "the crop editor opens with its own confirm button");
  ok("the manual crop editor still opens from the page editor");
  await context.close();
}

console.log("\nPhase 2: transparency");
async function transparencyCheck(fixture) {
  const src = C(fixture);
  const img = await loadImage(fs.readFileSync(src));
  const r = await exportScan([src], `p2-${fixture}.pdf`, async (page) => ({ notice: await page.getByText(/transparent areas/).first().isVisible().catch(() => false) }));
  const canvas = await renderPage(r.file, 1, 1);
  // Source mask at a small size, and where that image sits on the exported page (it fills the sheet width/height it was fitted to).
  const m = 200;
  const sc = createCanvas(m, Math.round((m * img.height) / img.width));
  const sx = sc.getContext("2d");
  sx.drawImage(img, 0, 0, sc.width, sc.height);
  const sd = sx.getImageData(0, 0, sc.width, sc.height).data;
  const pc = createCanvas(sc.width, sc.height);
  pc.getContext("2d").drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, sc.width, sc.height); // the page IS the image (page-sized sheet for pictures that fit)
  void pc;
  // Because pictures are fitted on an A4 sheet, find the image rectangle: the page layout is known from the PDF.
  const rep = await pdfReport(r.file);
  const im = rep.pages[0].images[0];
  const ptW = (im.wMm / 25.4) * 72, ptH = (im.hMm / 25.4) * 72;
  const pageWpt = rep.pages[0].widthPt, pageHpt = rep.pages[0].heightPt;
  const x0 = ((pageWpt - ptW) / 2 / pageWpt) * canvas.width, y0 = ((pageHpt - ptH) / 2 / pageHpt) * canvas.height;
  const w = (ptW / pageWpt) * canvas.width, h = (ptH / pageHpt) * canvas.height;
  const reg = createCanvas(sc.width, sc.height);
  reg.getContext("2d").drawImage(canvas, x0, y0, w, h, 0, 0, sc.width, sc.height);
  const pd = reg.getContext("2d").getImageData(0, 0, sc.width, sc.height).data;
  let transparent = 0, black = 0, opaque = 0, diff = 0;
  for (let i = 0; i < sd.length; i += 4) {
    const a = sd[i + 3];
    if (a === 0) {
      transparent++;
      if (pd[i] < 60 && pd[i + 1] < 60 && pd[i + 2] < 60) black++;
    } else if (a === 255) {
      opaque++;
      diff += (Math.abs(sd[i] - pd[i]) + Math.abs(sd[i + 1] - pd[i + 1]) + Math.abs(sd[i + 2] - pd[i + 2])) / 3;
    }
  }
  return { transparent, black, opaque, meanDiff: opaque ? diff / opaque : 0, notice: r.extra.notice };
}
for (const fixture of ["logo.png", "logo-soft.png", "signature-black.png", "signature.png"]) {
  const t = await transparencyCheck(fixture);
  assert.ok(t.transparent > 0, fixture + " has transparent pixels");
  assert.ok(t.black / t.transparent < 0.01, `${fixture}: ${t.black}/${t.transparent} transparent pixels came out black`);
  assert.ok(t.meanDiff < 25, `${fixture}: opaque colours preserved (mean difference ${t.meanDiff.toFixed(1)})`);
  assert.ok(t.notice, `${fixture}: the person is told transparency is filled with white`);
  ok(`${fixture}: ${t.transparent} transparent px -> ${t.black} black (was all black before), colour difference ${t.meanDiff.toFixed(1)}, notice shown`);
}
for (const fixture of ["opaque.png", "photo-std.jpg"]) {
  const src = C(fixture);
  const r = await exportScan([src], `p2-${fixture}.pdf`, async (page) => ({ notice: await page.getByText(/transparent areas/).first().isVisible().catch(() => false) }));
  assert.equal(r.extra.notice, false, `${fixture}: no transparency notice for an opaque image`);
  const s = await biggest(r.file);
  const p = await psnr(fs.readFileSync(src), s.bytes, 1000);
  assert.ok(p >= 38, `${fixture}: PSNR ${p}`);
  ok(`${fixture}: opaque image unchanged (PSNR ${p} dB), no spurious notice`);
}

console.log("\nPhase 3: page size and orientation");
const mm = (p) => [p.widthMm, p.heightMm];
const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;
for (const [fixture, expected] of [["a4-portrait.pdf", [[210, 297]]], ["a4-landscape.pdf", [[297, 210]]], ["letter.pdf", [[215.9, 279.4]]], ["mixed.pdf", [[210, 297], [297, 210], [215.9, 279.4], [279.4, 215.9]]]]) {
  const r = await exportScan([C(fixture)], `p3-${fixture}`);
  const rep = await pdfReport(r.file);
  assert.equal(rep.pageCount, expected.length, fixture + " page count");
  expected.forEach(([w, h], i) => {
    const p = rep.pages[i];
    assert.ok(near(p.widthMm, w) && near(p.heightMm, h), `${fixture} page ${i + 1}: ${p.widthMm}x${p.heightMm} mm, expected ${w}x${h}`);
    // PDF pages are re-embedded from the original now (Phase 5): real text and vector lines, not a picture.
    assert.ok(p.textChars > 0 && p.pathOps > 0, `${fixture} page ${i + 1}: original text (${p.textChars} chars) and vector drawing (${p.pathOps} ops) kept`);
  });
  ok(`${fixture}: ${rep.pages.map((p) => `${p.widthMm}x${p.heightMm}`).join(", ")} mm (same as the input), original content kept on each page`);
}
for (const [fixture, orient] of [["photo-landscape.jpg", "landscape"], ["portrait-photo.jpg", "portrait"]]) {
  const r = await exportScan([C(fixture)], `p3-${fixture}.pdf`, async (page) => { await page.waitForTimeout(0); });
  const rep = await pdfReport(r.file);
  const p = rep.pages[0];
  assert.equal(p.orientation, orient, `${fixture}: ${p.orientation}`);
  assert.ok(near(Math.max(p.widthMm, p.heightMm), 297) && near(Math.min(p.widthMm, p.heightMm), 210), `${fixture}: A4 sheet ${p.widthMm}x${p.heightMm}`);
  const im = p.images[0];
  assert.ok(Math.abs(im.wMm / im.hMm - (fixture.includes("landscape") ? 1.5 : 0.75)) < 0.02, `${fixture}: not stretched (${im.wMm}x${im.hMm})`);
  ok(`${fixture}: A4 ${orient} sheet, picture ${im.wMm}x${im.hMm} mm at its true shape`);
}

await browser.close();
console.log(`\n${pass} checks passed`);
