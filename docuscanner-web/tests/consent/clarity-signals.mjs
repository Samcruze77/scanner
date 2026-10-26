// Real-browser check of the exact Clarity Consent API v2 calls the app makes, and of
// what happens to Clarity's cookies and script around accepting, rejecting, changing
// preferences and withdrawing. SIMULATED Clarity: the tag URL is answered by a small
// stub that records every window.clarity(...) call (including the ones queued before it
// ran) into sessionStorage, so they survive a reload. All traffic to Microsoft is
// intercepted, nothing is sent. It does not run Clarity's real script, so it proves what
// the APP sends and does, not how Clarity reacts.
//
// Needs a production build made with a placeholder id:
//   NEXT_PUBLIC_CLARITY_PROJECT_ID=zzTESTzz1 npm run build && npx next start -p 3116
// Run:  BASE_URL=http://localhost:3116 CLARITY_ID=zzTESTzz1 node tests/consent/clarity-signals.mjs

import fs from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found. Set CHROME to a browser executable.");
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

const STUB = `(function(){
  var orig = window.clarity;
  function log(a){ try { var l = JSON.parse(sessionStorage.getItem("__clarity_calls") || "[]"); l.push(a); sessionStorage.setItem("__clarity_calls", JSON.stringify(l)); } catch (e) {} }
  (orig.q || []).forEach(function(a){ log([].slice.call(a)); });
  window.clarity = function(){ log([].slice.call(arguments)); return orig.apply(this, arguments); };
  window.clarity.q = orig.q;
})();`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const DENIED = { ad_Storage: "denied", analytics_Storage: "denied" };
const RECORDINGS_ON = { ad_Storage: "denied", analytics_Storage: "granted" };

async function session() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = { clarity: [], other: [], navigations: 0 };
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: { ok: true } }));
  await page.route("**/www.clarity.ms/**", (r) => {
    seen.clarity.push(r.request().url());
    return r.fulfill({ status: 200, contentType: "application/javascript", body: STUB });
  });
  await page.route(/(bing|microsoft|clarity)\.(com|ms)/, (r) => {
    if (r.request().url().includes("www.clarity.ms/")) return r.fallback();
    seen.other.push(r.request().url());
    return r.abort();
  });
  page.on("load", () => {
    seen.navigations++;
  });
  return { context, page, seen };
}
const calls = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("__clarity_calls") || "[]").filter((a) => a[0] === "consentv2").map((a) => a[1]));
const cookieNames = (context) => context.cookies().then((cs) => cs.map((c) => c.name));
const open = (page) => page.getByRole("button", { name: /Cookie settings/ }).first().click();
const save = (page) => page.getByRole("button", { name: "Save my choices" }).click();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("1. Accept all -> one granted signal; saved choice re-sent on the next visit");
{
  const { context, page, seen } = await session();
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Accept all" }).click();
  await page.waitForTimeout(1500);
  check("exactly one consentv2 call", (await calls(page)).length === 1, JSON.stringify(await calls(page)));
  check("analytics granted, ad storage denied", same((await calls(page))[0], RECORDINGS_ON), JSON.stringify(await calls(page)));
  await page.reload();
  await page.waitForTimeout(1500);
  const again = await calls(page);
  check("after reload the signal is sent again, once, with the same values", again.length === 2 && same(again[1], RECORDINGS_ON), JSON.stringify(again));
  check("no unexpected third-party request", seen.other.length === 0, seen.other.join());
  await context.close();
}

console.log("2. Reject non-essential -> Clarity never loaded, no signal, no cookies");
{
  const { context, page, seen } = await session();
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Reject non-essential" }).click();
  await page.reload();
  await page.waitForTimeout(1500);
  check("no Clarity request", seen.clarity.length === 0, seen.clarity.join());
  check("no consentv2 call", (await calls(page)).length === 0);
  check("no Clarity cookies", !(await cookieNames(context)).some((n) => /^_cl(ck|sk)$|^CLID$|^ANONCHK$|^MUID$/.test(n)));
  await context.close();
}

console.log("3. Preference changes: only the recordings category reaches Clarity");
{
  const { context, page, seen } = await session();
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Choose what to allow" }).click();
  await page.getByLabel(/Usage analytics/).check();
  await save(page);
  await page.waitForTimeout(1200);
  check("analytics only: Clarity not loaded, no signal", seen.clarity.length === 0 && (await calls(page)).length === 0);
  await open(page);
  await page.getByLabel(/Session recordings/).check();
  await save(page);
  await page.waitForTimeout(1500);
  check("adding recordings: one granted signal", same(await calls(page), [RECORDINGS_ON]), JSON.stringify(await calls(page)));
  await open(page);
  await page.getByLabel(/Advertising/).check();
  await save(page);
  await page.waitForTimeout(1200);
  check("adding advertising: ad storage still denied, no extra signal", same(await calls(page), [RECORDINGS_ON]), JSON.stringify(await calls(page)));
  await open(page);
  await page.getByLabel(/Usage analytics/).uncheck();
  await save(page);
  await page.waitForTimeout(1200);
  check("removing analytics: recordings stay on, Clarity not told anything new", same(await calls(page), [RECORDINGS_ON]) && seen.navigations === 1, `${JSON.stringify(await calls(page))} navigations=${seen.navigations}`);
  await context.close();
}

console.log("4. Withdraw recordings -> Clarity is told first, cookies removed, nothing tracked after reload");
{
  const { context, page, seen } = await session();
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Accept all" }).click();
  await page.waitForTimeout(1500);
  // Cookies Clarity would have set, so removal can be observed (the stub sets none).
  await page.evaluate(() => {
    document.cookie = "_clck=abc|2|x|0|0; path=/";
    document.cookie = "_clsk=def|1|1|1; path=/";
  });
  check("setup: Clarity cookies present", (await cookieNames(context)).includes("_clck") && (await cookieNames(context)).includes("_clsk"));
  const requestsBefore = seen.clarity.length;
  const navBefore = seen.navigations;
  await open(page);
  await page.getByLabel(/Session recordings/).uncheck();
  await save(page);
  // The revoke call must be recorded BEFORE the page is reloaded.
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("__clarity_calls") || "[]").filter((a) => a[0] === "consentv2").length >= 2, null, { timeout: 5000 }).catch(() => {});
  const beforeReload = seen.navigations === navBefore;
  const sent = await calls(page).catch(() => []);
  check("a denied signal reaches Clarity before the reload", beforeReload && sent.length === 2 && same(sent[1], DENIED), `${JSON.stringify(sent)} reloadedYet=${!beforeReload}`);
  await page.waitForTimeout(2000);
  check("the page reloads afterwards", seen.navigations === navBefore + 1, String(seen.navigations - navBefore));
  check("Clarity cookies are gone", !(await cookieNames(context)).some((n) => /^_cl(ck|sk)$/.test(n)), (await cookieNames(context)).join());
  check("no Clarity script after the reload", (await page.locator("#microsoft-clarity").count()) === 0);
  check("no new Clarity request", seen.clarity.length === requestsBefore, `${requestsBefore} -> ${seen.clarity.length}`);
  const after = await calls(page);
  check("no further signal after the reload", after.length === 2, JSON.stringify(after));
  await page.reload();
  await page.waitForTimeout(1200);
  check("still nothing on a later visit", seen.clarity.length === requestsBefore && (await page.locator("#microsoft-clarity").count()) === 0);
  await context.close();
}

console.log("5. Withdrawing something else does not touch Clarity");
{
  const { context, page, seen } = await session();
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Accept all" }).click();
  await page.waitForTimeout(1500);
  const nav = seen.navigations;
  await open(page);
  await page.getByLabel(/Advertising/).uncheck();
  await save(page);
  await page.waitForTimeout(1200);
  check("no reload and no extra signal", seen.navigations === nav && same(await calls(page), [RECORDINGS_ON]), JSON.stringify(await calls(page)));
  await context.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
