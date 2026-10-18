// Print quality: Chromium's real print output (page.pdf of the editor's armed document, A4 paper) for rich.pdf
// (selectable text, 6 pt text, vector lines, an embedded photo, a landscape page, 3 pages), with and without
// an inserted picture. Reports image pixel size and effective dpi on paper, page order and orientation, and
// fine-detail against the source rendered at the same physical size.
//   node tests/audit/verify-print.mjs [baseUrl]      (needs `npm run start`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, createCanvas, detail, embeddedStreams, newPage, pdfReport, renderPage, visit } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const C = (n) => path.join(here, "corpus", n);
const work = path.join(here, "corpus", "..", "out-print");
fs.mkdirSync(work, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};
const note = (s) => console.log("      " + s);

async function printOf(fixture, name, edit) {
  const { context, page } = await newPage(browser);
  await visit(page, "/tools/pdf-editor");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(C(fixture));
  await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label="Pages"] li').length === n, 3, { timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(3 page/.test(b.innerText) && !b.disabled), null, { timeout: 60000 });
  if (edit) await edit(page);
  await page.waitForFunction(() => document.querySelectorAll(".print-root[data-standing] .print-page").length === 3, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => [...document.querySelectorAll(".print-root[data-standing] img")].every((i) => i.complete), null, { timeout: 60000 });
  const file = path.join(work, name);
  fs.writeFileSync(file, await page.pdf({ format: "A4", printBackground: true }));
  await context.close();
  return file;
}

// ---- plain print of the unedited PDF ----
const plain = await printOf("rich.pdf", "plain.pdf");
const rep = await pdfReport(plain, ["RICH-P1-L01"]);
console.log(`\nPlain print: ${rep.pageCount} pages, ${(rep.bytes / 1024).toFixed(0)} KB`);
rep.pages.forEach((p) => note(`page ${p.n}: ${p.widthMm}x${p.heightMm} mm ${p.orientation}, text ${p.textChars} chars, vector ops ${p.pathOps}, images ${p.images.map((i) => `${i.px.join("x")}@${i.dpi}dpi`).join(",") || "none"}`));
const imgs = rep.pages.map((p) => p.images.reduce((best, i) => (i.px[0] * i.px[1] > (best?.px[0] ?? 0) * (best?.px[1] ?? 1) ? i : best), null));
assert.equal(rep.pageCount, 3);
ok("3 pages in print");
// Page order: the page carrying the landscape rectangle/grid is page 2; page 1 and 3 portrait pictures.
assert.deepEqual(rep.pages.map((p) => p.orientation), ["portrait", "landscape", "portrait"]);
ok("orientation per page kept (portrait, landscape, portrait) and order intact");

// Fine detail at equal physical size: render the printed page 1 and the source page 1 on the same millimetre grid.
const srcRep = await pdfReport(C("rich.pdf"), []);
const printed = rep.pages[0];
const srcScale = 300 / 72;
const a = await renderPage(C("rich.pdf"), 1, srcScale);
// the print scales the page onto the sheet; render it so that one printed page-width equals the source page width
const content = imgs[0];
const b = await renderPage(plain, 1, srcScale * (srcRep.pages[0].widthMm / (content ? content.wMm : printed.widthMm)));
const dA = detail(a, { x: 0, y: 0.03, w: 1, h: 0.3 });
// crop the printed render to the picture's rectangle (centred on the sheet)
const wFrac = content ? content.wMm / printed.widthMm : 1, hFrac = content ? content.hMm / printed.heightMm : 1;
const dB = detail(b, { x: 0, y: 0.03 * hFrac, w: 1, h: 0.3 * hFrac });
note(`fine-detail of the text/line area at equal size: print ${dB.toFixed(1)} vs source ${dA.toFixed(1)} (${((dB / dA) * 100).toFixed(0)}%)`);
const dpis = imgs.map((i) => i?.dpi);
note(`page image effective dpi on paper: ${dpis.join(", ")}`);
const results = { dpis, detailRatio: +(dB / dA).toFixed(2), textChars: rep.pages.map((p) => p.textChars), vectorOps: rep.pages.map((p) => p.pathOps) };
fs.writeFileSync(path.join(here, "results-print.json"), JSON.stringify(results, null, 2));

// ---- print with an inserted picture ----
const edited = await printOf("rich.pdf", "edited.pdf", async (page) => {
  await page.locator('ul[aria-label="Pages"] li button').nth(0).click();
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  await page.locator('[data-assistant-id="page-annotate"]').click();
  await page.locator('[data-assistant-id="annotation-tool-image"]').click();
  await page.locator('[data-assistant-id="image-file-input"]').setInputFiles(C("logo.png"));
  await page.getByAltText("Your picture, ready to place on the page").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Place on page" }).click();
  await page.locator('[role="application"] .border-dashed').first().waitFor();
  await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector(".print-root[data-standing] .print-page:nth-child(1) svg"), null, { timeout: 60000 });
});
const er = await pdfReport(edited, []);
const streams = await embeddedStreams(edited);
const logo = streams.find((s) => s.width === 1200 && s.height === 1200);
console.log(`\nPrint with an inserted picture: ${er.pageCount} pages`);
assert.ok(logo && logo.hasAlpha, "the inserted logo is printed at full 1200x1200 with its transparency");
ok("inserted picture printed at its full 1200x1200 with alpha");
console.log(`\n${pass} checks passed (plus measurements above)`);
await browser.close();
