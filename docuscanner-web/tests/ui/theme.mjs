// Theme verification: the Light / Soft Gray / Dark selector and its behaviour, driven in
// real headless Chrome over the DevTools protocol.
//
//   node tests/ui/theme.mjs [baseUrl]        (default http://localhost:3000)
// Needs the app running (npm run build && npm run start).
//
// Covers: system fallback (and following a live system change), choosing a theme with
// no reload, the choice surviving a reload and a full browser restart, an explicit choice
// beating the system setting, keyboard behaviour of the menu, the print sheet always being
// light, the document staying paper-white in every theme, and the scanner workflow
// (add pages, edit, create PDF, download, print) working while themes are switched.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const { createCanvas } = require("@napi-rs/canvas");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "theme-test-"));
const profile = path.join(work, "profile");
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));

const PAPER = "rgb(255, 255, 255)";
const PAGE = { light: "rgb(250, 250, 250)", soft: "rgb(233, 236, 241)", dark: "rgb(17, 17, 19)" };

function pageImage(name, w, h, label) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4f2ec";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#222";
  ctx.font = `${Math.round(w / 12)}px Arial`;
  ctx.fillText(label, w * 0.08, h * 0.12);
  const file = path.join(work, name);
  fs.writeFileSync(file, c.toBuffer("image/jpeg", 88));
  return file;
}
const FILES = [pageImage("a.jpg", 1200, 1600, "ONE"), pageImage("b.jpg", 1200, 1600, "TWO")];

// ---- browser plumbing -----------------------------------------------------------------
let chrome;
let ws;
let nextId = 1;
const pending = new Map();
const exceptions = [];

async function launch() {
  const port = 9500 + Math.floor(Math.random() * 300);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let url = null;
  for (let i = 0; i < 80 && !url; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      url = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {}
    if (!url) await sleep(250);
  }
  if (!url) throw new Error("browser did not start");
  ws = new WebSocket(url);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") exceptions.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
}
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
async function waitFor(expression, what, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return true;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function closeBrowserGracefully() {
  // Browser.close flushes localStorage to disk, like a person quitting the browser.
  await send("Browser.close").catch(() => undefined);
  await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once("exit", r)));
  await sleep(500);
}
const scheme = (value) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
async function open(route) {
  await send("Page.navigate", { url: BASE + route });
  await waitFor(`document.readyState === 'complete' && document.querySelector('main')`, route);
  await sleep(500);
}
const theme = () => evaluate(`document.documentElement.getAttribute('data-theme')`);
const stored = () => evaluate(`localStorage.getItem('pdfscanner.theme')`);
const bodyBg = () => evaluate(`getComputedStyle(document.body).backgroundColor`);
const triggerLabel = () => evaluate(`document.querySelector('header button[aria-haspopup]')?.getAttribute('aria-label')`);
const openMenu = async () => {
  await evaluate(`document.querySelector('header button[aria-label^="Theme"]').click()`);
  await waitFor(`document.querySelector('[role=group][aria-label="Theme"]')`, "theme menu");
};
const pickTheme = async (label) => {
  await openMenu();
  await evaluate(`[...document.querySelectorAll('[role=group][aria-label="Theme"] button')].find(b => b.innerText.trim() === ${JSON.stringify(label)}).click()`);
  await sleep(350);
};
async function setFiles(files) {
  const { result } = await send("Runtime.evaluate", { expression: `document.querySelector('input[type=file]')` });
  await send("DOM.setFileInputFiles", { files, objectId: result.objectId });
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err.message ?? err).split("\n")[0]}`);
  }
}

console.log(`Theme verification against ${BASE} using ${path.basename(CHROME)}`);
await launch();

console.log("System fallback (nothing saved)");
await test("no saved theme + system light -> Light", async () => {
  await scheme("light");
  await open("/");
  assert.equal(await stored(), null);
  assert.equal(await theme(), "light");
  assert.equal(await bodyBg(), PAGE.light);
  assert.equal(await triggerLabel(), "Theme: Light");
});
await test("no saved theme + system dark -> Dark (never Soft Gray)", async () => {
  await scheme("dark");
  await open("/");
  assert.equal(await stored(), null);
  assert.equal(await theme(), "dark");
  assert.equal(await bodyBg(), PAGE.dark);
  assert.equal(await triggerLabel(), "Theme: Dark");
});
await test("with nothing saved, a live system change is followed without a reload", async () => {
  await scheme("light");
  await open("/");
  await evaluate(`window.__marker = 42`);
  await scheme("dark");
  await waitFor(`document.documentElement.getAttribute('data-theme') === 'dark'`, "system follow");
  assert.equal(await evaluate(`window.__marker`), 42, "page did not reload");
  assert.equal(await stored(), null, "following the system is not saved as a choice");
});

console.log("Choosing a theme");
await test("the menu offers Light, Soft Gray and Dark with an icon each, and marks the current one", async () => {
  await scheme("light");
  await open("/");
  await openMenu();
  const items = await evaluate(`[...document.querySelectorAll('[role=group][aria-label="Theme"] button')].map(b => ({ t: b.innerText.trim(), icon: !!b.querySelector('svg'), pressed: b.getAttribute('aria-pressed') }))`);
  assert.deepEqual(items.map((i) => i.t), ["Light", "Soft Gray", "Dark"]);
  assert.ok(items.every((i) => i.icon), "every option has an icon");
  assert.deepEqual(items.map((i) => i.pressed), ["true", "false", "false"]);
});
await test("Escape closes the menu and returns focus to its button", async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(150);
  assert.equal(await evaluate(`!!document.querySelector('[role=group][aria-label="Theme"]')`), false);
  assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), "Theme: Light");
});
await test("clicking outside closes the menu", async () => {
  await openMenu();
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 400, y: 500, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 400, y: 500, button: "left", clickCount: 1 });
  await sleep(150);
  assert.equal(await evaluate(`!!document.querySelector('[role=group][aria-label="Theme"]')`), false);
});
await test("choosing Soft Gray applies immediately (no reload), is saved, and the button reflects it", async () => {
  await evaluate(`window.__marker = 7`);
  await pickTheme("Soft Gray");
  assert.equal(await theme(), "soft");
  assert.equal(await stored(), "soft");
  assert.equal(await bodyBg(), PAGE.soft);
  assert.equal(await evaluate(`window.__marker`), 7, "no reload happened");
  assert.equal(await triggerLabel(), "Theme: Soft Gray");
  assert.equal(await evaluate(`!!document.querySelector('[role=group][aria-label="Theme"]')`), false, "menu closed");
  assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), "Theme: Soft Gray");
});
await test("the brief colour fade cleans itself up", async () => {
  await sleep(400);
  assert.equal(await evaluate(`document.documentElement.classList.contains('theme-switching')`), false);
});
await test("Soft Gray is its own palette: not the Light or Dark colours", async () => {
  const c = await evaluate(`(() => { const cs = getComputedStyle(document.documentElement); return { surface: cs.getPropertyValue('--surface').trim(), text: cs.getPropertyValue('--text').trim() }; })()`);
  assert.equal(c.surface, "#dfe3e9");
  assert.equal(c.text, "#1b212b");
  const card = await evaluate(`(() => { const el = document.createElement('div'); el.className = 'card'; document.body.appendChild(el); const bg = getComputedStyle(el).backgroundColor; el.remove(); return bg; })()`);
  assert.equal(card, "rgb(223, 227, 233)");
});

console.log("Persistence");
await test("an explicit choice beats the system setting", async () => {
  await scheme("dark");
  await sleep(300);
  assert.equal(await theme(), "soft");
  await scheme("light");
  await sleep(300);
  assert.equal(await theme(), "soft");
});
await test("Soft Gray is still there after a reload, and was set before the page finished loading", async () => {
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener('DOMContentLoaded', () => { window.__themeAtDcl = document.documentElement.getAttribute('data-theme'); });` });
  await open("/tools");
  assert.equal(await theme(), "soft");
  assert.equal(await bodyBg(), PAGE.soft);
  assert.equal(await evaluate(`window.__themeAtDcl`), "soft", "applied before first paint, so no flash of the default theme");
  const html = await (await fetch(BASE + "/tools")).text();
  assert.ok(html.indexOf("pdfscanner.theme") > -1 && html.indexOf("pdfscanner.theme") < html.indexOf("<body"), "the theme script is in <head>, ahead of the page");
});
await test("it carries across pages of the app", async () => {
  for (const route of ["/scan", "/convert", "/history"]) {
    await open(route);
    assert.equal(await theme(), "soft", route);
  }
});
await test("Soft Gray survives closing and reopening the browser", async () => {
  await closeBrowserGracefully();
  await launch();
  await scheme("light");
  await open("/");
  assert.equal(await stored(), "soft");
  assert.equal(await theme(), "soft");
  assert.equal(await bodyBg(), PAGE.soft);
});
await test("Dark and Light can be chosen and are remembered the same way", async () => {
  await pickTheme("Dark");
  assert.equal(await theme(), "dark");
  assert.equal(await bodyBg(), PAGE.dark);
  await open("/");
  assert.equal(await theme(), "dark");
  await pickTheme("Light");
  assert.equal(await stored(), "light");
  await open("/");
  assert.equal(await theme(), "light");
  assert.equal(await bodyBg(), PAGE.light);
});
await test("an unknown saved value is ignored and the system setting is used", async () => {
  await evaluate(`localStorage.setItem('pdfscanner.theme', 'purple')`);
  await scheme("dark");
  await open("/");
  assert.equal(await theme(), "dark");
});

console.log("Documents stay paper, print stays light");
for (const [label, id] of [["Light", "light"], ["Soft Gray", "soft"], ["Dark", "dark"]]) {
  await test(`${label}: a scanned page keeps its white paper and the app around it changes`, async () => {
    await evaluate(`localStorage.setItem('pdfscanner.theme', ${JSON.stringify(id)})`);
    await scheme("light");
    await open("/scan");
    await setFiles(FILES);
    await waitFor(`document.querySelector('[aria-label="Edit page 1"]')`, "page preview", 60000);
    await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(2 page/.test(b.innerText) && !b.disabled)`, "pages ready", 60000);
    assert.equal(await theme(), id);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Edit page 1"]')).backgroundColor`), PAPER, "preview paper");
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Show page 1"]')).backgroundColor`), PAPER, "thumbnail paper");
    assert.equal(await bodyBg(), PAGE[id]);
  });
}
await test("the print sheet is always light, whatever theme is on screen", async () => {
  for (const id of ["soft", "dark"]) {
    await evaluate(`localStorage.setItem('pdfscanner.theme', ${JSON.stringify(id)})`);
    await open("/");
    assert.equal(await theme(), id);
    await send("Emulation.setEmulatedMedia", { media: "print", features: [{ name: "prefers-color-scheme", value: "light" }] });
    assert.equal(await bodyBg(), PAGE.light, `${id} prints on the light palette`);
    assert.equal(await evaluate(`getComputedStyle(document.body).color`), "rgb(24, 24, 27)");
    await send("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-color-scheme", value: "light" }] });
  }
});

console.log("Workflows keep working while themes change");
await test("add pages, switch theme mid-way, edit, create the PDF and download a real PDF (Print, Save and Start new are all offered)", async () => {
  await evaluate(`localStorage.setItem('pdfscanner.theme', 'light')`);
  await open("/scan");
  await evaluate(`window.__downloads = []; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push({ name: this.download, href: this.href }); return; } return oc.call(this); };`);
  await setFiles(FILES);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(2 page/.test(b.innerText) && !b.disabled)`, "pages ready", 60000);
  await pickTheme("Dark");
  assert.equal(await theme(), "dark");
  // page editor while dark
  await evaluate(`document.querySelector('[aria-label="Edit page 1"]').click()`);
  await waitFor(`document.querySelector('[role=dialog][aria-label="Edit page 1"]')`, "page editor");
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.getAttribute('aria-label') === 'Rotate right').click()`);
  await sleep(1200);
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Done').click()`);
  await waitFor(`!document.querySelector('[role=dialog]')`, "editor closed");
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(2 page/.test(b.innerText) && !b.disabled)`, "ready after edit", 30000);
  await pickTheme("Soft Gray");
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Create PDF/.test(b.innerText)).click()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Download PDF')`, "PDF created", 60000);
  const labels = await evaluate(`[...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => ['Print', 'Download PDF', 'Save to account', 'Start new scan'].includes(t))`);
  assert.deepEqual(labels.sort(), ["Download PDF", "Print", "Save to account", "Start new scan"]);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Download PDF').click()`);
  await sleep(600);
  const file = await evaluate(`(async () => { const d = window.__downloads[0]; const blob = await (await fetch(d.href)).blob(); return { name: d.name, size: blob.size, head: new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5)) }; })()`);
  assert.equal(file.name, "document.pdf");
  assert.equal(file.head, "%PDF-");
  assert.ok(file.size > 1000, "a real PDF was downloaded");
  assert.equal(await theme(), "soft");
});
await test("no script errors during the whole run", async () => {
  assert.deepEqual(exceptions, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
await closeBrowserGracefully();
try {
  fs.rmSync(work, { recursive: true, force: true });
} catch {}
process.exit(failed ? 1 : 0);
