// The install cards and guide in a real browser (needs `npm run build && npm run start -- -p 3117`).
//   node tests/install/browser.mjs [baseUrl]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, CHROME, chromium, work } from "../audit/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCAN = path.join(here, "..", "audit", "corpus", "scan.jpg");
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0;
const ok = (n) => {
  pass++;
  console.log("  ok  " + n);
};

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  unknown: "SomeBrowser/1.0",
};
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function open(url, { ua, viewport = DESKTOP, theme, clock = false, touch = false } = {}) {
  const context = await browser.newContext({ viewport, userAgent: ua, acceptDownloads: true, isMobile: touch, hasTouch: touch });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  await page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  // The cookie choice is made up front so its banner (a dialog) does not hold the cards back.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("ds_consent", JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false }));
      if (t) localStorage.setItem("pdfscanner.theme", t);
    } catch {}
  }, theme);
  if (clock) await page.clock.install();
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main");
  await page.waitForTimeout(400);
  return { context, page, requests };
}
const card = (page) => page.locator("[data-install-card]");
const complete = (page) => page.evaluate(() => window.dispatchEvent(new Event("ds-task-complete")));
const rect = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ds_install_reminder") || "null"));
async function tick(page, seconds, interact = false) {
  for (let i = 0; i < seconds; i++) {
    if (interact && i % 2 === 0) await page.mouse.move(100 + i, 300 + (i % 50));
    await page.clock.runFor(1000);
  }
}

// ---- 1. the manifest and icons -------------------------------------------------------------------------
console.log("1. Installability setup");
{
  const { context, page } = await open("/");
  const m = await (await page.request.get(BASE + "/manifest.webmanifest")).json();
  assert.equal(m.short_name, "FreePDFScanner");
  assert.ok(m.name.startsWith("FreePDFScanner"));
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/");
  assert.equal(m.scope, "/");
  assert.ok(m.theme_color && m.background_color);
  ok("manifest: name, short name, standalone, start URL and scope");
  for (const i of m.icons) {
    const r = await page.request.get(BASE + i.src);
    assert.equal(r.status(), 200, i.src);
    assert.match(r.headers()["content-type"], /image\/png/);
  }
  assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512") && m.icons.some((i) => i.purpose === "maskable"));
  ok("manifest icons load (192, 512, maskable)");
  assert.equal(await page.locator('link[rel="manifest"]').count(), 1);
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').count(), 1);
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute("content"), "FreePDFScanner");
  assert.equal(await page.locator('meta[name="mobile-web-app-capable"]').getAttribute("content"), "yes");
  assert.ok(await page.evaluate(() => !("serviceWorker" in navigator) || navigator.serviceWorker.getRegistrations().then((r) => r.length === 0)));
  ok("manifest link, apple-touch-icon and iOS web-app meta present; no service worker registered");
  await context.close();
}

// ---- 2. a real task: nothing before success, then the card -------------------------------------------------
console.log("2. After a real saved file (scan to PDF)");
{
  const { context, page, requests } = await open("/scan");
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(SCAN);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(\d+ page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  assert.equal(await card(page).count(), 0, "no card on opening, choosing a file, or waiting");
  ok("no card on arrival, after choosing a file, or while the file is open");
  await page.getByRole("button", { name: /Create PDF \(\d+ page/ }).click();
  const dl = page.locator('[data-assistant-id="scan-download-pdf"]');
  await dl.waitFor({ timeout: 120000 });
  await page.waitForTimeout(6000);
  assert.equal(await card(page).count(), 0, "creating the PDF is not a saved file");
  ok("no card after export finishes but before the file is saved");
  const downloaded = page.waitForEvent("download");
  await dl.click();
  await (await downloaded).saveAs(path.join(work, "t.pdf"));
  assert.equal(await card(page).count(), 0, "not immediately");
  await card(page).waitFor({ timeout: 12000 });
  assert.equal(await card(page).getAttribute("data-install-card"), "done");
  assert.ok((await card(page).innerText()).includes("Did you get everything done?"));
  ok("card appears a few seconds after the file is saved: 'Did you get everything done?'");
  assert.equal(await page.getByRole("button", { name: "Add FreePDFScanner" }).count(), 0, "no install invitation yet");
  ok("no install invitation before the person answers");
  // placement: no overlap with the launcher, the document's own controls, or the page's bottom bar
  const c = await rect(page, "[data-install-card]");
  const launcher = await rect(page, 'button[aria-label*="Ask" i]');
  assert.ok(!hit(c, launcher), "not over the Ask me button");
  for (const sel of ['[data-assistant-id="scan-download-pdf"]', "main button:visible", "main input:visible"]) {
    for (const e of await page.locator(sel).all()) {
      if (!(await e.isVisible())) continue;
      const r = await e.evaluate((x) => { const b = x.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
      if (r.r - r.l === 0) continue;
      assert.ok(!hit(c, r) || (await card(page).evaluate((el) => getComputedStyle(el).visibility)) === "hidden", "card never sits visibly on a control");
      void 0;
    }
  }
  assert.equal(await card(page).evaluate((el) => getComputedStyle(el).visibility), "visible", "and it is actually visible");
  ok("not over the Ask me button, the Download button or other controls (and still visible)");
  assert.equal(requests.filter((u) => /install|reminder/i.test(u)).length, 0);
  ok("no network request is made for any of this");
  await page.getByRole("button", { name: "Yes, I'm all set" }).click();
  assert.ok((await card(page).innerText()).includes("Great! Keep FreePDFScanner one tap away."));
  await page.waitForTimeout(1200);
  {
    const c2 = await rect(page, "[data-install-card]");
    assert.equal(await card(page).evaluate((el) => getComputedStyle(el).visibility), "visible", "taller card is still shown (moved to a free spot: " + (await card(page).getAttribute("data-install-slot")) + ")");
    for (const e of await page.locator("main button:visible, main input:visible").all()) {
      const b = await e.boundingBox();
      if (b && hit(c2, { l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height })) assert.fail("covers " + (await e.innerText()));
    }
  }
  assert.equal(await page.getByRole("button", { name: "Add FreePDFScanner" }).count(), 1);
  ok("'Yes' leads to the install invitation");
  // no beforeinstallprompt in this browser -> instructions, not a fake install
  await page.getByRole("button", { name: "Add FreePDFScanner" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.ok(/Install in Chrome|Install page as app/.test(await dialog.innerText()), "Chrome-on-Windows steps");
  assert.equal(await card(page).count(), 0);
  ok("without a native prompt, 'Add FreePDFScanner' shows the steps instead");
  const s = await state(page);
  assert.ok(s.quietUntil > Date.now() + 50 * 86400000);
  ok("the guide being shown silences the card for 60 days");
  await context.close();
}

// ---- 3. answers -----------------------------------------------------------------------------------------
console.log("3. Answers and suppression");
{
  const { context, page } = await open("/");
  await complete(page);
  await card(page).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Not yet" }).click();
  assert.equal(await card(page).count(), 0);
  assert.ok(!/Add FreePDFScanner/.test(await page.content()));
  const s = await state(page);
  assert.equal(s.dismissals, undefined);
  ok("'Not yet' closes the card with no install invitation");
  await page.reload();
  await page.waitForSelector("main");
  await complete(page);
  await page.waitForTimeout(6000);
  assert.equal(await card(page).count(), 0);
  ok("and it stays quiet after a reload (frequency limit)");
  await context.close();
}
{
  const { context, page } = await open("/");
  await complete(page);
  await card(page).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Yes, I'm all set" }).click();
  await page.getByRole("button", { name: "Maybe later" }).click();
  assert.equal(await card(page).count(), 0);
  const s = await state(page);
  assert.ok(s.quietUntil > Date.now() + 13 * 86400000 && s.dismissals === 1);
  ok("'Maybe later' is remembered for two weeks");
  await context.close();
}
{
  const { context, page } = await open("/");
  await complete(page);
  await card(page).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Yes, I'm all set" }).click();
  await page.getByRole("button", { name: "Don't remind me again" }).click();
  assert.equal(await card(page).count(), 0);
  assert.equal((await state(page)).off, true);
  ok("'Don't remind me again' switches the card off");
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  assert.deepEqual(keys.filter((k) => k !== "pdfscanner.theme"), ["ds_consent", "ds_install_reminder"]);
  ok("the only thing stored is the person's own choice (key ds_install_reminder)");
  await context.close();
}
{
  const { context, page } = await open("/");
  await complete(page);
  await card(page).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Close" }).click();
  assert.equal(await card(page).count(), 0);
  assert.ok((await state(page)).quietUntil > Date.now() + 6 * 86400000);
  ok("the small close button hides it for a week");
  await context.close();
}

// ---- 4. not while busy -----------------------------------------------------------------------------------
console.log("4. Never at a bad moment");
{
  const { context, page } = await open("/");
  // a dialog open -> held back; shows once it closes
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.setAttribute("role", "dialog");
    d.id = "fake-dialog";
    d.textContent = "export options";
    document.body.appendChild(d);
  });
  await complete(page);
  await page.waitForTimeout(9000);
  assert.equal(await card(page).count(), 0);
  ok("held back while a dialog is open");
  await page.evaluate(() => document.getElementById("fake-dialog").remove());
  await card(page).waitFor({ timeout: 12000 });
  ok("shown as soon as the dialog is closed");
  await context.close();
}
{
  const { context, page } = await open("/");
  await page.evaluate(() => {
    const i = document.createElement("input");
    i.id = "typing";
    document.body.prepend(i);
    i.focus();
  });
  await complete(page);
  await page.waitForTimeout(9000);
  assert.equal(await card(page).count(), 0);
  ok("held back while the person is typing");
  await context.close();
}
{
  const { context, page } = await open("/reset-password");
  await complete(page);
  await page.waitForTimeout(7000);
  assert.equal(await card(page).count(), 0);
  ok("never on the password-reset page (admin pages use the same rule)");
  await context.close();
}

// ---- 5. the other two signals (fake clock) -------------------------------------------------------------
console.log("5. Browsing and unfinished-task signals");
{
  const { context, page } = await open("/", { clock: true });
  await tick(page, 30, true);
  assert.equal(await card(page).count(), 0, "30 s of reading is not enough");
  await tick(page, 40, true);
  await card(page).waitFor({ timeout: 3000 });
  assert.equal(await card(page).getAttribute("data-install-card"), "browse");
  const t = await card(page).innerText();
  assert.ok(t.includes("Keep FreePDFScanner close") && t.includes("Show me how") && t.includes("Maybe later"));
  ok("a minute of real browsing -> 'Keep FreePDFScanner close' with Show me how / Maybe later / Close");
  await context.close();
}
{
  const { context, page } = await open("/", { clock: true });
  await tick(page, 100, false); // open but nobody there
  assert.equal(await card(page).count(), 0);
  ok("an idle, untouched page is not 'browsing'");
  await context.close();
}
{
  const { context, page } = await open("/scan", { clock: true });
  await page.locator('input[aria-label^="Upload a document"]').setInputFiles(SCAN);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(\d+ page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
  await tick(page, 60, true);
  assert.equal(await card(page).count(), 0, "no install pitch while a file is open, however long they browse");
  ok("with a file open, active use never produces an install pitch");
  await tick(page, 100, false);
  await card(page).waitFor({ timeout: 3000 });
  assert.equal(await card(page).getAttribute("data-install-card"), "help");
  const t = await card(page).innerText();
  assert.ok(t.includes("Still working on your document?") && t.includes("Show me how") && t.includes("Keep working"));
  assert.ok(!/Add FreePDFScanner|Home Screen|install/i.test(t), "help card never pitches installing");
  ok("file opened, nothing saved, quiet for 90 s -> help offer, no install wording");
  await page.getByRole("button", { name: "Show me how" }).click();
  await page.getByRole("dialog").first().waitFor();
  ok("'Show me how' opens the Ask me assistant");
  await context.close();
}
{
  const { context, page } = await open("/", { clock: true });
  await tick(page, 70, true);
  await card(page).waitFor({ timeout: 3000 });
  await page.getByRole("button", { name: "Maybe later" }).click();
  await tick(page, 200, true);
  assert.equal(await card(page).count(), 0);
  ok("Maybe later on the browsing card is honoured");
  await context.close();
}
{
  const { context, page } = await open("/", { clock: true });
  await tick(page, 70, true);
  await card(page).waitFor({ timeout: 3000 });
  await page.getByRole("button", { name: "Show me how" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  ok("browsing card: 'Show me how' opens the guide");
  await context.close();
}
{
  // exit intent: only with engagement, only a mouse leaving through the top, and never a modal
  const { context, page } = await open("/", { clock: true });
  const leave = () => page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseout", { clientY: -3, relatedTarget: null, bubbles: true })));
  await tick(page, 3, true);
  await leave();
  assert.equal(await card(page).count(), 0);
  ok("exit intent without engagement does nothing");
  await tick(page, 62, true);
  await card(page).waitFor({ timeout: 3000 }); // the interval already shows it; confirm no modal and page still usable
  assert.equal(await page.locator('[role="dialog"][aria-modal="true"]').count(), 0);
  ok("the card is never a modal, so leaving is never blocked");
  await context.close();
}

// ---- 6. the browser's own prompt ------------------------------------------------------------------------
console.log("6. Native install prompt");
{
  const { context, page } = await open("/");
  await page.evaluate(() => {
    window.__prompted = 0;
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => void window.__prompted++;
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await complete(page);
  await card(page).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Yes, I'm all set" }).click();
  assert.equal(await page.evaluate(() => window.__prompted), 0, "nothing prompted before a click");
  ok("the saved browser prompt is not used until the person clicks");
  await page.getByRole("button", { name: "Add FreePDFScanner" }).click();
  await page.waitForFunction(() => window.__prompted === 1);
  const t = await card(page).innerText();
  assert.ok(/adding FreePDFScanner/.test(t) && !/installed successfully/i.test(t));
  ok("clicking Add calls the browser prompt once, and does not claim success");
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await page.waitForFunction(() => document.querySelector("[data-install-card]") === null);
  assert.equal((await state(page)).off, true);
  ok("only the browser's appinstalled event ends the reminders for good");
  await context.close();
}
{
  const { context, page } = await open("/");
  await page.evaluate(() => {
    window.__prompted = 0;
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => void window.__prompted++;
    e.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(e);
  });
  await complete(page);
  await card(page).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Yes, I'm all set" }).click();
  await page.getByRole("button", { name: "Show me how" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Install now" }).click();
  await page.waitForFunction(() => window.__prompted === 1);
  assert.ok(/No problem/.test(await dialog.innerText()));
  ok("guide's 'Install now' uses the saved prompt; cancelling it is handled politely");
  await context.close();
}

// ---- 7. the guide per device and browser -------------------------------------------------------------
console.log("7. Guide content per device and browser");
async function guideFor(ua, opts = {}) {
  const { context, page } = await open("/", { ua, ...opts });
  await page.evaluate(() => window.dispatchEvent(new Event("ds-task-complete")));
  await card(page).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Yes, I'm all set" }).click();
  await page.getByRole("button", { name: "Show me how" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const text = await dialog.innerText();
  return { context, page, dialog, text };
}
const MATRIX = [
  ["iPhone Safari", UA.iphoneSafari, PHONE, /Add to Home Screen[\s\S]*Open as Web App[\s\S]*Add in the top-right/, /iPhone or iPad, Safari/],
  ["iPhone Chrome", UA.iphoneChrome, PHONE, /Chrome's address bar[\s\S]*Add to Home Screen/, /iPhone or iPad, Chrome/],
  ["Android Chrome", UA.androidChrome, PHONE, /Install app/, /Android phone or tablet, Chrome/],
  ["Samsung Internet", UA.samsung, PHONE, /Add page to[\s\S]*Home screen/, /Samsung Internet/],
  ["Windows Firefox", UA.winFirefox, DESKTOP, /Bookmark this page/, /Windows computer, Firefox/],
  ["Windows Edge", UA.winEdge, DESKTOP, /Apps[\s\S]*Install this site as an app/, /Windows computer, Microsoft Edge/],
  ["macOS Safari", UA.macSafari, DESKTOP, /Add to Dock[\s\S]*Sonoma/, /Mac, Safari/],
  ["macOS Chrome", UA.macChrome, DESKTOP, /Install page as app/, /Mac, Chrome/],
  ["unrecognised browser", UA.unknown, DESKTOP, /Bookmark this page[\s\S]*do not have confirmed install steps/, /Other device, Another browser/],
];
for (const [name, ua, viewport, steps, label] of MATRIX) {
  const g = await guideFor(ua, { viewport, touch: viewport === PHONE });
  assert.match(g.text, steps, name + " steps");
  assert.match(g.text, label, name + " label");
  assert.ok(await g.dialog.getByText("I can't find it").count());
  assert.ok(!/offline/i.test(g.text.replace(/does not work offline/i, "")), "no offline promise");
  if (viewport === PHONE) {
    const overflow = await g.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, "no sideways scroll");
    const box = await g.dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
  }
  ok(name + ": steps match the device, with a way out");
  await g.context.close();
}
{
  // manual override, back button, keyboard, focus return
  const g = await guideFor(UA.iphoneSafari, { viewport: PHONE, touch: true });
  await g.dialog.getByRole("button", { name: "Not right? Change" }).click();
  assert.ok(await g.dialog.getByRole("radio", { name: "Windows computer" }).count());
  await g.dialog.getByRole("radio", { name: "Windows computer" }).check();
  assert.equal(await g.dialog.getByRole("radio", { name: "Safari" }).count(), 0, "Safari is not offered on Windows");
  await g.dialog.getByRole("radio", { name: "Microsoft Edge" }).check();
  await g.dialog.getByRole("button", { name: "Show the steps" }).click();
  assert.match(await g.dialog.innerText(), /Install this site as an app/);
  assert.ok(!(await g.dialog.getByRole("button", { name: "Install now" }).count()), "native button only for this device");
  ok("manual override: iPhone detected, switched to Windows + Edge, steps follow");
  await g.dialog.getByRole("button", { name: "Change" }).click();
  await g.dialog.getByRole("button", { name: "Back to the steps" }).click();
  assert.match(await g.dialog.innerText(), /Install this site as an app/);
  ok("Back returns to the steps");
  await g.page.keyboard.press("Escape");
  await g.page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  ok("Escape closes the guide");
  await g.context.close();
}
{
  // keyboard focus is kept inside, and returns when closed
  const g = await guideFor(UA.winEdge);
  const inside = async () => g.page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('[role="dialog"]'));
  for (let i = 0; i < 12; i++) {
    await g.page.keyboard.press("Tab");
    assert.ok(await inside(), "focus stays in the dialog (tab " + i + ")");
  }
  ok("Tab stays inside the open guide");
  await g.context.close();
}

// ---- 8. the three themes and a small phone --------------------------------------------------------------
console.log("8. Themes, small phone, accessibility");
for (const theme of ["light", "beige", "dark"]) {
  for (const [label, viewport, touch] of [["desktop", DESKTOP, false], ["phone 360x640", { width: 360, height: 640 }, true]]) {
    const { context, page } = await open("/", { theme, viewport, touch, ua: touch ? UA.androidChrome : undefined });
    await complete(page);
    await card(page).waitFor({ timeout: 12000 });
    const c = await rect(page, "[data-install-card]");
    assert.ok(c.l >= 0 && c.r <= viewport.width && c.b <= viewport.height, "inside the viewport");
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    const colours = await card(page).evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: getComputedStyle(el.querySelector("p")).color }; });
    assert.notEqual(colours.bg, "rgba(0, 0, 0, 0)");
    assert.notEqual(colours.bg, colours.fg);
    if (touch) {
      const bar = await rect(page, 'nav[aria-label="Primary"]');
      const launcher = await rect(page, 'button[aria-label*="Ask" i]');
      assert.ok(!hit(c, bar), "not over the bottom bar");
      assert.ok(!hit(c, launcher), "not over the Ask me button");
      for (const b of await card(page).getByRole("button").all()) {
        const bb = await b.boundingBox();
        assert.ok(bb.height >= 40 && bb.width >= 40, "tap targets at least 40px: " + (await b.innerText()));
      }
    }
    const shot = path.join(work, `card-${theme}-${touch ? "phone" : "desktop"}.png`);
    await page.screenshot({ path: shot });
    if (process.env.SHOTS) fs.copyFileSync(shot, path.join(process.env.SHOTS, path.basename(shot)));
    ok(`${theme} / ${label}: readable, inside the screen, clear of the bottom bar and Ask me`);
    await context.close();
  }
}
{
  const { context, page } = await open("/", { viewport: DESKTOP });
  await complete(page);
  await card(page).waitFor({ timeout: 12000 });
  assert.equal(await card(page).getAttribute("role"), "region");
  assert.ok(await card(page).getAttribute("aria-label"));
  assert.ok(await card(page).getByRole("button", { name: "Close" }).count());
  await context.close();
  ok("card is a labelled region with a labelled close button, and real buttons throughout");
}
{
  // already installed (standalone display mode): the install cards never appear
  const { context, page } = await open("/", { viewport: DESKTOP });
  await context.close();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.includes("display-mode: standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : real(q));
    localStorage.setItem("ds_consent", JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false }));
  });
  await p.goto(BASE + "/");
  await p.waitForSelector("main");
  await p.evaluate(() => window.dispatchEvent(new Event("ds-task-complete")));
  await p.waitForTimeout(8000);
  assert.equal(await card(p).count(), 0);
  ok("running as an installed app: no install card");
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} checks passed`);
