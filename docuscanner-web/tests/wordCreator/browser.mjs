// Drives the real Create Word Document page in Chrome and inspects the ACTUAL downloaded .docx.
//   npm run build && npx next start -p 3117      (in another terminal)
//   node tests/wordCreator/browser.mjs [baseUrl]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BASE, CHROME, chromium, work } from "../audit/lib.mjs";
import { readDocx, sha } from "./docx-read.mjs";
import { makePicture } from "./fixtures.mjs";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const CONSENT = JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false });
const png = makePicture("png", 640, 320);
const pngFile = path.join(work, "picture.png");
fs.writeFileSync(pngFile, png.buf);
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL " + name + "\n       " + String(e?.stack ?? e).split("\n").slice(0, 8).join("\n       "));
  }
}

async function open({ viewport = { width: 1280, height: 900 }, touch = false, theme, init, storage } = {}) {
  const context = storage ? await browser.newContext({ storageState: storage, viewport, acceptDownloads: true }) : await browser.newContext({ viewport, acceptDownloads: true, isMobile: touch, hasTouch: touch });
  const page = await context.newPage();
  const problems = [];
  const requests = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && problems.push("console: " + m.text()));
  page.on("request", (r) => requests.push(r.url()));
  await page.route("**/api/analytics/**", (r) => r.fulfill({ status: 202, json: {} }));
  await page.route("**/api/assistant", (r) => r.fulfill({ json: { ai: false } }));
  await page.addInitScript(
    ([consent, t]) => {
      try {
        if (!localStorage.getItem("ds_consent")) localStorage.setItem("ds_consent", consent);
        if (t) localStorage.setItem("pdfscanner.theme", t);
      } catch {}
    },
    [CONSENT, theme],
  );
  if (init) await page.addInitScript(init);
  await page.goto(BASE + "/create-word-document", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".wc-page");
  return { context, page, problems, requests };
}
const btn = (page, name) => page.getByRole("button", { name, exact: true });
const body = (page) => page.locator(".wc-page");
async function type(page, text) {
  await body(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}
const savedStatus = (page) => page.waitForSelector('[data-save-status="saved"]', { timeout: 8000 });
async function download(page) {
  const waiting = page.waitForEvent("download");
  await btn(page, "Download Word (.docx)").click();
  const dl = await waiting;
  const file = path.join(work, "dl-" + Date.now() + ".docx");
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename(), docx: await readDocx(fs.readFileSync(file)) };
}
const html = (page) => body(page).evaluate((el) => el.innerHTML);

// ---- route, blank page ---------------------------------------------------------------------------------------------
await check("Tools hub links to Create Word Document and the workspace opens blank, with no upload", async () => {
  const { page, problems, requests } = await open();
  await page.goto(BASE + "/tools", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /Create Word Document/ }).first().click();
  await page.waitForURL("**/create-word-document");
  await page.waitForSelector(".wc-page");
  assert.equal((await body(page).innerText()).trim(), "");
  assert.equal(await page.getByLabel("Document name").inputValue(), "Untitled Document");
  assert.equal(await page.locator('[data-testid="wc-counter"]').innerText(), "Page count: 1 · 0 words");
  assert.ok(await page.getByRole("toolbar", { name: "Formatting" }).isVisible());
  assert.ok(await btn(page, "Download Word (.docx)").isVisible());
  assert.deepEqual(problems, []);
  assert.ok(!requests.some((u) => /supabase\.co\/rest|\/api\/(upload|ai)/.test(u)));
  const bg = await body(page).evaluate((el) => getComputedStyle(el).backgroundImage);
  assert.match(bg, /255, 255, 255/);
});
await check("home page links to it too", async () => {
  const { page } = await open();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  assert.ok(await page.locator('a[href="/create-word-document"]').first().isVisible());
});

// ---- typing and formatting ----------------------------------------------------------------------------------------------
await check("typing, paragraphs and undo/redo work", async () => {
  const { page } = await open();
  await type(page, "First line");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");
  assert.equal(await body(page).locator("p").count(), 2);
  await btn(page, "Undo (Ctrl+Z)").click();
  assert.ok(!/Second line/.test(await body(page).innerText()));
  await btn(page, "Redo (Ctrl+Y)").click();
  assert.match(await body(page).innerText(), /Second line/);
  await page.keyboard.press("Backspace");
  assert.match(await body(page).innerText(), /Second lin|Second lin$/m);
});
await check("toolbar formats only the selection and does not lose it", async () => {
  const { page } = await open();
  await type(page, "hello brave world");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+Shift+ArrowRight"); // selects the first word
  const word = await page.evaluate(() => getSelection().toString().trim());
  assert.ok(word === "hello", JSON.stringify(word));
  await btn(page, "Bold (Ctrl+B)").click();
  await btn(page, "Italic (Ctrl+I)").click();
  await btn(page, "Underline (Ctrl+U)").click();
  await btn(page, "Strikethrough").click();
  await btn(page, "Superscript").click();
  const h = await html(page);
  const strong = h.match(/<strong>(.*?)<\/strong>/)?.[1] ?? h.match(/<strong[^>]*>(.*?)<\/strong>/)?.[1];
  assert.ok(strong, h);
  assert.match(strong.replace(/<[^>]+>/g, ""), new RegExp(word));
  for (const tag of ["em", "u", "s", "sup"]) assert.match(h, new RegExp(`<${tag}[ >]`), tag);
  assert.ok(!/<strong>hello/.test(h) || word === "hello", "other words stay plain");
  assert.equal(await btn(page, "Bold (Ctrl+B)").getAttribute("aria-pressed"), "true");
});
await check("font, size, colour and highlight apply to the selection", async () => {
  const { page } = await open();
  await type(page, "colour me");
  await page.keyboard.press("Control+a");
  await page.getByLabel("Font", { exact: true }).selectOption("Georgia");
  const size = page.getByLabel("Font size in points");
  await size.fill("20");
  await size.press("Enter");
  await btn(page, "Text colour").click();
  await page.getByRole("button", { name: "Text colour #c00000" }).click();
  await page.keyboard.press("Escape");
  await btn(page, "Highlight colour").click();
  await page.getByRole("button", { name: "Highlight #ffff00" }).click();
  const span = body(page).locator("span").first();
  const style = await span.getAttribute("style");
  assert.match(style, /Georgia/);
  assert.match(style, /20pt/);
  assert.match(style, /#c00000|rgb\(192, 0, 0\)/);
  assert.match(await html(page), /<mark[^>]*(ffff00|255, 255, 0)/);
});
await check("headings, lists, alignment, line spacing and paragraph spacing work", async () => {
  const { page } = await open();
  await type(page, "Title text");
  await page.getByLabel("Paragraph style").selectOption("h1");
  assert.equal(await body(page).locator("h1").count(), 1);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Item one");
  await btn(page, "Bulleted list").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Item two");
  assert.equal(await body(page).locator("ul li").count(), 2);
  await btn(page, "Bulleted list").click();
  await btn(page, "Numbered list").click();
  assert.equal(await body(page).locator("ol li").count(), 1);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Aligned");
  await btn(page, "Align centre").click();
  await btn(page, "Paragraph").click();
  await page.getByLabel("Line spacing").selectOption("2");
  await page.getByLabel("After (pt)").fill("30");
  await page.keyboard.press("Escape");
  await btn(page, "Increase indent").click();
  const p = body(page).locator("p", { hasText: "Aligned" });
  const attrs = await p.evaluate((el) => ({ align: el.style.textAlign, lh: el.getAttribute("data-line-height"), after: el.getAttribute("data-space-after"), indent: el.getAttribute("data-indent") }));
  assert.deepEqual(attrs, { align: "center", lh: "2", after: "30", indent: "1" });
});
await check("a long document flows onto more pages with a visible page count", async () => {
  const { page } = await open();
  await body(page).click();
  for (let i = 0; i < 70; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("end");
  await page.waitForFunction(() => /Page count: [2-9]/.test(document.querySelector('[data-testid="wc-counter"]')?.textContent ?? ""));
  assert.ok((await page.locator(".wc-page-gap").count()) >= 1);
});

// ---- pictures ----------------------------------------------------------------------------------------------------------------
await check("pictures: insert from file, resize/align, bad and oversized files rejected, WebP converted", async () => {
  const { page } = await open();
  await type(page, "before");
  await page.setInputFiles('[data-testid="wc-image-input"]', pngFile);
  await page.waitForSelector(".wc-page img");
  const src = await body(page).locator("img").getAttribute("src");
  assert.match(src, /^data:image\/png;base64,/);
  assert.ok(!src.startsWith("blob:"));
  await body(page).locator("img").click();
  await page.getByRole("button", { name: "50% width" }).click();
  await btn(page, "Align centre").click();
  const attrs = await body(page).locator(".wc-img").evaluate((el) => ({ align: el.dataset.align, w: el.querySelector("img").style.width }));
  assert.deepEqual(attrs, { align: "center", w: "301px" });
  // bad type
  const txt = path.join(work, "notes.txt");
  fs.writeFileSync(txt, "not a picture");
  await page.setInputFiles('[data-testid="wc-image-input"]', txt).catch(() => {});
  // damaged picture
  const broken = path.join(work, "broken.png");
  fs.writeFileSync(broken, Buffer.from("this is not really a png"));
  await page.setInputFiles('[data-testid="wc-image-input"]', broken);
  await page.waitForSelector('.notice[role="alert"]');
  assert.match(await page.locator('.notice[role="alert"]').innerText(), /could not be opened|picture/i);
  // oversized
  const big = path.join(work, "big.png");
  fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024, 1));
  await page.setInputFiles('[data-testid="wc-image-input"]', big);
  await page.waitForFunction(() => /MB/.test(document.querySelector('.notice[role="alert"]')?.textContent ?? ""));
  assert.equal(await body(page).locator("img").count(), 1);
  // WebP is converted to PNG
  const webp = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    c.getContext("2d").fillStyle = "#0a0";
    c.getContext("2d").fillRect(0, 0, 200, 100);
    const blob = await new Promise((r) => c.toBlob(r, "image/webp"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const webpFile = path.join(work, "pic.webp");
  fs.writeFileSync(webpFile, Buffer.from(webp));
  await page.setInputFiles('[data-testid="wc-image-input"]', webpFile);
  await page.waitForFunction(() => document.querySelectorAll(".wc-page img").length === 2, null, { timeout: 8000 }).catch(async () => {
    throw new Error("webp not inserted: " + (await page.locator(".notice").allInnerTexts()).join(" | ") + " imgs=" + (await page.locator(".wc-page img").count()) + " bytes=" + fs.statSync(webpFile).size);
  });
  assert.match(await body(page).locator("img").nth(1).getAttribute("src"), /^data:image\/png/);
});
await check("pictures: pasting a picture from the clipboard inserts it; pasted scripts and javascript: links are dropped", async () => {
  const { page } = await open();
  await body(page).click();
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "clip.png", { type: "image/png" }));
    document.querySelector(".wc-page").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, Buffer.from(png.buf).toString("base64"));
  await page.waitForSelector(".wc-page img");
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/html", '<p>safe <a href="javascript:alert(1)">bad</a> <a href="https://ok.example/">good</a><script>window.__x=1</script><img src="https://evil.example/x.png" onerror="window.__y=1"></p>');
    document.querySelector(".wc-page").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const h = await html(page);
  assert.ok(!/javascript:/i.test(h) && !/<script/i.test(h) && !/onerror/i.test(h) && !/evil\.example/.test(h), h);
  assert.match(h, /https:\/\/ok\.example/);
  assert.equal(await page.evaluate(() => window.__x ?? window.__y ?? null), null);
});

// ---- download -------------------------------------------------------------------------------------------------------------------
// ---- font size ----------------------------------------------------------------------------------------------------------------
const sizeBox = (page) => page.getByLabel(/^Font size in points/);
// Focus has just been handed back to the page: give the browser and the editor two frames to settle their selection before the next key.
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await check("font size: a labelled group with a scrollable list of standard sizes that really formats the selection", async () => {
  const { page } = await open();
  await type(page, "alpha beta");
  assert.ok(await page.getByText("Font size", { exact: true }).isVisible(), "the group has a visible label");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Choose font size from list" }).click();
  const list = page.getByRole("listbox", { name: "Font sizes" });
  await list.waitFor();
  assert.deepEqual((await list.getByRole("option").allInnerTexts()).map(Number), [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]);
  const box = await list.boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= 900 && box.x >= 0 && box.x + box.width <= 1280, "the list is on screen");
  assert.ok(await list.evaluate((el) => getComputedStyle(el).overflowY === "auto"), "and scrolls");
  await list.getByRole("option", { name: "24", exact: true }).click();
  await list.waitFor({ state: "detached" });
  assert.match(await body(page).locator("span").first().getAttribute("style"), /font-size: 24pt/);
  assert.equal(await page.evaluate(() => getSelection().toString()), "alpha beta", "the selection is still there");
  assert.equal(await sizeBox(page).inputValue(), "24");
  await btn(page, "Increase font size").click();
  assert.equal(await sizeBox(page).inputValue(), "28");
  await btn(page, "Decrease font size").click();
  await btn(page, "Decrease font size").click();
  assert.equal(await sizeBox(page).inputValue(), "20");
  assert.equal(await page.evaluate(() => getSelection().toString()), "alpha beta");
  // At the caret: the next text typed has the chosen size.
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Choose font size from list" }).click();
  await page.getByRole("option", { name: "36", exact: true }).click();
  await page.keyboard.type("Z");
  assert.match(await body(page).locator("span", { hasText: "Z" }).last().getAttribute("style"), /font-size: 36pt/);
  assert.equal(await sizeBox(page).inputValue(), "36");
  // Typing a number works as before.
  await page.keyboard.press("Control+a");
  await settle(page);
  await sizeBox(page).fill("13.5");
  await sizeBox(page).press("Enter");
  assert.match(await body(page).locator("span").first().getAttribute("style"), /font-size: 13\.5pt/);
});
await check("font size: mixed sizes are shown as Mixed and each piece steps on its own", async () => {
  const { page } = await open();
  await type(page, "alpha beta");
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await settle(page); // the editor reads a selection made with the keyboard on the next frame; a person takes far longer to reach the box
  await sizeBox(page).fill("10");
  await sizeBox(page).press("Enter");
  await settle(page);
  await page.keyboard.press("End");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await settle(page);
  await sizeBox(page).fill("20");
  await sizeBox(page).press("Enter");
  await settle(page);
  await page.keyboard.press("Control+a");
  assert.equal(await sizeBox(page).inputValue(), "", "no single size is claimed");
  assert.equal(await sizeBox(page).getAttribute("placeholder"), "Mixed");
  assert.match(await sizeBox(page).getAttribute("aria-label"), /mixed sizes/);
  await btn(page, "Increase font size").click();
  const sizes = await body(page).locator("span").evaluateAll((els) => els.map((e) => [e.textContent, e.style.fontSize]));
  assert.deepEqual(sizes.filter(([t]) => /alpha|beta/.test(t)).map(([t, s]) => [t.trim(), s]), [["alpha", "11pt"], ["beta", "24pt"]]);
});
await check("font size: the list works from the keyboard and Escape closes it", async () => {
  const { page } = await open();
  await type(page, "keys");
  await page.keyboard.press("Control+a");
  await settle(page);
  await sizeBox(page).click();
  await sizeBox(page).press("ArrowDown");
  await page.getByRole("listbox", { name: "Font sizes" }).waitFor();
  await sizeBox(page).press("ArrowDown");
  await sizeBox(page).press("Enter");
  assert.match(await body(page).locator("span").first().getAttribute("style"), /font-size: 12pt/);
  await sizeBox(page).click();
  await sizeBox(page).press("ArrowDown");
  await page.getByRole("listbox", { name: "Font sizes" }).waitFor();
  await sizeBox(page).press("Escape");
  await page.getByRole("listbox", { name: "Font sizes" }).waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.classList.contains("wc-page"), null, { timeout: 3000 });
});

// ---- page margins -------------------------------------------------------------------------------------------------------------
const marginVar = (page, side) => page.locator(".wc-scaled").evaluate((el, s) => el.style.getPropertyValue(`--wc-m${s}`), side);
await check("page margins: presets and custom margins change the page and the downloaded file, with validation", async () => {
  const { page } = await open();
  await type(page, "Margins keep my words.");
  assert.equal(await marginVar(page, "l"), "96px");
  await btn(page, "Page margins").click();
  const dialog = page.getByRole("dialog", { name: "Page margins" });
  await dialog.getByRole("radio", { name: /Narrow/ }).click();
  assert.equal(await marginVar(page, "l"), "48px");
  assert.equal(await marginVar(page, "t"), "48px");
  assert.equal(await dialog.getByRole("radio", { name: /Narrow/ }).getAttribute("aria-checked"), "true");
  await dialog.getByRole("radio", { name: /Wide/ }).click();
  assert.equal(await marginVar(page, "l"), "192px");
  // The text area really is narrower or wider.
  assert.equal(await body(page).evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)), 192);
  // Custom values.
  await dialog.getByLabel("Left", { exact: true }).fill("1.5");
  await dialog.getByLabel("Right", { exact: true }).fill("0.75");
  await dialog.getByLabel("Top", { exact: true }).fill("0.5");
  await dialog.getByLabel("Bottom", { exact: true }).fill("2");
  await dialog.getByRole("button", { name: "Apply custom margins" }).click();
  assert.equal(await marginVar(page, "l"), "144px");
  assert.equal(await marginVar(page, "r"), "72px");
  assert.equal(await marginVar(page, "t"), "48px");
  assert.equal(await marginVar(page, "b"), "192px");
  // Invalid values are refused with a message and change nothing.
  for (const [side, value, message] of [["Left", "-1", /negative|at least/], ["Top", "0", /at least 0.25/], ["Right", "9", /at most 4/], ["Left", "", /number|at least/]]) {
    await dialog.getByLabel(side, { exact: true }).fill(value);
    await dialog.getByRole("button", { name: "Apply custom margins" }).click();
    assert.match(await dialog.getByRole("alert").innerText(), message, `${side} ${value}`);
    assert.equal(await marginVar(page, "l"), "144px", "nothing changed");
    await dialog.getByLabel(side, { exact: true }).fill(side === "Top" ? "0.5" : side === "Right" ? "0.75" : "1.5");
  }
  await dialog.getByLabel("Left", { exact: true }).fill("3.5");
  await dialog.getByLabel("Right", { exact: true }).fill("3.5");
  await dialog.getByRole("button", { name: "Apply custom margins" }).click();
  assert.match(await dialog.getByRole("alert").innerText(), /left and right margins leave too little room/);
  await dialog.getByLabel("Left", { exact: true }).fill("1.5");
  await dialog.getByLabel("Right", { exact: true }).fill("0.75");
  await dialog.getByRole("button", { name: "Apply custom margins" }).click();
  await page.keyboard.press("Escape");
  assert.match(await body(page).innerText(), /Margins keep my words\./);
  const { docx } = await download(page);
  assert.deepEqual(docx.page.margins, [720, 1080, 2880, 2160]);
  assert.equal(docx.paragraphs[0].text, "Margins keep my words.");
  // Saved with the draft and restored.
  await savedStatus(page);
  await page.reload();
  await page.waitForSelector(".wc-page");
  assert.equal(await marginVar(page, "l"), "144px");
  assert.equal(await marginVar(page, "b"), "192px");
});

// ---- paragraph menu ---------------------------------------------------------------------------------------------------------
await check("paragraph menu: alignment, line spacing presets, spacing, indents and lists format the paragraph and export", async () => {
  const { page } = await open();
  await type(page, "First paragraph of text");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second paragraph");
  await btn(page, "Paragraph").click();
  const menu = page.getByRole("dialog", { name: "Paragraph" });
  await menu.getByRole("button", { name: "Justify" }).click();
  assert.equal(await menu.getByLabel("Line spacing").locator("option").allInnerTexts().then((t) => t.slice(0, 4)).then((t) => t.join(",")), "Single,1.15,1.5,Double");
  await menu.getByLabel("Line spacing").selectOption("1.5");
  await menu.getByLabel("Before (pt)").fill("6");
  await menu.getByLabel("After (pt)").fill("18");
  await menu.getByLabel("Left", { exact: true }).fill("0.5");
  await menu.getByLabel("Right", { exact: true }).fill("0.25");
  await menu.getByLabel("First line", { exact: true }).fill("0.5");
  const p2 = body(page).locator("p", { hasText: "Second paragraph" });
  const attrs = await p2.evaluate((el) => ({ align: el.style.textAlign, lh: el.getAttribute("data-line-height"), before: el.getAttribute("data-space-before"), after: el.getAttribute("data-space-after"), left: el.getAttribute("data-indent-left"), right: el.getAttribute("data-indent-right"), first: el.getAttribute("data-first-line") }));
  assert.deepEqual(attrs, { align: "justify", lh: "1.5", before: "6", after: "18", left: "36", right: "18", first: "36" });
  // The first paragraph was not touched, and the caret and text are where they were.
  assert.equal(await body(page).locator("p", { hasText: "First paragraph" }).getAttribute("data-indent-left"), null);
  assert.match(await body(page).innerText(), /First paragraph of text\s+Second paragraph/);
  // Lists live in the menu too, and a hanging first line works.
  await menu.getByLabel("First line", { exact: true }).fill("-0.25");
  assert.equal(await p2.getAttribute("data-first-line"), "-18");
  await page.keyboard.press("Escape");
  const { docx } = await download(page);
  const second = docx.paragraphs.find((x) => x.text === "Second paragraph");
  assert.equal(second.align, "both");
  assert.equal(second.line, 360);
  assert.equal(second.before, 120);
  assert.equal(second.after, 360);
  assert.equal(second.indentLeft, 720);
  assert.equal(second.indentRight, 360);
  assert.equal(second.hanging, 360);
  assert.equal(docx.paragraphs.find((x) => x.text.startsWith("First")).indentLeft, null);
  await savedStatus(page);
});

// ---- add page -------------------------------------------------------------------------------------------------------------------
await check("add page: a real page break starts a new page at once, keeps text, undoes, and is kept in the .docx", async () => {
  const { page } = await open();
  await type(page, "Page one");
  await btn(page, "Add page").click();
  await page.keyboard.type("Page two");
  await page.waitForFunction(() => /Page count: 2/.test(document.querySelector('[data-testid="wc-counter"]')?.textContent ?? ""));
  assert.equal(await body(page).locator(".wc-pagebreak").count(), 1);
  assert.ok(await body(page).locator(".wc-pagebreak").isVisible());
  assert.match(await body(page).locator(".wc-pagebreak").innerText(), /Page break/i);
  const [y1, y2] = await Promise.all([body(page).locator("p", { hasText: "Page one" }).evaluate((e) => e.getBoundingClientRect().top), body(page).locator("p", { hasText: "Page two" }).evaluate((e) => e.getBoundingClientRect().top)]);
  assert.ok(y2 - y1 >= 1123, `page two starts a whole page lower (${y2 - y1})`);
  assert.equal(await body(page).locator("p").count(), 2, "no blank lines were added to fake a page");
  // Several pages with the keyboard shortcut, in the middle of a paragraph, and undo/redo.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("Page three");
  await page.waitForFunction(() => /Page count: 3/.test(document.querySelector('[data-testid="wc-counter"]')?.textContent ?? ""));
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  assert.ok((await body(page).locator(".wc-pagebreak").count()) <= 2);
  for (let i = 0; i < 6; i++) await btn(page, "Undo (Ctrl+Z)").click({ trial: false }).catch(() => undefined);
  await btn(page, "Redo (Ctrl+Y)").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" end");
  const text = await body(page).innerText();
  assert.match(text, /Page one/);
});
await check("add page: inside a paragraph the text after the caret moves to the new page; the .docx separates the pages", async () => {
  const { page } = await open();
  await type(page, "AAABBB");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await btn(page, "Add page").click();
  await page.keyboard.type("X");
  assert.deepEqual(await body(page).locator("p").allInnerTexts(), ["AAA", "XBBB"]);
  assert.equal(await body(page).locator(".wc-pagebreak").count(), 1);
  await page.keyboard.press("Control+End");
  await btn(page, "Add page").click();
  await page.keyboard.type("Last");
  const { docx } = await download(page);
  assert.deepEqual(docx.paragraphs.map((x) => [x.text, x.pageBreakBefore]), [["AAA", false], ["XBBB", true], ["Last", true]]);
  await savedStatus(page);
  await page.reload();
  await page.waitForSelector(".wc-page");
  assert.equal(await body(page).locator(".wc-pagebreak").count(), 2, "page breaks come back with the draft");
  assert.match(await page.locator('[data-testid="wc-counter"]').innerText(), /Page count: 3/);
});

// ---- keyboard ---------------------------------------------------------------------------------------------------------------------
await check("keyboard: arrows, Home, End and Page Up/Down move the caret natively; controls keep their own keys", async () => {
  const { page } = await open();
  await body(page).click();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.type(`Line ${i}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("last");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.type("^");
  assert.ok(await body(page).locator("p", { hasText: "^Line 78" }).count());
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("~");
  assert.ok(await body(page).locator("p", { hasText: "^Line 7~8" }).count());
  // Where the caret is in the document (measured from the top of the page, whatever has scrolled).
  const y = () => page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().top - document.querySelector(".wc-page").getBoundingClientRect().top);
  const before = await y();
  await page.keyboard.press("PageUp");
  const afterUp = await y();
  assert.ok(before - afterUp > 300, `Page Up moved the caret up (${before} -> ${afterUp})`);
  await page.keyboard.press("PageDown");
  assert.ok((await y()) > afterUp + 300, "Page Down moved it back down");
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("#");
  assert.ok(await body(page).locator("p", { hasText: "#Line 0" }).count());
  // Arrow keys in a control belong to the control: the document does not change and does not move.
  const textBefore = await body(page).innerText();
  await page.getByLabel("Paragraph style").focus();
  for (const k of ["ArrowDown", "ArrowUp"]) await page.keyboard.press(k);
  await sizeBox(page).focus();
  for (const k of ["ArrowLeft", "ArrowRight", "Home", "End"]) await page.keyboard.press(k);
  await btn(page, "Paragraph").click();
  const field = page.getByRole("dialog", { name: "Paragraph" }).getByLabel("Left", { exact: true });
  await field.focus();
  for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp"]) await page.keyboard.press(k);
  await page.keyboard.press("Escape");
  assert.equal(await body(page).innerText(), textBefore.replace(/\s+$/, "") === textBefore ? textBefore : await body(page).innerText());
  assert.ok((await body(page).locator("p", { hasText: "#Line 0" }).count()) === 1 && !/Left/.test(await body(page).innerText()));
});

// ---- phone ------------------------------------------------------------------------------------------------------------------------
const inside = (box, vw, vh) => box && box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= vw + 0.5 && box.y + box.height <= vh + 0.5;
await check("phone: the toolbar, bottom bar and menus fit a 320 px and a 390 px screen, with no sideways scroll", async () => {
  for (const [vw, vh] of [[320, 640], [390, 844]]) {
    const { page, context } = await open({ viewport: { width: vw, height: vh }, touch: true });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(m.sw <= m.iw + 1, `${vw}px: ${JSON.stringify(m)}`);
    for (const name of ["Undo (Ctrl+Z)", "Bold (Ctrl+B)", "Decrease font size", "Increase font size", "Choose font size from list", "More formatting and insert options", "Paragraph", "Insert image", "Add page", "Download Word (.docx)"]) {
      const b = await page.getByRole("button", { name, exact: true }).first().boundingBox();
      assert.ok(b && b.x >= 0 && b.x + b.width <= vw + 0.5, `${vw}px: ${name} is inside the screen width (${JSON.stringify(b)})`);
      assert.ok(b.height >= 36, `${vw}px: ${name} is a touch target (${b.height}px)`);
    }
    // The page is as wide as the screen and the text is not shrunk.
    const pageBox = await body(page).boundingBox();
    assert.ok(pageBox.width <= vw, `the sheet fits (${pageBox.width})`);
    await type(page, "readable");
    assert.ok((await body(page).locator("p").evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 14, "11 pt text is drawn at a readable 14.7 px");
    // Menus open inside the screen.
    await page.getByRole("button", { name: "Choose font size from list" }).click();
    assert.ok(inside(await page.getByRole("listbox", { name: "Font sizes" }).boundingBox(), vw, vh), "font size list on screen");
    await page.keyboard.press("Escape");
    for (const [name, dialog] of [["Paragraph", "Paragraph"], ["More formatting and insert options", "More"]]) {
      await page.getByRole("button", { name, exact: true }).first().click();
      const sheet = page.getByRole("dialog", { name: dialog, exact: true });
      await sheet.waitFor();
      assert.ok(inside(await sheet.boundingBox(), vw, vh), `${dialog} sheet on screen at ${vw}px`);
      await sheet.getByRole("button", { name: "Done" }).click();
      await sheet.waitFor({ state: "detached" });
    }
    await context.close();
  }
});
await check("phone: the whole job, from a blank page to a downloaded .docx", async () => {
  const { page, context } = await open({ viewport: { width: 390, height: 844 }, touch: true });
  await page.getByLabel("Document name").fill("Phone draft");
  await body(page).tap();
  await page.getByLabel("Paragraph style").selectOption("h1");
  await page.keyboard.type("My heading");
  await page.keyboard.press("Enter");
  await page.getByLabel("Paragraph style").selectOption("normal");
  await page.keyboard.type("Body text for the phone");
  await page.keyboard.press("Shift+Home");
  await page.getByRole("button", { name: "Choose font size from list" }).tap();
  await page.getByRole("option", { name: "18", exact: true }).tap();
  assert.equal(await page.evaluate(() => getSelection().toString()), "Body text for the phone", "selection kept after choosing a size");
  await page.getByRole("button", { name: "Paragraph", exact: true }).tap();
  const sheet = page.getByRole("dialog", { name: "Paragraph" });
  await sheet.getByRole("button", { name: "Align centre" }).tap();
  await sheet.getByLabel("After (pt)").fill("20");
  await sheet.getByRole("button", { name: "Done" }).tap();
  assert.equal(await body(page).locator("p", { hasText: "Body text" }).evaluate((e) => e.style.textAlign), "center");
  await page.setInputFiles('[data-testid="wc-image-input"]', pngFile);
  await page.waitForSelector(".wc-page img");
  await page.getByRole("button", { name: "Add page", exact: true }).tap();
  await page.keyboard.type("On page two");
  await page.getByRole("button", { name: "Save now", exact: true }).tap();
  await page.waitForSelector('[data-dock-status="saved"]');
  await page.reload();
  await page.waitForSelector(".wc-page");
  assert.match(await body(page).innerText(), /My heading[\s\S]*Body text for the phone[\s\S]*On page two/);
  assert.equal(await page.getByLabel("Document name").inputValue(), "Phone draft");
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Word (.docx)", exact: true }).tap();
  const dl = await waiting;
  const file = path.join(work, "phone-" + Date.now() + ".docx");
  await dl.saveAs(file);
  assert.equal(dl.suggestedFilename(), "Phone draft.docx");
  const docx = await readDocx(fs.readFileSync(file));
  assert.deepEqual(docx.errors, []);
  assert.deepEqual(docx.paragraphs.filter((x) => x.text).map((x) => x.text), ["My heading", "Body text for the phone", "On page two"]);
  assert.equal(docx.paragraphs.find((x) => x.text === "My heading").style, "Heading1");
  assert.equal(docx.paragraphs.find((x) => x.text === "Body text for the phone").align, "center");
  assert.equal(docx.paragraphs.find((x) => x.text === "Body text for the phone").runs[0].sizePt, 18);
  assert.equal(docx.paragraphs.find((x) => x.text === "On page two").pageBreakBefore, true);
  assert.equal(docx.paragraphs.flatMap((x) => x.runs).filter((r) => r.image).length, 1);
  await context.close();
});
await check("phone: navigation keys move the caret without stealing focus or typing anything", async () => {
  const { page, context } = await open({ viewport: { width: 390, height: 844 }, touch: true });
  await body(page).tap();
  await page.keyboard.type("first line");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second line");
  await page.getByRole("button", { name: "More formatting and insert options" }).tap();
  await page.getByRole("button", { name: "Show navigation keys" }).tap();
  await page.getByRole("button", { name: "Done" }).tap();
  const pad = page.getByTestId("wc-navpad");
  await pad.waitFor();
  const text = await body(page).innerText();
  const focusOk = () => page.evaluate(() => document.activeElement?.classList.contains("wc-page"));
  // The paragraph the caret is in and how many characters precede it there (independent of how the browser words the position).
  const at = () =>
    page.evaluate(() => {
      const r = getSelection().getRangeAt(0);
      const p = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer).closest("p");
      const pre = document.createRange();
      pre.selectNodeContents(p);
      pre.setEnd(r.startContainer, r.startOffset);
      return [p.textContent, pre.toString().length];
    });
  await pad.getByRole("button", { name: "Move up one line" }).tap();
  assert.equal((await at())[0], "first line");
  await pad.getByRole("button", { name: "Start of line" }).tap();
  assert.equal((await at())[1], 0);
  await pad.getByRole("button", { name: "Move right" }).tap();
  assert.equal((await at())[1], 1);
  await pad.getByRole("button", { name: "Move left" }).tap();
  assert.equal((await at())[1], 0);
  await pad.getByRole("button", { name: "End of line" }).tap();
  assert.equal((await at())[1], "first line".length);
  await pad.getByRole("button", { name: "Move down one line" }).tap();
  assert.equal((await at())[0], "second line");
  await pad.getByRole("button", { name: "Start of document" }).tap();
  await pad.getByRole("button", { name: "End of document" }).tap();
  assert.equal((await at())[0], "second line");
  assert.ok(await focusOk(), "the page keeps focus");
  assert.equal(await body(page).innerText(), text, "nothing was typed");
  await context.close();
});
await check("phone: the caret stays above the bottom bar and the keyboard area while typing near the bottom", async () => {
  const { page, context } = await open({ viewport: { width: 390, height: 520 }, touch: true });
  await body(page).tap();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.type(`Line ${i}`);
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const dock = document.querySelector(".wc-dock-wrap").getBoundingClientRect();
    const sel = getSelection().getRangeAt(0).getBoundingClientRect();
    return { caretBottom: sel.bottom, caretTop: sel.top, dockTop: dock.top, vh: window.innerHeight };
  });
  assert.ok(r.caretBottom <= r.dockTop + 1, `caret is above the bottom bar ${JSON.stringify(r)}`);
  assert.ok(r.caretTop >= 0, "and on screen");
  await context.close();
});

// ---- the Ask Me assistant around the editor ------------------------------------------------------------------------------
await check("assistant: the launcher is always there, never covers the editor's controls, and the panel survives menus and navigation", async () => {
  for (const [vw, vh, touch] of [[1280, 900, false], [390, 844, true]]) {
    const { page, context } = await open({ viewport: { width: vw, height: vh }, touch });
    const launcher = page.locator("[data-assistant-launcher]");
    await launcher.waitFor();
    assert.equal(await page.locator("[data-assistant-launcher]").count(), 1, "exactly one launcher");
    await type(page, "selected text");
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(400);
    const lb = await launcher.boundingBox();
    for (const name of ["Download Word (.docx)", "Save now", "Add page", "Insert image"]) {
      const b = await page.getByRole("button", { name, exact: true }).first().boundingBox();
      if (!b) continue;
      const overlap = lb.x < b.x + b.width && lb.x + lb.width > b.x && lb.y < b.y + b.height && lb.y + lb.height > b.y;
      assert.ok(!overlap, `${vw}px: the launcher does not cover "${name}" (${JSON.stringify({ lb, b })})`);
    }
    // Opening a formatting menu does not remove it, and it still opens the panel.
    await btn(page, vw > 800 ? "Page margins" : "Paragraph").click();
    assert.ok(await launcher.isVisible());
    await page.keyboard.press("Escape");
    await launcher.click();
    const panel = page.locator("[data-assistant-panel]");
    await panel.waitFor();
    assert.equal(await launcher.getAttribute("aria-expanded"), "true");
    assert.equal(await body(page).innerText(), "selected text", "the document is untouched");
    // Keyboard and screen readers: it is a labelled button and Escape closes the panel.
    assert.match((await launcher.getAttribute("aria-label")) ?? "", /assistant/i);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    assert.ok(await launcher.isVisible());
    await context.close();
  }
});
await check("assistant: it explains the new editor controls and links to the page", async () => {
  const { page } = await open();
  await page.route("**/api/assistant", (r) => (r.request().method() === "GET" ? r.fulfill({ json: { ai: false } }) : r.continue()));
  await page.locator("[data-assistant-launcher]").click();
  await page.locator("#assistant-input").fill("How do I insert a new page before the current page is full?");
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.locator('[data-assistant-panel] [role="log"] > div').last();
  await answer.getByText(/Add page/).first().waitFor();
  assert.match(await answer.innerText(), /page break/i);
  await page.locator("#assistant-input").fill("How do I change the page margins?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.locator('[data-assistant-panel] [role="log"]').getByText(/Narrow/).first().waitFor();
  assert.match(await page.locator('[data-assistant-panel] [role="log"] > div').last().innerText(), /Normal, Narrow, Moderate or Wide/);
});

await check("signature: Add signature (draw, type or upload) places a transparent PNG that exports into the .docx", async () => {
  const { page } = await open();
  await type(page, "Yours sincerely,");
  await page.keyboard.press("Enter");
  await btn(page, "Add signature").click();
  const dialog = page.getByRole("dialog", { name: "Add signature" });
  await dialog.waitFor();
  // Drawing: a stroke on the pad.
  const pad = dialog.getByLabel("Signature drawing area");
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.6 - Math.sin(i) * 0.2), { steps: 2 });
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await dialog.waitFor({ state: "detached" });
  const img = body(page).locator("img[alt='Signature']");
  await img.waitFor();
  assert.match(await img.getAttribute("src"), /^data:image\/png;base64,/);
  // Typing works too, and the picture controls (width, alignment) apply to it.
  await btn(page, "Add signature").click();
  await dialog.waitFor();
  await dialog.getByRole("tab", { name: "Type" }).click();
  await dialog.getByPlaceholder("Type your name").fill("A. Writer");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await body(page).locator("img[alt='Signature']").count(), 2);
  await body(page).locator("img[alt='Signature']").first().click();
  await page.getByRole("button", { name: "50% width" }).click();
  await btn(page, "Align right").click();
  // Cancelling inserts nothing, and Escape closes the dialog.
  await btn(page, "Add signature").click();
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await body(page).locator("img[alt='Signature']").count(), 2);
  const { docx } = await download(page);
  const pics = docx.paragraphs.flatMap((p) => p.runs.filter((r) => r.image).map((r) => ({ ...r.image, align: p.align })));
  assert.equal(pics.length, 2);
  for (const pic of pics) {
    assert.equal(pic.descr, "Signature");
    assert.match(docx.names.find((n) => n === "word/" + pic.target), /\.png$/);
    assert.deepEqual(Array.from(docx.media["word/" + pic.target].slice(1, 4)), [0x50, 0x4e, 0x47], "real PNG bytes");
  }
  assert.ok(pics.some((p) => p.align === "right"), "the right-aligned signature is right-aligned in Word");
  assert.equal(docx.paragraphs[0].text, "Yours sincerely,");
});
await check("download: a real .docx whose text, order, formatting, list, link and picture match what was written", async () => {
  const { page } = await open();
  await page.getByLabel("Document name").fill('Q3 plan: a/b*c?');
  await type(page, "Café & <b>tags</b> 日本語");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Heading here");
  await page.getByLabel("Paragraph style").selectOption("h2");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Bullet");
  await btn(page, "Bulleted list").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("linked");
  await page.keyboard.press("Shift+Home");
  await btn(page, "Link").click();
  await page.getByLabel("Web address").fill("example.com");
  await page.getByRole("button", { name: "Add link" }).click();
  // Tiptap hands focus back to the page on the next frame; wait for it, or End goes to the closing panel and the picture
  // below would replace the still-selected link text.
  await page.waitForFunction(() => document.activeElement?.classList.contains("wc-page"));
  await page.keyboard.press("End");
  // Wait until the key has really collapsed the selection, so the picture goes after the link and does not replace it.
  await page.waitForFunction(() => getSelection()?.isCollapsed === true);
  await page.setInputFiles('[data-testid="wc-image-input"]', pngFile);
  await page.waitForSelector(".wc-page img");
  const { name, docx } = await download(page);
  assert.equal(name, "Q3 plan a b c.docx");
  assert.deepEqual(docx.errors, []);
  const paras = docx.paragraphs;
  assert.equal(paras[0].text, "Café & <b>tags</b> 日本語");
  assert.equal(paras[1].text, "Heading here");
  assert.equal(paras[1].style, "Heading2");
  assert.equal(paras[2].text, "Bullet");
  assert.ok(paras[2].numId !== null);
  const link = paras.flatMap((p) => p.runs).find((r) => r.link);
  assert.equal(link.text, "linked");
  assert.equal(link.link.target, "https://example.com");
  const pic = paras.flatMap((p) => p.runs).find((r) => r.image);
  assert.equal(sha(docx.media["word/" + pic.image.target]), sha(png.buf));
  assert.equal(pic.image.widthPx, 602 < 640 ? 602 : 640);
  assert.deepEqual(docx.page, { width: 11906, height: 16838, margins: [1440, 1440, 1440, 1440] });
});
await check("download: an empty document still downloads as a valid .docx named Untitled Document.docx", async () => {
  const { page } = await open();
  const { name, docx } = await download(page);
  assert.equal(name, "Untitled Document.docx");
  assert.deepEqual(docx.errors, []);
});

// ---- saving and recovery --------------------------------------------------------------------------------------------------------
await check("autosave restores text and pictures after a reload, and says Saved only after saving", async () => {
  const { page, context } = await open();
  await page.getByLabel("Document name").fill("Draft title");
  await type(page, "Remember me");
  assert.notEqual(await page.locator("[data-save-status]").getAttribute("data-save-status"), "saved");
  await page.setInputFiles('[data-testid="wc-image-input"]', pngFile);
  await page.waitForSelector(".wc-page img");
  await savedStatus(page);
  await page.reload();
  await page.waitForSelector(".wc-page");
  assert.match(await body(page).innerText(), /Remember me/);
  assert.equal(await page.getByLabel("Document name").inputValue(), "Draft title");
  assert.equal(await body(page).locator("img").count(), 1);
  assert.match(await body(page).locator("img").getAttribute("src"), /^data:image\/png/);
  await context.close();
});
await check("save failure and full storage are reported, never shown as Saved", async () => {
  const { page } = await open({
    init: () => {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException("full", "QuotaExceededError");
      };
    },
  });
  await type(page, "will not fit");
  await page.waitForSelector('[data-save-status="error"]', { timeout: 8000 });
  assert.match(await page.locator("[data-save-status]").innerText(), /Save failed.*no room/i);
  assert.equal(await page.locator('[data-save-status="saved"]').count(), 0);
  assert.ok(await btn(page, "Download Word (.docx)").isEnabled());
  const { docx } = await download(page);
  assert.equal(docx.paragraphs[0].text, "will not fit");
});
await check("without IndexedDB the localStorage fallback still recovers the draft", async () => {
  const init = () => Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
  const { page } = await open({ init });
  await type(page, "fallback text");
  await savedStatus(page);
  await page.reload();
  await page.waitForSelector(".wc-page");
  assert.match(await body(page).innerText(), /fallback text/);
});
await check("New document starts blank and keeps the earlier draft under My drafts", async () => {
  const { page } = await open();
  await page.getByLabel("Document name").fill("Old one");
  await type(page, "old words");
  await btn(page, "New document").click();
  await page.waitForFunction(() => document.querySelector(".wc-page")?.textContent === "");
  assert.equal(await page.getByLabel("Document name").inputValue(), "Untitled Document");
  await btn(page, "My drafts").click();
  const row = page.locator("[data-draft-id]", { hasText: "Old one" });
  await row.waitFor({ timeout: 5000 });
  await row.getByRole("button", { name: "Open" }).click();
  await page.waitForFunction(() => /old words/.test(document.querySelector(".wc-page")?.textContent ?? ""));
  assert.equal(await page.getByLabel("Document name").inputValue(), "Old one");
});
await check("a damaged draft is reported and does not break the page", async () => {
  const { page } = await open();
  await type(page, "good");
  await savedStatus(page);
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("freepdfscanner-word-creator");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["drafts", "meta"], "readwrite");
          tx.objectStore("drafts").put({ id: "bad", title: "Broken", updatedAt: 1, content: { nope: true }, imageIds: [] });
          tx.objectStore("meta").put({ key: "last", value: "bad" });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.waitForSelector(".wc-page");
  await page.waitForSelector('.notice[role="alert"]');
  assert.match(await page.locator('.notice[role="alert"]').innerText(), /could not be read/);
  assert.equal((await body(page).innerText()).trim(), "");
  await btn(page, "My drafts").click();
  await page.locator("[data-draft-id]", { hasText: "damaged" }).waitFor({ timeout: 5000 });
});
await check("leaving with unsaved changes asks first", async () => {
  const { page } = await open({ init: () => { IDBObjectStore.prototype.put = function () { throw new DOMException("full", "QuotaExceededError"); }; } });
  await type(page, "unsaved");
  await page.waitForSelector('[data-save-status="error"]', { timeout: 8000 });
  let kind = null;
  page.on("dialog", async (d) => {
    kind = d.type();
    await d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(kind, "beforeunload");
});

// ---- layouts and themes -----------------------------------------------------------------------------------------------------------
await check("phone layout: no sideways page scroll, whole page fits, typing and toolbar work", async () => {
  const { page } = await open({ viewport: { width: 390, height: 844 }, touch: true });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(m.sw <= m.iw + 1, JSON.stringify(m));
  const box = await page.locator(".wc-scaled").boundingBox();
  assert.ok(box.width <= 390, "page fits width: " + box.width);
  await type(page, "mobile text");
  await btn(page, "Bold (Ctrl+B)").click();
  assert.match(await body(page).innerText(), /mobile text/);
});
await check("dark theme: the desk follows the theme and the paper stays white with black text", async () => {
  const { page } = await open({ theme: "dark" });
  await type(page, "paper");
  const c = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    paper: getComputedStyle(document.querySelector(".wc-page")).backgroundImage,
    ink: getComputedStyle(document.querySelector(".wc-page p")).color,
    desk: getComputedStyle(document.querySelector(".wc-desk")).backgroundColor,
  }));
  assert.equal(c.theme, "dark");
  assert.match(c.paper, /255, 255, 255/);
  assert.equal(c.ink, "rgb(0, 0, 0)");
  assert.notEqual(c.desk, "rgb(255, 255, 255)");
});

// ---- nothing else broke ---------------------------------------------------------------------------------------------------------------
await check("existing pages still load without errors (home, scan, convert, tools, edit image)", async () => {
  const { page, problems } = await open();
  for (const p of ["/", "/scan", "/convert", "/tools", "/tools/edit-image", "/convert/pdf-to-word"]) {
    const r = await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    assert.ok(r.ok(), p + " " + r.status());
    await page.waitForTimeout(400);
  }
  assert.deepEqual(problems, []);
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
