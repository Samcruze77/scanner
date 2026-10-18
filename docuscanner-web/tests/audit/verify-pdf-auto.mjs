// Auto enhancement on an imported PDF, through the real UI (it is NOT assumed to behave like Grayscale).
// rich.pdf (selectable text, 6 pt text, hairlines, an embedded 1600x1200 photo, portrait + landscape) is opened in
// the editor; Auto is applied to one page; the PDF is exported and the DOWNLOADED file is inspected and compared
// with the editor's own Auto preview. Then the edit is reset and exported again, and a long chain of repeated
// adjustments is checked not to degrade the page.
//   node tests/audit/verify-pdf-auto.mjs [baseUrl]      (needs `npm run start`)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, createCanvas, detail, embeddedStreams, loadImage, newPage, pdfReport, renderPage, saveDownload, visit } from "./lib.mjs";

const require = createRequire(import.meta.url);
const { createWorker } = require("tesseract.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const RICH = path.join(here, "corpus", "rich.pdf");
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0;
const ok = (n) => {
  pass++;
  console.log("  ok  " + n);
};
const notes = [];
const note = (k, v) => notes.push([k, v]);
const src = await pdfReport(RICH);
const srcStreams = await embeddedStreams(RICH);
const mm = (p) => [p.widthMm, p.heightMm];

async function openFile() {
  const { context, page } = await newPage(browser);
  await visit(page, "/tools/pdf-editor");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(RICH);
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Pages"] li').length === 3, null, { timeout: 60000 });
  const ready = () => page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(3 page/.test(b.innerText) && !b.disabled), null, { timeout: 90000 });
  await ready();
  return { context, page, ready };
}
const settle = (page) => page.waitForFunction(() => !document.querySelector("[role=dialog]")?.innerText.includes("Processing"), null, { timeout: 60000 });
async function editPage(page, index, fn) {
  await page.locator('ul[aria-label="Pages"] li button').nth(index).click();
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  const editor = page.getByRole("dialog", { name: `Edit page ${index + 1}` });
  await editor.waitFor();
  const result = await fn(editor);
  await page.waitForTimeout(400);
  await settle(page);
  await editor.getByRole("button", { name: "Done editing", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  return result;
}
// The editor's own preview picture of this page (the page after crop/rotate/enhance, before export).
const previewOf = (page, editor) =>
  editor.locator('img[alt$="preview"]').first().evaluate((img) => ({ src: img.src, w: img.naturalWidth, h: img.naturalHeight }));
async function exportPdf(page, ready, name) {
  await ready();
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  return (await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), name)).file;
}
async function canvasOfDataUrl(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}
const lumaOf = (c) => {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8Array(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return out;
};
const percentile = (l, p) => {
  const h = new Uint32Array(256);
  for (const v of l) h[v]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += h[v];
    if (acc >= l.length * p) return v;
  }
  return 255;
};
const chroma = (c) => {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]);
  return s / (d.length / 4);
};
function resizeTo(c, w, h) {
  const o = createCanvas(w, h);
  const x = o.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.fillStyle = "#fff";
  x.fillRect(0, 0, w, h);
  x.drawImage(c, 0, 0, w, h);
  return o;
}
function psnrCanvas(a, b) {
  const da = a.getContext("2d").getImageData(0, 0, a.width, a.height).data, db = b.getContext("2d").getImageData(0, 0, a.width, a.height).data;
  let se = 0;
  for (let i = 0; i < da.length; i += 4) for (let k = 0; k < 3; k++) se += (da[i + k] - db[i + k]) ** 2;
  const mse = se / ((da.length / 4) * 3);
  return mse === 0 ? 99 : +(10 * Math.log10((255 * 255) / mse)).toFixed(1);
}
// The exported page drawn by pdf.js at the same pixel size as `preview`.
async function exportedAt(file, pageNo, preview) {
  const probe = await renderPage(file, pageNo, 1);
  const scale = preview.width / probe.width;
  const c = await renderPage(file, pageNo, scale);
  return resizeTo(c, preview.width, preview.height);
}

// ======================================================================================================
console.log("A. Auto on the colourful page 1 (photo, hairlines, small text)");
let autoFile, previewA;
{
  const { context, page, ready } = await openFile();
  previewA = await editPage(page, 0, async (editor) => {
    const before = editor.locator('[data-flatten-notice="before"]');
    await before.waitFor();
    const t = await before.innerText();
    assert.match(t, /Only this page then becomes a picture/);
    assert.match(t, /other pages keep theirs/);
    assert.match(t, /Reset to original brings it back/);
    await editor.getByRole("button", { name: "Auto", exact: true }).click();
    await page.waitForTimeout(800);
    await settle(page);
    const warn = editor.locator('[data-flatten-notice="picture"]');
    await warn.waitFor();
    const w = await warn.innerText();
    assert.match(w, /Auto changes the colours of the page itself/);
    assert.match(w, /becomes a picture/);
    assert.match(w, /300 dpi \(lower on very large pages\)/);
    assert.match(w, /text and lines can no longer be selected/);
    assert.match(w, /other pages are not affected/);
    assert.ok(!/whole document|all pages|entire document/i.test(w), "must not imply the whole document is flattened");
    return previewOf(page, editor);
  });
  ok("UI: before choosing, the editor says only this page will become a picture (other pages keep their text) and that Reset brings it back");
  ok("UI: after choosing Auto, it names Auto, says the page becomes a picture at about 300 dpi, text and lines no longer selectable, other pages not affected");
  await page.locator('ul[aria-label="Pages"] li button').nth(0).click();
  assert.match(await page.locator('[data-flatten-notice="picture"]').first().innerText(), /Auto/);
  ok("UI: the same notice is shown next to the selected page");
  autoFile = await exportPdf(page, ready, "auto.pdf");
  await context.close();
}
{
  const out = await pdfReport(autoFile);
  const [p1, p2, p3] = out.pages;
  assert.equal(out.pageCount, 3);
  assert.deepEqual([mm(p1), mm(p2), mm(p3)], [[210, 297], [297, 210], [210, 297]]);
  assert.equal(p1.orientation, "portrait");
  assert.equal(p2.orientation, "landscape");
  ok(`page sizes and orientation: ${mm(p1)} portrait, ${mm(p2)} landscape, ${mm(p3)} portrait`);
  assert.ok(out.allText.indexOf("RICH-P2") < out.allText.indexOf("RICH-P3"), "order");
  assert.equal(p1.textChars, 0, "Auto page is a picture");
  const im = p1.images[0];
  assert.ok(im && im.dpi >= 285 && im.dpi <= 320, `effective resolution ${im?.dpi}`);
  assert.ok(im.wMm >= 209 && im.hMm >= 296, "the picture fills the page");
  note("Auto page 1", `picture ${im.px.join("x")} px, ${im.wMm}x${im.hMm} mm, effective ${im.dpi} dpi (the on-screen picture is ${previewA.w}x${previewA.h} = ${Math.round(previewA.w / (210 / 25.4))} dpi)`);
  ok(`Auto page: a picture of ${im.px.join("x")} px filling ${im.wMm}x${im.hMm} mm = ${im.dpi} dpi (the editor's preview is ${previewA.w}x${previewA.h})`);
  // Untouched pages keep text, vectors and embedded images.
  assert.equal(p2.textChars, src.pages[1].textChars);
  assert.equal(p3.textChars, src.pages[2].textChars);
  assert.equal(p2.pathOps, src.pages[1].pathOps);
  assert.equal(p3.pathOps, src.pages[2].pathOps);
  ok(`pages 2 and 3 keep their text (${p2.textChars}, ${p3.textChars} chars) and vector operations (${p2.pathOps}, ${p3.pathOps})`);

  // Compare with the editor's Auto preview under the same rendering conditions: the exported page drawn at the
  // preview's pixel size, both measured the same way.
  const prev = await canvasOfDataUrl(previewA.src);
  assert.equal(`${prev.width}x${prev.height}`, `${previewA.w}x${previewA.h}`);
  const exp = await exportedAt(autoFile, 1, prev);
  const lp = lumaOf(prev), le = lumaOf(exp);
  // Tone is compared where it is not decided by hairlines: the photo area (smooth tones, so shrinking the 300 dpi
  // picture to the preview's size does not change them) and the page as a whole at the white end.
  const crop = (c, f) => { const x = Math.round(f.x * c.width), y = Math.round(f.y * c.height), w = Math.round(f.w * c.width), h = Math.round(f.h * c.height); const o = createCanvas(w, h); o.getContext("2d").drawImage(c, x, y, w, h, 0, 0, w, h); return o; };
  const photoF = { x: 60 / 595.28, y: (841.89 - 505) / 841.89, w: 265 / 595.28, h: 195 / 841.89 };
  const pp = lumaOf(crop(prev, photoF)), pe = lumaOf(crop(exp, photoF));
  const tones = [0.05, 0.5, 0.95].map((q) => [percentile(pp, q), percentile(pe, q)]);
  for (const [x, y] of tones) assert.ok(Math.abs(x - y) <= 12, `photo tones match the preview (5/50/95%): ${JSON.stringify(tones)}`);
  const [p99a, p99b] = [percentile(lp, 0.99), percentile(le, 0.99)];
  assert.ok(Math.abs(p99a - p99b) <= 8, `white point matches: ${p99a} vs ${p99b}`);
  const [p1a, p1b] = [percentile(lp, 0.01), percentile(le, 0.01)];
  assert.ok(chroma(prev) < 1 && chroma(exp) < 1.5, `no colour: preview ${chroma(prev).toFixed(2)}, export ${chroma(exp).toFixed(2)}`);
  const meanDiff = Math.abs(le.reduce((s, v) => s + v, 0) / le.length - lp.reduce((s, v) => s + v, 0) / lp.length);
  assert.ok(meanDiff < 3, `mean brightness within ${meanDiff.toFixed(2)} of the preview`);
  // Text is judged by how much ink it puts on the page (mean brightness and the share of dark pixels over the title and
  // first ten lines), not pixel by pixel: shrinking a 300 dpi picture to the preview size moves glyph edges by a
  // fraction of a pixel, which a per-pixel PSNR punishes (about 20 dB) although the text is the same.
  const strip = { x: 0.05, y: 0.04, w: 0.65, h: 0.2 };
  const inkOf = (c) => { const l = lumaOf(crop(c, strip)); let dark = 0, sum = 0; for (const v of l) { sum += v; if (v < 128) dark++; } return { mean: sum / l.length, dark: (dark / l.length) * 100 }; };
  const ia = inkOf(prev), ib = inkOf(exp);
  assert.ok(Math.abs(ia.mean - ib.mean) < 2 && Math.abs(ia.dark - ib.dark) < 1, `text ink matches the preview: mean ${ia.mean.toFixed(2)} vs ${ib.mean.toFixed(2)}, dark ${ia.dark.toFixed(2)}% vs ${ib.dark.toFixed(2)}%`);
  const ps = `mean ${ia.mean.toFixed(2)} vs ${ib.mean.toFixed(2)}, dark pixels ${ia.dark.toFixed(2)}% vs ${ib.dark.toFixed(2)}%`;
  note("Auto export vs editor preview (same pixel size)", `photo-area tones (5/50/95%) preview vs export ${JSON.stringify(tones)}; white point ${p99a} vs ${p99b}; darkest 1% ${p1a} vs ${p1b} (thin text is lightened when the 300 dpi picture is shrunk to the preview size); mean brightness differs by ${meanDiff.toFixed(2)}; chroma ${chroma(prev).toFixed(2)} / ${chroma(exp).toFixed(2)}; text ink ${ps}`);
  ok(`export matches the editor's Auto preview: photo tones ${JSON.stringify(tones)}, white point ${p99a} vs ${p99b}, mean brightness within ${meanDiff.toFixed(2)}, no colour, text ink ${ps}`);
  // Clarity: the export is at least as sharp as the preview in the photo area and on the text lines.
  const big = await renderPage(autoFile, 1, 4); // 4x = about 288 dpi
  const photoBox = { x: 50 / 595.28, y: (841.89 - 512) / 841.89, w: 283 / 595.28, h: 212 / 841.89 };
  const bigPrev = resizeTo(prev, big.width, big.height); // the preview blown up to the same size
  const dExp = detail(big, photoBox), dPrev = detail(bigPrev, photoBox);
  assert.ok(dExp > dPrev * 1.05, `photo area is crisper than the preview enlarged (${dExp.toFixed(2)} vs ${dPrev.toFixed(2)})`);
  // Text edges: the share of grey "transition" pixels among all ink pixels. Crisp text has few; the on-screen picture
  // enlarged to the same size has many.
  const softShare = (c, f) => { const l = lumaOf(crop(c, f)); let mid = 0, dark = 0; for (const v of l) { if (v < 215) dark++; if (v >= 40 && v < 215) mid++; } return mid / Math.max(1, dark); };
  const textBox = { x: 0.05, y: 0.04, w: 0.65, h: 0.2 };
  const sExp = softShare(big, textBox), sPrev = softShare(bigPrev, textBox);
  assert.ok(sExp < sPrev * 0.9, `text edges are crisper than the preview enlarged (grey edge share ${sExp.toFixed(3)} vs ${sPrev.toFixed(3)})`);
  note("Auto sharpness at 4x", `photo-area detail ${dExp.toFixed(2)} vs ${dPrev.toFixed(2)} for the preview enlarged; text grey-edge share ${sExp.toFixed(3)} vs ${sPrev.toFixed(3)}`);
  ok(`image clarity: photo area ${dExp.toFixed(2)} vs ${dPrev.toFixed(2)} and text lines are crisper than the on-screen picture enlarged`);
  // Readability: read the exported page with OCR (the same engine the app ships).
  const png = path.join(os.tmpdir(), "auto-p1.png");
  const r2 = await renderPage(autoFile, 1, 2.5);
  fs.writeFileSync(png, r2.toBuffer("image/png"));
  const worker = await createWorker("eng", 1, { langPath: path.join(here, "..", "..", "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int"), cachePath: path.join(os.tmpdir(), "ocr-cache"), logger: () => {} });
  const { data } = await worker.recognize(png);
  await worker.terminate();
  const words = ["Edit-preservation", "fixture", "quick", "brown", "jumps", "lazy", "caption"];
  const found = words.filter((w) => data.text.toLowerCase().includes(w.toLowerCase()));
  assert.ok(found.length >= 5, `OCR reads the Auto page: ${found.join(", ")} (${found.length}/${words.length})`);
  note("Auto readability (OCR of the downloaded page)", `${found.length}/${words.length} sample words read: ${found.join(", ")}`);
  ok(`text readability: OCR of the downloaded Auto page reads ${found.length} of ${words.length} sample words (title, body and 6 pt caption included)`);
}

// ======================================================================================================
console.log("B. Auto on the landscape page 2: untouched pages keep text, vectors and the photo; then Reset to original");
{
  const { context, page, ready } = await openFile();
  await editPage(page, 1, async (editor) => {
    await editor.getByRole("button", { name: "Auto", exact: true }).click();
    await page.waitForTimeout(800);
    await settle(page);
    await editor.locator('[data-flatten-notice="picture"]').waitFor();
  });
  const f1 = await exportPdf(page, ready, "auto-p2.pdf");
  {
    const out = await pdfReport(f1);
    const [p1, p2, p3] = out.pages;
    assert.deepEqual([mm(p1), mm(p2), mm(p3)], [[210, 297], [297, 210], [210, 297]]);
    assert.equal(p2.textChars, 0);
    assert.ok(p2.images[0].dpi >= 285 && p2.images[0].dpi <= 320, "landscape Auto page at about 300 dpi: " + p2.images[0].dpi);
    assert.equal(p1.textChars, src.pages[0].textChars);
    assert.equal(p1.pathOps, src.pages[0].pathOps);
    const photo = p1.images.find((i) => i.px[0] === 1600);
    assert.ok(photo && photo.dpi === src.pages[0].images.find((i) => i.px[0] === 1600).dpi, "photo dpi kept");
    const streams = await embeddedStreams(f1);
    assert.ok(streams.some((s) => s.bytes.equals(srcStreams.find((x) => x.width === 1600).bytes)), "photo bytes identical");
    assert.equal(p3.textChars, src.pages[2].textChars);
    note("Auto on landscape page 2", `picture ${p2.images[0].px.join("x")} at ${p2.images[0].dpi} dpi, ${mm(p2)} mm landscape; page 1 text ${p1.textChars}/${src.pages[0].textChars}, path ops ${p1.pathOps}/${src.pages[0].pathOps}, photo ${photo.dpi} dpi with identical bytes; page 3 text ${p3.textChars}/${src.pages[2].textChars}`);
    ok(`landscape Auto page: ${p2.images[0].px.join("x")} px at ${p2.images[0].dpi} dpi, ${mm(p2)} mm; page 1 keeps text ${p1.textChars}, vectors ${p1.pathOps} and the photo (${photo.dpi} dpi, identical bytes); page 3 keeps its text`);
  }
  // Reset page 2 to original and export again.
  await editPage(page, 1, async (editor) => {
    await editor.getByRole("button", { name: "Reset to original" }).click();
    await page.waitForTimeout(800);
    await settle(page);
    assert.equal(await editor.locator('[data-flatten-notice="picture"]').count(), 0);
  });
  const f2 = await exportPdf(page, ready, "auto-reset.pdf");
  {
    const out = await pdfReport(f2);
    const [, p2] = out.pages;
    assert.deepEqual(mm(p2), [297, 210]);
    assert.equal(p2.textChars, src.pages[1].textChars);
    assert.equal(p2.pathOps, src.pages[1].pathOps);
    const a = await renderPage(RICH, 2, 1.2), b = await renderPage(f2, 2, 1.2);
    assert.deepEqual([a.width, a.height], [b.width, b.height]);
    const ps = psnrCanvas(a, b);
    assert.ok(ps >= 40, `after Reset the page renders as the source (PSNR ${ps})`);
    assert.ok(out.allText.includes("RICH-P2-SMALL"), "6 pt text selectable again");
    note("Reset to original after Auto (page 2)", `text ${p2.textChars}/${src.pages[1].textChars}, path ops ${p2.pathOps}/${src.pages[1].pathOps}, ${mm(p2)} mm, PSNR vs source ${ps} dB`);
    ok(`Reset to original restores the page: text ${p2.textChars} chars (6 pt text selectable again), vectors ${p2.pathOps}, ${mm(p2)} mm, PSNR ${ps} dB`);
  }
  await context.close();
}

// ======================================================================================================
console.log("C. Repeated adjustments do not degrade the stored source");
{
  const { context, page, ready } = await openFile();
  await editPage(page, 0, async (editor) => {
    const click = async (name) => {
      await editor.getByRole("button", { name, exact: true }).click();
      await page.waitForTimeout(500);
      await settle(page);
    };
    for (const m of ["Auto", "Grayscale", "Black & White", "Auto", "Grayscale", "Black & White", "Original", "Auto"]) await click(m);
    for (const [label, v] of [["Brightness", "40"], ["Contrast", "30"], ["Brightness", "-20"], ["Brightness", "0"], ["Contrast", "0"]]) {
      await editor.getByLabel(label).fill(v);
      await editor.getByLabel(label).blur();
      await page.waitForTimeout(500);
      await settle(page);
    }
    await editor.getByRole("button", { name: "Rotate right" }).click();
    await page.waitForTimeout(500);
    await settle(page);
    await editor.getByRole("button", { name: "Rotate left" }).click();
    await page.waitForTimeout(500);
    await settle(page);
  });
  const chain = await exportPdf(page, ready, "auto-chain.pdf");
  await context.close();
  const a = await renderPage(autoFile, 1, 1.5), b = await renderPage(chain, 1, 1.5);
  assert.deepEqual([a.width, a.height], [b.width, b.height]);
  const ps = psnrCanvas(a, b);
  assert.ok(ps >= 45, `after 8 mode changes, brightness/contrast moves and two rotations, the final Auto page equals a single Auto (PSNR ${ps})`);
  const out = await pdfReport(chain);
  assert.deepEqual(mm(out.pages[0]), [210, 297]);
  assert.ok(out.pages[0].images[0].dpi >= 285);
  note("Repeated adjustments (8 mode changes, 5 slider moves, rotate right and left, ending in Auto)", `identical to a single Auto export: PSNR ${ps} dB; ${out.pages[0].images[0].dpi} dpi`);
  ok(`repeated adjustments do not degrade the page: the final Auto page equals a single Auto export (PSNR ${ps} dB), still ${out.pages[0].images[0].dpi} dpi`);
}

// ======================================================================================================
console.log("D. Black & White uses the preview's threshold too");
{
  const { context, page, ready } = await openFile();
  const prevBw = await editPage(page, 0, async (editor) => {
    await editor.getByRole("button", { name: "Black & White", exact: true }).click();
    await page.waitForTimeout(800);
    await settle(page);
    return previewOf(page, editor);
  });
  const f = await exportPdf(page, ready, "bw.pdf");
  await context.close();
  const prev = await canvasOfDataUrl(prevBw.src);
  const exp = await exportedAt(f, 1, prev);
  const cropOf = (c, fr) => { const x = Math.round(fr.x * c.width), y = Math.round(fr.y * c.height), w = Math.round(fr.w * c.width), h = Math.round(fr.h * c.height); const o = createCanvas(w, h); o.getContext("2d").drawImage(c, x, y, w, h, 0, 0, w, h); return o; };
  const photoF = { x: 60 / 595.28, y: (841.89 - 505) / 841.89, w: 265 / 595.28, h: 195 / 841.89 };
  const mean = (l) => l.reduce((s, v) => s + v, 0) / l.length;
  const mp = mean(lumaOf(cropOf(prev, photoF))), me = mean(lumaOf(cropOf(exp, photoF)));
  assert.ok(Math.abs(mp - me) <= 12, `photo area black/white balance matches the preview: mean ${mp.toFixed(1)} vs ${me.toFixed(1)}`);
  note("Black & White export vs preview (photo area mean luminance)", `${mp.toFixed(1)} vs ${me.toFixed(1)}`);
  ok(`Black & White export keeps the preview's balance in the photo area (mean ${mp.toFixed(1)} vs ${me.toFixed(1)})`);
}

await browser.close();
console.log("\nMeasurements");
for (const [k, v] of notes) console.log(`  ${k}: ${v}`);
console.log(`\n${pass} checks passed`);
