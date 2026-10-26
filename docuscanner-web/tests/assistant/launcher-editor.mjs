// The "Ask me" button on the Create Word Document page: it stays on screen, opens the assistant, and steps clear of the
// formatting toolbar and the phone's bottom bar as the page scrolls, at phone and desktop sizes.
//
//   npm run build && npm run start           (another terminal)
//   node tests/assistant/launcher-editor.mjs [baseUrl]    default http://localhost:3000
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.argv[2] ?? "http://localhost:3000";
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found.");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const sizes = [[320, 640, true], [375, 667, true], [390, 844, true], [1280, 800, false]];
let pass = 0;
for (const [width, height, mobile] of sizes) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  await page.goto(BASE + "/create-word-document", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Reject non-essential" }).click({ timeout: 8000 }).catch(() => {});
  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type("Hello world. ".repeat(80));
  for (const y of [0, 400, 1200, 99999]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(700); // lets the launcher step clear
    const r = await page.evaluate(() => {
      const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const pill = box(document.querySelector("[data-assistant-launcher] > span"));
      const hit = (a, b) => !(a.r <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b);
      const shown = [...document.querySelectorAll("[data-assistant-avoid], .wc-toolbar, header")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== "hidden"; });
      return { pill, covers: shown.filter((e) => hit(pill, box(e))).map((e) => e.className || e.tagName), vh: innerHeight, vw: innerWidth };
    });
    assert.deepEqual(r.covers, [], `${width}px, scrolled to ${y}: the launcher covers ${r.covers.join(", ")}`);
    assert.ok(r.pill.t >= 0 && r.pill.b <= r.vh && r.pill.l >= 0 && r.pill.r <= r.vw, `${width}px, scrolled to ${y}: the launcher is on screen`);
    pass++;
  }
  await page.locator("[data-assistant-launcher]").click();
  await page.locator("#assistant-panel").waitFor({ state: "visible", timeout: 10000 });
  pass++;
  console.log(`  ok  ${width}px: clear of the toolbar and bottom bar, and it opens the assistant`);
  await context.close();
}
await browser.close();
console.log(`\n${pass} checks passed`);
