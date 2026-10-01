// Admin navigation timings against tests/perf/mock-supabase.mjs (simulated latency -- these are
// structural measurements, not production numbers).  node tests/perf/admin-navigation.mjs <cookieFile> [base]
import fs from "node:fs";
import { chromium } from "playwright-core";
const cookie = fs.readFileSync(process.argv[2], "utf8").trim();
const BASE = (process.argv[3] ?? "http://localhost:3102").replace(/\/$/, "");
const CHROME = [process.env.CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addCookies([{ name: "sb-127-auth-token", value: cookie, url: BASE }]);
const page = await ctx.newPage();
const mock = async (p) => (await fetch(`http://127.0.0.1:54321${p}`)).json();
await mock("/__reset");
let s = Date.now();
await page.goto(BASE + "/admin", { waitUntil: "load" });
console.log(`hard load /admin: ${Date.now() - s}ms  h1=${await page.locator("h1").first().innerText()}`);
console.log("edge calls:", JSON.stringify(await mock("/__calls")));
for (const [label, path] of [["Geography", "/admin/geography"], ["Exports", "/admin/exports"], ["Dashboard", "/admin"]]) {
  await mock("/__reset");
  s = Date.now();
  await page.locator(`nav a[href="${path}"], a[href="${path}"]`).first().click();
  await page.waitForURL(`**${path}`);
  const first = Date.now() - s; // URL updated
  const shell = Date.now() - s; await page.locator("main h1").first().waitFor({ timeout: 30000 });
  console.log(`-> ${label}: URL ${first}ms, page shell ${shell}ms, data ${Date.now() - s}ms  calls=${JSON.stringify(await mock("/__calls"))}`);
  await page.waitForTimeout(400);
}
await browser.close();
