// End-to-end check of Print in a real browser. Drives headless Chrome/Edge over the
// DevTools protocol: opens the app, uploads real files, presses Print, and then
// captures what the browser would actually print (Page.printToPDF applies the
// @media print CSS, exactly like the print dialog's preview) and inspects it.
//
// window.print() itself is stubbed, because a headless browser has no dialog: the
// stub records what was in the page at the moment it was called.
//
// Needs the app running (npm run build && npm run start). Run:
//   node tests/print/verify.mjs [baseUrl]        (default http://localhost:3000)
// Set CHROME to a browser executable to override the auto-detected one.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const BASE = process.argv[2] ?? "http://localhost:3000";
const { createCanvas } = require("@napi-rs/canvas");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "print-verify-"));
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });

const CHROME = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found. Set CHROME to a browser executable.");

// ---- fixtures --------------------------------------------------------------------------

const MAGENTA = rgb(0.85, 0, 0.6);
async function pdfWithPages(name, sizes) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  sizes.forEach(([w, h], i) => {
    const page = pdf.addPage([w, h]);
    // A frame just inside the page edge: if any edge is cropped or shifted it shows.
    page.drawRectangle({ x: 6, y: 6, width: w - 12, height: h - 12, borderColor: MAGENTA, borderWidth: 4 });
    page.drawText(`PAGE ${i + 1}`, { x: 40, y: h - 90, size: 48, font });
    page.drawText("The quick brown fox jumps over the lazy dog.", { x: 40, y: h - 140, size: 14, font });
  });
  const file = path.join(work, name);
  fs.writeFileSync(file, await pdf.save());
  return file;
}
const A4 = [595, 842];
const A4L = [842, 595];
const LETTER = [612, 792];
const A5 = [420, 595];

function jpegWithFrame(name, w, h, label) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f2ec";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#222";
  ctx.font = `${Math.round(w / 14)}px Arial`;
  ctx.fillText(label, w * 0.1, h * 0.2);
  ctx.strokeStyle = "#d90099";
  ctx.lineWidth = Math.round(w / 100);
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - 2 * ctx.lineWidth, h - 2 * ctx.lineWidth);
  const file = path.join(work, name);
  fs.writeFileSync(file, canvas.toBuffer("image/jpeg", 90));
  return file;
}

const fixtures = {
  onePage: await pdfWithPages("one-page.pdf", [A4]),
  multi: await pdfWithPages("multi-page.pdf", [A4, A4, A4L, LETTER, A5]),
  scan: jpegWithFrame("scan.jpg", 1700, 2400, "SCANNED PAGE"),
  photo: jpegWithFrame("photo.jpg", 2000, 1400, "PHOTO"),
  docx: path.join(root, "tests/compress/out/survey.docx"),
  xlsx: path.join(root, "tests/compress/out/sales.xlsx"),
  bigPdf: path.join(root, "tests/compress/out/scan.pdf"),
};

// ---- CDP -------------------------------------------------------------------------------

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, "profile")}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("browser did not start");
}
const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") consoleErrors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, what, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__events = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, init) => { try { if (String(url).includes('track-analytics')) window.__events.push(JSON.parse(init.body)); } catch {} return realFetch(url, init); };
    window.__printCalls = [];
    window.print = () => {
      const root = document.querySelector('.print-root:not([data-suspended])');
      window.__printCalls.push({
        pages: root ? [...root.querySelectorAll('.print-page')].map((s) => { const i = s.querySelector('img'); return { w: i.naturalWidth, h: i.naturalHeight, orientation: s.dataset.orientation, sized: s.dataset.sized === 'true', head: i.src.slice(0, 22), len: i.src.length }; }) : null,
        title: document.title,
      });
      window.dispatchEvent(new Event('beforeprint'));
    };
  `,
});

async function open(route, { width = 1280, height = 900, mobile = false } = {}) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Page.navigate", { url: BASE + route });
  await waitFor(`document.readyState === 'complete' && document.querySelector('main')`, `${route} to load`);
  await sleep(600);
}
async function setFiles(files) {
  const { result } = await send("Runtime.evaluate", { expression: `document.querySelector('input[type=file]')` });
  await send("DOM.setFileInputFiles", { files, objectId: result.objectId });
}
const clickButton = (text, exact = true) => {
  const test = exact ? `b.innerText.trim() === ${JSON.stringify(text)}` : `b.innerText.includes(${JSON.stringify(text)})`;
  return evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => ${test}); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
};
const printCalls = () => evaluate("window.__printCalls");
const printEvents = () => evaluate("window.__events.filter(e => e.properties && e.properties.feature === 'print')");

// ---- print-output analysis ---------------------------------------------------------------

async function printToPdf(paper = [8.27, 11.69]) {
  const { data } = await send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true, paperWidth: paper[0], paperHeight: paper[1] });
  return Buffer.from(data, "base64");
}

// Renders every page of the printed PDF and reports what is on it.
async function inspect(pdfBytes, label) {
  fs.writeFileSync(path.join(outDir, `${label}.pdf`), pdfBytes);
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items.map((i) => i.str).join("").trim();
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    // The magenta frame drawn on every fixture: it is present on a side when a good share
    // of that side's first few pixels are magenta (tolerant of JPEG blur and resampling).
    const magenta = (x, y) => { const i = (y * width + x) * 4; return data[i] > 150 && data[i] - data[i + 1] > 80 && data[i + 2] > 70; };
    const share = (points) => points.filter(([x, y]) => magenta(x, y)).length / Math.max(1, points.length);
    const band = 8;
    const frame = { left: false, right: false, top: false, bottom: false };
    if (x1 >= 0) {
      const ys = Array.from({ length: y1 - y0 + 1 }, (_, k) => y0 + k);
      const xs = Array.from({ length: x1 - x0 + 1 }, (_, k) => x0 + k);
      const anyBand = (side) => {
        for (let d = 0; d < band; d++) {
          const pts = side === "left" ? ys.map((y) => [x0 + d, y]) : side === "right" ? ys.map((y) => [x1 - d, y]) : side === "top" ? xs.map((x) => [x, y0 + d]) : xs.map((x) => [x, y1 - d]);
          if (share(pts) > 0.5) return true;
        }
        return false;
      };
      for (const side of Object.keys(frame)) frame[side] = anyBand(side);
    }
    pages.push({
      n, w: Math.round(vp.width), h: Math.round(vp.height), text, blank: x1 < 0,
      box: x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1, left: x0, top: y0, right: width - 1 - x1, bottom: height - 1 - y1 },
      frame,
    });
  }
  await task.destroy();
  return pages;
}
async function renderFirstPage(file) {
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  await task.destroy();
  return { data: img.data, width: canvas.width, height: canvas.height, png: canvas.toBuffer("image/png") };
}
const summary = (pages) => pages.map((p) => `${p.w}x${p.h}pt${p.box ? ` content ${p.box.w}x${p.box.h} margins L${p.box.left} R${p.box.right} T${p.box.top} B${p.box.bottom}` : " BLANK"}`).join("; ");

const MM6 = (6 / 25.4) * 72; // the inner margin, in points (~17pt)
// Every page: not blank, no UI text, nothing cropped (all four frame edges present), and
// a margin of at least ~4 mm on all sides.
function assertClean(pages, count, what, { frame = true } = {}) {
  assert.equal(pages.length, count, `${what}: expected ${count} printed pages, got ${pages.length}`);
  for (const p of pages) {
    assert.ok(!p.blank, `${what}: page ${p.n} is blank`);
    assert.equal(p.text, "", `${what}: page ${p.n} contains text (${p.text.slice(0, 40)}); the app UI leaked into the print`);
    if (frame) assert.ok(p.frame.left && p.frame.right && p.frame.top && p.frame.bottom, `${what}: page ${p.n} is cropped (frame edges ${JSON.stringify(p.frame)})`);
    const m = Math.min(p.box.left, p.box.right, p.box.top, p.box.bottom);
    assert.ok(m >= MM6 * 0.6, `${what}: page ${p.n} margin ${m}pt is too small`);
  }
}
// The printed content must keep the source aspect ratio.
function assertAspect(page, w, h, what) {
  const printed = page.box.w / page.box.h;
  assert.ok(Math.abs(printed / (w / h) - 1) < 0.02, `${what}: aspect ${printed.toFixed(3)} vs source ${(w / h).toFixed(3)}`);
}
// A picture that went through the workspace (crop, enhancement) has no reliable frame, so
// check the geometry instead: it must be the largest fit of its own shape inside the
// sheet's printable area: not cropped, not stretched, not left small.
function assertContainFit(page, w, h, what) {
  const availW = page.w - 2 * MM6;
  const availH = page.h - 2 * MM6;
  const scale = Math.min(availW / w, availH / h);
  const ew = w * scale;
  const eh = h * scale;
  assert.ok(Math.abs(page.box.w / ew - 1) < 0.04 && Math.abs(page.box.h / eh - 1) < 0.04, `${what}: printed ${page.box.w}x${page.box.h}pt but the best fit is ${Math.round(ew)}x${Math.round(eh)}pt`);
}
// The content should use the sheet, not sit small in a corner.
function assertFills(page, what, minFraction = 0.85) {
  const availW = page.w - 2 * MM6;
  const availH = page.h - 2 * MM6;
  const fit = Math.max(page.box.w / availW, page.box.h / availH);
  assert.ok(fit >= minFraction, `${what}: content only fills ${(fit * 100).toFixed(0)}% of the printable area`);
}

// ---- runner ----------------------------------------------------------------------------

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.message.split("\n").slice(0, 3).join("\n      ")}`);
  }
}
const log = (s) => console.log(`      ${s}`);

async function scanAndPrint(files, expectedPages, { route = "/scan", waitFn, label }) {
  await open(route);
  await setFiles(files);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(${expectedPages} page/.test(b.innerText) && !b.disabled)`, `${expectedPages} page(s) to finish`, 90000);
  await sleep(500);
  if (waitFn) await waitFn();
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print to be requested", 60000);
  const call = (await printCalls())[0];
  const pdf = await printToPdf();
  const pages = await inspect(pdf, label);
  return { call, pages };
}

console.log(`Print verification against ${BASE} using ${path.basename(CHROME)}`);

console.log("Desktop (1280 wide)");

await test("scanned document (image): one sheet, page fills the sheet, aspect kept, nothing cropped, no UI", async () => {
  const { call, pages } = await scanAndPrint([fixtures.scan], 1, { label: "scan" });
  log(summary(pages));
  assert.equal(call.pages.length, 1, "one print page handed to window.print");
  assertClean(pages, 1, "scan", { frame: false });
  assertContainFit(pages[0], call.pages[0].w, call.pages[0].h, "scan");
  assert.equal(pages[0].h > pages[0].w, true, "portrait scan on a portrait sheet");
});

await test("image (landscape photo): sheet turns landscape, fills, aspect kept", async () => {
  const { call, pages } = await scanAndPrint([fixtures.photo], 1, { label: "photo" });
  log(summary(pages));
  assertClean(pages, 1, "photo", { frame: false });
  assertContainFit(pages[0], call.pages[0].w, call.pages[0].h, "photo");
  assert.ok(pages[0].w > pages[0].h, "landscape image gets a landscape sheet");
});

await test("one-page PDF: one A4 sheet at its real size, frame intact", async () => {
  const { call, pages } = await scanAndPrint([fixtures.onePage], 1, { label: "one-page" });
  log(summary(pages));
  assert.equal(call.pages.length, 1);
  assertClean(pages, 1, "one-page");
  assertAspect(pages[0], A4[0], A4[1], "one-page");
  assert.ok(Math.abs(pages[0].w - 595) <= 3 && Math.abs(pages[0].h - 842) <= 3, `sheet is ${pages[0].w}x${pages[0].h}, expected A4`);
});

await test("multi-page PDF: every page printed in order, each keeps its own orientation and shape", async () => {
  const { call, pages } = await scanAndPrint([fixtures.multi], 5, { label: "multi" });
  log(summary(pages));
  assert.equal(call.pages.length, 5);
  assert.deepEqual(call.pages.map((p) => p.orientation), ["portrait", "portrait", "landscape", "portrait", "portrait"]);
  assertClean(pages, 5, "multi");
  const src = [A4, A4, A4L, LETTER, A5];
  pages.forEach((p, i) => assertAspect(p, src[i][0], src[i][1], `multi page ${i + 1}`));
  assert.ok(pages[2].w > pages[2].h, "page 3 (landscape) printed on a landscape sheet");
  assert.ok(pages[0].w < pages[0].h, "page 1 printed on a portrait sheet");
  // Pages opened in the scanner workspace are pictures without a physical size, so they are
  // fitted to the sheet, exactly as the workspace's own "Create PDF" places them.
  assertFills(pages[4], "A5 page in the workspace");
});

await test("PDF printed directly (Compress result): every page keeps its TRUE size, shrunk only when too big", async () => {
  await open("/tools/compress-pdf");
  await setFiles([fixtures.multi]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Compress PDF')`, "ready", 30000);
  await clickButton("Compress PDF");
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Download (compressed|original)/.test(b.innerText))`, "result", 60000);
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print", 60000);
  const call = (await printCalls())[0];
  const pages = await inspect(await printToPdf(), "true-size");
  log(summary(pages));
  assert.equal(call.pages.length, 5);
  assert.ok(call.pages.every((p) => p.sized), "PDF pages carry their real size");
  assert.deepEqual(call.pages.map((p) => p.orientation), ["portrait", "portrait", "landscape", "portrait", "portrait"]);
  assertClean(pages, 5, "true size");
  // A5 (420x595pt) is smaller than the sheet, so it prints at 420pt wide, not stretched to fill.
  assert.ok(Math.abs(pages[4].box.w - 420) <= 8 && Math.abs(pages[4].box.h - 595) <= 8, `A5 printed ${pages[4].box.w}x${pages[4].box.h}, expected 420x595`);
  // A4 and Letter don't fit inside the margin, so they shrink slightly, keeping their shape.
  assertAspect(pages[0], 595, 842, "A4");
  assertAspect(pages[3], 612, 792, "Letter");
  assertAspect(pages[2], 842, 595, "A4 landscape");
  assert.ok(pages[2].w > pages[2].h);
});

await test("Word document (uploaded, converted to PDF on import): every page prints", async () => {
  await open("/scan");
  await setFiles([fixtures.docx]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(\\d+ page/.test(b.innerText) && !b.disabled)`, "Word import", 120000);
  await sleep(500);
  const count = Number(await evaluate(`document.body.innerText.match(/Create PDF \\((\\d+) page/)[1]`));
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print");
  const pages = await inspect(await printToPdf(), "word");
  log(`${count} pages in workspace -> ${summary(pages)}`);
  assert.equal(pages.length, count);
  for (const p of pages) { assert.equal(p.text, ""); assert.ok(!p.blank); }
});

await test("edited scan: a rotation made in the page editor is what prints, via Print this page", async () => {
  await open("/scan");
  await setFiles([fixtures.scan]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "scan", 60000);
  // Open the page editor and rotate right.
  await evaluate(`document.querySelector('[aria-label*="Edit page"], button[aria-label*="page 1"], ul button, li button')?.click()`);
  await waitFor(`document.querySelector('[role=dialog][aria-label="Edit page 1"]')`, "page editor");
  await clickButton("Rotate right", false).catch(() => evaluate(`document.querySelector('[aria-label="Rotate right"]').click()`));
  await sleep(2500);
  await waitFor(`!document.querySelector('[role=dialog]').innerText.includes('Processing')`, "rotate to finish", 30000);
  await clickButton("Print this page");
  await waitFor("window.__printCalls.length === 1", "print from the editor");
  const call = (await printCalls())[0];
  const pages = await inspect(await printToPdf(), "edited");
  log(`${summary(pages)}; image handed to print ${call.pages[0].w}x${call.pages[0].h}`);
  assert.equal(pages.length, 1);
  assert.ok(call.pages[0].w > call.pages[0].h, "the rotated (landscape) page is what prints");
  assert.ok(pages[0].w > pages[0].h, "sheet is landscape after rotating");
  assertClean(pages, 1, "edited", { frame: false });
  assertContainFit(pages[0], call.pages[0].w, call.pages[0].h, "edited");
});

await test("annotated page: text added with the Add text tool is flattened into what prints", async () => {
  await open("/tools/add-text");
  await setFiles([fixtures.scan]);
  await waitFor(`document.querySelector('[role=dialog][aria-label^="Annotate page"]')`, "annotator", 60000);
  const rect = await evaluate(`(() => { const r = document.querySelector('[role=application]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const px = rect.x + rect.w * 0.3;
  const py = rect.y + rect.h * 0.6;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: px, y: py, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px, y: py, button: "left", clickCount: 1 });
  await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "text box");
  await send("Input.insertText", { text: "PRINTED MARK 12345" });
  await sleep(300);
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Done').click()`);
  await waitFor(`!document.querySelector('[role=dialog][aria-label^="Annotate page"]')`, "annotator to close");
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "workspace");
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print");
  const call = (await printCalls())[0];
  const pdf = await printToPdf();
  const pages = await inspect(pdf, "annotated");
  assert.equal(pages.length, 1);
  assert.equal(pages[0].text, "");
  assert.equal(call.pages[0].head, "data:image/jpeg;base64", "an annotated page is printed from its flattened image");
  // Against the same scan printed without the mark, a real patch of the sheet must differ.
  const plain = await renderFirstPage(path.join(outDir, "scan.pdf"));
  const marked = await renderFirstPage(path.join(outDir, "annotated.pdf"));
  fs.writeFileSync(path.join(outDir, "annotated.png"), marked.png);
  let differing = 0;
  for (let i = 0; i < plain.data.length; i += 4) if (Math.abs(plain.data[i] - marked.data[i]) > 60) differing++;
  log(`${differing} pixels differ from the un-annotated print`);
  assert.ok(differing > 300, "the text mark isn't in the printed page");
});

await test("converted document: Word -> PDF result prints", async () => {
  await open("/convert/word-to-pdf");
  await setFiles([fixtures.docx]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Download PDF')`, "conversion", 120000);
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print", 60000);
  const pages = await inspect(await printToPdf(), "converted-word");
  log(summary(pages));
  assert.ok(pages.length >= 1);
  for (const p of pages) { assert.equal(p.text, ""); assert.ok(!p.blank); }
  const ev = await printEvents();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].properties.source, "convert");
});

await test("converted document: Excel -> PDF result prints", async () => {
  await open("/convert/excel-to-pdf");
  await setFiles([fixtures.xlsx]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Convert to PDF' && !b.disabled)`, "workbook", 30000);
  await clickButton("Convert to PDF");
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Download PDF')`, "conversion", 60000);
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print", 60000);
  const pages = await inspect(await printToPdf(), "converted-excel");
  log(summary(pages));
  assert.ok(pages.length >= 1);
  for (const p of pages) { assert.equal(p.text, ""); assert.ok(!p.blank); }
});

await test("compress result: a compressed PDF and a compressed image print", async () => {
  await open("/tools/compress-pdf");
  await setFiles([fixtures.bigPdf]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Compress PDF')`, "compress ready", 30000);
  await clickButton("Compress PDF");
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('Download compressed'))`, "compression", 90000);
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print", 60000);
  const pdfPages = await inspect(await printToPdf(), "compress-pdf");
  log(`pdf: ${summary(pdfPages)}`);
  assert.equal(pdfPages.length, 3);
  for (const p of pdfPages) assert.ok(!p.blank);

  await open("/tools/compress-image");
  await setFiles([fixtures.photo]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Compress image')`, "image ready", 30000);
  await clickButton("Compress image");
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Download (compressed|original)/.test(b.innerText))`, "image compression", 60000);
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print", 30000);
  const imgPages = await inspect(await printToPdf(), "compress-image");
  log(`image: ${summary(imgPages)}`);
  assertClean(imgPages, 1, "compressed image");
  assertFills(imgPages[0], "compressed image");
});

await test("Letter paper: the same multi-page PDF prints cleanly on US Letter", async () => {
  await open("/scan");
  await setFiles([fixtures.multi]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(5 page/.test(b.innerText) && !b.disabled)`, "import", 90000);
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print");
  const pages = await inspect(await printToPdf([8.5, 11]), "multi-letter");
  log(summary(pages));
  assertClean(pages, 5, "multi on Letter");
  assert.ok(Math.abs(pages[0].w - 612) <= 3 && Math.abs(pages[0].h - 792) <= 3, `portrait sheet is ${pages[0].w}x${pages[0].h}`);
});

console.log("Existing actions still work next to Print");

await test("Create PDF -> Download PDF still saves a PDF, and Print, Save and Start new scan sit beside it", async () => {
  await open("/scan");
  await setFiles([fixtures.multi]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(5 page/.test(b.innerText) && !b.disabled)`, "import", 90000);
  await evaluate(`window.__downloads = []; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push({ name: this.download, href: this.href }); return; } return oc.call(this); }`);
  await clickButton("Create PDF", false);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Download PDF')`, "PDF creation", 60000);
  const labels = await evaluate(`[...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => ['Print', 'Download PDF', 'Save to account', 'Start new scan'].includes(t))`);
  assert.deepEqual(labels.sort(), ["Download PDF", "Print", "Save to account", "Start new scan"]);
  await clickButton("Download PDF");
  const size = await evaluate(`(async () => { const d = window.__downloads[0]; const b = await (await fetch(d.href)).blob(); const head = new TextDecoder().decode(new Uint8Array(await b.arrayBuffer()).slice(0, 5)); return { name: d.name, size: b.size, head }; })()`);
  log(JSON.stringify(size));
  assert.equal(size.name, "document.pdf");
  assert.equal(size.head, "%PDF-");
  assert.ok(size.size > 10000);
  // Printing after creating the PDF still prints the pages, and one press is still one event.
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print");
  assert.equal((await printEvents()).length, 1);
});

console.log("Browser print command (Ctrl/Cmd+P, File > Print): only the open file");

const standing = "document.querySelector('.print-root[data-standing]')";
const armedReady = `(() => { const r = ${standing}; return r && !r.dataset.suspended && [...r.querySelectorAll('img')].every(i => i.complete && i.naturalWidth > 0); })()`;
const textOf = async (pages) => pages.map((p) => p.text).join(" ");

await test("no document open: the browser prints the page normally (never a blank sheet)", async () => {
  await open("/scan");
  await sleep(600);
  assert.equal(await evaluate("document.querySelectorAll('.print-root').length"), 0);
  assert.equal(await evaluate("document.documentElement.classList.contains('print-document')"), false);
  const pages = await inspect(await printToPdf(), "no-document");
  const text = await textOf(pages);
  log(`${pages.length} page(s), text: ${text.slice(0, 60)}`);
  assert.ok(pages.length >= 1 && !pages[0].blank);
  assert.match(text, /Scan, edit & sign a document/);
  await open("/");
  const home = await inspect(await printToPdf(), "no-document-home");
  assert.ok(!home[0].blank && (await textOf(home)).length > 20, "the home page prints its content");
});

await test("a scan is open: the browser's own print prints ONLY its pages, no Print button needed", async () => {
  await open("/scan");
  await setFiles([fixtures.multi]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(5 page/.test(b.innerText) && !b.disabled)`, "import", 90000);
  await waitFor(armedReady, "the document to be armed", 30000);
  const pages = await inspect(await printToPdf(), "browser-print-scan");
  log(summary(pages));
  assertClean(pages, 5, "browser print");
  assert.equal(await evaluate("window.__printCalls.length"), 0, "our button was never used");
});

await test("that browser print counts as ONE print event (source browser), even if the browser fires beforeprint twice", async () => {
  await evaluate("window.__events.length = 0");
  await evaluate("window.dispatchEvent(new Event('beforeprint')); window.dispatchEvent(new Event('beforeprint'))");
  await sleep(600);
  const ev = await printEvents();
  assert.equal(ev.length, 1, `expected 1 event, got ${ev.length}`);
  assert.equal(ev[0].properties.source, "browser");
  assert.equal(ev[0].properties.pageCount, 5);
  assert.deepEqual(Object.keys(ev[0].properties).sort(), ["feature", "pageCount", "source"]);
});

await test("the Print button does not also count as a browser print", async () => {
  await evaluate("window.__events.length = 0; window.__printCalls.length = 0");
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print");
  await sleep(600);
  const ev = await printEvents();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].properties.source, "scan");
});

await test("after a one-page job from the editor finishes, the browser print is the whole document again", async () => {
  await open("/scan");
  await setFiles([fixtures.multi]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(5 page/.test(b.innerText) && !b.disabled)`, "import", 90000);
  await waitFor(armedReady, "armed", 30000);
  await evaluate(`document.querySelector('ul button, li button').click()`);
  await waitFor(`document.querySelector('[role=dialog][aria-label="Edit page 1"]')`, "editor");
  await clickButton("Print this page");
  await waitFor("window.__printCalls.length === 1", "print");
  const during = await inspect(await printToPdf(), "job-during");
  assert.equal(during.length, 1, "while the job is running, only its page prints");
  await evaluate("window.dispatchEvent(new Event('afterprint'))");
  const after = await inspect(await printToPdf(), "job-after");
  log(`during: ${during.length} page, after: ${after.length} pages`);
  assert.equal(after.length, 5, "the open document is restored once the job is done");
  for (const p of after) assert.equal(p.text, "");
});

await test("editing changes what the browser prints: rotate in the editor and the armed pages follow", async () => {
  await open("/scan");
  await setFiles([fixtures.scan]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "scan", 60000);
  await waitFor(armedReady, "armed", 30000);
  assert.equal(await evaluate(`${standing}.querySelector('.print-page').dataset.orientation`), "portrait");
  await evaluate(`document.querySelector('ul button, li button').click()`);
  await waitFor(`document.querySelector('[role=dialog][aria-label="Edit page 1"]')`, "editor");
  await evaluate(`document.querySelector('[aria-label="Rotate right"]').click()`);
  await sleep(1500);
  await waitFor(`!document.querySelector('[role=dialog]').innerText.includes('Processing')`, "rotation", 30000);
  await waitFor(`${standing}.querySelector('.print-page').dataset.orientation === 'landscape' && ${armedReady}`, "armed pages to follow the edit", 30000);
  const pages = await inspect(await printToPdf(), "browser-print-edited");
  log(summary(pages));
  assertClean(pages, 1, "edited browser print", { frame: false });
  assert.ok(pages[0].w > pages[0].h, "the rotated (landscape) page is what prints");
});

await test("Ctrl+P pressed while the pages are still being prepared waits, then prints the document", async () => {
  await open("/scan");
  await setFiles([fixtures.multi]);
  // Poll fast, and press Ctrl+P the instant the workspace is ready, inside the preparation window.
  const prevented = await evaluate(`new Promise((resolve) => {
    const iv = setInterval(() => {
      const ready = [...document.querySelectorAll('button')].some(b => /Create PDF \\(5 page/.test(b.innerText) && !b.disabled);
      if (!ready) return;
      clearInterval(iv);
      const e = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true, bubbles: true });
      window.dispatchEvent(e);
      resolve(e.defaultPrevented);
    }, 5);
  })`);
  assert.equal(prevented, true, "the shortcut was held back until the pages were ready");
  await waitFor("window.__printCalls.length === 1", "print after preparing", 30000);
  const call = (await printCalls())[0];
  assert.equal(call.pages.length, 5, "it printed the whole open document");
  // With everything prepared, the shortcut is left to the browser.
  await sleep(500);
  const free = await evaluate(`(() => { const e = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true, bubbles: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
  assert.equal(free, false, "once armed, the browser's own print handles it");
});

await test("converted document: the browser print prints only the converted PDF", async () => {
  await open("/convert/word-to-pdf");
  await setFiles([fixtures.docx]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Download PDF')`, "conversion", 120000);
  await waitFor(armedReady, "armed", 60000);
  const pages = await inspect(await printToPdf(), "browser-print-word");
  log(summary(pages));
  assert.ok(pages.length >= 1);
  for (const p of pages) { assert.equal(p.text, ""); assert.ok(!p.blank); }
});

await test("compress result: the browser print prints only the file (PDF and image)", async () => {
  await open("/tools/compress-pdf");
  await setFiles([fixtures.bigPdf]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Compress PDF')`, "ready", 30000);
  await clickButton("Compress PDF");
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('Download compressed'))`, "compression", 90000);
  await waitFor(armedReady, "armed", 60000);
  const pdfPages = await inspect(await printToPdf(), "browser-print-compress-pdf");
  assert.equal(pdfPages.length, 3);
  for (const p of pdfPages) { assert.equal(p.text, ""); assert.ok(!p.blank); }
  await open("/tools/compress-image");
  await setFiles([fixtures.photo]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Compress image')`, "image ready", 30000);
  await clickButton("Compress image");
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Download (compressed|original)/.test(b.innerText))`, "image compression", 60000);
  await waitFor(armedReady, "armed", 30000);
  const imgPages = await inspect(await printToPdf(), "browser-print-compress-image");
  log(`pdf ${pdfPages.length} pages; image ${summary(imgPages)}`);
  assertClean(imgPages, 1, "compressed image, browser print");
});

await test("leaving the screen disarms it: the next page prints normally again", async () => {
  await open("/scan");
  await setFiles([fixtures.scan]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "scan", 60000);
  await waitFor(armedReady, "armed", 30000);
  await evaluate(`document.querySelector('a[href="/convert"]').click()`);
  await waitFor(`location.pathname === '/convert'`, "navigation");
  await sleep(500);
  assert.equal(await evaluate("document.querySelectorAll('.print-root').length"), 0, "no print container left behind");
  const pages = await inspect(await printToPdf(), "after-leaving");
  assert.match(await textOf(pages), /Convert/);
});

await test("start over (no pages left) disarms it too", async () => {
  await open("/scan");
  await setFiles([fixtures.scan]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "scan", 60000);
  await waitFor(armedReady, "armed", 30000);
  await evaluate(`document.querySelector('[aria-label="Remove page 1"]').click()`);
  await waitFor(`document.querySelectorAll('.print-root').length === 0`, "print container removed after the last page is removed", 15000);
  const pages = await inspect(await printToPdf(), "after-remove");
  assert.match(await textOf(pages), /Scan, edit & sign a document/);
});

console.log("Analytics and clean-up");

await test("one Print press = exactly one print analytics event; no printer/device data in it", async () => {
  await open("/scan");
  await setFiles([fixtures.multi]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(5 page/.test(b.innerText) && !b.disabled)`, "import", 90000);
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print");
  await sleep(800);
  // Pressing again while a job exists starts a NEW job (a second press is a second print).
  const ev = await printEvents();
  assert.equal(ev.length, 1, `expected 1 print event, got ${ev.length}`);
  assert.deepEqual(Object.keys(ev[0].properties).sort(), ["feature", "pageCount", "source"]);
  assert.equal(ev[0].properties.source, "scan");
  assert.equal(ev[0].properties.pageCount, 5);
  assert.equal(ev[0].event_name, "feature_used");
});

await test("the print container is removed after the browser reports the job finished", async () => {
  assert.equal(await evaluate("document.querySelectorAll('.print-root:not([data-standing])').length"), 1);
  await evaluate("window.dispatchEvent(new Event('afterprint'))");
  await sleep(10500);
  assert.equal(await evaluate("document.querySelectorAll('.print-root:not([data-standing])').length"), 0);
});

await test("a second press replaces the first job instead of stacking print containers", async () => {
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 2", "second print");
  assert.equal(await evaluate("document.querySelectorAll('.print-root:not([data-standing])').length"), 1);
  assert.equal((await printEvents()).length, 2, "two presses = two events, one each");
});

console.log("Unsupported browsers");

await test("no window.print: a clear message, no crash, no print event", async () => {
  await open("/scan");
  await setFiles([fixtures.scan]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "scan", 60000);
  await evaluate("window.print = undefined");
  await clickButton("Print");
  await waitFor(`[...document.querySelectorAll('[role=alert]')].some(a => a.innerText.includes("Printing isn't available in this browser"))`, "message");
  const text = await evaluate(`[...document.querySelectorAll('[role=alert]')].map(a => a.innerText).join('|')`);
  assert.equal(text, "Printing isn't available in this browser. Download the file and print it from your device.");
  assert.equal((await printEvents()).length, 0);
  // The rest of the page still works.
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b => /Create PDF/.test(b.innerText) && !b.disabled)`), true);
});

await test("a password-protected PDF gives a useful message and nothing else breaks", async () => {
  const { PDFString } = await import("pdf-lib");
  const locked = await PDFDocument.create();
  locked.addPage().drawText("secret");
  locked.context.trailerInfo.Encrypt = locked.context.register(locked.context.obj({ Filter: "Standard", V: 1, R: 2, O: PDFString.of("x".repeat(32)), U: PDFString.of("y".repeat(32)), P: -4 }));
  const file = path.join(work, "locked.pdf");
  fs.writeFileSync(file, await locked.save({ useObjectStreams: false }));
  // Reach the print path directly with a PDF blob pdf.js can't open: the compress tool refuses locked
  // files earlier, so use a corrupt-but-PDF-looking file through the workspace instead.
  await open("/scan");
  await setFiles([file]);
  await sleep(4000);
  const alerts = await evaluate(`[...document.querySelectorAll('[role=alert]')].map(a => a.innerText).join('|')`);
  log(`workspace says: ${alerts.replace(/\n.*$/, "")}`);
  assert.ok(alerts.length > 0, "the workspace refuses it with a message");
});

console.log("Mobile (375 wide)");

await test("375px: Print sits in the compact action row, is a 44px target, and nothing overflows", async () => {
  await open("/scan", { width: 375, height: 812, mobile: true });
  await setFiles([fixtures.multi]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(5 page/.test(b.innerText) && !b.disabled)`, "import", 120000);
  const geo = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Print'); const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, width: r.width, vw: innerWidth, scrollW: document.documentElement.scrollWidth }; })()`);
  log(JSON.stringify(geo));
  assert.ok(geo.height >= 44 && geo.width >= 44);
  assert.ok(geo.left >= 0 && geo.right <= geo.vw, "button within the viewport");
  assert.ok(geo.scrollW <= geo.vw, "no horizontal overflow");
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print");
  const pages = await inspect(await printToPdf(), "mobile-multi");
  log(summary(pages));
  assertClean(pages, 5, "mobile multi");
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Print').scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await send("Page.captureScreenshot", { format: "png" }).then((s) => fs.writeFileSync(path.join(outDir, "mobile-screen.png"), Buffer.from(s.data, "base64")));
});

await test("375px: the page editor's Print this page button is reachable", async () => {
  await open("/scan", { width: 375, height: 812, mobile: true });
  await setFiles([fixtures.scan]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "scan", 60000);
  await evaluate(`document.querySelector('ul button, li button').click()`);
  await waitFor(`document.querySelector('[role=dialog]')`, "editor");
  const geo = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Print this page'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, vw: innerWidth }; })()`);
  log(JSON.stringify(geo));
  assert.ok(geo.height >= 44 && geo.left >= 0 && geo.right <= geo.vw);
});

console.log("Screen output unchanged");

await test("on screen, nothing print-related is visible", async () => {
  await open("/scan");
  await setFiles([fixtures.scan]);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "scan", 60000);
  await clickButton("Print");
  await waitFor("window.__printCalls.length === 1", "print");
  const visible = await evaluate(`[...document.querySelectorAll('.print-root')].map(r => getComputedStyle(r).display)`);
  assert.ok(visible.length >= 1 && visible.every((d) => d === "none"), `print containers must be invisible on screen: ${visible}`);
});

await test("no console errors or exceptions during the whole run", async () => {
  // Third-party/network noise (e.g. blocked analytics) is not ours; anything mentioning print or an exception is.
  const ours = consoleErrors.filter((e) => e.startsWith("exception") || /print/i.test(e));
  if (consoleErrors.length) log(`(${consoleErrors.length} console error line(s) in total)`);
  assert.deepEqual(ours, [], ours.join("\n"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed && consoleErrors.length) console.log("console errors:\n  " + [...new Set(consoleErrors)].slice(0, 10).join("\n  "));
chrome.kill();
process.exit(failed === 0 ? 0 : 1);
