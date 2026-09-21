// Visual theme verification in a real browser: it does NOT trust the data-theme attribute
// or any variable. It drives the real theme menu and measures the colours the browser
// actually paints, then compares them with what each theme is supposed to look like.
//
//   node tests/ui/theme-visual.mjs [baseUrl] [--shots=<dir>]
//        (default http://localhost:3000; also works against the live site)
//
// For each width (375, 390, 1280) and each operating-system setting (light, dark) it picks
// Light, Warm Beige and Dark from the menu and measures: page background, header, card,
// primary and secondary text, border, input, buttons and navigation. It checks that
//   - every colour is the right one for the chosen theme, whatever the OS setting is
//     (an explicit choice must never be overridden by the system, either way round),
//   - the three themes are measurably different (Light lighter than Warm Beige, Warm Beige
//     lighter than Dark, text readable on each),
//   - the choice survives a reload and beats a later change of the OS setting,
//   - a dialog, an input and a scanned page (which must stay paper-white) look right.
// With --shots it also saves a screenshot of each state.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const shotsArg = process.argv.find((a) => a.startsWith("--shots="));
const SHOTS = shotsArg ? shotsArg.slice(8) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const { createCanvas } = require("@napi-rs/canvas");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "theme-visual-"));
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));

// What each theme must look like (sRGB). Tolerance is 2 per channel for rounding.
const SPEC = {
  light: { page: [250, 250, 250], chrome: [255, 255, 255], card: [255, 255, 255], cardBorder: [228, 228, 231], text: [24, 24, 27], muted: [82, 82, 91], field: [255, 255, 255], fieldBorder: [212, 212, 216], btnSecondary: [255, 255, 255], dialog: [255, 255, 255], navActive: [244, 244, 245], navText: [82, 82, 91] },
  beige: { page: [232, 226, 216], chrome: [221, 213, 200], card: [221, 213, 200], cardBorder: [201, 192, 179], text: [41, 39, 34], muted: [87, 82, 74], field: [240, 235, 227], fieldBorder: [148, 138, 124], btnSecondary: [221, 213, 200], dialog: [240, 235, 227], navActive: [216, 208, 195], navText: [74, 70, 63] },
  dark: { page: [17, 17, 19], chrome: [20, 20, 23], card: [26, 26, 30], cardBorder: [39, 39, 42], text: [244, 244, 245], muted: [161, 161, 170], field: [17, 17, 19], fieldBorder: [74, 74, 82], btnSecondary: [26, 26, 30], dialog: [34, 34, 39], navActive: [39, 39, 42], navText: [161, 161, 170] },
};
const LABEL = { light: "Light", beige: "Warm Beige", dark: "Dark" };
const ACCENT = [21, 93, 252]; // Tailwind v4 blue-600: the same in every theme
const PAPER = [255, 255, 255];

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
const FILE = pageImage("a.jpg", 1200, 1600, "INVOICE");

// ---- browser plumbing ---------------------------------------------------------------
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, "profile")}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
let wsUrl = null;
for (let i = 0; i < 80 && !wsUrl; i++) {
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
  } catch {}
  if (!wsUrl) await new Promise((r) => setTimeout(r, 250));
}
if (!wsUrl) throw new Error("browser did not start");
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method === "Runtime.exceptionThrown") problems.push("exception: " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split("\n")[0]);
  else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") problems.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 160));
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
async function waitFor(expression, what, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.print = () => {};` });

async function viewport(width) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: width < 700 ? 812 : 900, deviceScaleFactor: 1, mobile: width < 700 });
  await send("Emulation.setTouchEmulationEnabled", { enabled: width < 700 });
}
const scheme = (value) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
async function open(route) {
  await send("Page.navigate", { url: BASE + route });
  await waitFor(`document.readyState === 'complete' && document.querySelector('main')`, route);
  await sleep(450);
}
async function shot(name) {
  if (!SHOTS) return;
  const data = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data.data, "base64"));
}
const menuOpen = () => evaluate(`!!document.querySelector('[role=group][aria-label="Theme"]')`);
async function chooseFromMenu(theme) {
  await evaluate(`document.querySelector('header button[aria-label^="Theme"]').click()`);
  await waitFor(`document.querySelector('[role=group][aria-label="Theme"]')`, "theme menu");
  await evaluate(`[...document.querySelectorAll('[role=group][aria-label="Theme"] button')].find(b => b.innerText.trim() === ${JSON.stringify(LABEL[theme])}).click()`);
  await sleep(450);
}

// Measures what is painted. Colours are resolved through a canvas so oklch()/lab()/
// color-mix() values all become plain sRGB; translucent ones are composited over what is
// behind them (the page).
const PROBE = `(() => {
  const swatch = document.createElement('canvas'); swatch.width = swatch.height = 1;
  const g = swatch.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { if (!c || c === 'transparent') return [0, 0, 0, 0]; g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3]));
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const page = rgba(cs(document.body, 'backgroundColor')).slice(0, 3);
  const flat = (el, p) => { const c = rgba(cs(el, p)); return el ? over(c, page).map(Math.round) : null; };
  const temp = (cls) => { const e = document.createElement('div'); e.className = cls; document.body.appendChild(e); return e; };
  const card = temp('card'), muted = temp('muted'), field = temp('field'), sec = temp('btn btn-secondary'), pri = temp('btn btn-primary');
  const side = document.querySelector('header nav a[aria-current]'), other = document.querySelector('header nav a:not([aria-current])');
  const sideVisible = side && side.getBoundingClientRect().width > 0;
  const bottom = document.querySelector('nav.fixed');
  const out = {
    attr: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('pdfscanner.theme'),
    trigger: document.querySelector('header button[aria-haspopup]')?.getAttribute('aria-label'),
    page: page.map(Math.round),
    chrome: flat(document.querySelector('header'), 'backgroundColor'),
    card: flat(card, 'backgroundColor'), cardBorder: flat(card, 'borderTopColor'),
    text: flat(document.body, 'color'), muted: flat(muted, 'color'),
    field: flat(field, 'backgroundColor'), fieldBorder: flat(field, 'borderTopColor'),
    btnSecondary: flat(sec, 'backgroundColor'), btnPrimary: flat(pri, 'backgroundColor'),
    navActive: sideVisible ? flat(side, 'backgroundColor') : null, navText: sideVisible && other ? flat(other, 'color') : null,
    bottomNav: bottom && bottom.getBoundingClientRect().height > 0 ? flat(bottom, 'backgroundColor') : null,
    menuInView: (() => { const m = document.querySelector('[role=group][aria-label="Theme"]'); if (!m) return null; const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })(),
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
  };
  [card, muted, field, sec, pri].forEach((e) => e.remove());
  return out;
})()`;

const near = (actual, expected, what, tol = 2) => {
  assert.ok(actual, `${what}: nothing measured`);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= tol, `${what}: painted rgb(${actual.join(", ")}) but the theme calls for rgb(${expected.join(", ")})`);
};
const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

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
const expectedHeader = (theme) => SPEC[theme].chrome.map((v, i) => Math.round(v * 0.9 + SPEC[theme].page[i] * 0.1));

console.log(`Visual theme verification against ${BASE} using ${path.basename(CHROME)}`);

const measured = {}; // measured[width][os][theme] = probe result
for (const width of [375, 390, 1280]) {
  console.log(`\n${width}px`);
  measured[width] = { light: {}, dark: {} };
  for (const osSetting of ["light", "dark"]) {
    for (const theme of ["light", "beige", "dark"]) {
      await test(`OS ${osSetting}: choose ${LABEL[theme]} from the menu -> it paints as ${LABEL[theme]}`, async () => {
        await viewport(width);
        await scheme(osSetting);
        await open("/scan");
        await evaluate("localStorage.clear()");
        await open("/scan");
        const initial = await evaluate(`document.documentElement.getAttribute('data-theme')`);
        assert.equal(initial, osSetting, "with nothing saved the app follows the OS");
        await chooseFromMenu(theme);
        assert.equal(await menuOpen(), false, "menu closes after choosing");
        const m = await evaluate(PROBE);
        measured[width][osSetting][theme] = m;
        assert.equal(m.attr, theme);
        assert.equal(m.stored, theme, "saved");
        assert.equal(m.trigger, `Theme: ${LABEL[theme]}`, "selector shows the current theme");
        const s = SPEC[theme];
        near(m.page, s.page, "page background");
        near(m.chrome, expectedHeader(theme), "header background");
        near(m.card, s.card, "card surface");
        near(m.cardBorder, s.cardBorder, "card border");
        near(m.text, s.text, "primary text");
        near(m.muted, s.muted, "secondary text");
        near(m.field, s.field, "input background");
        near(m.fieldBorder, s.fieldBorder, "input border");
        near(m.btnSecondary, s.btnSecondary, "secondary button");
        near(m.btnPrimary, ACCENT, "primary button (blue accent)");
        if (m.navActive) near(m.navActive, s.navActive, "active navigation item");
        if (m.navText) near(m.navText, s.navText, "navigation text");
        if (m.bottomNav) near(m.bottomNav, expectedHeader(theme).map((v, i) => Math.round(s.chrome[i] * 0.95 + s.page[i] * 0.05)), "bottom navigation", 3);
        assert.ok(ratio(m.text, m.page) >= 7, `primary text contrast ${ratio(m.text, m.page).toFixed(1)}:1`);
        assert.ok(ratio(m.muted, m.card) >= 4.5, `secondary text contrast ${ratio(m.muted, m.card).toFixed(1)}:1`);
        assert.equal(m.overflow, false, "no horizontal scrolling");
        await shot(`scan-${width}-os${osSetting}-${theme}`);
      });
    }
  }

  await test("the three themes are measurably different from each other", async () => {
    const t = measured[width].light;
    assert.ok(t.light && t.beige && t.dark, "all three themes were measured");
    // Lightness ordering: Light > Warm Beige > Dark, with real gaps (not near-duplicates).
    assert.ok(lum(t.light.page) - lum(t.beige.page) > 0.05, "Light and Warm Beige page backgrounds are clearly different");
    assert.ok(lum(t.beige.page) - lum(t.dark.page) > 0.5, "Warm Beige is clearly lighter than Dark");
    assert.ok(lum(t.light.card) - lum(t.beige.card) > 0.05, "Light and Warm Beige surfaces are clearly different");
    assert.ok(lum(t.beige.card) < lum(t.beige.page), "Warm Beige surfaces are slightly darker than its page");
    assert.ok(lum(t.dark.card) > lum(t.dark.page), "Dark surfaces sit above the Dark page");
    assert.ok(lum(t.dark.page) > 0.004, "Dark is charcoal, not pure black");
    assert.ok(lum(t.light.text) < 0.05 && lum(t.beige.text) < 0.05 && lum(t.dark.text) > 0.8, "text is dark on Light/Warm Beige and light on Dark");
    assert.deepEqual(t.light.btnPrimary, t.dark.btnPrimary, "the blue accent is shared");
    assert.deepEqual(t.beige.btnPrimary, t.dark.btnPrimary, "the blue accent is shared");
  });
  await test("the OS setting makes no difference to an explicit choice", async () => {
    for (const theme of ["light", "beige", "dark"]) {
      const a = measured[width].light[theme], b = measured[width].dark[theme];
      for (const key of ["page", "chrome", "card", "cardBorder", "text", "muted", "field", "fieldBorder", "btnSecondary"]) {
        assert.deepEqual(a[key], b[key], `${LABEL[theme]} ${key} differs between OS light and OS dark`);
      }
    }
  });
  await test("the theme menu stays on screen and the header does not overflow", async () => {
    await viewport(width);
    await scheme("light");
    await open("/scan");
    await evaluate(`document.querySelector('header button[aria-label^="Theme"]').click()`);
    await waitFor(`document.querySelector('[role=group][aria-label="Theme"]')`, "menu");
    const m = await evaluate(PROBE);
    assert.equal(m.menuInView, true, "menu is fully inside the window");
    assert.equal(m.overflow, false);
    await shot(`menu-${width}`);
    await evaluate(`document.body.click()`);
  });
  await test("the choice survives a reload, and beats a later change of the OS setting", async () => {
    await viewport(width);
    await scheme("light");
    await open("/scan");
    await chooseFromMenu("beige");
    await open("/scan"); // reload
    let m = await evaluate(PROBE);
    assert.equal(m.attr, "beige");
    near(m.page, SPEC.beige.page, "page after reload");
    await scheme("dark");
    await sleep(400);
    m = await evaluate(PROBE);
    assert.equal(m.attr, "beige", "OS went dark, explicit Warm Beige stays");
    near(m.page, SPEC.beige.page, "page after the OS turned dark");
    await chooseFromMenu("dark");
    await scheme("light");
    await sleep(400);
    m = await evaluate(PROBE);
    near(m.page, SPEC.dark.page, "page after the OS turned light while Dark is chosen");
  });
}

console.log("\nSurfaces (1280px, OS dark: the hardest case for Light and Warm Beige)");
await viewport(1280);
await scheme("dark");
for (const theme of ["light", "beige", "dark"]) {
  await test(`${LABEL[theme]}: dialog, input and scanned page`, async () => {
    await open("/");
    await evaluate("localStorage.clear()");
    await open("/");
    await chooseFromMenu(theme);
    await shot(`home-1280-${theme}`);
    // Log in dialog and its inputs
    await evaluate(`[...document.querySelectorAll('header button')].find(b => b.innerText.trim() === 'Log in').click()`);
    await waitFor(`document.querySelector('[role=dialog]')`, "log in dialog");
    await sleep(250);
    const dialog = await evaluate(`(() => { const d = document.querySelector('[role=dialog] > div') || document.querySelector('[role=dialog]'); const kid = [...document.querySelectorAll('[role=dialog] div')].find(e => getComputedStyle(e).boxShadow !== 'none' && e.getBoundingClientRect().width > 200); const bg = getComputedStyle(kid).backgroundColor; const i = document.querySelector('[role=dialog] input'); const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); const px = (v) => { g.clearRect(0,0,1,1); g.fillStyle = v; g.fillRect(0,0,1,1); return [...g.getImageData(0,0,1,1).data].slice(0,3); }; return { dialog: px(bg), input: px(getComputedStyle(i).backgroundColor), inputBorder: px(getComputedStyle(i).borderTopColor) }; })()`);
    near(dialog.dialog, SPEC[theme].dialog, "dialog surface");
    near(dialog.input, SPEC[theme].field, "input inside the dialog");
    near(dialog.inputBorder, SPEC[theme].fieldBorder, "input border inside the dialog");
    await shot(`login-1280-${theme}`);
    await evaluate(`document.querySelector('[role=dialog] button[aria-label="Close"]').click()`);
    await waitFor(`!document.querySelector('[role=dialog]')`, "dialog closed");
    // Scanned page stays paper-white while the app around it changes
    await open("/scan");
    const { result } = await send("Runtime.evaluate", { expression: `document.querySelector('input[type=file]')` });
    await send("DOM.setFileInputFiles", { files: [FILE], objectId: result.objectId });
    await waitFor(`document.querySelector('[aria-label="Edit page 1"]')`, "page", 60000);
    await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(1 page/.test(b.innerText) && !b.disabled)`, "page ready", 60000);
    const paper = await evaluate(`(() => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); const px = (v) => { g.clearRect(0,0,1,1); g.fillStyle = v; g.fillRect(0,0,1,1); return [...g.getImageData(0,0,1,1).data].slice(0,3); }; return { preview: px(getComputedStyle(document.querySelector('[aria-label="Edit page 1"]')).backgroundColor), thumb: px(getComputedStyle(document.querySelector('[aria-label="Show page 1"]')).backgroundColor) }; })()`);
    near(paper.preview, PAPER, "document preview stays paper-white");
    near(paper.thumb, PAPER, "thumbnail stays paper-white");
    await shot(`workspace-1280-${theme}`);
    // Page editor (a dialog) uses the elevated surface
    await evaluate(`document.querySelector('[aria-label="Edit page 1"]').click()`);
    await waitFor(`document.querySelector('[role=dialog][aria-label="Edit page 1"]')`, "page editor");
    await sleep(600);
    const editor = await evaluate(`(() => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); const el = document.querySelector('[role=dialog][aria-label="Edit page 1"] > div'); g.fillStyle = getComputedStyle(el).backgroundColor; g.fillRect(0,0,1,1); return [...g.getImageData(0,0,1,1).data].slice(0,3); })()`);
    near(editor, SPEC[theme].dialog, "page editor surface");
    await shot(`editor-1280-${theme}`);
    await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Done').click()`);
    await waitFor(`!document.querySelector('[role=dialog]')`, "editor closed");
  });
}
console.log("\nAccessibility per theme (contrast of text, links, notices, placeholder, focus; disabled and selected states)");
const TXT = path.join(work, "not-a-document.txt");
fs.writeFileSync(TXT, "this is not a document");
const A11Y = `(() => {
  const swatch = document.createElement('canvas'); swatch.width = swatch.height = 1;
  const g = swatch.getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const lum = ([r, gg, b]) => [r, gg, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const temp = (tag, cls, html) => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };
  const root = getComputedStyle(document.documentElement);
  const tok = (n) => rgb(root.getPropertyValue(n).trim());
  const out = { notices: {} };
  for (const k of ['success', 'warning', 'error', 'info']) {
    const e = temp('div', 'notice notice-' + k, 'Message');
    const cs = getComputedStyle(e);
    out.notices[k] = { text: +ratio(rgb(cs.color), rgb(cs.backgroundColor)).toFixed(2), edge: +ratio(rgb(cs.borderTopColor), rgb(cs.backgroundColor)).toFixed(2) };
    e.remove();
  }
  const card = temp('div', 'card'); const cardBg = rgb(getComputedStyle(card).backgroundColor); card.remove();
  const link = temp('a', 'link-inline', 'a link'); link.href = '#'; const ls = getComputedStyle(link);
  out.linkOnCard = +ratio(rgb(ls.color), cardBg).toFixed(2); out.linkOnPage = +ratio(rgb(ls.color), rgb(getComputedStyle(document.body).backgroundColor)).toFixed(2); out.linkUnderlined = ls.textDecorationLine.includes('underline'); link.remove();
  // A placeholder style only exists on an input that HAS a placeholder.
  const field = temp('input', 'field'); field.placeholder = 'Placeholder'; const ph = getComputedStyle(field, '::placeholder'); out.placeholder = +ratio(rgb(ph.color), rgb(getComputedStyle(field).backgroundColor)).toFixed(2); field.remove();
  out.focusOnCard = +ratio(tok('--focus'), cardBg).toFixed(2); out.focusOnPage = +ratio(tok('--focus'), rgb(getComputedStyle(document.body).backgroundColor)).toFixed(2);
  const dis = temp('button', 'btn btn-secondary', 'Disabled'); dis.disabled = true; const ds = getComputedStyle(dis); out.disabled = { opacity: +ds.opacity, cursor: ds.cursor }; dis.remove();
  const sec = temp('button', 'btn btn-secondary', 'Secondary'); out.btnText = +ratio(rgb(getComputedStyle(sec).color), rgb(getComputedStyle(sec).backgroundColor)).toFixed(2); sec.remove();
  out.borderOnPage = +ratio(tok('--border-strong'), rgb(getComputedStyle(document.body).backgroundColor)).toFixed(2);
  return out;
})()`;
for (const theme of ["light", "beige", "dark"]) {
  await test(`${LABEL[theme]}: text, links, notices, placeholder, focus, disabled and selected states meet contrast and are not colour-only`, async () => {
    await viewport(1280);
    await scheme(theme === "dark" ? "light" : "dark"); // opposite of the choice, to prove the choice governs
    await open("/scan");
    await evaluate("localStorage.clear()");
    await open("/scan");
    await chooseFromMenu(theme);
    const a = await evaluate(A11Y);
    console.log(`      ${LABEL[theme]} ratios -> notices ${Object.entries(a.notices).map(([k, v]) => k + ' ' + v.text).join(', ')} | link ${a.linkOnCard} | placeholder ${a.placeholder} | focus ${a.focusOnCard} | button text ${a.btnText} | disabled opacity ${a.disabled.opacity}`);
    for (const [kind, v] of Object.entries(a.notices)) assert.ok(v.text >= 4.5, `${kind} notice text contrast ${v.text}:1`);
    assert.ok(a.linkOnCard >= 4.5 && a.linkOnPage >= 4.5, `link contrast ${a.linkOnCard}:1 on cards, ${a.linkOnPage}:1 on the page`);
    assert.equal(a.linkUnderlined, true, "links are underlined, not identified by colour alone");
    assert.ok(a.placeholder >= 4.5, `placeholder contrast ${a.placeholder}:1`);
    assert.ok(a.focusOnCard >= 3 && a.focusOnPage >= 3, `focus ring contrast ${a.focusOnCard}:1 on cards, ${a.focusOnPage}:1 on the page`);
    assert.ok(a.btnText >= 7, `secondary button text contrast ${a.btnText}:1`);
    assert.ok(a.disabled.opacity <= 0.6 && a.disabled.cursor === "not-allowed", `disabled controls are dimmed (opacity ${a.disabled.opacity}) and show a not-allowed cursor`);
    // selected state: the current theme in the menu is marked by more than colour (check icon + pressed state)
    await evaluate(`document.querySelector('header button[aria-label^="Theme"]').click()`);
    await waitFor(`document.querySelector('[role=group][aria-label="Theme"]')`, "menu");
    const selected = await evaluate(`(() => { const b = [...document.querySelectorAll('[role=group][aria-label="Theme"] button')].find(x => x.getAttribute('aria-pressed') === 'true'); const menu = document.querySelector('[role=group][aria-label="Theme"]'); return { label: b.innerText.trim(), icons: b.querySelectorAll('svg').length, weight: getComputedStyle(b).fontWeight, bg: getComputedStyle(b).backgroundColor, menuBg: getComputedStyle(menu).backgroundColor }; })()`);
    assert.equal(selected.label, LABEL[theme]);
    assert.equal(selected.icons, 2, "selected option has its icon plus a check mark");
    assert.ok(Number(selected.weight) >= 600, "selected option is bold");
    assert.notEqual(selected.bg, selected.menuBg, "selected option has its own background");
    await shot(`menu-open-1280-${theme}`);
    await evaluate(`document.body.click()`);
    // error state: a real error banner has text AND an icon
    await open("/scan");
    const { result } = await send("Runtime.evaluate", { expression: `document.querySelector('input[type=file]')` });
    await send("DOM.setFileInputFiles", { files: [TXT], objectId: result.objectId });
    await waitFor(`document.querySelector('[role=alert].notice-error')`, "error banner");
    const err = await evaluate(`(() => { const e = document.querySelector('[role=alert].notice-error'); const cs = getComputedStyle(e); return { text: e.innerText.trim(), icons: e.querySelectorAll('svg').length }; })()`);
    assert.ok(err.text.length > 10, "the error says what went wrong in words");
    assert.ok(err.icons >= 1, "the error banner has an icon, so it does not rely on colour alone");
    await shot(`error-banner-1280-${theme}`);
  });
}
await test("no console errors or exceptions (so no hydration mismatch) during the whole run", async () => {
  assert.deepEqual(problems, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
