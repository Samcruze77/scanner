// Renders what the Scan workspace produces for an uploaded page-like JPEG, next to the source, so the
// automatic crop can be judged by eye.   node tests/audit/visual-crop.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, createCanvas, loadImage, newPage, renderPage, saveDownload, visit } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const sheet = [];
for (const fixture of ["scan.jpg", "photo-std.jpg", "logo.png"]) {
  const { context, page } = await newPage(browser);
  await visit(page, "/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(path.join(here, "corpus", fixture));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  const status = await page.evaluate(() => document.body.innerText.match(/Crop[^\n]*|Auto[^\n]*/g)?.slice(0, 3));
  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  const dl = await saveDownload(page, () => page.locator('[data-assistant-id="scan-download-pdf"]').click({ timeout: 120000 }), `v-${fixture}.pdf`);
  sheet.push({ fixture, canvas: await renderPage(dl.file, 1, 0.9), src: await loadImage(path.join(here, "corpus", fixture)), status });
  await context.close();
}
await browser.close();
const H = 760;
const out = createCanvas(sheet.length * 1100, H + 40);
const x = out.getContext("2d");
x.fillStyle = "#777";
x.fillRect(0, 0, out.width, out.height);
x.font = "18px Arial";
x.fillStyle = "#fff";
sheet.forEach((s, i) => {
  const ox = i * 1100 + 10;
  x.fillText(`${s.fixture}: source (left) vs downloaded PDF page 1 (right)`, ox, 24);
  const k = Math.min(520 / s.src.width, 700 / s.src.height);
  x.drawImage(s.src, ox, 40, s.src.width * k, s.src.height * k);
  x.fillStyle = "#fff";
  x.fillRect(ox + 540, 40, s.canvas.width * (700 / s.canvas.height), 700);
  x.drawImage(s.canvas, ox + 540, 40, s.canvas.width * (700 / s.canvas.height), 700);
});
fs.writeFileSync(path.join(here, "visual-crop.png"), out.toBuffer("image/png"));
console.log("saved tests/audit/visual-crop.png", JSON.stringify(sheet.map((s) => s.status)));
