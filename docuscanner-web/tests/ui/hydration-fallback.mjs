// Reproduces the production failure behind "Warm Beige keeps turning back into Light":
// the server HTML of the homepage disagrees with the browser about the phone bottom bar's
// Home tab (on Vercel the regenerated homepage was rendered as "/index"), React 19 reports
// hydration error #418, discards the server HTML and re-creates the page, resetting <html>.
//
// This test serves the real homepage with exactly that disagreement injected (the Home tab's
// active marker removed from the HTML), so React really does fall back to a client render,
// and checks that each saved theme is still on screen afterwards.
//
//   node tests/ui/hydration-fallback.mjs [baseUrl]     (needs `npm run build && npm run start`)

import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
const PAGE = { light: "rgb(250, 250, 250)", beige: "rgb(232, 226, 216)", dark: "rgb(17, 17, 19)" };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let failed = 0;
for (const theme of ["beige", "dark", "light"]) {
  const context = await browser.newContext({ colorScheme: theme === "dark" ? "light" : "dark" });
  await context.addInitScript((t) => localStorage.setItem("pdfscanner.theme", t), theme);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route(`${BASE}/`, async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    // The Home tab as the regenerated server HTML had it: not marked as the current page.
    const before = html;
    html = html.replace(/(<a aria-current="page" data-assistant-id="nav-home"[^>]*>)<span aria-hidden="true" class="absolute[^"]*"><\/span>/, (_m, a) => a.replace(' aria-current="page"', ""));
    assert.notEqual(html, before, "the Home tab marker was found and removed");
    await route.fulfill({ response: res, body: html });
  });
  try {
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const hydrationError = errors.some((e) => /418|hydrat/i.test(e));
    const state = await page.evaluate(() => ({ attr: document.documentElement.getAttribute("data-theme"), bg: getComputedStyle(document.body).backgroundColor }));
    assert.ok(hydrationError, "React really fell back to a client render (error #418 seen)");
    assert.equal(state.attr, theme, "data-theme kept");
    assert.equal(state.bg, PAGE[theme], "page painted in the chosen theme");
    console.log(`  ✓ ${theme}: survives a hydration fallback (data-theme=${state.attr}, ${state.bg})`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${theme}: ${e.message.split("\n")[0]}`);
  }
  await context.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
