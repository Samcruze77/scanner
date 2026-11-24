// The consent banner and first-use tips are part of the server HTML (so they paint with the page and
// don't cause a late Largest Contentful Paint or a layout shift). This checks, frame by frame from the
// very first paint, that:
//   * a first-time visitor sees the banner and the tip from the first frame;
//   * a visitor who already chose never sees the banner, and a dismissed tip never shows, not even
//     for one frame before hydration;
//   * "Cookie settings" in the footer still reopens the banner, and "Got it" still hides a tip;
//   * no React hydration errors are reported.
//   node tests/seo/prepaint-ui.mjs [baseUrl]   (needs `npm run build && npm run start`)

import fs from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
const BASE = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const TOOL = "/tools/pdf-editor";
const HINT = "tool-pdf_editor";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failed++;
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// Records, for every animation frame from the first one, whether the banner / tip is visible.
async function framesFor(path, storage) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && /hydrat|#418|#423|#425/i.test(m.text()) && errors.push(m.text()));
  page.on("pageerror", (e) => /hydrat|#418|#423|#425/i.test(String(e)) && errors.push(String(e)));
  await page.addInitScript((items) => {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    window.__frames = [];
    const visible = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && getComputedStyle(el).display !== "none";
    };
    const tick = () => {
      if (document.body) window.__frames.push({ banner: visible("[data-consent-banner]"), hint: visible("[data-hint-id]") });
      if (window.__frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, storage);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const frames = await page.evaluate(() => window.__frames);
  return { ctx, page, frames, errors };
}

const decided = { ds_consent: JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false }) };

console.log("1. First-time visitor");
{
  const { ctx, frames, errors } = await framesFor(TOOL, {});
  check("banner is visible from the first frame", frames.length > 0 && frames.every((f) => f.banner), `${frames.filter((f) => !f.banner).length} frames without it`);
  check("tip is visible from the first frame", frames.length > 0 && frames.every((f) => f.hint), `${frames.filter((f) => !f.hint).length} frames without it`);
  check("no hydration errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

console.log("2. Returning visitor (consent chosen, tip dismissed)");
{
  const { ctx, page, frames, errors } = await framesFor(TOOL, { ...decided, [`docuscanner.hint.${HINT}`]: "1" });
  check("banner never shows, not even for one frame", frames.length > 0 && frames.every((f) => !f.banner), `${frames.filter((f) => f.banner).length} frames with it`);
  check("dismissed tip never shows, not even for one frame", frames.every((f) => !f.hint), `${frames.filter((f) => f.hint).length} frames with it`);
  check("no hydration errors", errors.length === 0, errors.join(" | "));
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await page.waitForTimeout(500);
  check("Cookie settings reopens the banner", await page.locator("[data-consent-banner]").isVisible());
  await ctx.close();
}

console.log("3. Dismissing");
{
  const { ctx, page } = await framesFor(TOOL, decided);
  await page.locator("[data-hint-id]").getByRole("button", { name: "Got it" }).click();
  await page.waitForTimeout(300);
  check("Got it hides the tip", (await page.locator("[data-hint-id]").count()) === 0);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(() => window.__frames);
  check("…and it stays hidden after a reload, from the first frame", frames.every((f) => !f.hint), `${frames.filter((f) => f.hint).length} frames with it`);
  await ctx.close();
}

console.log("4. Choosing in the banner");
{
  const { ctx, page } = await framesFor("/", {});
  await page.getByRole("button", { name: "Reject non-essential" }).click();
  await page.waitForTimeout(300);
  check("banner closes after a choice", (await page.locator("[data-consent-banner]").count()) === 0);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(() => window.__frames);
  check("…and does not flash on the next page load", frames.every((f) => !f.banner), `${frames.filter((f) => f.banner).length} frames with it`);
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
