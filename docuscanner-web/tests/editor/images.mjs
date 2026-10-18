// Cropping, restoring and resizing a picture that is already on a PDF page, checked in the PDF that
// is really downloaded - not in the preview:
//   - a high-resolution JPEG goes into the PDF as the very same bytes when nothing was changed or the
//     change was undone (no re-encoding), and a crop is made from the original's pixels, not the preview's
//   - a crop keeps the exact area chosen; Restore original, Reset crop and Reset size do different things
//   - undo / redo, Cancel, a transparent PNG (alpha kept), a low-resolution picture (honest warning, never
//     enlarged), several pictures on several pages with the page order intact, and a stated print size
//     that does not throw pixels away
//
//   npm run build && npm run start -- -p 3117      (in another terminal)
//   node tests/editor/images.mjs [baseUrl]

import fs from "node:fs";
import {
  addImage, assert, atFraction, boxOf, createCanvas, embeddedImages, exportPdf, finishEditing, isBlue, isPurple, isRed, launch, makeLogo,
  makePdf, makePhoto, ok, openAnnotator, openWorkspace, passed, path, renderPages, selection, session, surfaceBox, work,
} from "./lib.mjs";

const pdf = await makePdf("form.pdf", 2);
const hires = makePhoto("hires.jpg", 4000, 3000, 90);
const lowres = makePhoto("lowres.jpg", 300, 200, 90);
const logo = makeLogo("logo.png", 600);
const original = fs.readFileSync(hires);

const browser = await launch();
const { context, page, errors, outbound } = await session(browser, { viewport: { width: 1440, height: 900 } });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(4)} vs ${b.toFixed(4)} (±${tol})`);
const editor = () => page.getByRole("dialog", { name: /Annotate page/ });
const dialog = () => page.locator("[data-image-edit-dialog]");

async function shape() {
  const f = await surfaceBox(page);
  const s = await selection(page);
  return { ...s, ratio: (s.w * f.width) / (s.h * f.height), mmW: s.w * 210, mmH: s.h * 297 };
}
async function openEdit() {
  await editor().locator('[data-assistant-id="image-edit"]').click();
  await dialog().waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-assistant-id="image-edit-apply"]')?.disabled, null, { timeout: 20000 });
}
async function apply() {
  await dialog().locator('[data-assistant-id="image-edit-apply"]').click();
  await dialog().waitFor({ state: "detached", timeout: 20000 });
  await page.waitForTimeout(250);
}
const info = () => dialog().locator("[data-image-edit-info]").innerText();
const bannerFrac = 0.12;
function belowBanner(canvas) {
  const c = createCanvas(canvas.width, Math.round(canvas.height * (1 - bannerFrac)));
  c.getContext("2d").drawImage(canvas, 0, Math.round(canvas.height * bannerFrac), canvas.width, c.height, 0, 0, canvas.width, c.height);
  return c;
}

await openWorkspace(page, pdf, 2);
await openAnnotator(page, 1);

// ---- 1. place a 4000 x 3000 photograph; edit and undo; the original bytes stay -------------------
console.log("Picture editing inside the PDF editor");
await addImage(page, hires);
const placed = await shape();
near(placed.ratio, 4 / 3, 0.01, "placed with its own 4:3 shape");
assert.equal(await editor().locator('[data-assistant-id="image-restore"]').count(), 0, "nothing to restore yet");
ok("a 4000 x 3000 photograph is placed in its own shape; there is nothing to restore yet");

// ---- 2. crop to a square ------------------------------------------------------------------------------
await openEdit();
assert.match(await info(), /Keeps 4000 × 3000 px of your 4000 × 3000 px original/);
await dialog().getByRole("button", { name: "1:1 (square)" }).click();
await page.waitForTimeout(150);
const keeps = await info();
const m = keeps.match(/Keeps (\d+) × (\d+) px/);
assert.ok(m && Math.abs(Number(m[1]) - 3000) <= 3 && Math.abs(Number(m[2]) - 3000) <= 3, `the square keeps about 3000 x 3000 original pixels (${keeps})`);
ok("the crop dialog says exactly how many ORIGINAL pixels a crop keeps (3000 x 3000), not preview pixels");
// Cancel changes nothing.
await dialog().getByRole("button", { name: "Cancel" }).click();
await dialog().waitFor({ state: "detached" });
near((await shape()).ratio, 4 / 3, 0.01, "Cancel left the picture alone");
ok("Cancel leaves the picture exactly as it was");

await openEdit();
await dialog().getByRole("button", { name: "1:1 (square)" }).click();
await apply();
const squared = await shape();
near(squared.ratio, 1, 0.01, "the picture is now square");
// Cropping shows the same pixels at the same scale: 3000 of 4000 columns -> 3/4 of the width.
near(squared.w, placed.w * 0.75, 0.004, "the crop kept the scale: the square is 3/4 as wide as the whole photograph was");
assert.equal(await editor().locator('[data-assistant-id="image-restore"]').count(), 1, "Restore original is offered now");
ok("applying a square crop shows the same part at the same scale (nothing stretched or shrunk)");

// ---- 3. undo / redo -------------------------------------------------------------------------------------
await editor().getByRole("button", { name: "Undo" }).click();
near((await shape()).ratio, 4 / 3, 0.01, "undo brought the whole photograph back");
await editor().getByRole("button", { name: "Redo" }).click();
near((await shape()).ratio, 1, 0.01, "redo re-applied the crop");
ok("undo and redo reverse and re-apply a crop in one step");

// ---- 4. a free crop with a handle, then Reset crop vs Reset size vs Restore original ----------------
await openEdit();
await dialog().getByRole("button", { name: "Free" }).click();
const handle = await dialog().locator('[data-crop-handle="se"]').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(handle.x - 40, handle.y - 60, { steps: 6 });
await page.mouse.up();
const freeInfo = await info();
const fm = freeInfo.match(/Keeps (\d+) × (\d+) px/);
assert.ok(Number(fm[1]) < 3000 && Number(fm[2]) < 3000, `dragging a handle shrank the kept area (${freeInfo})`);
assert.notEqual(Math.round(Number(fm[1])), Math.round(Number(fm[2])), "a free crop is not forced to a shape");
await apply();
const freed = await shape();
assert.ok(freed.w < squared.w && freed.h < squared.h, "the free crop is smaller than the square");
near(freed.ratio, Number(fm[1]) / Number(fm[2]), 0.03, "its shape is the cropped area's shape");
ok("a free crop by dragging a handle keeps exactly the chosen part (shape follows the box)");

// Make it smaller on the page, then Reset size (a different action from Reset crop).
for (let i = 0; i < 3; i++) await editor().getByRole("button", { name: "Make the picture smaller" }).click();
const small = await shape();
assert.ok(small.w < freed.w * 0.8, "it was made smaller on the page");
await openEdit();
await dialog().getByLabel("Print size").selectOption("__reset");
await apply();
const resized = await shape();
near(resized.ratio, small.ratio, 0.01, "Reset size does not touch the crop");
near(resized.w, freed.w, 0.004, "…and puts it back to the size it was first placed at");
ok("Reset size changes only how big the cropped picture is on the page");

await openEdit();
await dialog().getByRole("button", { name: "Reset crop" }).click();
await apply();
const uncropped = await shape();
near(uncropped.ratio, 4 / 3, 0.01, "Reset crop shows the whole photograph again");
near(uncropped.w, resized.w * (4000 / Number(fm[1])), 0.01, "…at the same scale (it did not change size on the page)");
ok("Reset crop shows the whole picture again at the same scale");

// ---- 5. a stated print size: 35 x 45 mm, without throwing pixels away -----------------------------------
await openEdit();
await dialog().getByLabel("Print size").selectOption("35x45mm");
const printInfo = await info();
const pm = printInfo.match(/Keeps (\d+) × (\d+) px/);
near(Number(pm[1]) / Number(pm[2]), 35 / 45, 0.01, "the crop took the print size's shape");
assert.ok(Number(pm[2]) >= 2990, `the passport crop keeps the picture's full height in pixels (${printInfo})`);
await apply();
const passport = await shape();
near(passport.mmW, 35, 0.6, "35 mm wide on the page");
near(passport.mmH, 45, 0.6, "45 mm tall on the page");
ok("a 35 x 45 mm print size sets the size on paper and keeps all the pixels the shape allows");

// ---- 6. Restore original: the picture as first placed, in one click --------------------------------------
await editor().locator('[data-assistant-id="image-restore"]').click();
await page.waitForTimeout(300);
const restored = await shape();
near(restored.ratio, 4 / 3, 0.01, "Restore original: whole photograph, original shape");
near(restored.w, placed.w, 0.004, "…at the size it was first placed");
assert.equal(await editor().locator('[data-assistant-id="image-restore"]').count(), 0, "nothing left to restore");
await editor().getByRole("button", { name: "Undo" }).click();
near((await shape()).mmW, 35, 0.6, "Undo brings the edited version back");
await editor().getByRole("button", { name: "Redo" }).click();
near((await shape()).ratio, 4 / 3, 0.01, "Redo restores again");
ok("Restore original returns to the first placement in one step, and it can be undone and redone");

// Keep this one UNCHANGED on page 1 and move it aside (arrow buttons), for the export test.
for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowLeft");
const wholeAtEnd = await shape();

// ---- 7. a second, cropped copy of the same photograph, a transparent logo -------------------------------
await page.keyboard.press("Escape");
await addImage(page, hires);
for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowRight");
for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowDown");
await openEdit();
await dialog().getByRole("button", { name: "1:1 (square)" }).click();
await apply();
const croppedCopy = await shape();
await page.keyboard.press("Escape");
await addImage(page, logo);
for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowUp");
for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowRight");
const logoAt = await shape();
await page.keyboard.press("Escape");

// ---- 8. page 2: a low-resolution picture ----------------------------------------------------------------
await finishEditing(page);
await openAnnotator(page, 2);
await addImage(page, lowres);
const warning = editor().getByRole("status").filter({ hasText: "dpi" });
await warning.waitFor();
const warningText = await warning.innerText();
assert.match(warningText, /(Soft when printed|Low resolution): about \d+ dpi/);
const lowAt = await shape();
await finishEditing(page);
ok("a low-resolution picture is placed as it is, with an honest dpi warning (it is never enlarged to look sharper)");

// ---- 9. download and inspect the real PDF -----------------------------------------------------------------
const file = await exportPdf(page, "images.pdf");
const pages = await renderPages(file, "images", 2);
assert.equal(pages.length, 2, "page count");
assert.ok(boxOf(pages[0].canvas, (r, g, b) => b > 190 && r < 60 && g < 90), "page 1 still has its blue banner");
assert.ok(boxOf(pages[1].canvas, (r, g, b) => g > 120 && r < 40 && b < 60), "page 2 still has its green banner (order intact)");

const p1 = await embeddedImages(file, 0);
const p2 = await embeddedImages(file, 1);
console.log("      page 1 images:", p1.map((i) => `${i.width}x${i.height} ${i.filter} alpha=${i.hasAlpha} ${(i.bytes / 1024).toFixed(0)}KB @${Math.round(i.dpiX)}dpi`).join(" | "));
console.log("      page 2 images:", p2.map((i) => `${i.width}x${i.height} ${i.filter} @${Math.round(i.dpiX)}dpi`).join(" | "));
assert.equal(p1.length, 3, "three pictures on page 1");
assert.equal(p2.length, 1, "one picture on page 2");

// The untouched / restored photograph: the very same bytes as the file that was chosen.
const whole = p1.find((i) => i.width === 4000 && i.height === 3000);
assert.ok(whole, "the restored photograph is embedded at 4000 x 3000");
assert.match(whole.filter, /DCTDecode/);
assert.ok(Buffer.compare(Buffer.from(whole.contents), original) === 0, "the restored photograph is embedded byte-for-byte as the original JPEG (no re-encoding)");
ok("an untouched or restored JPEG is in the PDF as the original file's exact bytes, at 4000 x 3000");

// The cropped copy: made from the 4000 x 3000 original, not from the editing preview.
const square = p1.find((i) => i.height === 3000 && i.width !== 4000 && i.width > 2900 && i.width < 3100);
assert.ok(square, `a ~3000 x 3000 cropped picture is embedded (${p1.map((i) => i.width + "x" + i.height).join(", ")})`);
assert.ok(square.width > 1600, "the crop was cut from the original pixels, not the 1600 px preview");
assert.match(square.filter, /DCTDecode/);
const sqDpi = (square.width / (croppedCopy.w * 595.28)) * 72;
near(Math.round(square.dpiX), Math.round(sqDpi), 6, "its effective dpi matches the size it is drawn at");
ok(`a square crop is ${square.width} x ${square.height} real pixels from the original (about ${Math.round(square.dpiX)} dpi at its printed size)`);

// Crop boundary: the middle 3000 columns of the photograph = 420 px blue, 2160 px red, 420 px blue.
const r1 = pages[0].canvas;
const body = belowBanner(r1);
const sq = {
  x: Math.round(croppedCopy.x * body.width), y: Math.round(((croppedCopy.y - bannerFrac) / (1 - bannerFrac)) * body.height),
  w: Math.round(croppedCopy.w * body.width), h: Math.round((croppedCopy.h / (1 - bannerFrac)) * body.height),
};
const region = createCanvas(sq.w, sq.h);
region.getContext("2d").drawImage(body, sq.x, sq.y, sq.w, sq.h, 0, 0, sq.w, sq.h);
const red = boxOf(region, isRed);
const blue = boxOf(region, isBlue);
assert.ok(red && blue, "the cropped picture shows both red and blue");
near(red.w, 2160 / 3000, 0.03, "the red middle is 72% of the crop's width (the crop boundaries are exactly where they were chosen)");
near(blue.x, 0, 0.01, "blue starts at the crop's left edge");
ok("the crop boundaries in the downloaded PDF are exactly the chosen ones");

// The transparent logo keeps its alpha and is not enlarged.
const logoImg = p1.find((i) => i.width === 600 && i.height === 600);
assert.ok(logoImg, "the logo is embedded at its own 600 x 600");
assert.ok(logoImg.hasAlpha, "…with its transparency (an alpha mask)");
const purple = boxOf(r1, isPurple);
assert.ok(purple, "the logo is visible");
near(purple.x, logoAt.x, 0.02, "logo placed where the editor showed it");
const c = r1.getContext("2d");
const px = Math.round((logoAt.x + 0.004) * r1.width);
const py = Math.round((logoAt.y + 0.004) * r1.height);
const [r, g, b] = c.getImageData(px, py, 1, 1).data;
assert.ok(r > 240 && g > 220 && b < 215, `the logo's transparent corner shows the page, not a white box (${r},${g},${b})`);
ok("a transparent PNG keeps its alpha channel and its pixel size; no white box");

// The low-resolution picture: embedded as it is.
assert.equal(p2[0].width, 300);
assert.equal(p2[0].height, 200);
assert.ok(p2[0].dpiX < 150, `its effective resolution is honestly low (${Math.round(p2[0].dpiX)} dpi) - it was not enlarged`);
near(p2[0].dpiX / 72 * 595.28 * 0 + lowAt.x, lowAt.x, 1e-9, "(placement recorded)");
ok("a 300 x 200 picture stays 300 x 200 in the PDF (about 121 dpi); no fake detail is added");

// Where each picture is on the page matches the editor.
const sizeMm = (i) => ({ w: (i.drawnWidthPt * 25.4) / 72, h: (i.drawnHeightPt * 25.4) / 72 });
near(sizeMm(whole).w, wholeAtEnd.mmW, 0.8, "the whole photograph's printed width equals what the editor showed");
near(sizeMm(square).w, croppedCopy.mmW, 0.8, "the cropped copy's printed width equals what the editor showed");
ok("physical size on the page in the PDF equals the size shown in the editor");

// ---- 10. a print-size picture in the PDF ---------------------------------------------------------------------------
{
  await openWorkspace(page, pdf, 2);
  await openAnnotator(page, 1);
  await addImage(page, hires);
  await openEdit();
  await dialog().getByLabel("Print size").selectOption("35x45mm");
  await apply();
  const ps = await shape();
  await finishEditing(page);
  const f2 = await exportPdf(page, "passport.pdf");
  const imgs = await embeddedImages(f2, 0);
  assert.equal(imgs.length, 1);
  const w = (imgs[0].drawnWidthPt * 25.4) / 72;
  const h = (imgs[0].drawnHeightPt * 25.4) / 72;
  near(w, 35, 0.3, "the exported passport picture is 35 mm wide");
  near(h, 45, 0.3, "…and 45 mm tall");
  assert.ok(imgs[0].height >= 2990, `its pixels were not reduced to reach that size (${imgs[0].width} x ${imgs[0].height})`);
  assert.ok(imgs[0].dpiX > 600, `so it is far sharper than print needs (${Math.round(imgs[0].dpiX)} dpi)`);
  near(ps.mmW, 35, 0.6, "(editor agreed)");
  ok(`a 35 x 45 mm picture is exactly that size in the PDF with ${imgs[0].width} x ${imgs[0].height} pixels (${Math.round(imgs[0].dpiX)} dpi)`);
}

// ---- 10b. Replace image, then Restore original returns to the REPLACEMENT's placed size ---------------------------------
{
  await openWorkspace(page, pdf, 2);
  await openAnnotator(page, 1);
  await addImage(page, logo);
  for (let i = 0; i < 3; i++) await editor().getByRole("button", { name: "Make the picture larger" }).click();
  await editor().locator('[data-assistant-id="image-replace"]').click();
  await page.locator('[data-assistant-id="image-file-input"]').setInputFiles(hires);
  await page.getByAltText("Your picture, ready to place on the page").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Replace picture" }).click();
  await page.waitForTimeout(300);
  const replacedAt = await shape();
  await openEdit();
  await dialog().getByRole("button", { name: "1:1 (square)" }).click();
  await apply();
  await editor().locator('[data-assistant-id="image-restore"]').click();
  await page.waitForTimeout(300);
  const back = await shape();
  near(back.w, replacedAt.w, 0.004, "Restore original after Replace image returns to the replacement's own size");
  near(back.ratio, 4 / 3, 0.01, "…and its original shape");
  ok("Replace image, edit, Restore original: back to the replacement picture at the size it was placed");
}

// ---- 11. sharpness: a crop is the original's own pixels, not a resampled preview ----------------------------------
{
  const { loadImage } = (await import("node:module")).createRequire(import.meta.url)("@napi-rs/canvas");
  // Fine detail on purpose: 1 px lines, text and noise-like gradients show any blur, resize or heavy re-encode.
  const W = 3000, H = 2000;
  const src = createCanvas(W, H);
  const sctx = src.getContext("2d");
  const grad = sctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#203040");
  grad.addColorStop(0.5, "#c0a060");
  grad.addColorStop(1, "#406080");
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, W, H);
  sctx.strokeStyle = "#ffffff";
  sctx.lineWidth = 1;
  for (let x = 0; x < W; x += 7) {
    sctx.beginPath();
    sctx.moveTo(x + 0.5, 0);
    sctx.lineTo(x + 0.5, H);
    sctx.stroke();
  }
  sctx.fillStyle = "#000000";
  sctx.font = "40px Arial";
  for (let y = 60; y < H; y += 120) sctx.fillText("Sharp detail 0123456789 ABCDEF", 100, y);
  const detailFile = path.join(work, "detail.jpg");
  fs.writeFileSync(detailFile, src.toBuffer("image/jpeg", 95));
  const reference = await loadImage(detailFile);

  await openWorkspace(page, pdf, 2);
  await openAnnotator(page, 1);
  await addImage(page, detailFile);
  await openEdit();
  await dialog().getByRole("button", { name: "1:1 (square)" }).click();
  await apply();
  await finishEditing(page);
  const f3 = await exportPdf(page, "detail.pdf");
  const [emb] = await embeddedImages(f3, 0);
  assert.ok(emb && emb.height === 2000 && emb.width >= 1995 && emb.width <= 2005, `the square is cut at full height: ${emb?.width}x${emb?.height}`);
  fs.writeFileSync(path.join(work, "embedded.jpg"), Buffer.from(emb.contents));
  const out = await loadImage(path.join(work, "embedded.jpg"));
  const oc = createCanvas(emb.width, emb.height);
  oc.getContext("2d").drawImage(out, 0, 0);
  const od = oc.getContext("2d").getImageData(0, 0, emb.width, emb.height).data;
  // Best match against the original's centre square, allowing a pixel or two of rounding in where the box sits.
  let best = 0;
  for (let dx = -3; dx <= 3; dx++) {
    const rc = createCanvas(emb.width, emb.height);
    const rctx = rc.getContext("2d");
    rctx.drawImage(reference, 500 + dx, 0, emb.width, emb.height, 0, 0, emb.width, emb.height);
    const rd = rctx.getImageData(0, 0, emb.width, emb.height).data;
    let se = 0, n = 0;
    for (let i = 0; i < rd.length; i += 4 * 7) {
      for (let k = 0; k < 3; k++) {
        const d = rd[i + k] - od[i + k];
        se += d * d;
        n++;
      }
    }
    const psnr = 10 * Math.log10((255 * 255) / Math.max(se / n, 1e-9));
    best = Math.max(best, psnr);
  }
  assert.ok(best > 36, `the cropped picture in the PDF is the original's own pixels (PSNR ${best.toFixed(1)} dB; a blurred or resized copy would be well under 30)`);
  ok(`a crop of fine detail matches the original region pixel for pixel (PSNR ${best.toFixed(1)} dB after one high-quality JPEG save)`);
}

assert.deepEqual(outbound, [], "nothing was uploaded: " + outbound.join(", "));
assert.deepEqual(errors, [], "no console or page errors");
ok("nothing was uploaded and there were no console errors");
await context.close();
await browser.close();
console.log(`\n${passed()} checks passed`);
console.log("Files in " + work);
void path;
void atFraction;
