// End-to-end consent check in a real browser against a running production
// build (started with a placeholder NEXT_PUBLIC_CLARITY_PROJECT_ID; Clarity's
// network calls are intercepted, nothing is sent to Microsoft).
//
// Proves the behaviour the Privacy Policy describes:
//   * before any choice: nothing non-essential runs (no analytics requests, no
//     visitor/session IDs, no Clarity script or request)
//   * rejecting keeps it that way across pages and reloads
//   * each category switches on independently, and only that category
//   * withdrawing recordings removes Clarity and its cookies
//
// Run:  BASE_URL=http://localhost:3116 CLARITY_ID=zzTESTzz1 node tests/consent/browser.mjs
// Needs Playwright (globally installed) and Chromium.

import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3116";
const CLARITY_ID = process.env.CLARITY_ID ?? "zzTESTzz1";
let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
};

const browser = await chromium.launch();

async function newSession(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const seen = { analytics: [], clarity: [] };
  await page.route("**/api/analytics/**", (route) => {
    seen.analytics.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.route("**/www.clarity.ms/**", (route) => {
    seen.clarity.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* stub */" });
  });
  // Nothing else may reach Microsoft.
  await page.route(/(bing|microsoft)\.com/, (route) => {
    seen.clarity.push(route.request().url());
    return route.abort();
  });
  return { context, page, seen };
}
const store = (page, k) => page.evaluate((key) => [localStorage.getItem(key), sessionStorage.getItem(key)], k);
const banner = (page) => page.getByRole("dialog", { name: "Your privacy choices" });
const settle = (page, ms = 1500) => page.waitForTimeout(ms);

console.log("1. First visit, no choice made");
{
  const { context, page, seen } = await newSession();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await banner(page).waitFor();
  await settle(page, 2500);
  check("banner is shown", await banner(page).isVisible());
  check("Accept and Reject are both offered", (await page.getByRole("button", { name: "Accept all" }).count()) === 1 && (await page.getByRole("button", { name: "Reject non-essential" }).count()) === 1);
  check("no analytics request", seen.analytics.length === 0, seen.analytics.join());
  check("no Clarity request", seen.clarity.length === 0, seen.clarity.join());
  check("no Clarity script in the page", (await page.locator("#microsoft-clarity").count()) === 0 && !(await page.content()).includes("clarity.ms/tag"));
  const ids = await page.evaluate(() => ({ v: localStorage.getItem("ds_visitor_id"), s: sessionStorage.getItem("ds_session_id"), l: localStorage.getItem("ds_session_last_seen"), c: document.cookie }));
  check("no visitor/session identifiers or cookies", !ids.v && !ids.s && !ids.l && !/_clck|_clsk/.test(ids.c), JSON.stringify(ids));
  check("server HTML never contains Clarity", !(await (await fetch(BASE + "/")).text()).includes("clarity.ms"));

  console.log("2. Reject non-essential");
  await page.getByRole("button", { name: "Reject non-essential" }).click();
  check("banner closes", !(await banner(page).isVisible().catch(() => false)));
  await page.goto(BASE + "/tools", { waitUntil: "domcontentloaded" });
  await settle(page, 2000);
  const stored = JSON.parse((await store(page, "ds_consent"))[0]);
  check("choice stored as all-off", stored && stored.analytics === false && stored.advertising === false && stored.recordings === false);
  check("still no analytics / Clarity after navigating", seen.analytics.length === 0 && seen.clarity.length === 0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  check("banner does not return after a decision", (await banner(page).count()) === 0);
  check("still nothing sent after reload", seen.analytics.length === 0 && seen.clarity.length === 0);

  console.log("3. Cookie settings (footer) - turn on analytics only");
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await banner(page).waitFor();
  const boxes = page.locator('[role="dialog"] input[type="checkbox"]');
  check("three optional switches, all off", (await boxes.count()) === 3 && (await boxes.evaluateAll((els) => els.every((e) => !e.checked))));
  await page.getByLabel(/Usage analytics/).check();
  await page.getByRole("button", { name: "Save my choices" }).click();
  await settle(page, 2000);
  check("page view + app_open now sent", seen.analytics.some((p) => p.endsWith("/track")), seen.analytics.join());
  const visitor = (await store(page, "ds_visitor_id"))[0];
  check("visitor id created only now", !!visitor);
  check("presence heartbeat started", await page.waitForRequest((r) => r.url().includes("/api/analytics/heartbeat"), { timeout: 5000 }).then(() => true, () => seen.analytics.some((p) => p.endsWith("/heartbeat"))));
  check("Clarity still not loaded", seen.clarity.length === 0 && (await page.locator("#microsoft-clarity").count()) === 0);

  console.log("4. Turn on session recordings");
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await page.getByLabel(/Session recordings/).check();
  await page.getByRole("button", { name: "Save my choices" }).click();
  await settle(page, 2500);
  check("Clarity script now requested with the project id", seen.clarity.some((u) => u.includes(`/tag/${CLARITY_ID}`)), seen.clarity.join());
  check("Clarity script tag present", (await page.locator("#microsoft-clarity").count()) === 1);
  check("Clarity's consent signal sent", await page.evaluate(() => typeof window.clarity === "function" && (window.clarity.q ?? []).some((a) => a[0] === "consentv2")));

  console.log("5. Withdraw session recordings");
  await page.evaluate(() => { document.cookie = "_clck=abc; path=/"; document.cookie = "_clsk=def; path=/"; });
  const before = seen.clarity.length;
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), (async () => {
    await page.getByRole("button", { name: "Cookie settings" }).click();
    await page.getByLabel(/Session recordings/).uncheck();
    await page.getByRole("button", { name: "Save my choices" }).click();
  })()]);
  await settle(page, 2500);
  check("page reloaded without Clarity", (await page.locator("#microsoft-clarity").count()) === 0);
  check("no new Clarity requests", seen.clarity.length === before, `${before} -> ${seen.clarity.length}`);
  check("Clarity cookies deleted", !(await page.evaluate(() => document.cookie)).match(/_clck|_clsk/));
  check("analytics consent untouched by that change", !!(await store(page, "ds_visitor_id"))[0]);

  console.log("6. Withdraw analytics");
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await page.getByLabel(/Usage analytics/).uncheck();
  await page.getByRole("button", { name: "Save my choices" }).click();
  await settle(page, 500);
  const idsAfter = await page.evaluate(() => [localStorage.getItem("ds_visitor_id"), sessionStorage.getItem("ds_session_id"), localStorage.getItem("ds_session_last_seen")]);
  check("visitor + session identifiers deleted", idsAfter.every((v) => !v), JSON.stringify(idsAfter));
  const n = seen.analytics.length;
  await page.goto(BASE + "/convert", { waitUntil: "domcontentloaded" });
  await settle(page, 2000);
  check("no further analytics after withdrawal", seen.analytics.length === n, `${n} -> ${seen.analytics.length}`);
  await context.close();
}

console.log("7. Accept all (fresh visitor)");
{
  const { context, page, seen } = await newSession();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await banner(page).waitFor();
  await page.getByRole("button", { name: "Accept all" }).click();
  await settle(page, 3000);
  const c = JSON.parse((await store(page, "ds_consent"))[0]);
  check("all three stored on", c.analytics && c.advertising && c.recordings);
  check("analytics runs", seen.analytics.some((p) => p.endsWith("/track")));
  check("Clarity runs", seen.clarity.some((u) => u.includes(`/tag/${CLARITY_ID}`)));
  await context.close();
}

console.log("8. Mobile layout");
{
  const { context, page } = await newSession({ width: 390, height: 780 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await banner(page).waitFor();
  const box = await banner(page).boundingBox();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("banner fits the screen width", box && box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box));
  check("no horizontal overflow", over === 0, String(over));
  check("Accept / Reject reachable", await page.getByRole("button", { name: "Accept all" }).isVisible() && await page.getByRole("button", { name: "Reject non-essential" }).isVisible());
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/consent-mobile.png` : "/tmp/consent-mobile.png" });
  await page.getByRole("button", { name: "Choose what to allow" }).click();
  const tall = await banner(page).evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight + 1 && getComputedStyle(el.firstElementChild).overflowY);
  check("expanded settings stay on screen and scroll inside the banner", tall === "auto" || tall === true, String(tall));
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/consent-mobile-open.png` : "/tmp/consent-mobile-open.png" });
  await context.close();
}

console.log("9. Policy page anchors and account page");
{
  const { context, page } = await newSession();
  await page.goto(BASE + "/privacy#section-6", { waitUntil: "domcontentloaded" });
  check("cookies section exists", (await page.locator("#section-6").innerText()).includes("Cookies and Similar Technologies"));
  await page.goto(BASE + "/account", { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  check("account page asks a signed-out visitor to log in", (await page.getByText("Log in to manage your account.").count()) === 1);
  await context.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
