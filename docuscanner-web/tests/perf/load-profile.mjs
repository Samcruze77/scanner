// Where the main thread spends its time while a page loads: a V8 CPU profile from navigation to
// 5 s after `load`, under the same throttling as web-vitals.mjs (mobile, 4x CPU, slow network).
// Prints self time grouped by script and by the heaviest functions, plus the long tasks.
//
//   node tests/perf/load-profile.mjs [baseUrl] --page=/create-word-document [--top=25]

import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const PAGE = process.argv.find((a) => a.startsWith("--page="))?.split("=")[1] ?? "/create-word-document";
const TOP = Number(process.argv.find((a) => a.startsWith("--top="))?.split("=")[1] ?? 25);
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => p && fs.existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
await context.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
await context.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true });
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.goto(BASE + PAGE, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(5000);
const { profile } = await cdp.send("Profiler.stop");
const longTasks = await page.evaluate(() => window.__long);
await browser.close();

// Self time per node from the samples.
const dt = new Map();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
const byScript = new Map();
const byFn = new Map();
for (const node of profile.nodes) {
  const ms = dt.get(node.id) ?? 0;
  if (!ms) continue;
  const { url, functionName, lineNumber, columnNumber } = node.callFrame;
  const script = url ? url.replace(/^https?:\/\/[^/]+/, "") : `(${functionName || "native"})`;
  byScript.set(script, (byScript.get(script) ?? 0) + ms);
  const key = `${functionName || "(anonymous)"}  ${script}:${lineNumber + 1}:${columnNumber + 1}`;
  byFn.set(key, (byFn.get(key) ?? 0) + ms);
}
const total = [...byScript.values()].reduce((a, b) => a + b, 0);
console.log(`${PAGE}: ${Math.round(total)} ms sampled (4x CPU). Long tasks (start ms, duration ms): ${JSON.stringify(longTasks)}`);
console.log("\nSelf time by script:");
for (const [k, v] of [...byScript].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(String(Math.round(v)).padStart(7), "ms ", k);
console.log("\nHeaviest functions:");
for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(String(Math.round(v)).padStart(7), "ms ", k);
