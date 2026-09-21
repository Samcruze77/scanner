// UI audit: opens the main screens in headless Chrome at the five design widths,
// loads real documents so the working states (not just the empty ones) are seen,
// saves a screenshot of each, and measures the things that go wrong on small screens:
// sideways overflow and touch targets under 44px. Not a pass/fail test: a report
// (tests/ui/out/report.json + the printed table) to compare before and after a change.
//
//   node tests/ui/audit.mjs [baseUrl] [--shots=375,1280]     (default http://localhost:3000)
// Needs the app running (npm run build && npm run start).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const shotArg = process.argv.find((a) => a.startsWith("--shots="));
const SHOT_WIDTHS = shotArg ? shotArg.slice(8).split(",").map(Number) : [375, 1280];
const WIDTHS = [375, 390, 768, 1024, 1280];
const tag = process.env.TAG ?? "before";
// SCHEME=dark renders every screen with the system in dark mode.
const SCHEME = process.env.SCHEME === "dark" ? "dark" : "light";
const { createCanvas } = require("@napi-rs/canvas");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ui-audit-"));
const outDir = path.join(here, "out", tag);
fs.mkdirSync(outDir, { recursive: true });

const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));

// Fixtures: three page-like photos and a PDF-sized image.
function pageImage(name, w, h, label) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4f2ec";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#222";
  ctx.font = `${Math.round(w / 12)}px Arial`;
  ctx.fillText(label, w * 0.08, h * 0.12);
  ctx.font = `${Math.round(w / 34)}px Arial`;
  for (let i = 0; i < 22; i++) ctx.fillText("The quick brown fox jumps over the lazy dog, invoice total 1,284.50", w * 0.08, h * 0.2 + i * (h / 32));
  const file = path.join(work, name);
  fs.writeFileSync(file, c.toBuffer("image/jpeg", 88));
  return file;
}
const FILES = [pageImage("page1.jpg", 1700, 2200, "INVOICE 0042"), pageImage("page2.jpg", 1700, 2200, "CONTRACT"), pageImage("page3.jpg", 1700, 2200, "RECEIPT")];
const DOCX = path.join(here, "..", "compress", "out", "survey.docx");

const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, "profile")}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
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
  } else if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
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
async function waitFor(expression, what, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return true;
    await sleep(200);
  }
  console.log(`   (timed out waiting for ${what})`);
  return false;
}
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.print = () => {};` });

async function open(route, width) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: SCHEME }] });
  await send("Emulation.setDeviceMetricsOverride", { width, height: width < 700 ? 812 : width < 1100 ? 1024 : 900, deviceScaleFactor: 1, mobile: width < 700 });
  await send("Emulation.setTouchEmulationEnabled", { enabled: width < 700 });
  await send("Network.clearBrowserCookies").catch(() => undefined);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(100);
  await send("Page.navigate", { url: BASE + route });
  await waitFor(`document.readyState === 'complete' && document.querySelector('main')`, route, 20000);
  await sleep(700);
}
async function setFiles(files) {
  const { result } = await send("Runtime.evaluate", { expression: `document.querySelector('input[type=file]')` });
  await send("DOM.setFileInputFiles", { files, objectId: result.objectId });
}
const clickText = (selector, text) => evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);

// What is wrong with the layout right now.
const MEASURE = `(() => {
  const vw = innerWidth;
  const root = document.documentElement;
  const overflow = root.scrollWidth > vw + 1;
  const wide = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.right > vw + 1 && cs.position !== 'fixed' && !el.closest('[data-ad-placement]'); }).slice(0, 3).map((el) => el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30));
  const small = [...document.querySelectorAll('a, button, input:not([type=file]), select, textarea, [role=slider]')].filter((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || el.classList.contains('sr-only')) return false;
    if (el.closest('[aria-hidden=true]')) return false;
    if (r.height >= 43.5 && r.width >= 43.5) return false;
    // A checkbox or radio whose whole label row is the target.
    const row = el.tagName === 'INPUT' && el.closest('label');
    if (row && row.getBoundingClientRect().height >= 43.5) return false;
    // A link inside a sentence may be small if it carries an invisible extended hit area (.link-inline):
    // prove it by hit-testing a point 12px above and below its box.
    if (el.classList.contains('link-inline')) {
      const cx = r.left + r.width / 2;
      const up = document.elementFromPoint(cx, r.top - 12), down = document.elementFromPoint(cx, r.bottom + 12);
      if (up === el && down === el && r.width + 16 >= 43.5) return false;
    }
    return true;
  }).map((el) => ((el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 22)) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
  // Text whose colour against the surface it sits on is under WCAG AA (4.5:1, 3:1 for large text).
  // Tailwind v4 colours compute to oklch()/color-mix(), so let a 1px canvas turn any CSS colour into RGBA.
  const swatch = document.createElement('canvas'); swatch.width = swatch.height = 1;
  const swatchCtx = swatch.getContext('2d', { willReadFrequently: true });
  const parse = (c) => {
    if (!c || c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    swatchCtx.clearRect(0, 0, 1, 1); swatchCtx.fillStyle = '#000'; swatchCtx.fillStyle = c; swatchCtx.fillRect(0, 0, 1, 1);
    const d = swatchCtx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const surface = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' && n.tagName !== 'HTML') return null;
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) { stack.push(bg); if (bg.a === 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const body = parse(getComputedStyle(document.body).backgroundColor);
    if (body && body.a === 1) base = body;
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const lowContrast = [];
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[aria-hidden=true], .sr-only, [data-ad-placement], option, canvas')) continue;
    if (el.closest('button:disabled, [disabled]') || cs.opacity < 1) continue;
    const fg0 = parse(cs.color); const bg = surface(el); if (!fg0 || !bg) continue;
    const fg = blend(fg0, bg);
    const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize); const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) lowContrast.push(el.tagName.toLowerCase() + ' "' + el.innerText.trim().slice(0, 28) + '" ' + ratio.toFixed(2) + ':1 ' + cs.color + ' on rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')');
  }
  const buttons = [...document.querySelectorAll('main button, main a[href]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
  return { overflow, wide, small: small.slice(0, 8), smallCount: small.length, lowContrast: lowContrast.slice(0, 8), lowContrastCount: lowContrast.length, visibleActions: buttons, pageHeight: root.scrollHeight, vh: innerHeight, scrolls: +(root.scrollHeight / innerHeight).toFixed(1) };
})()`;

const report = {};
async function measureAllWidths(name, setup) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  report[name] = {};
  for (const width of WIDTHS) {
    await setup(width);
    const m = await evaluate(MEASURE);
    report[name][width] = m;
    if (SHOT_WIDTHS.includes(width)) {
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(outDir, `${name}-${width}.png`), Buffer.from(shot.data, "base64"));
      if (process.env.FULL) {
        const full = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        fs.writeFileSync(path.join(outDir, `${name}-${width}-full.png`), Buffer.from(full.data, "base64"));
      }
    }
  }
}

const loadPages = async (width, route = "/scan", files = FILES) => {
  await open(route, width);
  await setFiles(files);
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Create PDF \\(\\d+ page/.test(b.innerText) && !b.disabled)`, "pages ready", 60000);
  await sleep(500);
};

console.log(`UI audit (${tag}) against ${BASE}, screenshots at ${SHOT_WIDTHS.join(", ")}px -> ${outDir}`);

await measureAllWidths("home", (w) => open("/", w));
await measureAllWidths("scan-empty", (w) => open("/scan", w));
await measureAllWidths("scan-pages", (w) => loadPages(w));
await measureAllWidths("scan-pdf-created", async (w) => {
  await loadPages(w);
  await clickText("button", "Create PDF");
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Download PDF')`, "PDF created", 30000);
  await sleep(400);
});
await measureAllWidths("page-editor", async (w) => {
  await loadPages(w);
  await evaluate(`document.querySelector('[aria-label="Edit page 1"]').click()`);
  await waitFor(`document.querySelector('[role=dialog]')`, "page editor");
  await sleep(500);
});
await measureAllWidths("annotator", async (w) => {
  await loadPages(w, "/tools/annotate", FILES.slice(0, 1));
  await waitFor(`document.querySelector('[role=dialog][aria-label^="Annotate page"]')`, "annotator", 20000);
  await sleep(600);
});
await measureAllWidths("crop-editor", async (w) => {
  await loadPages(w);
  await evaluate(`document.querySelector('[aria-label="Edit page 1"]').click()`);
  await waitFor(`document.querySelector('[role=dialog]')`, "page editor");
  await clickText("[role=dialog] button", "Adjust crop");
  await waitFor(`document.querySelector('[role=dialog][aria-label="Adjust crop"]')`, "crop editor");
  await sleep(500);
});
await measureAllWidths("signature-dialog", async (w) => {
  await loadPages(w, "/tools/sign-pdf", FILES.slice(0, 1));
  await waitFor(`document.querySelector('[role=dialog][aria-label^="Annotate page"]')`, "annotator", 20000);
  await waitFor(`document.querySelectorAll('[role=dialog]').length > 1 || [...document.querySelectorAll('[role=dialog]')].some(d => /signature/i.test(d.getAttribute('aria-label') || ''))`, "signature dialog", 8000);
  await sleep(600);
});
await measureAllWidths("tools-hub", (w) => open("/tools", w));
await measureAllWidths("tool-editor-page", (w) => open("/tools/sign-pdf", w));
await measureAllWidths("compress-ready", async (w) => {
  await open("/tools/compress-image", w);
  await setFiles([FILES[0]]);
  await waitFor(`document.querySelector('input[type=range]')`, "slider", 20000);
  await sleep(2500);
});
await measureAllWidths("compress-done", async (w) => {
  await open("/tools/compress-image", w);
  await setFiles([FILES[0]]);
  await waitFor(`document.querySelector('input[type=range]')`, "slider", 20000);
  await sleep(1500);
  await clickText("button", "Compress image");
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Download (compressed|original)/.test(b.innerText))`, "compress result", 30000);
  await sleep(600);
});
await measureAllWidths("convert-hub", (w) => open("/convert", w));
await measureAllWidths("word-to-pdf-result", async (w) => {
  await open("/convert/word-to-pdf", w);
  if (fs.existsSync(DOCX)) {
    await setFiles([DOCX]);
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Download PDF')`, "conversion", 60000);
    await sleep(800);
  }
});
await measureAllWidths("history-guest", (w) => open("/history", w));
await measureAllWidths("login-modal", async (w) => {
  await open("/", w);
  await clickText("header button", "Log in");
  await sleep(500);
});
await measureAllWidths("forgot-password", async (w) => {
  await open("/", w);
  await clickText("header button", "Log in");
  await sleep(400);
  await clickText("[role=dialog] button", "Forgot password");
  await sleep(500);
});
const pressTab = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
};
await measureAllWidths("focus-states", async (w) => {
  await open("/scan", w);
  for (let i = 0; i < 8; i++) await pressTab();
  await sleep(200);
});
await measureAllWidths("reset-password-invalid", async (w) => {
  await open("/reset-password", w);
  await sleep(1200);
});

fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
for (const [name, byWidth] of Object.entries(report)) {
  for (const w of WIDTHS) {
    if (byWidth[w].lowContrastCount) console.log(`  contrast ${name}@${w}: ${byWidth[w].lowContrastCount} -> ${byWidth[w].lowContrast.slice(0, 4).join(" | ")}`);
  }
}
console.log("\nscreen".padEnd(24) + WIDTHS.map((w) => String(w).padStart(22)).join(""));
for (const [name, byWidth] of Object.entries(report)) {
  console.log(name.padEnd(24) + WIDTHS.map((w) => { const m = byWidth[w]; return `${m.overflow ? "OVERFLOW " : ""}small:${m.smallCount} act:${m.visibleActions} h:${m.scrolls}x`.padStart(22); }).join(""));
}
if (consoleErrors.length) console.log("\nconsole exceptions:", consoleErrors.slice(0, 3));
chrome.kill();
process.exit(0);
