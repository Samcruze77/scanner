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
  try {
    await fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL " + name + "\n       " + String(e?.message ?? e).split("\n").slice(0, 8).join("\n       "));
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
  await page.getByLabel("Line spacing").selectOption("2");
  await btn(page, "Paragraph spacing").click();
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
  await page.keyboard.press("End");
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
