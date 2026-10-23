// Drives the "Ask FreePDFScanner" assistant in a real browser against a running production build:
// where it appears, open/close with mouse and keyboard on desktop and phone, real answers, links,
// page-aware instructions, "show me" highlighting (and the honest failure when a control is not
// on screen), AI vs. built-in-guide labelling and fallbacks (the model endpoint is stubbed), what
// is sent to the server, layout against the phone's bottom bar and the cookie banner, themes, and
// that an open document survives following an assistant link.
//
//   npm run build && npm run start           (another terminal)
//   node tests/assistant/browser.mjs [baseUrl]    default http://localhost:3000
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
if (!CHROME) throw new Error("No Chrome/Edge found. Set CHROME to a browser executable.");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-e2e-"));

let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];

async function open(viewport, { mobile = false, ai = "off", scheme } = {}) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR|favicon/.test(m.text()) && errors.push(m.text()));
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: { ok: true } }));
  const posts = [];
  // Stand-in for the model endpoint, so the test never needs a key or spends anything.
  await page.route("**/api/assistant", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { ai: ai === "on" || ai === "fail" || ai === "limited" } });
    posts.push(JSON.parse(req.postData() ?? "{}"));
    if (ai === "on") return route.fulfill({ json: { mode: "ai", answer: "1. Open /tools/protect-pdf.\n2. Choose your PDF.\n3. Type a password.", entryIds: ["protect-pdf"], links: [{ href: "/tools/protect-pdf", label: "Open Protect PDF" }] } });
    if (ai === "limited") return route.fulfill({ status: 429, json: { error: "rate_limited", retryAfter: 42 } });
    return route.fulfill({ status: 503, json: { error: "ai_unavailable", reason: "provider_error" } });
  });
  return { context, page, posts };
}
const launcher = (page) => page.locator("[data-assistant-launcher]");
const panel = (page) => page.getByRole("dialog", { name: "Ask FreePDFScanner" });
const rejectCookies = async (page) => {
  try {
    await page.getByRole("button", { name: "Reject non-essential" }).click({ timeout: 6000 });
  } catch {
    /* already chosen */
  }
};
async function visit(page, url, { cookies = true } = {}) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  if (cookies) await rejectCookies(page);
}
async function ask(page, text) {
  await page.locator("#assistant-input").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}
const lastAnswer = (page) => page.locator('[data-assistant-panel] [role="log"] > div').last();

// A one-page PDF with a visible Create PDF button, to prove a document survives.
const pdf = await PDFDocument.create();
pdf.addPage([595, 842]).drawText("HELLO", { x: 50, y: 700, size: 30 });
const samplePdf = path.join(work, "doc.pdf");
fs.writeFileSync(samplePdf, await pdf.save());

try {
  console.log("Where it appears");
  {
    const { context, page } = await open({ width: 1280, height: 900 });
    for (const url of ["/", "/scan", "/tools", "/tools/sign-pdf", "/tools/add-image", "/tools/protect-pdf", "/convert", "/convert/word-to-pdf", "/create-word-document", "/guides", "/privacy", "/history"]) {
      await visit(page, url, { cookies: url === "/" });
      await launcher(page).waitFor({ timeout: 15000 });
    }
    ok("the launcher is on the home page, scanner, every tool page, converters, Create Word Document, guides, privacy and history");
    await visit(page, "/reset-password", { cookies: false });
    await page.waitForTimeout(500);
    assert.equal(await launcher(page).count(), 0);
    ok("it is not shown on the password-reset page");
    await context.close();
  }

  console.log("\nOpen, close, keyboard (desktop)");
  {
    const { context, page } = await open({ width: 1280, height: 900 });
    await visit(page, "/");
    // Closed launcher is light: the panel and knowledge are not loaded yet.
    const eager = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /assistant|knowledge/i.test(n)));
    assert.equal(await panel(page).count(), 0, "panel is not in the page until asked for");
    ok(`the panel is not even loaded until the launcher is used (eager assistant files: ${eager.length})`);
    await page.keyboard.press("Tab");
    await launcher(page).focus();
    await page.keyboard.press("Enter");
    await panel(page).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "assistant-input");
    ok("keyboard: Enter on the launcher opens it and focus moves to the question box");
    await expect(page.getByText("Hi! I'm your FreePDFScanner guide. Ask me how to convert, edit, protect, or download a document, and I'll show you where to go.").isVisible());
    ok("the welcome message is shown");
    const suggestions = await panel(page).locator("ul button").allInnerTexts();
    assert.deepEqual(suggestions, [
      "How do I convert a Word document to PDF?",
      "How do I insert my passport photograph?",
      "How do I combine multiple PDFs?",
      "How do I protect a PDF with a password?",
      "Where can I find my download?",
      "How do I use the scanner?",
      "Create a Word document from scratch",
    ]);
    ok("the example questions are offered, including Create a Word document from scratch");
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-assistant-launcher"), null, { timeout: 3000 });
    ok("Escape closes it and focus returns to the launcher");
    await launcher(page).click();
    await panel(page).getByRole("button", { name: "Close the help assistant" }).click();
    await panel(page).waitFor({ state: "hidden" });
    ok("the close button works");
    await context.close();
  }

  console.log("\nBuilt-in guide answers (AI off)");
  {
    const { context, page, posts } = await open({ width: 1280, height: 900 }, { ai: "off" });
    await visit(page, "/");
    await launcher(page).click();
    await page.getByText("Built-in guide (automatic keyword help, not AI).").waitFor();
    ok("the panel says plainly that this is not AI when the model is off");
    await panel(page).getByRole("button", { name: "How do I convert a Word document to PDF?" }).click();
    const answer = lastAnswer(page);
    await answer.getByText("Choose Download PDF.").waitFor();
    const text = await answer.innerText();
    assert.match(text, /Word to PDF/);
    assert.match(text, /\.docx/);
    assert.ok(await answer.locator('a[href="/convert/word-to-pdf"]').count() === 1, "links to the real converter");
    assert.match(text, /not AI/);
    assert.equal(posts.length, 0, "with AI off nothing is sent to the model endpoint");
    ok("a real question gets accurate steps, a link to the right tool, and an honest 'not AI' note");

    // Create Word Document: the suggestion, the steps, the three-way distinction, and the link that works.
    await visit(page, "/");
    await launcher(page).click();
    await panel(page).getByRole("button", { name: "Create a Word document from scratch" }).click();
    const create = lastAnswer(page);
    await create.getByText("Choose Download Word (.docx).").waitFor();
    const createText = await create.innerText();
    assert.match(createText, /blank white page/);
    assert.match(createText, /Document name/);
    assert.match(createText, /Heading 1, 2 or 3/);
    assert.match(createText, /PDF to Word/);
    assert.match(createText, /OCR/);
    assert.doesNotMatch(createText, /upload a PDF/i);
    assert.equal(await create.locator('a[href="/create-word-document"]').count(), 1, "links to the real page");
    assert.equal(await create.locator('a[href="/convert/pdf-to-word"]').count(), 1, "also offers converting an existing PDF");
    assert.equal(await create.locator('a[href="/tools/ocr"]').count(), 1, "also offers text recognition");
    assert.equal(posts.length, 0, "nothing is sent to the model endpoint");
    ok("Ask Me explains Create Word Document, links to it, and offers PDF to Word and OCR for the other jobs");
    await ask(page, "What's the difference between creating a Word document and converting a PDF to Word?");
    await lastAnswer(page).getByText("None of these changes your original PDF or image.").waitFor();
    ok("it tells creating, converting and text recognition apart");
    await ask(page, "How do I add my signature to a Word document?");
    await lastAnswer(page).getByText(/Add signature/).first().waitFor();
    assert.match(await lastAnswer(page).innerText(), /not a certified digital signature/);
    ok("it explains adding a signature, and is honest that it is not a certified signature");
    await Promise.all([page.waitForURL("**/create-word-document"), lastAnswer(page).locator('a[href="/create-word-document"]').click()]);
    await page.waitForSelector(".wc-page");
    ok("the link opens the working page");
    // The open panel and its conversation stay while the visitor moves to another page; only open it if it was closed.
    if (!(await panel(page).isVisible())) await launcher(page).click();
    await ask(page, "How do I insert a picture?");
    const there = lastAnswer(page);
    await there.getByText("Insert image").first().waitFor();
    const thereText = await there.innerText();
    assert.match(thereText, /You're already on Create Word Document/);
    assert.match(thereText, /Add signature/);
    assert.ok(!/^\s*1\s*Open Create Word Document/.test(await there.locator("ol li").first().innerText()), "does not tell them to open the page they are on");
    await there.getByRole("button", { name: /Show me/ }).first().click().catch(() => undefined);
    ok("on the page itself the answer is about this page's buttons");

    await ask(page, "can I edit the existing text in my pdf?");
    await lastAnswer(page).getByText(/cannot|No\./).first().waitFor();
    assert.match(await lastAnswer(page).innerText(), /cannot be rewritten|No\./);
    ok("an unsupported request is declined honestly");

    await ask(page, "how do I book a flight to Paris");
    await lastAnswer(page).getByText(/not sure/i).waitFor();
    assert.equal(await lastAnswer(page).locator("ol").count(), 0);
    ok("an unknown question says it is not sure instead of inventing steps");
    await context.close();
  }

  console.log("\nPage context, links and pointing");
  {
    const { context, page } = await open({ width: 1280, height: 900 }, { ai: "off" });
    await visit(page, "/convert/word-to-pdf");
    await launcher(page).click();
    await panel(page).getByText("You're on: Word to PDF").waitFor();
    await panel(page).getByRole("button", { name: "How do I use Word to PDF?" }).waitFor();
    ok("it knows which tool the visitor is on and offers a question for it");
    await ask(page, "how do I convert a word document to pdf");
    const a = lastAnswer(page);
    await a.getByText(/already on/).waitFor();
    const steps = await a.locator("ol li").allInnerTexts();
    assert.ok(!/^\s*1\s*Open the Word to PDF/.test(steps[0]), "does not tell them to open the page they are on");
    assert.equal(await a.locator('a[href="/convert/word-to-pdf"]').count(), 0, "no link to the current page");
    ok("instructions are tailored to the current page");

    await a.getByRole("button", { name: "Show me on this page" }).first().click();
    await page.waitForSelector('[data-assistant-id="file-dropzone"].assistant-highlight');
    const note = await a.getByText("Highlighted on the page.").count();
    assert.equal(note, 1);
    ok("'Show me' scrolls to and rings the real upload box");
    const outline = await page.evaluate(() => getComputedStyle(document.querySelector(".assistant-highlight")).outlineStyle);
    assert.equal(outline, "solid");

    // A control that is not on screen: the assistant says so instead of pretending.
    const downloadBtn = a.getByRole("button", { name: "Show me on this page" }).last();
    await downloadBtn.click();
    await a.getByText(/can't see that on this screen/).waitFor();
    ok("when a control is not on screen it says so honestly and falls back to the written steps");
    await context.close();
  }

  console.log("\nAI mode, fallbacks and what is sent");
  {
    const { context, page, posts } = await open({ width: 1280, height: 900 }, { ai: "on" });
    await visit(page, "/tools/protect-pdf");
    await launcher(page).click();
    await page.getByText("AI helper. Answers can be wrong; check them on the page.").waitFor();
    await ask(page, "how do i put a password on this? my email is jo@example.com");
    const a = lastAnswer(page);
    await a.getByText("AI-written answer.").waitFor();
    assert.equal(posts.length, 1);
    assert.deepEqual(Object.keys(posts[0]).sort(), ["messages", "path"]);
    assert.equal(posts[0].path, "/tools/protect-pdf");
    assert.ok(posts[0].messages.every((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string"));
    ok("AI answers are labelled as AI and can be wrong; only the messages and the page path are sent");
    assert.ok((await a.innerText()).includes("Choose your PDF"));
    await a.getByRole("button", { name: "Show checked steps with pointers" }).click();
    await a.getByRole("button", { name: "Show me on this page" }).first().waitFor();
    ok("AI answers can be expanded into verified steps with pointers");
    await context.close();
  }
  for (const [mode, expected] of [["fail", /isn't available right now/], ["limited", /asking quickly/]]) {
    const { context, page } = await open({ width: 1280, height: 900 }, { ai: mode });
    await visit(page, "/");
    await launcher(page).click();
    await ask(page, "how do i protect a pdf with a password");
    const a = lastAnswer(page);
    await a.getByText(expected).waitFor();
    assert.match(await a.innerText(), /not AI/);
    assert.ok((await a.locator("ol li").count()) >= 3, "the guide still gives real steps");
    assert.equal(await a.getByRole("button", { name: "Try the AI again" }).count(), 1, "offers a retry");
    ok(`when the AI is ${mode === "fail" ? "unavailable" : "rate-limited"} the guide answers instead, labelled as such, with a retry`);
    await context.close();
  }

  console.log("\nPhone layout and other pages' layouts");
  {
    const { context, page } = await open({ width: 390, height: 844 }, { mobile: true, ai: "off" });
    await visit(page, "/");
    const lb = await launcher(page).boundingBox();
    const nav = await page.locator('nav[aria-label="Primary"]').last().boundingBox();
    assert.ok(lb.y + lb.height <= nav.y + 1, `launcher sits above the bottom navigation (launcher bottom ${lb.y + lb.height}, nav top ${nav.y})`);
    ok("on a phone the launcher sits above the bottom navigation bar");
    // Cookie banner must be above the launcher, not hidden behind it.
    const bannerButton = page.getByRole("button", { name: "Reject non-essential" });
    if (await bannerButton.count()) {
      const top = await page.evaluate(() => {
        const el = document.querySelector("[data-assistant-launcher]");
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit?.closest("[role=dialog]")?.getAttribute("aria-labelledby") ? "banner" : hit?.closest("[data-assistant-launcher]") ? "launcher" : "other";
      });
      ok(`cookie banner layering is respected (top element over the launcher: ${top})`);
      await rejectCookies(page);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways scrolling");
    await launcher(page).click();
    const pb = await panel(page).boundingBox();
    assert.ok(pb.x >= 0 && pb.x + pb.width <= 390 && pb.y >= 0, "panel fits the phone screen");
    assert.ok(pb.y + pb.height <= nav.y + 1, "panel stays above the bottom navigation");
    await ask(page, "how do I combine multiple pdfs");
    await lastAnswer(page).getByText("Create PDF").first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    ok("on a phone it opens within the screen, above the nav bar, answers, and causes no sideways scroll");
    await panel(page).getByRole("button", { name: "Close the help assistant" }).tap();
    await panel(page).waitFor({ state: "hidden" });
    await launcher(page).tap();
    await panel(page).waitFor();
    ok("it opens and closes reliably by touch");
    await context.close();
  }

  console.log("\nPointing on a phone steps aside; links do not discard open work");
  {
    const { context, page } = await open({ width: 390, height: 844 }, { mobile: true, ai: "off" });
    await visit(page, "/scan");
    await page.locator('input[aria-label^="Upload a document"]').setInputFiles(samplePdf);
    await page.locator('ul[aria-label="Pages"] li').first().waitFor({ timeout: 30000 });
    await launcher(page).click();
    await ask(page, "how do I sign a pdf");
    const a = lastAnswer(page);
    await a.getByText("Choose Edit page").first().waitFor();
    // The link to another tool must open in a new tab while a document is open.
    const link = a.locator('a[href="/tools/sign-pdf"]');
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match((await link.getAttribute("rel")) ?? "", /noopener/);
    await a.getByText("Links open in a new tab so your work on this page isn't lost.").waitFor();
    ok("while a document is open, links to other tools open in a new tab");
    const popup = page.waitForEvent("popup");
    await link.click();
    const tab = await popup;
    await tab.waitForURL(/\/tools\/sign-pdf$/, { timeout: 20000 });
    await tab.close();
    assert.equal(await page.locator('ul[aria-label="Pages"] li').count(), 1, "the open document is still here");
    assert.match(page.url(), /\/scan$/);
    ok("following a link leaves the document you were working on untouched");
    // 'Show me' on a phone closes the panel so the control is visible.
    await a.getByRole("button", { name: "Show me on this page" }).first().click();
    await panel(page).waitFor({ state: "hidden" });
    await page.waitForSelector(".assistant-highlight");
    ok("on a phone 'Show me' closes the panel and rings the real control");
    await context.close();
  }

  console.log("\nThemes and accessibility");
  for (const theme of ["light", "beige", "dark"]) {
    const { context, page } = await open({ width: 1280, height: 900 }, { ai: "off" });
    await page.addInitScript((t) => localStorage.setItem("pdfscanner.theme", t), theme);
    await visit(page, "/");
    await launcher(page).click();
    await ask(page, "how do I use the scanner");
    await lastAnswer(page).getByText("Choose Create PDF").first().waitFor();
    const colours = await page.evaluate(() => {
      const parse = (c) => c.match(/[\d.]+/g).slice(0, 4).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] === undefined || c[3] > 0.5) return c; } return [255, 255, 255]; };
      const ratio = (el) => { const f = parse(getComputedStyle(el).color), b = bgOf(el); const [a, c] = [lum(f), lum(b)].sort((x, y) => y - x); return (a + 0.05) / (c + 0.05); };
      const log = document.querySelector('[data-assistant-panel] [role="log"]');
      const bubbles = [...log.querySelectorAll("p")].slice(0, 6);
      const btn = document.querySelector('[data-assistant-panel] a, [data-assistant-panel] button.btn-primary');
      return { theme: document.documentElement.dataset.theme, min: Math.min(...bubbles.map(ratio)), button: btn ? ratio(btn) : 21 };
    });
    assert.equal(colours.theme, theme === "light" ? "light" : theme);
    assert.ok(colours.min >= 4.5, `${theme}: answer text contrast ${colours.min.toFixed(2)}`);
    assert.ok(colours.button >= 4.5, `${theme}: button contrast ${colours.button.toFixed(2)}`);
    await context.close();
  }
  ok("answer and button text meet 4.5:1 contrast in Light, Warm Beige and Dark");
  {
    const { context, page } = await open({ width: 1280, height: 900 }, { ai: "off" });
    await visit(page, "/");
    await launcher(page).click();
    await panel(page).waitFor();
    const roles = await page.evaluate(() => {
      const p = document.querySelector("[data-assistant-panel]");
      return {
        dialog: p.getAttribute("role"),
        label: p.getAttribute("aria-label"),
        log: !!p.querySelector('[role="log"][aria-live="polite"]'),
        input: !!document.querySelector('label[for="assistant-input"]'),
        close: !!p.querySelector('button[aria-label="Close the help assistant"]'),
        small: [...p.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 32).map((b) => b.innerText),
      };
    });
    assert.equal(roles.dialog, "dialog");
    assert.equal(roles.label, "Ask FreePDFScanner");
    assert.ok(roles.log && roles.input && roles.close);
    assert.deepEqual(roles.small, [], "all buttons are at least 32px tall: " + roles.small.join(","));
    ok("dialog, live conversation log, labelled input and close button are exposed; targets are big enough");
    await context.close();
  }

  console.log("\nExisting workflows are not disturbed");
  {
    const { context, page } = await open({ width: 1280, height: 900 }, { ai: "off" });
    await visit(page, "/tools/pdf-editor");
    await page.locator('input[aria-label^="Upload a document"]').setInputFiles(samplePdf);
    await page.locator('ul[aria-label="Pages"] li').first().waitFor({ timeout: 30000 });
    // The editor opens over the launcher and the document controls are all reachable.
    await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
    await page.locator('[data-assistant-id="page-annotate"]').click();
    await page.getByRole("dialog", { name: /Annotate page/ }).waitFor();
    const top = await page.evaluate(() => {
      const el = document.querySelector("[data-assistant-launcher]");
      if (!el) return "none";
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit?.closest("[role=dialog]")?.getAttribute("aria-label") ?? "page";
    });
    assert.notEqual(top, "page", "a full-screen editor is on top of the launcher");
    await page.getByRole("dialog", { name: /Annotate page/ }).getByRole("button", { name: "Done editing", exact: true }).click();
    await page.getByRole("button", { name: "Done editing", exact: true }).click();
    await page.locator('[data-assistant-id="scan-create-pdf"]').click();
    const download = page.waitForEvent("download", { timeout: 60000 });
    await page.locator('[data-assistant-id="scan-download-pdf"]').click();
    const file = await download;
    assert.match(file.suggestedFilename(), /\.pdf$/i);
    ok("upload, edit, create and download still work, and editors open over the assistant");
    // The ad areas and the Export button are not overlapped by the closed launcher's box.
    const clear = await page.evaluate(() => {
      const l = document.querySelector("[data-assistant-launcher]")?.getBoundingClientRect();
      const b = document.querySelector('[data-assistant-id="scan-download-pdf"]')?.getBoundingClientRect();
      if (!l || !b) return true;
      return l.right < b.left || l.left > b.right || l.bottom < b.top || l.top > b.bottom;
    });
    assert.equal(clear, true, "launcher does not cover the Download button");
    ok("the launcher does not cover the Download button");
    await context.close();
  }

  assert.deepEqual(errors, [], "no console or page errors: " + errors.join(" | "));
  ok("no console or page errors during any of the above");
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`\n${pass} checks passed`);

async function expect(promise) {
  assert.equal(await promise, true);
}
