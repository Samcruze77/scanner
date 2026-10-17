// Final verification of the install feature against the PRODUCTION build (needs `npm run build` and
// `npx next start -p 3117`). Prints PASS / FAIL / NOT TESTED for each item and exits 1 if anything fails.
//   node tests/install/verify-final.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, CHROME, chromium, work } from "../audit/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCAN = path.join(here, "..", "audit", "corpus", "scan.jpg");
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const rows = [];
let failed = 0;
async function check(group, name, fn) {
  try {
    const detail = await fn();
    rows.push(["PASS", group, name, typeof detail === "string" ? detail : ""]);
    console.log(`  PASS  ${name}${typeof detail === "string" && detail ? "  (" + detail + ")" : ""}`);
  } catch (e) {
    failed++;
    rows.push(["FAIL", group, name, String(e.message).split("\n")[0]]);
    console.log(`  FAIL  ${name}: ${String(e.message).split("\n")[0]}`);
  }
}
function notTested(group, name, why) {
  rows.push(["NOT TESTED", group, name, why]);
  console.log(`  NOT TESTED  ${name}: ${why}`);
}
const ok = (c, msg) => {
  if (!c) throw new Error(msg);
};

const CONSENT = JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false });
async function open(url, { viewport = { width: 1280, height: 900 }, ua, touch = false, clock = false, consent = true, init, analytics = false } = {}) {
  const context = await browser.newContext({ viewport, userAgent: ua, acceptDownloads: true, isMobile: touch, hasTouch: touch });
  const page = await context.newPage();
  const sent = [];
  await page.route("**/api/analytics/**", async (r) => {
    sent.push(r.request().postData() ?? "");
    await r.fulfill({ status: 202, json: {} });
  });
  await page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  await page.addInitScript(
    ([c, a]) => {
      try {
        if (c) localStorage.setItem("ds_consent", JSON.stringify({ ...JSON.parse(c), analytics: a }));
      } catch {}
    },
    [consent ? CONSENT : null, analytics],
  );
  if (init) await page.addInitScript(init);
  if (clock) await page.clock.install();
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main");
  await page.waitForTimeout(400);
  return { context, page, sent };
}
const card = (page) => page.locator("[data-install-card]");
const complete = (page) => page.evaluate(() => window.dispatchEvent(new Event("ds-task-complete")));
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ds_install_reminder") || "null"));
async function tick(page, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (i % 2 === 0) await page.mouse.move(100 + i, 300 + (i % 50));
    await page.clock.runFor(1000);
  }
}
const rectOf = (el) => el.evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const png = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), sig: buf.subarray(0, 8).toString("hex") });

// ======================================================================================================
console.log("1. Served PWA configuration (production build)");
{
  const G = "1 PWA";
  const html = await (await fetch(BASE + "/")).text();
  const manRes = await fetch(BASE + "/manifest.webmanifest");
  const man = await manRes.json();
  await check(G, "manifest is served as a web manifest and linked from the page", () => {
    ok(manRes.status === 200 && /manifest\+json|application\/json/.test(manRes.headers.get("content-type") ?? ""), "content-type " + manRes.headers.get("content-type"));
    ok(/<link rel="manifest" href="\/manifest\.webmanifest"/.test(html), "no <link rel=manifest>");
    return manRes.headers.get("content-type");
  });
  await check(G, "name and short name", () => {
    ok(man.short_name === "FreePDFScanner", "short_name " + man.short_name);
    ok(/^FreePDFScanner/.test(man.name), "name " + man.name);
    return `${man.name} / ${man.short_name}`;
  });
  await check(G, "start_url, scope, id and standalone display are valid and consistent", () => {
    ok(man.display === "standalone", "display " + man.display);
    ok(man.start_url === "/" && man.scope === "/" && man.id === "/", `start ${man.start_url} scope ${man.scope} id ${man.id}`);
    ok(new URL(man.start_url, BASE).pathname.startsWith(new URL(man.scope, BASE).pathname), "start_url outside scope");
    ok(/^#[0-9a-f]{6}$/i.test(man.theme_color) && /^#[0-9a-f]{6}$/i.test(man.background_color), "colours");
  });
  await check(G, "every manifest icon loads, is a real PNG, and has the size it declares", async () => {
    const out = [];
    for (const i of man.icons) {
      const r = await fetch(new URL(i.src, BASE));
      ok(r.status === 200, `${i.src} -> ${r.status}`);
      const p = png(Buffer.from(await r.arrayBuffer()));
      ok(p.sig === "89504e470d0a1a0a", i.src + " is not a PNG");
      ok(`${p.w}x${p.h}` === i.sizes, `${i.src} is ${p.w}x${p.h}, declared ${i.sizes}`);
      out.push(`${i.src} ${p.w}x${p.h} ${i.purpose}`);
    }
    ok(man.icons.some((i) => i.sizes === "192x192" && i.purpose === "any") && man.icons.some((i) => i.sizes === "512x512") && man.icons.some((i) => i.purpose === "maskable"), "needs 192, 512 and a maskable icon");
    return out.join("; ");
  });
  await check(G, "apple-touch-icon and favicon links resolve", async () => {
    const hrefs = [...html.matchAll(/<link rel="(apple-touch-icon|icon)"[^>]*href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    ok(hrefs.some(([k]) => k === "apple-touch-icon") && hrefs.some(([k]) => k === "icon"), "links: " + JSON.stringify(hrefs));
    const out = [];
    for (const [k, h] of hrefs) {
      const r = await fetch(new URL(h, BASE));
      ok(r.status === 200, `${h} -> ${r.status}`);
      if (k === "apple-touch-icon") {
        const p = png(Buffer.from(await r.arrayBuffer()));
        ok(p.w === 180 && p.h === 180, `apple-touch-icon ${p.w}x${p.h}`);
        out.push(`apple-touch-icon ${p.w}x${p.h}`);
      }
    }
    ok(/apple-mobile-web-app-title" content="FreePDFScanner"/.test(html) && /mobile-web-app-capable" content="yes"/.test(html), "iOS web-app meta");
    return out.join(", ");
  });
  await check(G, "no other asset referenced by the manifest or head is missing", async () => {
    const urls = [...html.matchAll(/(?:href|src)="(\/[^"#]+\.(?:png|ico|svg|webmanifest|js|css)[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    const bad = [];
    for (const u of new Set(urls)) {
      const r = await fetch(new URL(u, BASE), { method: "GET" });
      if (r.status !== 200) bad.push(`${u} ${r.status}`);
    }
    ok(bad.length === 0, bad.join(", "));
    return `${new Set(urls).size} head assets all 200`;
  });
  await check(G, "start URL opens the FreePDFScanner home page", async () => {
    const { context, page } = await open(man.start_url);
    const title = await page.title();
    ok(/FreePDFScanner/.test(title), "title " + title);
    ok(await page.getByRole("link", { name: /Scan document|Scan/ }).first().isVisible(), "home content missing");
    await context.close();
    return title;
  });
  await check(G, "no service worker, and no claim of offline support in the site or the manifest", async () => {
    ok((await fetch(BASE + "/sw.js")).status === 404, "/sw.js exists");
    const chunks = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
    let register = 0;
    for (const c of chunks) if (/serviceWorker\s*\.\s*register/.test(await (await fetch(BASE + c)).text())) register++;
    ok(register === 0, "a chunk registers a service worker");
    const pages = ["/", "/scan", "/convert", "/tools", "/privacy"];
    const claims = [];
    for (const p of pages) {
      const t = (await (await fetch(BASE + p)).text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
      for (const m of t.matchAll(/[^.]{0,60}(offline|without (an )?internet|no internet(?!-based))[^.]{0,60}/gi)) claims.push(`${p}: ${m[0].trim()}`);
    }
    ok(!/offline/i.test(JSON.stringify(man)), "manifest mentions offline");
    const bad = claims.filter((c) => !/not work offline|does not work offline|needs an internet/i.test(c));
    ok(bad.length === 0, "offline wording: " + bad.join(" | "));
    return `${chunks.length} chunks, 0 register calls; ${claims.length} offline mentions on the site (all negative)`;
  });

  // Chrome's own installability check on the production build.
  const profile = fs.mkdtempSync(path.join(work, "profile-"));
  const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true });
  const page = await context.newPage();
  await page.addInitScript((c) => localStorage.setItem("ds_consent", c), CONSENT);
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForSelector("main");
  const cdp = await context.newCDPSession(page);
  await check(G, "Chrome's installability check (CDP Page.getInstallabilityErrors) reports no errors", async () => {
    await cdp.send("Page.enable");
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    ok(installabilityErrors.length === 0, JSON.stringify(installabilityErrors));
    const { url, errors } = await cdp.send("Page.getAppManifest");
    ok(errors.length === 0 || errors.every((e) => !e.critical), JSON.stringify(errors));
    return `manifest ${new URL(url).pathname}, 0 installability errors`;
  });
  await context.close();
  notTested(G, "the installed app (own window) opens the right page", "no browser was actually installed here; the start URL, scope and standalone rules above were checked instead, and the page was exercised in standalone display mode below");
}

// ======================================================================================================
console.log("2. Reminder behaviour");
{
  const G = "2 Reminders";
  await check(G, "a successful download triggers the completion reminder (real scan -> PDF -> Download)", async () => {
    const { context, page } = await open("/scan");
    await page.locator('input[aria-label^="Upload a document"]').setInputFiles(SCAN);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(\d+ page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
    await page.getByRole("button", { name: /Create PDF \(\d+ page/ }).click();
    const dl = page.locator('[data-assistant-id="scan-download-pdf"]');
    await dl.waitFor({ timeout: 120000 });
    await page.waitForTimeout(5000);
    ok((await card(page).count()) === 0, "card before the file was saved");
    const d = page.waitForEvent("download");
    await dl.click();
    await (await d).saveAs(path.join(work, "x.pdf"));
    await card(page).waitFor({ timeout: 12000 });
    ok((await card(page).getAttribute("data-install-card")) === "done", "wrong card");
    await context.close();
  });
  await check(G, "a failed conversion does not trigger it", async () => {
    const { context, page } = await open("/convert/excel-to-pdf");
    const bad = path.join(work, "broken.xlsx");
    fs.writeFileSync(bad, "this is not a spreadsheet");
    await page.locator('input[type="file"]').first().setInputFiles(bad);
    await page.getByRole("alert").first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(9000);
    ok((await card(page).count()) === 0, "card after a failed export");
    ok(!(await page.getByRole("button", { name: /Download/ }).count()), "a download button was offered");
    const msg = await page.getByRole("alert").first().innerText();
    await context.close();
    return "error shown: " + msg.slice(0, 60);
  });
  await check(G, "'Not yet' gives no install invitation, and none later on that page or after a reload", async () => {
    const { context, page } = await open("/");
    await complete(page);
    await card(page).waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Not yet" }).click();
    ok(!(await page.content()).includes("Add FreePDFScanner"), "install wording after Not yet");
    await complete(page);
    await page.waitForTimeout(7000);
    ok((await card(page).count()) === 0, "card again on the same page");
    await page.reload();
    await page.waitForSelector("main");
    await complete(page);
    await page.waitForTimeout(7000);
    ok((await card(page).count()) === 0, "card after reload");
    const s = await state(page);
    ok(s.quietUntil > Date.now() + 2.9 * 86400000 && s.quietUntil < Date.now() + 3.1 * 86400000, "3-day quiet period: " + JSON.stringify(s));
    await context.close();
  });
  for (const [label, click, days, extra] of [
    ["Maybe later", async (p) => { await p.getByRole("button", { name: "Yes, I'm all set" }).click(); await p.getByRole("button", { name: "Maybe later" }).click(); }, 14, (s) => s.dismissals === 1],
    ["close", async (p) => { await p.getByRole("button", { name: "Close" }).click(); }, 7, (s) => s.dismissals === 1],
    ["Don't remind me again", async (p) => { await p.getByRole("button", { name: "Yes, I'm all set" }).click(); await p.getByRole("button", { name: "Don't remind me again" }).click(); }, null, (s) => s.off === true],
  ]) {
    await check(G, `'${label}': stored period is right and survives navigation and a reload`, async () => {
      const { context, page } = await open("/");
      await complete(page);
      await card(page).waitFor({ timeout: 12000 });
      await click(page);
      const s = await state(page);
      ok(extra(s), "state " + JSON.stringify(s));
      if (days) {
        const left = (s.quietUntil - Date.now()) / 86400000;
        ok(left > days - 0.1 && left <= days + 0.01, `quiet ${left.toFixed(2)} days, expected ${days}`);
      }
      await page.getByRole("link", { name: "Tools", exact: true }).first().click();
      await page.waitForURL("**/tools");
      await complete(page);
      await page.waitForTimeout(7000);
      ok((await card(page).count()) === 0, "card after in-app navigation");
      await page.reload();
      await page.waitForSelector("main");
      await complete(page);
      await page.waitForTimeout(7000);
      ok((await card(page).count()) === 0, "card after reload");
      if (days) {
        // when the quiet period has run out the card may return
        await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("ds_install_reminder")); s.quietUntil = Date.now() - 1000; localStorage.setItem("ds_install_reminder", JSON.stringify(s)); });
        await page.reload();
        await page.waitForSelector("main");
        await complete(page);
        await card(page).waitFor({ timeout: 12000 });
      }
      await context.close();
      return days ? `${days} days, returns after expiry` : "permanent";
    });
  }
  await check(G, "browsing reminder does not appear too early (30 s) and does appear after a minute of use", async () => {
    const { context, page } = await open("/", { clock: true });
    await tick(page, 45);
    ok((await card(page).count()) === 0, "card at 45 s");
    await tick(page, 20);
    await card(page).waitFor({ timeout: 3000 });
    ok((await card(page).getAttribute("data-install-card")) === "browse", "kind");
    await context.close();
  });
  await check(G, "unfinished-task reminder offers help, not installation", async () => {
    const { context, page } = await open("/scan", { clock: true });
    await page.locator('input[aria-label^="Upload a document"]').setInputFiles(SCAN);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(\d+ page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
    await tick(page, 70);
    await page.clock.runFor(100000);
    await card(page).waitFor({ timeout: 3000 });
    const t = await card(page).innerText();
    ok((await card(page).getAttribute("data-install-card")) === "help" && /Still working/.test(t) && !/install|Add FreePDFScanner|Home Screen/i.test(t), t);
    await context.close();
  });
  await check(G, "only one reminder at a time", async () => {
    const { context, page } = await open("/", { clock: true });
    await tick(page, 70);
    await card(page).waitFor({ timeout: 3000 });
    await complete(page);
    await tick(page, 10);
    ok((await card(page).count()) === 1, "count " + (await card(page).count()));
    ok((await card(page).getAttribute("data-install-card")) === "browse", "first card replaced");
    await context.close();
  });
  await check(G, "held back by the cookie banner until a choice is made", async () => {
    const { context, page } = await open("/", { consent: false });
    await page.getByRole("dialog").first().waitFor();
    await complete(page);
    await page.waitForTimeout(8000);
    ok((await card(page).count()) === 0, "card over the consent banner");
    await page.getByRole("button", { name: "Reject non-essential" }).click();
    await card(page).waitFor({ timeout: 12000 });
    await context.close();
  });
  await check(G, "held back while the Ask me panel is open", async () => {
    const { context, page } = await open("/");
    await page.locator('button[aria-label*="Ask" i]').first().click();
    await page.getByRole("dialog").first().waitFor();
    await complete(page);
    await page.waitForTimeout(8000);
    ok((await card(page).count()) === 0, "card while the assistant is open");
    await context.close();
  });
  await check(G, "held back while the page editor is open, shown after it closes (real editor)", async () => {
    const { context, page } = await open("/scan");
    await page.locator('input[aria-label^="Upload a document"]').setInputFiles(SCAN);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(\d+ page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
    await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
    const editor = page.getByRole("dialog", { name: /Edit page 1/ });
    await editor.waitFor();
    await complete(page);
    await page.waitForTimeout(8000);
    ok((await card(page).count()) === 0, "card over the editor");
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await card(page).waitFor({ timeout: 12000 });
    await context.close();
  });
  for (const [label, viewport, touch] of [["desktop", { width: 1280, height: 900 }, false], ["phone 390x844", { width: 390, height: 844 }, true]]) {
    await check(G, `card stays clear of ads, bottom navigation, Ask me and controls while scrolling (${label})`, async () => {
      const { context, page } = await open("/", { viewport, touch, ua: touch ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36" : undefined });
      await complete(page);
      await card(page).waitFor({ timeout: 12000 });
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      let visibleSamples = 0, hiddenSamples = 0;
      for (let y = 0; y <= max; y += Math.max(120, Math.floor(viewport.height / 4))) {
        await page.evaluate((v) => scrollTo(0, v), y);
        await page.waitForTimeout(900);
        const vis = await card(page).evaluate((el) => getComputedStyle(el).visibility);
        if (vis === "hidden") {
          hiddenSamples++;
          continue;
        }
        visibleSamples++;
        const c = await rectOf(card(page));
        const sel = 'aside[data-ad-placement], nav[aria-label="Primary"], button[aria-label*="Ask" i], main button, main input, main a.btn, main summary, [role="dialog"]';
        for (const e of await page.locator(sel).all()) {
          if (!(await e.isVisible())) continue;
          const r = await rectOf(e);
          if (r.r - r.l < 1 || r.b - r.t < 1) continue;
          ok(!hit(c, r), `at scroll ${y} the card overlaps ${(await e.evaluate((x) => x.tagName + " " + (x.getAttribute("aria-label") || x.className)).catch(() => "")).slice(0, 60)}`);
        }
      }
      await context.close();
      return `${visibleSamples} visible / ${hiddenSamples} hidden-while-covering samples, no overlap`;
    });
  }
  await check(G, "installed app: not asked again (standalone display, iOS standalone flag, and appinstalled)", async () => {
    let r = await open("/", { init: () => { const real = matchMedia.bind(window); window.matchMedia = (q) => (q.includes("display-mode: standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : real(q)); } });
    await complete(r.page);
    await r.page.waitForTimeout(8000);
    ok((await card(r.page).count()) === 0, "standalone display mode");
    ok(/FreePDFScanner/.test(await r.page.title()), "start page loads in standalone mode");
    await r.context.close();
    r = await open("/", { init: () => Object.defineProperty(navigator, "standalone", { value: true }) });
    await complete(r.page);
    await r.page.waitForTimeout(8000);
    ok((await card(r.page).count()) === 0, "iOS navigator.standalone");
    await r.context.close();
    r = await open("/");
    await r.page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await r.page.reload();
    await r.page.waitForSelector("main");
    await complete(r.page);
    await r.page.waitForTimeout(8000);
    ok((await card(r.page).count()) === 0 && (await state(r.page)).off === true, "after appinstalled and reload");
    await r.context.close();
  });
  await check(G, "storage holds only the intended preferences; nothing about reminders is sent to analytics", async () => {
    const { context, page, sent } = await open("/", { analytics: true });
    await complete(page);
    await card(page).waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Yes, I'm all set" }).click();
    await page.getByRole("button", { name: "Maybe later" }).click();
    await page.waitForTimeout(1500);
    const dump = await page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      cookies: document.cookie,
      idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
      reminder: JSON.parse(localStorage.getItem("ds_install_reminder")),
    }));
    const allowed = new Set(["pdfscanner.theme", "ds_consent", "ds_install_reminder", "ds_visitor_id", "ds_session_id", "ds_session_last_seen"]);
    const extra = dump.local.filter((k) => !allowed.has(k));
    ok(extra.length === 0, "unexpected local keys: " + extra);
    ok(dump.cookies === "", "cookies: " + dump.cookies);
    const keys = Object.keys(dump.reminder).sort().join(",");
    ok(/^(dismissals,)?(quietUntil,)?v$|^dismissals,quietUntil,v$|^quietUntil,v$/.test(keys.replace("dismissals,quietUntil,v", "dismissals,quietUntil,v")), "reminder keys " + keys);
    ok(sent.length > 0, "analytics was on, so ordinary events should have been sent");
    const leaks = sent.filter((b) => /install|reminder|everything done|Maybe later|Add FreePDFScanner/i.test(b));
    ok(leaks.length === 0, "analytics bodies mention the reminder: " + leaks[0]?.slice(0, 120));
    await context.close();
    return `local ${dump.local.join(",")}; session ${dump.session.join(",") || "-"}; reminder ${JSON.stringify(dump.reminder)}; ${sent.length} ordinary analytics requests, none about reminders`;
  });
}

// ======================================================================================================
console.log("3. Install prompt");
{
  const G = "3 Prompt";
  await check(G, "real Chrome: is the native prompt offered here? (reported as observed)", async () => {
    const { context, page } = await open("/");
    const fired = await page.evaluate(() => new Promise((res) => { let got = false; window.addEventListener("beforeinstallprompt", () => { got = true; res(true); }); setTimeout(() => res(got), 6000); }));
    await context.close();
    return fired ? "beforeinstallprompt FIRED in this Chrome" : "beforeinstallprompt did NOT fire in this automated Chrome (headless/automation never offers it)";
  });
  const simFn = (outcome) => {
    window.__prompted = 0;
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => void window.__prompted++;
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
  };
  await check(G, "SIMULATED event: not invoked before a click; accepted state does not claim success", async () => {
    const { context, page } = await open("/");
    await page.evaluate(simFn, "accepted");
    await complete(page);
    await card(page).waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Yes, I'm all set" }).click();
    await page.waitForTimeout(1500);
    ok((await page.evaluate(() => window.__prompted)) === 0, "prompted without a click");
    await page.getByRole("button", { name: "Add FreePDFScanner" }).click();
    await page.waitForFunction(() => window.__prompted === 1);
    const t = await card(page).innerText();
    ok(!/installed|success/i.test(t.replace("We will not say it is done until it confirms", "")) || /We will not say it is done/.test(t), t);
    await context.close();
    return "simulation, not a native install";
  });
  await check(G, "SIMULATED event: dismissed -> polite, quiet for 14 days", async () => {
    const { context, page } = await open("/");
    await page.evaluate(simFn, "dismissed");
    await complete(page);
    await card(page).waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Yes, I'm all set" }).click();
    await page.getByRole("button", { name: "Add FreePDFScanner" }).click();
    await page.waitForFunction(() => document.querySelector("[data-install-card]") === null);
    ok((await state(page)).quietUntil > Date.now() + 13 * 86400000, "no 14-day quiet period");
    await context.close();
    return "simulation";
  });
  await check(G, "SIMULATED event: prompt() throws -> falls back to the manual guide, no success claimed", async () => {
    const { context, page } = await open("/");
    await page.evaluate(() => { const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = async () => { throw new Error("blocked"); }; e.userChoice = new Promise(() => {}); window.dispatchEvent(e); });
    await complete(page);
    await card(page).waitFor({ timeout: 12000 });
    await page.getByRole("button", { name: "Yes, I'm all set" }).click();
    await page.getByRole("button", { name: "Add FreePDFScanner" }).click();
    await page.getByRole("dialog").waitFor();
    ok(!/installed/i.test(await page.getByRole("dialog").innerText()), "dialog claims installed");
    await context.close();
    return "simulation";
  });
  await check(G, "no prompt available (Safari, iPhone, Firefox style): the manual guide opens, and opening it claims nothing", async () => {
    for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0"]) {
      const { context, page } = await open("/", { ua });
      await complete(page);
      await card(page).waitFor({ timeout: 12000 });
      await page.getByRole("button", { name: "Yes, I'm all set" }).click();
      await page.getByRole("button", { name: "Add FreePDFScanner" }).click();
      const d = page.getByRole("dialog");
      await d.waitFor();
      const t = await d.innerText();
      ok(!/installed (on|successfully)|you.re all set|success/i.test(t), "claims success: " + t.slice(0, 80));
      ok(!(await d.getByRole("button", { name: "Install now" }).count()), "native button without a native prompt");
      ok((await state(page)).off !== true, "opening the guide switched reminders off as if installed");
      await context.close();
    }
  });
  notTested(G, "a real native install and the real `appinstalled` event", "needs a headed browser with a person accepting the operating-system install dialog; automation never receives beforeinstallprompt. `appinstalled` handling was only exercised with a dispatched event");
}

// ======================================================================================================
console.log("4. Guide wording");
{
  const G = "4 Guide";
  const MATRIX = [
    ["iPhone Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", /Add to Home Screen/],
    ["Android Chrome", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", /Install app/],
    ["Windows Edge", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0", /Install this site as an app/],
    ["macOS Safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", /Add to Dock/],
    ["unsupported browser", "SomeBrowser/1.0", /Bookmark this page/],
  ];
  for (const [name, ua, re] of MATRIX) {
    await check(G, `${name}: right steps, uncertainty stated, a fallback when the option is missing`, async () => {
      const { context, page } = await open("/", { ua });
      await complete(page);
      await card(page).waitFor({ timeout: 12000 });
      await page.getByRole("button", { name: "Yes, I'm all set" }).click();
      await page.getByRole("button", { name: "Show me how" }).click();
      const d = page.getByRole("dialog");
      await d.waitFor();
      const t = await d.innerText();
      ok(re.test(t), "steps");
      ok(/have not checked every version on a real device/.test(t), "uncertainty note missing");
      await d.locator("summary", { hasText: "I can't find it" }).click();
      ok(/bookmark/i.test(await d.innerText()), "no bookmark fallback");
      ok(await d.getByRole("button", { name: /Not right\? Change|Change/ }).count(), "no manual selector");
      await context.close();
    });
  }
  notTested(G, "the steps on real devices and browser versions", "no iPhone, iPad, Android phone, Samsung device, Mac or Firefox install flow was available; wording comes from the vendors' help pages (listed in the dialog)");
}

await browser.close();
const counts = { PASS: 0, FAIL: 0, "NOT TESTED": 0 };
for (const r of rows) counts[r[0]]++;
fs.writeFileSync(path.join(here, "verify-final-results.json"), JSON.stringify(rows, null, 2));
console.log(`\nPASS ${counts.PASS}   FAIL ${counts.FAIL}   NOT TESTED ${counts["NOT TESTED"]}`);
process.exit(failed ? 1 : 0);
