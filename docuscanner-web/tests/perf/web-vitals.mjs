// Lab Core Web Vitals for a few pages, the way a mid-range phone on a slow connection sees them:
// Chrome, 412x823 mobile emulation, 4x CPU slowdown, ~1.6 Mbps down / 150 ms latency, cold cache.
// Reports the median of N loads per page: LCP, CLS, TBT (long-task time over 50 ms between first
// paint and 5 s after load), JavaScript transferred and executed, and the largest script chunks.
// Not Lighthouse (not installed), but the same throttling idea; compare runs with each other.
//
//   node tests/perf/web-vitals.mjs [baseUrl] [--runs=3] [--pages=/,/scan] [--chunks]

import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 3);
const PAGES = (process.argv.find((a) => a.startsWith("--pages="))?.split("=")[1] ?? "/,/scan,/create-word-document,/convert/pdf-to-jpg").split(",");
const SHOW_CHUNKS = process.argv.includes("--chunks");
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function measure(path) {
  const context = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  // A returning visitor's consent choice is not part of a cold first visit: keep the banner (as a first visit sees it).
  await context.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  await context.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0, longTasks: [] };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__vitals.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__vitals.longTasks.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const scripts = new Map();
  cdp.on("Network.responseReceived", (e) => { if (e.type === "Script") scripts.set(e.requestId, { url: e.response.url, bytes: 0 }); });
  cdp.on("Network.loadingFinished", (e) => { const s = scripts.get(e.requestId); if (s) s.bytes = e.encodedDataLength; });

  await page.goto(BASE + path, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(5000);
  const v = await page.evaluate(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    const nav = performance.getEntriesByType("navigation")[0];
    const end = nav.loadEventEnd + 5000;
    const tbt = window.__vitals.longTasks.filter(([s]) => s >= fcp && s <= end).reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
    return { lcp: window.__vitals.lcp, cls: window.__vitals.cls, tbt, fcp };
  });
  const list = [...scripts.values()];
  await context.close();
  return { ...v, jsBytes: list.reduce((n, s) => n + s.bytes, 0), scripts: list.sort((a, b) => b.bytes - a.bytes) };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`Lab vitals against ${BASE}: mobile 412x823, 4x CPU, ~1.6 Mbps/150 ms, cold cache, median of ${RUNS}\n`);
console.log("page".padEnd(28), "LCP".padStart(8), "CLS".padStart(7), "TBT".padStart(8), "FCP".padStart(8), "JS".padStart(9));
for (const path of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(path));
  const m = (k) => median(runs.map((r) => r[k]));
  console.log(path.padEnd(28), `${(m("lcp") / 1000).toFixed(2)} s`.padStart(8), m("cls").toFixed(3).padStart(7), `${Math.round(m("tbt"))} ms`.padStart(8), `${(m("fcp") / 1000).toFixed(2)} s`.padStart(8), kb(m("jsBytes")).padStart(9));
  if (SHOW_CHUNKS) for (const s of runs[0].scripts.slice(0, 8)) console.log("     ", kb(s.bytes).padStart(7), s.url.replace(/^https?:\/\/[^/]+/, ""));
}
await browser.close();
