// The camera scanning workflow end to end in a real browser, with a SIMULATED camera: Chrome's fake video device plays a
// synthetic frame (tests/scanner/fixtures.mjs), so the real getUserMedia -> video -> capture -> detection -> crop ->
// export path runs. These are simulated results; no physical phone camera was used.
//   node tests/scanner/camera-browser.mjs [baseUrl]      (needs `npm run build && npx next start -p 3117`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, createCanvas, pdfReport, renderPage, saveDownload, work } from "../audit/lib.mjs";
import { fixtures } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const { loadImage } = require("@napi-rs/canvas");
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3117";
const FIX = Object.fromEntries(fixtures().map((f) => [f.name, f]));
let pass = 0;
const ok = (n) => {
  pass++;
  console.log("  ok  " + n);
};
const notes = [];
const note = (k, v) => notes.push([k, v]);

// ---- helpers -------------------------------------------------------------------------------------------
function mjpegFile(canvas, name) {
  const jpg = canvas.toBuffer("image/jpeg", 92);
  const file = path.join(work, name + ".mjpeg");
  fs.writeFileSync(file, Buffer.concat(Array.from({ length: 40 }, () => jpg)));
  return file;
}
async function withCamera(fixture, fn) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${mjpegFile(fixture.canvas, fixture.name)}`],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ["camera"] });
  const page = await context.newPage();
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  await page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  await page.addInitScript(() => localStorage.setItem("ds_consent", JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false })));
  try {
    await page.goto(BASE + "/scan?mode=camera", { waitUntil: "domcontentloaded" });
    const capture = page.getByRole("button", { name: "Capture page" });
    await capture.waitFor({ timeout: 30000 });
    await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.videoWidth > 0 && v.readyState >= 2; }, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    await capture.click();
    await ready(page);
    return await fn(page);
  } finally {
    await context.close();
    await browser.close();
  }
}
const ready = (page, n = 1) => page.waitForFunction((count) => [...document.querySelectorAll("button")].some((b) => new RegExp(`Create PDF \\(${count} page`).test(b.innerText) && !b.disabled), n, { timeout: 120000 });
async function exportPdf(page, name, n = 1) {
  await ready(page, n);
  const create = page.locator('[data-assistant-id="scan-create-pdf"]');
  if (await create.isVisible().catch(() => false)) await create.click();
  return (await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), name)).file;
}
const settle = (page) => page.waitForFunction(() => !document.querySelector("[role=dialog]")?.innerText.includes("Processing") && ![...document.querySelectorAll("*")].some((e) => e.children.length === 0 && /Processing…|Preparing page…|Detecting document…|Correcting perspective…|Enhancing page…/.test(e.textContent || "")), null, { timeout: 60000 });
const autoCard = (page) => page.locator('[data-assistant-id="scan-auto-crop"]');
const suggestCard = (page) => page.locator('[data-assistant-id="scan-suggested-crop"]');

// Red marker squares (#d00) still visible on the rendered first page: how many separate ones.
async function markers(file, pageNo = 1) {
  const c = await renderPage(file, pageNo, 1.5);
  const w = c.width, h = c.height;
  const d = c.getContext("2d").getImageData(0, 0, w, h).data;
  const cell = 6, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Uint16Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i] > 150 && d[i + 1] < 70 && d[i + 2] < 70) grid[Math.floor(y / cell) * gw + Math.floor(x / cell)]++;
  }
  const seen = new Uint8Array(gw * gh);
  let n = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < 4 || seen[i]) continue;
    n++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % gw, y = Math.floor(k / gw);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx;
        if (!seen[j] && grid[j] >= 4) { seen[j] = 1; stack.push(j); }
      }
    }
  }
  return n;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const imageOf = (report, i = 0) => report.pages[i].images[0];
function describe(report, fixture) {
  const p = report.pages[0], im = imageOf(report);
  const sheetIn = Math.max(p.widthMm, p.heightMm) / 25.4;
  return `${p.widthMm}x${p.heightMm} mm ${p.orientation}, picture ${im.px.join("x")} px (source frame ${fixture.W}x${fixture.H}), ${im.dpi} dpi`;
}

// ======================================================================================================
console.log("A. A page on a desk: proven safe, cropped automatically, and undoable (SIMULATED camera)");
{
  const f = FIX["desk-a4-rotated-5"];
  await withCamera(f, async (page) => {
    await autoCard(page).waitFor({ timeout: 20000 });
    assert.equal(await suggestCard(page).count(), 0);
    assert.match(await autoCard(page).innerText(), /Cropped to the page edges/);
    assert.match(await autoCard(page).innerText(), /nothing was deleted/);
    ok("a page with a clear edge on every side is cropped, and the person is told and offered 'Keep full image'");
    const cropped = await exportPdf(page, "A-cropped.pdf");
    const r = await pdfReport(cropped);
    const im = imageOf(r);
    assert.equal(r.pageCount, 1);
    assert.ok(im.px[0] >= 780 && im.px[1] >= 980, `no resolution lost: the picture is ${im.px.join("x")} for a page that is 800x1000 px in the frame`);
    assert.ok(im.px[0] < f.W * 0.7, "it really was cropped");
    assert.ok(near(im.px[0] / im.px[1], 0.8, 0.04), `aspect ratio ${(im.px[0] / im.px[1]).toFixed(3)} (page is 0.8)`);
    assert.equal(r.pages[0].orientation, "portrait");
    assert.equal(await markers(cropped), 4);
    note("A auto-cropped desk page", describe(r, f) + "; 4 of 4 edge markers kept; aspect " + (im.px[0] / im.px[1]).toFixed(3));
    ok(`cropped export: ${describe(r, f)}; all 4 edge markers kept; aspect ratio ${(im.px[0] / im.px[1]).toFixed(3)} (page 0.800); no resolution lost`);
    await autoCard(page).getByRole("button", { name: "Keep full image" }).click();
    await settle(page);
    await page.waitForTimeout(800);
    assert.equal(await autoCard(page).count(), 0);
    const full = await exportPdf(page, "A-full.pdf");
    const r2 = await pdfReport(full);
    const im2 = imageOf(r2);
    assert.deepEqual(im2.px, [f.W, f.H], "the full original frame");
    assert.equal(r2.pages[0].orientation, "landscape");
    assert.equal(await markers(full), 4);
    note("A after Keep full image", describe(r2, f));
    ok(`'Keep full image' restores the whole capture: ${describe(r2, f)}, 4 of 4 markers`);
  });
}

console.log("B. Pages that must NOT be cut automatically: they become suggestions (SIMULATED camera)");
for (const [name, detectedAs] of [["photo", "a photograph with no document boundary"], ["table-lowcontrast", "a pale page on a white table"], ["page-leaves-frame", "a page running past the frame"], ["fullframe-thin-border", "a white page on a near-white surface"]]) {
  const f = FIX[name];
  await withCamera(f, async (page) => {
    await page.waitForTimeout(1500);
    assert.equal(await autoCard(page).count(), 0, "no automatic crop");
    const card = suggestCard(page);
    await card.waitFor({ timeout: 20000 });
    const full = await exportPdf(page, `B-${name}-full.pdf`);
    const r = await pdfReport(full);
    assert.deepEqual(imageOf(r).px, [f.W, f.H], `${name}: nothing was cut`);
    assert.equal(await markers(full), f.markers.filter((m) => m.x > 0 && m.y > 0 && m.x < f.W && m.y < f.H).length);
    note(`B ${name} (${detectedAs})`, `suggestion offered, not applied; export is the full frame ${imageOf(r).px.join("x")}, all visible markers kept`);
    ok(`${name} (${detectedAs}): offered as a suggestion, export is the whole ${f.W}x${f.H} frame with every marker`);
  });
}

console.log("C. Suggestions stay optional: accept, adjust, keep full, and restore (SIMULATED camera)");
{
  const f = FIX["table-lowcontrast"];
  await withCamera(f, async (page) => {
    await suggestCard(page).waitFor({ timeout: 20000 });
    // Accept the suggestion.
    await suggestCard(page).getByRole("button", { name: "Use suggested crop" }).click();
    await settle(page);
    await page.waitForTimeout(800);
    const accepted = await exportPdf(page, "C-accepted.pdf");
    const ra = await pdfReport(accepted);
    assert.ok(imageOf(ra).px[0] < f.W * 0.9, "the accepted crop is in the export: " + imageOf(ra).px);
    ok(`accepting the suggestion applies it: the export is ${imageOf(ra).px.join("x")} (frame ${f.W}x${f.H})`);
    // Restore the full image from the editor.
    await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
    const editor = page.getByRole("dialog", { name: /Edit page 1/ });
    await editor.waitFor();
    await editor.getByRole("button", { name: "Reset to original" }).click();
    await page.waitForTimeout(800);
    await settle(page);
    await editor.getByRole("button", { name: "Done editing", exact: true }).click();
    const restored = await exportPdf(page, "C-restored.pdf");
    assert.deepEqual(imageOf(await pdfReport(restored)).px, [f.W, f.H]);
    ok("'Reset to original' brings back the full capture after a crop");
    // Adjust the crop by hand to a known rectangle through the keyboard (Shift+arrows move a corner by 5%).
    await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
    await editor.waitFor();
    await editor.getByRole("button", { name: "Adjust crop" }).click();
    const dlg = page.getByRole("dialog", { name: "Adjust crop" });
    await dlg.waitFor();
    const tl = dlg.getByRole("button", { name: /^Top-left corner/ });
    await tl.focus();
    for (let i = 0; i < 2; i++) await page.keyboard.press("Shift+ArrowRight");
    await dlg.getByRole("button", { name: "Apply crop" }).click();
    await dlg.waitFor({ state: "detached" });
    await settle(page);
    await editor.getByRole("button", { name: "Done editing", exact: true }).click();
    const manual = await exportPdf(page, "C-manual.pdf");
    const rm = await pdfReport(manual);
    assert.ok(imageOf(rm).px[0] < f.W && imageOf(rm).px[0] > 0, "manual crop in the export");
    ok(`a manual crop is exported as chosen (${imageOf(rm).px.join("x")})`);
  });
  const g = FIX["photo"];
  await withCamera(g, async (page) => {
    await suggestCard(page).waitFor({ timeout: 20000 });
    await suggestCard(page).getByRole("button", { name: "Keep full image" }).click();
    await page.waitForTimeout(500);
    assert.equal(await suggestCard(page).count(), 0);
    const file = await exportPdf(page, "C-keep.pdf");
    assert.deepEqual(imageOf(await pdfReport(file)).px, [g.W, g.H]);
    ok("'Keep full image' on a suggestion dismisses it and exports the whole capture");
  });
}

console.log("D. Orientation, resolution and repeated edits (SIMULATED camera)");
{
  for (const [name, orient] of [["desk-a4-portrait-frame", "portrait"], ["desk-landscape-page", "landscape"]]) {
    const f = FIX[name];
    await withCamera(f, async (page) => {
      await autoCard(page).waitFor({ timeout: 20000 });
      const file = await exportPdf(page, `D-${name}.pdf`);
      const r = await pdfReport(file);
      assert.equal(r.pages[0].orientation, orient);
      assert.equal(await markers(file), 4);
      const im = imageOf(r);
      const truthW = Math.hypot(f.poly[1].x - f.poly[0].x, f.poly[1].y - f.poly[0].y), truthH = Math.hypot(f.poly[3].x - f.poly[0].x, f.poly[3].y - f.poly[0].y);
      assert.ok(im.px[0] >= truthW * 0.97 && im.px[1] >= truthH * 0.97, `no resolution lost: ${im.px.join("x")} for a ${Math.round(truthW)}x${Math.round(truthH)} page`);
      note(`D ${name}`, describe(r, f) + ` (page in frame ${Math.round(truthW)}x${Math.round(truthH)})`);
      ok(`${name}: ${orient} sheet, ${describe(r, f)}; page ${Math.round(truthW)}x${Math.round(truthH)} px in the frame, 4 of 4 markers`);
    });
  }
  const f = FIX["desk-a4-rotated-5"];
  await withCamera(f, async (page) => {
    await autoCard(page).waitFor({ timeout: 20000 });
    const base = await exportPdf(page, "D-base.pdf");
    // Edit repeatedly, then put everything back to Original.
    await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
    const editor = page.getByRole("dialog", { name: /Edit page 1/ });
    await editor.waitFor();
    const click = async (name) => {
      await editor.getByRole("button", { name, exact: true }).click();
      await page.waitForTimeout(500);
      await settle(page);
    };
    for (const m of ["Grayscale", "Black & White", "Auto", "Grayscale", "Black & White", "Auto", "Original"]) await click(m);
    for (const [label, v] of [["Brightness", "50"], ["Contrast", "-40"], ["Brightness", "0"], ["Contrast", "0"]]) {
      await editor.getByLabel(label).fill(v);
      await editor.getByLabel(label).blur();
      await page.waitForTimeout(500);
      await settle(page);
    }
    await click("Rotate right");
    await click("Rotate left");
    await editor.getByRole("button", { name: "Done editing", exact: true }).click();
    const after = await exportPdf(page, "D-after.pdf");
    const a = await renderPage(base, 1, 1.2), b = await renderPage(after, 1, 1.2);
    assert.deepEqual([a.width, a.height], [b.width, b.height]);
    const da = a.getContext("2d").getImageData(0, 0, a.width, a.height).data, db = b.getContext("2d").getImageData(0, 0, b.width, b.height).data;
    let se = 0;
    for (let i = 0; i < da.length; i += 4) for (let k = 0; k < 3; k++) se += (da[i + k] - db[i + k]) ** 2;
    const psnr = se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / ((da.length / 4) * 3)));
    assert.ok(psnr >= 45, `after 7 mode changes, 4 slider moves and two rotations back to Original, the page equals its first export (PSNR ${psnr.toFixed(1)})`);
    note("D repeated edits then back to Original", `PSNR ${psnr.toFixed(1)} dB vs the first export; ${imageOf(await pdfReport(after)).px.join("x")}`);
    ok(`repeated enhancement, adjustment and rotation do not degrade the original: back at Original the page equals its first export (PSNR ${psnr.toFixed(1)} dB)`);
  });
}

await Promise.resolve();
console.log("\nMeasurements (SIMULATED camera frames, not a physical device)");
for (const [k, v] of notes) console.log(`  ${k}: ${v}`);
console.log(`\n${pass} checks passed`);
