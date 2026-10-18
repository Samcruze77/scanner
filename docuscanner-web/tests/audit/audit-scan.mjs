// Audit part 1: the Scan / Edit workspace (upload, import, edit, create PDF, download, print).
//   node tests/audit/audit-scan.mjs [baseUrl]     (needs `npm run start`)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, CHROME, chromium, detail, embeddedStreams, newPage, pdfReport, psnr, record, renderPage, results, saveDownload, visit, work } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const C = (n) => path.join(here, "corpus", n);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function waitPages(page, count) {
  await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label="Pages"] li').length === n, count, { timeout: 120000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(\d+ page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
}
async function scanRoute(files, name, setup) {
  const { context, page } = await newPage(browser);
  const t0 = Date.now();
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(files);
  const expected = files.length === 1 && files[0].endsWith("text.pdf") ? 3 : files.length === 1 && files[0].endsWith("vector.pdf") ? 2 : null;
  await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label="Pages"] li').length >= (n ?? 1), expected, { timeout: 120000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(\d+ page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  if (setup) await setup(page);
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  const dl = await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), name);
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  await context.close();
  return { ...dl, seconds: +((Date.now() - t0) / 1000).toFixed(1), heapMb: Math.round(heap / 1048576) };
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// ---------- A. photo uploads through Scan / Image to PDF ----------
for (const [fixture, w, h, note] of [["photo-hi.jpg", 4000, 3000, "12 MP photograph"], ["photo-std.jpg", 1600, 1200, "standard photograph"], ["photo-low.jpg", 400, 300, "low-resolution photograph"], ["scan.jpg", 1654, 2339, "scanned page (JPEG)"]]) {
  try {
    const r = await scanRoute([C(fixture)], `scan-${fixture}.pdf`);
    const rep = await pdfReport(r.file);
    const streams = (await embeddedStreams(r.file)).sort((a, b) => b.width * b.height - a.width * a.height);
    const img = streams[0];
    const src = fs.readFileSync(C(fixture));
    const sameBytes = img.bytes.equals(src);
    const p = img.filter.includes("DCT") ? await psnr(src, img.bytes) : null;
    const pg = rep.pages[0];
    record({
      status: !sameBytes ? "FINDING" : "ok", feature: "Scan / Image to PDF (upload)", input: `${fixture} (${w}x${h}, ${kb(src.length)}) ${note}`, output: `PDF ${kb(r.file ? fs.statSync(r.file).size : 0)}`,
      summary: `embedded ${img.width}x${img.height} ${img.filter}, original bytes kept: ${sameBytes}, PSNR vs source ${p} dB, page ${pg.widthMm}x${pg.heightMm} mm ${pg.orientation}, image drawn ${pg.images[0]?.wMm}x${pg.images[0]?.hMm} mm @ ${pg.images[0]?.dpi} dpi, ${r.seconds}s, heap ${r.heapMb} MB`,
      data: { fixture, embedded: [img.width, img.height], sameBytes, psnr: p, page: pg, pdfBytes: fs.statSync(r.file).size, srcBytes: src.length, seconds: r.seconds },
    });
  } catch (e) {
    record({ status: "ERROR", feature: "Scan / Image to PDF (upload)", input: fixture, output: "-", summary: String(e).slice(0, 300) });
  }
}

// ---------- B. transparent PNGs through the Scan upload path ----------
for (const fixture of ["logo.png", "signature.png"]) {
  try {
    const r = await scanRoute([C(fixture)], `scan-${fixture}.pdf`);
    const streams = await embeddedStreams(r.file);
    const rep = await pdfReport(r.file);
    const canvas = await renderPage(r.file, 1, 1);
    const px = canvas.getContext("2d").getImageData(2, 2, 1, 1).data;
    record({
      status: "FINDING", feature: "Scan / Image to PDF (transparent PNG)", input: `${fixture} (transparent)`, output: "PDF",
      summary: `embedded ${streams.map((s) => `${s.width}x${s.height} ${s.filter} alpha=${s.hasAlpha}`).join("; ")}; top-left pixel of page ${px.slice(0, 3)} (white/black fill means transparency is flattened); page ${rep.pages[0].widthMm}x${rep.pages[0].heightMm} mm`,
      data: { fixture, streams: streams.map((s) => ({ w: s.width, h: s.height, filter: s.filter, alpha: s.hasAlpha })), cornerPixel: [...px] },
    });
  } catch (e) {
    record({ status: "ERROR", feature: "Scan (transparent PNG)", input: fixture, output: "-", summary: String(e).slice(0, 300) });
  }
}

// ---------- C. stress: 48 MP PNG ----------
try {
  const r = await scanRoute([C("photo-large.png")], "scan-large.pdf");
  const streams = (await embeddedStreams(r.file)).sort((a, b) => b.width * b.height - a.width * a.height);
  record({ status: "ok", feature: "Scan upload (stress)", input: "photo-large.png 8000x6000 (48 MP, 45 MB PNG)", output: "PDF", summary: `embedded ${streams[0].width}x${streams[0].height} ${streams[0].filter}; ${r.seconds}s; JS heap ${r.heapMb} MB; PDF ${kb(fs.statSync(r.file).size)}`, data: { embedded: [streams[0].width, streams[0].height], seconds: r.seconds, heapMb: r.heapMb } });
} catch (e) {
  record({ status: "ERROR", feature: "Scan upload (stress)", input: "photo-large.png", output: "-", summary: String(e).slice(0, 300) });
}

// ---------- D. PDF import -> Create PDF (what "Edit PDF" does to a PDF) ----------
const pdfCases = [
  ["text.pdf", ["TXT-P1-L01", "TXT-P2-L24", "TXT-P3-L48", "R1C1"], 3],
  ["vector.pdf", ["VEC-P1", "VEC-P1-CAPTION", "VEC-P2"], 2],
  ["scan.pdf", ["SCAN-TITLE"], 1],
];
for (const [fixture, markers, pages] of pdfCases) {
  try {
    const srcRep = await pdfReport(C(fixture), markers);
    const r = await scanRoute([C(fixture)], `edit-${fixture}`);
    const rep = await pdfReport(r.file, markers);
    // Same-size renders of page 1 for a fair visual/detail comparison (150 dpi of the SOURCE page).
    const scale = 150 / 72;
    const a = await renderPage(C(fixture), 1, scale);
    const b = await renderPage(r.file, 1, scale * (srcRep.pages[0].widthPt / rep.pages[0].widthPt));
    const da = detail(a), db = detail(b);
    const p = rep.pages[0], sp = srcRep.pages[0];
    record({
      status: "FINDING", feature: "Edit PDF (import -> Create PDF)", input: `${fixture}: ${srcRep.pageCount} page(s), ${sp.widthMm}x${sp.heightMm} mm ${sp.orientation}, text chars ${srcRep.textChars}, vector ops p1 ${sp.pathOps}, images p1 ${sp.images.length}`, output: `PDF ${kb(rep.bytes)} (from ${kb(srcRep.bytes)})`,
      summary: `pages ${rep.pageCount}; page1 ${p.widthMm}x${p.heightMm} mm ${p.orientation}; text chars ${rep.textChars} (markers kept ${rep.markersFound}/${rep.markersTotal}); vector path ops p1 ${p.pathOps}; page image(s) ${p.images.map((i) => `${i.px[0]}x${i.px[1]} @ ${i.dpi} dpi`).join(", ")}; fine-detail at equal size: ${db.toFixed(1)} vs source ${da.toFixed(1)} (${((db / da) * 100).toFixed(0)}%)`,
      data: { fixture, src: { pages: srcRep.pageCount, page1: sp, text: srcRep.textChars, markers: `${srcRep.markersFound}/${srcRep.markersTotal}` }, out: { pages: rep.pageCount, page: rep.pages.map((q) => [q.widthMm, q.heightMm, q.orientation]), text: rep.textChars, markers: `${rep.markersFound}/${rep.markersTotal}`, images: p.images, pathOps: p.pathOps, bytes: rep.bytes }, detailRatio: +(db / da).toFixed(2) },
    });
    // Page-by-page size/orientation changes for the mixed-size vector.pdf
    if (fixture === "vector.pdf") {
      record({ status: "FINDING", feature: "Edit PDF page geometry", input: "vector.pdf: page 1 Letter portrait 215.9x279.4 mm, page 2 landscape 279.4x215.9 mm", output: "PDF", summary: rep.pages.map((q) => `p${q.n} ${q.widthMm}x${q.heightMm} mm ${q.orientation}, image ${q.images[0]?.wMm}x${q.images[0]?.hMm} mm`).join(" | ") });
    }
  } catch (e) {
    record({ status: "ERROR", feature: "Edit PDF (import -> Create PDF)", input: fixture, output: "-", summary: String(e).slice(0, 300) });
  }
}

// ---------- E. merge two PDFs ----------
try {
  const r = await scanRoute([C("text.pdf"), C("vector.pdf")], "merged.pdf");
  const rep = await pdfReport(r.file, ["TXT-P1", "VEC-P1"]);
  record({ status: "ok", feature: "Combine PDFs (multi-file upload)", input: "text.pdf (3 pages) + vector.pdf (2 pages)", output: "PDF", summary: `pages ${rep.pageCount} (expected 5), sizes ${rep.pages.map((q) => `${q.widthMm}x${q.heightMm}`).join(", ")}, page order check via image dims ${rep.pages.map((q) => q.images[0]?.px.join("x")).join(", ")}` });
} catch (e) {
  record({ status: "ERROR", feature: "Combine PDFs", input: "text.pdf+vector.pdf", output: "-", summary: String(e).slice(0, 300) });
}

// ---------- F. rotate + enhancement on a photo ----------
try {
  const r = await scanRoute([C("photo-std.jpg")], "rotated.pdf", async (page) => {
    await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
    await page.getByRole("button", { name: "Rotate right" }).click();
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !document.querySelector("[role=dialog]")?.innerText.includes("Processing"), null, { timeout: 30000 });
    await page.getByRole("button", { name: "Done editing", exact: true }).click();
  });
  const img = (await embeddedStreams(r.file)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  record({ status: "info", feature: "Edit page: rotate", input: "photo-std.jpg 1600x1200 rotated right", output: "PDF", summary: `embedded ${img.width}x${img.height} ${img.filter} (re-rendered from the original, JPEG q0.92)` });
} catch (e) {
  record({ status: "ERROR", feature: "Edit page: rotate", input: "photo-std.jpg", output: "-", summary: String(e).slice(0, 300) });
}

await browser.close();
fs.writeFileSync(path.join(here, "results-scan.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length} measurements saved to tests/audit/results-scan.json`);
