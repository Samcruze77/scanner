// The floating "Ask me" button's look and behaviour, measured in a real browser against a running
// production build: compact and translucent when closed, bolder on hover/focus, solid and bold
// when the chat is open, back to idle when closed; big enough to tap; legible in all three themes;
// and clear of every important control, the mobile nav bar, the cookie banner and advertisements.
//
//   npm run build && npm run start           (another terminal)
//   node tests/assistant/launcher.mjs [baseUrl]    default http://localhost:3000
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.argv[2] ?? "http://localhost:3000";
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found.");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-e2e-"));
let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};

const doc = await PDFDocument.create();
for (let i = 0; i < 3; i++) doc.addPage([595, 842]).drawText("PAGE " + (i + 1), { x: 50, y: 700, size: 30 });
const samplePdf = path.join(work, "doc.pdf");
fs.writeFileSync(samplePdf, await doc.save());

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];

async function session(viewport, { mobile = false, theme } = {}) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  if (theme) await context.addInitScript((t) => localStorage.setItem("pdfscanner.theme", t), theme);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR|favicon/.test(m.text()) && errors.push(m.text()));
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  await page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  return { context, page };
}
const launcher = (p) => p.locator("[data-assistant-launcher]");
const pill = (p) => p.locator("[data-assistant-launcher] > span");
async function reject(p) {
  try {
    await p.getByRole("button", { name: "Reject non-essential" }).click({ timeout: 6000 });
  } catch {
    /* already chosen */
  }
}
const look = (p) =>
  p.evaluate(() => {
    const el = document.querySelector("[data-assistant-launcher] > span");
    const cs = getComputedStyle(el);
    // Any CSS colour syntax (lab, oklch, color-mix) is resolved through a canvas.
    const px = (c) => {
      const x = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      x.clearRect(0, 0, 1, 1);
      x.fillStyle = c;
      x.fillRect(0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const alpha = (c) => px(c)[3];
    const r = el.getBoundingClientRect();
    const b = document.querySelector("[data-assistant-launcher]").getBoundingClientRect();
    return { opacity: Number(cs.opacity), bgAlpha: alpha(cs.backgroundColor), weight: Number(cs.fontWeight), bg: cs.backgroundColor, rgba: px(cs.backgroundColor), shadow: cs.boxShadow, w: r.width, h: r.height, btnW: b.width, btnH: b.height, text: el.innerText.trim() };
  });
const settle = (p) => p.waitForTimeout(350);
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

try {
  console.log("States (desktop)");
  {
    const { context, page } = await session({ width: 1280, height: 800 });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await reject(page);
    await launcher(page).waitFor();
    await page.mouse.move(5, 5);
    await settle(page);
    const idle = await look(page);
    assert.ok(idle.h <= 38, `idle pill is compact: ${idle.h}px tall`);
    assert.ok(idle.w <= 110, `idle pill is narrow: ${idle.w}px wide`);
    assert.ok(idle.opacity < 1 && idle.opacity >= 0.85, `idle is translucent but findable (opacity ${idle.opacity})`);
    assert.ok(idle.bgAlpha < 1 && idle.bgAlpha > 0.6, `idle background is translucent (alpha ${idle.bgAlpha})`);
    assert.equal(idle.text, "Ask me");
    assert.ok(idle.btnW >= 44 && idle.btnH >= 44, `the clickable area is ${idle.btnW}x${idle.btnH} (at least 44 px)`);
    assert.ok(idle.weight <= 600);
    assert.ok(idle.rgba[2] > idle.rgba[0] + 10, "idle background is light blue, not grey: " + idle.rgba);
    ok(`closed: ${Math.round(idle.w)}x${Math.round(idle.h)} px pill, opacity ${idle.opacity}, background alpha ${idle.bgAlpha.toFixed(2)}, ${Math.round(idle.btnW)}x${Math.round(idle.btnH)} px hit area`);

    // Previous design for comparison: a 48 px tall, solid blue button with a long label.
    await launcher(page).hover();
    await settle(page);
    const hover = await look(page);
    assert.ok(hover.opacity > idle.opacity && hover.bgAlpha > idle.bgAlpha, `hover is more opaque (opacity ${hover.opacity}, alpha ${hover.bgAlpha.toFixed(2)})`);
    ok("hover: more opaque");

    await page.mouse.move(5, 5);
    await page.keyboard.press("Tab");
    await launcher(page).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    // Focus by keyboard until the launcher has it.
    for (let i = 0; i < 60 && !(await page.evaluate(() => document.activeElement?.hasAttribute("data-assistant-launcher"))); i++) await page.keyboard.press("Tab");
    await settle(page);
    const focus = await look(page);
    assert.ok(focus.opacity === 1, "keyboard focus makes it fully opaque");
    assert.notEqual(focus.shadow, "none", "keyboard focus shows a visible ring: " + focus.shadow);
    ok("keyboard focus: fully opaque with a visible focus ring");

    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor();
    await settle(page);
    await page.mouse.move(5, 5);
    await settle(page);
    const open = await look(page);
    assert.ok(open.opacity === 1 && open.bgAlpha === 1, "open: solid");
    assert.ok(open.weight >= 700, `open: bold text (weight ${open.weight})`);
    assert.ok(open.rgba[2] > 200 && open.rgba[0] < 80 && open.rgba[1] < 130, "open: the strong blue " + open.rgba);
    assert.equal(open.text, "Close");
    assert.equal(await launcher(page).getAttribute("aria-expanded"), "true");
    assert.equal(await launcher(page).getAttribute("data-state"), "open");
    const panelBox = await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).boundingBox();
    const lb = await launcher(page).boundingBox();
    assert.ok(panelBox.y + panelBox.height <= lb.y + 1, "the open panel sits above the launcher, not on it");
    ok("open: solid, bold, blue, labelled Close; the panel sits above it");

    await launcher(page).click();
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor({ state: "hidden" });
    await page.mouse.move(5, 5);
    await settle(page);
    const closed = await look(page);
    assert.ok(closed.opacity < 1 && closed.bgAlpha < 1 && closed.weight <= 600 && closed.text === "Ask me", JSON.stringify(closed));
    assert.equal(await launcher(page).getAttribute("aria-expanded"), "false");
    ok("clicking it again closes the chat and returns to the small translucent look");

    await launcher(page).click();
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor({ state: "hidden" });
    await page.mouse.move(5, 5);
    await settle(page);
    assert.equal((await look(page)).text, "Ask me");
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-assistant-launcher")), true);
    ok("Escape closes it, restores the idle look and returns focus to the launcher");
    await context.close();
  }

  console.log("\nThemes");
  for (const theme of ["light", "beige", "dark"]) {
    const { context, page } = await session({ width: 1280, height: 800 }, { theme });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await reject(page);
    await launcher(page).waitFor();
    await page.mouse.move(5, 5);
    await settle(page);
    const r = await page.evaluate(() => {
      const px = (c) => {
        const x = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        x.clearRect(0, 0, 1, 1);
        x.fillStyle = c;
        x.fillRect(0, 0, 1, 1);
        const d = x.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const rgb = (c) => px(c).slice(0, 3);
      const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const el = document.querySelector("[data-assistant-launcher] > span");
      const cs = getComputedStyle(el);
      const bg = rgb(cs.backgroundColor);
      const a = px(cs.backgroundColor)[3];
      const text = rgb(cs.color);
      // The pill is translucent, so test its text against the worst case behind it: pure black
      // and pure white, as well as the page itself.
      const over = (back) => bg.map((v, i) => v * a + back[i] * (1 - a));
      const page = rgb(getComputedStyle(document.body).backgroundColor);
      return { theme: document.documentElement.dataset.theme, atPage: ratio(text, over(page)), onBlack: ratio(text, over([0, 0, 0])), onWhite: ratio(text, over([255, 255, 255])) };
    });
    assert.equal(r.theme, theme);
    for (const k of ["atPage", "onBlack", "onWhite"]) assert.ok(r[k] >= 4.5, `${theme}: text contrast ${k} = ${r[k].toFixed(2)}`);
    await launcher(page).click();
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor();
    await page.mouse.move(5, 5);
    await settle(page);
    const open = await look(page);
    assert.ok(open.weight >= 700 && open.bgAlpha === 1, `${theme}: open state is bold and solid`);
    await context.close();
  }
  ok("Light, Warm Beige and Dark: idle text stays at 4.5:1 or better even over black or white behind it; the open state is bold and solid");

  console.log("\nNothing important is covered");
  const controls = ["scan-upload", "scan-create-pdf", "scan-download-pdf", "scan-edit-page", "scan-more-options", "scan-another-page", "scan-move-earlier", "file-dropzone", "scan-save-account"];
  for (const [label, viewport, mobile] of [
    ["desktop 1280x800", { width: 1280, height: 800 }, false],
    ["laptop 1024x700", { width: 1024, height: 700 }, false],
    ["tablet 768x1024", { width: 768, height: 1024 }, false],
    ["phone 390x844", { width: 390, height: 844 }, true],
    ["small phone 360x640", { width: 360, height: 640 }, true],
  ]) {
    const { context, page } = await session(viewport, { mobile });
    await page.goto(BASE + "/tools/pdf-editor", { waitUntil: "domcontentloaded" });
    // With the cookie banner showing first: it must be above the launcher and its buttons reachable.
    const banner = page.getByRole("button", { name: "Reject non-essential" });
    await banner.waitFor();
    const bannerOnTop = await page.evaluate(() => {
      const l = document.querySelector("[data-assistant-launcher]").getBoundingClientRect();
      const btn = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Reject non-essential")).getBoundingClientRect();
      const hit = document.elementFromPoint(btn.x + btn.width / 2, btn.y + btn.height / 2);
      return { reachable: hit?.innerText?.includes("Reject non-essential") ?? false, overlap: !(l.right < btn.left || l.left > btn.right || l.bottom < btn.top || l.top > btn.bottom) };
    });
    assert.ok(bannerOnTop.reachable, `${label}: the cookie banner's buttons are reachable`);
    await banner.click();
    await page.locator('input[aria-label^="Upload a document"]').setInputFiles(samplePdf);
    await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Pages"] li').length === 3, null, { timeout: 30000 });
    await page.locator('[data-assistant-id="scan-create-pdf"]').first().waitFor();
    const heights = await page.evaluate(() => document.documentElement.scrollHeight);
    const stops = [0, 0.3, 0.6, 1].map((f) => Math.round(f * Math.max(0, heights - viewport.height)));
    let checked = 0;
    for (const y of stops) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(450); // lets the launcher step clear of an ad
      const rects = await page.evaluate((ids) => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const pillEl = document.querySelector("[data-assistant-launcher] > span");
        const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
        const nav = [...document.querySelectorAll('nav[aria-label="Primary"]')].filter((n) => getComputedStyle(n).position === "fixed");
        return {
          pill: box(pillEl),
          items: [
            ...ids.flatMap((id) => [...document.querySelectorAll(`[data-assistant-id="${id}"]`)].filter(visible).map((e) => ({ name: id, ...box(e) }))),
            ...[...document.querySelectorAll("aside[data-ad-placement]")].filter(visible).map((e) => ({ name: "advertisement", ...box(e) })),
            ...[...document.querySelectorAll("header")].filter(visible).map((e) => ({ name: "header", ...box(e) })),
            ...nav.map((e) => ({ name: "bottom navigation", ...box(e) })),
          ],
        };
      }, controls);
      for (const item of rects.items) {
        assert.ok(!intersects(rects.pill, item), `${label}, scrolled to ${y}: the launcher covers "${item.name}" (${JSON.stringify(rects.pill)} vs ${JSON.stringify(item)})`);
        checked++;
      }
    }
    // The page editor and annotator open over it, so image tools and handles are never covered.
    await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
    await page.locator('[data-assistant-id="page-annotate"]').click();
    await page.locator('[data-assistant-id="annotation-tool-image"]').click();
    await page.getByRole("dialog", { name: /Annotate page/ }).waitFor();
    const topAtLauncher = await page.evaluate(() => {
      const r = document.querySelector("[data-assistant-launcher]").getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit?.closest("[role=dialog], [role=presentation]") ? "dialog" : "page";
    });
    assert.notEqual(topAtLauncher, "page", `${label}: editors and the picture dialog open over the launcher`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${label}: no sideways scrolling`);
    ok(`${label}: no overlap with ${checked} checked controls/ads/header/nav at 4 scroll positions; cookie banner reachable; editor dialogs sit over it`);
    await context.close();
  }

  console.log("\nAdvertisement avoidance (deterministic)");
  for (const [label, viewport, mobile] of [
    ["desktop", { width: 1280, height: 800 }, false],
    ["phone", { width: 390, height: 844 }, true],
  ]) {
    const { context, page } = await session(viewport, { mobile });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await reject(page);
    await launcher(page).waitFor();
    // A tall page with one representative ad element (the attribute the real ad slots carry),
    // placed far down so it can be scrolled into the launcher's corner and out again.
    await page.evaluate(() => {
      document.body.style.minHeight = "6000px";
      const ad = document.createElement("aside");
      ad.setAttribute("data-ad-placement", "bottom");
      ad.id = "test-ad";
      ad.style.cssText = "position:absolute;left:0;right:0;top:3000px;height:90px;background:#ccc;z-index:1";
      document.body.appendChild(ad);
    });
    const box = (sel) =>
      page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, sel);
    const rect = () => box("[data-assistant-launcher]");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const home = await rect();
    const scrollAdOverLauncher = () => page.evaluate((h) => window.scrollTo(0, 3000 - (h.y + h.height / 2 - 45)), home);
    // Put the ad right over the launcher's normal spot.
    await scrollAdOverLauncher();
    await page.waitForTimeout(600);
    const during = await rect();
    const ad = await box("#test-ad");
    assert.ok(ad.y < home.y + home.height && ad.y + ad.height > home.y, label + ": the test ad really is where the launcher normally sits");
    assert.ok(!intersects(during, ad), label + ": the launcher stepped clear of the ad (launcher " + JSON.stringify(during) + ", ad " + JSON.stringify(ad) + ")");
    assert.ok(during.y < home.y - 5, label + ": it moved up, by " + Math.round(home.y - during.y) + " px");
    assert.ok(during.y >= 0, label + ": and is still on screen");
    // The moved launcher is still clickable and still opens the chat.
    await launcher(page).click();
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor();
    await launcher(page).click();
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor({ state: "hidden" });
    // Scroll the ad away: the launcher returns to exactly where it began.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    const back = await rect();
    assert.ok(Math.abs(back.x - home.x) < 1 && Math.abs(back.y - home.y) < 1, label + ": back to its normal place (" + JSON.stringify(back) + " vs " + JSON.stringify(home) + ")");
    // While the chat is open it does not move.
    await launcher(page).click();
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor();
    await scrollAdOverLauncher();
    await page.waitForTimeout(500);
    const open = await rect();
    assert.ok(Math.abs(open.y - home.y) < 1, label + ": the open launcher stays put beside its panel");
    ok(label + ": moves up " + Math.round(home.y - during.y) + " px to clear an ad in its corner, stays clickable, and returns to its exact place when the ad is gone");
    await context.close();
  }

  console.log("\nTouch");
  {
    const { context, page } = await session({ width: 390, height: 844 }, { mobile: true });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await reject(page);
    await launcher(page).tap();
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor();
    assert.equal((await look(page)).text, "Close");
    await launcher(page).tap();
    await page.getByRole("dialog", { name: "Ask FreePDFScanner" }).waitFor({ state: "hidden" });
    assert.equal((await look(page)).text, "Ask me");
    const b = await launcher(page).boundingBox();
    assert.ok(b.width >= 44 && b.height >= 44);
    ok(`touch: tap opens, tap closes; the tap target is ${Math.round(b.width)}x${Math.round(b.height)} px`);
    await context.close();
  }

  assert.deepEqual(errors, [], "no console errors: " + errors.join(" | "));
  ok("no console or page errors");
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`\n${pass} checks passed`);
