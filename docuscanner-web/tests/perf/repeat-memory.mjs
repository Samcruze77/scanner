// Repeated processing must not make the app progressively heavier or slower.
// (Uses the real production server's /scan; nothing is uploaded -- it all runs in the browser.)
// In ONE tab (no reloads) it runs the main workflow many times -- upload two photos, create
// the PDF, download it, "Start new scan" -- then forces garbage collection and records the
// JS heap, the number of DOM nodes and how long each round took. Fails if memory keeps
// climbing round after round (a leak of pages, canvases or PDFs) or rounds get much slower.
//
//   node tests/perf/repeat-memory.mjs [baseUrl] [--rounds=12]   (needs `npm run build && npm run start`)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 12);
const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ["photo-std.jpg", "scan.jpg"].map((n) => path.join(here, "..", "audit", "corpus", n));
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ acceptDownloads: true });
// Image data lives in Blobs, outside the JS heap: count blob: URLs created and not revoked.
await context.addInitScript(() => {
  const live = new Set();
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (o) => { const u = create(o); live.add(u); return u; };
  URL.revokeObjectURL = (u) => { live.delete(u); return revoke(u); };
  window.__liveBlobUrls = () => live.size;
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("HeapProfiler.enable");
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/scan`, { waitUntil: "load" });
const upload = page.locator('input[aria-label^="Upload a document"]');
await upload.waitFor({ state: "attached" });

async function measure() {
  for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  const nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  const blobs = await page.evaluate(() => window.__liveBlobUrls());
  return { heapMB: usedSize / 1048576, nodes, blobs };
}

const rounds = [];
const base = await measure();
for (let r = 1; r <= ROUNDS; r++) {
  const t0 = Date.now();
  await upload.setInputFiles(FILES);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(2 page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  await page.getByRole("button", { name: /^Create PDF/ }).first().click();
  const dl = page.waitForEvent("download");
  await page.locator("[data-assistant-id=scan-download-pdf]").click();
  const file = await (await dl).path();
  const head = fs.readFileSync(file).subarray(0, 5).toString();
  assert.equal(head, "%PDF-", `round ${r}: a real PDF was downloaded`);
  await page.getByRole("button", { name: "Start new scan", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('ul[aria-label="Pages"] li'), null, { timeout: 30000 });
  const ms = Date.now() - t0;
  const m = await measure();
  rounds.push({ r, ms, ...m });
  console.log(`round ${String(r).padStart(2)}  ${String(ms).padStart(5)} ms  heap ${m.heapMB.toFixed(1)} MB  nodes ${m.nodes}  live blob URLs ${m.blobs}`);
}
// Downloads keep their temporary URL for 30 s on purpose (utils/convert/download.ts: revoking
// sooner cancels the download in Safari). Wait that out, then nothing from the rounds may remain.
await page.waitForTimeout(31_000);
const settledBlobs = await page.evaluate(() => window.__liveBlobUrls());
console.log(`live blob URLs 31 s after the last round: ${settledBlobs}`);
await browser.close();

console.log(`baseline heap ${base.heapMB.toFixed(1)} MB, nodes ${base.nodes}`);
// Rounds 1-2 warm caches (PDF.js, fonts, code chunks); compare the settled rounds.
const settled = rounds.slice(2);
const first = settled[0];
const last = settled[settled.length - 1];
const perRoundMB = (last.heapMB - first.heapMB) / (last.r - first.r);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const slow = median(settled.slice(-5).map((x) => x.ms)) / median(settled.slice(0, 5).map((x) => x.ms));
console.log(`heap growth after warm-up: ${perRoundMB.toFixed(2)} MB/round; last/first round time ratio ${slow.toFixed(2)}`);
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${name}`); if (!ok) failed++; };
check("heap does not keep growing (< 1 MB per round after warm-up)", perRoundMB < 1);
check("DOM is back to its starting size after each Start new scan (+/- 50 nodes)", Math.abs(last.nodes - first.nodes) <= 50);
check("page images and PDFs are released: no blob URLs remain once the download delay has passed", settledBlobs <= base.blobs);
check("rounds do not get slower (median of the last 5 rounds < 1.5x the first 5)", slow < 1.5);
check("no script errors", errors.length === 0);
process.exit(failed ? 1 : 0);
