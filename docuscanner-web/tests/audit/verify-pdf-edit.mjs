// Phase 5 acceptance: editing a PDF no longer destroys it. rich.pdf (selectable text, hairlines and circles,
// 6 pt text, an embedded 1600x1200 photo, a landscape page) is opened in the real editor, edited (text,
// highlight, check mark, pen, a picture; one page rotated, one enhanced, pages reordered), exported, and the
// DOWNLOADED file is inspected: text layer, vector operators, embedded image dimensions and bytes, page sizes,
// page order, and where the additions landed.
//   node tests/audit/verify-pdf-edit.mjs [baseUrl]      (needs `npm run start`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, createCanvas, embeddedStreams, newPage, pdfReport, psnr, renderPage, saveDownload, visit } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const C = (n) => path.join(here, "corpus", n);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};

const src = await pdfReport(C("rich.pdf"), ["RICH-P1-L01", "RICH-P1-L14", "RICH-P1-SMALL", "RICH-P2-SMALL", "RICH-P3-L20"]);
const srcImages = await embeddedStreams(C("rich.pdf"));
const { context, page } = await newPage(browser);
await visit(page, "/tools/pdf-editor");
await page.locator('input[aria-label^="Upload a document"]').setInputFiles(C("rich.pdf"));
await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Pages"] li').length === 3, null, { timeout: 60000 });
const ready = () => page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(3 page/.test(b.innerText) && !b.disabled), null, { timeout: 60000 });
await ready();

const frame = () => page.locator('[role="application"][aria-label="Page annotation area"]');
async function at(fx, fy) {
  const b = await frame().boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
async function drag(from, to) {
  const a = await at(...from), b = await at(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

// ---- edit page 1: text, highlight, check mark, pen, picture ----
await page.locator('ul[aria-label="Pages"] li button').nth(0).click();
await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
await page.locator('[data-assistant-id="page-annotate"]').click();
await page.getByRole("dialog", { name: /Annotate page/ }).waitFor();
await page.locator('[data-assistant-id="annotation-tool-text"]').click();
{
  const p = await at(0.12, 0.62);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type("EDIT-TEXT-ADDED hello");
  await page.locator('[data-assistant-id="annotation-tool-select"]').click();
}
await page.locator('[data-assistant-id="annotation-tool-highlight"]').click();
await drag([0.1, 0.17], [0.6, 0.2]);
await page.locator('[data-assistant-id="annotation-tool-check"]').click();
{
  const p = await at(0.8, 0.62);
  await page.mouse.click(p.x, p.y);
}
await page.locator('[data-assistant-id="annotation-tool-draw"]').click();
await drag([0.12, 0.7], [0.55, 0.74]);
await page.locator('[data-assistant-id="annotation-tool-image"]').click();
await page.locator('[data-assistant-id="image-file-input"]').setInputFiles(C("logo.png"));
await page.getByAltText("Your picture, ready to place on the page").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Place on page" }).click();
await page.locator('[role="application"] .border-dashed').first().waitFor();
await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
await page.getByRole("button", { name: "Done editing", exact: true }).click();
await ready();

// ---- page 2: rotate right; page 3: Grayscale (a pixel edit that must still work) ----
await page.locator('ul[aria-label="Pages"] li button').nth(1).click();
await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
await page.getByRole("button", { name: "Rotate right" }).click();
await page.waitForTimeout(1200);
await page.waitForFunction(() => !document.querySelector("[role=dialog]")?.innerText.includes("Processing"), null, { timeout: 30000 });
await page.getByRole("button", { name: "Done editing", exact: true }).click();
await page.locator('ul[aria-label="Pages"] li button').nth(2).click();
await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
await page.getByRole("button", { name: "Grayscale" }).click();
await page.waitForTimeout(1200);
await page.waitForFunction(() => !document.querySelector("[role=dialog]")?.innerText.includes("Processing"), null, { timeout: 30000 });
await page.getByRole("button", { name: "Done editing", exact: true }).click();
// ---- reorder: page 3 moves before page 2 ----
await page.locator('ul[aria-label="Pages"] li button').nth(2).click();
await page.getByRole("button", { name: "Move page 3 earlier" }).click();
await ready();
await page.locator('[data-assistant-id="scan-create-pdf"]').click();
const dl = await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), "rich-edited.pdf");
await context.close();
await browser.close();

// ---- inspect the downloaded file ----
const out = await pdfReport(dl.file, ["RICH-P1-L01", "RICH-P1-L14", "RICH-P1-SMALL", "RICH-P2-SMALL", "RICH-P3-L20", "EDIT-TEXT-ADDED"]);
console.log(`\nDownloaded: ${(out.bytes / 1024).toFixed(0)} KB (source ${(src.bytes / 1024).toFixed(0)} KB), ${out.pageCount} pages, text ${out.textChars} chars (source ${src.textChars})`);
const page1 = out.pages[0];

console.log("Phase 5 results");
assert.equal(out.pageCount, 3);
ok("the output opens and has 3 pages");
assert.ok(out.allText.includes("EDIT-TEXT-ADDED"), "the typed text is real, selectable text");
ok("the text added in the editor is real PDF text (selectable and searchable)");
const p1Text = out.allText.split("RICH-P3")[0];
for (const m of ["RICH-P1-L01", "RICH-P1-L14", "RICH-P1-SMALL"]) assert.ok(out.allText.includes(m), `original text kept: ${m}`);
assert.ok(page1.textChars >= src.pages[0].textChars, `page 1 text ${page1.textChars} >= source ${src.pages[0].textChars}`);
ok(`page 1 keeps all ${src.pages[0].textChars} characters of its original text (small 6 pt text included)`);
assert.ok(page1.pathOps >= src.pages[0].pathOps, `vector path operations kept: ${page1.pathOps} vs source ${src.pages[0].pathOps}`);
ok(`page 1's vector drawing is still vector (${page1.pathOps} path operations; source ${src.pages[0].pathOps}; picture-based export gave 0)`);
const photo = page1.images.find((i) => i.px[0] === 1600 && i.px[1] === 1200);
assert.ok(photo, "the original 1600x1200 photo is still embedded: " + JSON.stringify(page1.images.map((i) => i.px)));
const srcPhoto = src.pages[0].images.find((i) => i.px[0] === 1600);
assert.ok(Math.abs(photo.dpi - srcPhoto.dpi) <= 2 && Math.abs(photo.wMm - srcPhoto.wMm) < 0.3, `photo size/dpi unchanged: ${photo.wMm}x${photo.hMm} mm @ ${photo.dpi} dpi (source ${srcPhoto.wMm}x${srcPhoto.hMm} @ ${srcPhoto.dpi})`);
const streams = await embeddedStreams(dl.file);
assert.ok(streams.some((s) => s.bytes.equals(srcImages.find((x) => x.width === 1600).bytes)), "the photo's bytes are identical to the original");
ok(`the embedded photo is the original (1600x1200 @ ${photo.dpi} dpi, identical bytes)`);
const logo = page1.images.find((i) => i.px[0] === 1200 && i.px[1] === 1200);
assert.ok(logo && streams.some((s) => s.width === 1200 && s.hasAlpha), "the added logo is embedded at 1200x1200 with alpha");
ok("the picture added in the editor is embedded at full 1200x1200 with its transparency");
// Page size, orientation and order.
const mm = (p) => [p.widthMm, p.heightMm];
assert.deepEqual(mm(out.pages[0]), [210, 297]);
assert.ok(out.allText.indexOf("RICH-P3") < out.allText.indexOf("RICH-P2"), "page 3 comes before page 2");
ok("page 1 is A4 portrait and the reorder (page 3 before page 2) is in the file");
const rotated = out.pages[2]; // original page 2, turned right
assert.deepEqual(mm(rotated), [210, 297], "the landscape page, turned right, is now portrait");
assert.ok(rotated.textChars > 0, "the rotated page still has its text");
ok(`page 2 turned right: ${rotated.widthMm}x${rotated.heightMm} mm portrait, text kept (${rotated.textChars} chars)`);
// The grayscale page (pixels changed) is a picture of the page, at its true physical size.
const gray = out.pages[1];
assert.deepEqual(mm(gray), [210, 297]);
assert.equal(gray.textChars, 0, "an enhanced page is exported as a picture (documented limitation)");
assert.ok(gray.images[0] && gray.images[0].wMm >= 209);
ok(`page 3 (Grayscale): exported as a picture at its true size ${gray.widthMm}x${gray.heightMm} mm (text not selectable: documented limitation)`);
// Visual: an untouched region of page 1 renders like the source; the additions are where they were put.
const a = await renderPage(C("rich.pdf"), 1, 1.5);
const b = await renderPage(dl.file, 1, 1.5);
const topCrop = (c) => {
  const t = createCanvas(c.width, Math.round(c.height * 0.12));
  t.getContext("2d").drawImage(c, 0, 0, c.width, t.height, 0, 0, c.width, t.height);
  return t.toBuffer("image/png");
};
const p = await psnr(topCrop(a), topCrop(b), 900);
assert.ok(p >= 40, `the untouched top of page 1 renders like the source (PSNR ${p} dB)`);
ok(`untouched part of page 1 renders identically to the source (PSNR ${p} dB)`);
const x = b.getContext("2d");
const d = x.getImageData(0, 0, b.width, b.height).data;
const count = (f, box = [0, 0, 1, 1]) => {
  let n = 0;
  const [x0, y0, x1, y1] = box.map((v, i) => Math.round(v * (i % 2 ? b.height : b.width)));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const i = (yy * b.width + xx) * 4;
    if (f(d[i], d[i + 1], d[i + 2])) n++;
  }
  return n;
};
const yellow = count((r, g, bl) => r > 235 && g > 220 && bl < 150, [0.08, 0.15, 0.62, 0.22]);
const red = count((r, g, bl) => r < 90 && g < 90 && bl < 90, [0.75, 0.55, 0.95, 0.68]); // the check mark is drawn in the default (black) ink
const pen = count((r, g, bl) => r < 60 && g < 60 && bl < 60, [0.1, 0.69, 0.6, 0.77]);
assert.ok(yellow > 500, `highlight present where drawn (${yellow} px)`);
assert.ok(red > 30, `check mark present where placed (${red} px)`);
assert.ok(pen > 30, `pen stroke present where drawn (${pen} px)`);
ok(`additions appear where they were put: highlight ${yellow} px, check mark ${red} px, pen ${pen} px`);
console.log(`\n${pass} checks passed`);
