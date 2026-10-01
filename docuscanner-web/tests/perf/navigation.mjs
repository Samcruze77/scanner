// Client-side navigation timings on a production build (next start).
//   node tests/perf/navigation.mjs [baseUrl]
// Measures click -> URL change + new <h1> visible, and counts non-GET/analytics requests.
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.argv[2] ?? "http://localhost:3102").replace(/\/$/, "");
const CHROME = [process.env.CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const consent = JSON.stringify({ version: 1, decided_at: "x", analytics: true, advertising: false, recordings: false });
const profiles = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
const STEPS = ["/tools", "/tools/protect-pdf", "/tools/compress-pdf", "/scan", "/tools/ocr"];
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

for (const [name, opts] of Object.entries(profiles)) {
  const context = await browser.newContext(opts);
  await context.addInitScript((c) => localStorage.setItem("ds_consent", c), consent);
  const page = await context.newPage();
  const reqs = [];
  page.on("request", (r) => reqs.push(`${r.method()} ${new URL(r.url()).pathname}`));
  let t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "load" });
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
  console.log(`[${name}] initial load ${Date.now() - t0}ms`, JSON.stringify(nav));
  await page.waitForTimeout(1500);
  const times = [];
  for (const path of STEPS) {
    reqs.length = 0;
    const start = Date.now();
    // client-side navigation through a real in-page link when present, else history push via router
    const link = page.locator(`a[href="${path}"]:visible`).first();
    if (await link.count()) await link.click();
    else await page.evaluate((p) => { history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
    await page.waitForURL(`**${path}`, { timeout: 15000 });
    await page.locator("main h1, h1").first().waitFor({ timeout: 15000 });
    const ms = Date.now() - start;
    times.push(ms);
    console.log(`[${name}] -> ${path}: ${ms}ms  analytics: track x${reqs.filter((r) => r === "POST /api/analytics/track").length}, heartbeat x${reqs.filter((r) => r === "POST /api/analytics/heartbeat").length}, ads-eligible x${reqs.filter((r) => /ads-eligible/.test(r)).length}`);
    await page.waitForTimeout(600);
  }
  const s = Date.now();
  await page.goBack();
  await page.locator("h1").first().waitFor();
  console.log(`[${name}] back: ${Date.now() - s}ms`);
  console.log(`[${name}] median nav ${median(times)}ms max ${Math.max(...times)}ms`);
  await context.close();
}
await browser.close();
