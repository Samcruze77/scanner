// Does the Help tips switch in the header really control the tips, page by page?
// On every page that has switch-controlled tips (the scanner workspace and the editor tools built on
// it), using only the header switch:
//   * ON shows the tip for where the person is (Edit -> Create PDF -> Download), and the page
//     editor's own tips (next step after an edit; how to move around a page on a phone);
//   * OFF hides a tip that is on screen at once, without a reload, and keeps them hidden after one;
//   * turning tips back ON brings back tips that were closed before;
//   * the badge says what is really happening, including for a first-time visitor who has not
//     answered the "would you like help?" question (tips show for them).
// Also lists the pages that have no switch-controlled tips at all.
//
//   node --no-warnings --import ./tests/scanner/register.mjs tests/guidance/tips-pages.mjs [baseUrl]

import { addText, assert, BASE, LAYOUTS, launch, makePdf, openAnnotator, openWorkspace, rejectCookies, session } from "../editor/lib.mjs";

const GUIDANCE_KEY = "docuscanner.guidance.v1";
const pdf = await makePdf("tips.pdf", 2);
const browser = await launch();
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

const state = (tips) => ({ [GUIDANCE_KEY]: JSON.stringify({ tips, dismissed: [], asked: 1 }) });
const sw = (page) => page.locator('header [data-assistant-id="tips-toggle"]');
const badge = (page) => sw(page).locator(".tips-badge").filter({ visible: true }).innerText();
const tip = (page, id) => page.locator(`[data-tip="${id}"]`);
async function newPage(layout, storage) {
  const s = await session(browser, { viewport: layout.viewport, mobile: layout.mobile, storage });
  await s.page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  await s.page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  return s;
}
async function switchTo(page, want) {
  await sw(page).waitFor();
  await page.waitForFunction(() => document.querySelector('header [data-assistant-id="tips-toggle"]')?.hasAttribute("aria-pressed"));
  if ((await badge(page)) !== want) await sw(page).click();
  assert.equal(await badge(page), want, `switch shows ${want}`);
}

console.log(`Help tips switch, page by page, against ${BASE}`);
const desktop = LAYOUTS[2];
const phone = LAYOUTS[0];

for (const route of ["/scan", "/convert/image-to-pdf", "/tools/pdf-editor", "/tools/sign-pdf", "/tools/annotate"]) {
  await test(`${route}: switch ON shows the Edit tip, then the Download tip after Create PDF; OFF hides it at once and after a reload`, async () => {
    const { context, page } = await newPage(desktop, state("off"));
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await rejectCookies(page);
    await switchTo(page, "ON");
    await openWorkspace(page, pdf, 2, route);
    await tip(page, "workflow-edit").waitFor({ timeout: 15000 });
    assert.match(await tip(page, "workflow-edit").innerText(), /Edit your document/);
    // Switch OFF while the tip is on screen: it goes away without a reload.
    await switchTo(page, "OFF");
    await tip(page, "workflow-edit").waitFor({ state: "detached", timeout: 5000 });
    // ON again: it is back (turning tips on again also brings back closed tips).
    await switchTo(page, "ON");
    await tip(page, "workflow-edit").waitFor({ timeout: 5000 });
    // Next step: Create PDF -> the Download tip for the new step.
    await page.locator('[data-assistant-id="scan-create-pdf"]').click();
    await tip(page, "workflow-download").waitFor({ timeout: 60000 });
    assert.equal(await tip(page, "workflow-edit").count(), 0, "only the tip for the current step");
    // OFF, reload, add pages again: no tips.
    await switchTo(page, "OFF");
    await page.reload({ waitUntil: "domcontentloaded" });
    await openWorkspace(page, pdf, 2, route);
    await page.waitForTimeout(800);
    assert.equal(await page.locator("[data-tip]").count(), 0, "no tips while OFF, after a reload");
    assert.equal(await badge(page), "OFF");
    await context.close();
  });
}

await test("/tools/pdf-editor page editor: the next-step tip shows after an edit with tips ON and not with tips OFF", async () => {
  const results = {};
  for (const want of ["ON", "OFF"]) {
    const { context, page } = await newPage(desktop, state(want === "ON" ? "on" : "off"));
    await openWorkspace(page, pdf, 2, "/tools/pdf-editor");
    await switchTo(page, want);
    await openAnnotator(page, 1);
    await addText(page, 0.3, 0.3, "Hello");
    await page.waitForTimeout(600);
    results[want] = await page.locator('[role="dialog"] [data-tip], [role="dialog"] [data-hint="editor-next-step"], [role="dialog"] :text("Done editing")').count();
    results[`${want}-tipNotes`] = await page.locator('[role="dialog"] [role="note"]').count();
    await context.close();
  }
  assert.ok(results["ON-tipNotes"] > 0, `a tip note in the editor with tips ON (${JSON.stringify(results)})`);
  assert.equal(results["OFF-tipNotes"], 0, `no tip note in the editor with tips OFF (${JSON.stringify(results)})`);
  return JSON.stringify(results);
});

await test("phone: the page editor's how-to-move tip follows the switch (ON shows it, OFF does not)", async () => {
  const counts = {};
  for (const want of ["ON", "OFF"]) {
    const { context, page } = await newPage(phone, state(want === "ON" ? "on" : "off"));
    await openWorkspace(page, pdf, 2, "/tools/pdf-editor");
    await switchTo(page, want);
    await openAnnotator(page, 1);
    await page.waitForTimeout(800);
    counts[want] = await page.locator('[role="dialog"] [role="note"]').count();
    await context.close();
  }
  assert.ok(counts.ON > 0, `tip shown with ON (${JSON.stringify(counts)})`);
  assert.equal(counts.OFF, 0, `no tip with OFF (${JSON.stringify(counts)})`);
});

await test("a tip that was closed comes back when tips are switched OFF and ON again", async () => {
  const { context, page } = await newPage(desktop, state("on"));
  await openWorkspace(page, pdf, 2, "/scan");
  await tip(page, "workflow-edit").waitFor({ timeout: 15000 });
  await tip(page, "workflow-edit").getByRole("button", { name: "Dismiss this tip" }).click();
  await tip(page, "workflow-edit").waitFor({ state: "detached" });
  await switchTo(page, "OFF");
  await switchTo(page, "ON");
  await tip(page, "workflow-edit").waitFor({ timeout: 5000 });
  await context.close();
});

await test("first-time visitor (question not answered yet): the badge matches whether tips are really shown", async () => {
  const { context, page } = await newPage(desktop, { [GUIDANCE_KEY]: JSON.stringify({ tips: "unset", dismissed: [], asked: 1 }) });
  await openWorkspace(page, pdf, 2, "/scan");
  await page.waitForTimeout(1500);
  const shown = await tip(page, "workflow-edit").count();
  const shownBadge = await badge(page);
  await context.close();
  assert.equal(shownBadge, shown > 0 ? "ON" : "OFF", `tips ${shown > 0 ? "are shown" : "are hidden"} but the switch says ${shownBadge}`);
});

// ---- page tips (one per tool page, approved wording in components/guidance/pageTips.ts) ----------------------
const { PAGE_TIPS } = await import("../../components/guidance/pageTips.ts");
const PAGE_TIP_ROUTES = [
  ["/", "page-home"],
  ["/convert/pdf-to-word", "page-pdf-to-word"],
  ["/convert/word-to-pdf", "page-word-to-pdf"],
  ["/convert/excel-to-pdf", "page-excel-to-pdf"],
  ["/convert/pdf-to-excel", "page-pdf-to-excel"],
  ["/convert/pdf-to-jpg", "page-pdf-to-image"],
  ["/convert/pdf-to-png", "page-pdf-to-image"],
  ["/tools/compress-pdf", "page-compress-pdf"],
  ["/tools/compress-image", "page-compress-image"],
  ["/tools/compress-word", "page-compress-office"],
  ["/tools/compress-excel", "page-compress-office"],
  ["/tools/protect-pdf", "page-protect-pdf"],
  ["/tools/edit-image", "page-edit-image"],
];
for (const [route, id] of PAGE_TIP_ROUTES) {
  await test(`${route}: its own tip with ON (no layout shift), gone at once with OFF, stays closed once closed, back after OFF then ON`, async () => {
    const { context, page } = await newPage(desktop, state("on"));
    await context.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(BASE + route, { waitUntil: "load" });
    await rejectCookies(page);
    await page.waitForFunction(() => document.querySelector('header [data-assistant-id="tips-toggle"]')?.hasAttribute("aria-pressed"));
    await page.waitForTimeout(1000);
    const t = tip(page, id);
    assert.equal(await t.count(), 1, "the tip is on the page");
    assert.equal(await t.isVisible(), true, "and visible");
    assert.equal((await t.innerText()).trim(), PAGE_TIPS[id], "the approved wording for this page");
    assert.equal(await page.locator("[data-page-tip]").count(), 1, "only this page's tip");
    const cls = await page.evaluate(() => window.__cls);
    assert.ok(cls < 0.01, `no layout shift from the tip (CLS ${cls.toFixed(3)})`);
    await switchTo(page, "OFF");
    await t.waitFor({ state: "detached", timeout: 5000 });
    await switchTo(page, "ON");
    await t.waitFor({ timeout: 5000 });
    await t.getByRole("button", { name: "Dismiss this tip" }).click();
    await t.waitFor({ state: "detached" });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(800);
    assert.equal(await tip(page, id).count(), 0, "a closed tip stays closed after a reload");
    await switchTo(page, "OFF");
    await switchTo(page, "ON");
    await tip(page, id).waitFor({ timeout: 5000 });
    await context.close();
    return `CLS ${cls.toFixed(3)}`;
  });
}

await test("before any JavaScript runs: a page tip is hidden when tips are OFF or the tip was closed, shown otherwise", async () => {
  const seen = {};
  for (const [label, storage] of [
    ["on", state("on")],
    ["unset", null],
    ["off", state("off")],
    ["closed", { [GUIDANCE_KEY]: JSON.stringify({ tips: "on", dismissed: ["page-compress-pdf"], asked: 1 }) }],
  ]) {
    const { context, page } = await newPage(desktop, storage ?? undefined);
    await context.route("**/_next/static/**/*.js", (r) => r.abort());
    await page.goto(BASE + "/tools/compress-pdf", { waitUntil: "load" });
    seen[label] = await page.evaluate(() => { const el = document.querySelector('[data-tip="page-compress-pdf"]'); return !!el && getComputedStyle(el).display !== "none"; });
    await context.close();
  }
  assert.deepEqual(seen, { on: true, unset: true, off: false, closed: false });
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
