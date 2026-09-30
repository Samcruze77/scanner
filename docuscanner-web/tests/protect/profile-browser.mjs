// Memory and timing of Protect Word in a REAL browser (Chromium via playwright-core), one
// fresh browser per size. Peak memory is the renderer process's own peak resident set
// (VmHWM from /proc), which includes the JavaScript heap, ArrayBuffers and the Blob.
//
//   (server running a build with NEXT_PUBLIC_DOCX_PROTECTION_ENABLED=true on :3100)
//   node tests/protect/profile-browser.mjs [baseUrl] [sizeMB ...]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { makeLargeDocx, makeTestDocx, PASSWORD } from "./fixtures.mjs";

const BASE = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const sizes = process.argv.slice(3).map(Number).filter(Boolean);
const CHROME = [process.env.CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && fs.existsSync(p));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "protect-bprofile-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
const status = (pid) => {
  try {
    const t = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const kb = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(t)?.[1] ?? 0) / 1024;
    return { rss: kb("VmRSS"), hwm: kb("VmHWM") };
  } catch {
    return { rss: 0, hwm: 0 };
  }
};

console.log("| docx size | select -> ready | encrypt | verify | total | base renderer RSS | peak renderer RSS | extra | peak JS heap | result |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const mb of sizes.length ? sizes : [1, 10, 25, 48]) {
  const file = path.join(dir, `d${mb}.docx`);
  fs.writeFileSync(file, mb <= 1 ? await makeTestDocx({ imageSize: 600 }) : await makeLargeDocx(mb - 0.2));
  const size = fs.statSync(file).size;
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    await context.addInitScript(() => {
      localStorage.setItem("ds_consent", JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false }));
      window.__marks = {};
      window.__heapPeak = 0;
      setInterval(() => { const m = performance.memory; if (m) window.__heapPeak = Math.max(window.__heapPeak, m.usedJSHeapSize); }, 25);
      new MutationObserver(() => {
        const text = document.body?.innerText ?? "";
        for (const [key, needle] of [["encrypting", "Protecting your document on this device"], ["verifying", "Checking the protected copy"], ["done", "Your Word document is protected"], ["failed", "couldn't protect"], ["failed2", "too large for your browser"]]) {
          if (!(key in window.__marks) && text.includes(needle)) window.__marks[key] = performance.now();
        }
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/tools/protect-word`, { waitUntil: "networkidle" });
    const cdp = await browser.newBrowserCDPSession();
    const procs = async () => (await cdp.send("SystemInfo.getProcessInfo")).processInfo.filter((p) => p.type === "renderer").map((p) => p.id);
    const peak = async () => Math.max(0, ...(await procs()).map((pid) => status(pid).hwm));
    const now = async () => Math.max(0, ...(await procs()).map((pid) => status(pid).rss));
    const base = await now();
    const t0 = Date.now();
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByLabel(/^Password to open/).waitFor({ timeout: 120000 });
    const readyMs = Date.now() - t0;
    await page.getByLabel(/^Password to open/).fill(PASSWORD);
    await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
    await page.evaluate(() => { window.__marks = {}; });
    const clicked = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "Protect Word document" }).click();
    await page.waitForFunction(() => window.__marks.done || window.__marks.failed || window.__marks.failed2, null, { timeout: 600000 });
    const m = await page.evaluate(() => ({ ...window.__marks, heap: window.__heapPeak }));
    const hwm = await peak();
    const ok = Boolean(m.done);
    const enc = m.verifying - (m.encrypting ?? clicked), ver = m.done - m.verifying;
    console.log(`| ${(size / 1048576).toFixed(1)} MB | ${readyMs} ms | ${ok ? Math.round(enc) + " ms" : "-"} | ${ok ? Math.round(ver) + " ms" : "-"} | ${ok ? Math.round(m.done - clicked) + " ms" : "-"} | ${Math.round(base)} MB | ${Math.round(hwm)} MB | +${Math.round(hwm - base)} MB | ${Math.round(m.heap / 1048576)} MB | ${ok ? "protected" : m.failed2 ? "refused: too large for browser" : "FAILED"} |`);
  } finally {
    await browser.close();
    fs.rmSync(file, { force: true });
  }
}
