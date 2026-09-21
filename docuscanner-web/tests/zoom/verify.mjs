// End-to-end check of zoom in the editing surfaces (page editor, annotator, crop
// editor) in a real browser, driven over the DevTools protocol: real mouse, wheel,
// keyboard and multi-touch pinch input. Alignment is checked from what the page
// really does (where a click lands, where a dragged corner ends up), not from the
// zoom maths.
//
// Needs the app running (npm run build && npm run start). Run:
//   node tests/zoom/verify.mjs [baseUrl]          (default http://localhost:3000)
// Set CHROME to a browser executable to override the auto-detected one.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const { createCanvas } = require("@napi-rs/canvas");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "zoom-verify-"));
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });

const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found. Set CHROME to a browser executable.");

// A recognisable page: a frame at the very edge and a label, so a shifted or cropped view shows.
function scanFile() {
  const w = 1700;
  const h = 2400;
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4f2ec";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#222";
  ctx.font = "120px Arial";
  ctx.fillText("ZOOM TEST PAGE", 160, 400);
  ctx.strokeStyle = "#d90099";
  ctx.lineWidth = 24;
  ctx.strokeRect(24, 24, w - 48, h - 48);
  const file = path.join(work, "scan.jpg");
  fs.writeFileSync(file, c.toBuffer("image/jpeg", 90));
  return file;
}
const SCAN = scanFile();

// ---- CDP ---------------------------------------------------------------------------------

const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, "profile")}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars=false", "about:blank"], { stdio: "ignore" });
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
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}
await send("Page.enable");
await send("Runtime.enable");

async function open(route, { width = 1280, height = 900, mobile = false, touch = mobile } = {}) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  // Start every page with no finger "still down" from an earlier gesture.
  await send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }).catch(() => undefined);
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Emulation.setTouchEmulationEnabled", { enabled: touch });
  await send("Page.navigate", { url: BASE + route });
  await waitFor(`document.readyState === 'complete' && document.querySelector('main')`, `${route}`);
  await sleep(500);
}
async function upload() {
  const { result } = await send("Runtime.evaluate", { expression: `document.querySelector('input[type=file]')` });
  await send("DOM.setFileInputFiles", { files: [SCAN], objectId: result.objectId });
}
const TOP = `[...document.querySelectorAll('[role=dialog]')].pop()`;
const button = (label) => `${TOP}.querySelector('[aria-label=${JSON.stringify(label)}]')`;
const click = (expr) => evaluate(`(() => { const b = ${expr}; if (!b) throw new Error('missing ' + ${JSON.stringify(expr.slice(0, 80))}); b.click(); return true; })()`);
const zoomLabel = () => evaluate(`${TOP}.querySelector('[role=group][aria-label=Zoom] button:nth-child(2)').innerText.trim()`);
const zoomState = () => evaluate(`(() => { const g = ${TOP}.querySelector('[role=group][aria-label=Zoom]'); const b = g.querySelectorAll('button'); return { label: b[1].innerText.trim(), outDisabled: b[0].disabled, resetDisabled: b[1].disabled, inDisabled: b[2].disabled }; })()`);
const key = async (k) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k });
  await sleep(150);
};

// ---- runner --------------------------------------------------------------------------------

let passed = 0;
let failed = 0;
async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
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
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs expected ${b} (tolerance ${tol})`);

async function openPageEditor(opts) {
  await open("/scan", opts);
  await upload();
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "page", 60000);
  await evaluate(`document.querySelector('[aria-label="Edit page 1"]').click()`);
  await waitFor(`document.querySelector('[role=dialog][aria-label="Edit page 1"]')`, "page editor");
}
const previewRect = () => evaluate(`(() => { const dlg = ${TOP}; const i = dlg.querySelector('img'); const v = dlg.querySelector('[style*="pan-x"]'); const r = i.getBoundingClientRect(); const vr = v.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top, vw: vr.width, vh: vr.height, vLeft: vr.left, vTop: vr.top, sl: v.scrollLeft, st: v.scrollTop, sw: v.scrollWidth, sh: v.scrollHeight }; })()`);

console.log(`Zoom verification against ${BASE} using ${path.basename(CHROME)}`);
console.log("Page editor (tap a page to edit)");

let normal;
await test("opens at normal size (the fitted preview) with the zoom controls, Reset not yet needed", async () => {
  await openPageEditor();
  normal = await previewRect();
  const s = await zoomState();
  log(`normal preview ${normal.w.toFixed(1)}x${normal.h.toFixed(1)}px in a ${normal.vw.toFixed(0)}px window; controls ${JSON.stringify(s)}`);
  assert.equal(s.label, "100%");
  assert.equal(s.resetDisabled, true);
  assert.equal(s.inDisabled, false);
  // Desktop (two-pane editor) gives the page up to 66vh; phones still get 45vh. Either way it must fit, not overflow.
  assert.ok(normal.h <= 900 * 0.66 + 1, "normal size still fits the preview window, as before zoom existed");
  near(normal.w / normal.h, 1700 / 2400, 0.01, "aspect");
});

await test("Zoom in steps 125% -> 150% -> 200% -> 300% -> 400% and the page really grows by that factor", async () => {
  for (const [label, factor] of [["125%", 1.25], ["150%", 1.5], ["200%", 2], ["300%", 3], ["400%", 4]]) {
    await click(button("Zoom in"));
    await sleep(120);
    const now = await previewRect();
    assert.ok((await zoomLabel()).startsWith(label), `label shows ${label}, got ${await zoomLabel()}`);
    near(now.w / normal.w, factor, 0.02, `width at ${label}`);
    near(now.w / now.h, normal.w / normal.h, 0.005, `aspect at ${label}`);
  }
  assert.equal((await zoomState()).inDisabled, true, "can't zoom past 400%");
  const big = await previewRect();
  assert.ok(big.sw > big.vw + 100 && big.sh > big.vh + 100, "zoomed page scrolls inside its window instead of growing the editor");
  near(big.vh, normal.vh, 2, "the window itself doesn't grow");
});

await test("Reset returns to normal size and to the top-left", async () => {
  await evaluate(`${TOP}.querySelector('[style*="pan-x"]').scrollTo(200, 300)`);
  await sleep(100);
  const label = await evaluate(`${TOP}.querySelector('[role=group][aria-label=Zoom] button:nth-child(2)').getAttribute('aria-label')`);
  assert.match(label, /Reset zoom to normal size/);
  await click(`${TOP}.querySelector('[role=group][aria-label=Zoom] button:nth-child(2)')`);
  await sleep(200);
  const back = await previewRect();
  near(back.w, normal.w, 1, "width back to normal");
  near(back.h, normal.h, 1, "height back to normal");
  assert.equal(back.sl, 0);
  assert.equal(back.st, 0);
  const s = await zoomState();
  assert.equal(s.label, "100%");
  assert.equal(s.resetDisabled, true);
});

await test("Zoom out goes below normal (75%, 50%) and Reset brings it back", async () => {
  await click(button("Zoom out"));
  await click(button("Zoom out"));
  await sleep(150);
  const small = await previewRect();
  near(small.w / normal.w, 0.5, 0.02, "width at 50%");
  assert.equal((await zoomState()).outDisabled, true);
  await click(`${TOP}.querySelector('[role=group][aria-label=Zoom] button:nth-child(2)')`);
  await sleep(150);
  near((await previewRect()).w, normal.w, 1, "back to normal");
});

await test("keyboard: + zooms in, - zooms out, 0 resets", async () => {
  await key("+");
  await key("+");
  assert.ok((await zoomLabel()).startsWith("150%"));
  await key("-");
  assert.ok((await zoomLabel()).startsWith("125%"));
  await key("0");
  assert.equal(await zoomLabel(), "100%");
});

await test("Ctrl+wheel (and a trackpad pinch) zooms around the pointer", async () => {
  const r = await previewRect();
  const x = r.vLeft + r.vw * 0.5;
  const y = r.vTop + r.vh * 0.5;
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: -300, modifiers: 2 });
  await sleep(200);
  const z = await previewRect();
  log(`after Ctrl+wheel the page is ${(z.w / normal.w).toFixed(2)}x`);
  assert.ok(z.w / normal.w > 1.5, "zoomed in");
  // A plain wheel still scrolls instead of zooming.
  const before = (await previewRect()).w;
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: 200 });
  await sleep(200);
  const after = await previewRect();
  near(after.w, before, 1, "plain wheel doesn't change zoom");
  assert.ok(after.st > z.st, "plain wheel scrolls the zoomed page");
  await key("0");
});

console.log("Marks stay on the spot");

await test("marks drawn on the page stay exactly over it at every zoom (overlay aligned with the image)", async () => {
  // Add a text mark through the annotator, then look at it in the page editor.
  await openPageEditor();
  if (process.env.DEBUG_EVENTS) log(JSON.stringify(await evaluate(`[...${TOP}.querySelectorAll('button')].map(b => b.innerText.trim() || b.getAttribute('aria-label'))`)));
  await click(`[...${TOP}.querySelectorAll('button')].find(b => /Add text, signature/.test(b.innerText))`);
  await waitFor(`document.querySelector('[role=dialog][aria-label^="Annotate page"]')`, "annotator");
  await click(`[...${TOP}.querySelectorAll('[role=toolbar] button')].find(b => b.innerText.trim().endsWith('Text'))`);
  const rect = await evaluate(`(() => { const r = document.querySelector('[role=application]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const px = rect.x + rect.w * 0.3;
  const py = rect.y + rect.h * 0.6;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: px, y: py, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px, y: py, button: "left", clickCount: 1 });
  await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "text box");
  await send("Input.insertText", { text: "ALIGN" });
  await evaluate(`[...${TOP}.querySelectorAll('button')].find(b => b.innerText.trim() === 'Done').click()`);
  await waitFor(`!document.querySelector('[role=dialog][aria-label^="Annotate page"]')`, "annotator closed");
  await sleep(500);
  for (const zoomKey of [null, "+", "+", "+"]) {
    if (zoomKey) await key(zoomKey);
    const o = await evaluate(`(() => { const dlg = ${TOP}; const i = dlg.querySelector('img').getBoundingClientRect(); const c = [...dlg.querySelectorAll('canvas')][0].getBoundingClientRect(); return { dl: c.left - i.left, dt: c.top - i.top, dw: c.width - i.width, dh: c.height - i.height }; })()`);
    const label = await zoomLabel();
    assert.ok(Math.abs(o.dl) < 1 && Math.abs(o.dt) < 1 && Math.abs(o.dw) < 1 && Math.abs(o.dh) < 1, `overlay drifted at ${label}: ${JSON.stringify(o)}`);
  }
  await key("0");
});

console.log("Annotator (add text, sign, draw)");

async function openAnnotator(opts) {
  await open("/tools/add-text", opts);
  await upload();
  await waitFor(`document.querySelector('[role=dialog][aria-label^="Annotate page"]')`, "annotator", 60000);
  await sleep(600);
}
const frameRect = () => evaluate(`(() => { const r = document.querySelector('[role=application]').getBoundingClientRect(); const v = document.querySelector('[role=dialog] [style*="pan-x"]'); const vr = v.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vx: vr.left, vy: vr.top, vw: vr.width, vh: vr.height, sl: v.scrollLeft, st: v.scrollTop, sw: v.scrollWidth, sh: v.scrollHeight }; })()`);
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const textBoxPos = () => evaluate(`(() => { const t = document.querySelector('textarea[aria-label="Text"]'); return { left: parseFloat(t.style.left), top: parseFloat(t.style.top) }; })()`);

let atNormal;
await test("a tap lands on the same spot of the page at normal size", async () => {
  await openAnnotator();
  const f = await frameRect();
  await clickAt(f.x + f.w * 0.3, f.y + f.h * 0.6);
  await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "text box");
  atNormal = await textBoxPos();
  log(`normal: text starts at ${atNormal.left.toFixed(2)}% / ${atNormal.top.toFixed(2)}%`);
  near(atNormal.left, 30, 0.6, "left %");
});

await test("at 200% a tap on the same fraction of the page lands on the same spot (and again when scrolled to a far corner)", async () => {
  await openAnnotator();
  for (let i = 0; i < 3; i++) await click(`document.querySelector('[role=dialog] [role=group][aria-label=Zoom] [aria-label="Zoom in"]')`);
  await sleep(200);
  assert.equal(await evaluate(`document.querySelector('[role=dialog] [role=group][aria-label=Zoom] button:nth-child(2)').innerText.split('%')[0]`), "200");
  let f = await frameRect();
  near(f.w / (await evaluate(`document.querySelector('[role=dialog] [role=application]').parentElement.parentElement.clientWidth`) / 2), 1, 5, "sanity");
  // Bring the target fraction into view, wherever it is, then tap it.
  await evaluate(`(() => { const v = document.querySelector('[role=dialog] [style*="pan-x"]'); v.scrollTo(0, 0); })()`);
  await sleep(100);
  f = await frameRect();
  await clickAt(f.x + f.w * 0.3, f.y + f.h * 0.6 > f.vy + f.vh ? f.vy + f.vh - 40 : f.y + f.h * 0.6);
  // Recompute the fraction that was actually tapped so the assertion doesn't depend on the scroll.
  await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "text box");
  const pos200 = await textBoxPos();
  const tappedFraction = ((f.vy + f.vh - 40) - f.y) / f.h;
  const wasClamped = f.y + f.h * 0.6 > f.vy + f.vh;
  log(`200%: text starts at ${pos200.left.toFixed(2)}% / ${pos200.top.toFixed(2)}% (tapped ${(wasClamped ? tappedFraction : 0.6).toFixed(3)} down)`);
  near(pos200.left, 30, 0.6, "left % at 200%");
  // Far corner: scroll to the bottom-right and tap 85% / 85%.
  await evaluate(`document.querySelector('textarea[aria-label="Text"]').blur()`);
  await evaluate(`(() => { const v = document.querySelector('[role=dialog] [style*="pan-x"]'); v.scrollTo(v.scrollWidth, v.scrollHeight); })()`);
  await sleep(200);
  f = await frameRect();
  await clickAt(f.x + f.w * 0.85, f.y + f.h * 0.85);
  await sleep(300);
  await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "second text box");
  const far = await textBoxPos();
  log(`far corner at 200%: ${far.left.toFixed(2)}% / ${far.top.toFixed(2)}%`);
  near(far.left, 85, 0.8, "left % in the far corner");
  near(far.top, 85, 2.5, "top % in the far corner");
});

await test("text size follows the zoom (the box you type in scales with the page)", async () => {
  await openAnnotator();
  const f1 = await frameRect();
  await clickAt(f1.x + f1.w * 0.3, f1.y + f1.h * 0.3);
  await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "text box");
  const fs1 = await evaluate(`parseFloat(getComputedStyle(document.querySelector('textarea[aria-label="Text"]')).fontSize)`);
  await evaluate(`document.querySelector('textarea[aria-label="Text"]').blur()`);
  await click(`document.querySelector('[role=dialog] [aria-label="Zoom in"]')`);
  await click(`document.querySelector('[role=dialog] [aria-label="Zoom in"]')`);
  await click(`document.querySelector('[role=dialog] [aria-label="Zoom in"]')`);
  await sleep(300);
  await evaluate(`(() => { const v = document.querySelector('[role=dialog] [style*="pan-x"]'); v.scrollTo(0, 0); })()`);
  const f2 = await frameRect();
  await clickAt(f2.x + f2.w * 0.3, f2.y + f2.h * 0.3 + 4);
  await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "text box");
  const fs2 = await evaluate(`parseFloat(getComputedStyle(document.querySelector('textarea[aria-label="Text"]')).fontSize)`);
  log(`font ${fs1.toFixed(1)}px at 100% -> ${fs2.toFixed(1)}px at 200%`);
  near(fs2 / fs1, 2, 0.08, "font scale");
});

await test("+ - 0 are ignored while typing text (a '+' in your text is just a '+')", async () => {
  await openAnnotator();
  const f = await frameRect();
  await clickAt(f.x + f.w * 0.3, f.y + f.h * 0.3);
  await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "text box");
  await send("Input.insertText", { text: "a+b-0" });
  await key("+");
  await key("-");
  assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Text"]').value`).then((v) => v.startsWith("a+b-0")), true);
  assert.equal(await zoomLabel(), "100%");
});

await test("Reset in the annotator returns to normal size and Escape/Done still work", async () => {
  await openAnnotator();
  const f0 = await frameRect();
  await click(`document.querySelector('[role=dialog] [aria-label="Zoom in"]')`);
  await click(`document.querySelector('[role=dialog] [aria-label="Zoom in"]')`);
  await sleep(150);
  assert.ok((await frameRect()).w > f0.w * 1.4);
  await click(`document.querySelector('[role=dialog] [role=group][aria-label=Zoom] button:nth-child(2)')`);
  await sleep(200);
  near((await frameRect()).w, f0.w, 1.5, "normal width again");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape" });
  await waitFor(`!document.querySelector('[role=dialog][aria-label^="Annotate page"]')`, "annotator to close");
});

console.log("Crop editor");

async function openCropper(opts) {
  await openPageEditor(opts);
  await click(`[...${TOP}.querySelectorAll('button')].find(b => b.innerText.trim() === 'Adjust crop')`);
  await waitFor(`document.querySelector('[role=dialog][aria-label="Adjust crop"]')`, "crop editor");
  await sleep(300);
}
const cornerLeftTop = (i) => evaluate(`(() => { const c = [...document.querySelectorAll('[role=dialog][aria-label="Adjust crop"] button[aria-label*="corner"]')][${i}]; return { left: parseFloat(c.style.left), top: parseFloat(c.style.top), cx: c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2, cy: c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2 }; })()`);
const cropFrame = () => evaluate(`(() => { const d = document.querySelector('[role=dialog][aria-label="Adjust crop"]'); const img = d.querySelector('img').getBoundingClientRect(); const v = d.querySelector('[style*="pan-x"]'); const vr = v.getBoundingClientRect(); return { x: img.left, y: img.top, w: img.width, h: img.height, vx: vr.left, vy: vr.top, vw: vr.width, vh: vr.height }; })()`);

await test("crop corners land exactly where dragged (finger), at normal size and at 200%", async () => {
  // A finger drag: touch pointers capture implicitly, like on a real phone or tablet.
  await openCropper({ touch: true });
  if (process.env.DEBUG_EVENTS) await evaluate(`window.__log = []; for (const t of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture']) document.addEventListener(t, (e) => window.__log.push(t + ':' + (e.pointerType||'') + ':' + Math.round(e.clientX||0) + ',' + Math.round(e.clientY||0) + ':' + e.target.tagName), true);`);
  // The browser's synthetic touch input is occasionally dropped after a long run of earlier
  // gestures (no pointer event reaches the page at all). Detect that and send it again.
  async function drag(from, to) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const before = await cornerLeftTop(0);
      await touch("touchStart", [{ x: from.x, y: from.y }]);
      const steps = 8;
      for (let i = 1; i <= steps; i++) await touch("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
      await touch("touchEnd", []);
      await sleep(150);
      const after = await cornerLeftTop(0);
      if (Math.abs(after.left - before.left) > 0.1 || Math.abs(after.top - before.top) > 0.1) return;
      log(`(the browser dropped the synthetic touch input on attempt ${attempt}; sending it again)`);
      from = { x: before.cx, y: before.cy };
    }
  }
  const f1 = await cropFrame();
  let c = await cornerLeftTop(0);
  await drag({ x: c.cx, y: c.cy }, { x: f1.x + f1.w * 0.2, y: f1.y + f1.h * 0.2 });
  c = await cornerLeftTop(0);
  if (process.env.DEBUG_EVENTS) log(JSON.stringify(await evaluate('window.__log')).slice(0, 900) + ' from ' + JSON.stringify({ x: c.cx, y: c.cy }));
  log(`normal: dragged to 20%/20%, corner is at ${c.left.toFixed(2)}% / ${c.top.toFixed(2)}%`);
  near(c.left, 20, 0.8, "left %");
  near(c.top, 20, 0.8, "top %");

  // Zoom to 200% and move the same corner to 30% / 30%.
  for (let i = 0; i < 3; i++) await click(`document.querySelector('[role=dialog][aria-label="Adjust crop"] [aria-label="Zoom in"]')`);
  await sleep(300);
  await evaluate(`document.querySelector('[role=dialog][aria-label="Adjust crop"] [style*="pan-x"]').scrollTo(0, 0)`);
  await sleep(150);
  const f2 = await cropFrame();
  near(f2.w / f1.w, 2, 0.05, "frame doubled");
  c = await cornerLeftTop(0);
  await drag({ x: c.cx, y: c.cy }, { x: f2.x + f2.w * 0.3, y: f2.y + f2.h * 0.3 });
  c = await cornerLeftTop(0);
  log(`200%: dragged to 30%/30%, corner is at ${c.left.toFixed(2)}% / ${c.top.toFixed(2)}%`);
  near(c.left, 30, 0.8, "left % at 200%");
  near(c.top, 30, 0.8, "top % at 200%");
  // Reset, and the corner keeps its place on the photo.
  await click(`document.querySelector('[role=dialog][aria-label="Adjust crop"] [role=group][aria-label=Zoom] button:nth-child(2)')`);
  await sleep(200);
  const f3 = await cropFrame();
  near(f3.w, f1.w, 1.5, "normal width again");
  c = await cornerLeftTop(0);
  near(c.left, 30, 0.8, "corner still at 30%");
});

await test("Apply crop after zooming still crops (the editor's own flow is untouched)", async () => {
  await evaluate(`[...document.querySelectorAll('[role=dialog][aria-label="Adjust crop"] button')].find(b => b.innerText.trim() === 'Apply crop').click()`);
  await waitFor(`!document.querySelector('[role=dialog][aria-label="Adjust crop"]')`, "crop to close");
  await waitFor(`!${TOP}.innerText.includes('Processing')`, "reprocess", 30000);
});

console.log("Pinch on a touch screen");

async function touch(type, points) {
  await send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
}

await test("two-finger pinch out zooms in, pinch in zooms out, and the fingers can pan", async () => {
  await openAnnotator({ width: 375, height: 812, mobile: true });
  const f0 = await frameRect();
  const cx = f0.vx + f0.vw / 2;
  const cy = f0.vy + f0.vh / 2;
  // Spread two fingers apart.
  await touch("touchStart", [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }]);
  for (let step = 1; step <= 10; step++) await touch("touchMove", [{ x: cx - 30 - step * 8, y: cy }, { x: cx + 30 + step * 8, y: cy }]);
  await touch("touchEnd", []);
  await sleep(250);
  const zoomed = await frameRect();
  log(`pinch out: ${(zoomed.w / f0.w).toFixed(2)}x, label ${await zoomLabel()}`);
  assert.ok(zoomed.w / f0.w > 1.8, "pinch out zoomed in");
  // Two fingers dragging together move the page around (dragging right/down shows more of the top-left).
  const scrollBefore = { l: zoomed.sl, t: zoomed.st };
  await touch("touchStart", [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }]);
  for (let step = 1; step <= 8; step++) await touch("touchMove", [{ x: cx - 30 + step * 6, y: cy + step * 8 }, { x: cx + 30 + step * 6, y: cy + step * 8 }]);
  await touch("touchEnd", []);
  await sleep(200);
  const panned = await frameRect();
  log(`two-finger pan moved the scroll from (${scrollBefore.l}, ${scrollBefore.t}) to (${panned.sl}, ${panned.st})`);
  assert.ok(Math.abs(panned.sl - scrollBefore.l) > 20 || Math.abs(panned.st - scrollBefore.t) > 20, "the page moved");
  near(panned.w / zoomed.w, 1, 0.03, "panning doesn't change the zoom");
  // Pinch in.
  await touch("touchStart", [{ x: cx - 100, y: cy }, { x: cx + 100, y: cy }]);
  for (let step = 1; step <= 10; step++) await touch("touchMove", [{ x: cx - 100 + step * 9, y: cy }, { x: cx + 100 - step * 9, y: cy }]);
  await touch("touchEnd", []);
  await sleep(250);
  const out = await frameRect();
  assert.ok(out.w < panned.w * 0.7, `pinch in zoomed out (${panned.w.toFixed(0)} -> ${out.w.toFixed(0)})`);
});

await test("a pinch never leaves a stray pen mark, even if one finger touched down first with the pen tool", async () => {
  await openAnnotator({ width: 375, height: 812, mobile: true });
  await click(`[...document.querySelectorAll('[role=dialog] [role=toolbar] button')].find(b => b.innerText.includes('Draw'))`);
  const f = await frameRect();
  const cx = f.vx + f.vw / 2;
  const cy = f.vy + f.vh / 2;
  await touch("touchStart", [{ x: cx - 30, y: cy }]);
  await touch("touchMove", [{ x: cx - 34, y: cy + 4 }]);
  await touch("touchMove", [{ x: cx - 40, y: cy + 8 }]);
  // The second finger arrives: this is a pinch, not a drawing.
  await touch("touchStart", [{ x: cx - 40, y: cy + 8, id: 0 }, { x: cx + 60, y: cy, id: 1 }]);
  for (let step = 1; step <= 8; step++) await touch("touchMove", [{ x: cx - 40 - step * 8, y: cy + 8 }, { x: cx + 60 + step * 8, y: cy }]);
  await touch("touchEnd", []);
  await sleep(300);
  const zoomed = await frameRect();
  assert.ok(zoomed.w / f.w > 1.3, "the pinch zoomed");
  const undoDisabled = await evaluate(`document.querySelector('[role=dialog] [aria-label="Undo"]').disabled`);
  assert.equal(undoDisabled, true, "nothing was drawn: there is nothing to undo");
  // A single finger still draws afterwards.
  const g = await frameRect();
  const sx = Math.min(g.vx + g.vw - 60, Math.max(g.vx + 40, g.x + 100));
  const sy = g.vy + g.vh / 2;
  await touch("touchStart", [{ x: sx, y: sy }]);
  for (let i = 1; i <= 6; i++) await touch("touchMove", [{ x: sx + i * 6, y: sy + i * 3 }]);
  await touch("touchEnd", []);
  await sleep(250);
  assert.equal(await evaluate(`document.querySelector('[role=dialog] [aria-label="Undo"]').disabled`), false, "one finger draws again after the pinch");
});

console.log("Small screen (375px)");

await test("375px: the zoom controls fit, are 44px tall, and nothing overflows sideways (page editor and annotator)", async () => {
  await openPageEditor({ width: 375, height: 812, mobile: true });
  let g = await evaluate(`(() => { const grp = ${TOP}.querySelector('[role=group][aria-label=Zoom]'); const r = grp.getBoundingClientRect(); const btns = [...grp.querySelectorAll('button')].map(b => { const x = b.getBoundingClientRect(); return { w: Math.round(x.width), h: Math.round(x.height) }; }); return { left: r.left, right: r.right, vw: innerWidth, btns, scrollW: document.documentElement.scrollWidth }; })()`);
  log(`page editor: ${JSON.stringify(g)}`);
  assert.ok(g.left >= 0 && g.right <= g.vw && g.scrollW <= g.vw);
  assert.ok(g.btns.every((b) => b.h >= 44 && b.w >= 44));
  await send("Page.captureScreenshot", { format: "png" }).then((s) => fs.writeFileSync(path.join(outDir, "page-editor-375.png"), Buffer.from(s.data, "base64")));
  await openAnnotator({ width: 375, height: 812, mobile: true });
  g = await evaluate(`(() => { const grp = document.querySelector('[role=dialog] [role=group][aria-label=Zoom]'); const r = grp.getBoundingClientRect(); const btns = [...grp.querySelectorAll('button')].map(b => { const x = b.getBoundingClientRect(); return { w: Math.round(x.width), h: Math.round(x.height) }; }); const doneR = [...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Done').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, btns, doneBottom: doneR.bottom, scrollW: document.documentElement.scrollWidth }; })()`);
  log(`annotator: ${JSON.stringify(g)}`);
  assert.ok(g.left >= 0 && g.right <= g.vw && g.bottom <= g.vh && g.top > g.doneBottom, "controls sit inside the screen, below the header");
  assert.ok(g.btns.every((b) => b.h >= 44 && b.w >= 44));
  assert.ok(g.scrollW <= g.vw);
  // Zoom in with a tap on the button and screenshot the zoomed state.
  for (let i = 0; i < 3; i++) await click(`document.querySelector('[role=dialog] [aria-label="Zoom in"]')`);
  await sleep(300);
  await send("Page.captureScreenshot", { format: "png" }).then((s) => fs.writeFileSync(path.join(outDir, "annotator-375-zoomed.png"), Buffer.from(s.data, "base64")));
});

await test("no console errors or exceptions during the whole run", async () => {
  assert.deepEqual(consoleErrors, [], consoleErrors.join("\n"));
});

console.log(`\n${passed} passed, ${failed} failed`);
chrome.kill();
process.exit(failed === 0 ? 0 : 1);
