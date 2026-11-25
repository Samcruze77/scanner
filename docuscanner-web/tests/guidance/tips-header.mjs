// The Help tips switch in the header must not disturb the existing header or page layout.
// For every theme at phone, tablet and desktop widths: the header keeps its height, nothing
// overflows or overlaps, "Log in" / "Sign up" stay on one line, the switch sits inside the header
// row (so it never covers the page), it is a 44px tap target, its label shows from 1024px up (and
// is always its accessible name), and the ON/OFF badge is readable. Also: the right badge is shown
// on the very first paint, before any JavaScript runs (pre-paint script), for ON, OFF and unset.
//
//   node tests/guidance/tips-header.mjs [baseUrl]     (needs `npm run build && npm run start`)

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
const GUIDANCE_KEY = "docuscanner.guidance.v1";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    const note = await fn();
    passed++;
    console.log(`  ✓ ${name}${note ? `  -- ${note}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(e.message).split("\n")[0]}`);
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open({ width, theme = "light", tips, path = "/convert/pdf-to-jpg", noJs = false }) {
  const mobile = width < 768;
  const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: mobile, hasTouch: mobile });
  await context.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  // Server HTML + the inline <head> scripts only: React never takes over.
  if (noJs) await context.route("**/_next/static/**/*.js", (r) => r.abort());
  await context.addInitScript(
    ([t, tipsChoice, key]) => {
      try {
        localStorage.setItem("pdfscanner.theme", t);
        localStorage.setItem("ds_consent", JSON.stringify({ version: 1, decided_at: "x", analytics: false, advertising: false, recordings: false }));
        if (tipsChoice) localStorage.setItem(key, JSON.stringify({ tips: tipsChoice, dismissed: [], asked: 1 }));
      } catch {}
    },
    [theme, tips ?? null, GUIDANCE_KEY],
  );
  const page = await context.newPage();
  await page.goto(BASE + path, { waitUntil: "load" });
  if (!noJs) await page.waitForFunction(() => document.querySelector('[data-assistant-id="tips-toggle"]')?.hasAttribute("aria-pressed"), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  return { context, page };
}

function contrast(a, b) {
  const lum = ([r, g, b2]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

console.log(`Help tips switch in the header against ${BASE}`);

for (const width of [360, 375, 390, 768, 1024, 1366]) {
  for (const theme of ["light", "beige", "dark"]) {
    await test(`${width}px ${theme}: header unchanged in size, nothing overflows, wraps or overlaps; switch inside the header`, async () => {
      const { context, page } = await open({ width, theme, tips: "on" });
      const m = await page.evaluate(() => {
        const header = document.querySelector("header");
        const row = header.firstElementChild;
        const sw = header.querySelector('[data-assistant-id="tips-toggle"]');
        const hr = header.getBoundingClientRect();
        const sr = sw.getBoundingClientRect();
        const controls = [...row.querySelectorAll("a, button")].filter((e) => e.offsetParent && e.closest("header") === header);
        const rects = controls.map((e) => e.getBoundingClientRect());
        const overlap = rects.some((a, i) => rects.some((b, j) => i < j && !controls[i].contains(controls[j]) && !controls[j].contains(controls[i]) && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
        // Text that wraps has more than one line box.
        const lines = (el) => {
          if (!el) return 0;
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
        };
        const login = controls.find((b) => b.getAttribute("data-assistant-id") === "account-login");
        const signup = controls.find((b) => b.getAttribute("data-assistant-id") === "account-signup");
        const label = [...sw.querySelectorAll("span")].find((s) => s.textContent === "Help tips");
        const badge = [...sw.querySelectorAll(".tips-badge")].find((b) => b.offsetParent);
        const cs = getComputedStyle(badge);
        const rgb = (v) => {
          const c = document.createElement("canvas").getContext("2d");
          c.fillStyle = v;
          c.fillRect(0, 0, 1, 1);
          return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        return {
          headerHeight: Math.round(hr.height),
          rowOverflow: row.scrollWidth - row.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          overlap,
          inside: sr.top >= hr.top - 0.5 && sr.bottom <= hr.bottom + 0.5 && sr.left >= hr.left && sr.right <= hr.right,
          tap: Math.round(sr.height),
          loginLines: lines(login),
          signupLines: lines(signup?.querySelector("span:not(.hidden)") ?? signup),
          labelVisible: label ? label.getBoundingClientRect().width > 1 : false,
          name: sw.textContent.replace(/\s+/g, " ").trim(),
          badgeText: badge.textContent,
          badgeContrast: { fg: rgb(cs.color), bg: rgb(cs.backgroundColor) },
        };
      });
      // The OFF badge too: switch tips off and measure the badge that is shown.
      await page.locator('header [data-assistant-id="tips-toggle"]').click();
      const off = await page.evaluate(() => {
        const badge = [...document.querySelectorAll('header [data-assistant-id="tips-toggle"] .tips-badge')].find((b) => b.offsetParent);
        const cs = getComputedStyle(badge);
        const rgb = (v) => {
          const c = document.createElement("canvas").getContext("2d");
          c.fillStyle = v;
          c.fillRect(0, 0, 1, 1);
          return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        return { text: badge.textContent, fg: rgb(cs.color), bg: rgb(cs.backgroundColor) };
      });
      await context.close();
      assert.equal(off.text, "OFF");
      const offRatio = contrast(off.fg, off.bg);
      assert.ok(offRatio >= 4.5, `OFF badge contrast ${offRatio.toFixed(2)}`);
      assert.ok(m.headerHeight <= 57, `header height ${m.headerHeight}px (was 57px)`);
      assert.equal(m.rowOverflow, 0, "header row overflows");
      assert.ok(m.pageOverflow <= 0, `page scrolls sideways by ${m.pageOverflow}px`);
      assert.equal(m.overlap, false, "header controls overlap");
      assert.ok(m.inside, "the switch is inside the header row (cannot cover the page)");
      assert.ok(m.tap >= 44, `tap target ${m.tap}px`);
      assert.ok(m.loginLines <= 1 && m.signupLines <= 1, `Log in / Sign up wrapped (${m.loginLines}/${m.signupLines} lines)`);
      assert.equal(m.labelVisible, width >= 1024, `"Help tips" label visible: ${m.labelVisible}`);
      assert.match(m.name, /Help tips/, "accessible name includes Help tips");
      assert.equal(m.badgeText, "ON");
      const ratio = contrast(m.badgeContrast.fg, m.badgeContrast.bg);
      assert.ok(ratio >= 4.5, `ON badge contrast ${ratio.toFixed(2)}`);
      return `contrast ON ${ratio.toFixed(1)}:1, OFF ${offRatio.toFixed(1)}:1`;
    });
  }
}

for (const [stored, expected] of [["on", "ON"], ["off", "OFF"], [undefined, "ON"]]) {
  await test(`first paint without JavaScript shows ${expected} when tips are ${stored ?? "unset"} (no flip after load)`, async () => {
    const { context, page } = await open({ width: 1366, tips: stored, noJs: true });
    const shown = await page.evaluate(() => [...document.querySelectorAll('header [data-assistant-id="tips-toggle"] .tips-badge')].filter((b) => getComputedStyle(b).display !== "none").map((b) => b.textContent));
    await context.close();
    assert.deepEqual(shown, [expected]);
  });
}

await test("after React takes over the badge still matches, and the switch turns tips off and on", async () => {
  const { context, page } = await open({ width: 390, theme: "dark", tips: "on" });
  const sw = page.locator('header [data-assistant-id="tips-toggle"]');
  const visibleBadge = () => sw.locator(".tips-badge").filter({ visible: true }).innerText();
  assert.equal(await visibleBadge(), "ON");
  await sw.click();
  assert.equal(await visibleBadge(), "OFF");
  assert.equal(await sw.getAttribute("aria-pressed"), "false");
  assert.equal(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), GUIDANCE_KEY)).tips, "off");
  await sw.click();
  assert.equal(await visibleBadge(), "ON");
  await context.close();
});

await test("header logo: the mark below 480px and at 640-1023px, the full wordmark at 480-639px and from 1024px", async () => {
  const seen = {};
  for (const width of [360, 479, 480, 639, 640, 768, 834, 1023, 1024, 1366]) {
    const { context, page } = await open({ width });
    seen[width] = await page.evaluate(() => {
      const visible = [...document.querySelectorAll("header a img")].filter((i) => getComputedStyle(i).display !== "none" && i.getBoundingClientRect().width > 0);
      return visible.map((i) => (i.getAttribute("src").includes("logo-mark") ? "mark" : "wordmark")).join("+");
    });
    await context.close();
  }
  const expected = { 360: "mark", 479: "mark", 480: "wordmark", 639: "wordmark", 640: "mark", 768: "mark", 834: "mark", 1023: "mark", 1024: "wordmark", 1366: "wordmark" };
  assert.deepEqual(seen, expected);
});
await test("the footer no longer has the old text link", async () => {
  const { context, page } = await open({ width: 1366 });
  const footerLink = await page.locator('footer [data-assistant-id="tips-toggle"]').count();
  const text = await page.locator("footer").innerText();
  await context.close();
  assert.equal(footerLink, 0);
  assert.doesNotMatch(text, /Turn help tips/);
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
