// Isolates the re-encoding loss of the Scan upload path: the page's auto-crop is reset ("Reset to original"),
// so what remains is the decode -> canvas -> JPEG 0.92 -> PDF round trip.   node tests/audit/audit-genloss.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, embeddedStreams, newPage, pdfReport, psnr, record, saveDownload, visit } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
for (const fixture of ["photo-hi.jpg", "photo-std.jpg", "photo-low.jpg", "scan.jpg", "logo.png"]) {
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(path.join(here, "corpus", fixture));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  const reset = page.getByRole("button", { name: "Reset to original" });
  if (await reset.isEnabled()) await reset.click();
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector("[role=dialog]")?.innerText.includes("Processing"), null, { timeout: 30000 });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  const dl = await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), `gl-${fixture}.pdf`);
  const s = (await embeddedStreams(dl.file)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const src = fs.readFileSync(path.join(here, "corpus", fixture));
  const p = await psnr(src, s.bytes, 1400);
  const rep = await pdfReport(dl.file);
  const same = s.bytes.equals(src);
  record({ status: "info", feature: "Scan upload, crop reset (re-encode loss only)", input: fixture, output: `PDF ${(fs.statSync(dl.file).size / 1024).toFixed(0)} KB (source ${(src.length / 1024).toFixed(0)} KB)`, summary: `embedded ${s.width}x${s.height} ${s.filter} alpha=${s.hasAlpha}; original bytes kept: ${same}; PSNR vs source ${p} dB (>=40 dB is visually identical; ~35 dB is slight); image drawn ${rep.pages[0].images[0]?.wMm}x${rep.pages[0].images[0]?.hMm} mm @ ${rep.pages[0].images[0]?.dpi} dpi` });
  await context.close();
}
await browser.close();
