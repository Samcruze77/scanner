// Several pages with different crop decisions, and photo orientation (EXIF), through the real upload path.
// Frames are SIMULATED synthetic pictures (tests/scanner/fixtures.mjs); no physical camera.
//   node tests/scanner/multipage-browser.mjs [baseUrl]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CHROME, chromium, createCanvas, newPage, pdfReport, renderPage, saveDownload, visit, work } from "../audit/lib.mjs";
import { fixtures } from "./fixtures.mjs";

const FIX = Object.fromEntries(fixtures().map((f) => [f.name, f]));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0;
const ok = (n) => {
  pass++;
  console.log("  ok  " + n);
};
const jpg = (f, name) => {
  const file = path.join(work, name + ".jpg");
  fs.writeFileSync(file, f.canvas.toBuffer("image/jpeg", 92));
  return file;
};
const ready = (page, n) => page.waitForFunction((count) => [...document.querySelectorAll("button")].some((b) => new RegExp(`Create PDF \\(${count} page`).test(b.innerText) && !b.disabled), n, { timeout: 120000 });
const settle = (page) => page.waitForFunction(() => ![...document.querySelectorAll("*")].some((e) => e.children.length === 0 && /Processing…|Preparing page…|Detecting document…|Correcting perspective…/.test(e.textContent || "")), null, { timeout: 60000 });
async function exportPdf(page, name, n) {
  await ready(page, n);
  const create = page.locator('[data-assistant-id="scan-create-pdf"]');
  if (await create.isVisible().catch(() => false)) await create.click();
  return (await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), name)).file;
}
const psnrCanvas = (a, b) => {
  const da = a.getContext("2d").getImageData(0, 0, a.width, a.height).data, db = b.getContext("2d").getImageData(0, 0, a.width, a.height).data;
  let se = 0;
  for (let i = 0; i < da.length; i += 4) for (let k = 0; k < 3; k++) se += (da[i + k] - db[i + k]) ** 2;
  return se === 0 ? 99 : +(10 * Math.log10((255 * 255) / (se / ((da.length / 4) * 3)))).toFixed(1);
};
const selectPage = (page, i) => page.locator('ul[aria-label="Pages"] li button').nth(i).click();
const card = (page) => page.locator('[data-assistant-id="scan-suggested-crop"]');

console.log("A. Three pages, three different crop decisions, independent of each other");
{
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  const files = [jpg(FIX["desk-a4-rotated-5"], "m1"), jpg(FIX["table-lowcontrast"], "m2"), jpg(FIX["photo"], "m3")];
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(files);
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Pages"] li').length === 3, null, { timeout: 60000 });
  await ready(page, 3);
  await page.waitForTimeout(2500);
  // Uploads are never cropped unasked: each page offers its suggestion.
  for (let i = 0; i < 3; i++) {
    await selectPage(page, i);
    await card(page).waitFor({ timeout: 20000 });
  }
  ok("every uploaded page offers a suggested crop and none is cropped unasked");
  // Page 1: accept. Page 2: keep full. Page 3: adjust by hand.
  await selectPage(page, 0);
  await card(page).getByRole("button", { name: "Use suggested crop" }).click();
  await settle(page);
  await selectPage(page, 1);
  await card(page).getByRole("button", { name: "Keep full image" }).click();
  await selectPage(page, 2);
  await card(page).getByRole("button", { name: "Adjust crop" }).click();
  const dlg = page.getByRole("dialog", { name: "Adjust crop" });
  await dlg.waitFor();
  const tl = dlg.getByRole("button", { name: /^Top-left corner/ });
  await tl.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await dlg.getByRole("button", { name: "Apply crop" }).click();
  await dlg.waitFor({ state: "detached" });
  await settle(page);
  const first = await exportPdf(page, "multi-1.pdf", 3);
  const r1 = await pdfReport(first);
  assert.equal(r1.pageCount, 3);
  const px = r1.pages.map((p) => p.images[0].px);
  assert.ok(px[0][0] < 1000 && px[0][1] > 900, "page 1 was cropped to the page: " + px[0]);
  assert.deepEqual(px[1], [1600, 1200], "page 2 kept in full");
  assert.ok(px[2][0] < 1600 && px[2][0] > 900 && px[2][1] <= 1200, "page 3 cropped by hand: " + px[2]);
  ok(`export reflects each decision: page 1 ${px[0].join("x")} (accepted), page 2 ${px[1].join("x")} (kept full), page 3 ${px[2].join("x")} (adjusted by hand)`);
  assert.deepEqual(r1.pages.map((p) => p.orientation), ["portrait", "landscape", "landscape"]);
  ok(`page order and sheet orientation: ${r1.pages.map((p) => p.orientation).join(", ")}`);
  // Change page 3's decision only: pages 1 and 2 must not change at all.
  await selectPage(page, 2);
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  const editor = page.getByRole("dialog", { name: /Edit page 3/ });
  await editor.waitFor();
  await editor.getByRole("button", { name: "Reset to original" }).click();
  await page.waitForTimeout(800);
  await settle(page);
  await editor.getByRole("button", { name: "Done editing", exact: true }).click();
  const second = await exportPdf(page, "multi-2.pdf", 3);
  const r2 = await pdfReport(second);
  assert.deepEqual(r2.pages[2].images[0].px, [1600, 1200], "page 3 is now the full frame");
  for (const n of [1, 2]) {
    const a = await renderPage(first, n, 1), b = await renderPage(second, n, 1);
    const p = psnrCanvas(a, b);
    assert.ok(p >= 45, `page ${n} unchanged by page 3's decision (PSNR ${p})`);
  }
  ok("changing page 3's decision leaves pages 1 and 2 equal in content (PSNR >= 45 dB) and page 3 becomes the full frame");
  await context.close();
}

console.log("B. Photo orientation: an EXIF-rotated JPEG (SIMULATED file)");
{
  // A portrait page stored as landscape pixels with EXIF orientation 6 ("rotate 90 degrees clockwise to display").
  const f = FIX["desk-a4-portrait-frame"];
  const rot = createCanvas(f.H, f.W);
  const x = rot.getContext("2d");
  x.translate(0, rot.height);
  x.rotate(-Math.PI / 2);
  x.drawImage(f.canvas, 0, 0);
  const body = rot.toBuffer("image/jpeg", 92);
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  const file = path.join(work, "exif6.jpg");
  fs.writeFileSync(file, Buffer.concat([body.subarray(0, 2), seg, body.subarray(2)]));
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(file);
  await ready(page, 1);
  await page.waitForTimeout(2000);
  const out = await exportPdf(page, "exif.pdf", 1);
  const r = await pdfReport(out);
  assert.equal(r.pages[0].orientation, "portrait", "the page is upright (portrait), as the EXIF flag says");
  assert.deepEqual(r.pages[0].images[0].px, [f.W, f.H], "stored at the displayed (upright) size");
  ok(`an EXIF-rotated photo is decoded upright: ${r.pages[0].images[0].px.join("x")} px on a portrait sheet (stored pixels were ${f.H}x${f.W})`);
  await context.close();
}

await browser.close();
console.log(`\n${pass} checks passed`);
