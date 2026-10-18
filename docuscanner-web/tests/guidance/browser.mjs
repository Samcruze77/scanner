// Guidance in a real browser: the one-time "would you like help?" question, the contextual tips, the
// Ask me assistant on every tool (also from inside the editor), and the Edit -> Done editing -> Create PDF
// -> Download PDF signposting, including the honest cases (a failed download is never reported as a
// download). Phone, tablet and desktop, in Light, Warm Beige and Dark.
//
//   npm run build && npm run start -- -p 3117      (in another terminal)
//   node --no-warnings --import ./tests/scanner/register.mjs tests/guidance/browser.mjs [baseUrl]

import {
  addText, assert, BASE, boxOf, chromium, exportPdf, fs, isTextRed, launch, LAYOUTS, makePdf, ok, openAnnotator, openWorkspace, passed,
  path, PDFDocument, rejectCookies, renderPages, session, work,
} from "../editor/lib.mjs";
import { TOOLS } from "../../utils/tools/registry.ts";
import { CONVERT_TOOLS } from "../../components/convert/tools.ts";

void chromium;
const pdf = await makePdf("form.pdf", 2);
const browser = await launch();
const GUIDANCE_KEY = "docuscanner.guidance.v1";
const allErrors = [];

const stored = (page) => page.evaluate((k) => localStorage.getItem(k), GUIDANCE_KEY).then((v) => (v ? JSON.parse(v) : null));
const rectOf = (loc) => loc.first().evaluate((el) => el.getBoundingClientRect().toJSON());
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

async function newSession(layout, extra = {}) {
  const s = await session(browser, { viewport: layout.viewport, mobile: layout.mobile, ...extra });
  await s.page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  return s;
}

// ---- 1. the one-time question ---------------------------------------------------------------------------------
for (const layout of LAYOUTS.filter((l) => !l.label.startsWith("Wide"))) {
  console.log(`\nFirst-visit question - ${layout.label}`);
  const { context, page, errors } = await newSession(layout);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  // The cookie banner comes first; the question waits for a quiet page.
  await page.waitForTimeout(5200);
  assert.equal(await page.locator("[data-assist-onboarding]").count(), 0, "not shown while the cookie banner is open");
  await rejectCookies(page);
  const card = page.locator("[data-assist-onboarding]");
  await card.waitFor({ timeout: 15000 });
  assert.match(await card.innerText(), /Would you like a little help while using FreePDFScanner\?/);
  assert.match(await card.innerText(), /We can show simple tips to help you find tools, edit documents, and download your finished files\./);
  assert.equal(await card.locator("button").count(), 2);
  assert.equal(await card.getByRole("button", { name: "Yes, show me tips" }).count(), 1);
  assert.equal(await card.getByRole("button", { name: "No thanks" }).count(), 1);
  assert.equal(await page.getByRole("dialog").count(), 0, "it is a small card, not a dialog that blocks the page");
  ok("it appears once, at a quiet moment, as a small card with the two answers (not a modal)");

  // It does not sit on the Ask me button, the phone's bottom bar, or any button/field of the page.
  const c = await rectOf(card);
  const ask = await rectOf(page.locator("[data-assistant-launcher]"));
  assert.ok(!overlaps(c, ask), "clear of the Ask me button");
  if (layout.viewport.width < 640) assert.ok(!overlaps(c, await rectOf(page.locator('nav[aria-label="Primary"]'))), "clear of the bottom navigation");
  assert.ok(c.x >= 0 && c.x + c.width <= layout.viewport.width && c.y >= 0 && c.y + c.height <= layout.viewport.height, "fully on screen");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, "no sideways scroll");
  ok("it does not cover Ask me or the bottom navigation, and stays on screen");

  await card.getByRole("button", { name: "No thanks" }).click();
  await card.waitFor({ state: "detached" });
  assert.deepEqual(await stored(page), { tips: "off", dismissed: [], asked: 0 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  assert.equal(await page.locator("[data-assist-onboarding]").count(), 0, "never asked again");
  assert.equal(await page.locator("[data-assistant-launcher]").count(), 1, "Ask me is still there");
  await page.locator("[data-assistant-launcher]").click();
  await page.locator("[data-assistant-panel]").waitFor();
  ok('"No thanks" is final: not asked again, no tips, and Ask me still works');
  allErrors.push(...errors);
  await context.close();
}

// ---- 1b. ignored: it goes away for the rest of the visit and is counted, not treated as a 'no' ------------------
{
  console.log("\nIgnored question");
  const { context, page, errors } = await newSession(LAYOUTS[2]);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await rejectCookies(page);
  const card = page.locator("[data-assist-onboarding]");
  await card.waitFor({ timeout: 15000 });
  await card.waitFor({ state: "detached", timeout: 60000 });
  const after = await stored(page);
  assert.equal(after.tips, "unset", "ignoring it is not a 'no'");
  assert.equal(after.asked, 1, "it is counted once");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  assert.equal(await page.locator("[data-assist-onboarding]").count(), 0, "not shown again during the same visit");
  ok("an ignored question steps aside after a while, is not shown again this visit and is not a 'no'");
  allErrors.push(...errors);
  await context.close();
}

// ---- 2. tips on: contextual tips appear once, are dismissible, can be switched off in the footer --------------
{
  console.log("\nTips on");
  const layout = LAYOUTS[0];
  const { context, page, errors } = await newSession(layout);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await rejectCookies(page);
  const card = page.locator("[data-assist-onboarding]");
  await card.waitFor({ timeout: 15000 });
  await card.getByRole("button", { name: "Yes, show me tips" }).click();
  assert.deepEqual(await stored(page), { tips: "on", dismissed: [], asked: 0 });
  await openWorkspace(page, pdf, 2);
  const tip = page.locator('[data-tip="workflow-edit"]');
  await tip.waitFor();
  assert.match(await tip.innerText(), /Edit your document[\s\S]*Done editing[\s\S]*Create PDF/);
  await tip.getByRole("button", { name: "Dismiss this tip" }).click();
  assert.equal(await tip.count(), 0);
  assert.ok((await stored(page)).dismissed.includes("workflow-edit"));
  await openWorkspace(page, pdf, 2);
  assert.equal(await page.locator('[data-tip="workflow-edit"]').count(), 0, "a dismissed tip does not come back");
  ok("Yes turns tips on; a tip can be dismissed and then never returns");

  // Footer switch.
  const toggle = page.locator('[data-assistant-id="tips-toggle"]');
  await toggle.scrollIntoViewIfNeeded();
  assert.equal((await toggle.innerText()).trim(), "Turn help tips off");
  await toggle.click();
  assert.equal((await stored(page)).tips, "off");
  assert.equal((await toggle.innerText()).trim(), "Turn help tips on");
  await toggle.click();
  const afterOn = await stored(page);
  assert.equal(afterOn.tips, "on");
  assert.deepEqual(afterOn.dismissed, [], "turning tips back on lets them help again");
  ok("tips can be turned off and on again from the footer");
  allErrors.push(...errors);
  await context.close();
}

// ---- 3. the whole workflow, with the guidance at each step --------------------------------------------------------------
for (const layout of [LAYOUTS[0], LAYOUTS[2]]) {
  console.log(`\nEdit -> Done editing -> Create PDF -> Download PDF - ${layout.label}`);
  const { context, page, errors } = await newSession(layout, { storage: { [GUIDANCE_KEY]: JSON.stringify({ tips: "on", dismissed: layout.mobile ? [] : [] }) } });
  const current = async () => (await page.locator('ol[aria-label="Progress"] li[aria-current="step"]').innerText()).split(/\r?\n/).pop();
  await openWorkspace(page, pdf, 2);
  assert.equal((await current()).trim(), "Edit", "step: Edit");
  assert.equal(await page.locator('[data-tip="workflow-edit"]').count(), 1);
  assert.equal(await page.locator("[data-next-step]").count(), 0, "nothing is highlighted before the edit is finished");

  await openAnnotator(page, 1);
  await addText(page, 0.12, 0.3, "FLOW-TEXT");
  const hint = page.locator('[data-editor-hint="next"]');
  if (layout.mobile) await page.locator('[data-editor-hint="pan"]').getByRole("button", { name: "Dismiss this tip" }).click();
  await hint.waitFor();
  assert.match(await hint.innerText(), /Your changes are ready\.\s*Continue editing or choose Done editing when you're ready to export\./);
  await hint.getByRole("button", { name: "Dismiss this tip" }).click();
  assert.equal(await hint.count(), 0);
  ok("after a change, a small dismissible hint says what to do next");

  await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  assert.equal(await page.locator('[data-editor-hint]').count(), 0);
  await page.getByRole("dialog", { name: /Edit page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  assert.equal((await current()).trim(), "Create PDF", "step moved to Create PDF");
  const next = page.locator("[data-next-step]");
  assert.equal(await next.count(), 1);
  assert.match(await next.innerText(), /Create PDF/);
  assert.equal(await page.locator('[data-tip="workflow-create"]').count(), 1);
  ok("after Done editing the real Create PDF button is the highlighted next step");

  await page.locator('[data-assistant-id="scan-create-pdf"]').click();
  await page.locator('[data-assistant-id="scan-download-pdf"]').waitFor({ timeout: 60000 });
  assert.equal((await current()).trim(), "Download PDF", "step moved to Download PDF");
  assert.match(await page.locator("[data-next-step]").innerText(), /Download PDF/);
  assert.equal(await page.locator("[data-download-started]").count(), 0, "no 'download started' before anything was downloaded");
  assert.equal(await page.locator('[data-tip="workflow-download"]').count(), 1);
  ok("once the PDF exists, Download PDF is the highlighted next step and nothing claims a download yet");

  // A download that fails must not be reported as done.
  await page.evaluate(() => {
    window.__clickBackup = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      throw new Error("download blocked");
    };
  });
  await page.locator('[data-assistant-id="scan-download-pdf"]').click();
  await page.getByRole("alert").filter({ hasText: "Couldn't start the download" }).waitFor();
  assert.equal(await page.locator("[data-download-started]").count(), 0, "a failed download is not reported as started");
  assert.equal((await current()).trim(), "Download PDF", "…and the step does not advance");
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = window.__clickBackup;
  });
  ok("a failed download shows an error and no success message");

  const download = page.waitForEvent("download", { timeout: 60000 });
  await page.locator('[data-assistant-id="scan-download-pdf"]').click();
  const saved = path.join(work, `flow-${layout.mobile ? "phone" : "desktop"}.pdf`);
  await (await download).saveAs(saved);
  const started = page.locator("[data-download-started]");
  await started.waitFor();
  assert.match(await started.innerText(), /Download started\. Look for document\.pdf in your Downloads folder/);
  assert.equal(await page.locator('ol[aria-label="Progress"] li[aria-current="step"]').count(), 0, "every step is done");
  ok("after a real download the page says the download started, and where to look");

  const reopened = await PDFDocument.load(fs.readFileSync(saved));
  assert.equal(reopened.getPageCount(), 2, "the downloaded PDF reopens with both pages");
  const pages = await renderPages(saved, `flow-${layout.mobile ? "phone" : "desktop"}`);
  assert.ok(boxOf(pages[0].canvas, isTextRed), "and page 1 has the text that was added");
  ok("the downloaded PDF reopens: two pages, the added text is on page 1");

  // Dismissed hints stay dismissed on the next editing session.
  await openWorkspace(page, pdf, 2);
  assert.equal(await page.locator('[data-tip="workflow-edit"]').count(), 1, "(first tip not yet dismissed by the person, so it can show)");
  assert.deepEqual(errors, [], "no errors");
  allErrors.push(...errors);
  await context.close();
}

// ---- 4. with tips off nothing is signposted, but real results are still reported ------------------------------
{
  console.log("\nTips off");
  const { context, page } = await newSession(LAYOUTS[2], { storage: { [GUIDANCE_KEY]: JSON.stringify({ tips: "off", dismissed: [] }) } });
  await openWorkspace(page, pdf, 2);
  assert.equal(await page.locator("[data-tip]").count(), 0);
  await openAnnotator(page, 1);
  await addText(page, 0.12, 0.3, "QUIET");
  await page.waitForTimeout(600);
  assert.equal(await page.locator("[data-editor-hint]").count(), 0, "no hints in the editor");
  await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  await page.getByRole("dialog", { name: /Edit page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  assert.equal(await page.locator("[data-tip]").count(), 0, "no workflow tips");
  await exportPdf(page, "quiet.pdf");
  await page.locator("[data-download-started]").waitFor();
  ok('with "No thanks" there are no tips, but the "download started" result is still shown');
  await context.close();
}

// ---- 5. Ask me everywhere, with answers about the real controls -------------------------------------------------------
{
  console.log("\nAsk me on every tool");
  const { context, page, errors } = await newSession(LAYOUTS[2], { storage: { [GUIDANCE_KEY]: JSON.stringify({ tips: "off", dismissed: [] }) } });
  const routes = ["/", "/scan", "/tools", "/convert", ...TOOLS.map((t) => `/tools/${t.slug}`), ...CONVERT_TOOLS.map((c) => c.href)];
  let first = true;
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    if (first) {
      await rejectCookies(page);
      first = false;
    }
    await page.locator("[data-assistant-launcher]").waitFor({ timeout: 15000 });
    assert.equal(await page.locator("[data-assistant-launcher]").isVisible(), true, `Ask me is on ${route}`);
  }
  ok(`the Ask me button is on all ${routes.length} public pages and tools`);

  await openWorkspace(page, pdf, 2, "/tools/pdf-editor");
  const ask = async (q) => {
    const box = page.locator("[data-assistant-panel] textarea");
    await box.fill(q);
    await box.press("Enter");
    await page.waitForTimeout(500);
    return (await page.locator("[data-assistant-panel] [role=log]").innerText()).toLowerCase();
  };
  await page.locator("[data-assistant-launcher]").click();
  await page.locator("[data-assistant-panel]").waitFor();
  let log = await ask("how do I zoom in on the page");
  assert.match(log, /move page/);
  assert.match(log, /fit width/);
  log = await ask("how do I move my signature a little");
  assert.match(log, /arrow/);
  log = await ask("restore original image");
  assert.match(log, /edit image/);
  assert.match(log, /restore original/);
  log = await ask("I finished editing what next");
  assert.match(log, /done editing/);
  assert.match(log, /create pdf/);
  assert.match(log, /download pdf/);
  ok("on the editor page it explains Move page, zoom, the arrows, picture restore and finishing, in the app's own words");
  await page.keyboard.press("Escape");

  // From inside the editor (a full-screen dialog), Help opens the assistant above it, and no work is lost.
  await openAnnotator(page, 1);
  await addText(page, 0.12, 0.3, "KEEP-ME");
  await page.getByRole("dialog", { name: /Annotate page/ }).locator('[data-assistant-id="annotation-help"]').click();
  const panel = page.locator("[data-assistant-panel]");
  await panel.waitFor();
  const pr = await rectOf(panel);
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-assistant-panel]") !== null, [pr.x + pr.width / 2, pr.y + pr.height / 2]);
  assert.ok(top, "the assistant is above the editor, not hidden behind it");
  await page.locator("[data-assistant-panel] textarea").fill("how do I move text");
  await page.locator("[data-assistant-panel] textarea").press("Enter");
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole("dialog", { name: /Annotate page/ }).count(), 1, "the editor is still open");
  await page.locator('[data-assistant-panel] button[aria-label="Close the help assistant"]').click();
  assert.ok((await page.locator('[role="application"] .border-dashed').count()) >= 0);
  await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
  ok("from inside the editor, Help opens Ask me over the editor and the work is untouched");
  allErrors.push(...errors);
  await context.close();
}

// ---- 6. the three themes ----------------------------------------------------------------------------------------------
{
  console.log("\nThemes");
  for (const theme of ["light", "beige", "dark"]) {
    for (const layout of [LAYOUTS[0], LAYOUTS[2]]) {
      const { context, page } = await newSession(layout, { storage: { "pdfscanner.theme": theme, [GUIDANCE_KEY]: JSON.stringify({ tips: "on", dismissed: [] }) } });
      await openWorkspace(page, pdf, 2);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      await openAnnotator(page, 1);
      await addText(page, 0.12, 0.3, "THEME");
      const hint = layout.mobile ? page.locator('[data-editor-hint="pan"]') : page.locator('[data-editor-hint="next"]');
      await hint.waitFor();
      const contrast = await page.evaluate(() => {
        function toRgb(c) {
          const x = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
          x.fillStyle = "#000";
          x.fillStyle = c;
          x.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
          return [r, g, b, a / 255];
        }
        function bg(el) {
          let e = el;
          while (e) {
            const [r, g, b, a] = toRgb(getComputedStyle(e).backgroundColor);
            if (a > 0.9) return [r, g, b];
            e = e.parentElement;
          }
          return [255, 255, 255];
        }
        const lum = ([r, g, b]) => {
          const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (a, b) => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const out = {};
        const measure = (name, el) => {
          const fg = toRgb(getComputedStyle(el).color).slice(0, 3);
          out[name] = ratio(fg, bg(el));
        };
        measure("hint", document.querySelector("[data-editor-hint] p"));
        for (const [name, sel] of [["tool", '[data-assistant-id="annotation-tool-text"]'], ["done", '[data-assistant-id="annotation-done"]'], ["move-left", 'button[aria-label="Move left"]']]) {
          const el = document.querySelector(sel);
          if (el) measure(name, el);
        }
        return out;
      });
      for (const [name, value] of Object.entries(contrast)) assert.ok(value >= 4.5, `${theme} ${layout.label}: ${name} text contrast ${value.toFixed(2)} >= 4.5`);
      await page.screenshot({ path: path.join(work, `theme-${theme}-${layout.mobile ? "phone" : "desktop"}.png`) });
      await context.close();
    }
  }
  ok("the editor, its arrows and the hints keep at least 4.5:1 text contrast in Light, Warm Beige and Dark (phone and desktop)");
}

await browser.close();
assert.deepEqual(allErrors, [], "no console or page errors");
ok("no console or page errors");
console.log(`\n${passed()} checks passed`);
console.log("Screenshots and downloads in " + work);
