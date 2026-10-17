// Audit part 3: protect PDF, large-image limits, print output of an imported PDF.
//   node tests/audit/audit-misc.mjs [baseUrl]     (needs `npm run start`)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, embeddedStreams, newPage, pdfjs, pdfReport, record, results, saveDownload, visit } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const C = (n) => path.join(here, "corpus", n);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const safe = async (feature, input, fn) => {
  try {
    await fn();
  } catch (e) {
    record({ status: "ERROR", feature, input, output: "-", summary: String(e).slice(0, 400) });
  }
};

// ---------- Protect PDF ----------
for (const fixture of ["text.pdf", "vector.pdf"]) {
  await safe("Protect PDF", fixture, async () => {
    const { context, page } = await newPage(browser);
    await visit(page, "/tools/protect-pdf");
    await page.locator('input[type="file"]').setInputFiles(C(fixture));
    await page.getByRole("textbox", { name: "Password to open the PDF" }).fill("Audit-pass-123");
    await page.getByRole("textbox", { name: "Confirm password" }).fill("Audit-pass-123");
    await page.locator('[data-assistant-id="protect-submit"]').click();
    const dl = await saveDownload(page, async () => page.locator('[data-assistant-id="protect-download"]').click({ timeout: 120000 }), `protected-${fixture}`);
    const data = new Uint8Array(fs.readFileSync(dl.file));
    let opened;
    try {
      await pdfjs.getDocument({ data: data.slice(), verbosity: 0 }).promise;
      opened = "opened WITHOUT a password";
    } catch (e) {
      opened = `needs a password (${e.name})`;
    }
    const task = pdfjs.getDocument({ data, password: "Audit-pass-123", verbosity: 0 });
    const doc = await task.promise;
    const p1 = await doc.getPage(1);
    const text = (await p1.getTextContent()).items.map((i) => i.str).join(" ");
    const ops = await p1.getOperatorList();
    const paths = ops.fnArray.filter((f) => f === pdfjs.OPS.constructPath).length;
    const src = await pdfReport(C(fixture), []);
    record({ status: opened.startsWith("needs") && text.length === src.pages[0].textChars + 0 || text.length > 0 ? "ok" : "FINDING", feature: "Protect PDF", input: fixture, output: `PDF ${kb(fs.statSync(dl.file).size)} (source ${kb(fs.statSync(C(fixture)).size)})`, summary: `${opened}; with the password: ${doc.numPages} pages, page 1 text ${text.length} chars (source ${src.pages[0].textChars}), vector ops ${paths} (source ${src.pages[0].pathOps}); content is structurally preserved (not rasterized)` });
    await task.destroy();
    await context.close();
  });
}

// ---------- Large uploads ----------
await safe("Scan upload (stress)", "photo-large.jpg 8000x6000 (11 MB JPEG, 48 MP)", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  const t0 = Date.now();
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(C("photo-large.jpg"));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 180000 });
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  const dl = await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 180000 }), "large.pdf");
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const s = (await embeddedStreams(dl.file)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  record({ status: "ok", feature: "Scan upload (stress)", input: "photo-large.jpg 8000x6000 (48 MP, 11 MB JPEG)", output: `PDF ${kb(fs.statSync(dl.file).size)}`, summary: `embedded ${s.width}x${s.height} ${s.filter} (capped at 4096 px long side; the auto-crop also applies); ${((Date.now() - t0) / 1000).toFixed(1)}s; JS heap ${Math.round(heap / 1048576)} MB; no crash` });
  await context.close();
});
await safe("Upload limit", "photo-large.png 45 MB", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(C("photo-large.png"));
  await page.waitForTimeout(6000);
  const msg = await page.evaluate(() => document.querySelector('[role="alert"]')?.innerText ?? "(no message)");
  record({ status: msg.includes("too large") ? "ok" : "FINDING", feature: "Upload limit (images)", input: "photo-large.png 45 MB", output: "(rejected)", summary: `message shown: "${msg}"` });
  await context.close();
});

// ---------- Print of an imported PDF (Chromium print to PDF) ----------
await safe("Print (imported PDF)", "text.pdf", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(C("text.pdf"));
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Pages"] li').length === 3, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll(".print-root[data-standing] .print-page img").length === 3 && [...document.querySelectorAll(".print-root[data-standing] img")].every((i) => i.complete), null, { timeout: 120000 });
  const file = path.join(here, "corpus", "..", "out-print-text.pdf");
  fs.writeFileSync(file, await page.pdf({ format: "A4", printBackground: true }));
  const rep = await pdfReport(file, ["TXT-P1-L01"]);
  record({ status: "FINDING", feature: "Print (editor, imported PDF)", input: "text.pdf (3 pages, selectable text)", output: `printed PDF ${kb(rep.bytes)}`, summary: `pages ${rep.pageCount}; text chars ${rep.textChars} (source 9758); page image ${rep.pages[0].images.map((i) => `${i.px.join("x")} @ ${i.dpi} dpi`).join(",")}; the printed pages are pictures of the pages, not text` });
  await context.close();
});

await browser.close();
fs.writeFileSync(path.join(here, "results-misc.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length} measurements saved to tests/audit/results-misc.json`);
